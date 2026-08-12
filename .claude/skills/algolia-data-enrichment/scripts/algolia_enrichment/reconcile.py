"""Decide, per record, whether the live site still has the page it describes.

This module is where deletion is decided, so its contract is a PARTITION: every input record
lands in exactly one bucket, and the buckets are proved to cover the input. A record that falls
through both is silently abandoned; a record counted twice is deleted after being refreshed.

  refresh -- the record's URL is a page on the live site. Rebuild it in place.
  new     -- the live site has a page no record describes. Create it.
  retire  -- no live page has this URL. Quarantine, then delete.

`retire` carries a reason because the two causes are different findings and the quarantine copy
must record which applied:

  dead-404            the page returned 404 in the liveness census (108 of these, verified three
                      independent ways: serial GET, the Next.js not-found marker in the body, and
                      absence from Algolia's own /doc/llms.txt index).
  stale-url-moved     the URL redirects elsewhere. The docs moved to Mintlify and per-language SDK
                      pages became one tabbed page, so up to 13 records now describe a single page.
  duplicate-path      two records whose URLs differ only in spelling (trailing slash, host form).

WHY MATCH ON THE STORED URL AND NOT THE REDIRECT TARGET.
  The question that decides deletion is "does the page this record claims to be still exist?" A
  record pointing at a URL that 301s elsewhere is describing a page that is gone, whatever it
  redirects to. Matching on redirect targets would mark all 13 language variants as live and
  preserve exactly the duplication this refresh exists to remove.
"""

from __future__ import annotations

from .errors import EnrichmentError
from .seed import canonical_key

REASON_DEAD = "dead-404"
REASON_STALE = "stale-url-moved"
REASON_DUPLICATE = "duplicate-path"

# The measured expectation is 57% retired. This guard is not that number -- it is the blast-radius
# stop for a seeder or matcher that broke, where the corpus would otherwise be emptied.
DEFAULT_MAX_RETIRE_SHARE = 0.75


def _survivor(records: list[dict], key: str) -> dict:
    """Pick one record to carry a page forward, deterministically.

    Prefers a record already spelled canonically, so the refresh does not gratuitously change
    objectIDs. Falls back to the lowest objectID, which makes the choice reproducible: the same
    inputs in any order must elect the same survivor, or two runs disagree about what to delete.
    """
    exact = [r for r in records if (r.get("url") or "") == key]
    pool = exact or records
    return min(pool, key=lambda r: str(r.get("objectID") or ""))


def reconcile(seed_rows: list[dict], records: list[dict], dead_keys: set[str],
              max_retire_share: float = DEFAULT_MAX_RETIRE_SHARE) -> dict:
    """Partition `records` against the live-site seed list."""
    if not seed_rows:
        raise EnrichmentError(
            "reconcile refused: the seed list is empty, which would classify every record in the "
            "corpus as deletable.")
    if not records:
        raise EnrichmentError("reconcile refused: no index records were supplied.")

    seed_keys = {row["key"] for row in seed_rows}

    by_key: dict[str, list[dict]] = {}
    for record in records:
        by_key.setdefault(canonical_key(record.get("url") or ""), []).append(record)

    refresh, retire = [], []
    for key, group in by_key.items():
        if key in seed_keys:
            keep = _survivor(group, key)
            refresh.append(keep)
            for other in group:
                if other is not keep:
                    retire.append({**other, "reason": REASON_DUPLICATE, "canonical_key": key})
        else:
            reason = REASON_DEAD if key in dead_keys else REASON_STALE
            for record in group:
                retire.append({**record, "reason": reason, "canonical_key": key})

    matched = {canonical_key(r.get("url") or "") for r in refresh}
    new = [row for row in seed_rows if row["key"] not in matched]

    # The partition is the safety property, so it is asserted rather than assumed.
    if len(refresh) + len(retire) != len(records):
        raise EnrichmentError(
            f"reconcile partition is unsound: {len(refresh)} refresh + {len(retire)} retire "
            f"!= {len(records)} input records.")
    ids = [str(r.get("objectID")) for r in refresh] + [str(r.get("objectID")) for r in retire]
    if len(ids) != len(set(ids)):
        raise EnrichmentError(
            "reconcile partition is unsound: a record appears in more than one bucket, which "
            "would delete a record that was also refreshed.")

    share = len(retire) / len(records)
    if share > max_retire_share:
        raise EnrichmentError(
            f"reconcile refused: {len(retire)} of {len(records)} records ({share:.1%}) would be "
            f"retired, above the {max_retire_share:.0%} guard. A seeder or matcher failure looks "
            f"exactly like this, so the run stops instead of emptying the corpus.")

    reasons: dict[str, int] = {}
    for row in retire:
        reasons[row["reason"]] = reasons.get(row["reason"], 0) + 1

    return {
        "refresh": refresh,
        "new": new,
        "retire": retire,
        "report": {
            "input_records": len(records),
            "seed_urls": len(seed_rows),
            "refresh": len(refresh),
            "new": len(new),
            "retire": len(retire),
            "retire_by_reason": reasons,
            "retire_share": round(share, 4),
            "predicted_final_count": len(refresh) + len(new),
        },
    }
