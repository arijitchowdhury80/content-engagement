from __future__ import annotations

import pytest

from algolia_enrichment.errors import EnrichmentError
from algolia_enrichment.quarantine import (
    QUARANTINE_FIELDS,
    build_quarantine_payloads,
    verify_quarantined,
)


def rec(object_id: str, reason: str = "dead-404", **extra):
    out = {"objectID": object_id, "url": f"/doc/{object_id}", "title": f"T {object_id}",
           "source": "Documentation", "page_type": "doc-guide", "reason": reason}
    out.update(extra)
    return out


def test_payload_carries_the_three_provenance_fields():
    [payload] = build_quarantine_payloads([rec("a")], from_index="Enhanced", stamp="2026-08-12T00:00:00Z")
    for field in QUARANTINE_FIELDS:
        assert field in payload
    assert payload["_quarantine_reason"] == "dead-404"
    assert payload["_quarantined_from_index"] == "Enhanced"
    assert payload["_quarantined_at"] == "2026-08-12T00:00:00Z"


def test_payload_preserves_the_whole_original_record():
    """Quarantine is the undo for a deletion. A partial copy is not a restorable record."""
    original = rec("a", extra_field="keep me", description="original text")
    [payload] = build_quarantine_payloads([original], from_index="E", stamp="S")
    for key, value in original.items():
        if key == "reason":
            continue
        assert payload[key] == value


def test_the_routing_only_reason_field_does_not_leak_into_the_stored_record():
    """`reason` is how reconcile labelled the row; the stored field is `_quarantine_reason`."""
    [payload] = build_quarantine_payloads([rec("a")], from_index="E", stamp="S")
    assert "reason" not in payload


def test_a_record_with_no_reason_is_refused():
    """An unlabelled quarantine entry cannot be audited later: nobody could say why it went."""
    bad = {"objectID": "a", "url": "/doc/a"}
    with pytest.raises(EnrichmentError):
        build_quarantine_payloads([bad], from_index="E", stamp="S")


def test_a_record_with_no_objectid_is_refused():
    with pytest.raises(EnrichmentError):
        build_quarantine_payloads([{"url": "/doc/a", "reason": "dead-404"}],
                                  from_index="E", stamp="S")


def test_empty_input_is_refused():
    with pytest.raises(EnrichmentError):
        build_quarantine_payloads([], from_index="E", stamp="S")


class FakeClient:
    def __init__(self, stored):
        self._stored = stored

    def get_objects(self, index, object_ids, attributes=None):
        return {o: self._stored[o] for o in object_ids if o in self._stored}


def test_verify_passes_only_when_every_record_is_readable_and_byte_identical():
    payloads = build_quarantine_payloads([rec("a"), rec("b")], from_index="E", stamp="S")
    stored = {p["objectID"]: dict(p) for p in payloads}
    report = verify_quarantined(FakeClient(stored), "Q", payloads)
    assert report["ok"] is True and report["verified"] == 2


def test_verify_fails_when_a_record_never_landed():
    """This is the gate that stands between quarantining and deleting. If it passed on a partial
    copy, the missing records would be deleted from the source with no surviving copy."""
    payloads = build_quarantine_payloads([rec("a"), rec("b")], from_index="E", stamp="S")
    stored = {payloads[0]["objectID"]: dict(payloads[0])}
    with pytest.raises(EnrichmentError) as exc:
        verify_quarantined(FakeClient(stored), "Q", payloads)
    assert "missing" in str(exc.value).lower()


def test_verify_fails_when_a_stored_field_differs():
    payloads = build_quarantine_payloads([rec("a")], from_index="E", stamp="S")
    corrupted = dict(payloads[0])
    corrupted["title"] = "something else"
    with pytest.raises(EnrichmentError) as exc:
        verify_quarantined(FakeClient({corrupted["objectID"]: corrupted}), "Q", payloads)
    assert "differ" in str(exc.value).lower()


def test_verify_ignores_algolia_internal_keys():
    """Algolia echoes internal keys such as _highlightResult; they are not corruption."""
    payloads = build_quarantine_payloads([rec("a")], from_index="E", stamp="S")
    stored = dict(payloads[0])
    stored["_highlightResult"] = {"title": {"value": "T a"}}
    report = verify_quarantined(FakeClient({stored["objectID"]: stored}), "Q", payloads)
    assert report["ok"] is True
