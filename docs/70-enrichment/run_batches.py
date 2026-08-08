#!/usr/bin/env python3
"""
Run enrichment batches in parallel, resumably.

WHY A BATCH IS THE UNIT OF WORK
  `enrich_run.py:891` truncates `results.jsonl` at the start of every run. That was a deliberate
  fix -- a re-run used to stack new results on top of old ones and a 30-record run produced a
  60-line file, which is the same false-green class as everything else this project has hit. But
  it also means a run cannot resume: restarting wipes what completed.

  Rather than unpick that, the batch becomes the unit. Each batch gets its own --out directory, so
  a completed batch is a finished artefact and an interrupted one is simply re-run whole. Fifty
  records is a cheap thing to lose; 10,198 is not.

WHY PROCESSES AND NOT AGENTS
  This is deterministic script execution. Every judgement in the loop is already delegated to two
  LLM calls INSIDE enrich_run.py. A process pool is cheaper, faster, resumable, and -- unlike an
  agent -- cannot report success for work it did not do.

CONCURRENCY SAFETY, CHECKED NOT ASSUMED
  Concurrent enrich_run.py processes share three things, all read-only during a run: the page
  cache dirs, `boilerplate-map.json`, and the batch manifests. The only writable path is
  --out, which is unique per batch. Nothing is appended to by two processes at once.

  START SMALL. `--workers 2` for the first batches to watch for Gemini 429s, then ramp. The retry
  layer handles them, but the ramp is how you find out what the ceiling is before 8 workers are
  hammering it.

    python3 docs/70-enrichment/make_batches.py --out batches
    python3 docs/70-enrichment/run_batches.py --workers 2 --limit-batches 2   # smoke
    python3 docs/70-enrichment/run_batches.py --workers 8                     # full
    python3 docs/70-enrichment/run_batches.py --only doc-md-twin-reference    # one group
"""

from __future__ import annotations

import argparse
import concurrent.futures as futures
import contextlib
import fcntl
import datetime as dt
import json
import pathlib
import subprocess
import sys
import time

HERE = pathlib.Path(__file__).parent
RUNNER = HERE / "enrich_run.py"
FETCHER = HERE / "fetch_router.py"


def batch_manifests(batch_dir: pathlib.Path, only: str = "") -> list[pathlib.Path]:
    paths = sorted(batch_dir.glob("*.json"))
    if only:
        paths = [p for p in paths if p.stem.startswith(only)]
    return paths


def is_complete(out_dir: pathlib.Path, expected: int) -> bool:
    """Done means: one row per DISTINCT record, and every row parses.

    Counting LINES was wrong and it bit immediately. Two orchestrator invocations were launched
    against the same batch; both ran enrich_run against the same --out, and the file ended with
    97 rows for 50 records -- 37 objectIDs duplicated, some three times. A line count called that
    "complete" and would have skipped the batch forever, shipping triplicated results that look
    exactly like finished work. Counting distinct objectIDs makes a corrupted file read as
    INCOMPLETE, which is the safe direction.

    A row that will not parse also means incomplete: a half-written line from a killed process is
    not evidence of anything.
    """
    results = out_dir / "results.jsonl"
    if not results.exists():
        return False
    seen: set[str] = set()
    rows = 0
    try:
        for line in results.open():
            line = line.strip()
            if not line:
                continue
            try:
                seen.add(json.loads(line)["objectID"])
                rows += 1
            except (json.JSONDecodeError, KeyError):
                return False
    except OSError:
        return False
    if rows != len(seen):
        # ANY duplicate means corrupt, even if every expected record is present. Two rows for one
        # objectID come from two different model runs and hold DIFFERENT results -- there is no
        # way to know which is authoritative, so the file cannot be trusted or deduplicated after
        # the fact. My first fix counted distinct ids and called this complete; the batch would
        # then never be re-run and the corruption would ship. Incomplete is the safe answer, and
        # enrich_run truncates results.jsonl at start, so a re-run repairs it.
        return False
    return len(seen) >= expected


@contextlib.contextmanager
def batch_lock(out_dir: pathlib.Path):
    """Exclusive lock per batch, or skip.

    `--out` is unique per batch, so two batches never collide -- but two invocations of the
    ORCHESTRATOR on the SAME batch do, and that is what produced the 97-row file. flock is used
    rather than a lock file with O_EXCL because the kernel releases it when the process dies; a
    stale lockfile after a crash would block the batch forever and require manual cleanup.
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    handle = (out_dir / ".lock").open("w")
    try:
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            yield False
            return
        yield True
    finally:
        handle.close()


def run_one(manifest: pathlib.Path, out_root: pathlib.Path, cache_root: pathlib.Path,
            timeout: int, fetch_only: bool = False) -> dict:
    """Fetch the batch, then enrich it. Both steps skip themselves if already done.

    Two manifests are in play and confusing them is a hard failure: `manifest` here is the QUEUE
    manifest from make_batches.py, which has no page text. `enrich_run.py` needs the FETCHED
    manifest that fetch_router writes, which carries `markdown` inline. So fetch always runs first
    and the enricher is pointed at its output, never at the queue manifest.
    """
    started = time.time()
    out_dir = out_root / manifest.stem
    cache_dir = cache_root / manifest.stem
    fetched = cache_dir / "pilot-manifest.json"
    expected = len(json.loads(manifest.read_text()))

    if is_complete(out_dir, expected):
        return {"batch": manifest.stem, "status": "SKIPPED_COMPLETE",
                "records": expected, "seconds": 0.0}

    # ---- fetch (resumable; fetch_router returns immediately if the batch is already cached) ----
    if not fetched.exists():
        fproc = subprocess.run(
            [sys.executable, str(FETCHER), "--from-batch", str(manifest), "--out", str(cache_dir)],
            capture_output=True, text=True, timeout=timeout,
        )
        if fproc.returncode != 0 or not fetched.exists():
            return {"batch": manifest.stem, "status": "FETCH_FAILED", "records": 0,
                    "expected": expected, "returncode": fproc.returncode,
                    "seconds": round(time.time() - started, 1),
                    "stderr_tail": fproc.stderr[-400:]}

    live = [r for r in json.loads(fetched.read_text()) if not r.get("fetch_error")]
    if fetch_only:
        return {"batch": manifest.stem, "status": "FETCHED", "records": len(live),
                "expected": expected, "seconds": round(time.time() - started, 1)}
    if not live:
        return {"batch": manifest.stem, "status": "NO_FETCHABLE_PAGES", "records": 0,
                "expected": expected, "seconds": round(time.time() - started, 1)}

    # enrich_run drops fetch_error records itself, so the completion bar is the fetchable count
    expected = len(live)
    if is_complete(out_dir, expected):
        return {"batch": manifest.stem, "status": "SKIPPED_COMPLETE",
                "records": expected, "seconds": round(time.time() - started, 1)}

    with batch_lock(out_dir) as acquired:
        if not acquired:
            return {"batch": manifest.stem, "status": "LOCKED_ELSEWHERE", "records": 0,
                    "expected": expected, "seconds": round(time.time() - started, 1)}
        # Re-check under the lock: another process may have finished it while we waited.
        if is_complete(out_dir, expected):
            return {"batch": manifest.stem, "status": "SKIPPED_COMPLETE",
                    "records": expected, "seconds": round(time.time() - started, 1)}
        proc = subprocess.run(
            [sys.executable, str(RUNNER), "--pilot",
             "--manifest", str(fetched), "--out", str(out_dir)],
            capture_output=True, text=True, timeout=timeout,
        )
    # DISTINCT ids, not lines -- see is_complete. A line count let a 97-row/50-record file pass.
    done = len({json.loads(line)["objectID"] for line in (out_dir / "results.jsonl").open()
                if line.strip()}) if (out_dir / "results.jsonl").exists() else 0
    ok = proc.returncode == 0 and done >= expected
    return {
        "batch": manifest.stem,
        "status": "OK" if ok else "FAILED",
        "records": done,
        "expected": expected,
        "returncode": proc.returncode,
        "seconds": round(time.time() - started, 1),
        # keep the tail of stderr: a batch that fails at 3am must be diagnosable in the morning
        "stderr_tail": proc.stderr[-400:] if not ok else "",
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--batches", default=str(HERE / "batches"))
    ap.add_argument("--out", default=str(HERE / "batches-out"))
    ap.add_argument("--cache", default=str(HERE / "cache-batches"),
                    help="per-batch fetched pages + the manifest enrich_run reads")
    ap.add_argument("--fetch-only", action="store_true",
                    help="Phase 2: fetch every batch, enrich nothing. Fetch is the\nexternally rate-capped step, so it is worth running ahead on its own.")
    ap.add_argument("--workers", type=int, default=2,
                    help="START AT 2. Ramp only after watching for 429s.")
    ap.add_argument("--only", default="", help="batch-id prefix, e.g. doc-md-twin-reference")
    ap.add_argument("--limit-batches", type=int, default=0)
    ap.add_argument("--timeout", type=int, default=3600, help="per batch, seconds")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    batch_dir = pathlib.Path(args.batches)
    if not batch_dir.exists():
        sys.exit(f"FATAL: {batch_dir} not found. Run make_batches.py first.")
    manifests = batch_manifests(batch_dir, args.only)
    if not manifests:
        sys.exit(f"FATAL: no batch manifests in {batch_dir}"
                 + (f" matching {args.only!r}" if args.only else ""))
    if args.limit_batches:
        manifests = manifests[: args.limit_batches]

    out_root = pathlib.Path(args.out)
    out_root.mkdir(parents=True, exist_ok=True)
    cache_root = pathlib.Path(args.cache)
    cache_root.mkdir(parents=True, exist_ok=True)

    total_records = sum(len(json.loads(m.read_text())) for m in manifests)
    pending = [m for m in manifests
               if not is_complete(out_root / m.stem, len(json.loads(m.read_text())))]

    print(f"batches      {len(manifests)}  ({len(manifests) - len(pending)} already complete)")
    print(f"records      {total_records}")
    print(f"workers      {args.workers}")
    print(f"out          {out_root}")
    print("NOTHING is written to Algolia here -- enrich_run runs in --pilot mode.\n")

    if args.dry_run:
        for m in pending[:10]:
            print(f"  would run {m.stem}")
        if len(pending) > 10:
            print(f"  ... and {len(pending) - 10} more")
        return 0
    if not pending:
        print("all batches already complete.")
        return 0

    started = time.time()
    results: list[dict] = []
    with futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        # ThreadPool, not ProcessPool: each task is a blocking subprocess.run, so the GIL is
        # released and threads are the cheaper way to hold 8 child processes.
        futs = {pool.submit(run_one, m, out_root, cache_root, args.timeout,
                            args.fetch_only): m for m in pending}
        for n, fut in enumerate(futures.as_completed(futs), 1):
            m = futs[fut]
            try:
                res = fut.result()
            except Exception as exc:                       # noqa: BLE001
                res = {"batch": m.stem, "status": "CRASHED", "error": str(exc)[:300]}
            results.append(res)
            elapsed = time.time() - started
            rate = elapsed / n
            eta = dt.timedelta(seconds=int(rate * (len(pending) - n)))
            flag = "" if res["status"] in ("OK", "SKIPPED_COMPLETE", "FETCHED") else "  <-- FAILED"
            print(f"  {n:3}/{len(pending)} {res['status']:17} {res['batch']:38}"
                  f" {res.get('records', 0):3}rec {res.get('seconds', 0):6.0f}s  ETA {eta}{flag}",
                  flush=True)

    ok = [r for r in results if r["status"] in ("OK", "SKIPPED_COMPLETE", "FETCHED")]
    bad = [r for r in results if r not in ok]
    summary = {
        "finished_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "batches": len(results), "ok": len(ok), "failed": len(bad),
        "records": sum(r.get("records", 0) for r in results),
        "elapsed_seconds": round(time.time() - started, 1),
        "failures": bad,
    }
    (out_root / "run-summary.json").write_text(json.dumps(summary, indent=1))

    print(f"\nbatches OK {len(ok)}/{len(results)}   records {summary['records']}"
          f"   elapsed {dt.timedelta(seconds=int(summary['elapsed_seconds']))}")
    if bad:
        print(f"\n{len(bad)} FAILED -- re-run this same command, completed batches are skipped:")
        for r in bad[:10]:
            print(f"  {r['batch']}: {r.get('stderr_tail') or r.get('error', '')[:200]}")
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main())
