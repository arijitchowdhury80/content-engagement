#!/usr/bin/env python3
"""
Fetch router — turns 12,035 differently-shaped records into ONE input shape.

WHY THIS EXISTS
  The corpus is not uniform: 8 sources, 43 page_type values, 3 languages, and four completely
  different ways of getting the text. Arijit, 2026-08-07: "there is still an open question on how
  we are standardizing across records of all shapes and sizes where the data structure is not the
  same."

  The answer is that variation is confined to exactly TWO places in the whole pipeline:
    1. this router  -- four fetch paths, one output shape
    2. the family instruction block in the prompt -- 43 page_types collapse to 7 families
  Everything downstream (prompt contract, gates, provenance, field names) is invariant. A
  record's shape cannot produce a differently-shaped result.

THE FOUR PATHS, and why each is needed rather than just using Scout for everything
  doc-md-twin  4,337  Every /doc/* page serves authored markdown at <path>.md. Verified 5/5 on
                      live pages. Higher fidelity than HTML->markdown conversion, costs no Scout
                      credit, and needs no browser. Boundary tested: .md twins exist ONLY under
                      English /doc/*  --  /blog/*.md, /pricing.md, /fr/events.md all 404.
  scout        5,861  Hosted Scout on the VPS. Async job + poll. 1 credit each.
  zendesk-api  1,695  support.algolia.com returns 403 to a plain fetch (Zendesk bot wall) but has
                      a keyless Help Center API. No crawl needed.
  auth-wall      142  academy.algolia.com redirects to dashboard.algolia.com sign-in. Not
                      fetchable anonymously. Reported honestly, never faked.

  python3 fetch_router.py --verify-families      # mapping still matches the live index
  python3 fetch_router.py --build-queue          # write work-queue.jsonl (read-only vs Algolia)
  python3 fetch_router.py --fetch-pilot 30       # fetch the stratified pilot set to cache/

TLS: curl via subprocess throughout. Python's certifi cannot reach these APIs from this machine.
"""

from __future__ import annotations

import argparse
import collections
import datetime as dt
import hashlib
import json
import pathlib
import re
import subprocess
import sys
import time
from urllib.parse import urlparse

HERE = pathlib.Path(__file__).parent
sys.path.insert(0, str(HERE))
from snapshot_enhanced import browse_all, load_credentials  # noqa: E402

FAMILIES_PATH = HERE / "prompts" / "shape-families.json"
QUEUE_PATH = HERE / "work-queue.jsonl"
CACHE_DIR = HERE / "cache"
DEFAULT_INDEX = "Algolia_Prod_Copy_Enhanced"
SITE = "https://www.algolia.com"

# Size policy. The commercial family runs to 278,634 characters, which would blow the context
# window and dominate cost. Keep both ends: the thesis is near the top, the numbers (pricing,
# limits, metrics) are near the bottom, and a head-only cut loses exactly what highlights are
# made of.
# NO TRUNCATION of real pages. Arijit, 2026-08-08: "all pages should be obtained in full...
# we cannot work with incomplete data."
#
# The 60,000-char cap existed only because the writer was `claude -p` at ~$0.16/record, where a
# 278,000-char page was expensive. GLM on Algolia's own inference server is free, so the reason is
# gone. Measured on 60 fetched pages: median 7,518 chars, p90 25,230, max 146,787. Only 4 exceeded
# 60,000 and 3 of those were Academy JS shells that return DEAD anyway -- but the 4th was a real
# doc page, /doc/rest-api/search/set-settings, and the cap silently discarded 21,887 characters
# of it.
#
# The cap is kept ONLY as a last-resort guard against a pathological page exhausting model
# context. Set far above anything observed. If it ever fires, `enrichment_truncated` records it
# so the record is visible and re-processable rather than silently half-read.
MAX_CHARS = 400_000
HEAD_CHARS = 300_000
TAIL_CHARS = 100_000
TRUNCATION_MARKER = "\n\n[... text removed by the enrichment pipeline ...]\n\n"

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")

SCOUT_BASE = "https://scout.chowmes.com"
ZENDESK_ARTICLE = re.compile(r"/articles/(\d+)")


# ---------------------------------------------------------------------------
# credentials
# ---------------------------------------------------------------------------

def scout_key() -> str:
    """SCOUT_HOSTED_API_KEY from the project's .env.local (a symlink into commons)."""
    env = HERE.parents[1] / ".env.local"
    if env.exists():
        for line in env.read_text().splitlines():
            if line.startswith("SCOUT_HOSTED_API_KEY="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    sys.exit("FATAL: SCOUT_HOSTED_API_KEY not found in .env.local")


# ---------------------------------------------------------------------------
# classification: url -> absolute url, fetch path, family
# ---------------------------------------------------------------------------

def absolute_url(url: str) -> str:
    """84.2% of records carry a relative path, not a URL. Locale is already in the path
    (/de/..., /fr/...) so one rule covers all three languages. objectID also holds an absolute
    URL on /doc records but 199 of those carry a `-0` chunk suffix, so `url` is the better source.
    """
    if not isinstance(url, str) or not url:
        return ""
    return url if url.startswith(("http://", "https://")) else SITE + url


def fetch_path_for(url: str) -> str:
    absolute = absolute_url(url)
    host = urlparse(absolute).netloc
    if host == "support.algolia.com":
        # EXCLUDED by Arijit, 2026-08-07. Support articles are authored by the technical support
        # team -- definitive answers we do not get to reword. Measured: the whole article is
        # 202-604 characters of prose and the index already stores ~450 of it, so fetching bought
        # 85 characters. Extraction has nothing to add and generation would put OUR words on a
        # support ruling. 1,695 records left exactly as they are.
        # This also retires the Zendesk Help Center API path, which was an external call made
        # without approval.
        return "excluded-support"
    if host == "academy.algolia.com":
        return "auth-wall"
    if host == "job-boards.greenhouse.io":
        return "excluded"          # deleted 2026-08-07; here so a stray record is not enriched
    path = urlparse(absolute).path
    if host in ("www.algolia.com", "algolia.com") and path.startswith("/doc"):
        return "doc-md-twin"
    return "scout"


def load_families() -> tuple[dict[str, str], dict[str, dict]]:
    spec = json.loads(FAMILIES_PATH.read_text())["families"]
    page_type_to_family: dict[str, str] = {}
    for family, body in spec.items():
        for page_type in body["page_types"]:
            page_type_to_family[page_type] = family
    return page_type_to_family, spec


# ---------------------------------------------------------------------------
# the four fetchers. Each returns the SAME dict shape or raises FetchFailed.
# ---------------------------------------------------------------------------

class FetchFailed(Exception):
    def __init__(self, reason: str, status: int = 0):
        super().__init__(reason)
        self.reason = reason
        self.status = status


def _curl(url: str, timeout: int = 60) -> tuple[int, str]:
    proc = subprocess.run(
        ["curl", "-s", "-L", "-A", UA, "--max-time", str(timeout),
         "-w", "\n%{http_code}", url],
        capture_output=True, text=True,
    )
    body, _, code = proc.stdout.rpartition("\n")
    try:
        return int(code.strip()), body
    except ValueError:
        raise FetchFailed(f"curl gave no status code: {proc.stderr[:120]}")


def fetch_doc_md_twin(absolute: str) -> tuple[str, int]:
    """GET <url>.md — authored markdown, no browser, no credit."""
    status, body = _curl(absolute.rstrip("/") + ".md")
    if status != 200 or not body.strip():
        raise FetchFailed(f"md twin returned {status}", status)
    return body, status


def fetch_zendesk(absolute: str) -> tuple[str, int]:
    """Zendesk Help Center API. Keyless, official, returns the article body as HTML.

    support.algolia.com 403s a plain page fetch (bot wall) but the API answers fine.
    """
    match = ZENDESK_ARTICLE.search(absolute)
    if not match:
        raise FetchFailed("no Zendesk article id in URL")
    api = f"https://support.algolia.com/api/v2/help_center/articles/{match.group(1)}.json"
    status, body = _curl(api)
    if status != 200:
        raise FetchFailed(f"zendesk api returned {status}", status)
    try:
        article = json.loads(body)["article"]
    except (json.JSONDecodeError, KeyError):
        raise FetchFailed("zendesk api payload not an article")
    html = article.get("body") or ""
    title = article.get("title") or ""
    # Minimal HTML -> text. span_gate.canonicalise strips residual tags, and we must NOT
    # pre-clean aggressively: the gate slices from exactly the bytes the model saw.
    text = re.sub(r"<br\s*/?>", "\n", html)
    text = re.sub(r"</(p|div|li|h[1-6])>", "\n\n", text)
    return f"# {title}\n\n{text}", status


def fetch_scout(absolute: str, key: str, poll_seconds: int = 90) -> tuple[str, int]:
    """Hosted Scout on the VPS. Async: POST returns a job id, then poll."""
    body = json.dumps({"url": absolute, "formats": ["markdown"]})
    proc = subprocess.run(
        ["curl", "-s", "--max-time", "60", "-X", "POST", f"{SCOUT_BASE}/v1/hosted/scrape",
         "-H", "Content-Type: application/json", "-H", f"Authorization: Bearer {key}",
         "-d", body],
        capture_output=True, text=True,
    )
    try:
        job = json.loads(proc.stdout)["job_id"]
    except (json.JSONDecodeError, KeyError):
        raise FetchFailed(f"scout did not queue a job: {proc.stdout[:160]}")

    deadline = time.time() + poll_seconds
    while time.time() < deadline:
        time.sleep(6)
        poll = subprocess.run(
            ["curl", "-s", "--max-time", "30", f"{SCOUT_BASE}/v1/hosted/jobs/{job}",
             "-H", f"Authorization: Bearer {key}"],
            capture_output=True, text=True,
        )
        try:
            data = json.loads(poll.stdout)
        except json.JSONDecodeError:
            continue
        if data.get("status") in ("complete", "succeeded"):
            scrape = (data.get("result") or {}).get("scrape") or {}
            markdown = scrape.get("markdown") or ""
            status = int(scrape.get("status_code") or 0)
            if not markdown.strip():
                raise FetchFailed(f"scout returned empty markdown (http {status})", status)
            return markdown, status
        if data.get("status") in ("failed", "error"):
            raise FetchFailed(f"scout job failed: {str(data)[:160]}")
    raise FetchFailed(f"scout job {job} did not finish in {poll_seconds}s")


def fetch_auth_wall(absolute: str) -> tuple[str, int]:
    """Academy. Attempt anyway and report what comes back, so the block is evidenced rather
    than assumed. The sign-in page IS the evidence, and the LLM will verdict it LOGIN_REQUIRED."""
    status, body = _curl(absolute)
    if not body.strip():
        raise FetchFailed(f"auth wall returned {status} with no body", status)
    return body, status


# ---------------------------------------------------------------------------
# one entry point, one shape out
# ---------------------------------------------------------------------------

def truncate(markdown: str) -> tuple[str, bool, int]:
    original = len(markdown)
    if original <= MAX_CHARS:
        return markdown, False, original
    return markdown[:HEAD_CHARS] + TRUNCATION_MARKER + markdown[-TAIL_CHARS:], True, original


def fetch(record: dict, key: str | None = None) -> dict:
    """THE standard shape. Every path returns exactly this; nothing downstream knows which ran."""
    absolute = absolute_url(record.get("url", ""))
    path = fetch_path_for(record.get("url", ""))
    out = {
        "objectID": record["objectID"],
        "url": record.get("url"),
        "source_url": absolute,
        "fetch_path": path,
        "fetched_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "markdown": "",
        "content_hash": "",
        "http_status": 0,
        "truncated": False,
        "original_length": 0,
        "fetch_error": "",
    }
    try:
        if path == "doc-md-twin":
            markdown, status = fetch_doc_md_twin(absolute)
        elif path == "zendesk-api":
            markdown, status = fetch_zendesk(absolute)
        elif path == "auth-wall":
            markdown, status = fetch_auth_wall(absolute)
        elif path == "scout":
            markdown, status = fetch_scout(absolute, key or scout_key())
        else:
            raise FetchFailed(f"fetch path {path!r} is not enrichable")
    except FetchFailed as exc:
        out["fetch_error"] = exc.reason
        out["http_status"] = exc.status
        return out

    markdown, truncated, original = truncate(markdown)
    out.update({
        "markdown": markdown,
        # Hash the TRUNCATED text -- it is what the model sees and what the gate slices from.
        "content_hash": hashlib.sha256(markdown.encode("utf-8")).hexdigest(),
        "http_status": status,
        "truncated": truncated,
        "original_length": original,
    })
    return out


# ---------------------------------------------------------------------------
# queue building and the pilot sample
# ---------------------------------------------------------------------------

def build_queue(index: str) -> list[dict]:
    app, key = load_credentials()
    page_type_to_family, _ = load_families()
    queue: list[dict] = []
    unmapped: collections.Counter = collections.Counter()
    for rec in browse_all(app, key, index):
        page_type = rec.get("page_type") or ""
        family = page_type_to_family.get(page_type)
        if family is None:
            unmapped[page_type] += 1
            continue
        queue.append({
            "objectID": rec["objectID"],
            "url": rec.get("url"),
            "source_url": absolute_url(rec.get("url", "")),
            "page_type": page_type,
            "family": family,
            "fetch_path": fetch_path_for(rec.get("url", "")),
            "language_code": rec.get("language_code"),
            "source": rec.get("source"),
            "title": rec.get("title") or "",
            "description": rec.get("description") or "",
            "is404": rec.get("is404"),
        })
    if unmapped:
        sys.exit(f"FATAL: page_type values not in shape-families.json: {dict(unmapped)}\n"
                 f"Every record must map to a family. Add them, do not skip records.")
    return queue


def pilot_sample(queue: list[dict], size: int) -> list[dict]:
    """Stratified, and deliberately loaded with the cases most likely to BREAK the pipeline
    rather than the ones most likely to pass. A pilot of easy pages proves nothing."""
    picked: list[dict] = []
    seen: set[str] = set()

    def take(pred, n, why):
        added = 0
        for item in queue:
            if added >= n:
                break
            if item["objectID"] in seen or not pred(item):
                continue
            seen.add(item["objectID"])
            picked.append({**item, "pilot_reason": why})
            added += 1

    longest = max(queue, key=lambda q: len(q.get("source_url", "")) if "competitors" in (q.get("url") or "") else 0)
    take(lambda q: q["objectID"] == longest["objectID"], 1, "largest page in corpus (competitor, 278k chars)")
    take(lambda q: q["family"] == "hub", 2, "hub page — expect THIN, the slop trap")
    take(lambda q: q["fetch_path"] == "auth-wall", 2, "Academy — expect DEAD/LOGIN_REQUIRED")
    take(lambda q: q.get("is404") is True, 2, "flagged is404:true but verified alive")
    take(lambda q: q["page_type"] == "doc-rest-api", 2, "terse reference, median 117 chars prose")
    take(lambda q: q["fetch_path"] == "zendesk-api", 3, "Zendesk API path")
    take(lambda q: q["language_code"] == "de", 2, "German — locale leakage check")
    take(lambda q: q["language_code"] == "fr", 2, "French — locale leakage check")
    take(lambda q: q["family"] == "evidence", 2, "customer story — metrics must keep their units")
    take(lambda q: q["family"] == "commercial", 2, "highest-risk family, written to persuade")
    take(lambda q: q["family"] == "corporate", 1, "thin, boilerplate-heavy")
    for family in ("reference", "instructional", "editorial"):
        take(lambda q, f=family: q["family"] == f and q["language_code"] == "en", 3,
             f"{family}, mainstream case")
    take(lambda q: True, max(0, size - len(picked)), "filler, mainstream")
    return picked[:size]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--index", default=DEFAULT_INDEX)
    ap.add_argument("--verify-families", action="store_true")
    ap.add_argument("--build-queue", action="store_true")
    ap.add_argument("--fetch-pilot", type=int, metavar="N")
    ap.add_argument("--exclude", default="", metavar="MANIFEST",
                    help="skip objectIDs already present in this manifest (second capture)")
    ap.add_argument("--out", default=str(CACHE_DIR))
    args = ap.parse_args()

    if args.verify_families:
        app, key = load_credentials()
        page_type_to_family, spec = load_families()
        live = collections.Counter(
            (rec.get("page_type") or "<none>") for rec in browse_all(app, key, args.index)
        )
        missing = [pt for pt in live if pt not in page_type_to_family]
        total = sum(live.values())
        print(f"live records          : {total}")
        print(f"live page_type values : {len(live)}")
        print(f"mapped page_types     : {len(page_type_to_family)}")
        print(f"unmapped in index     : {missing or 'none'}")
        mapped_total = 0
        for family, body in spec.items():
            got = sum(live[pt] for pt in body["page_types"])
            mapped_total += got
            flag = "OK" if got == body.get("record_count") else f"was {body.get('record_count')}"
            print(f"  {family:14s} {got:6d}  {flag}")
        print(f"sum {mapped_total} vs live {total}: {'OK' if mapped_total == total else 'MISMATCH'}")
        return 0 if not missing else 1

    if args.build_queue:
        queue = build_queue(args.index)
        with QUEUE_PATH.open("w", encoding="utf-8") as fh:
            for item in queue:
                fh.write(json.dumps(item, ensure_ascii=False) + "\n")
        paths = collections.Counter(q["fetch_path"] for q in queue)
        fams = collections.Counter(q["family"] for q in queue)
        langs = collections.Counter(q["language_code"] for q in queue)
        print(f"queue written: {QUEUE_PATH}  ({len(queue)} records)")
        print(f"fetch paths : {dict(paths)}")
        print(f"families    : {dict(fams)}")
        print(f"languages   : {dict(langs)}")
        scout_needed = paths.get("scout", 0)
        print(f"\nScout credits needed: {scout_needed}  (other {len(queue) - scout_needed} cost none)")
        return 0

    if args.fetch_pilot:
        if not QUEUE_PATH.exists():
            sys.exit("FATAL: run --build-queue first")
        queue = [json.loads(line) for line in QUEUE_PATH.open()]
        if args.exclude:
            seen = {r["objectID"] for r in json.loads(pathlib.Path(args.exclude).read_text())}
            before = len(queue)
            queue = [q for q in queue if q["objectID"] not in seen]
            print(f"excluding {before - len(queue)} records already in {args.exclude}")
        sample = pilot_sample(queue, args.fetch_pilot)
        out_dir = pathlib.Path(args.out)
        out_dir.mkdir(parents=True, exist_ok=True)
        key = scout_key()
        results = []
        print(f"fetching {len(sample)} pilot records\n")
        for n, item in enumerate(sample, 1):
            got = fetch(item, key)
            got.update({k: item[k] for k in
                        ("page_type", "family", "language_code", "source", "title",
                         "description", "pilot_reason")})
            results.append(got)
            state = got["fetch_error"] or f"{len(got['markdown'])} chars"
            print(f"  {n:2d}/{len(sample)}  {got['fetch_path']:12s} {state:28s} {got['source_url'][:64]}")
            (out_dir / f"{got['objectID'].replace('/', '_')[:120]}.json").write_text(
                json.dumps(got, ensure_ascii=False, indent=1))
        manifest = out_dir / "pilot-manifest.json"
        manifest.write_text(json.dumps(results, ensure_ascii=False, indent=1))
        ok = [r for r in results if not r["fetch_error"]]
        print(f"\nfetched OK : {len(ok)}/{len(results)}")
        print(f"failed     : {[(r['fetch_path'], r['fetch_error']) for r in results if r['fetch_error']]}")
        print(f"truncated  : {sum(1 for r in ok if r['truncated'])}")
        print(f"manifest   : {manifest}")
        return 0

    ap.print_help()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
