#!/usr/bin/env python3
"""
Phase 1 packet — the evidence a gate percentage cannot carry on its own.

WHY A PERCENTAGE IS NOT ENOUGH
  Three runs of the same 50 reference records scored 36%, 54% and 26% writable. The 54% was the
  worst of the three by every measure that matters: it was reached partly by writing abstracts that
  restate the record's existing `description` field, which is not enrichment. A pass percentage
  cannot tell those apart, so this script separates them.

THE OUTCOME TAXONOMY -- this is the headline, not the percentage
  ENRICHED        writable, adds real content beyond title+description, and no leak
  DUPLICATE       writable but the abstract restates what the record already has. NOT a success.
  LEAKED          writable but carries furniture, nav, spec labels, markup or someone's words
  HONEST_THIN     no abstract, and the page genuinely has no usable body prose. A CORRECT outcome.
  UNRESOLVED_THIN no abstract, but the page DOES have usable body prose. A real failure.
  FAILED          quarantined for anything else

  ENRICHED + HONEST_THIN is the number that means "this record is finished". DUPLICATE is counted
  as a failure on purpose: Arijit's ruling, 2026-08-08 -- "Do not count duplicate-description
  abstracts as success."

    python3 docs/70-enrichment/phase1_packet.py \
        --results  docs/70-enrichment/reports/gate-ABC-quotedlede-20260808-2311.jsonl \
        --baseline docs/70-enrichment/reports/gate-baseline-clean-20260808-2230.jsonl \
        --batch    docs/70-enrichment/batches/doc-md-twin-reference-001.json \
        --cache    docs/70-enrichment/cache-batches/doc-md-twin-reference-001 \
        --expect 50
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
from leakage_audit import (audit_record, build_corpus_frequency, cache_name,  # noqa: E402
                           check_clean_run, load_cache)

WRITABLE = {"PASS", "JUDGE_REVISE"}

# Transport/protocol facts. `abstract_must_not_be` for the reference family, as a test.
PLUMBING = re.compile(
    r"\b(https?|base urls?|request bod|response (?:format|status)|json|url-encoded|utf-8|"
    r"query parameters?|api key|application id|acl|authenticat|header|2xx|4xx|5xx|version)\b", re.I)

FURNITURE = ("discover all available pages", "llms.txt", "documentation index")

# An endpoint path row, not a fact. Caught by this filter reporting "/1/dictionaries//settings:" as
# a usable body candidate for /doc/rest-api/search/set-dictionary-settings in the first packet
# draft. A route is plumbing whatever else the sentence contains.
ROUTE_ROW = re.compile(r"^\s*/\d+/|^\s*(?:GET|POST|PUT|DELETE|PATCH)\s+/", re.I)


# A sentence offered as a candidate on this many pages of the batch is a shared section, not this
# page's subject. Added after the first draft of this script reported "Use Algolia's API clients and
# libraries to reliably integrate Algolia's APIs with your apps." as usable body content on
# /doc/rest-api/search, /doc/rest-api/recommend and /doc/rest-api/search/set-dictionary-settings --
# it is the Client libraries section, which sits on every rest-api page. Counting it as usable would
# have overstated the ceiling and recommended a fix that produces identical abstracts on 40 pages.
CROSS_PAGE_MAX = 4


def usable_body_candidates(md: str, description: str, freq=None) -> list:
    """Prose that could honestly become an abstract for THIS page.

    Four exclusions, each measured rather than assumed:
      lede       duplicates `description` byte-for-byte on 49 of 49 reference pages
      plumbing   transport facts, banned by the family's `abstract_must_not_be`
      furniture  the Documentation Index block above the H1
      shared     offered as a candidate on more than CROSS_PAGE_MAX pages of this batch
    """
    cands, _ = split_candidates(md)
    d = (description or "").strip().rstrip(".").lower()
    out = []
    for c in cands:
        if c.kind != "prose" or c.is_page_lede:
            continue
        t = c.text.strip().rstrip(".").lower()
        if d and t == d:
            continue
        if PLUMBING.search(c.text) or ROUTE_ROW.match(c.text):
            continue
        if any(f in c.text.lower() for f in FURNITURE):
            continue
        if freq is not None and freq.get(norm_key(c.text), 0) > CROSS_PAGE_MAX:
            continue
        out.append(c)
    return out


def duplicates_description(abstract: str, title: str, description: str) -> bool:
    """New content words beyond what the record already carries. Mirrors G7's question, asked here
    so a DUPLICATE can be named even when the gate happened to let it through."""
    have = set(re.findall(r"[a-z0-9]+", f"{title} {description}".lower()))
    new = [w for w in re.findall(r"[a-z0-9]+", (abstract or "").lower())
           if w not in have and len(w) > 2]
    return len(set(new)) < 3


def classify(rec, src, md, freq):
    status = rec.get("status")
    title = (src or {}).get("title", "")
    desc = (src or {}).get("description", "")
    abstract = rec.get("abstract_enriched") or ""

    if status in WRITABLE:
        audit = audit_record(rec, md, freq)
        if audit["leaks"]:
            return "LEAKED", audit, f"leaks: {','.join(audit['leaks'])}"
        if duplicates_description(abstract, title, desc):
            return "DUPLICATE", audit, "abstract restates title+description"
        return "ENRICHED", audit, ""

    if status == "NO_ABSTRACT_THIN":
        # THIN is honest ONLY when no non-duplicate useful body fact exists. Arijit, 2026-08-08.
        usable = usable_body_candidates(md, desc, freq) if md else []
        if not usable:
            return "HONEST_THIN", None, "no non-duplicate body facts exist"
        return "UNRESOLVED_THIN", None, f"{len(usable)} usable body candidates were available"

    return "FAILED", None, "; ".join(rec.get("gate_failures") or [])[:120]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--results", required=True)
    ap.add_argument("--baseline")
    ap.add_argument("--batch", required=True)
    ap.add_argument("--cache", required=True)
    ap.add_argument("--expect", type=int)
    args = ap.parse_args()

    rows = [json.loads(l) for l in Path(args.results).read_text().splitlines() if l.strip()]
    problems = check_clean_run(rows, args.expect)
    if problems:
        print("REFUSING -- not a finished clean run:", file=sys.stderr)
        for p in problems:
            print(f"  - {p}", file=sys.stderr)
        return 2

    batch = json.loads(Path(args.batch).read_text())
    if isinstance(batch, dict):
        batch = batch.get("records", [])
    src_by_id = {r["objectID"]: r for r in batch}

    pages = load_cache(Path(args.cache))
    freq = build_corpus_frequency(pages)

    results = []
    for r in rows:
        md = pages.get(cache_name(r["source_url"]))
        kind, audit, why = classify(r, src_by_id.get(r["objectID"]), md, freq)
        results.append({"rec": r, "kind": kind, "why": why,
                        "abstract": r.get("abstract_enriched") or ""})

    counts = collections.Counter(x["kind"] for x in results)
    n = len(results)
    finished = counts["ENRICHED"] + counts["HONEST_THIN"]

    print(f"## Counts — `{Path(args.results).name}`\n")
    print(f"- rows **{n}**, distinct objectIDs **{len({r['objectID'] for r in rows})}**, "
          f"duplicates **{n - len({r['objectID'] for r in rows})}**")
    print(f"- raw status: " + ", ".join(f"{k} {v}" for k, v in
                                        collections.Counter(r["status"] for r in rows).most_common()))
    w = sum(1 for r in rows if r["status"] in WRITABLE)
    print(f"- gate writable %: **{w}/{n} = {100*w/n:.1f}%**\n")

    print("## Outcome taxonomy — the number that actually means something\n")
    print("| outcome | n | share | counts as done? |")
    print("|---|---|---|---|")
    for k, done in (("ENRICHED", "yes"), ("HONEST_THIN", "yes"), ("DUPLICATE", "NO"),
                    ("LEAKED", "NO"), ("UNRESOLVED_THIN", "NO"), ("FAILED", "NO")):
        print(f"| {k} | {counts[k]} | {100*counts[k]/n:.0f}% | {done} |")
    print(f"\n**Records genuinely finished: {finished}/{n} = {100*finished/n:.1f}%** "
          f"(ENRICHED {counts['ENRICHED']} + HONEST_THIN {counts['HONEST_THIN']})\n")

    if args.baseline:
        base = {json.loads(l)["objectID"]: json.loads(l)
                for l in Path(args.baseline).read_text().splitlines() if l.strip()}
        rec = [x for x in results
               if base.get(x["rec"]["objectID"], {}).get("status") not in WRITABLE
               and x["rec"]["status"] in WRITABLE]
        print(f"## Newly recovered vs baseline: {len(rec)}\n")
        if rec:
            print("| url | outcome | why | abstract |")
            print("|---|---|---|---|")
            for x in sorted(rec, key=lambda y: y["rec"]["url"]):
                print(f"| `{x['rec']['url']}` | {x['kind']} | {x['why'][:60]} | "
                      f"{x['abstract'][:120].replace('|', '\\|')} |")
        print()

    print("## Every ENRICHED record — the ones claimed as real enrichment\n")
    print("| url | abstract |")
    print("|---|---|")
    for x in sorted([r for r in results if r["kind"] == "ENRICHED"], key=lambda y: y["rec"]["url"]):
        print(f"| `{x['rec']['url']}` | {x['abstract'][:190].replace('|', '\\|')} |")

    for label in ("DUPLICATE", "LEAKED", "UNRESOLVED_THIN"):
        bad = [r for r in results if r["kind"] == label]
        if not bad:
            continue
        print(f"\n## {label} — counted as NOT done ({len(bad)})\n")
        print("| url | why | abstract |")
        print("|---|---|---|")
        for x in sorted(bad, key=lambda y: y["rec"]["url"]):
            print(f"| `{x['rec']['url']}` | {x['why'][:70]} | "
                  f"{x['abstract'][:120].replace('|', '\\|')} |")

    print("\n## Remaining failure causes\n")
    causes = collections.Counter()
    for r in rows:
        for g in (r.get("gate_failures") or []):
            causes[re.sub(r"\d+", "N", g)[:70]] += 1
        if r["status"] == "NO_ABSTRACT_THIN":
            causes[f"THIN: {r.get('insufficient_reason')}"] += 1
    print("| n | cause |")
    print("|---|---|")
    for k, v in causes.most_common():
        print(f"| {v} | `{k}` |")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
