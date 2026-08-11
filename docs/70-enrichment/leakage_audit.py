#!/usr/bin/env python3
"""
Leakage audit — does a writable abstract actually describe its page?

WHY THIS EXISTS SEPARATELY FROM THE GATE
  The Phase 1 gate reports a percentage. A percentage cannot tell you WHAT got recovered, and this
  run's recoveries came from deliberately unbanning two categories of candidate that had been
  banned for a reason. Unbanning is exactly the move that can raise a number while lowering the
  quality behind it:

    * the [FRAGMENT] ban was hiding real ledes -- and also real mid-sentence chops and code lines
    * the [QUOTED] ban was hiding each page's own description -- and also the site-wide
      `> ## Documentation Index` block that sits above the H1 on all 4,337 doc-md-twin pages

  G8 corpus-wide boilerplate detection is currently OFF, so nothing else in the pipeline is looking
  for furniture. This does, on the written output rather than on the candidate list, and it is the
  check that has to pass before a pass percentage means anything.

SEVEN LEAK CLASSES, each decided against evidence rather than opinion
  DOC_INDEX   text from the Documentation Index furniture block
  NAV         the span traces back to a candidate the classifier marked [UI] or [HEADING]
  PLUMBING    the whole abstract is transport/protocol facts -- the `abstract_must_not_be` list
  BOILERPLATE the sentence appears as a candidate on many OTHER pages, so it distinguishes none
  QUOTED      the span came from a blockquote that is NOT the page's own description under the H1,
              or that carries speech marks / an attribution dash. This is the class fix C could
              plausibly have broken, so it is audited on the written output and not assumed.
  METADATA    an OpenAPI/frontmatter field label rendered as prose ("description: Searches for ...")
  MARKUP      raw markdown that survived canonicalisation ("_if-then_", backticks, link syntax)

  METADATA and MARKUP were not designed in. They were found BY this audit on the A+B run, inside
  records the gate had already called writable -- which is the argument for auditing written output
  rather than trusting a pass percentage.

REFUSES TO AUDIT AN UNFINISHED FILE
  A partial results.jsonl is not evidence, and reading one as if it were is how this project
  produced a 42% figure that turned out to be a dedupe-by-last-row artefact of two concurrent
  writers. --expect makes the row count, the distinct-objectID count and the duplicate count a
  precondition, not a footnote.

    python3 docs/70-enrichment/leakage_audit.py \
        --results docs/70-enrichment/batches-out/doc-md-twin-reference-001/results.jsonl \
        --cache   docs/70-enrichment/cache-batches/doc-md-twin-reference-001 \
        --baseline docs/70-enrichment/reports/gate-baseline-clean-20260808-2230.jsonl \
        --expect 50 --markdown

  Exit 0 clean, 1 leaks found, 2 the file is not a finished clean run.
"""

from __future__ import annotations

import argparse
import collections
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from candidates import norm_key, split_candidates  # noqa: E402
from span_gate import is_speech  # noqa: E402

WRITABLE = {"PASS", "JUDGE_REVISE"}

# The furniture block. Matched on content, not position, because by the time we are reading a
# stored abstract the position is gone.
DOC_INDEX_MARKERS = (
    "documentation index",
    "llms.txt",
    "discover all available pages",
    "fetch the complete documentation",
)

# `abstract_must_not_be` from prompts/shape-families.json, as testable patterns. A sentence is
# plumbing if it is ABOUT the transport rather than about what the page does.
PLUMBING = re.compile(
    r"\b("
    r"https?\b|must use https|base urls?|endpoint urls?|"
    r"request bod(?:y|ies)|response (?:format|status|bod)|json (?:object|array|respons)|"
    r"url-encoded|utf-8|query parameters?|api key|application id|"
    r"acl\b|access control list|authenticat|header|"
    r"status(?:es)? |2xx|4xx|5xx|"
    r"current version of the|version \d|/1/"
    r")", re.I)

# OpenAPI / frontmatter keys that render into the markdown twin as literal text. Found by this
# audit on the A+B run: "description: Searches for standard and custom dictionary entries.
# description: Dictionary entries matching the search criteria." is a spec field label, not a
# sentence, and it ends in a period so every shape test calls it prose. 0 in the baseline, 3 after
# the information-gain bar dropped to 3 and stopped quarantining those records.
SPEC_KEY = re.compile(
    r"(?:^|\s)(?:description|summary|operationId|tags|parameters|responses|requestBody|"
    r"schema|example|default|required|type)\s*:\s", re.I)

# Markdown that survived into stored text. `_if-then_` reads as noise in a search result.
RAW_MARKUP = re.compile(r"(?<!\w)[_*]{1,2}\w[^_*\n]*[_*]{1,2}(?!\w)|`[^`\n]+`|\]\(")

# A sentence on this many OTHER pages in the same corpus is furniture, not this page's subject.
# 0.5 is the G8 line and this is deliberately stricter, because a written abstract is a claim about
# ONE page: a sentence shared with 4 others was never a description of any of them.
BOILERPLATE_MIN_PAGES = 5


def load_cache(cache_dir: Path) -> dict[str, str]:
    out = {}
    for p in sorted(cache_dir.glob("*.json")):
        try:
            rec = json.loads(p.read_text())
        except Exception:
            continue
        if isinstance(rec, dict) and rec.get("markdown"):
            out[p.name] = rec["markdown"]
    return out


def cache_name(source_url: str) -> str:
    return source_url.replace("://", ":__").replace("/", "_") + ".json"


def build_corpus_frequency(pages: dict[str, str]) -> collections.Counter:
    """How many distinct pages offer each sentence as a candidate."""
    freq: collections.Counter = collections.Counter()
    for md in pages.values():
        cands, _ = split_candidates(md)
        for key in {norm_key(c.text) for c in cands}:
            freq[key] += 1
    return freq


def candidates_for_page(md: str) -> dict[str, object]:
    """Trace a stored span back to the candidate it was selected from, so its kind, its blockquote
    status and its lede position are facts about THIS page rather than guesses from the text."""
    cands, _ = split_candidates(md)
    return {norm_key(c.text): c for c in cands}


def check_clean_run(rows: list[dict], expect: int | None) -> list[str]:
    """A finished, uncontaminated file, or nothing. See the module docstring."""
    problems = []
    ids = [r.get("objectID") for r in rows]
    dupes = [k for k, v in collections.Counter(ids).items() if v > 1]
    if dupes:
        problems.append(f"{len(dupes)} duplicated objectIDs ({len(rows)} rows, "
                        f"{len(set(ids))} distinct) -- concurrent writers, file is corrupt")
    if expect is not None:
        if len(rows) != expect:
            problems.append(f"{len(rows)} rows, expected {expect} -- run unfinished or wrong batch")
        if len(set(ids)) != expect:
            problems.append(f"{len(set(ids))} distinct objectIDs, expected {expect}")
    return problems


def audit_record(rec: dict, md: str | None, freq: collections.Counter) -> dict:
    spans = rec.get("abstract_spans_stored") or []
    if not spans and rec.get("abstract_enriched"):
        spans = [rec["abstract_enriched"]]
    abstract = rec.get("abstract_enriched") or " ".join(spans)

    by_text = candidates_for_page(md) if md else {}
    leaks: list[str] = []
    detail: list[str] = []

    low = abstract.lower()
    for marker in DOC_INDEX_MARKERS:
        if marker in low:
            leaks.append("DOC_INDEX")
            detail.append(f"contains {marker!r}")
            break

    for s in spans:
        c = by_text.get(norm_key(s))
        if c is not None and c.kind in ("ui", "heading"):
            leaks.append("NAV")
            detail.append(f"span classified {c.kind}: {s[:60]!r}")
            break

    # The class fix C could have broken. A blockquote is acceptable ONLY when it is this page's own
    # description under the H1 and carries no speech evidence -- exactly the condition render_menu
    # uses to drop the [QUOTED] label. Anything else in an abstract is someone else's words.
    for s in spans:
        c = by_text.get(norm_key(s))
        if c is None or not c.is_quoted:
            continue
        if is_speech(c.original, c.text):
            leaks.append("QUOTED")
            detail.append(f"span is attributed speech: {s[:60]!r}")
            break
        if not c.is_page_lede:
            leaks.append("QUOTED")
            detail.append(f"span is a blockquote that is not the page description: {s[:60]!r}")
            break

    for s in spans:
        if SPEC_KEY.search(s):
            leaks.append("METADATA")
            detail.append(f"span carries a spec field label: {s[:70]!r}")
            break

    for s in spans:
        if RAW_MARKUP.search(s):
            leaks.append("MARKUP")
            detail.append(f"span carries raw markdown: {s[:70]!r}")
            break

    if spans and all(PLUMBING.search(s) for s in spans):
        leaks.append("PLUMBING")
        detail.append("every span is transport/protocol")

    for s in spans:
        n = freq.get(norm_key(s), 0)
        if n >= BOILERPLATE_MIN_PAGES:
            leaks.append("BOILERPLATE")
            detail.append(f"span appears as a candidate on {n} pages: {s[:60]!r}")
            break

    return {
        "objectID": rec.get("objectID"),
        "url": rec.get("url"),
        "status": rec.get("status"),
        "abstract": abstract,
        "n_spans": len(spans),
        "leaks": sorted(set(leaks)),
        "detail": detail,
        "page_found": md is not None,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--results", required=True)
    ap.add_argument("--cache", required=True)
    ap.add_argument("--baseline", help="prior results.jsonl, to list newly recovered records")
    ap.add_argument("--expect", type=int, help="required row AND distinct-objectID count")
    ap.add_argument("--markdown", action="store_true")
    args = ap.parse_args()

    rows = [json.loads(l) for l in Path(args.results).read_text().splitlines() if l.strip()]

    problems = check_clean_run(rows, args.expect)
    if problems:
        print("REFUSING TO AUDIT -- this file is not a finished clean run:", file=sys.stderr)
        for p in problems:
            print(f"  - {p}", file=sys.stderr)
        return 2

    pages = load_cache(Path(args.cache))
    freq = build_corpus_frequency(pages)

    writable = [r for r in rows if r.get("status") in WRITABLE]
    audits = [audit_record(r, pages.get(cache_name(r["source_url"])), freq) for r in writable]
    dirty = [a for a in audits if a["leaks"]]

    recovered = []
    if args.baseline:
        base = {json.loads(l)["objectID"]: json.loads(l)
                for l in Path(args.baseline).read_text().splitlines() if l.strip()}
        recovered = [a for a in audits
                     if base.get(a["objectID"], {}).get("status") not in WRITABLE]

    dirty_recovered = [a for a in recovered if a["leaks"]]

    if args.markdown:
        print(f"file: {args.results}")
        print(f"rows {len(rows)} | distinct objectIDs {len({r['objectID'] for r in rows})} "
              f"| duplicates 0 | writable audited {len(audits)}")
        print(f"leaks among ALL writable: {len(dirty)}")
        if args.baseline:
            print(f"newly recovered vs baseline: {len(recovered)} | "
                  f"leaks among recovered: {len(dirty_recovered)}")

        if args.baseline:
            print(f"\n### Newly recovered records ({len(recovered)}) — the ones the fixes bought\n")
            print("| url | status | leak | abstract |")
            print("|---|---|---|---|")
            for a in sorted(recovered, key=lambda x: (not x["leaks"], x["url"])):
                leak = ",".join(a["leaks"]) or "clean"
                print(f"| `{a['url']}` | {a['status']} | {leak} | "
                      f"{a['abstract'][:160].replace('|', '\\|')} |")

        print(f"\n### All writable records ({len(audits)})\n")
        print("| verdict | url | leak | abstract |")
        print("|---|---|---|---|")
        for a in sorted(audits, key=lambda x: (not x["leaks"], x["url"])):
            v = "LEAK" if a["leaks"] else "clean"
            leak = ",".join(a["leaks"]) or "-"
            print(f"| {v} | `{a['url']}` | {leak} | {a['abstract'][:160].replace('|', '\\|')} |")

        if dirty:
            print("\n### Leak detail\n")
            for a in dirty:
                print(f"- `{a['url']}` — {','.join(a['leaks'])}")
                for d in a["detail"]:
                    print(f"    - {d}")
    else:
        print(json.dumps({"audited": len(audits), "leaks": len(dirty),
                          "recovered": len(recovered), "records": audits}, indent=2))

    missing = [a for a in audits if not a["page_found"]]
    if missing:
        print(f"\nWARNING: {len(missing)} records had no cached page; NAV/BOILERPLATE "
              f"could not be checked for them", file=sys.stderr)

    return 1 if dirty else 0


if __name__ == "__main__":
    raise SystemExit(main())
