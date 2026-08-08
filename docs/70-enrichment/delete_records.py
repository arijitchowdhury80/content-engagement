#!/usr/bin/env python3
"""
Delete records from an Algolia index by host, with a snapshot requirement and an exact
expected-count assertion.

FIRST USE — Chapter 3, Phase 0: remove 79 job-advert records whose URL host is
job-boards.greenhouse.io. Arijit, 2026-08-07: "Greenhouse records needs to go. We are not
answering anything about jobs." These are the records that made WU-06's `solutions` query
return five Greenhouse job adverts at ranks 1-5.

SAFETY, in the order the checks run
  1. --dry-run is the DEFAULT. --apply is required to write, and is refused without --yes.
  2. A snapshot of the index must exist AND its record count must equal the live count.
     A snapshot taken before some other change is not a rollback for this one.
  3. --expect N must match the number of records found. A mismatch aborts before any delete.
     This is the check that stops a filter change from silently deleting the wrong volume.
  4. Deleted objectIDs are written to a file before the delete, not after.
  5. After deleting, the LIVE index is re-counted and must equal (before - deleted).
     Verified on the surface the change was made to, never inferred from a 200 response.

  python3 docs/70-enrichment/delete_records.py --host job-boards.greenhouse.io --expect 79
  python3 docs/70-enrichment/delete_records.py --host job-boards.greenhouse.io --expect 79 \
      --apply --yes

TLS: curl via subprocess. Python's certifi cannot reach the Algolia API from this machine
(corporate TLS interception). Same pattern as dedupe.py and snapshot_enhanced.py.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlparse

sys.path.insert(0, str(Path(__file__).parent))
from snapshot_enhanced import algolia_post, browse_all, live_record_count, load_credentials  # noqa: E402

DEFAULT_INDEX = "Algolia_Prod_Copy_Enhanced"


def newest_snapshot(index: str, snap_dir: Path) -> tuple[Path, int] | None:
    """Return the newest snapshot for this index and the record count it holds."""
    if not snap_dir.exists():
        return None
    candidates = sorted(snap_dir.glob(f"{index}-*.jsonl"))
    if not candidates:
        return None
    newest = candidates[-1]
    manifest = newest.with_suffix("").with_suffix(".manifest.json")
    if manifest.exists():
        try:
            return newest, int(json.loads(manifest.read_text())["records"])
        except (KeyError, ValueError, json.JSONDecodeError):
            pass
    with newest.open() as fh:  # fall back to counting
        return newest, sum(1 for _ in fh)


def host_of(url: str) -> str:
    if not isinstance(url, str):
        return ""
    if url.startswith("http"):
        return urlparse(url).netloc
    return "www.algolia.com"  # relative paths are algolia.com by construction


def main() -> int:
    ap = argparse.ArgumentParser(description="Delete records from an Algolia index by URL host.")
    ap.add_argument("--index", default=DEFAULT_INDEX)
    ap.add_argument("--host", required=True, help="URL host whose records are deleted")
    ap.add_argument("--expect", type=int, required=True, help="exact number of records expected")
    ap.add_argument("--apply", action="store_true", help="actually delete (default: dry run)")
    ap.add_argument("--yes", action="store_true", help="required alongside --apply")
    ap.add_argument("--snapshots", default=str(Path(__file__).parent / "snapshots"))
    ap.add_argument("--out", default=str(Path(__file__).parent / "reports"))
    args = ap.parse_args()

    app, key = load_credentials()
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    # ---- 1. live census before anything -----------------------------------
    _, before = live_record_count(app, key, args.index)
    print(f"index  : {args.index}")
    print(f"live   : {before} records")

    # ---- 2. snapshot gate -------------------------------------------------
    snap = newest_snapshot(args.index, Path(args.snapshots))
    if snap is None:
        sys.exit(
            f"FATAL: no snapshot found in {args.snapshots}.\n"
            f"Run snapshot_enhanced.py first. There is no other rollback path for this index."
        )
    snap_path, snap_count = snap
    print(f"snap   : {snap_path.name} ({snap_count} records)")
    if snap_count != before:
        sys.exit(
            f"FATAL: snapshot holds {snap_count} records but the live index has {before}.\n"
            f"That snapshot predates some other change and is not a rollback for this one.\n"
            f"Take a fresh snapshot."
        )

    # ---- 3. find the targets ---------------------------------------------
    targets: list[dict] = []
    for rec in browse_all(app, key, args.index):
        if host_of(rec.get("url", "")) == args.host:
            targets.append({
                "objectID": rec["objectID"],
                "url": rec.get("url"),
                "title": rec.get("title"),
                "page_type": rec.get("page_type"),
            })

    print(f"matched: {len(targets)} records with host {args.host}")
    if len(targets) != args.expect:
        sys.exit(
            f"FATAL: expected exactly {args.expect} records, found {len(targets)}.\n"
            f"Refusing to delete. Either the index changed or the filter is wrong -- "
            f"both need a human before anything is removed."
        )

    by_type: dict[str, int] = {}
    for t in targets:
        by_type[t.get("page_type") or "<none>"] = by_type.get(t.get("page_type") or "<none>", 0) + 1
    print(f"page_type breakdown: {by_type}")
    print("first 3:")
    for t in targets[:3]:
        print(f"   {t['objectID']}  {t['url']}")

    stamp = dt.datetime.now().strftime("%Y%m%d-%H%M%S")
    manifest_path = out_dir / f"deleted-{args.host.replace('.', '_')}-{stamp}.json"

    if not args.apply:
        print(f"\nDRY RUN. Nothing deleted. {len(targets)} records would be removed.")
        print(f"Re-run with --apply --yes to delete. Expected result: {before} -> {before - len(targets)}")
        return 0

    if not args.yes:
        sys.exit("FATAL: --apply requires --yes. Refusing to delete on a single flag.")

    # ---- 4. record what is about to go, BEFORE it goes --------------------
    manifest_path.write_text(json.dumps({
        "index": args.index,
        "host": args.host,
        "deleted_at": dt.datetime.now().isoformat(),
        "count": len(targets),
        "count_before": before,
        "expected_after": before - len(targets),
        "snapshot": snap_path.name,
        "records": targets,
    }, indent=2) + "\n")
    print(f"\nwrote manifest first: {manifest_path.name}")

    # ---- 5. delete in batches -------------------------------------------
    ids = [t["objectID"] for t in targets]
    for i in range(0, len(ids), 100):
        batch = ids[i : i + 100]
        algolia_post(app, key, f"/1/indexes/{args.index}/batch",
                     {"requests": [{"action": "deleteObject", "body": {"objectID": o}} for o in batch]})
        print(f"  deleted {min(i + 100, len(ids))}/{len(ids)}")

    # ---- 6. verify on the surface the change was made to -----------------
    print("\nwaiting for indexing, then re-counting the LIVE index...")
    subprocess.run(["sleep", "8"], check=False)
    _, after = live_record_count(app, key, args.index)
    expected = before - len(targets)
    print(f"live after: {after} (expected {expected})")

    remaining = sum(1 for rec in browse_all(app, key, args.index)
                    if host_of(rec.get("url", "")) == args.host)
    print(f"records still matching {args.host}: {remaining}")

    if after != expected or remaining != 0:
        sys.exit(
            f"FAILED VERIFICATION: live count {after} vs expected {expected}, "
            f"{remaining} still match the host.\n"
            f"Indexing may lag -- re-run the census before concluding, then investigate."
        )
    print(f"\nVERIFIED on the live index: {before} -> {after}, 0 records match {args.host}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
