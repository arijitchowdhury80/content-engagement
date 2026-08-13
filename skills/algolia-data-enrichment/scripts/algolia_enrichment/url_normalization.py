"""Deterministic canonical URL normalization for the Enhanced index.

This module intentionally contains no LLM calls. It is the safety rail for changing the `url`
field in a live retrieval index: every record is counted, every URL is resolved, every proposed
write is keyed by objectID, and every non-URL field is hashed before and after.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urljoin, urlparse

from .api import AlgoliaClient
from .errors import EnrichmentError, ZeroWorkError

BASE_URL = "https://www.algolia.com"
ALLOWED_HOSTS = {
    "www.algolia.com",
    "support.algolia.com",
    "academy.algolia.com",
}
APPROVAL_FILENAME = "url-normalization-approved.json"
DEFAULT_INDEX = "Algolia_Prod_Copy_Enhanced"


@dataclass(frozen=True)
class UrlPlan:
    index: str
    expected_total: int
    rows: list[dict]
    plan_hash: str


@dataclass(frozen=True)
class Approval:
    target_index: str
    expected_total_records: int
    expected_write_count: int
    plan_hash: str
    approved_by: str


def _json_hash(value: object) -> str:
    payload = json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def canonical_record_hash(record: dict) -> str:
    """Hash the full top-level record while ignoring only `url`."""
    return _json_hash({k: v for k, v in record.items() if k != "url"})


def _host(url: str) -> str:
    return urlparse(url).netloc.lower()


def _require_allowed_host(url: str, label: str = "URL") -> str:
    host = _host(url)
    if host not in ALLOWED_HOSTS:
        if label == "final url":
            raise EnrichmentError(f"unsupported final host {host!r}: {url}")
        raise EnrichmentError(f"{label} has unsupported host {host!r}: {url}")
    return host


def classify_url(record: dict, base_url: str = BASE_URL) -> dict:
    object_id = record.get("objectID")
    if not object_id:
        raise EnrichmentError("record has no objectID")
    old_url = record.get("url")
    if not isinstance(old_url, str) or not old_url.strip():
        raise EnrichmentError(f"{object_id}: empty or non-string url")
    old_url = old_url.strip()
    if old_url.startswith("//"):
        raise EnrichmentError(f"{object_id}: protocol-relative url is not canonicalizable: {old_url}")
    if old_url.startswith(("http://", "https://")):
        _require_allowed_host(old_url, "absolute url")
        old_kind = "absolute"
        candidate = old_url
    elif old_url.startswith("/"):
        old_kind = "relative"
        candidate = urljoin(base_url.rstrip("/") + "/", old_url.lstrip("/"))
        _require_allowed_host(candidate, "candidate url")
    else:
        raise EnrichmentError(f"{object_id}: unsupported relative url shape: {old_url}")

    return {
        "objectID": object_id,
        "source": record.get("source"),
        "page_type": record.get("page_type"),
        "language_code": record.get("language_code"),
        "title": record.get("title"),
        "old_url": old_url,
        "old_url_kind": old_kind,
        "candidate_url": candidate,
        "candidate_host": _host(candidate),
        "needs_http_verification": True,
        "pre_non_url_hash": canonical_record_hash(record),
    }


def _assert_unique(values: list[str], label: str) -> None:
    seen: dict[str, str] = {}
    for row in values:
        key = row["value"]
        object_id = row["objectID"]
        other = seen.get(key)
        if other and other != object_id:
            raise EnrichmentError(f"{label} collision for {key}: {other} and {object_id}")
        seen[key] = object_id


def build_plan(records: list[dict], expected_total: int, index: str = DEFAULT_INDEX) -> UrlPlan:
    if expected_total <= 0:
        raise EnrichmentError("expected_total must be positive")
    if len(records) != expected_total:
        raise EnrichmentError(f"expected {expected_total} records, browsed {len(records)}")
    if not records:
        raise ZeroWorkError("zero records is a failure, never a pass")
    rows = [classify_url(record) for record in records]
    _assert_unique([{"objectID": r["objectID"], "value": r["objectID"]} for r in rows],
                   "objectID")
    _assert_unique([{"objectID": r["objectID"], "value": r["candidate_url"]} for r in rows],
                   "canonical URL")
    plan_hash = _json_hash({"index": index, "expected_total": expected_total, "rows": rows})
    return UrlPlan(index=index, expected_total=expected_total, rows=rows, plan_hash=plan_hash)


def verify_http_results(plan: UrlPlan, http_results: dict[str, dict]) -> UrlPlan:
    rows: list[dict] = []
    final_values: list[dict] = []
    for row in plan.rows:
        object_id = row["objectID"]
        result = http_results.get(object_id)
        if result is None:
            raise EnrichmentError(f"{object_id}: missing HTTP verification result")
        if not result.get("ok"):
            raise EnrichmentError(
                f"{object_id}: HTTP verification failed for {row['candidate_url']}: "
                f"{result.get('status')} {result.get('error') or ''}".strip())
        final_url = result.get("final_url")
        if not isinstance(final_url, str) or not final_url.startswith(("http://", "https://")):
            raise EnrichmentError(f"{object_id}: HTTP verification returned invalid final_url")
        final_host = _require_allowed_host(final_url, "final url")
        status = int(result.get("status") or 0)
        if status < 200 or status >= 400:
            raise EnrichmentError(f"{object_id}: final HTTP status is not a document: {status}")
        content_type = (result.get("content_type") or "").split(";")[0].strip().lower()
        if content_type and content_type not in {"text/html", "application/xhtml+xml"}:
            raise EnrichmentError(f"{object_id}: unexpected content type {content_type!r}")
        out = dict(row)
        out.update({
            "final_url": final_url,
            "final_host": final_host,
            "http_status": status,
            "content_type": result.get("content_type"),
            "redirects": int(result.get("redirects") or 0),
            "changed": final_url != row["old_url"],
        })
        rows.append(out)
        final_values.append({"objectID": object_id, "value": final_url})
    _assert_unique(final_values, "final URL")
    verified_hash = _json_hash({"index": plan.index, "expected_total": plan.expected_total,
                                "rows": rows})
    return UrlPlan(index=plan.index, expected_total=plan.expected_total,
                   rows=rows, plan_hash=verified_hash)


def make_apply_payloads(verified_plan: UrlPlan) -> list[dict]:
    payloads = [
        {"objectID": row["objectID"], "url": row["final_url"]}
        for row in verified_plan.rows
        if row.get("changed")
    ]
    if not payloads:
        raise ZeroWorkError("zero URL changes is a failure for apply; run audit instead")
    for payload in payloads:
        if set(payload) != {"objectID", "url"}:
            raise EnrichmentError(f"URL payload may only contain objectID and url: {payload}")
    return payloads


def read_approval(path: Path, *, target_index: str, expected_total: int,
                  expected_write_count: int, plan_hash: str) -> Approval:
    if not path.exists():
        raise EnrichmentError(f"approval file does not exist: {path}")
    data = json.loads(path.read_text())
    expected = {
        "target_index": target_index,
        "expected_total_records": expected_total,
        "expected_write_count": expected_write_count,
        "plan_hash": plan_hash,
    }
    for key, value in expected.items():
        if data.get(key) != value:
            raise EnrichmentError(
                f"approval {key} mismatch: expected {value!r}, got {data.get(key)!r}")
    approved_by = data.get("approved_by")
    if not approved_by:
        raise EnrichmentError("approval is unattributed")
    return Approval(
        target_index=target_index,
        expected_total_records=expected_total,
        expected_write_count=expected_write_count,
        plan_hash=plan_hash,
        approved_by=approved_by,
    )


def verify_readback(verified_plan: UrlPlan, live_records: list[dict], expected_total: int) -> dict:
    if len(live_records) != expected_total:
        raise EnrichmentError(f"expected {expected_total} live records, browsed {len(live_records)}")
    by_id = {record.get("objectID"): record for record in live_records}
    if len(by_id) != expected_total:
        raise EnrichmentError("live readback contains duplicate or missing objectIDs")
    plan_ids = {row["objectID"] for row in verified_plan.rows}
    live_ids = set(by_id)
    if live_ids != plan_ids:
        missing = sorted(plan_ids - live_ids)[:10]
        extra = sorted(live_ids - plan_ids)[:10]
        raise EnrichmentError(f"objectID set changed; missing={missing}, extra={extra}")

    changed = 0
    for row in verified_plan.rows:
        live = by_id[row["objectID"]]
        expected_url = row["final_url"]
        if live.get("url") != expected_url:
            raise EnrichmentError(
                f"{row['objectID']}: url mismatch after write: "
                f"expected {expected_url!r}, got {live.get('url')!r}")
        after_hash = canonical_record_hash(live)
        if after_hash != row["pre_non_url_hash"]:
            raise EnrichmentError(f"{row['objectID']}: non-url hash changed")
        if row.get("changed"):
            changed += 1
    return {
        "ok": True,
        "checked": len(live_records),
        "changed": changed,
        "relative_remaining": sum(1 for record in live_records
                                  if isinstance(record.get("url"), str)
                                  and record["url"].startswith("/")),
    }


def write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False, sort_keys=True) + "\n")


def write_jsonl(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=True, sort_keys=True) + "\n")


def read_jsonl(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text().split("\n") if line.strip()]


def curl_resolve(url: str, timeout_s: int = 30) -> dict:
    """Resolve a public page with curl, following redirects. No credentials are involved."""
    started = time.time()
    proc = subprocess.run(
        [
            "curl", "-L", "-sS", "-o", "/dev/null",
            "--connect-timeout", "10", "--max-time", str(timeout_s),
            "-w", "%{http_code}\\t%{url_effective}\\t%{content_type}\\t%{num_redirects}",
            url,
        ],
        capture_output=True,
        text=True,
        timeout=timeout_s + 5,
    )
    elapsed = round(time.time() - started, 3)
    if proc.returncode != 0:
        return {"ok": False, "status": 0, "final_url": url, "content_type": "",
                "redirects": 0, "elapsed_s": elapsed, "error": proc.stderr[:500]}
    parts = proc.stdout.rstrip("\n").split("\t")
    if len(parts) != 4:
        return {"ok": False, "status": 0, "final_url": url, "content_type": "",
                "redirects": 0, "elapsed_s": elapsed,
                "error": f"unexpected curl write-out: {proc.stdout[:300]!r}"}
    status, final_url, content_type, redirects = parts
    try:
        status_int = int(status)
        redirect_int = int(redirects)
    except ValueError:
        return {"ok": False, "status": 0, "final_url": final_url, "content_type": content_type,
                "redirects": 0, "elapsed_s": elapsed,
                "error": f"unexpected numeric curl write-out: {proc.stdout[:300]!r}"}
    return {"ok": 200 <= status_int < 400, "status": status_int, "final_url": final_url,
            "content_type": content_type, "redirects": redirect_int, "elapsed_s": elapsed,
            "error": "" if 200 <= status_int < 400 else f"HTTP {status_int}"}


def resolve_rows(rows: list[dict], *, workers: int = 12, timeout_s: int = 30,
                 progress_every: int = 500) -> dict[str, dict]:
    if workers <= 0:
        raise EnrichmentError("workers must be positive")
    results: dict[str, dict] = {}
    with ThreadPoolExecutor(max_workers=workers) as pool:
        future_map = {
            pool.submit(curl_resolve, row["candidate_url"], timeout_s): row["objectID"]
            for row in rows
        }
        total = len(future_map)
        for checked, future in enumerate(as_completed(future_map), start=1):
            object_id = future_map[future]
            try:
                results[object_id] = future.result()
            except Exception as exc:  # pragma: no cover - defensive around subprocess/threading.
                results[object_id] = {"ok": False, "status": 0, "final_url": "",
                                      "content_type": "", "redirects": 0,
                                      "elapsed_s": 0, "error": repr(exc)}
            if progress_every and (checked % progress_every == 0 or checked == total):
                print(f"verify-http progress {checked}/{total}", file=sys.stderr, flush=True)
    return results


def summarize(rows: list[dict]) -> dict:
    out = {
        "total": len(rows),
        "relative": 0,
        "absolute": 0,
        "changed": 0,
        "hosts": {},
        "sources": {},
        "redirects": {},
    }
    for row in rows:
        kind = row.get("old_url_kind")
        if kind in ("relative", "absolute"):
            out[kind] += 1
        changed = row.get("changed")
        if changed is None:
            changed = row.get("candidate_url") != row.get("old_url")
        if changed:
            out["changed"] += 1
        host = row.get("final_host") or row.get("candidate_host")
        if host:
            out["hosts"][host] = out["hosts"].get(host, 0) + 1
        source = row.get("source") or "<missing>"
        out["sources"][source] = out["sources"].get(source, 0) + 1
        redirects = str(row.get("redirects", "unverified"))
        out["redirects"][redirects] = out["redirects"].get(redirects, 0) + 1
    return out


def audit(client: AlgoliaClient, index: str, out_dir: Path, expected_total: int | None) -> UrlPlan:
    distinct_count, raw_count = client.record_count(index)
    expected = expected_total or raw_count
    records = list(client.browse(index, attributes=None))
    plan = build_plan(records, expected_total=expected, index=index)
    write_jsonl(out_dir / "snapshot.jsonl", records)
    write_json(out_dir / "settings-before.json", client.get_settings(index))
    write_jsonl(out_dir / "url-normalization-plan.jsonl", plan.rows)
    write_json(out_dir / "audit-summary.json", {
        "index": index,
        "distinct_count": distinct_count,
        "raw_count": raw_count,
        "expected_total": expected,
        "plan_hash": plan.plan_hash,
        **summarize(plan.rows),
    })
    return plan


def load_plan(path: Path, index: str, expected_total: int) -> UrlPlan:
    rows = read_jsonl(path)
    plan_hash = _json_hash({"index": index, "expected_total": expected_total, "rows": rows})
    return UrlPlan(index=index, expected_total=expected_total, rows=rows, plan_hash=plan_hash)


def cli(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Canonical URL normalization gate")
    parser.add_argument("mode", choices=["audit", "verify-http", "apply", "verify-readback"])
    parser.add_argument("--workspace", default=".")
    parser.add_argument("--index", default=DEFAULT_INDEX)
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--expected-total", type=int, default=11928)
    parser.add_argument("--limit", type=int, default=0,
                        help="debug only for verify-http; production must be 0")
    parser.add_argument("--workers", type=int, default=12)
    parser.add_argument("--http-timeout", type=int, default=30)
    args = parser.parse_args(argv)

    workspace = Path(args.workspace)
    out_dir = Path(args.out_dir)
    client = AlgoliaClient.from_env(workspace)

    if args.mode == "audit":
        plan = audit(client, args.index, out_dir, args.expected_total)
        print(json.dumps({"ok": True, "mode": "audit", "plan_hash": plan.plan_hash,
                          "rows": len(plan.rows)}, sort_keys=True))
        return 0

    if args.mode == "verify-http":
        plan = load_plan(out_dir / "url-normalization-plan.jsonl", args.index,
                         args.expected_total)
        rows = plan.rows if not args.limit else plan.rows[:args.limit]
        results = resolve_rows(rows, workers=args.workers, timeout_s=args.http_timeout)
        write_json(out_dir / "http-results.json", results)
        if args.limit:
            print(json.dumps({"ok": False, "mode": "verify-http", "checked": len(rows),
                              "reason": "limit used; not valid for approval"}, sort_keys=True))
            return 2
        verified = verify_http_results(plan, results)
        write_jsonl(out_dir / "url-normalization-verified.jsonl", verified.rows)
        payloads = make_apply_payloads(verified)
        write_jsonl(out_dir / "payloads.jsonl", payloads)
        rollback = [{"objectID": row["objectID"], "url": row["old_url"]}
                    for row in verified.rows if row.get("changed")]
        write_jsonl(out_dir / "rollback.jsonl", rollback)
        write_json(out_dir / "http-summary.json", {
            "index": args.index,
            "plan_hash": verified.plan_hash,
            "expected_write_count": len(payloads),
            **summarize(verified.rows),
        })
        print(json.dumps({"ok": True, "mode": "verify-http", "plan_hash": verified.plan_hash,
                          "checked": len(verified.rows),
                          "expected_write_count": len(payloads)}, sort_keys=True))
        return 0

    if args.mode == "apply":
        verified = load_plan(out_dir / "url-normalization-verified.jsonl", args.index,
                             args.expected_total)
        payloads = make_apply_payloads(verified)
        read_approval(out_dir / "approvals" / APPROVAL_FILENAME, target_index=args.index,
                      expected_total=args.expected_total,
                      expected_write_count=len(payloads),
                      plan_hash=verified.plan_hash)
        responses = client.save_objects(args.index, payloads,
                                        action="partialUpdateObjectNoCreate", chunk=100)
        for response in responses:
            task_id = response.get("taskID")
            if task_id is not None and not client.wait_task(args.index, int(task_id)):
                raise EnrichmentError(f"Algolia task did not publish: {task_id}")
        write_json(out_dir / "write-report.json", {"index": args.index, "chunks": len(responses),
                                                   "records": len(payloads)})
        print(json.dumps({"ok": True, "mode": "apply", "records": len(payloads)}, sort_keys=True))
        return 0

    if args.mode == "verify-readback":
        verified = load_plan(out_dir / "url-normalization-verified.jsonl", args.index,
                             args.expected_total)
        records = list(client.browse(args.index, attributes=None))
        report = verify_readback(verified, records, expected_total=args.expected_total)
        distinct_count, raw_count = client.record_count(args.index)
        report.update({"index": args.index, "distinct_count": distinct_count,
                       "raw_count": raw_count})
        if raw_count != args.expected_total:
            raise EnrichmentError(f"raw count changed: expected {args.expected_total}, got {raw_count}")
        write_json(out_dir / "readback-report.json", report)
        print(json.dumps({"ok": True, "mode": "verify-readback", **report}, sort_keys=True))
        return 0

    raise AssertionError(args.mode)


if __name__ == "__main__":
    raise SystemExit(cli())
