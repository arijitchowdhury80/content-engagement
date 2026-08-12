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
    assert payload["abstract_enriched"] == ["The Search API lets you search an index."]
    assert payload["keyhighlights_enriched"] == ["Search requests support query parameters."]
    assert set(payload) == {"objectID", "abstract_enriched", "keyhighlights_enriched"}
    assert not any(k.startswith("enrichment_") for k in payload)


@pytest.mark.parametrize("status,verdict", [
    ("NO_ABSTRACT_THIN", "THIN"),
    ("NO_ABSTRACT_DEAD", "DEAD"),
    ("LOGIN_REQUIRED", "LOGIN_REQUIRED"),
    ("FETCH_FAILED", "FETCH_FAILED"),
    ("REDIRECT_CANONICAL", "REDIRECT_CANONICAL"),
])
def test_non_enrichment_outcomes_write_nothing_to_algolia(status, verdict):
    row = real_result(status=status)
    row["verdict"] = verdict

    assert write_enrichment.build_payload(row) is None


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


# ---------------------------------------------------------------------------
# LEAN RECORD POLICY — Arijit, 2026-08-09.
# "Live Algolia records should stay lean." Only abstract_enriched and keyhighlights_enriched.
# All provenance, offsets, hashes, verdicts, reasons, served URLs, canonical IDs, model IDs,
# prompts and verification evidence live in external run artifacts.
#
# Full census the same day: 35 live records still carry enrichment_* metadata from the retired
# design, 12 of them carrying only a reason and no abstract. Those predate this policy and can
# only be removed by full-record replace -- partialUpdate stores a literal null instead of
# removing, which put 96,039 nulls in this index once already.

BANNED_ON_RECORD = (
    "enrichment_verdict", "enrichment_reason", "enrichment_requested_url",
    "enrichment_served_url", "enrichment_canonical_objectID", "enrichment_source_url",
    "enrichment_fetch_path", "enrichment_content_hash", "enrichment_span_offsets",
    "enrichment_writer_model", "enrichment_judge_model", "enrichment_prompt_version",
    "enrichment_validated_at", "enrichment_fetched_at", "enrichment_judge_scores",
    "enrichment_truncated",
)


def test_the_writer_allows_exactly_two_fields():
    assert write_enrichment.ALLOWED_FIELDS == {"abstract_enriched", "keyhighlights_enriched"}


@pytest.mark.parametrize("field", BANNED_ON_RECORD)
def test_no_banned_metadata_field_can_reach_a_record(field):
    """Named one by one so a failure says WHICH field leaked, not just that something did."""
    row = real_result(status="PASS")
    row[field] = "should never be written"
    payload = write_enrichment.build_payload(row)
    assert payload is not None
    assert field not in payload
    assert set(payload) == {"objectID", "abstract_enriched", "keyhighlights_enriched"}


@pytest.mark.parametrize("status", [
    "REDIRECT_UNINDEXED", "EXCLUDED", "EXCLUDED_SUPPORT",
    "NO_CANDIDATES", "NO_CANDIDATES_AFTER_FILTER", "QUARANTINED_BY_GATE",
    "WRITER_UNPARSEABLE", "JUDGE_UNAVAILABLE",
])
def test_every_other_non_enrichment_status_also_writes_nothing(status):
    """The parametrised list above this one predates the new verdicts. A status that is neither
    writable nor listed would silently fall through to `None` today and to a payload tomorrow."""
    row = real_result(status=status)
    row["verdict"] = status
    assert write_enrichment.build_payload(row) is None


def test_a_verdict_that_is_not_REAL_is_never_written_even_if_status_looks_writable():
    """Belt and braces: status and verdict must agree before anything reaches the index."""
    row = real_result(status="PASS")
    row["verdict"] = "THIN"
    assert write_enrichment.build_payload(row) is None
