"""Batching and bounded concurrency.

QUEUE WAIT DOMINATES, NOT PAGE SPEED.
  Measured on one real Scout job against a German case study:

      elapsed_ms        79942     <- includes queue wait
      duration_ms       11209     <- the scrape itself
      browser_launch_ms  3854
      navigation_ms      6357

  So the CONCURRENCY CEILING is the planning input, not `duration_ms`. At one job at a time, 226
  case studies is roughly five hours of wall clock. `plan-slice` projects from measured
  concurrency rather than from per-page speed, because projecting from `duration_ms` would
  promise 42 minutes.

THE CEILING IS THE SERVICE'S, NOT OURS TO GUESS.
  The hosted Scout plan allows 5 concurrent runs. A sixth call from ANY source -- another tool, a
  verification pass, a retry storm -- gets "Hosted API rate limit exceeded", and on 2026-08-09
  that turned into 4,123 of 4,779 pages failing. The default here is deliberately below the
  ceiling so a concurrent verification pass does not trip it.
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Callable, Iterable, TypeVar

DEFAULT_SCOUT_CONCURRENCY = 4      # below the plan's 5, so a parallel read does not trip it
DEFAULT_MODEL_CONCURRENCY = 6

T = TypeVar("T")
R = TypeVar("R")


def batches(items: list[T], size: int) -> list[list[T]]:
    return [items[i:i + size] for i in range(0, len(items), size)]


def run_concurrent(items: Iterable[T], fn: Callable[[T], R], workers: int,
                   on_result: Callable[[T, R | None, Exception | None], None] | None = None
                   ) -> list[R]:
    """Map `fn` over `items` with a bounded pool, preserving input order in the result.

    An exception is passed to `on_result` and the item yields None rather than killing the run:
    one page failing is a row in the report, not a reason to lose the other 236. The caller is
    responsible for counting the Nones -- a silent drop and a silent success look identical.
    """
    items = list(items)
    results: list[R | None] = [None] * len(items)
    if not items:
        return []
    with ThreadPoolExecutor(max_workers=max(1, workers)) as pool:
        futures = {pool.submit(fn, item): i for i, item in enumerate(items)}
        for fut in as_completed(futures):
            i = futures[fut]
            try:
                results[i] = fut.result()
                if on_result:
                    on_result(items[i], results[i], None)
            except Exception as exc:                      # noqa: BLE001 -- reported, not hidden
                if on_result:
                    on_result(items[i], None, exc)
    return results


def project_runtime(records: int, concurrency: int, seconds_per_record: float) -> dict:
    """What `plan-slice` prints before a slice is launched."""
    wall = records * seconds_per_record / max(1, concurrency)
    return {
        "records": records,
        "concurrency": concurrency,
        "measured_s_per_record": seconds_per_record,
        "projected_wall_clock_s": round(wall),
        "projected_wall_clock_h": round(wall / 3600, 2),
        "note": "projected from measured queue-inclusive elapsed time per record, not from the "
                "scrape duration. Queue wait dominates; scrape duration would promise ~7x faster.",
    }
