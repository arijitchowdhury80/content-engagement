#!/usr/bin/env python3
"""
Guards the CLASS behind one wasted calibration run: a duplicated gate with two call sites.

WHAT HAPPENED
  G7's information-gain bar was made per-family on 2026-08-08 -- INFO_GAIN_MINIMUM = {"reference": 3}
  -- and applied inside span_gate.run_gates(). The pipeline does not call run_gates(). enrich_run
  calls the individual check_* functions itself, and its call passed no `minimum`, so it kept the
  default of 8. Every reference record in the Phase 1 calibration still failed with
  "information gain N < 8", the handoff recorded the threshold fix as "in place", and the next
  session inherited a fix that did nothing.

  A gate parameter that exists in one path and not the other is not a fix. These tests fail if
  the two paths drift apart again.

    python3 -m pytest docs/70-enrichment/tests/test_gate_wiring.py -q
"""

import inspect
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import enrich_run  # noqa: E402
import span_gate  # noqa: E402
from live_path import live_path_source  # noqa: E402


def test_information_gain_default_is_still_the_strict_bar():
    """The relaxed number is a per-family exception, never the new default."""
    sig = inspect.signature(span_gate.check_information_gain)
    assert sig.parameters["minimum"].default == 8


def test_reference_family_has_the_approved_relaxed_bar():
    """Arijit approved reference: 3 on 2026-08-08, told plainly that it is a measure chosen after
    seeing which records had already failed."""
    assert span_gate.INFO_GAIN_MINIMUM == {"reference": 3}


def test_the_runner_passes_a_per_family_minimum():
    """The actual defect. The live path must not fall back to the default.

    Greps the WHOLE live path, not just process(): the gate call moved into
    evaluate_selection on 2026-08-10 and pointing this at one function would re-open the
    drift this file exists to close. See tests/live_path.py.
    """
    src = live_path_source()
    call = re.search(r"check_information_gain\((.*?)\)\n", src, re.S)
    assert call, "check_information_gain call not found on the live enrichment path"
    assert "minimum=" in call.group(1), (
        "the live path calls check_information_gain without minimum=, so it uses the "
        "default 8 and INFO_GAIN_MINIMUM is dead code -- this is the 2026-08-08 defect")
    assert "INFO_GAIN_MINIMUM" in call.group(1), (
        "the minimum must come from the shared map, not a literal copied into the runner")


def test_both_gate_paths_read_the_same_map():
    """Two call sites are tolerable. Two sources of truth are not."""
    runner = live_path_source()
    library = inspect.getsource(span_gate.run_gates)
    for name, src in (("the live enrichment path", runner), ("span_gate.run_gates", library)):
        assert "INFO_GAIN_MINIMUM.get(family" in src, (
            f"{name} does not resolve the info-gain bar from INFO_GAIN_MINIMUM by family")
