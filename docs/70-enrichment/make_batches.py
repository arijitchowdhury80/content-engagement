#!/usr/bin/env python3
"""
Split the work queue into batch manifests, one file per batch of 50.

WHY THIS EXISTS
  `enrich_run.py` selects records with `--manifest <json array>` plus `--limit N`, and --limit
  takes the FIRST N. There is no offset and no slice, so there is no way to say "records 50-100".
  A parallel run needs each worker pointed at a disjoint set of records, so the slicing has to
  happen before the runner sees it: one manifest file per batch.

WHY BATCHES ARE HOMOGENEOUS, NOT RANDOM
  Grouped by (fetch_path, family). A mixed batch that scores badly tells you nothing -- you cannot
  tell whether the docs records or the blog records dragged it down. A homogeneous batch that
  scores badly names its own cause. It also lets the calibration gate run ONE batch of pure
  doc-md-twin/reference records, which is 43% of the corpus and the only family with a known
  quality problem (Arijit's review: all 3 doc-rest-api records "not good").

WHAT IS EXCLUDED, AND WHY IT IS NOT A FILTER BUG
  `excluded-support`   1,695 records -- Arijit's decision. Support engineers wrote those answers
                       and we do not reword them.
  `auth-wall`            142 records -- academy.algolia.com behind a login. The fetch path returns
                       the login page's raw HTML, so every one is correctly DEAD.
  Both are excluded from the ENRICHABLE set by design, not skipped silently: the summary prints
  them so the numbers reconcile against the 12,035 in the index.

    python3 docs/70-enrichment/make_batches.py --out batches
    python3 docs/70-enrichment/make_batches.py --out batches --only doc-md-twin/reference
"""

from __future__ import annotations

import argparse
import collections
import json
import pathlib
import sys

HERE = pathlib.Path(__file__).parent
QUEUE_PATH = HERE / "work-queue.jsonl"

BATCH_SIZE = 50

# Fetch paths that are not enrichable. Named, not inferred, so a new path added upstream shows up
# as an unexpected group in the summary instead of being silently swept into a batch.
EXCLUDED_PATHS = {"excluded-support", "auth-wall"}


def load_queue(path: pathlib.Path = QUEUE_PATH) -> list[dict]:
    if not path.exists():
        sys.exit(f"FATAL: {path} not found. Run `fetch_router.py --build-queue` first.")
    return [json.loads(line) for line in path.open() if line.strip()]


def group_key(rec: dict) -> str:
    return f"{rec.get('fetch_path')}/{rec.get('family')}"


def make_batches(queue: list[dict], size: int = BATCH_SIZE) -> dict[str, list[list[dict]]]:
    """{group: [batch, batch, ...]} for enrichable records only, in stable queue order."""
    groups: dict[str, list[dict]] = collections.defaultdict(list)
    for rec in queue:
        if rec.get("fetch_path") in EXCLUDED_PATHS:
            continue
        groups[group_key(rec)].append(rec)
    return {
        g: [recs[i:i + size] for i in range(0, len(recs), size)]
        for g, recs in sorted(groups.items())
    }


def batch_id(group: str, n: int) -> str:
    return f"{group.replace('/', '-')}-{n:03d}"


def write_batches(batches: dict[str, list[list[dict]]], out: pathlib.Path) -> list[pathlib.Path]:
    out.mkdir(parents=True, exist_ok=True)
    written: list[pathlib.Path] = []
    for group, chunks in batches.items():
        for n, chunk in enumerate(chunks, 1):
            path = out / f"{batch_id(group, n)}.json"
            path.write_text(json.dumps(chunk, ensure_ascii=False, indent=1))
            written.append(path)
    return written


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", default=str(HERE / "batches"))
    ap.add_argument("--size", type=int, default=BATCH_SIZE)
    ap.add_argument("--only", default="", metavar="fetch_path/family",
                    help="write only this group -- used by the calibration gate")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    queue = load_queue()
    batches = make_batches(queue, args.size)

    if args.only:
        if args.only not in batches:
            sys.exit(f"FATAL: no group {args.only!r}. Known: {sorted(batches)}")
        batches = {args.only: batches[args.only]}

    excluded = collections.Counter(
        r.get("fetch_path") for r in queue if r.get("fetch_path") in EXCLUDED_PATHS)
    enrichable = sum(len(c) for chunks in batches.values() for c in chunks)

    print(f"queue            {len(queue):6}")
    for path, n in sorted(excluded.items()):
        print(f"  excluded       {n:6}  {path}")
    print(f"enrichable       {enrichable:6}")
    print()
    print(f"{'group':34}{'records':>9}{'batches':>9}")
    total_batches = 0
    for group, chunks in batches.items():
        n = sum(len(c) for c in chunks)
        total_batches += len(chunks)
        print(f"  {group:32}{n:>9}{len(chunks):>9}")
    print(f"  {'TOTAL':32}{enrichable:>9}{total_batches:>9}")

    # The partition must be exhaustive and non-overlapping, or records vanish or double-write.
    # Asserted here rather than trusted, because a silent gap looks exactly like a smaller corpus.
    ids = [r["objectID"] for chunks in batches.values() for c in chunks for r in c]
    assert len(ids) == len(set(ids)), "FATAL: an objectID appears in two batches"
    if not args.only:
        expected = [r["objectID"] for r in queue if r.get("fetch_path") not in EXCLUDED_PATHS]
        assert set(ids) == set(expected), "FATAL: batches do not cover every enrichable record"

    if args.dry_run:
        print("\n--dry-run: nothing written")
        return 0

    written = write_batches(batches, pathlib.Path(args.out))
    print(f"\nwrote {len(written)} manifests to {args.out}/")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
