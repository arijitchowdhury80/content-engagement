"""Taxonomy conformance is a preflight, not an enrichment side effect."""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from algolia_enrichment import taxonomy


SCHEMA_PATH = Path(__file__).resolve().parents[2] / "references" / "taxonomy-schema.algolia-com.json"


def record(**overrides):
    item = {
        "objectID": "doc-1",
        "page_type": "doc-sdk",
        "feature": ["indexing"],
        "language_platform": ["python"],
        "taxonomy_version": "algolia-com-taxonomy-v1-20260805",
        "taxonomy_provenance": {
            "page_type": "url-path", "feature": "url-path", "language_platform": "url-path",
        },
        "taxonomy_confidence": {
            "page_type": "high", "feature": "high", "language_platform": "high",
        },
    }
    item.update(overrides)
    return item


def test_valid_record_obeys_the_same_schema_the_taxonomy_run_used():
    schema = taxonomy.load_schema(SCHEMA_PATH)
    assert taxonomy.validate_record(record(), schema) == []


def test_required_axis_may_be_explicitly_unknown_but_optional_axis_may_not():
    schema = taxonomy.load_schema(SCHEMA_PATH)
    unresolved = record(
        feature=["unknown"], language_platform=["unknown"],
        taxonomy_provenance={"page_type": "url-path", "feature": "unknown", "language_platform": "unknown"},
        taxonomy_confidence={"page_type": "high", "feature": "low", "language_platform": "low"},
    )
    assert taxonomy.validate_record(unresolved, schema) == []

    invalid = record(product=["unknown"])
    assert "product: 'unknown' is only valid on a required axis" in taxonomy.validate_record(invalid, schema)


def test_validator_rejects_empty_values_unknown_vocabulary_and_missing_provenance():
    schema = taxonomy.load_schema(SCHEMA_PATH)
    bad = record(
        feature=[""], language_platform=["made-up-platform"],
        taxonomy_provenance={"page_type": "url-path", "feature": "url-path"},
        taxonomy_confidence={"page_type": "high", "feature": "high", "language_platform": "high"},
    )
    issues = taxonomy.validate_record(bad, schema)
    assert "feature: contains forbidden empty/null value" in issues
    assert "language_platform: unknown vocabulary value 'made-up-platform'" in issues
    assert "language_platform: missing taxonomy_provenance" in issues


def test_cli_taxonomy_preflight_fails_live_contract_violations_and_writes_the_report(
        wire, run_cli, workspace):
    from conftest import FakeAlgolia

    bad = record(objectID="bad", page_type="doc-sdk", language_platform=[])
    wire(algolia=FakeAlgolia([bad]))
    code = run_cli("taxonomy-preflight", "--run-id", "20260811-taxonomy-a01")

    report_path = (workspace / "docs/operations/enrichment/runs/20260811-taxonomy-a01/validation/"
                   "taxonomy-conformance.json")
    report = json.loads(report_path.read_text())
    assert code == 2
    assert report["ok"] is False
    assert report["violations"][0]["objectID"] == "bad"
