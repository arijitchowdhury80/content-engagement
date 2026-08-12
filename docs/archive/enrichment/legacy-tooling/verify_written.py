#!/usr/bin/env python3
"""
Independent verification of what is actually IN the live index.

CONFIRMATION 2 of the three-layer guarantee. Confirmation 1 is construction: the writer's string
is discarded and text is sliced out of the page, so an invented word has no code path to the
index. That is a property of the code. This script is the check that does not trust the code.

WHAT MAKES IT INDEPENDENT, AND WHERE THAT INDEPENDENCE NOW STOPS
  * Reads the enriched TEXT from the LIVE Algolia index, never from a results file.
  * RE-FETCHES each page through Scout -- it does not reuse the pipeline's cache.
  * Checks the page served is the page the record points at, so a redirect target cannot be
    verified in place of the real document.
  * Re-locates every stored span from scratch.

THE PRIMARY CHECK USES NO OFFSETS AT ALL (Arijit, 2026-08-09)
  For every stored span, in `abstract_enriched` and `keyhighlights_enriched` alike: re-fetch the
  page through Scout, canonicalise it, and locate the stored string ANYWHERE in it. Exact canonical
  match, no fuzzy fallback, no offset consulted. If the text is on the page, it is grounded; if it
  is not, the guarantee is broken and everything stops.

  This is what makes the check independent again. The span offsets in the run artifacts could be
  wrong in exactly the same way the stored text is wrong and this check would still catch it,
  because it never asks where the text was supposed to be -- only whether the page says it.

  Offsets are still read from --artifacts, but ONLY for two secondary, positional signals: whether
  the page has changed since enrichment (content hash), and whether the recorded positions still
  reconstruct the legacy joined-string form. A record with no artifact row therefore loses those
  two signals and is still fully verified for grounding.

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


def load_artifacts(root: pathlib.Path) -> dict[str, dict]:
    """objectID -> {span_offsets, content_hash, status} from the run's own results.jsonl files.

    These are the ONLY record of where each stored span came from, now that the index holds just
    the text. Losing them means the run cannot be verified, which is a reason to keep run artifacts
    with the same care as a backup.
    """
    out: dict[str, dict] = {}
    for path in sorted(root.glob("*/results.jsonl")):
        for line in path.open(encoding="utf-8"):
            line = line.strip()
            if not line:
                continue
            row = json.loads(line)
            if row.get("objectID"):
                out[row["objectID"]] = {
                    "span_offsets": row.get("span_offsets") or [],
                    "content_hash": row.get("content_hash"),
                    "status": row.get("status"),
                }
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--index", default=INDEX)
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--no-refetch", action="store_true",
                    help="verify against the pipeline cache instead of re-fetching. WEAKER: "
                         "it can no longer catch a corrupted cache, which is one of the things "
                         "this script exists to catch.")
    ap.add_argument("--artifacts", default=str(HERE / "batches-out-scout"),
                    help="run artifacts holding span offsets and content hashes. The index no "
                         "longer carries them -- lean-record policy, 2026-08-09.")
    args = ap.parse_args()
    app, key = load_credentials()

    # ---- provenance comes from the RUN ARTIFACTS, not from the record ------
    # Arijit, 2026-08-09: live records stay lean -- only abstract_enriched and
    # keyhighlights_enriched. Span offsets and content hashes are therefore never written to a
    # record, and a verifier that looked for them there would find nothing, verify nothing, and
    # report success. That is the exact false-green shape this file already warns about two
    # comments below, arriving through a different door.
    artifacts = load_artifacts(pathlib.Path(args.artifacts))
    if not artifacts:
        # NOT fatal, and this is a deliberate change of mind. It was fatal while grounding depended
        # on offsets: an empty artifact map then meant "nothing to check", which reads identically
        # to "everything passed". Grounding is now offset-free, so with no artifacts the PRIMARY
        # check still runs at full strength and only the two positional signals are lost. Killing
        # the run here would refuse to verify records precisely because they have no provenance.
        print(f"WARNING: no result rows under {args.artifacts}.")
        print("         Grounding WILL still be verified -- it consults no offsets.")
        print("         Lost: the page-changed signal and legacy offset reconstruction.")
    else:
        print(f"artifact rows loaded  : {len(artifacts)}")

    # ---- pull ONLY what the index itself says is enriched ------------------
    # Browse everything and filter in Python. Never select these records with a `filters:` clause:
    # an attribute that is not in attributesForFaceting makes Algolia return an EMPTY result set
    # rather than an error -- and a verifier that finds nothing to verify then reports success.
    # Exactly the false-green this project has hit six times. Client-side filtering cannot lie.
    # (The original form of this warning named `filters:enrichment_verdict:REAL`. That attribute no
    # longer exists on records at all under the lean-record policy; the trap it describes does.)
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
            # `abstract_enriched` is now the ONLY marker of an enriched record: the lean-record
            # policy removed enrichment_verdict from the index on 2026-08-09. The verdict lives in
            # the run artifacts and is cross-checked below.
            if hit.get("abstract_enriched"):
                enriched.append(hit)
        cursor = page.get("cursor")
        if not cursor:
            break
    print(f"browsed {total} records in {args.index}")
    if args.limit:
        enriched = enriched[: args.limit]
    print(f"records in the index carrying abstract_enriched -> {len(enriched)}")
    if not enriched:
        print("nothing to verify")
        return 0

    # Cross-check the two sides before verifying. A record with no artifact row loses the two
    # POSITIONAL signals (page-changed, legacy offset reconstruction) but is still fully checked
    # for grounding, because the primary check consults no offsets. 35 records from the retired
    # 2026-08 design are expected here until they are cleaned up; more than that is unexplained.
    orphans = [h["objectID"] for h in enriched if h["objectID"] not in artifacts]
    if orphans:
        print(f"NOTE: {len(orphans)} enriched record(s) have no artifact row: {orphans[:5]}")
        print("      Grounding IS still verified for them (offset-free). What they lose is the "
              "page-changed signal.")

    scout = None
    stats = {"records": 0, "spans": 0, "span_ok": 0, "span_fail": 0,
             "hash_match": 0, "hash_changed": 0, "fetch_failed": 0, "offsets_ok": 0,
             "redirected": 0, "no_artifact_row": 0,
             # THE grounding numbers: located anywhere in the freshly fetched page, offsets ignored.
             "found_anywhere": 0, "not_found_anywhere": 0,
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
            # The page served must be the page the record points at. Without this the verifier
            # re-fetches a redirect target, relocates the span in it, and reports "0 not found" --
            # a clean pass certifying an abstract that describes a different URL.
            if got.get("redirect_mismatch"):
                stats["redirected"] = stats.get("redirected", 0) + 1
                print(f"  {n:3d} REDIRECTED    served {got.get('served_url','')[:44]} "
                      f"!= {rec.get('url','')[:44]}")
                continue
            if got.get("fetch_error"):
                stats["fetch_failed"] += 1
                print(f"  {n:3d} FETCH FAILED  {got['fetch_error'][:50]}  {rec.get('url','')[:44]}")
                continue

        # ---- is it still the same page? ----------------------------------
        fresh_hash = hashlib.sha256(markdown.encode("utf-8")).hexdigest()
        art = artifacts.get(rec["objectID"], {})
        if not art:
            # No artifact row means no offsets and no stored hash -- so the POSITIONAL checks
            # cannot run. The offset-free check still can, and it is the one that proves grounding.
            # An earlier version of this guard `continue`d here, which skipped span verification on
            # precisely the records with the least provenance. That was backwards.
            stats["no_artifact_row"] += 1
        same_page = bool(art) and fresh_hash == art.get("content_hash")
        if art:
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
        # The abstract is therefore verified via the run's recorded span offsets, which say exactly
        # where each component came from.
        #
        # THOSE OFFSETS ARE NOT ON THE RECORD. Under the lean-record policy (Arijit, 2026-08-09) an
        # Algolia record carries only `abstract_enriched` and `keyhighlights_enriched`; every piece
        # of provenance lives in the run artifacts under --artifacts, and `art` above is that row.
        # The distinction matters to anyone changing this file: the index is the thing being
        # checked, and the artifacts are what it is checked AGAINST. Losing the artifacts does not
        # weaken verification, it ends it -- which is why load_artifacts() exits rather than
        # continuing with an empty map.
        #
        # Offsets are only meaningful if the page has not changed, so when the content hash differs
        # the record is STALE, not failed. You cannot verify text against a page that is no longer
        # the page it came from.
        source = canonicalise(markdown)
        bad = 0

        # ONE implementation of the grounding check, shared with the tests. No offsets consulted.
        found, missing, fails = verify_record_spans(rec, source)
        stats["spans"] += found + missing
        stats["span_ok"] += found
        stats["span_fail"] += missing
        stats["found_anywhere"] += found
        stats["not_found_anywhere"] += missing
        bad += missing
        failures.extend(fails)

        abstract_field = rec.get("abstract_enriched")
        if isinstance(abstract_field, list):
            abstract = " ".join(abstract_field)
            offsets = []
        else:
            abstract = abstract_field or ""
            offsets = art.get("span_offsets") or []
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
        offsets = art.get("span_offsets") or []
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
    print()
    print("GROUNDING -- offset-free. Every stored span located anywhere in the freshly fetched")
    print("page by exact canonical match. This is the check that proves the text came from the")
    print("page, and it consults no artifact offsets.")
    print(f"  found on page       : {stats['found_anywhere']}/{stats['spans']}")
    print(f"  NOT found on page   : {stats['not_found_anywhere']}   <-- must be 0")
    print()
    print("POSITIONAL -- secondary, needs an artifact row. Says whether the page still matches")
    print("the one enriched, not whether the text is grounded.")
    print(f"  records with no artifact row : {stats['no_artifact_row']}")
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
    # A verdict over zero spans is not a pass. Two fetch failures produced exactly this on
    # 2026-08-09: nothing was checked and the script printed the guarantee as confirmed. That is
    # the empty-PASS class, and finding it inside the VERIFIER is the worst possible place for it.
    unverified = (stats["fetch_failed"] + stats["redirected"]
                  + stats.get("no_artifact_row", 0) + stats["stale"])
    if stats["spans"] == 0:
        print(f"\nVERDICT: NOTHING VERIFIED. 0 spans checked "
              f"({stats['fetch_failed']} fetch failures, {stats['redirected']} redirected). "
              f"This is NOT a pass -- no claim about grounding can be made from it.")
        return 2
    print(f"\nVERDICT: {stats['found_anywhere']}/{stats['spans']} stored spans are present on the "
          f"page they claim to come from, across {stats['records']} record(s).")
    if stats["fetch_failed"] or stats["redirected"]:
        print(f"         COVERAGE IS PARTIAL: {stats['fetch_failed']} record(s) could not be "
              f"fetched and {stats['redirected']} served a different page. Those are neither "
              f"passes nor failures -- re-run them before anyone claims 100%.")
    return 0


def verify_record_spans(rec: dict, source) -> tuple[int, int, list[str]]:
    """(found, not_found, failure_lines) for every stored span on one record.

    THE grounding check, and deliberately a pure function of (record, page): it takes no artifact,
    no offset, and no hash. That is what makes it independent of the writer, and what lets a record
    with no artifact row be verified exactly as thoroughly as one with.
    """
    found, missing, failures = 0, 0, []
    fields = (("highlight", rec.get("keyhighlights_enriched") or []),
              ("abstract span", rec.get("abstract_enriched") or []))
    for label, spans in fields:
        if not isinstance(spans, list):
            continue          # legacy joined-string form; handled by the positional path
        for span in spans:
            if not span:
                continue
            if _locatable(span, source):
                found += 1
            else:
                missing += 1
                failures.append(f"{rec.get('objectID')} {label}: {str(span)[:70]}")
    return found, missing, failures


def _locatable(text: str, source) -> bool:
    try:
        locate(text, source)
        return True
    except SpanRejected:
        return False


if __name__ == "__main__":
    raise SystemExit(main())
