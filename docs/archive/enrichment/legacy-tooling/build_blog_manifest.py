#!/usr/bin/env python3
"""
build_blog_manifest — one canonical cache row per blog objectID, with its provenance recorded.

WHY THIS EXISTS
  Blog bodies were fetched more than once. `cache-scout/corpus/` and `cache-scout/corpus-quarantine/`
  BOTH hold a file for the same objectID for 2,139 of the 2,800 blog records: the quarantine copy
  is the rate-limited failure, the corpus copy is the successful retry.

  Nothing in the pipeline said which copy wins. Measured 2026-08-09 on the same directory tree in
  the same minute:

      resolved by first glob match  ->    365 ok, 2,435 errors
      resolved by best-of           ->  2,504 ok,   296 errors

  Both are "the blog cache". Which number you get depends on filesystem ordering, and the wrong
  one silently drops 2,139 perfectly good bodies. `enrich_run.py` then filters out `fetch_error`
  rows, so the loss looks like a smaller corpus rather than an error.

THE RULE
  An ok copy always beats an error copy. Among ok copies, the newest `fetched_at` wins -- a later
  successful fetch is a later observation of the page, and staleness is the thing verification
  cares about. Ties break on path, so two runs of this script produce byte-identical output.

WHAT IT REFUSES TO DO
  Guess. Every objectID in the queue must resolve to exactly one file or be reported as having
  none. The provenance file records which file each ID resolved to, so a later "where did this
  body come from?" is answerable without re-deriving anything.

    python3 build_blog_manifest.py --out cache-scout/blog --skip-ids reports/blog-skip-ids.json
"""

from __future__ import annotations

import argparse
import collections
import json
import pathlib
import sys

HERE = pathlib.Path(__file__).parent
QUEUE_PATH = HERE / "work-queue.jsonl"
CACHE_ROOT = HERE / "cache-scout"

sys.path.insert(0, str(HERE))
from verdicts import dead_page_reason  # noqa: E402


def load_blog_queue(source: str = "Blog") -> list[dict]:
    rows = [json.loads(l) for l in QUEUE_PATH.open() if l.strip()]
    blog = [r for r in rows if r.get("source") == source]
    if not blog:
        sys.exit(f"FATAL: no records with source {source!r} in {QUEUE_PATH}")
    return blog


def index_cache(cache_root: pathlib.Path) -> dict[str, list[pathlib.Path]]:
    """objectID -> every cache file that claims it, anywhere under the Scout cache tree."""
    by_id: dict[str, list[pathlib.Path]] = collections.defaultdict(list)
    for p in cache_root.rglob("*.json"):
        if p.name in {"pilot-manifest.json", "run-summary.json"}:
            continue
        by_id[p.stem].append(p)
    return by_id


def pick_best(paths: list[pathlib.Path]) -> tuple[dict | None, pathlib.Path | None, list[dict]]:
    """(chosen row, chosen path, all rejected rows). Ok beats error; newest ok wins."""
    loaded: list[tuple[pathlib.Path, dict]] = []
    for p in sorted(paths):
        try:
            loaded.append((p, json.loads(p.read_text())))
        except (json.JSONDecodeError, OSError):
            continue           # a corrupt cache file is not a body; it is also not a silent drop
    if not loaded:
        return None, None, []
    ok = [(p, d) for p, d in loaded if not d.get("fetch_error")]
    if ok:
        # newest fetched_at, then path, so the choice is deterministic across runs
        p, d = max(ok, key=lambda pd: (pd[1].get("fetched_at") or "", str(pd[0])))
        return d, p, [x for _, x in loaded if x is not d]
    p, d = sorted(loaded, key=lambda pd: str(pd[0]))[0]
    return d, p, [x for _, x in loaded if x is not d]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--source", default="Blog")
    ap.add_argument("--cache", default=str(CACHE_ROOT))
    ap.add_argument("--out", default=str(HERE / "cache-scout" / "blog"))
    ap.add_argument("--skip-ids", default="", help="JSON array of objectIDs to exclude entirely")
    ap.add_argument("--reports", default=str(HERE / "reports"))
    ap.add_argument("--size", type=int, default=25,
                    help="records per batch. 25, not 50: a failure isolates faster and a retry "
                         "wastes less")
    ap.add_argument("--batches-out", default=str(HERE / "batches-blog"),
                    help="queue-shaped batch manifests for run_batches.py")
    ap.add_argument("--refetch-batches-out", default=str(HERE / "batches-blog-refetch"),
                    help="separate batch set for records Scout has not returned yet")
    ap.add_argument("--no-batches", action="store_true", help="manifest and reports only")
    args = ap.parse_args()

    queue = load_blog_queue(args.source)
    skip: set[str] = set()
    if args.skip_ids:
        skip = set(json.loads(pathlib.Path(args.skip_ids).read_text()))

    by_id = index_cache(pathlib.Path(args.cache))

    resolved: list[dict] = []
    provenance: dict[str, dict] = {}
    stats = collections.Counter()
    dead_ids: list[str] = []
    missing_ids: list[str] = []
    refetch_ids: list[str] = []

    for rec in queue:
        oid = rec["objectID"]
        if oid in skip:
            stats["skipped_already_enriched"] += 1
            continue

        row, path, rejected = pick_best(by_id.get(oid, []))
        if row is None:
            stats["no_cache_file"] += 1
            missing_ids.append(oid)
            refetch_ids.append(oid)
            provenance[oid] = {"chosen": None, "reason": "no cache file"}
            continue

        # Carry the queue's own metadata forward. The cache file has it too, but the queue is the
        # authority on what the record IS; the cache is only the authority on what the page SAID.
        merged = dict(row)
        for k in ("page_type", "family", "language_code", "source", "title", "description", "url"):
            if rec.get(k) is not None:
                merged[k] = rec[k]

        provenance[oid] = {
            "chosen": str(path.relative_to(HERE)),
            "candidates": len(by_id.get(oid, [])),
            "rejected_error_copies": sum(1 for r in rejected if r.get("fetch_error")),
            "fetched_at": row.get("fetched_at"),
            "http_status": row.get("http_status"),
        }

        if row.get("fetch_error"):
            stats["fetch_error"] += 1
            refetch_ids.append(oid)
            resolved.append(merged)
            continue

        dead = dead_page_reason(row.get("markdown"))
        if dead:
            stats["dead_page"] += 1
            dead_ids.append(oid)
            provenance[oid]["dead_page_reason"] = dead
            resolved.append(merged)
            continue

        stats["enrichable"] += 1
        resolved.append(merged)

    # ---- assertions: the partition must reconcile against the QUEUE, not against itself --------
    accounted = (stats["enrichable"] + stats["dead_page"] + stats["fetch_error"]
                 + stats["no_cache_file"] + stats["skipped_already_enriched"])
    if accounted != len(queue):
        sys.exit(f"FATAL: {accounted} accounted vs {len(queue)} in queue. A record vanished.")
    ids = [r["objectID"] for r in resolved]
    if len(ids) != len(set(ids)):
        sys.exit("FATAL: an objectID resolved twice.")

    out_dir = pathlib.Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "pilot-manifest.json").write_text(
        json.dumps(resolved, ensure_ascii=False, indent=1))

    reports = pathlib.Path(args.reports)
    reports.mkdir(parents=True, exist_ok=True)
    (reports / "blog-manifest-provenance.json").write_text(json.dumps(provenance, indent=1))
    (reports / "blog-refetch-ids.json").write_text(json.dumps(sorted(refetch_ids), indent=1))
    (reports / "blog-dead-page-ids.json").write_text(json.dumps(sorted(dead_ids), indent=1))

    print(f"queue ({args.source}){'':10}{len(queue):6}")
    print(f"  skipped, already enriched  {stats['skipped_already_enriched']:6}")
    print(f"  no cache file              {stats['no_cache_file']:6}")
    print(f"  fetch_error, needs refetch {stats['fetch_error']:6}")
    print(f"  dead page                  {stats['dead_page']:6}")
    print(f"  ENRICHABLE                 {stats['enrichable']:6}")
    print(f"  {'-'*27}")
    print(f"  accounted                  {accounted:6}  == queue ✓")
    print()
    print(f"manifest rows                {len(resolved):6}  -> {out_dir/'pilot-manifest.json'}")
    print(f"needs Scout refetch          {len(refetch_ids):6}  -> reports/blog-refetch-ids.json")
    print(f"dead pages                   {len(dead_ids):6}  -> reports/blog-dead-page-ids.json")
    print(f"provenance recorded for      {len(provenance):6}  -> reports/blog-manifest-provenance.json")

    multi = sum(1 for v in provenance.values() if (v.get("candidates") or 0) > 1)
    print(f"\nobjectIDs with >1 cache copy {multi:6}  "
          f"(resolved ok-beats-error, newest-wins; see provenance)")

    if args.no_batches:
        return 0

    # ---- split into batches -------------------------------------------------------------------
    #
    # Two SEPARATE batch sets, because they are waiting on different things.
    #
    #   with a body   -> ready to enrich the moment enrichment is authorised. Includes the dead
    #                    pages: `verdicts.classify` gives them DEAD_PAGE before any model call, so
    #                    they cost nothing and they produce the counted outcome the definition of
    #                    done requires. Excluding them would leave 95 records with no row at all,
    #                    which is the silent-skip failure this whole plan exists to prevent.
    #   needs refetch -> blocked on Scout. Kept apart so a Scout outage cannot stall 2,419 records
    #                    that already have their text, and so no batch is all-error (an all-error
    #                    batch is exactly the vacuous-PASS shape enrich_run now refuses).
    have_body = [r for r in resolved if not r.get("fetch_error")]
    need_fetch = [r for r in resolved if r.get("fetch_error")]

    def write_set(rows: list[dict], batch_dir: pathlib.Path, prefix: str,
                  cache_dir: pathlib.Path | None) -> int:
        batch_dir.mkdir(parents=True, exist_ok=True)
        n = 0
        for i in range(0, len(rows), args.size):
            chunk = rows[i:i + args.size]
            bid = f"{prefix}-{i // args.size + 1:03d}"
            (batch_dir / f"{bid}.json").write_text(
                json.dumps(chunk, ensure_ascii=False, indent=1))
            if cache_dir is not None:
                # Pre-populate the FETCHED manifest run_batches looks for. It re-fetches only when
                # a row carries fetch_error, so a clean manifest means Scout is never called for
                # these 2,419 pages -- the bodies are already on disk.
                d = cache_dir / bid
                d.mkdir(parents=True, exist_ok=True)
                (d / "pilot-manifest.json").write_text(
                    json.dumps(chunk, ensure_ascii=False, indent=1))
            n += 1
        return n

    nb = write_set(have_body, pathlib.Path(args.batches_out), "blog",
                   pathlib.Path(args.out).parent / "blog-batches")
    nr = write_set(need_fetch, pathlib.Path(args.refetch_batches_out), "blog-refetch", None)

    print()
    print(f"batches, body on disk        {nb:6}  x{args.size}  -> {args.batches_out}/")
    print(f"  cache pre-populated                 -> "
          f"{pathlib.Path(args.out).parent / 'blog-batches'}/  (Scout will NOT be called)")
    print(f"batches, need Scout refetch  {nr:6}  x{args.size}  -> {args.refetch_batches_out}/")
    print(f"\nrecords with a body          {len(have_body):6}  "
          f"({stats['enrichable']} enrichable + {stats['dead_page']} dead-page verdicts)")
    print(f"records awaiting Scout       {len(need_fetch):6}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
