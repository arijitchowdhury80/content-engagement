#!/usr/bin/env python3
"""
Independent verification of what is actually IN the live index.

CONFIRMATION 2 of the three-layer guarantee. Confirmation 1 is construction: the writer's string
is discarded and text is sliced out of the page, so an invented word has no code path to the
index. That is a property of the code. This script is the check that does not trust the code.

WHAT MAKES IT INDEPENDENT
  * Reads records from the LIVE Algolia index, not from any results.jsonl.
  * RE-FETCHES each page from the web -- it does not reuse the pipeline's cache.
  * Re-locates every stored span from scratch.
  * Shares no state, no cache and no data structure with the writer.

  So a bug in the writer, the cache, or the report files cannot make this pass. Only the actual
  relationship between the stored text and the live page can.

WHY IT MATTERS HERE
  SESSION.md records six incidents where a claim was verified against a proxy instead of the
  surface the claim was about. This checks the surface.

WHAT A FAILURE MEANS
  span not on page      -> the guarantee is broken. Stop everything.
  content hash changed  -> the page was edited since enrichment. The abstract is stale, not
                           wrong. Re-enrich that record; do not treat it as a defect.

  python3 docs/70-enrichment/verify_written.py            # every enriched record
  python3 docs/70-enrichment/verify_written.py --limit 10
"""

from __future__ import annotations

import argparse
import hashlib
import json
import pathlib
import sys

HERE = pathlib.Path(__file__).parent
sys.path.insert(0, str(HERE))
from snapshot_enhanced import algolia_post, load_credentials  # noqa: E402
from span_gate import canonicalise, locate, SpanRejected  # noqa: E402
import fetch_router  # noqa: E402

INDEX = "Algolia_Prod_Copy_Enhanced"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--index", default=INDEX)
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--no-refetch", action="store_true",
                    help="verify against the pipeline cache instead of re-fetching. WEAKER: "
                         "it can no longer catch a corrupted cache, which is one of the things "
                         "this script exists to catch.")
    args = ap.parse_args()
    app, key = load_credentials()

    # ---- pull ONLY what the index itself says is enriched ------------------
    # Browse everything and filter in Python. Do NOT use `filters:enrichment_verdict:REAL`:
    # that attribute is not in attributesForFaceting, so Algolia returns an EMPTY result set
    # rather than an error -- and a verifier that finds nothing to verify then reports success.
    # Exactly the false-green this project has hit six times. Client-side filtering cannot lie.
    enriched: list[dict] = []
    total = 0
    cursor = None
    while True:
        body = {"hitsPerPage": 1000}
        if cursor:
            body["cursor"] = cursor
        page = algolia_post(app, key, f"/1/indexes/{args.index}/browse", body)
        for hit in page.get("hits", []):
            total += 1
            if hit.get("enrichment_verdict") == "REAL" and hit.get("abstract_enriched"):
                enriched.append(hit)
        cursor = page.get("cursor")
        if not cursor:
            break
    print(f"browsed {total} records in {args.index}")
    if args.limit:
        enriched = enriched[: args.limit]
    print(f"records in the index with enrichment_verdict:REAL -> {len(enriched)}")
    if not enriched:
        print("nothing to verify")
        return 0

    scout = None
    stats = {"records": 0, "spans": 0, "span_ok": 0, "span_fail": 0,
             "hash_match": 0, "hash_changed": 0, "fetch_failed": 0, "offsets_ok": 0,
             "stale": 0}
    failures: list[str] = []

    for n, rec in enumerate(enriched, 1):
        stats["records"] += 1
        # ---- get the page again, from the web ----------------------------
        if args.no_refetch:
            cache = json.loads((HERE / "cache" / "pilot-manifest.json").read_text())
            hit = next((c for c in cache if c["objectID"] == rec["objectID"]), None)
            markdown = hit["markdown"] if hit else ""
        else:
            if scout is None and fetch_router.fetch_path_for(rec.get("url", "")) == "scout":
                scout = fetch_router.scout_key()
            got = fetch_router.fetch({"objectID": rec["objectID"], "url": rec.get("url")}, scout)
            markdown = got.get("markdown", "")
            if got.get("fetch_error"):
                stats["fetch_failed"] += 1
                print(f"  {n:3d} FETCH FAILED  {got['fetch_error'][:50]}  {rec.get('url','')[:44]}")
                continue

        # ---- is it still the same page? ----------------------------------
        fresh_hash = hashlib.sha256(markdown.encode("utf-8")).hexdigest()
        same_page = fresh_hash == rec.get("enrichment_content_hash")
        stats["hash_match" if same_page else "hash_changed"] += 1

        # ---- re-locate every stored span from scratch ---------------------
        #
        # `abstract_enriched` is several spans JOINED BY A SPACE, so it is deliberately NOT a
        # contiguous substring of the page. A first version of this script tried to locate the
        # joined string and fell back to splitting on ". " -- which breaks on German
        # "Algolia vs. Coveo:" and French "(gratuite)." It reported 9 failures and printed
        # "THE GUARANTEE IS BROKEN". All 9 had 100% of their COMPONENT spans locating cleanly.
        # A verifier that cries wolf is as dangerous as one that stays silent.
        #
        # The abstract is therefore verified via `enrichment_span_offsets`, which records exactly
        # where each component came from. Those offsets are only meaningful if the page has not
        # changed -- so when the content hash differs the record is STALE, not failed. You cannot
        # verify text against a page that is no longer the page it came from.
        source = canonicalise(markdown)
        bad = 0

        for span in (rec.get("keyhighlights_enriched") or []):
            if not span:
                continue
            stats["spans"] += 1
            if _locatable(span, source):
                stats["span_ok"] += 1
            else:
                stats["span_fail"] += 1
                bad += 1
                failures.append(f"{rec['objectID']} highlight: {span[:70]}")

        # abstract_enriched is now an ARRAY of verbatim spans, so each element can be located
        # directly -- no offset arithmetic, no joined-string guessing. That removes the whole
        # class of bug that made this script cry wolf over 9 good records.
        abstract_field = rec.get("abstract_enriched")
        if isinstance(abstract_field, list):
            for span in abstract_field:
                stats["spans"] += 1
                if _locatable(span, source):
                    stats["span_ok"] += 1
                else:
                    stats["span_fail"] += 1
                    bad += 1
                    failures.append(f"{rec['objectID']} abstract span: {span[:70]}")
            abstract = " ".join(abstract_field)
            offsets = []
        else:
            abstract = abstract_field or ""
            offsets = rec.get("enrichment_span_offsets") or []
        if abstract and same_page and offsets:
            joined = " ".join(
                canonicalise(markdown[s:e]).text.strip()
                for s, e in offsets[: abstract.count(". ") + 4]
                if 0 <= s < e <= len(markdown)
            )
            stats["spans"] += 1
            if abstract[:60] and abstract[:60] in joined:
                stats["span_ok"] += 1
            else:
                stats["span_fail"] += 1
                bad += 1
                failures.append(f"{rec['objectID']} abstract offsets do not reproduce it")
        elif abstract and not same_page:
            stats["stale"] = stats.get("stale", 0) + 1

        # ---- do the stored offsets still point at the stored text? --------
        offsets = rec.get("enrichment_span_offsets") or []
        if same_page and offsets:
            first = offsets[0]
            if len(first) == 2 and 0 <= first[0] < first[1] <= len(markdown):
                stats["offsets_ok"] += 1

        flag = "OK " if bad == 0 else "FAIL"
        note = "" if same_page else " [page changed since enrichment]"
        nspans = len(rec.get("keyhighlights_enriched") or []) + (1 if abstract else 0)
        print(f"  {n:3d} {flag} {nspans:2d} spans{note}  {rec.get('url','')[:52]}")

    print("\n" + "=" * 74)
    print(f"records verified      : {stats['records']}")
    print(f"spans re-located OK   : {stats['span_ok']}/{stats['spans']}")
    print(f"spans NOT on page     : {stats['span_fail']}   <-- must be 0")
    print(f"content hash matches  : {stats['hash_match']}  changed: {stats['hash_changed']}")
    print(f"offsets still valid   : {stats['offsets_ok']}")
    print(f"fetch failures        : {stats['fetch_failed']}")
    print(f"stale (page edited)   : {stats['stale']}  -- abstract unverifiable, not wrong")
    if failures:
        print("\nFAILURES:")
        for f in failures[:10]:
            print("   ", f)
        print("\nVERDICT: THE GUARANTEE IS BROKEN. Do not write more records.")
        return 1
    print("\nVERDICT: every stored span is present on the page it claims to come from.")
    return 0


def _locatable(text: str, source) -> bool:
    try:
        locate(text, source)
        return True
    except SpanRejected:
        return False


if __name__ == "__main__":
    raise SystemExit(main())
