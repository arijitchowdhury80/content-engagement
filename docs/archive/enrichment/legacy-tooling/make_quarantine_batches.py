#!/usr/bin/env python3
"""
Build a batch set from the records a prior run QUARANTINED, reusing their cached Scout bodies.

WHY THIS AND NOT make_batches.py
  `make_batches.py` splits the work QUEUE. This splits a RESULT SET: "every record the last run
  refused, with the exact page text it refused it on". Re-fetching would change the source under
  the comparison and could not answer the only question that matters -- was the refusal about the
  page, or about the selection? Same bytes in, so any difference in the outcome is the pipeline's.

  It writes the fetched manifest directly, so `run_batches.py` finds a complete cache and never
  calls the fetcher. That is also what keeps rule 1 true: Scout-fetched content, and only that.

USAGE
    python3 docs/operations/enrichment/make_quarantine_batches.py \\
        --status QUARANTINED_BY_GATE --tag repair3
    python3 docs/operations/enrichment/run_batches.py \\
        --batches docs/operations/enrichment/batches-blog-repair3 \\
        --out     docs/operations/enrichment/batches-out-blog-repair3 \\
        --cache   docs/operations/enrichment/cache-scout/blog-repair3-batches --workers 8

THE PRECEDENCE RULE IS HERE BECAUSE IT LIVES NOWHERE ELSE
  The blog corpus is spread over five output folders that supersede each other BY objectID, and
  that ordering has so far existed only in prose in SESSION.md. It is `EFFECTIVE_ORDER` below, and
  `--results` overrides it, so a future source states its own order instead of inheriting this one.
"""

from __future__ import annotations

import argparse
import collections
import glob
import json
import pathlib
import sys

HERE = pathlib.Path(__file__).parent

# Last wins. THE single definition of the blog corpus's folder precedence -- it used to live only
# in prose in SESSION.md, which meant every consumer re-derived it and could get it wrong.
#
#   blog / r2 / repair / repair2   the original run and its two repair passes
#   legacy                        the 85 pre-existing records, re-enriched, never written
#   repair3                       the 589 gate-quarantined records, recovered 2026-08-10
#   repair4                       the 12 records whose stored spans the canonicalise fix
#                                 invalidated -- `a .NET` had been collapsed to `a.NET`, so the
#                                 stored text was no longer findable in its own page
EFFECTIVE_ORDER = [
    "batches-out-blog",
    "batches-out-blog-r2",
    "batches-out-blog-repair",
    "batches-out-blog-repair2",
    "batches-out-blog-legacy",
    "batches-out-blog-repair3",
    "batches-out-blog-repair4",
]

# Every field enrich_run.process() reads off a record. Carried through verbatim from the cached
# fetch, because a missing `family` or `original_length` silently changes a gate's behaviour rather
# than raising.
FETCH_FIELDS = (
    "objectID", "url", "source_url", "fetch_path", "fetched_at", "served_url",
    "redirect_mismatch", "markdown", "content_hash", "http_status", "truncated",
    "original_length", "fetch_error", "page_type", "family", "language_code",
    "source", "title", "description", "pilot_reason",
)


def effective_corpus(roots: list[str]) -> dict[str, dict]:
    eff: dict[str, dict] = {}
    for root in roots:
        for path in sorted(glob.glob(str(HERE / root / "*" / "results.jsonl"))):
            for line in open(path):
                if line.strip():
                    row = json.loads(line)
                    eff[row["objectID"]] = row
    return eff


def cached_bodies(cache_glob: str) -> dict[str, dict]:
    """objectID -> the fetched row that carries `markdown`.

    FIRST WIN, not last. Several cache trees hold an error copy and an ok copy of the same
    objectIDs -- that is exactly how the 2026-08-09 run got pointed at a manifest of 2,139 failed
    fetches. Rows with a fetch_error are skipped outright, so a good body can never be shadowed by
    a failed one regardless of which tree is walked first.
    """
    bodies: dict[str, dict] = {}
    for path in sorted(glob.glob(cache_glob)):
        try:
            rows = json.loads(pathlib.Path(path).read_text())
        except (json.JSONDecodeError, OSError):
            continue
        for row in rows:
            if row.get("fetch_error") or not row.get("markdown"):
                continue
            bodies.setdefault(row["objectID"], row)
    return bodies


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--results", nargs="*", default=EFFECTIVE_ORDER,
                    help="result roots in precedence order, last wins")
    ap.add_argument("--status", default="QUARANTINED_BY_GATE")
    ap.add_argument("--ids-file", default="",
                    help="JSON list of objectIDs to re-enrich, INSTEAD of selecting by status. "
                         "For records whose stored text was invalidated by a code fix rather than "
                         "by a gate -- the 12 spans the canonicalise fix broke on 2026-08-10.")
    ap.add_argument("--tag", default="repair3")
    ap.add_argument("--size", type=int, default=25)
    ap.add_argument("--cache-glob", default=str(HERE / "cache-scout" / "*" / "*" /
                                                "pilot-manifest.json"))
    ap.add_argument("--expect", type=int, default=0,
                    help="refuse to write unless exactly this many records are selected")
    args = ap.parse_args()

    eff = effective_corpus(args.results)
    print(f"effective corpus : {len(eff)} records over {len(args.results)} roots")
    if args.ids_file:
        wanted = json.loads(pathlib.Path(args.ids_file).read_text())
        unknown = sorted(set(wanted) - set(eff))
        if unknown:
            print(f"FATAL: {len(unknown)} ids are not in the effective corpus, e.g. {unknown[:5]}",
                  file=sys.stderr)
            return 1
        selected = {oid: eff[oid] for oid in wanted}
        print(f"explicit id list : {len(selected)}")
    else:
        selected = {oid: row for oid, row in eff.items() if row.get("status") == args.status}
        print(f"status {args.status}: {len(selected)}")

    bodies = cached_bodies(args.cache_glob)
    missing = sorted(set(selected) - set(bodies))
    if missing:
        # Refuse rather than silently building a smaller batch set. A short run that looks
        # complete is the failure mode this project keeps paying for.
        print(f"FATAL: {len(missing)} selected records have no cached body, e.g. {missing[:5]}",
              file=sys.stderr)
        return 1

    if args.expect and len(selected) != args.expect:
        print(f"FATAL: expected {args.expect} records, selected {len(selected)}", file=sys.stderr)
        return 1

    rows = []
    for oid in sorted(selected):
        src = bodies[oid]
        rec = {k: src[k] for k in FETCH_FIELDS if k in src}
        rec.setdefault("fetch_error", "")
        rec["pilot_reason"] = f"{args.tag}: prior status {args.status}"
        rows.append(rec)

    batch_dir = HERE / f"batches-blog-{args.tag}"
    cache_dir = HERE / "cache-scout" / f"blog-{args.tag}-batches"
    for d in (batch_dir, cache_dir):
        d.mkdir(parents=True, exist_ok=True)

    n = 0
    for i in range(0, len(rows), args.size):
        n += 1
        chunk = rows[i:i + args.size]
        name = f"blog-{args.tag}-{n:03d}"
        (batch_dir / f"{name}.json").write_text(json.dumps(chunk, ensure_ascii=False, indent=1))
        # The FETCHED manifest, written directly. run_batches.py checks for this and skips the
        # fetcher when every row is clean, which is what keeps the source bytes identical.
        (cache_dir / name).mkdir(parents=True, exist_ok=True)
        (cache_dir / name / "pilot-manifest.json").write_text(
            json.dumps(chunk, ensure_ascii=False, indent=1))

    fams = collections.Counter(r.get("family", "?") for r in rows)
    langs = collections.Counter(r.get("language_code", "?") for r in rows)
    print(f"\nwrote {n} batches of <= {args.size} to {batch_dir}")
    print(f"pre-seeded fetched manifests in {cache_dir} (no re-fetch)")
    print(f"families : {dict(fams)}")
    print(f"languages: {dict(langs)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
