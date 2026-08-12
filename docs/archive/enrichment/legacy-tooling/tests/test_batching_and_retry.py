#!/usr/bin/env python3
"""
Tests for the two pieces that make a parallel full-corpus run safe.

WHY THESE TWO
  1. `make_batches.py` partitions 10,198 records across ~208 workers. If the partition overlaps,
     a record is enriched twice; if it has a gap, a record is silently never enriched and the run
     still reports success. Both are invisible without an assertion.
  2. The retry layer. Before it, neither model call had any retry, backoff or 429 handling -- a
     transient failure returned None and the record was recorded as failed and never revisited.
     Sequentially that almost never fired. At 8 concurrent workers against ~7,700 Gemini calls it
     is a certainty. The test that matters is "a 429 is retried, not lost".

    python3 -m pytest docs/70-enrichment/tests/test_batching_and_retry.py -q
"""

import json
import os
import sys
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest  # noqa: E402

import enrich_run  # noqa: E402
from make_batches import EXCLUDED_PATHS, group_key, make_batches  # noqa: E402


# ---------------------------------------------------------------------------
# batching
# ---------------------------------------------------------------------------

def rec(oid, path="scout", family="editorial"):
    return {"objectID": oid, "fetch_path": path, "family": family, "url": f"/p/{oid}"}


def test_partition_is_exhaustive_and_non_overlapping():
    queue = [rec(f"a{i}") for i in range(137)]
    batches = make_batches(queue, size=50)
    ids = [r["objectID"] for chunks in batches.values() for c in chunks for r in c]
    assert len(ids) == 137
    assert len(set(ids)) == 137, "a record appears in two batches"
    assert set(ids) == {r["objectID"] for r in queue}


def test_excluded_paths_never_enter_a_batch():
    queue = [rec("keep")] + [rec(f"drop{i}", path=p) for i, p in enumerate(EXCLUDED_PATHS)]
    ids = [r["objectID"] for chunks in make_batches(queue).values() for c in chunks for r in c]
    assert ids == ["keep"], ids


def test_batches_are_homogeneous_by_group():
    """A mixed batch that scores badly names no cause. A homogeneous one does."""
    queue = ([rec(f"e{i}", "scout", "editorial") for i in range(30)] +
             [rec(f"r{i}", "doc-md-twin", "reference") for i in range(30)])
    batches = make_batches(queue, size=50)
    assert set(batches) == {"scout/editorial", "doc-md-twin/reference"}
    for group, chunks in batches.items():
        for chunk in chunks:
            assert {group_key(r) for r in chunk} == {group}


def test_last_batch_is_a_remainder_not_padded():
    batches = make_batches([rec(f"a{i}") for i in range(51)], size=50)
    chunks = batches["scout/editorial"]
    assert [len(c) for c in chunks] == [50, 1]


def test_batch_order_is_stable_across_runs():
    """Two invocations must produce identical batches, or resume-by-batch-id is meaningless."""
    queue = [rec(f"a{i}") for i in range(120)]
    a = make_batches(queue, size=50)
    b = make_batches(queue, size=50)
    assert [[r["objectID"] for r in c] for c in a["scout/editorial"]] == \
           [[r["objectID"] for r in c] for c in b["scout/editorial"]]


# ---------------------------------------------------------------------------
# batch completion + locking
#
# Both of these are regressions from a real incident on 2026-08-08: two orchestrator invocations
# were launched against the same batch, both ran enrich_run against the same --out, and the file
# ended with 97 rows for 50 records -- 37 objectIDs duplicated, some three times. The line-count
# completion check called that "complete", which would have skipped the batch forever and shipped
# triplicated results looking exactly like finished work.
# ---------------------------------------------------------------------------

import run_batches  # noqa: E402


def write_results(tmp_path, ids):
    d = tmp_path / "batch"
    d.mkdir(parents=True, exist_ok=True)
    (d / "results.jsonl").write_text(
        "".join(json.dumps({"objectID": i, "status": "PASS"}) + "\n" for i in ids))
    return d


def test_any_duplicate_row_means_NOT_complete(tmp_path):
    """The real 97-rows-for-50-records file, and the case my first fix got wrong.

    Counting distinct ids called this complete because all 50 records were present. But two rows
    for one objectID come from two different model runs and hold DIFFERENT results -- there is no
    authoritative row, so the file cannot be trusted or repaired after the fact. The batch would
    have been skipped forever with triplicated results looking exactly like finished work.
    """
    ids = [f"r{i}" for i in range(50)] + [f"r{i}" for i in range(37)] + [f"r{i}" for i in range(10)]
    assert len(ids) == 97
    assert run_batches.is_complete(write_results(tmp_path, ids), 50) is False

    # more rows than expected, records still missing -- a line count says 90 >= 50 and skips it
    assert run_batches.is_complete(
        write_results(tmp_path / "p", [f"r{i}" for i in range(30)] * 3), 50) is False


def test_a_clean_full_batch_is_complete(tmp_path):
    """The fix must not make everything incomplete forever."""
    d = write_results(tmp_path / "clean", [f"r{i}" for i in range(50)])
    assert run_batches.is_complete(d, 50) is True


def test_half_written_batch_is_not_complete(tmp_path):
    d = write_results(tmp_path, [f"r{i}" for i in range(30)])
    assert run_batches.is_complete(d, 50) is False


def test_corrupt_line_makes_a_batch_incomplete(tmp_path):
    d = write_results(tmp_path, [f"r{i}" for i in range(50)])
    with (d / "results.jsonl").open("a") as fh:
        fh.write('{"objectID": "truncated-mid-writ')
    assert run_batches.is_complete(d, 50) is False, "a half-written line is not evidence"


def test_missing_results_file_is_not_complete(tmp_path):
    assert run_batches.is_complete(tmp_path / "nope", 50) is False


def test_lock_is_exclusive(tmp_path):
    """Second holder must be told to back off, not silently share the output file."""
    d = tmp_path / "b"
    with run_batches.batch_lock(d) as first:
        assert first is True
        with run_batches.batch_lock(d) as second:
            assert second is False, "two processes acquired the same batch"


def test_lock_is_released_for_the_next_caller(tmp_path):
    d = tmp_path / "b"
    with run_batches.batch_lock(d) as a:
        assert a is True
    with run_batches.batch_lock(d) as b:
        assert b is True, "lock not released; a crashed batch would block forever"


# ---------------------------------------------------------------------------
# retry layer
# ---------------------------------------------------------------------------

class FakeProc:
    def __init__(self, stdout, returncode=0):
        self.stdout, self.returncode = stdout, returncode
        self.stderr = ""


def curl_result(body, status):
    return FakeProc(f"{body}\n{enrich_run._HTTP_MARK}{status}")


@pytest.fixture(autouse=True)
def no_sleep():
    with mock.patch.object(enrich_run.time, "sleep"):
        yield


def test_429_is_retried_and_recovers():
    """THE test. Before the retry layer this returned None and the record was lost."""
    seq = [curl_result("", 429), curl_result("", 429), curl_result('{"ok":1}', 200)]
    with mock.patch.object(enrich_run.subprocess, "run", side_effect=seq) as run:
        data, status, _, note = enrich_run._curl_json(["curl", "-s", "x"], 10)
    assert data == {"ok": 1}
    assert status == 200
    assert note == ""
    assert run.call_count == 3


def test_gives_up_after_the_attempt_budget_and_says_why():
    seq = [curl_result("", 429)] * enrich_run._RETRY_ATTEMPTS
    with mock.patch.object(enrich_run.subprocess, "run", side_effect=seq):
        data, _, _, note = enrich_run._curl_json(["curl", "-s", "x"], 10)
    assert data is None
    assert "gave up" in note and "429" in note, note


def test_transport_failure_is_retried():
    seq = [FakeProc("", returncode=28), curl_result('{"ok":1}', 200)]
    with mock.patch.object(enrich_run.subprocess, "run", side_effect=seq):
        data, _, _, _ = enrich_run._curl_json(["curl", "-s", "x"], 10)
    assert data == {"ok": 1}


def test_a_real_4xx_is_NOT_retried():
    """A malformed request repeated four times just burns quota and time."""
    seq = [curl_result("not json", 400)]
    with mock.patch.object(enrich_run.subprocess, "run", side_effect=seq) as run:
        data, status, _, note = enrich_run._curl_json(["curl", "-s", "x"], 10)
    assert data is None and status == 400
    assert run.call_count == 1, "a 400 must not be retried"
    assert "non-JSON" in note


def test_5xx_is_retried():
    seq = [curl_result("", 503), curl_result('{"ok":1}', 200)]
    with mock.patch.object(enrich_run.subprocess, "run", side_effect=seq) as run:
        data, _, _, _ = enrich_run._curl_json(["curl", "-s", "x"], 10)
    assert data == {"ok": 1} and run.call_count == 2


def test_status_marker_is_stripped_from_the_body():
    """The body must never carry the marker into json.loads or into a stored field."""
    with mock.patch.object(enrich_run.subprocess, "run",
                           side_effect=[curl_result('{"a":"b"}', 200)]):
        data, status, raw, _ = enrich_run._curl_json(["curl", "-s", "x"], 10)
    assert data == {"a": "b"} and status == 200
    assert enrich_run._HTTP_MARK not in raw


def test_backoff_grows_between_attempts():
    delays = []
    seq = [curl_result("", 429)] * enrich_run._RETRY_ATTEMPTS
    with mock.patch.object(enrich_run.subprocess, "run", side_effect=seq), \
         mock.patch.object(enrich_run.time, "sleep", side_effect=delays.append):
        enrich_run._curl_json(["curl", "-s", "x"], 10)
    assert len(delays) == enrich_run._RETRY_ATTEMPTS - 1
    assert delays == sorted(delays), f"backoff must not shrink: {delays}"
    assert delays[0] >= enrich_run._RETRY_BASE_SECONDS


def test_jitter_makes_workers_disagree():
    """8 workers retrying in lockstep would rebuild the burst that caused the 429."""
    runs = []
    for _ in range(6):
        delays = []
        seq = [curl_result("", 429)] * enrich_run._RETRY_ATTEMPTS
        with mock.patch.object(enrich_run.subprocess, "run", side_effect=seq), \
             mock.patch.object(enrich_run.time, "sleep", side_effect=delays.append):
            enrich_run._curl_json(["curl", "-s", "x"], 10)
        runs.append(delays[0])
    assert len(set(runs)) > 1, "no jitter: every worker would retry at the same instant"
