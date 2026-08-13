from __future__ import annotations

import pytest

from algolia_enrichment.docmerge import (REFRESH_OWNED, TAXONOMY_AXES, merge_record,
                                         assert_no_field_lost)
from algolia_enrichment.errors import EnrichmentError


def existing(**over):
    out = {
        "objectID": "https://algolia.com/doc/a/",
        "url": "/doc/a",
        "title": "Old title",
        "description": "Old description",
        "source": "Documentation",
        "page_type": "doc-guide",
        "language_code": "en",
        "category": "Doc",
        "abstract": "Old abstract text",
        "thumbnail": "/img/a.png",
        "transform_source": "aant-docEntry",
        "indexed_at": 1784670431909,
        "published_at": 1604563980000,
        "lastUpdated": "2026-07-21T21:47:11.909Z",
        "environment": "prod20260722",
        "tags": ["search"],
        "keywords": [],
        "authors": [],
        "feature": ["events"],
        "taxonomy_version": "v0",
        "taxonomy_provenance": {"page_type": "url-path", "feature": "legacy-field"},
        "taxonomy_confidence": {"page_type": "high", "feature": "high"},
    }
    out.update(over)
    return out


def fresh(**over):
    out = {
        "objectID": "https://www.algolia.com/doc/a",
        "url": "https://www.algolia.com/doc/a",
        "title": "New title",
        "description": "New description",
        "body": "# New title\n\nBody.",
        "source": "Documentation",
        "language_code": "en",
        "page_type": "doc-guide",
        "feature": ["indexing"],
        "taxonomy_version": "v1",
        "taxonomy_provenance": {"page_type": "url-rule", "feature": "url-rule"},
        "taxonomy_confidence": {"page_type": "high", "feature": "high"},
    }
    out.update(over)
    return out


def test_no_populated_field_from_the_old_record_is_lost():
    """The whole point. A full replace would have destroyed `abstract` on 4,317 live records --
    and abstract is a searchable attribute, so search would silently degrade."""
    merged = merge_record(existing(), fresh())
    for key, value in existing().items():
        # Taxonomy axes are legitimately overwritten by a rule-derived value; everything else the
        # refresh does not own must survive untouched.
        if key in REFRESH_OWNED or key in TAXONOMY_AXES:
            continue
        assert merged[key] == value, f"{key} was lost"


def test_the_refresh_wins_on_the_fields_it_owns():
    merged = merge_record(existing(), fresh())
    assert merged["title"] == "New title"
    assert merged["description"] == "New description"
    assert merged["body"] == "# New title\n\nBody."


def test_url_and_objectid_are_always_the_normalised_absolute_form():
    merged = merge_record(existing(), fresh())
    assert merged["objectID"] == "https://www.algolia.com/doc/a"
    assert merged["url"] == "https://www.algolia.com/doc/a"


def test_an_empty_fresh_value_never_blanks_a_populated_existing_one():
    """A page with no meta description today does not mean the stored description should be
    deleted. Gap-fill, never overwrite with nothing."""
    merged = merge_record(existing(), fresh(description=""))
    assert merged["description"] == "Old description"


def test_an_empty_fresh_value_is_used_when_the_old_one_was_empty_too():
    merged = merge_record(existing(description=""), fresh(description=""))
    assert merged["description"] == ""


def test_a_rule_derived_axis_overwrites_a_legacy_one_and_says_so():
    """A rule-derived value is provable; a legacy-field value is not. The rule wins, and the
    provenance records which axis is now provable."""
    merged = merge_record(existing(), fresh())
    assert merged["feature"] == ["indexing"]
    assert merged["taxonomy_provenance"]["feature"] == "url-rule"


def test_an_axis_no_rule_predicts_is_kept_with_its_original_provenance():
    """Dropping an axis the rules are silent about could break required-axis conformance, and it
    would also destroy information the rules simply cannot express."""
    old = existing(product=["ai-search"])
    old["taxonomy_provenance"]["product"] = "legacy-field"
    merged = merge_record(old, fresh())
    assert merged["product"] == ["ai-search"]
    assert merged["taxonomy_provenance"]["product"] == "legacy-field"


def test_taxonomy_version_is_the_fresh_one():
    merged = merge_record(existing(), fresh())
    assert merged["taxonomy_version"] == "v1"


def test_a_brand_new_page_with_no_existing_record_merges_cleanly():
    merged = merge_record(None, fresh())
    assert merged["objectID"] == "https://www.algolia.com/doc/a"
    assert merged["title"] == "New title"
    assert "category" not in merged


def test_assert_no_field_lost_passes_on_a_correct_merge():
    assert_no_field_lost(existing(), merge_record(existing(), fresh()))


def test_assert_no_field_lost_catches_a_dropped_field():
    """The regression guard for the defect itself: if a future change stops carrying a field
    forward, this fails rather than the corpus quietly losing it."""
    merged = merge_record(existing(), fresh())
    del merged["abstract"]
    with pytest.raises(EnrichmentError) as exc:
        assert_no_field_lost(existing(), merged)
    assert "abstract" in str(exc.value)


def test_assert_no_field_lost_catches_a_blanked_field():
    merged = merge_record(existing(), fresh())
    merged["category"] = ""
    with pytest.raises(EnrichmentError):
        assert_no_field_lost(existing(), merged)


def test_assert_no_field_lost_ignores_fields_that_were_already_empty():
    merged = merge_record(existing(), fresh())
    merged.pop("keywords", None)
    assert_no_field_lost(existing(), merged)
