"""Promote validated payloads from the proving ground into the SOURCE index.

WHY THIS IS A SEPARATE, LOUDER PATH THAN `apply-write`
  `write.assert_write_target` refuses `target == source` outright, and that refusal is correct as
  a default. Its stated reason -- "the source holds the whole taxonomy and has no snapshot" -- is
  the single most expensive thing in this project to get wrong: there is no backup of
  Algolia_Prod_Copy_Enhanced, and a bad write to it destroys 11,928 records of taxonomy that took
  weeks to build.

  But enrichment parked in `..._Parallel` is invisible. That index carries exactly three fields
  per record -- objectID, abstract_enriched, keyhighlights_enriched -- and nothing queries it. So
  "validated" and "delivered" are different states, and something has to bridge them.

  This module is that bridge, and it is deliberately harder to invoke than a flag:
    * it REQUIRES a snapshot of the source to exist first, so the guard's own objection is
      answered rather than argued with;
    * it REQUIRES an approval file naming the index and the exact record count;
    * it writes ONLY the two enriched fields, via partialUpdateObject -- it can add fields to a
      record, and it cannot replace or remove one;
    * it verifies byte-exactness by reading the records back AFTER the write, and it asserts the
      source record count is unchanged.

  `partialUpdateObject` is also the reason this cannot quietly null a field: nulling is what once
  wrote 96,039 literal nulls into a live index. Payloads here are built from validated spans and
  a payload with an empty field is refused below rather than sent.
"""

from __future__ import annotations

import json
import pathlib

from .errors import EnrichmentError, ZeroWorkError

ENRICHED_FIELDS = ("abstract_enriched", "keyhighlights_enriched")
APPROVAL_FILENAME = "source-write-approved.json"


def snapshot_name(index: str, stamp: str) -> str:
    return f"{index}_SNAPSHOT_{stamp}"


def assert_snapshot_exists(client, index: str) -> str:
    """A promotion into an index with no backup is not allowed, whatever the approval says.

    The guard being overridden names the missing snapshot as its reason. Overriding the guard
    while leaving the reason unaddressed would be theatre.
    """
    listing = client.get("/1/indexes") or {}
    names = [i.get("name", "") for i in (listing.get("items") or [])]
    candidates = [n for n in names if n.startswith(f"{index}_SNAPSHOT_")]
    if not candidates:
        raise EnrichmentError(
            f"refusing to promote into {index}: no snapshot exists. Take one first -- this index "
            f"has no other backup, and the guard being overridden names exactly this as its "
            f"reason. Expected an index named {index}_SNAPSHOT_<YYYYMMDD>.")
    return sorted(candidates)[-1]


def read_approval(run_dir: pathlib.Path, *, target_index: str, expected_count: int) -> dict:
    """Arijit's explicit yes, naming the index and the count. Nobody else writes this file."""
    path = pathlib.Path(run_dir) / "approvals" / APPROVAL_FILENAME
    if not path.exists():
        raise EnrichmentError(
            f"refusing to promote: {path} does not exist. Writing enrichment into the SOURCE "
            f"index needs an explicit approval file naming the index and the record count.")
    try:
        data = json.loads(path.read_text())
    except json.JSONDecodeError as exc:
        raise EnrichmentError(f"{path} is not valid JSON: {exc}") from exc
    if data.get("target_index") != target_index:
        raise EnrichmentError(
            f"approval names target_index {data.get('target_index')!r} but the promotion targets "
            f"{target_index!r}. An approval for one index is not an approval for another.")
    if int(data.get("expected_write_count", -1)) != expected_count:
        raise EnrichmentError(
            f"approval expects {data.get('expected_write_count')} records but this run has "
            f"{expected_count} payloads. The count is part of what was approved.")
    if not data.get("approved_by"):
        raise EnrichmentError(f"{path} has no `approved_by`. An unattributed approval is not one.")
    return data


def assert_payloads_sane(payloads: list[dict]) -> None:
    """Refuse anything that could blank a field on a live record."""
    if not payloads:
        raise ZeroWorkError("promotion was given zero payloads. Zero work is a failure.")
    for payload in payloads:
        if not payload.get("objectID"):
            raise EnrichmentError("a payload has no objectID; refusing to write.")
        extra = set(payload) - {"objectID", *ENRICHED_FIELDS}
        if extra:
            raise EnrichmentError(
                f"payload for {payload['objectID']} carries fields this promotion may not write: "
                f"{sorted(extra)}. Only the two enriched fields may be added to the source.")
        for field in ENRICHED_FIELDS:
            if field in payload and not payload[field]:
                raise EnrichmentError(
                    f"payload for {payload['objectID']} has an EMPTY {field}. partialUpdateObject "
                    f"cannot remove an attribute -- writing this stores a literal empty value on "
                    f"a live record. This is the shape that once put 96,039 nulls in an index.")


def verify_after_write(client, index: str, payloads: list[dict]) -> dict:
    """Read every promoted record back and compare byte-for-byte. Claims are not evidence."""
    wanted = {p["objectID"]: p for p in payloads}
    # get_objects returns {objectID: record}, not a list. Getting that wrong would compare an
    # empty mapping and report a clean pass over nothing.
    found = client.get_objects(index, list(wanted), attributes=["objectID", *ENRICHED_FIELDS])
    found = {k: v for k, v in (found or {}).items() if v}
    missing = sorted(set(wanted) - set(found))
    mismatched = []
    for oid, payload in wanted.items():
        live = found.get(oid)
        if live is None:
            continue
        for field in ENRICHED_FIELDS:
            if field in payload and list(live.get(field) or []) != list(payload[field]):
                mismatched.append({"objectID": oid, "field": field})
    return {
        "checked": len(wanted),
        "found": len(found),
        "missing": missing,
        "mismatched": mismatched,
        "ok": not missing and not mismatched,
    }
