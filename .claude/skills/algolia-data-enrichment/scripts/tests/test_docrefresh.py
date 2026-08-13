from __future__ import annotations

import pytest

from algolia_enrichment.docrefresh import (
    MIN_FETCH_SUCCESS_SHARE,
    build_record,
    check_distribution,
    fetch_report,
    title_and_description,
)
from algolia_enrichment.errors import EnrichmentError

SCHEMA = {
    "version": "test-v1",
    "axes": [
        {"name": "page_type", "required_on": ["*"]},
        {"name": "feature", "required_on": ["doc-guide"]},
    ],
    "vocabularies": {
        "page_type": {"doc-guide": {}, "doc-rest-api": {}},
        "feature": {"events": {}},
    },
    "url_rules": [
        {"host": "www.algolia.com", "path": "^/doc/guides(/|$)",
         "page_type": "doc-guide", "feature": ["events"]},
        {"host": "www.algolia.com", "path": "^/doc/rest-api(/|$)", "page_type": "doc-rest-api"},
    ],
}

MD = """---
title: Real Page Title
description: The page's own meta description.
---

# Real Page Title

Body text lives here.
"""


def test_title_and_description_are_taken_verbatim_from_the_page():
    title, desc = title_and_description(MD)
    assert title == "Real Page Title"
    assert desc == "The page's own meta description."


def test_title_falls_back_to_the_first_heading_when_frontmatter_has_none():
    title, desc = title_and_description("# Heading Only\n\nText.\n")
    assert title == "Heading Only"
    assert desc == ""


def test_a_page_with_no_description_yields_blank_never_an_invented_one():
    """29 live Documentation pages genuinely have no meta description. Lifting an arbitrary
    sentence would look like data and be fabrication."""
    record = build_record("https://www.algolia.com/doc/guides/x", "# T\n\nSome body sentence.\n",
                          SCHEMA)
    assert record["description"] == ""
    assert record["needs_description"] is True


def test_record_carries_the_page_body_verbatim():
    record = build_record("https://www.algolia.com/doc/guides/x", MD, SCHEMA)
    assert record["body"] == MD
    assert record["source"] == "Documentation"
    assert record["language_code"] == "en"


def test_objectid_and_url_are_the_canonical_www_absolute_form():
    """79 objectIDs in the live index use the no-www host; the refresh normalises them."""
    record = build_record("https://algolia.com/doc/guides/x/", MD, SCHEMA)
    assert record["objectID"] == "https://www.algolia.com/doc/guides/x"
    assert record["url"] == "https://www.algolia.com/doc/guides/x"


def test_taxonomy_is_derived_from_the_url_rules_with_provenance():
    record = build_record("https://www.algolia.com/doc/guides/x", MD, SCHEMA)
    assert record["page_type"] == "doc-guide"
    assert record["feature"] == ["events"]
    assert record["taxonomy_provenance"]["page_type"] == "url-rule"
    assert record["taxonomy_confidence"]["feature"] == "high"
    assert record["taxonomy_version"] == "test-v1"


def test_a_url_no_rule_matches_is_refused_rather_than_guessed():
    """An unclassified record would fail taxonomy-preflight after the write. Catch it before."""
    with pytest.raises(EnrichmentError):
        build_record("https://www.algolia.com/doc/unknown-section/x", MD, SCHEMA)


def test_derivation_is_idempotent():
    first = build_record("https://www.algolia.com/doc/guides/x", MD, SCHEMA)
    second = build_record("https://www.algolia.com/doc/guides/x", MD, SCHEMA)
    assert first == second


def test_distribution_gate_passes_when_derived_counts_match_the_site():
    report = check_distribution({"doc-guide": 100, "doc-rest-api": 50},
                                {"guides": 100, "rest-api": 50},
                                {"doc-guide": "guides", "doc-rest-api": "rest-api"})
    assert report["ok"] is True


def test_distribution_gate_fails_when_a_rule_mis_tags_a_whole_section():
    """Per-record checks cannot catch this: each of the 40 mis-tagged pages looks fine alone.
    Only the aggregate reveals it."""
    report = check_distribution({"doc-guide": 60, "doc-rest-api": 90},
                                {"guides": 100, "rest-api": 50},
                                {"doc-guide": "guides", "doc-rest-api": "rest-api"})
    assert report["ok"] is False
    assert any(row["page_type"] == "doc-guide" for row in report["divergences"])


def test_distribution_gate_tolerates_small_drift():
    """The sitemap and the rules bucket a handful of pages differently by design; only a material
    gap should stop a run."""
    report = check_distribution({"doc-guide": 547}, {"guides": 542}, {"doc-guide": "guides"})
    assert report["ok"] is True


def test_fetch_report_refuses_a_partial_fetch():
    """A partial fetch must never become a refresh: the pages that failed would be classified as
    absent and deleted."""
    rows = [{"fetch_error": ""} for _ in range(80)] + [{"fetch_error": "boom"} for _ in range(20)]
    with pytest.raises(EnrichmentError) as exc:
        fetch_report(rows)
    assert str(int(MIN_FETCH_SUCCESS_SHARE * 100)) in str(exc.value)


def test_fetch_report_counts_redirect_mismatches_as_failures():
    """A redirect makes the body faithful to a DIFFERENT page than the record claims."""
    rows = [{"fetch_error": "", "redirect_mismatch": True} for _ in range(50)] + \
           [{"fetch_error": "", "redirect_mismatch": False} for _ in range(50)]
    with pytest.raises(EnrichmentError):
        fetch_report(rows)


def test_fetch_report_passes_a_clean_run():
    rows = [{"fetch_error": "", "redirect_mismatch": False} for _ in range(100)]
    report = fetch_report(rows)
    assert report["ok"] is True and report["succeeded"] == 100


def test_title_and_description_come_from_scouts_metadata_not_the_markdown_body():
    """The defect this guards: the Scout client read 3 of the 23 fields Scout returns and threw
    away `metadata`, which is the ONLY place the page's title and description appear. Downstream
    then parsed the markdown for them and found a title on 30 of 882 pages and a description on
    none. Scout's markdown has no frontmatter and usually no H1."""
    body = "> ## Documentation Index\n\nSome prose with no heading and no frontmatter.\n"
    title, desc = title_and_description(body, {"title": "distinct - Algolia",
                                               "description": "How many variants are returned"})
    assert title == "distinct - Algolia"
    assert desc == "How many variants are returned"


def test_metadata_wins_over_a_heading_in_the_body():
    title, _ = title_and_description("# Body Heading\n", {"title": "Real Title",
                                                          "description": "d"})
    assert title == "Real Title"


def test_body_parsing_still_works_when_scout_sends_no_metadata():
    title, desc = title_and_description(MD, {})
    assert title == "Real Page Title"
    assert desc == "The page's own meta description."


def test_build_record_uses_metadata_for_title_and_description():
    record = build_record("https://www.algolia.com/doc/guides/x",
                          "no heading here\n", SCHEMA,
                          metadata={"title": "T", "description": "D"})
    assert record["title"] == "T" and record["description"] == "D"
    assert record["needs_title"] is False and record["needs_description"] is False


def test_a_capture_group_value_outside_the_vocabulary_is_dropped_not_emitted():
    """`/doc/api-reference/api-parameters/(?P<feature>[\\w-]+)` captures an API PARAMETER NAME --
    advancedSyntax, distinct, minProximity. Those are not product features and are not in the
    vocabulary. Emitting them is worse than emitting nothing: the merge treats a populated value
    as authoritative and would overwrite a correct stored feature on 90 live records."""
    schema = {
        "version": "v1",
        "axes": [{"name": "page_type", "required_on": ["*"]},
                 {"name": "feature", "required_on": ["doc-api-reference"]}],
        "vocabularies": {"page_type": {"doc-api-reference": {}}, "feature": {"faceting": {}}},
        "url_rules": [{"host": "www.algolia.com",
                       "path": r"^/doc/api-reference/api-parameters/(?P<feature>[\w-]+)(/|$)",
                       "page_type": "doc-api-reference"}],
    }
    record = build_record("https://www.algolia.com/doc/api-reference/api-parameters/distinct",
                          "body", schema)
    assert "feature" not in record, "an out-of-vocabulary capture must not be emitted"
    assert record["page_type"] == "doc-api-reference"


def test_a_literal_rule_value_outside_the_vocabulary_is_also_dropped():
    schema = {
        "version": "v1",
        "axes": [{"name": "page_type", "required_on": ["*"]},
                 {"name": "feature", "required_on": []}],
        "vocabularies": {"page_type": {"doc-guide": {}}, "feature": {"faceting": {}}},
        "url_rules": [{"host": "www.algolia.com", "path": "^/doc/guides(/|$)",
                       "page_type": "doc-guide", "feature": ["not-a-real-feature"]}],
    }
    record = build_record("https://www.algolia.com/doc/guides/x", "body", schema)
    assert "feature" not in record


def test_a_valid_capture_group_value_is_still_kept():
    schema = {
        "version": "v1",
        "axes": [{"name": "page_type", "required_on": ["*"]},
                 {"name": "language_platform", "required_on": ["doc-sdk"]}],
        "vocabularies": {"page_type": {"doc-sdk": {}}, "language_platform": {"java": {}}},
        "url_rules": [{"host": "www.algolia.com",
                       "path": r"^/doc/libraries/(?P<language_platform>[\w-]+)/",
                       "page_type": "doc-sdk"}],
    }
    record = build_record("https://www.algolia.com/doc/libraries/java/v4/methods/x", "b", schema)
    assert record["language_platform"] == ["java"]
