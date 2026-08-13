"""Merge a rebuilt Documentation record over the record already in the index.

The refresh owns what it can prove from the live page: the canonical URL, the title, the
description, the body, and every taxonomy axis a URL rule decides. Everything else on the
existing record is carried forward untouched.

This exists because the write is a full-record replace. Writing only the rebuilt fields would
delete the rest, and `abstract` is populated on nearly every Documentation record AND sits in
`searchableAttributes` -- losing it would quietly degrade retrieval while the run reported
success.

Two rules, both narrow:
  * A fresh value wins only when it HAS a value. A page with no meta description today is not an
    instruction to delete the stored one.
  * A rule-derived axis overwrites a legacy one, because a rule-derived value is re-derivable and
    therefore provable. An axis no rule predicts is kept, with its original provenance intact --
    dropping it could break required-axis conformance and destroys information the rules cannot
    express.
"""

from __future__ import annotations

from .errors import EnrichmentError

# Fields the refresh derives from the live page and is therefore authoritative for.
REFRESH_OWNED = frozenset({
    "objectID", "url", "title", "description", "body", "source", "language_code",
    "taxonomy_version", "taxonomy_provenance", "taxonomy_confidence",
})

TAXONOMY_AXES = ("product", "feature", "solution", "industry", "customer",
                 "language_platform", "integration_platform", "page_type")

# Always rewritten, even if the fresh value looks empty: they are the identity of the record.
ALWAYS_OWNED = ("objectID", "url", "source", "language_code", "taxonomy_version")


def _populated(value) -> bool:
    if value is None:
        return False
    if isinstance(value, str):
        return bool(value.strip())
    if isinstance(value, (list, dict, tuple, set)):
        return len(value) > 0
    return True


def merge_record(existing: dict | None, fresh: dict) -> dict:
    """The record to write: everything the old one had, with the refresh applied over it."""
    if not existing:
        return dict(fresh)

    merged = dict(existing)

    for field in ALWAYS_OWNED:
        if field in fresh:
            merged[field] = fresh[field]

    for field in ("title", "description", "body"):
        if field in fresh and (_populated(fresh[field]) or not _populated(existing.get(field))):
            merged[field] = fresh[field]

    provenance = dict(existing.get("taxonomy_provenance") or {})
    confidence = dict(existing.get("taxonomy_confidence") or {})
    fresh_provenance = fresh.get("taxonomy_provenance") or {}
    fresh_confidence = fresh.get("taxonomy_confidence") or {}
    for axis in TAXONOMY_AXES:
        if axis in fresh and _populated(fresh[axis]):
            merged[axis] = fresh[axis]
            provenance[axis] = fresh_provenance.get(axis, "url-rule")
            confidence[axis] = fresh_confidence.get(axis, "high")
    merged["taxonomy_provenance"] = provenance
    merged["taxonomy_confidence"] = confidence
    return merged


def fill_required_axes(record: dict, schema: dict) -> dict:
    """Set any REQUIRED axis still empty to the schema's own `unknown` placeholder.

    A URL rule cannot decide every axis. `/doc/libraries/sdk/methods/search/assign-user-id` is a
    multi-cluster method and the 30-value feature vocabulary has no term for it, so no rule
    supplies one -- yet `feature` is required on `doc-sdk-unified`.

    `unknown` is the schema's sanctioned answer to exactly that, not a workaround: the conformance
    checker accepts it on a required axis and rejects it anywhere else, and the previous corpus
    already used it here -- the old per-language versions of these same nine methods carry
    `feature: unknown` on 12 or 13 records each.

    Provenance records that no rule decided it, so a later pass can find these rather than mistake
    them for derived values.
    """
    page_type = record.get("page_type")
    provenance = dict(record.get("taxonomy_provenance") or {})
    confidence = dict(record.get("taxonomy_confidence") or {})
    for axis in schema.get("axes", []):
        name = axis["name"]
        if name == "page_type":
            continue
        required_on = axis.get("required_on", [])
        if not ("*" in required_on or page_type in required_on):
            continue
        if _populated(record.get(name)):
            continue
        record[name] = ["unknown"]
        provenance[name] = "unresolved-no-rule"
        confidence[name] = "low"
    record["taxonomy_provenance"] = provenance
    record["taxonomy_confidence"] = confidence
    return record


def assert_no_field_lost(existing: dict, merged: dict) -> None:
    """Regression guard for the defect this module exists to prevent.

    Any field that HAD a value before the refresh must still have one after it. A field that was
    already empty may disappear; a populated one may not.
    """
    lost = []
    for field, value in (existing or {}).items():
        if not _populated(value):
            continue
        if field not in merged or not _populated(merged[field]):
            lost.append(field)
    if lost:
        raise EnrichmentError(
            f"the merge would drop populated field(s) {sorted(lost)} from "
            f"{existing.get('objectID')!r}. A full-record replace that loses a populated field "
            f"degrades the record while reporting success.")
