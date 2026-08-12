#!/usr/bin/env python3
"""
The LIVE enrichment path, as a source string, for the wiring guards to grep.

WHY THIS EXISTS
  Several tests assert that a gate parameter is actually passed by the runner -- `seen_length`,
  `minimum=INFO_GAIN_MINIMUM.get(family)`. They did that by grepping `enrich_run.process`'s source,
  which was correct while the whole path was one function.

  On 2026-08-10 the select -> repair -> gate block moved into `enrich_run.evaluate_selection` so the
  retry ladder could run it more than once. The guards started failing, and the tempting fix was to
  point them at the new function. That would have been half a guard: if a later refactor split the
  path again, the same silent-drift defect the guards exist to catch would slip through.

  So the guards now grep the WHOLE live path, and `test_the_ladder_actually_calls_the_evaluator`
  keeps that list honest -- widening the haystack is only safe while every function in it is
  genuinely reached from `process`.
"""

from __future__ import annotations

import inspect
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import enrich_run  # noqa: E402

# Every function `process` executes in order on a record that reaches the writer. Add to this list
# ONLY when the new function is genuinely called from `process`; the test below enforces it.
LIVE_PATH_FUNCTIONS = (enrich_run.process, enrich_run.evaluate_selection)


def live_path_source() -> str:
    return "\n".join(inspect.getsource(f) for f in LIVE_PATH_FUNCTIONS)


def test_the_ladder_actually_calls_the_evaluator():
    """The haystack is only valid while `process` really reaches every function in it."""
    src = inspect.getsource(enrich_run.process)
    assert "evaluate_selection(" in src, (
        "process() no longer calls evaluate_selection, so the wiring guards are grepping a "
        "function that does not run -- exactly the dead-path defect they exist to catch")
