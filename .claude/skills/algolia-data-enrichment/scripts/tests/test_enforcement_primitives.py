"""Refusal tests for the enforcement primitives. These must fail closed."""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from algolia_enrichment.artifacts import RunFolder
from algolia_enrichment.errors import EnrichmentError, LockError, StateError
from algolia_enrichment.lock import run_lock
from algolia_enrichment.state import RunState


def _state():
    return RunState(run_id="20260810-cs-case-study-a01", source="Customer Stories",
                    page_type="case-study", target_index="Algolia_Prod_Copy_Enhanced_Parallel")


def test_illegal_track_value_refused():
    with pytest.raises(StateError):
        _state().set("write", "APPLIED_SOMEHOW")


def test_unknown_track_refused():
    with pytest.raises(StateError):
        _state().set("teleport", "DONE")


def test_require_blocks_out_of_order_transition():
    s = _state()
    with pytest.raises(StateError):
        s.require("write", "DRY_RUN_PASSED")   # write is NONE


def test_write_and_quarantine_are_independent_tracks():
    s = _state()
    s.set("write", "LIVE_VERIFIED")
    s.set("enrich", "PARTIAL")                  # a crash mid-enrich is representable
    assert s.tracks["write"] == "LIVE_VERIFIED"
    assert s.tracks["enrich"] == "PARTIAL"


def test_state_roundtrip(tmp_path):
    s = _state(); s.set("fetch", "DONE"); s.save(tmp_path)
    assert RunState.load(tmp_path).tracks["fetch"] == "DONE"


def test_lock_refuses_second_holder(tmp_path):
    with run_lock(tmp_path, "fetch", "t0"):
        with pytest.raises(LockError):
            with run_lock(tmp_path, "enrich", "t1"):
                pass


def test_lock_released_on_exit(tmp_path):
    with run_lock(tmp_path, "fetch", "t0"):
        pass
    with run_lock(tmp_path, "enrich", "t1"):
        pass


def test_write_outside_run_folder_refused(tmp_path):
    rf = RunFolder(tmp_path, "r1")
    rf.dir.mkdir(parents=True)
    with pytest.raises(EnrichmentError):
        rf.write("../../escaped.json", "{}", "fetch")


def test_manifest_records_what_was_written(tmp_path):
    rf = RunFolder(tmp_path, "r1"); rf.dir.mkdir(parents=True)
    rf.write("final/results.jsonl", "{}", "build-final")
    import json
    m = json.loads((rf.dir / "artifact-manifest.json").read_text())
    assert m["build-final"] == ["final/results.jsonl"]
