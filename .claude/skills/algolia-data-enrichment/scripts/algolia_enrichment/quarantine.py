"""Copy records out of the live index before they are deleted, and prove the copy landed.

This is the undo for the only destructive step in the refresh. 2,433 Documentation records
describe pages that no longer exist -- 108 verified 404s and 2,325 whose URLs now redirect
because the docs moved to Mintlify. They are removed, but never without a restorable copy.

TWO PROPERTIES MAKE THIS AN UNDO RATHER THAN A GESTURE.

  The copy is COMPLETE. Every field of the original is preserved, not a summary of it. A partial
  copy cannot restore a record, and a quarantine you cannot restore from is just a slower delete.

  The copy is VERIFIED BEFORE THE DELETE, by reading it back out of the quarantine index and
  comparing field by field. `verify_quarantined` raising is the gate that stands between copying
  and deleting: a write that returned 200 but stored nothing looks identical to success until
  something reads it back. This project has already lost a day to a deletion that was checked
  against the filesystem instead of the account.

Three provenance fields are added, matching the convention already in the quarantine index:
`_quarantine_reason`, `_quarantined_at`, `_quarantined_from_index`. Without the reason nobody can
later say why a record went, which makes the quarantine unauditable.
"""

from __future__ import annotations

from .errors import EnrichmentError

QUARANTINE_FIELDS = ("_quarantine_reason", "_quarantined_at", "_quarantined_from_index")

# Algolia echoes these back on a read; they are not part of the record and differ by definition.
_ALGOLIA_INTERNAL = ("_highlightResult", "_snippetResult", "_rankingInfo", "_distinctSeqID",
                     "_geoloc_distance", "objectID")


def build_quarantine_payloads(records: list[dict], from_index: str, stamp: str) -> list[dict]:
    """A complete copy of each record plus the three provenance fields."""
    if not records:
        raise EnrichmentError("refusing to build an empty quarantine batch.")
    if not from_index or not stamp:
        raise EnrichmentError("quarantine payloads need the source index and a timestamp.")

    payloads = []
    for record in records:
        object_id = str(record.get("objectID") or "").strip()
        if not object_id:
            raise EnrichmentError("a record with no objectID cannot be quarantined or restored.")
        reason = str(record.get("reason") or "").strip()
        if not reason:
            raise EnrichmentError(
                f"{object_id} has no retire reason. An unlabelled quarantine entry cannot be "
                f"audited: nobody could later say why the record was removed.")
        payload = {key: value for key, value in record.items() if key != "reason"}
        payload["_quarantine_reason"] = reason
        payload["_quarantined_at"] = stamp
        payload["_quarantined_from_index"] = from_index
        payloads.append(payload)
    return payloads


def verify_quarantined(client, index: str, payloads: list[dict]) -> dict:
    """Read every quarantined record back and compare it field by field.

    Raises unless all of them are present and identical. Nothing may be deleted from the source
    until this returns.
    """
    if not payloads:
        raise EnrichmentError("nothing to verify.")
    expected = {p["objectID"]: p for p in payloads}
    stored = client.get_objects(index, list(expected))

    missing = sorted(set(expected) - set(stored))
    if missing:
        raise EnrichmentError(
            f"{len(missing)} of {len(expected)} records are missing from {index}: "
            f"{missing[:5]}. Refusing to delete from the source while a copy is unaccounted for.")

    differing = []
    for object_id, want in expected.items():
        got = stored[object_id]
        for key, value in want.items():
            if key in _ALGOLIA_INTERNAL:
                continue
            if got.get(key) != value:
                differing.append({"objectID": object_id, "field": key})
                break
    if differing:
        raise EnrichmentError(
            f"{len(differing)} quarantined records differ from what was written "
            f"(first: {differing[:3]}). The copy is not a faithful restore point.")

    return {"ok": True, "verified": len(expected), "index": index}
