#!/usr/bin/env python3
"""Default-dry-run, Vanilla-only correction for the Jahia development chat block."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode

import deploy_jahia_engagement_tracker as jahia


ROOT = Path(__file__).resolve().parents[2]
TARGET_ORIGIN = "https://tmp-content-eng-algolia.cloud.jahia.com"
EXPECTED_STALE = "Algolia_Prod_Copy_Enhanced"
REQUIRED_INDEX = "Algolia_Prod_Copy_Vanilla"
BLOCK_PATH = "/sites/www/home/drift/custom-code-block"
DRIFT_PATH = "/sites/www/home/drift"
CREDENTIAL_TAG = re.compile(r"<(?:algolia-chat|algolia-instant-search)(?=[\s>])[^>]*>", re.I)
INDEX_ATTRIBUTE = re.compile(r"\bindex-name\s*=\s*([\"'])(.*?)\1", re.I)
SYNC_SEGMENTS = {"dropbox", "onedrive", "icloud drive", "google drive", "box"}


def sha256(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _inside(parent: Path, child: Path) -> bool:
    try:
        child.relative_to(parent)
        return True
    except ValueError:
        return False


def safe_evidence_dir(raw: str) -> Path:
    requested = Path(raw)
    if not requested.is_absolute():
        raise RuntimeError("Evidence directory must be an absolute path")
    if requested.exists() and requested.is_symlink():
        raise RuntimeError("Evidence directory cannot be a symbolic link")
    candidate = requested.resolve(strict=False)
    repository = ROOT.resolve()
    if candidate == Path(candidate.anchor):
        raise RuntimeError("Filesystem root cannot be an evidence directory")
    if _inside(repository, candidate):
        raise RuntimeError("Raw Jahia snapshots cannot be stored inside the repository")
    for part in candidate.parts:
        if part.lower() in SYNC_SEGMENTS or part.lower() == "mobile documents":
            raise RuntimeError(f"Raw Jahia snapshots cannot be stored in synchronized storage: {part}")
    candidate.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(candidate, 0o700)
    if candidate.stat().st_mode & 0o077:
        raise RuntimeError("Evidence directory permissions must be 0700")
    return candidate


def write_private(path: Path, payload: dict, *, replace: bool = False) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    flags = os.O_WRONLY | os.O_CREAT | (os.O_TRUNC if replace else os.O_EXCL)
    descriptor = os.open(path, flags, 0o600)
    try:
        content = (json.dumps(payload, indent=2, ensure_ascii=False) + "\n").encode("utf-8")
        os.write(descriptor, content)
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
    os.chmod(path, 0o600)


def read_private(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def active_index_span(html: str) -> tuple[str, int, int]:
    owners = []
    for tag in CREDENTIAL_TAG.finditer(html):
        for attribute in INDEX_ATTRIBUTE.finditer(tag.group(0)):
            owners.append((tag, attribute))
    if len(owners) != 1:
        raise RuntimeError(f"Expected exactly one credential-owning index-name attribute; found {len(owners)}")
    tag, attribute = owners[0]
    start = tag.start() + attribute.start(2)
    end = tag.start() + attribute.end(2)
    return attribute.group(2), start, end


def replace_active_index(html: str, required_index: str = REQUIRED_INDEX) -> tuple[str, dict]:
    observed, start, end = active_index_span(html)
    updated = f"{html[:start]}{required_index}{html[end:]}"
    if updated[:start] != html[:start] or updated[start + len(required_index):] != html[end:]:
        raise RuntimeError("Index update did not produce a one-span byte diff")
    return updated, {
        "from": observed,
        "to": required_index,
        "valueStart": start,
        "valueEnd": end,
        "beforeSha256": sha256(html),
        "afterSha256": sha256(updated),
        "beforeLength": len(html),
        "afterLength": len(updated),
    }


def capture_authenticated_snapshot() -> dict:
    edit = jahia.block_html("EDIT")
    live = jahia.block_html("LIVE")
    edit_index, _, _ = active_index_span(edit)
    live_index, _, _ = active_index_span(live)
    return {
        "schema": "JahiaIndexSnapshot.v1",
        "capturedAt": datetime.now(timezone.utc).isoformat(),
        "target": {"origin": TARGET_ORIGIN, "path": BLOCK_PATH},
        "edit": {"html": edit, "sha256": sha256(edit), "indexName": edit_index},
        "live": {"html": live, "sha256": sha256(live), "indexName": live_index},
    }


def build_mutation_plan(snapshot: dict, expected_from: str, required_to: str) -> dict:
    if required_to != REQUIRED_INDEX:
        raise RuntimeError(f"The only permitted destination index is {REQUIRED_INDEX}")
    edit = snapshot["edit"]
    live = snapshot["live"]
    if edit["sha256"] != live["sha256"] or edit["html"] != live["html"]:
        raise RuntimeError("EDIT and LIVE block HTML must be identical before index correction")
    if edit["indexName"] == required_to:
        return {
            "schema": "JahiaIndexMutationPlan.v1",
            "operation": "noop",
            "target": snapshot["target"],
            "requiredIndex": required_to,
            "before": {"editSha256": edit["sha256"], "liveSha256": live["sha256"], "indexName": edit["indexName"]},
            "diff": None,
            "rollback": None,
        }
    if edit["indexName"] != expected_from:
        raise RuntimeError(f"Refusing unexpected active index {edit['indexName']}")
    updated, diff = replace_active_index(edit["html"], required_to)
    return {
        "schema": "JahiaIndexMutationPlan.v1",
        "operation": "replace-one-index-attribute",
        "target": snapshot["target"],
        "requiredIndex": required_to,
        "before": {"editSha256": edit["sha256"], "liveSha256": live["sha256"], "indexName": edit["indexName"]},
        "after": {"expectedSha256": sha256(updated), "indexName": required_to},
        "diff": diff,
        "publish": {"path": BLOCK_PATH, "subtree": False},
        "rollback": {"snapshot": "before-snapshot.json", "requiredCurrentHashes": [sha256(updated)]},
    }


def public_identity() -> dict:
    query = urlencode({"stability_index_readback": datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")})
    url = f"{TARGET_ORIGIN}/?{query}"
    html = jahia.fetch_public_bytes(url, user_agent="algolia-stability-index-readback/1").decode("utf-8", errors="replace")
    index, _, _ = active_index_span(html)
    return {"url": url.split("?", 1)[0], "htmlSha256": sha256(html), "indexName": index}


def validate_after(snapshot: dict, expected_html: str) -> dict:
    public = public_identity()
    checks = {
        "editExact": snapshot["edit"]["html"] == expected_html,
        "liveExact": snapshot["live"]["html"] == expected_html,
        "editVanilla": snapshot["edit"]["indexName"] == REQUIRED_INDEX,
        "liveVanilla": snapshot["live"]["indexName"] == REQUIRED_INDEX,
        "publicVanilla": public["indexName"] == REQUIRED_INDEX,
    }
    return {"pass": all(checks.values()), "checks": checks, "public": public}


def wait_for_exact_edit(expected_html: str, attempts: int = 12, delay: float = 0.5) -> dict:
    for attempt in range(attempts):
        snapshot = capture_authenticated_snapshot()
        if snapshot["edit"]["html"] == expected_html:
            return snapshot
        if attempt + 1 < attempts:
            time.sleep(delay)
    raise RuntimeError("Jahia acknowledged setValue but exact EDIT readback never appeared; publish was not attempted")


def wait_for_exact_publication(expected_html: str, attempts: int = 12, delay: float = 1.0) -> tuple[dict, dict]:
    latest_snapshot = None
    latest_validation = None
    for attempt in range(attempts):
        latest_snapshot = capture_authenticated_snapshot()
        latest_validation = validate_after(latest_snapshot, expected_html)
        if latest_validation["pass"]:
            return latest_snapshot, latest_validation
        if attempt + 1 < attempts:
            time.sleep(delay)
    assert latest_snapshot is not None and latest_validation is not None
    return latest_snapshot, latest_validation


def dry_run(evidence_dir: Path, expected_from: str, required_to: str) -> dict:
    snapshot = capture_authenticated_snapshot()
    plan = build_mutation_plan(snapshot, expected_from, required_to)
    write_private(evidence_dir / "before-snapshot.json", snapshot)
    write_private(evidence_dir / "mutation-plan.json", plan)
    return {
        "mode": "dry-run",
        "pass": True,
        "operation": plan["operation"],
        "activeIndex": snapshot["edit"]["indexName"],
        "requiredIndex": required_to,
        "beforeSha256": snapshot["edit"]["sha256"],
        "expectedAfterSha256": plan.get("after", {}).get("expectedSha256"),
        "evidenceDir": str(evidence_dir),
        "mutationApplied": False,
    }


def apply(evidence_dir: Path) -> dict:
    before_path = evidence_dir / "before-snapshot.json"
    plan_path = evidence_dir / "mutation-plan.json"
    if not before_path.exists() or not plan_path.exists():
        raise RuntimeError("Apply requires a reviewed dry-run snapshot and mutation plan in the same evidence directory")
    before = read_private(before_path)
    plan = read_private(plan_path)
    current = capture_authenticated_snapshot()
    if current["edit"]["sha256"] != plan["before"]["editSha256"] or current["live"]["sha256"] != plan["before"]["liveSha256"]:
        raise RuntimeError("EDIT or LIVE drifted after dry-run; refusing apply")
    if plan["operation"] == "noop":
        validation = validate_after(current, before["edit"]["html"])
        result = {"mode": "apply", "operation": "noop", "mutationApplied": False, "validation": validation}
        write_private(evidence_dir / "mutation-result.json", result)
        return result
    expected_html, diff = replace_active_index(before["edit"]["html"], REQUIRED_INDEX)
    if sha256(expected_html) != plan["after"]["expectedSha256"] or diff != plan["diff"]:
        raise RuntimeError("Reviewed mutation plan does not match the current implementation")
    mutations = {"setBlockHtml": jahia.set_block_html(expected_html)}
    write_private(evidence_dir / "mutation-progress.json", {"stage": "setBlockHtml", "mutations": mutations}, replace=True)
    edit_readback = wait_for_exact_edit(expected_html)
    mutations["exactEditReadback"] = {
        "sha256": edit_readback["edit"]["sha256"],
        "indexName": edit_readback["edit"]["indexName"],
    }
    mutations["createVersion"] = jahia.version_block()
    mutations["publishBlock"] = jahia.publish(BLOCK_PATH, subtree=False)
    write_private(evidence_dir / "mutation-progress.json", {"stage": "published", "mutations": mutations}, replace=True)
    after, validation = wait_for_exact_publication(expected_html)
    private_after = {**after, "validation": validation}
    write_private(evidence_dir / "after-snapshot.json", private_after)
    result = {
        "mode": "apply",
        "operation": plan["operation"],
        "mutationApplied": True,
        "mutations": mutations,
        "afterSha256": after["edit"]["sha256"],
        "validation": validation,
    }
    write_private(evidence_dir / "mutation-result.json", result)
    if not validation["pass"]:
        raise RuntimeError("Index mutation readback failed; no automatic rollback was attempted")
    return result


def rollback(evidence_dir: Path) -> dict:
    before = read_private(evidence_dir / "before-snapshot.json")
    plan = read_private(evidence_dir / "mutation-plan.json")
    if plan["operation"] == "noop":
        raise RuntimeError("No rollback exists for an already-Vanilla no-op")
    current = capture_authenticated_snapshot()
    required_hash = plan["after"]["expectedSha256"]
    if current["edit"]["sha256"] != required_hash or current["live"]["sha256"] != required_hash:
        raise RuntimeError("Current EDIT or LIVE has drifted; refusing rollback")
    prior_html = before["edit"]["html"]
    mutations = {
        "setBlockHtml": jahia.set_block_html(prior_html),
        "createVersion": jahia.version_block(),
        "publishBlock": jahia.publish(BLOCK_PATH, subtree=False),
    }
    after = capture_authenticated_snapshot()
    checks = {
        "editRestored": after["edit"]["sha256"] == before["edit"]["sha256"],
        "liveRestored": after["live"]["sha256"] == before["live"]["sha256"],
        "indexRestored": after["edit"]["indexName"] == before["edit"]["indexName"],
    }
    result = {"mode": "rollback", "pass": all(checks.values()), "checks": checks, "mutations": mutations}
    write_private(evidence_dir / "rollback-result.json", result)
    if not result["pass"]:
        raise RuntimeError("Rollback readback failed")
    return result


def recover_publication(evidence_dir: Path) -> dict:
    before = read_private(evidence_dir / "before-snapshot.json")
    plan = read_private(evidence_dir / "mutation-plan.json")
    if plan["operation"] != "replace-one-index-attribute":
        raise RuntimeError("Publication recovery requires a reviewed replace-one-index-attribute plan")
    expected_html, diff = replace_active_index(before["edit"]["html"], REQUIRED_INDEX)
    if sha256(expected_html) != plan["after"]["expectedSha256"] or diff != plan["diff"]:
        raise RuntimeError("Reviewed recovery payload does not match the current implementation")
    current = capture_authenticated_snapshot()
    expected_hash = plan["after"]["expectedSha256"]
    original_hash = plan["before"]["liveSha256"]
    if current["edit"]["sha256"] != expected_hash:
        raise RuntimeError("Recovery requires EDIT to match the reviewed Vanilla payload exactly")
    if current["live"]["sha256"] not in {original_hash, expected_hash}:
        raise RuntimeError("LIVE drifted outside the reviewed before/after hashes; refusing recovery")
    mutations = {}
    if current["live"]["sha256"] != expected_hash:
        mutations["createVersion"] = jahia.version_block()
        mutations["publishDriftSubtree"] = jahia.publish(DRIFT_PATH, subtree=True)
        mutations["publishBlock"] = jahia.publish(BLOCK_PATH, subtree=True)
    after, validation = wait_for_exact_publication(expected_html)
    result = {
        "mode": "recover-publication",
        "mutationApplied": bool(mutations),
        "mutations": mutations,
        "validation": validation,
        "afterSha256": after["edit"]["sha256"],
    }
    write_private(evidence_dir / "publication-recovery-result.json", result, replace=True)
    if not validation["pass"]:
        raise RuntimeError("Publication recovery readback failed")
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--evidence-dir", required=True)
    parser.add_argument("--expected-from", default=EXPECTED_STALE)
    parser.add_argument("--required-to", default=REQUIRED_INDEX)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--apply", action="store_true")
    mode.add_argument("--rollback", action="store_true")
    mode.add_argument("--recover-publication", action="store_true")
    args = parser.parse_args()
    evidence_dir = safe_evidence_dir(args.evidence_dir)
    if args.required_to != REQUIRED_INDEX:
        parser.error(f"--required-to must be {REQUIRED_INDEX}")
    if args.recover_publication:
        result = recover_publication(evidence_dir)
    elif args.rollback:
        result = rollback(evidence_dir)
    elif args.apply:
        result = apply(evidence_dir)
    else:
        result = dry_run(evidence_dir, args.expected_from, args.required_to)
    print(json.dumps(result, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(json.dumps({"pass": False, "error": str(error)}, ensure_ascii=False), file=sys.stderr)
        raise SystemExit(1)
