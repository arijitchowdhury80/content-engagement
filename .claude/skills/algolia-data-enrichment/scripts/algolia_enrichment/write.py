"""The only module that writes to Algolia. It cannot be pointed at the source index.

THE STRUCTURAL REFUSAL
  `assert_write_target` raises when the target equals the source, and every write path calls it
  before building a payload. That is not a policy reminder -- there is no argument combination
  that produces a write to the source index, because the payload never gets built.

  `CLAUDE.md` carries the reason: the source holds 11,928 records and the entire 8-axis taxonomy,
  and there is no snapshot of it. A copy, rename, swap or merge would destroy both. No command in
  this package copies or replaces an index, in v0 or later.

WRITES ADD FIELDS. NOTHING EXISTING IS OVERWRITTEN.
  `abstract` and `description` are left exactly as they are, so the change is reversible by
  deleting two fields. Null is never sent: `partialUpdateObject` cannot remove an attribute and
  a null is stored literally -- 96,039 of them reached a live index that way.

THE TARGET MUST BE SEARCHABLE OR v0 PROVES NOTHING.
  The source index's `searchableAttributes` EXCLUDE both enriched fields. Copying settings
  blindly gives a target index whose enrichment cannot be surfaced by any query, which is a
  result that cannot be observed even in isolation. `prepare_target_index` adds both fields --
  on the TARGET ONLY, which is not production and which nothing queries.
"""

from __future__ import annotations

from .errors import EnrichmentError
from .validate.search import add_enriched_searchable, assert_searchable_syntax

ENRICHED_FIELDS = ("abstract_enriched", "keyhighlights_enriched")


def assert_write_target(source_index: str, target_index: str) -> None:
    if not target_index:
        raise EnrichmentError("no --target-index resolved; refusing to write")
    if target_index == source_index:
        raise EnrichmentError(
            f"refusing to write to {target_index!r}: it is the SOURCE index. v0 writes only to "
            f"the approved parallel target. The source holds the whole taxonomy and has no "
            f"snapshot.")


def prepare_target_index(client, source_index: str, target_index: str,
                         create: bool = False) -> dict:
    """Create or verify the target by copying source SETTINGS ONLY. No records are copied.

    Returns the report `validation/target-index-ready.json` is written from.
    """
    assert_write_target(source_index, target_index)
    source_settings = client.get_settings(source_index)
    existed = client.index_exists(target_index)
    if not existed and not create:
        raise EnrichmentError(
            f"{target_index} does not exist and creation was not approved. "
            f"prepare-target-index needs approvals/target-index-approved.json.")

    desired = dict(source_settings)
    # Strip read-only/metadata keys Algolia rejects on a settings PUT.
    for k in ("primary", "replicas", "userData", "version"):
        desired.pop(k, None)
    desired["searchableAttributes"] = add_enriched_searchable(
        list(source_settings.get("searchableAttributes") or []), ENRICHED_FIELDS)

    client.set_settings(target_index, desired)
    after = client.get_settings(target_index)

    bad_syntax = assert_searchable_syntax(after.get("searchableAttributes") or [])
    _, target_records = client.record_count(target_index)
    missing = [f for f in ENRICHED_FIELDS
               if f"unordered({f})" not in (after.get("searchableAttributes") or [])
               and f not in (after.get("searchableAttributes") or [])]

    report = {
        "source_index": source_index,
        "target_index": target_index,
        "existed_before": existed,
        "created": not existed,
        "target_records": target_records,
        "source_searchable": source_settings.get("searchableAttributes"),
        "target_searchable": after.get("searchableAttributes"),
        "enriched_fields_searchable": not missing,
        "comma_joined_attributes": bad_syntax,
        "ok": not missing and not bad_syntax,
    }
    if not report["ok"]:
        raise EnrichmentError(
            f"target index settings are wrong after copy: missing={missing} "
            f"comma_joined={bad_syntax}. A comma-joined attribute reads back perfectly and is "
            f"silently unsearchable, so this is checked by a query in verify-live too.")
    return report


def apply_write(client, target_index: str, source_index: str, payloads: list[dict]) -> dict:
    """Write payloads to the TARGET index and wait for indexing to publish.

    `partialUpdateObject` (creating) is correct here: the parallel target starts empty, so
    `NoCreate` would fail every record.
    """
    assert_write_target(source_index, target_index)
    if not payloads:
        raise EnrichmentError("apply-write was given zero payloads. Zero work is a failure.")
    responses = client.save_objects(target_index, payloads, action="partialUpdateObject")
    task_ids = [r.get("taskID") for r in responses if r.get("taskID")]
    published = all(client.wait_task(target_index, t) for t in task_ids)
    return {
        "target_index": target_index,
        "written": len(payloads),
        "batches": len(responses),
        "task_ids": task_ids,
        "indexing_published": published,
        "objectIDs": [p["objectID"] for p in payloads],
    }
