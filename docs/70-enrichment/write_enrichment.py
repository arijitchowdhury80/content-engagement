#!/usr/bin/env python3
"""
Write enrichment results to Algolia_Prod_Copy_Enhanced.

THE ONLY SCRIPT IN THIS PIPELINE THAT TOUCHES THE INDEX.

SAFETY, in the order the checks run
  1. --dry-run is the DEFAULT. --apply also requires --yes.
  2. A snapshot must exist AND match the live record count. A snapshot taken before some other
     change is not a rollback for this one.
  3. Every record must carry a full provenance block or it is not written. No partial writes.
  4. partialUpdateObjectNoCreate, never addObject: if an objectID has vanished the write fails
     loudly instead of silently creating a stub record.
  5. Writes ADD fields only. Nothing existing is overwritten -- `abstract` and `description` are
     left exactly as they are, so this is reversible by deleting two fields.
     (partialUpdateObject cannot remove an attribute; setting one to null stores a literal null,
      which put 96,039 nulls in a live index on 2026-08-05. So: only ever add.)
  6. After writing, the LIVE index is re-read and the written values compared field by field.
     Verified on the surface the change was made to, never inferred from a 200 response.

WHAT GETS WRITTEN
  verdict REAL  -> abstract_enriched + keyhighlights_enriched + provenance
  verdict THIN  -> provenance + verdict + reason, NO abstract. A gap that is recorded is
                   countable; a gap that is absent is invisible.
  verdict DEAD  -> same. Never deleted -- a 404 today can be a deploy blip.
  quarantined   -> nothing at all.

  python3 docs/70-enrichment/write_enrichment.py --results <dir> [<dir> ...]
  python3 docs/70-enrichment/write_enrichment.py --results <dir> --apply --yes
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
WRITABLE = {"PASS", "NO_ABSTRACT_THIN", "NO_ABSTRACT_DEAD"}

# Every field this pipeline is allowed to create. Anything outside this set is a bug, and the
# script asserts it before writing -- that is what stops an accidental overwrite of `abstract`.
ALLOWED_FIELDS = {
    "abstract_enriched", "keyhighlights_enriched",
    "enrichment_verdict", "enrichment_reason", "enrichment_source_url",
    "enrichment_fetch_path", "enrichment_content_hash", "enrichment_fetched_at",
    "enrichment_span_offsets", "enrichment_writer_model", "enrichment_judge_model",
    "enrichment_prompt_version", "enrichment_validated_at", "enrichment_truncated",
    "enrichment_judge_scores", "enrichment_dropped_fabrications",
}
PROTECTED = {"abstract", "description", "title", "url", "objectID", "page_type",
             "language_code", "environment", "indexed_at", "source"}


def build_payload(r: dict) -> dict | None:
    """Turn one pipeline result into an Algolia partial-update payload, or None if unwritable."""
    if r.get("status") not in WRITABLE:
        return None
    verdict = r.get("verdict")
    if verdict not in {"REAL", "THIN", "DEAD"}:
        return None

    payload: dict = {
        "objectID": r["objectID"],
        "enrichment_verdict": verdict,
        "enrichment_source_url": r.get("source_url"),
        "enrichment_fetch_path": r.get("fetch_path"),
        "enrichment_content_hash": r.get("content_hash"),
        "enrichment_fetched_at": r.get("processed_at"),
        "enrichment_writer_model": r.get("writer_model"),
        "enrichment_judge_model": r.get("judge_model"),
        "enrichment_prompt_version": r.get("prompt_version"),
        "enrichment_truncated": bool(r.get("truncated")),
        "enrichment_validated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
    }
    if verdict == "REAL":
        if not r.get("abstract_enriched"):
            return None
        # ARRAY, not a joined paragraph. See note above: a pre-joined string bakes a false
        # adjacency into the index. Algolia indexes string arrays natively, so searchable
        # attributes and snippets work unchanged.
        spans = r.get("abstract_spans_stored") or []
        if not spans:
            return None          # refuse to fall back to the joined string
        payload["abstract_enriched"] = spans
        payload["keyhighlights_enriched"] = r.get("keyhighlights_enriched") or []
        payload["enrichment_span_offsets"] = [list(o) for o in (r.get("span_offsets") or [])]
        # Written so the index itself records that the writer invented something on this page and
        # it was thrown away. Auditable after the fact without re-running anything.
        payload["enrichment_dropped_fabrications"] = int(r.get("dropped_fabrications") or 0)
        j = r.get("judge") or {}
        payload["enrichment_judge_scores"] = {
            k: j.get(k) for k in ("representativeness", "specificity", "missed_substance",
                                  "coherence", "juxtaposition", "verdict") if j.get(k) is not None
        }
    else:
        payload["enrichment_reason"] = r.get("insufficient_reason")

    # provenance completeness (G9) -- no half-written records
    required = ["enrichment_verdict", "enrichment_source_url", "enrichment_content_hash",
                "enrichment_fetched_at", "enrichment_writer_model", "enrichment_prompt_version"]
    if any(not payload.get(k) for k in required):
        return None
    stray = set(payload) - ALLOWED_FIELDS - {"objectID"}
    if stray:
        sys.exit(f"FATAL: payload would write disallowed fields {stray}. Refusing.")
    if set(payload) & PROTECTED - {"objectID"}:
        sys.exit(f"FATAL: payload would touch protected fields. Refusing.")
    return payload


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--results", nargs="+", required=True,
                    help="report directories containing results.jsonl")
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--yes", action="store_true")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--index", default=INDEX)
    args = ap.parse_args()

    app, key = load_credentials()

    # ---- load results -----------------------------------------------------
    results: list[dict] = []
    for d in args.results:
        p = pathlib.Path(d) / "results.jsonl"
        if not p.exists():
            sys.exit(f"FATAL: {p} not found")
        results += [json.loads(l) for l in p.open()]
    payloads, skipped = [], 0
    seen: set[str] = set()
    for r in results:
        pl = build_payload(r)
        if pl is None:
            skipped += 1
            continue
        if pl["objectID"] in seen:      # same record in both batches -> keep the first
            continue
        seen.add(pl["objectID"])
        payloads.append(pl)
    if args.limit:
        payloads = payloads[: args.limit]

    verdicts: dict[str, int] = {}
    for pl in payloads:
        verdicts[pl["enrichment_verdict"]] = verdicts.get(pl["enrichment_verdict"], 0) + 1
    print(f"results loaded : {len(results)}")
    print(f"writable       : {len(payloads)}   {verdicts}")
    print(f"skipped        : {skipped} (quarantined, judge-revise, or incomplete provenance)")

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
        # judge_scores/offsets round-trip through JSON; compare loosely on those two
        bad = [k for k in bad if k not in ("enrichment_judge_scores", "enrichment_span_offsets")
               or json.dumps(rec.get(k), sort_keys=True) != json.dumps(pl[k], sort_keys=True)]
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
