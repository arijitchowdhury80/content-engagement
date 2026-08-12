#!/usr/bin/env python3
"""
shape_probe — 10 `/doc` pages fetched through Scout, described structurally. No scores, no gate.

WHY THIS EXISTS
  Scout has never fetched a single `/doc` page. Measured 2026-08-09: 85 Scout bodies are cached and
  none of them is `/doc`. Two of the five pipeline fixes (C: the positional `[QUOTED]` label,
  D: the `[ALREADY INDEXED]` byte match) were tuned to the shape of the `doc-md-twin` markdown, and
  on those 85 Scout pages they fire on 11% and 1% respectively instead of 99.6% and 100%.

  So before spending 150 credits measuring a pass rate, spend 10 finding out whether the pipeline is
  even looking at the same kind of document. A calibration number produced before this question is
  answered would be a number about the wrong thing.

WHAT MAKES THIS BOUNDED, and why it is not `--force-scout`
  `fetch_router.fetch_path_for()` is NOT touched, and NOT called. This script holds a hardcoded
  ten-URL allowlist and calls `fetch_router.fetch_scout()` directly. There is therefore no route
  override to leak into production, nothing to forget to turn off, and no way for an eleventh URL to
  be fetched -- the allowlist is the instrument's whole extent. Codex, 2026-08-09: "treat the probe
  override as a disposable, bounded Phase 1 instrument."

  A `.md` fallback is structurally impossible here, not merely absent: `fetch_doc_md_twin` is never
  imported.

FAILURES ARE KEPT
  A page Scout cannot fetch is written to `cache-scout/shape-probe-10/quarantine/` with its error
  and excluded from the analysis. Never deleted. Deleting void output already cost this project the
  cal200 sample -- see QUARANTINE.md.

  python3 shape_probe.py --plan          # what would be fetched. No network, no credits.
  python3 shape_probe.py --run           # fetch 10 pages via Scout (10 credits), then report
  python3 shape_probe.py --report        # re-report from cache. No network.
"""

from __future__ import annotations

import argparse
import collections
import datetime as dt
import hashlib
import json
import pathlib
import re
import sys

HERE = pathlib.Path(__file__).parent
sys.path.insert(0, str(HERE))

import candidates as C                                                        # noqa: E402
from assert_scout_provenance import ProvenanceViolation, assert_scout_provenance  # noqa: E402
from fetch_router import FetchFailed, absolute_url, fetch_scout, scout_key, truncate  # noqa: E402

QUEUE_PATH = HERE / "work-queue.jsonl"
PROBE_DIR = HERE / "cache-scout" / "shape-probe-10"
QUARANTINE_DIR = PROBE_DIR / "quarantine"
TWIN_ROOT = HERE / "cache-batches"

# Findings go to reports/, NOT into the cache. The cache directory holds page bodies and nothing
# else, so "every file in here is a Scout-sourced body" stays literally true and the provenance
# asserter needs no growing list of filenames to ignore. The first run of this probe wrote its
# findings next to the bodies and the asserter correctly failed the whole directory -- exactly the
# behaviour wanted, on exactly the wrong file.
FINDINGS_PATH = HERE / "reports" / "SCOUT-PROBE-10-findings.json"

# THE ALLOWLIST. Ten `/doc` URLs, every one of them also in the 50-record diagnostic batch
# `doc-md-twin-reference-001`, so each Scout body can be diffed against a twin body of the same
# page. Verified 2026-08-09: 10 of 10 present in work-queue.jsonl, 10 of 10 have a cached twin.
# Three shapes, deliberately: endpoint, service-overview, guide-like.
ALLOWLIST: tuple[str, ...] = (
    "/doc/rest-api/search",                      # service overview
    "/doc/rest-api/abtesting",                   # service overview
    "/doc/rest-api/crawler",                     # service overview
    "/doc/rest-api/search/set-settings",         # endpoint — the page the old 60k cap truncated
    "/doc/rest-api/search/save-object",          # endpoint
    "/doc/rest-api/search/search-synonyms",      # endpoint
    "/doc/tools/cli/authentication",             # guide-like
    "/doc/tools/cli/commands",                   # guide-like
    "/doc/libraries/sdk",                        # guide-like
    "/doc/api-reference/search-api-parameters",  # reference index
)

# Site chrome that a rendered-HTML scrape can pick up and an authored `.md` twin cannot. Presence is
# reported per page; it is not filtered out, because the point is to see what Scout hands over.
CHROME_MARKERS: tuple[tuple[str, re.Pattern], ...] = (
    ("skip-link",   re.compile(r"skip to (main )?content", re.I)),
    ("cookie",      re.compile(r"cookie (policy|settings|preferences)|accept all cookies", re.I)),
    ("legal",       re.compile(r"©\s*\d{4}|all rights reserved|privacy policy|terms of service", re.I)),
    ("signup-cta",  re.compile(r"\b(start free|sign up for free|get started for free|book a demo)\b", re.I)),
    ("nav-crumbs",  re.compile(r"^\s*\[?(Home|Documentation|Docs)\]?\s*[/>›»]", re.M)),
    ("doc-index",   re.compile(r">\s*##\s*Documentation Index", re.I)),
    ("social",      re.compile(r"\b(Follow us|LinkedIn|Twitter|YouTube|Discord)\b.*\b(LinkedIn|Twitter|YouTube|Discord)\b")),
)

NEAR_DUP_BAR = 0.70   # max(Jaccard, containment). See the dedup-paraphrase lesson: Jaccard alone
                      # misses a long candidate that wholly contains a short description.


# ---------------------------------------------------------------------------
# text measures
# ---------------------------------------------------------------------------

def _tokens(text: str) -> set[str]:
    return set(re.findall(r"[\w']+", (text or "").lower()))


def overlap(a: str, b: str) -> float:
    """max(Jaccard, containment). Containment is what catches "the candidate IS the description,
    plus a trailing clause" -- Jaccard scores that pair down for length alone and lets it through."""
    ta, tb = _tokens(a), _tokens(b)
    if not ta or not tb:
        return 0.0
    inter = len(ta & tb)
    return max(inter / len(ta | tb), inter / min(len(ta), len(tb)))


_FENCE = re.compile(r"^```.*?^```", re.M | re.S)


def strip_code_blocks(markdown: str) -> str:
    """Fenced code removed. Required before ANY markdown shape test on this corpus.

    Measured on the first probe run, and it inverted the headline: a naive `^# ` search reported
    an H1 on 3 of 10 Scout pages. All three were Python and C# comments inside fenced examples --
    `# Initialize the client`, `# Call the API`. The real count is 0 of 10. A `/doc` page is mostly
    code, so a shape test that reads code as prose is measuring the sample, not the page.
    """
    return _FENCE.sub("", markdown or "")


def first_h1(markdown: str) -> str:
    m = re.search(r"^#\s+(.+?)\s*$", strip_code_blocks(markdown), re.M)
    return m.group(1).strip() if m else ""


# Site-wide furniture, verbatim. Not a heuristic: this is the exact sentence the `> ## Documentation
# Index` block carries, and the question is only whether it reaches the candidate pool.
FURNITURE_MARKER = "use this file to discover all available pages"

# A code comment that the splitter accepted as prose. Measured on probe 1: 6 on Scout, 3 on the
# twin, including `// The client can fail to initialize if you pass an invalid parameter.` counted
# twice on one page. Small, real, and it inflates any "useful facts" count that ignores it.
CODE_COMMENT = re.compile(r"^\s*(//|#\s|/\*|\*\s|--\s)")


def describe_body(markdown: str, title: str, description: str) -> dict:
    """Every structural fact Codex asked for, for one body. No pass/fail, no score."""
    cands, _canon = C.split_candidates(markdown, already_indexed=description or None)
    kinds = collections.Counter(c.kind for c in cands)

    exact_desc = [c for c in cands if c.is_already_indexed]
    near_desc, best_desc = [], 0.0
    for c in cands:
        score = overlap(c.text, description)
        best_desc = max(best_desc, score)
        if score >= NEAR_DUP_BAR:
            near_desc.append(c)

    # "Useful non-duplicate body facts": prose, long enough to be a candidate at all, and not a
    # restatement of what the record already stores. This is the thing the enrichment is FOR, so it
    # is counted directly rather than inferred from a pass rate.
    useful = [
        c for c in cands
        if c.kind == C.KIND_PROSE
        and len(c.text) >= C.MIN_CHARS
        and not c.is_already_indexed
        and overlap(c.text, description) < NEAR_DUP_BAR
        and overlap(c.text, title) < NEAR_DUP_BAR
    ]

    # The furniture question, asked directly: does the site-wide Documentation Index sentence reach
    # the pool as something the model may pick? `is_page_lede` is fix C's guard, and it can only be
    # set when an H1 exists to be adjacent to.
    furniture = [c for c in cands if FURNITURE_MARKER in c.text.lower()]
    comments = [c for c in useful if CODE_COMMENT.match(c.original or c.text)]
    clean = [c for c in useful if c not in furniture and c not in comments]

    lede = C.page_lede_quote_range(markdown)
    return {
        "chars": len(markdown or ""),
        "prose_chars": len(strip_code_blocks(markdown)),
        "furniture_candidates": len(furniture),
        "code_comment_candidates": len(comments),
        "clean_facts": len(clean),
        "furniture_guarded": all(c.is_page_lede or c.kind != C.KIND_PROSE for c in furniture),
        "has_h1": bool(first_h1(markdown)),
        "h1": first_h1(markdown),
        "blockquote_lines": len(re.findall(r"^\s*>", markdown or "", re.M)),
        "has_any_blockquote": bool(re.search(r"^\s*>", markdown or "", re.M)),
        "h1_adjacent_blockquote": lede is not None,     # fix C's trigger
        "page_lede_text": (markdown[lede[0]:lede[1]][:160] if lede else ""),
        "candidates": len(cands),
        "kinds": dict(kinds),
        "exact_description_dupes": len(exact_desc),     # fix D's trigger
        "near_description_dupes": len(near_desc),
        "best_description_overlap": round(best_desc, 3),
        "useful_nonduplicate_facts": len(useful),
        "useful_examples": [c.text[:140] for c in useful[:3]],
        "chrome": sorted(name for name, rx in CHROME_MARKERS if rx.search(markdown or "")),
    }


# ---------------------------------------------------------------------------
# selection and fetch
# ---------------------------------------------------------------------------

def probe_records() -> list[dict]:
    """The 10 queue records named by the allowlist. Refuses on anything unexpected."""
    if not QUEUE_PATH.exists():
        sys.exit("FATAL: work-queue.jsonl not found. Run fetch_router.py --build-queue first.")
    by_url: dict[str, dict] = {}
    for line in QUEUE_PATH.open(encoding="utf-8"):
        rec = json.loads(line)
        by_url.setdefault(rec["url"], rec)
    picked = []
    for url in ALLOWLIST:
        if url not in by_url:
            sys.exit(f"FATAL: allowlisted URL not in the queue: {url}")
        picked.append(by_url[url])
    if len(picked) != 10:
        sys.exit(f"FATAL: allowlist resolved to {len(picked)} records, expected exactly 10")
    return picked


def twin_bodies(urls: set[str]) -> dict[str, dict]:
    """The cached doc-md-twin body for each URL, for the side-by-side. DIAGNOSTIC ONLY -- it is the
    thing rule 11 bans as evidence, and it appears here purely as the comparison column."""
    out: dict[str, dict] = {}
    for manifest in sorted(TWIN_ROOT.glob("*/pilot-manifest.json")):
        try:
            for rec in json.loads(manifest.read_text(encoding="utf-8")):
                if rec.get("url") in urls and rec.get("fetch_path") == "doc-md-twin" and rec.get("markdown"):
                    out.setdefault(rec["url"], rec)
        except (json.JSONDecodeError, UnicodeDecodeError, OSError):
            continue
    return out


def run_probe() -> int:
    records = probe_records()
    PROBE_DIR.mkdir(parents=True, exist_ok=True)
    QUARANTINE_DIR.mkdir(parents=True, exist_ok=True)
    key = scout_key()

    print(f"Scout shape probe — {len(records)} pages, {len(records)} credits")
    print(f"cache: {PROBE_DIR}\n")
    ok, failed = 0, 0
    for n, item in enumerate(records, 1):
        absolute = absolute_url(item["url"])
        stem = item["objectID"].replace("/", "_")[:120]
        out = {
            "objectID": item["objectID"],
            "url": item["url"],
            "source_url": absolute,
            # Hardcoded, not derived: fetch_path_for() is never consulted, so this label cannot
            # disagree with what actually ran.
            "fetch_path": "scout",
            "fetched_at": dt.datetime.now(dt.timezone.utc).isoformat(),
            "markdown": "", "content_hash": "", "http_status": 0,
            "truncated": False, "original_length": 0, "fetch_error": "",
            "probe": "shape-probe-10",
        }
        out.update({k: item.get(k, "") for k in
                    ("page_type", "family", "language_code", "source", "title", "description")})
        try:
            markdown, status = fetch_scout(absolute, key)
        except FetchFailed as exc:
            out["fetch_error"], out["http_status"] = exc.reason, exc.status
            (QUARANTINE_DIR / f"{stem}.json").write_text(
                json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
            failed += 1
            print(f"  {n:2d}/10  QUARANTINED  {exc.reason[:60]:60s} {item['url']}", flush=True)
            continue

        markdown, truncated, original = truncate(markdown)
        out.update({
            "markdown": markdown,
            "content_hash": hashlib.sha256(markdown.encode("utf-8")).hexdigest(),
            "http_status": status, "truncated": truncated, "original_length": original,
        })
        (PROBE_DIR / f"{stem}.json").write_text(
            json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
        ok += 1
        print(f"  {n:2d}/10  ok  http {status}  {len(markdown):7d} chars  {item['url']}", flush=True)

    print(f"\nfetched OK : {ok}/10")
    print(f"quarantined: {failed} (kept in {QUARANTINE_DIR}, not deleted)")
    return report()


# ---------------------------------------------------------------------------
# report
# ---------------------------------------------------------------------------

def report() -> int:
    records = probe_records()
    expected = {r["objectID"] for r in records}
    quarantined = sorted(p.name for p in QUARANTINE_DIR.glob("*.json")) if QUARANTINE_DIR.exists() else []
    # A quarantined page is legitimately absent from the cache, so the expected set is the fetched
    # set. Stated explicitly rather than silently relaxed: the count is printed either way.
    if quarantined:
        got = {json.loads(p.read_text())["objectID"] for p in PROBE_DIR.glob("*.json")}
        expected &= got

    print("\n" + "=" * 78)
    print("PROVENANCE — asserted before any structural number is printed")
    print("=" * 78)
    try:
        prov = assert_scout_provenance(PROBE_DIR, expected)
    except ProvenanceViolation as exc:
        print(f"FAIL — {len(exc.violations)} violation(s):")
        for v in exc.violations:
            print(f"  {v}")
        print("\nNo structural findings printed. A number from an unproven source is not evidence.")
        return 2
    print(f"PASS — {prov['pages']} bodies, every one fetch_path=scout, http 200, error-free,")
    print(f"       under {PROBE_DIR}, hash-distinct from every cached doc-md-twin body.")

    rows = []
    for path in sorted(PROBE_DIR.glob("*.json")):
        rows.append(json.loads(path.read_text(encoding="utf-8")))
    twins = twin_bodies({r["url"] for r in rows})

    findings = []
    for rec in rows:
        scout = describe_body(rec["markdown"], rec.get("title", ""), rec.get("description", ""))
        twin_rec = twins.get(rec["url"])
        twin = describe_body(twin_rec["markdown"], rec.get("title", ""), rec.get("description", "")) \
            if twin_rec else None
        findings.append({"url": rec["url"], "objectID": rec["objectID"],
                         "http_status": rec["http_status"], "scout": scout, "twin": twin})

    out = {
        "probe": "shape-probe-10",
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "provenance": prov,
        "quarantined": quarantined,
        "pages": findings,
    }
    FINDINGS_PATH.parent.mkdir(parents=True, exist_ok=True)
    FINDINGS_PATH.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")

    print("\n" + "=" * 78)
    print("STRUCTURAL FINDINGS — Scout vs the doc-md-twin of the same page (twin = diagnostic only)")
    print("=" * 78)
    hdr = f"{'page':44s} {'chars':>7s} {'H1':>3s} {'bq':>3s} {'lede':>4s} {'cand':>5s} {'dupE':>4s} {'dupN':>4s} {'useful':>6s}"
    print(hdr)
    print("-" * len(hdr))
    for f in findings:
        s = f["scout"]
        print(f"{f['url'][:44]:44s} {s['chars']:7d} {'y' if s['has_h1'] else 'n':>3s} "
              f"{s['blockquote_lines']:3d} {'y' if s['h1_adjacent_blockquote'] else 'n':>4s} "
              f"{s['candidates']:5d} {s['exact_description_dupes']:4d} "
              f"{s['near_description_dupes']:4d} {s['useful_nonduplicate_facts']:6d}")
        if f["twin"]:
            t = f["twin"]
            print(f"{'  ^ twin (diagnostic)':44s} {t['chars']:7d} {'y' if t['has_h1'] else 'n':>3s} "
                  f"{t['blockquote_lines']:3d} {'y' if t['h1_adjacent_blockquote'] else 'n':>4s} "
                  f"{t['candidates']:5d} {t['exact_description_dupes']:4d} "
                  f"{t['near_description_dupes']:4d} {t['useful_nonduplicate_facts']:6d}")

    n = len(findings)
    agg = lambda k: sum(1 for f in findings if f["scout"][k])                      # noqa: E731
    tw = [f for f in findings if f["twin"]]
    print(f"\nTOTALS over {n} Scout pages   (twin column = diagnostic only, {len(tw)} pages)")
    print(f"  has H1  (code blocks stripped)         : {agg('has_h1')}/{n}"
          f"    twin {sum(1 for f in tw if f['twin']['has_h1'])}/{len(tw)}")
    print(f"  Documentation Index furniture in pool  : "
          f"{sum(1 for f in findings if f['scout']['furniture_candidates'])}/{n}"
          f"    twin {sum(1 for f in tw if f['twin']['furniture_candidates'])}/{len(tw)}")
    print(f"  ...of those, guarded by fix C          : "
          f"{sum(1 for f in findings if f['scout']['furniture_candidates'] and f['scout']['furniture_guarded'])}"
          f"/{sum(1 for f in findings if f['scout']['furniture_candidates'])}")
    # NO non-code-character comparison here, deliberately. Measured and discarded: the twin wraps
    # a whole endpoint page in 2 fences where Scout uses 68, so "chars outside a fence" measures
    # fence structure, not prose, and read +135% in Scout's favour on pages where Scout has less of
    # everything. A metric that is not comparable across the two sources does not belong in a
    # side-by-side.
    s_use = sum(f["scout"]["useful_nonduplicate_facts"] for f in tw)
    t_use = sum(f["twin"]["useful_nonduplicate_facts"] for f in tw)
    print(f"  useful non-dup facts, Scout vs twin    : {s_use} vs {t_use}"
          f"   ({100 * s_use / t_use - 100:+.0f}%)")
    print(f"  any blockquote                         : {agg('has_any_blockquote')}/{n}")
    print(f"  H1-adjacent blockquote  [fix C trigger]: {agg('h1_adjacent_blockquote')}/{n}")
    print(f"  exact description duplicate [fix D]    : {sum(1 for f in findings if f['scout']['exact_description_dupes'])}/{n}")
    print(f"  near description duplicate (>={NEAR_DUP_BAR}) : {sum(1 for f in findings if f['scout']['near_description_dupes'])}/{n}")
    print(f"  pages with >=1 useful non-dup fact     : {sum(1 for f in findings if f['scout']['useful_nonduplicate_facts'])}/{n}")
    chrome = collections.Counter(c for f in findings for c in f["scout"]["chrome"])
    print(f"  chrome markers seen                    : {dict(chrome) or 'none'}")
    print(f"\nfindings: {FINDINGS_PATH}")
    if quarantined:
        print(f"quarantined (kept, excluded): {quarantined}")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description="Scout shape probe, 10 /doc pages. Bounded instrument.")
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--plan", action="store_true", help="print what would be fetched. No network.")
    g.add_argument("--run", action="store_true", help="fetch 10 pages via Scout, then report")
    g.add_argument("--report", action="store_true", help="re-report from cache. No network.")
    args = ap.parse_args()

    if args.plan:
        records = probe_records()
        twins = twin_bodies({r["url"] for r in records})
        print(f"{len(records)} pages, {len(records)} Scout credits. Nothing else is reachable.\n")
        for r in records:
            print(f"  {r['objectID'][:70]:70s} twin cached: {'y' if r['url'] in twins else 'n'}")
        print(f"\ncache target : {PROBE_DIR}")
        print(f"route override: none. fetch_path_for() is not called; fetch_scout() is called direct.")
        return 0
    if args.run:
        return run_probe()
    return report()


if __name__ == "__main__":
    raise SystemExit(main())
