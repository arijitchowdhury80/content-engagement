#!/usr/bin/env python3
"""Regression tests for full-corpus production control gates.

These catch the bugs that can make a red or incomplete run look safe to write.
"""

import json
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import run_batches  # noqa: E402
import write_enrichment  # noqa: E402


def real_result(object_id="doc-1", status="PASS"):
    return {
        "objectID": object_id,
        "status": status,
        "verdict": "REAL",
        "source_url": "https://www.algolia.com/doc/example",
        "fetch_path": "doc-md-twin",
        "content_hash": "abc123",
        "processed_at": "2026-08-08T00:00:00+00:00",
        "writer_model": "glm-5.2",
        "judge_model": "gemini-2.5-pro",
        "prompt_version": "test-prompt",
        "truncated": False,
        "abstract_enriched": "The Search API lets you search an index.",
        "abstract_spans_stored": ["The Search API lets you search an index."],
        "keyhighlights_enriched": ["Search requests support query parameters."],
        "span_offsets": [[10, 52], [80, 124]],
        "judge": {"verdict": "REVISE", "coherence": 4},
    }


def test_judge_revise_real_records_are_writable():
    """Catches the writer silently dropping the yield Arijit explicitly approved."""
    payload = write_enrichment.build_payload(real_result(status="JUDGE_REVISE"))

    assert payload is not None
    assert payload["enrichment_verdict"] == "REAL"
    assert payload["abstract_enriched"] == ["The Search API lets you search an index."]


def test_duplicate_result_rows_are_a_fatal_corruption_signal():
    """A duplicate objectID means two model outputs may disagree; keeping first hides corruption."""
    rows = [real_result("doc-1"), real_result("doc-1", status="JUDGE_REVISE")]

    with pytest.raises(SystemExit, match="duplicate objectID"):
        write_enrichment.build_payloads(rows)


def test_fetch_only_summary_does_not_report_enriched_records():
    """A fetch-only run must not produce a green-looking enriched record count."""
    summary = run_batches.summarize_run(
        [{"batch": "b1", "status": "FETCHED", "records": 50, "expected": 50}],
        fetch_only=True,
        elapsed_seconds=12.3,
    )

    assert summary["mode"] == "fetch-only"
    assert summary["fetched_records"] == 50
    assert summary["enriched_records"] == 0
    assert summary["ok"] == 1
    assert summary["failed"] == 0


def test_enrichment_summary_treats_fetched_status_as_failure():
    """If FETCHED leaks into an enrichment run, the summary must refuse to call it OK."""
    summary = run_batches.summarize_run(
        [{"batch": "b1", "status": "FETCHED", "records": 50, "expected": 50}],
        fetch_only=False,
        elapsed_seconds=12.3,
    )

    assert summary["mode"] == "enrich"
    assert summary["ok"] == 0
    assert summary["failed"] == 1
    assert summary["enriched_records"] == 0
    assert summary["failures"][0]["status"] == "FETCHED"
