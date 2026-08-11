#!/usr/bin/env python3
"""
enrich_ready — enrich every batch that is already fully fetched, while the fetch keeps running.

WHY THIS EXISTS
  The Scout fetch is the long pole and nothing downstream can start until a batch is complete --
  but it does not have to wait for ALL batches. Enrichment calls the GLM writer and the Gemini
  judge; it touches Scout not at all. So the two stages can run at the same time, on different
  batches, with no shared resource and no contention.

  Arijit, 2026-08-09: "we need to get moving and get the job done." Four hours in, zero records
  had been enriched. This is the fix for that, not another probe.

WHAT IT REFUSES TO DO
  * A batch with ANY fetch failure is skipped, not partially enriched. A partial batch that later
    looks complete is the corruption that made a previous run's results file a lie.
  * It never writes to Algolia. `enrich_run --pilot` only.
  * It never fetches. If a batch is not already cached it is simply not ready yet.

  python3 enrich_ready.py --workers 3          # enrich whatever is ready, then stop
  python3 enrich_ready.py --watch              # keep going as the fetch completes more batches
"""

from __future__ import annotations

import argparse
import concurrent.futures as futures
import json
import pathlib
import subprocess
import sys
import time

HERE = pathlib.Path(__file__).parent
ENRICHER = HERE / "enrich_run.py"
CACHE = HERE / "cache-scout" / "corpus"
OUT = HERE / "batches-out-scout"


def ready_batches() -> list[pathlib.Path]:
    """Manifests that are complete AND clean, and not already enriched."""
    out = []
    for manifest in sorted(CACHE.glob("*/pilot-manifest.json")):
        try:
            rows = json.loads(manifest.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            continue
        if not rows or any(r.get("fetch_error") for r in rows):
            continue                       # incomplete or dirty: not this batch's turn
        rows_source = rows
        # COMPLETE means one result row per fetched record -- not "the file exists".
        # scout-commercial-005 produced 10 rows for 23 records and scout-editorial-003 produced 0,
        # and an exists() check would have retired both, orphaning 63 records with no trace. This
        # is the third appearance today of "a partial artefact counted as done"; the other two were
        # in fetch_router's resume and run_batches' fetch guard.
        results = OUT / manifest.parent.name / "results.jsonl"
        if results.exists():
            ids: set[str] = set()
            row_count = 0
            corrupt = False
            try:
                for line in results.open(encoding="utf-8"):
                    if not line.strip():
                        continue
                    row_count += 1
                    oid = json.loads(line).get("objectID")
                    if not oid or oid in ids:
                        corrupt = True
                    ids.add(oid)
            except (json.JSONDecodeError, OSError):
                corrupt = True
            if not corrupt and row_count == len(ids) and len(ids) >= len(rows_source):
                continue                   # genuinely complete; never redo model work
            reason = "corrupt/duplicate" if corrupt or row_count != len(ids) else "incomplete"
            print(f"  {reason}: {manifest.parent.name} has {row_count} rows/"
                  f"{len(ids)} distinct for {len(rows_source)} records "
                  f"-- quarantining and re-enriching", flush=True)
            quarantine = OUT / manifest.parent.name / "partial-quarantine"
            quarantine.mkdir(parents=True, exist_ok=True)
            results.replace(quarantine / f"results-{reason}-{row_count}rows-{len(ids)}ids.jsonl")
        out.append(manifest)
    return out


def enrich(manifest: pathlib.Path, timeout: int) -> dict:
    name = manifest.parent.name
    out_dir = OUT / name
    out_dir.mkdir(parents=True, exist_ok=True)
    started = time.time()
    proc = subprocess.run(
        [sys.executable, str(ENRICHER), "--pilot",
         "--manifest", str(manifest), "--out", str(out_dir)],
        capture_output=True, text=True, timeout=timeout,
    )
    results = out_dir / "results.jsonl"
    rows = 0
    if results.exists():
        rows = sum(1 for line in results.open(encoding="utf-8") if line.strip())
    return {"batch": name, "rc": proc.returncode, "rows": rows,
            "seconds": round(time.time() - started, 1),
            "stderr_tail": proc.stderr[-300:] if proc.returncode != 0 else ""}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--workers", type=int, default=3)
    ap.add_argument("--timeout", type=int, default=5400, help="per batch, seconds")
    ap.add_argument("--watch", action="store_true",
                    help="keep polling for newly-completed batches until the fetch stops")
    ap.add_argument("--limit-batches", type=int, default=0)
    args = ap.parse_args()

    done_total = rows_total = 0
    while True:
        batches = ready_batches()
        if args.limit_batches:
            batches = batches[: args.limit_batches]
        if batches:
            print(f"\nenriching {len(batches)} ready batch(es) with {args.workers} workers",
                  flush=True)
            with futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
                for res in futures.as_completed(
                        [pool.submit(enrich, m, args.timeout) for m in batches]):
                    r = res.result()
                    done_total += 1
                    rows_total += r["rows"]
                    flag = "ok " if r["rc"] == 0 else "FAIL"
                    print(f"  {flag} {r['batch']:34s} {r['rows']:3d} rows  {r['seconds']:6.1f}s"
                          f"{'  ' + r['stderr_tail'] if r['stderr_tail'] else ''}", flush=True)
        elif not args.watch:
            print("no batches ready")

        if not args.watch:
            break
        fetch_alive = subprocess.run(
            ["pgrep", "-f", "run_batches.py --batches batches-scout"],
            capture_output=True, text=True).returncode == 0
        if not batches and not fetch_alive:
            print("\nfetch has stopped and no batches remain ready — done")
            break
        if not batches:
            time.sleep(60)

    print(f"\nbatches enriched: {done_total}   result rows: {rows_total}")
    print("NOTHING written to Algolia. --pilot only.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
