#!/usr/bin/env python3
"""
Write enrichment results to Algolia_Prod_Copy_Enhanced.

THE ONLY SCRIPT IN THIS PIPELINE THAT TOUCHES THE INDEX.

SAFETY, in the order the checks run
  1. --dry-run is the DEFAULT. --apply also requires --yes.
  2. A snapshot must exist AND match the live record count. A snapshot taken before some other
     change is not a rollback for this one.
  3. Only successfully enriched records are written. Honest non-enrichment verdicts remain in
     external run artifacts, not on Algolia records.
  4. partialUpdateObjectNoCreate, never addObject: if an objectID has vanished the write fails
     loudly instead of silently creating a stub record.
  5. Writes ADD fields only. Nothing existing is overwritten -- `abstract` and `description` are
     left exactly as they are, so this is reversible by deleting two fields.
     (partialUpdateObject cannot remove an attribute; setting one to null stores a literal null,
      which put 96,039 nulls in a live index on 2026-08-05. So: only ever add.)
  6. After writing, the LIVE index is re-read and the written values compared field by field.
     Verified on the surface the change was made to, never inferred from a 200 response.

WHAT GETS WRITTEN
  verdict REAL  -> abstract_enriched + keyhighlights_enriched
  THIN / DEAD / LOGIN / FETCH_FAILED / REDIRECT_* / EXCLUDED -> nothing on the record.

  Provenance, offsets, hashes, verdicts, redirect reasons, model IDs and verification evidence live
  in external run artifacts. Arijit, 2026-08-09: the live records stay lean and should not be polluted
  with audit metadata.

  python3 docs/operations/enrichment/write_enrichment.py --results <dir> [<dir> ...]
  python3 docs/operations/enrichment/write_enrichment.py --results <dir> --apply --yes
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import pathlib
import subprocess
import sys

HERE = pathlib.Path(__file__).parent
sys.path.insert(0, str(HERE))
from snapshot_enhanced import algolia_post, live_record_count, load_credentials  # noqa: E402
from delete_records import newest_snapshot  # noqa: E402

INDEX = "Algolia_Prod_Copy_Enhanced"
WRITABLE = {"PASS", "JUDGE_REVISE"}

# Every field this pipeline is allowed to create. Anything outside this set is a bug, and the
# script asserts it before writing -- that is what stops an accidental overwrite of `abstract`.
ALLOWED_FIELDS = {
    "abstract_enriched", "keyhighlights_enriched",
}
PROTECTED = {"abstract", "description", "title", "url", "objectID", "page_type",
             "language_code", "environment", "indexed_at", "source"}


def build_payload(r: dict) -> dict | None:
    """Turn one pipeline result into an Algolia partial-update payload, or None if unwritable."""
    if r.get("status") not in WRITABLE:
        return None
    if r.get("verdict") != "REAL":
        return None

    if not r.get("abstract_enriched"):
        return None
    # ARRAY, not a joined paragraph. See note above: a pre-joined string bakes a false adjacency
    # into the index. Algolia indexes string arrays natively, so searchable attributes and snippets
    # work unchanged.
    spans = r.get("abstract_spans_stored") or []
    if not spans:
        return None          # refuse to fall back to the joined string

    payload: dict = {
        "objectID": r["objectID"],
        "abstract_enriched": spans,
        "keyhighlights_enriched": r.get("keyhighlights_enriched") or [],
    }
    if not payload["abstract_enriched"]:
        return None
    stray = set(payload) - ALLOWED_FIELDS - {"objectID"}
    if stray:
        sys.exit(f"FATAL: payload would write disallowed fields {stray}. Refusing.")
    if set(payload) & PROTECTED - {"objectID"}:
        sys.exit(f"FATAL: payload would touch protected fields. Refusing.")
    return payload


def build_payloads(results: list[dict], limit: int = 0,
                   skip_ids: set[str] | None = None) -> tuple[list[dict], int, list[str]]:
    """Build write payloads from result rows, refusing corrupt duplicate result streams.

    `skip_ids` are objectIDs that must NOT be written even when the row is perfectly writable --
    records that already carry a verified `abstract_enriched`. 86 blog records were enriched and
    span-verified on 2026-08-09; `partialUpdateObjectNoCreate` would overwrite each of them with a
    fresh abstract cut from a re-fetched candidate pool, silently discarding verified work.
    Arijit's ruling: skip them.

    Returns the skipped IDs, not just a count, because a silent skip and a silent overwrite fail
    the same way -- the total looks right either way and nobody looks again.
    """
    skip_ids = skip_ids or set()
    payloads, skipped = [], 0
    skipped_ids: list[str] = []
    seen_rows: set[str] = set()
    seen_payloads: set[str] = set()
    for r in results:
        oid = r.get("objectID")
        if not oid:
            skipped += 1
            continue
        if oid in skip_ids:
            skipped += 1
            skipped_ids.append(oid)
            continue
        if oid in seen_rows:
            sys.exit(f"FATAL: duplicate objectID {oid!r} in results. Re-run the corrupt batch.")
        seen_rows.add(oid)

        pl = build_payload(r)
        if pl is None:
            skipped += 1
            continue
        if pl["objectID"] in seen_payloads:
            sys.exit(f"FATAL: duplicate objectID {pl['objectID']!r} in payloads.")
        seen_payloads.add(pl["objectID"])
        payloads.append(pl)
        if limit and len(payloads) >= limit:
            break
    return payloads, skipped, skipped_ids


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--results", nargs="+", required=True,
                    help="report directories containing results.jsonl")
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--yes", action="store_true")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--index", default=INDEX)
    ap.add_argument("--skip-ids", default="", metavar="FILE",
                    help="JSON array of objectIDs that must not be written -- records already "
                         "carrying a verified abstract_enriched. The list is printed, not silent")
    args = ap.parse_args()

    app, key = load_credentials()

    # ---- load results -----------------------------------------------------
    results: list[dict] = []
    for d in args.results:
        p = pathlib.Path(d) / "results.jsonl"
        if not p.exists():
            sys.exit(f"FATAL: {p} not found")
        results += [json.loads(l) for l in p.open()]
    skip_ids: set[str] = set()
    if args.skip_ids:
        skip_ids = set(json.loads(pathlib.Path(args.skip_ids).read_text()))
    payloads, skipped, skipped_ids = build_payloads(results, args.limit, skip_ids=skip_ids)

    statuses: dict[str, int] = {}
    for pl in payloads:
        statuses["REAL"] = statuses.get("REAL", 0) + 1
    print(f"results loaded : {len(results)}")
    print(f"writable       : {len(payloads)}   {statuses}")
    if skip_ids:
        print(f"skipped by --skip-ids : {len(skipped_ids)} of {len(skip_ids)} listed")
        for oid in skipped_ids[:10]:
            print(f"    {oid}")
        if len(skipped_ids) > 10:
            print(f"    ... and {len(skipped_ids) - 10} more")
    print(f"skipped        : {skipped} (non-enrichment verdicts, quarantined, or incomplete REAL rows)")

    # ---- snapshot gate ----------------------------------------------------
    _, live = live_record_count(app, key, args.index)
    snap = newest_snapshot(args.index, HERE / "snapshots")
    if snap is None:
        sys.exit("FATAL: no snapshot. Run snapshot_enhanced.py first -- it is the only rollback.")
    snap_path, snap_count = snap
    print(f"live records   : {live}")
    print(f"snapshot       : {snap_path.name} ({snap_count})")
    if snap_count != live:
        sys.exit(f"FATAL: snapshot has {snap_count} records, live index has {live}. "
                 f"That snapshot predates another change. Take a fresh one.")

    sample = payloads[0] if payloads else {}
    print(f"\nfields this write would add: {sorted(set(sample) - {'objectID'})}")
    print(f"fields it will NOT touch    : abstract, description, title, url, taxonomy_*")

    if not args.apply:
        print(f"\nDRY RUN. Nothing written. {len(payloads)} records would be updated.")
        return 0
    if not args.yes:
        sys.exit("FATAL: --apply requires --yes.")

    # ---- record the intent BEFORE writing ---------------------------------
    stamp = dt.datetime.now().strftime("%Y%m%d-%H%M%S")
    manifest = HERE / "reports" / f"written-{stamp}.json"
    manifest.parent.mkdir(parents=True, exist_ok=True)
    manifest.write_text(json.dumps({"index": args.index, "written_at": stamp,
                                    "count": len(payloads), "snapshot": snap_path.name,
                                    "objectIDs": [p["objectID"] for p in payloads]}, indent=2))
    print(f"\nwrote intent manifest first: {manifest.name}")

    # ---- write ------------------------------------------------------------
    for i in range(0, len(payloads), 100):
        batch = payloads[i : i + 100]
        algolia_post(app, key, f"/1/indexes/{args.index}/batch",
                     {"requests": [{"action": "partialUpdateObjectNoCreate", "body": b}
                                   for b in batch]})
        print(f"  wrote {min(i + 100, len(payloads))}/{len(payloads)}")

    # ---- verify on the live index ----------------------------------------
    print("\nwaiting for indexing, then reading the LIVE index back...")
    subprocess.run(["sleep", "10"], check=False)
    ids = [p["objectID"] for p in payloads]
    got = algolia_post(app, key, "/1/indexes/*/objects",
                       {"requests": [{"indexName": args.index, "objectID": o} for o in ids]})
    live_by_id = {r["objectID"]: r for r in got.get("results", []) if r}
    ok = mismatch = missing = 0
    for pl in payloads:
        rec = live_by_id.get(pl["objectID"])
        if rec is None:
            missing += 1
            continue
        bad = [k for k, v in pl.items() if k != "objectID" and rec.get(k) != v]
        if bad:
            mismatch += 1
            if mismatch <= 3:
                print(f"   MISMATCH {pl['objectID']}: {bad[:4]}")
        else:
            ok += 1
    _, after = live_record_count(app, key, args.index)
    print(f"\nverified on live index: {ok} exact, {mismatch} mismatched, {missing} missing")
    print(f"record count {live} -> {after} (must be unchanged; this write only adds fields)")
    if mismatch or missing or after != live:
        sys.exit("FAILED VERIFICATION. Investigate before writing more.")
    print(f"\nOK: {ok} records enriched and confirmed on the live index.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
