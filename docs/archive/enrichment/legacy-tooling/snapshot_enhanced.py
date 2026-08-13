#!/usr/bin/env python3
"""
Snapshot Algolia_Prod_Copy_Enhanced to a local JSONL before anything destructive runs.

WHY THIS EXISTS
  There is no snapshot of Enhanced and there never has been. Both pre-dedupe snapshots were
  deleted on 2026-08-06 on Arijit's instruction, so the 4,853 records removed that day are
  unrecoverable except from Vanilla -- which cannot be used to rebuild Enhanced, because a raw
  copy restores the duplicates AND wipes the entire 8-axis taxonomy.

  Chapter 3 deletes 79 Greenhouse records and writes two new fields to ~12,000 records. Neither
  is reversible without this file.

CONTRACT
  * Full census. Every record, no sampling, no attribute filter -- a partial snapshot is not a
    snapshot, and a rollback from one silently drops fields.
  * Verifies the written line count against the live index's own count before declaring success.
  * Refuses to overwrite an existing snapshot for the same day unless --force.
  * Read-only against Algolia. Writes one local file.

  python3 docs/operations/enrichment/snapshot_enhanced.py
  python3 docs/operations/enrichment/snapshot_enhanced.py --index Algolia_Prod_Copy_Enhanced --out <dir>

TLS NOTE
  Uses curl via subprocess, not urllib. Python's certifi cannot reach the Algolia API from this
  machine -- corporate TLS interception presents a self-signed root that certifi does not carry:
      ssl.SSLCertVerificationError: self-signed certificate in certificate chain
  curl uses the macOS keychain and works. Same pattern as dedupe.py.
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import subprocess

from curl_secret import curl as secret_curl
import sys
from pathlib import Path

DEFAULT_INDEX = "Algolia_Prod_Copy_Enhanced"
ENV_CANDIDATES = [
    Path.home() / "Dropbox/AI-Development/algolia-com/.env.local",
    Path(__file__).resolve().parents[2] / ".env.local",
]


def load_credentials() -> tuple[str, str]:
    """Read app id and admin key from the first env file that carries them.

    Never printed, never logged, never passed on a command line that could reach `ps`.
    """
    for path in ENV_CANDIDATES:
        if not path.exists():
            continue
        values: dict[str, str] = {}
        for line in path.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, val = line.partition("=")
            values[key.strip()] = val.strip().strip('"').strip("'")
        app = values.get("ALGOLIA_APP_ID")
        key = values.get("ALGOLIA_ADMIN_API_KEY") or values.get("ALGOLIA_ADMIN_KEY")
        if app and key:
            return app, key
    sys.exit(
        "FATAL: no ALGOLIA_APP_ID + ALGOLIA_ADMIN_API_KEY found in:\n  "
        + "\n  ".join(str(p) for p in ENV_CANDIDATES)
    )


def algolia_post(app: str, key: str, path: str, body: dict) -> dict:
    """POST to the Algolia REST API via curl. Credentials go in headers, not the URL."""
    # The ADMIN key never enters argv. `write_enrichment.py` posts through this function, so a
    # credential here is the one that can change the live index -- see curl_secret.
    proc = secret_curl(
        [
            "-s", "--max-time", "120", "-X", "POST",
            f"https://{app}-dsn.algolia.net{path}",
            "-H", "Content-Type: application/json",
            "-d", json.dumps(body),
        ],
        {"X-Algolia-Application-Id": app, "X-Algolia-API-Key": key},
    )
    if proc.returncode != 0:
        sys.exit(f"FATAL: curl failed ({proc.returncode}) on {path}: {proc.stderr[:300]}")
    try:
        data = json.loads(proc.stdout)
    except json.JSONDecodeError:
        sys.exit(f"FATAL: non-JSON from {path}: {proc.stdout[:300]}")
    if isinstance(data, dict) and data.get("status") and data.get("message"):
        sys.exit(f"FATAL: Algolia error on {path}: {data['status']} {data['message']}")
    return data


def live_record_count(app: str, key: str, index: str) -> tuple[int, int]:
    """Return (nbHits under distinct, raw record count).

    Enhanced has `distinct: true` on `url`, so a plain query's nbHits is the DISTINCT-URL count,
    not the record count. Reading one and calling it the other is what made a whole plan's
    problem statement false on 2026-08-06. `distinct: false` gets the real total.
    """
    distinct = algolia_post(app, key, f"/1/indexes/{index}/query",
                            {"query": "", "hitsPerPage": 0})
    raw = algolia_post(app, key, f"/1/indexes/{index}/query",
                       {"query": "", "hitsPerPage": 0, "distinct": False})
    return int(distinct.get("nbHits", -1)), int(raw.get("nbHits", -1))


def browse_all(app: str, key: str, index: str):
    """Yield every record. No attributesToRetrieve -- a snapshot keeps every field."""
    cursor = None
    while True:
        body: dict = {"hitsPerPage": 1000}
        if cursor:
            body["cursor"] = cursor
        page = algolia_post(app, key, f"/1/indexes/{index}/browse", body)
        for hit in page.get("hits", []):
            yield hit
        cursor = page.get("cursor")
        if not cursor:
            return


def main() -> int:
    ap = argparse.ArgumentParser(description="Snapshot an Algolia index to local JSONL.")
    ap.add_argument("--index", default=DEFAULT_INDEX)
    ap.add_argument("--out", default=str(Path(__file__).parent / "snapshots"))
    ap.add_argument("--force", action="store_true", help="overwrite today's snapshot")
    args = ap.parse_args()

    app, key = load_credentials()
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    stamp = dt.datetime.now().strftime("%Y%m%d-%H%M%S")
    day = stamp[:8]

    existing = sorted(out_dir.glob(f"{args.index}-{day}*.jsonl"))
    if existing and not args.force:
        print(f"A snapshot for today already exists:\n  {existing[-1]}\nUse --force to add another.")
        return 0

    print(f"index : {args.index}")
    distinct_hits, raw_hits = live_record_count(app, key, args.index)
    print(f"live  : {distinct_hits} distinct-URL hits | {raw_hits} raw records")
    if raw_hits <= 0:
        sys.exit("FATAL: live count is zero or unreadable. Refusing to write an empty snapshot.")

    out_path = out_dir / f"{args.index}-{stamp}.jsonl"
    written = 0
    digest = hashlib.sha256()
    with out_path.open("w", encoding="utf-8") as fh:
        for record in browse_all(app, key, args.index):
            line = json.dumps(record, ensure_ascii=False, sort_keys=True)
            fh.write(line + "\n")
            digest.update(line.encode("utf-8"))
            written += 1
            if written % 2000 == 0:
                print(f"  ... {written}")

    size_mb = out_path.stat().st_size / 1_000_000
    print(f"\nwrote : {written} records, {size_mb:.1f} MB")
    print(f"path  : {out_path}")
    print(f"sha256: {digest.hexdigest()}")

    # A snapshot that does not match the live index is not a rollback, it is a trap.
    if written != raw_hits:
        out_path.rename(out_path.with_suffix(".jsonl.INCOMPLETE"))
        sys.exit(
            f"FATAL: wrote {written} but the live index reports {raw_hits} records.\n"
            f"Renamed to .INCOMPLETE so it cannot be mistaken for a usable snapshot."
        )

    manifest = out_dir / f"{args.index}-{stamp}.manifest.json"
    manifest.write_text(json.dumps({
        "index": args.index,
        "taken_at": dt.datetime.now().isoformat(),
        "records": written,
        "distinct_url_hits": distinct_hits,
        "raw_records": raw_hits,
        "sha256": digest.hexdigest(),
        "bytes": out_path.stat().st_size,
        "file": out_path.name,
        "note": "Full census, every field retained. Enhanced has distinct:true on url, so "
                "distinct_url_hits != raw_records is expected and is not a defect.",
    }, indent=2) + "\n")
    print(f"manifest: {manifest.name}")
    print(f"\nVERIFIED: {written} written == {raw_hits} live records.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
