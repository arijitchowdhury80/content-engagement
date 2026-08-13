from __future__ import annotations

import json

import pytest

from algolia_enrichment.docapply import (
    APPROVAL_FILENAME,
    assert_records_sane,
    read_refresh_approval,
    verify_after_refresh,
)
from algolia_enrichment.errors import EnrichmentError, ZeroWorkError


def full(object_id="https://www.algolia.com/doc/a", **over):
    out = {
        "objectID": object_id,
        "url": object_id,
        "title": "A title",
        "source": "Documentation",
        "page_type": "doc-guide",
        "language_code": "en",
        "description": "A description",
        "body": "# A title\n\nBody.",
        "taxonomy_version": "v1",
    }
    out.update(over)
    return out


def test_sane_records_pass():
    assert_records_sane([full()]) is None


def test_zero_records_is_a_failure_not_a_no_op():
    with pytest.raises(ZeroWorkError):
        assert_records_sane([])


def test_a_record_missing_a_required_field_is_refused():
    """A full-record replace overwrites what is live. A record missing title or page_type would
    blank those fields on a live record and then fail taxonomy-preflight."""
    for field in ("objectID", "url", "title", "source", "page_type", "language_code",
                  "taxonomy_version"):
        with pytest.raises(EnrichmentError) as exc:
            assert_records_sane([full(**{field: ""})])
        assert field in str(exc.value)


def test_a_record_for_the_wrong_corpus_is_refused():
    with pytest.raises(EnrichmentError):
        assert_records_sane([full(source="Blog")])


def test_an_empty_description_is_allowed_because_some_pages_genuinely_have_none():
    """29 live pages have no meta description. Blank is the honest value; the alternative is
    inventing one."""
    assert_records_sane([full(description="")]) is None


def test_an_empty_body_is_refused():
    """The body is the reason for re-fetching. An empty one means the fetch produced nothing and
    the record would replace a live record with less than it had."""
    with pytest.raises(EnrichmentError):
        assert_records_sane([full(body="")])


def test_duplicate_objectids_are_refused():
    with pytest.raises(EnrichmentError) as exc:
        assert_records_sane([full(), full()])
    assert "duplicate" in str(exc.value).lower()


def approval(tmp_path, **over):
    data = {"target_index": "Enhanced", "expected_write_count": 2, "expected_delete_count": 3,
            "approved_by": "arijit"}
    data.update(over)
    d = tmp_path / "approvals"
    d.mkdir(parents=True, exist_ok=True)
    (d / APPROVAL_FILENAME).write_text(json.dumps(data))
    return tmp_path


def test_approval_must_exist(tmp_path):
    with pytest.raises(EnrichmentError):
        read_refresh_approval(tmp_path, target_index="Enhanced", write_count=2, delete_count=3)


def test_approval_must_name_this_index(tmp_path):
    root = approval(tmp_path, target_index="SomethingElse")
    with pytest.raises(EnrichmentError):
        read_refresh_approval(root, target_index="Enhanced", write_count=2, delete_count=3)


def test_approval_must_match_the_delete_count_exactly(tmp_path):
    """The delete count is the dangerous number and is therefore part of what is approved: an
    approval for deleting 3 records is not an approval for deleting 2,433."""
    root = approval(tmp_path)
    with pytest.raises(EnrichmentError) as exc:
        read_refresh_approval(root, target_index="Enhanced", write_count=2, delete_count=2433)
    assert "delete" in str(exc.value).lower()


def test_approval_must_match_the_write_count_exactly(tmp_path):
    root = approval(tmp_path)
    with pytest.raises(EnrichmentError):
        read_refresh_approval(root, target_index="Enhanced", write_count=99, delete_count=3)


def test_approval_must_be_attributed(tmp_path):
    root = approval(tmp_path, approved_by="")
    with pytest.raises(EnrichmentError):
        read_refresh_approval(root, target_index="Enhanced", write_count=2, delete_count=3)


def test_a_matching_approval_is_accepted(tmp_path):
    root = approval(tmp_path)
    got = read_refresh_approval(root, target_index="Enhanced", write_count=2, delete_count=3)
    assert got["approved_by"] == "arijit"


class FakeClient:
    def __init__(self, stored, count):
        self._stored, self._count = stored, count

    def get_objects(self, index, object_ids, attributes=None):
        return {o: self._stored[o] for o in object_ids if o in self._stored}

    def record_count(self, index):
        return (self._count, self._count)


def test_verify_after_refresh_requires_the_written_records_to_read_back():
    records = [full()]
    client = FakeClient({}, count=10)
    with pytest.raises(EnrichmentError):
        verify_after_refresh(client, "Enhanced", records, deleted_ids=[], expected_total=10)


def test_verify_after_refresh_requires_deleted_records_to_be_gone():
    """A delete that silently did nothing leaves the duplication in place while the run reports
    success."""
    records = [full()]
    stored = {records[0]["objectID"]: dict(records[0]), "ghost": {"objectID": "ghost"}}
    with pytest.raises(EnrichmentError) as exc:
        verify_after_refresh(FakeClient(stored, 10), "Enhanced", records,
                             deleted_ids=["ghost"], expected_total=10)
    assert "still present" in str(exc.value).lower()


def test_verify_after_refresh_checks_the_final_total_against_the_prediction():
    records = [full()]
    stored = {records[0]["objectID"]: dict(records[0])}
    with pytest.raises(EnrichmentError) as exc:
        verify_after_refresh(FakeClient(stored, 999), "Enhanced", records,
                             deleted_ids=[], expected_total=10)
    assert "999" in str(exc.value)


def test_verify_after_refresh_passes_when_everything_reconciles():
    records = [full()]
    stored = {records[0]["objectID"]: dict(records[0])}
    report = verify_after_refresh(FakeClient(stored, 10), "Enhanced", records,
                                  deleted_ids=[], expected_total=10)
    assert report["ok"] is True
