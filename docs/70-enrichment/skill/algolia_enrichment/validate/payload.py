"""Payload shape. Exactly three fields, no nulls, no duplicates, no metadata.

THE THREE FIELDS ARE THE WHOLE ALLOWANCE.

    objectID, abstract_enriched, keyhighlights_enriched

  Everything else -- provenance, offsets, hashes, verdicts, model ids, run ids -- lives in run
  artifacts. Arijit, 2026-08-09: the live records stay lean. Five Blog records once carried 12
  `enrichment_*` bookkeeping fields and had to be cleaned off the live index afterwards.

NO NULL FIELDS, EVER.
  `partialUpdateObject` cannot remove an attribute: setting one to null stores a LITERAL null.
  That put 96,039 nulls in a live index on 2026-08-05. A payload containing a null is refused
  here rather than discovered in the index later.

ABSTRACT IS STORED AS AN ARRAY, NOT A JOINED PARAGRAPH.
  A pre-joined string bakes a false adjacency into the index and makes the component spans
  unrecoverable. Algolia indexes string arrays natively, so searchable attributes and snippets
  work unchanged.
"""

from __future__ import annotations

from ..errors import EnrichmentError, ZeroWorkError

ALLOWED_FIELDS = frozenset({"objectID", "abstract_enriched", "keyhighlights_enriched"})

# Statuses whose records may be written. A status absent from this set is not writable, and the
# record goes to human review instead. JUDGE_HUMAN_REVIEW is deliberately NOT here: a judge
# verdict that does not change writability is not a gate, and the old pipeline's judge changed
# the outcome for zero records precisely because both its verdicts were writable.
WRITABLE_STATUSES = frozenset({"PASS"})


def build_payload(row: dict) -> dict | None:
    """One row -> one payload, or None when the row is not writable."""
    if row.get("status") not in WRITABLE_STATUSES:
        return None
    spans = row.get("abstract_spans_stored") or []
    if not spans:
        return None          # refuse to fall back to the joined string
    highlights = row.get("keyhighlights_enriched") or []
    payload = {
        "objectID": row["objectID"],
        "abstract_enriched": spans,
        "keyhighlights_enriched": highlights,
    }
    assert_payload(payload)
    return payload


def assert_payload(payload: dict) -> None:
    stray = set(payload) - ALLOWED_FIELDS
    if stray:
        raise EnrichmentError(
            f"payload for {payload.get('objectID')!r} carries fields outside the three allowed: "
            f"{sorted(stray)}. Provenance and audit metadata belong in run artifacts.")
    for k, v in payload.items():
        if v is None:
            raise EnrichmentError(
                f"payload field {k!r} is null. partialUpdateObject stores a literal null rather "
                f"than removing the attribute; 96,039 nulls reached a live index this way.")
    if not payload.get("abstract_enriched"):
        raise EnrichmentError(f"payload for {payload.get('objectID')!r} has an empty abstract")


def build_payloads(rows: list[dict]) -> tuple[list[dict], dict[str, int]]:
    """(payloads, skipped counts by status). Duplicate objectIDs are a hard failure.

    A duplicated results file is corrupt, not complete -- that was a real incident, and the row
    count looked right.
    """
    payloads: list[dict] = []
    skipped: dict[str, int] = {}
    seen_rows: set[str] = set()
    for row in rows:
        oid = row.get("objectID")
        if not oid:
            raise EnrichmentError("a result row has no objectID")
        if oid in seen_rows:
            raise EnrichmentError(
                f"duplicate objectID {oid!r} in the final artifact. A duplicated results file is "
                f"corrupt, not complete; rebuild it rather than deduplicating here.")
        seen_rows.add(oid)
        pl = build_payload(row)
        if pl is None:
            status = row.get("status", "UNKNOWN")
            skipped[status] = skipped.get(status, 0) + 1
            continue
        payloads.append(pl)
    return payloads, skipped


def check_payloads(payloads: list[dict], expected_target_ids: set[str] | None = None) -> dict:
    if not payloads:
        raise ZeroWorkError("payload validation ran on zero payloads. Zero work is a failure.")
    ids = [p["objectID"] for p in payloads]
    dupes = sorted({i for i in ids if ids.count(i) > 1})
    if dupes:
        raise EnrichmentError(f"duplicate objectIDs in payloads: {dupes[:5]}")
    for p in payloads:
        assert_payload(p)
    out_of_scope = sorted(set(ids) - expected_target_ids) if expected_target_ids else []
    if out_of_scope:
        raise EnrichmentError(
            f"{len(out_of_scope)} payload objectIDs are not in this run's manifest: "
            f"{out_of_scope[:5]}. A write may only touch records the slice planned.")
    return {
        "payloads": len(payloads),
        "fields": sorted(ALLOWED_FIELDS),
        "forbidden_fields_present": [],
        "duplicate_object_ids": [],
        "ok": True,
    }
