"""Promotion into the SOURCE index. Every test here asserts a REFUSAL.

This is the one path in the package that can damage Algolia_Prod_Copy_Enhanced -- 11,928 records
of taxonomy with no backup other than a snapshot someone remembered to take. The guard it
overrides exists for that reason, so the tests that matter are the ones proving it still says no.
"""
from __future__ import annotations

import json

import pytest

from algolia_enrichment.errors import EnrichmentError, ZeroWorkError
from algolia_enrichment.promote import (APPROVAL_FILENAME, assert_payloads_sane,
                                        assert_snapshot_exists, read_approval, verify_after_write)

IDX = "Algolia_Prod_Copy_Enhanced"


class FakeClient:
    def __init__(self, indices=(), objects=None):
        self._indices = list(indices)
        self._objects = objects or {}

    def get(self, path):
        return {"items": [{"name": n} for n in self._indices]}

    def get_objects(self, index, ids, attributes=None):
        return {i: self._objects[i] for i in ids if i in self._objects}


def _approve(tmp_path, **over):
    d = tmp_path / "approvals"
    d.mkdir(parents=True, exist_ok=True)
    data = {"target_index": IDX, "expected_write_count": 2, "approved_by": "arijit"}
    data.update(over)
    (d / APPROVAL_FILENAME).write_text(json.dumps(data))
    return tmp_path


# --- the snapshot the overridden guard demands -------------------------------------------------

def test_promotion_is_refused_when_no_snapshot_exists():
    """Overriding a guard while ignoring the reason it gives is theatre."""
    with pytest.raises(EnrichmentError, match="no snapshot exists"):
        assert_snapshot_exists(FakeClient(indices=[IDX, "something_else"]), IDX)


def test_the_latest_snapshot_is_selected():
    c = FakeClient(indices=[IDX, f"{IDX}_SNAPSHOT_20260810", f"{IDX}_SNAPSHOT_20260812"])
    assert assert_snapshot_exists(c, IDX) == f"{IDX}_SNAPSHOT_20260812"


# --- the approval, and everything it must actually say -----------------------------------------

def test_missing_approval_file_refuses(tmp_path):
    with pytest.raises(EnrichmentError, match="does not exist"):
        read_approval(tmp_path, target_index=IDX, expected_count=2)


def test_an_approval_for_a_DIFFERENT_index_is_not_an_approval(tmp_path):
    _approve(tmp_path, target_index="Algolia_Prod_Copy_Enhanced_Parallel")
    with pytest.raises(EnrichmentError, match="is not an approval for another"):
        read_approval(tmp_path, target_index=IDX, expected_count=2)


def test_a_count_mismatch_refuses_because_the_count_was_part_of_what_was_approved(tmp_path):
    _approve(tmp_path, expected_write_count=2)
    with pytest.raises(EnrichmentError, match="part of what was approved"):
        read_approval(tmp_path, target_index=IDX, expected_count=225)


def test_an_unattributed_approval_is_refused(tmp_path):
    _approve(tmp_path, approved_by="")
    with pytest.raises(EnrichmentError, match="unattributed"):
        read_approval(tmp_path, target_index=IDX, expected_count=2)


def test_a_valid_approval_passes(tmp_path):
    _approve(tmp_path)
    assert read_approval(tmp_path, target_index=IDX, expected_count=2)["approved_by"] == "arijit"


# --- payload shapes that could damage a live record --------------------------------------------

def test_zero_payloads_is_a_failure_not_a_no_op():
    with pytest.raises(ZeroWorkError):
        assert_payloads_sane([])


def test_an_EMPTY_enriched_field_is_refused():
    """partialUpdateObject cannot remove an attribute -- it stores the empty value. This exact
    shape once wrote 96,039 literal nulls into a live index."""
    with pytest.raises(EnrichmentError, match="EMPTY"):
        assert_payloads_sane([{"objectID": "a", "abstract_enriched": []}])


def test_a_payload_carrying_any_other_field_is_refused():
    """A promotion may ADD two fields. It may not rewrite title, description or taxonomy."""
    with pytest.raises(EnrichmentError, match="may not write"):
        assert_payloads_sane([{"objectID": "a", "abstract_enriched": ["x"], "title": "new"}])


def test_a_payload_with_no_objectID_is_refused():
    with pytest.raises(EnrichmentError, match="no objectID"):
        assert_payloads_sane([{"abstract_enriched": ["x"]}])


def test_a_well_formed_payload_passes():
    assert_payloads_sane([{"objectID": "a", "abstract_enriched": ["x"],
                           "keyhighlights_enriched": ["y"]}])


# --- read-back verification --------------------------------------------------------------------

def test_verification_catches_a_record_that_never_landed():
    payloads = [{"objectID": "a", "abstract_enriched": ["x"]}]
    out = verify_after_write(FakeClient(objects={}), IDX, payloads)
    assert out["missing"] == ["a"] and out["ok"] is False


def test_verification_catches_text_that_landed_but_differs():
    payloads = [{"objectID": "a", "abstract_enriched": ["expected"]}]
    live = {"a": {"objectID": "a", "abstract_enriched": ["something else"]}}
    out = verify_after_write(FakeClient(objects=live), IDX, payloads)
    assert out["mismatched"] and out["ok"] is False


def test_verification_passes_on_a_byte_exact_read_back():
    payloads = [{"objectID": "a", "abstract_enriched": ["same"]}]
    live = {"a": {"objectID": "a", "abstract_enriched": ["same"]}}
    assert verify_after_write(FakeClient(objects=live), IDX, payloads)["ok"] is True
