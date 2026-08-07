#!/usr/bin/env python3
"""
Write taxonomy assignments onto an Algolia index.

    python3 apply_taxonomy.py --index Algolia_Prod_Copy_Enhanced \
        --records <corpus.jsonl> --assignments <assignments.jsonl> [--settings] [--dry-run]

Design notes worth keeping:

* The JOIN KEY IS THE URL, never objectID. In this corpus 8,507 objectIDs are
  absolute URLs while 8,460 are locale-prefixed UUIDs — objectID has no single
  format and cannot be derived. Assignments are computed once per distinct URL
  (12,114) and fanned out to every objectID sharing it (16,967). One ebook URL
  carries 38 records; without the fan-out those 37 would be silently skipped.

* partialUpdateObjects, not saveObjects — every existing field is preserved.

* Each batch's taskID is polled to `published` before the next batch is sent,
  and the run aborts on the first failure rather than leaving the index in a
  half-written state.

* WRITE MODE MATTERS, and this cost a rollback to learn:
  partialUpdateObject can ADD or OVERWRITE an attribute but can never REMOVE
  one. Setting a field to null stores a literal null; it does not delete the
  key. A first attempt used --purge-first to clear stale fields and put 96,039
  nulls into the index — reproducing the exact "null as a value" defect this
  schema exists to prevent.
  So the default is --replace: build the COMPLETE record (original fields +
  only the applicable taxonomy fields) and saveObject it. A non-applicable axis
  is then genuinely absent, and the operation is idempotent, which is what an
  ongoing re-runnable pipeline requires.

* urllib is deliberately avoided: it fails SSL verification in this
  environment. curl via subprocess is the working path.
"""

import argparse
import collections
import json
import os
import subprocess
import sys
import tempfile
import time

TAX_FIELDS = ["page_type", "product", "feature", "solution", "industry", "customer",
              "language_platform", "integration_platform",
              "taxonomy_provenance", "taxonomy_confidence", "taxonomy_version"]


def curl(method, url, key, app, payload=None):
    """Full-record batches exceed the argv limit (OSError 7), so the body always
    goes via a temp file rather than -d on the command line."""
    cmd = ["curl", "-s", "-X", method, url,
           "-H", f"X-Algolia-API-Key: {key}",
           "-H", f"X-Algolia-Application-Id: {app}",
           "-H", "Content-Type: application/json"]
    tmp = None
    if payload is not None:
        fd, tmp = tempfile.mkstemp(suffix=".json")
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False)
        cmd += ["--data-binary", "@" + tmp]
    try:
        r = subprocess.run(cmd, capture_output=True, text=True)
    finally:
        if tmp:
            os.unlink(tmp)
    try:
        return json.loads(r.stdout)
    except json.JSONDecodeError:
        return {"_raw": r.stdout[:400], "_err": r.stderr[:200]}


def wait(app, key, index, task_id, timeout=180):
    url = f"https://{app}.algolia.net/1/indexes/{index}/task/{task_id}"
    for _ in range(timeout):
        if curl("GET", url, key, app).get("status") == "published":
            return True
        time.sleep(1)
    return False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--index", required=True)
    ap.add_argument("--records", required=True)
    ap.add_argument("--assignments", required=True)
    ap.add_argument("--batch", type=int, default=1000)
    ap.add_argument("--settings", action="store_true", help="also apply faceting config")
    ap.add_argument("--replace", action="store_true",
                    help="full saveObject replace (required to REMOVE non-applicable axes)")
    ap.add_argument("--purge-first", action="store_true",
                    help="DEPRECATED - writes literal nulls; use --replace instead")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    app = os.environ["ALGOLIA_APP_ID"]
    key = os.environ["ALGOLIA_ADMIN_API_KEY"]

    assign = {}
    for line in open(args.assignments, encoding="utf-8"):
        a = json.loads(line)
        assign[str(a["url"]).strip()] = a
    recs = [json.loads(l) for l in open(args.records, encoding="utf-8")]
    print(f"assignments {len(assign)} | records {len(recs)}")

    payloads, missing = [], 0
    fanout = collections.Counter()
    for r in recs:
        a = assign.get(str(r.get("url", "")).strip())
        if a is None:
            missing += 1
            continue
        fanout[a["url"]] += 1
        if args.replace:
            # Full record: every original field except Algolia's own
            # response-only keys, plus the applicable taxonomy fields. Any
            # taxonomy field absent here is genuinely removed from the index.
            body = {k: v for k, v in r.items() if not k.startswith("_")}
            for f in TAX_FIELDS:
                body.pop(f, None)
        else:
            body = {"objectID": r["objectID"]}
        for f in TAX_FIELDS:
            if f in a:
                body[f] = a[f]
        payloads.append(body)

    print(f"payloads {len(payloads)} | records with no assignment {missing}")
    print(f"max fan-out for a single url: {max(fanout.values())}")
    if missing:
        print("ABORT — every record must map to an assignment.")
        sys.exit(2)

    if args.dry_run:
        print("\ndry run; sample payload:")
        print(json.dumps(payloads[0], indent=1)[:700])
        return

    if args.purge_first:
        purge = [{"objectID": p["objectID"], **{f: None for f in TAX_FIELDS}} for p in payloads]
        _push(app, key, args.index, purge, args.batch, "purge")

    _push(app, key, args.index, payloads, args.batch, "replace" if args.replace else "write")

    if args.settings:
        apply_settings(app, key, args.index)


def _push(app, key, index, payloads, batch, label):
    url = f"https://{app}.algolia.net/1/indexes/{index}/batch"
    total = (len(payloads) + batch - 1) // batch
    for i in range(0, len(payloads), batch):
        chunk = payloads[i:i + batch]
        action = "updateObject" if label == "replace" else "partialUpdateObject"
        body = {"requests": [{"action": action, "body": c} for c in chunk]}
        resp = curl("POST", url, key, app, body)
        tid = resp.get("taskID")
        n = i // batch + 1
        if not tid:
            print(f"  [{label} {n}/{total}] FAILED: {str(resp)[:300]}")
            sys.exit(3)
        ok = wait(app, key, index, tid)
        print(f"  [{label} {n}/{total}] {len(chunk)} records, task {tid} -> {'published' if ok else 'TIMEOUT'}")
        if not ok:
            sys.exit(3)


def apply_settings(app, key, index):
    """Facets are declared afterDistinct because the index runs distinct:true on
    url. Without it, counts would include the 4,853 duplicate records — the
    facet would read 900 while the result set showed 600."""
    url = f"https://{app}.algolia.net/1/indexes/{index}/settings"
    cur = curl("GET", url, key, app)
    existing = list(cur.get("attributesForFaceting") or [])
    new = [
        "afterDistinct(page_type)",
        "afterDistinct(searchable(product))",
        "afterDistinct(searchable(feature))",
        "afterDistinct(searchable(solution))",
        "afterDistinct(searchable(industry))",
        "afterDistinct(customer)",
        "afterDistinct(language_platform)",
        "afterDistinct(integration_platform)",
        "filterOnly(taxonomy_version)",
    ]
    merged = existing + [f for f in new if f not in existing]
    body = {"attributesForFaceting": merged, "maxValuesPerFacet": 300}
    resp = curl("PUT", url, key, app, body)
    tid = resp.get("taskID")
    print(f"  settings task {tid} -> {'published' if tid and wait(app, key, index, tid) else 'FAILED'}")
    print(f"  attributesForFaceting now {len(merged)} entries; maxValuesPerFacet 300")


if __name__ == "__main__":
    main()
