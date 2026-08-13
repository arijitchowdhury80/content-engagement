"""The gates around the only destructive step in the Documentation refresh.

This module writes ~1,934 rebuilt records into the live index and deletes ~2,433 that describe
pages which no longer exist. It is the step that cannot be taken back by re-running something, so
every guard here answers a specific way this has gone wrong before.

WHY THIS IS NOT `promote.py`.
  `promote.py` writes exactly two enriched fields onto records that already exist, and refuses a
  payload carrying anything else. The refresh replaces WHOLE records and removes others, so it
  needs the opposite payload check: every required field must be present, because a full-record
  replace overwrites what is live and a missing title blanks a real title.

THE DELETE COUNT IS PART OF THE APPROVAL.
  An approval naming only the index would let a run that computed 2,433 deletions and a run that
  computed 11,000 both proceed. The number is the dangerous part, so the approval names both
  counts and a mismatch stops the run.

VERIFICATION ASKS THE INDEX, NOT THE RESPONSE.
  A batch call returning 200 is not evidence that records changed, and a delete that silently did
  nothing looks exactly like one that worked. So after the write we read the new records back,
  confirm the deleted objectIDs are actually gone, and check the final total against the count
  predicted before the run. A deletion has been believed on this project once already because it
  was checked against the filesystem instead of the account.
"""

from __future__ import annotations

import json
import pathlib

from .errors import EnrichmentError, ZeroWorkError

APPROVAL_FILENAME = "documentation-refresh-approved.json"
SOURCE = "Documentation"

REQUIRED_FIELDS = ("objectID", "url", "title", "source", "page_type", "language_code",
                   "taxonomy_version")


def assert_records_sane(records: list[dict]) -> None:
    """Refuse any record that would degrade a live record if written over it."""
    if not records:
        raise ZeroWorkError("the refresh was given zero records. Zero work is a failure.")

    seen: set[str] = set()
    for record in records:
        for field in REQUIRED_FIELDS:
            if not str(record.get(field) or "").strip():
                raise EnrichmentError(
                    f"record {record.get('objectID') or '<no objectID>'} has an empty {field!r}. "
                    f"This is a full-record replace: writing it would blank that field on a live "
                    f"record.")
        if record["source"] != SOURCE:
            raise EnrichmentError(
                f"record {record['objectID']} has source {record['source']!r}; this refresh may "
                f"only write {SOURCE!r} records.")
        # description MAY be empty: 29 live pages genuinely have no meta description, and a blank
        # is the honest value. The body may not -- an empty body means the fetch returned nothing
        # and the record would replace a live record with less than it had.
        if not str(record.get("body") or "").strip():
            raise EnrichmentError(
                f"record {record['objectID']} has an empty body. The body is why the page was "
                f"re-fetched; an empty one means the fetch produced nothing.")
        if record["objectID"] in seen:
            raise EnrichmentError(
                f"duplicate objectID {record['objectID']} in the write set; one would silently "
                f"overwrite the other.")
        seen.add(record["objectID"])


def read_refresh_approval(run_dir, *, target_index: str, write_count: int,
                          delete_count: int) -> dict:
    """Arijit's explicit yes, naming the index and BOTH counts. Nobody else writes this file."""
    path = pathlib.Path(run_dir) / "approvals" / APPROVAL_FILENAME
    if not path.exists():
        raise EnrichmentError(
            f"refusing to refresh: {path} does not exist. Replacing {write_count} records and "
            f"deleting {delete_count} from a live index needs an explicit approval naming the "
            f"index and both counts.")
    try:
        data = json.loads(path.read_text())
    except json.JSONDecodeError as exc:
        raise EnrichmentError(f"{path} is not valid JSON: {exc}") from exc

    if data.get("target_index") != target_index:
        raise EnrichmentError(
            f"approval names target_index {data.get('target_index')!r} but this run targets "
            f"{target_index!r}. An approval for one index is not an approval for another.")
    if int(data.get("expected_write_count", -1)) != write_count:
        raise EnrichmentError(
            f"approval expects {data.get('expected_write_count')} writes but this run has "
            f"{write_count}. The count is part of what was approved.")
    if int(data.get("expected_delete_count", -1)) != delete_count:
        raise EnrichmentError(
            f"approval expects {data.get('expected_delete_count')} deletions but this run would "
            f"delete {delete_count}. The delete count is the dangerous number and an approval for "
            f"one figure is not an approval for another.")
    if not data.get("approved_by"):
        raise EnrichmentError(f"{path} has no `approved_by`. An unattributed approval is not one.")
    return data


def verify_after_refresh(client, index: str, records: list[dict], deleted_ids: list[str],
                         expected_total: int) -> dict:
    """Prove the refresh happened, by reading the index rather than trusting the write."""
    wanted = {r["objectID"]: r for r in records}
    found = {k: v for k, v in (client.get_objects(index, list(wanted)) or {}).items() if v}
    missing = sorted(set(wanted) - set(found))
    if missing:
        raise EnrichmentError(
            f"{len(missing)} of {len(wanted)} refreshed records cannot be read back from {index} "
            f"(first: {missing[:3]}). The write reported success but the index disagrees.")

    mismatched = []
    for object_id, want in wanted.items():
        got = found[object_id]
        for field in ("title", "url", "page_type", "source"):
            if got.get(field) != want.get(field):
                mismatched.append({"objectID": object_id, "field": field})
                break
    if mismatched:
        raise EnrichmentError(
            f"{len(mismatched)} refreshed records read back with different values "
            f"(first: {mismatched[:3]}).")

    if deleted_ids:
        still = {k: v for k, v in (client.get_objects(index, list(deleted_ids)) or {}).items() if v}
        if still:
            raise EnrichmentError(
                f"{len(still)} records that should have been deleted are STILL PRESENT in {index} "
                f"(first: {sorted(still)[:3]}). A delete that quietly did nothing looks exactly "
                f"like one that worked.")

    distinct, raw = client.record_count(index)
    if raw != expected_total:
        raise EnrichmentError(
            f"{index} holds {raw} records but the run predicted {expected_total}. The arithmetic "
            f"and the account disagree, so one of them is wrong; refusing to report success.")

    return {"ok": True, "verified_written": len(found), "verified_deleted": len(deleted_ids),
            "final_total": raw, "distinct": distinct, "index": index}
