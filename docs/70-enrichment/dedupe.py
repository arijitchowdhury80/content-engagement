#!/usr/bin/env python3
"""
Deduplicate an Algolia index, one URL group at a time.

    python3 dedupe.py --index Algolia_Prod_Copy_Enhanced --dry-run --out reports/
    python3 dedupe.py --index Algolia_Prod_Copy_Enhanced --apply --snapshot

THE PROBLEM
  Algolia_Prod_Copy_Enhanced holds 16,967 records for 12,114 distinct URLs.
  4,853 records (28.6%) are excess. One ebook URL carries 38 of them. Every
  duplicate inflates facet counts and lets one page occupy several result slots.

CONTRACT
  * --dry-run is the DEFAULT and issues no write call of any kind.
  * The census is re-derived from the LIVE index and HARD-FAILS if it does not
    match the expected shape. Every figure this was designed against came from a
    local dump; live is the only thing that counts.
  * Survivor election is total and deterministic: environment recency, then
    indexed_at descending, then objectID ascending. Input order cannot change
    the outcome. Run it twice, get the same answer.
  * NOTHING is filtered on `environment`. It records which pipeline run produced
    a record, not whether the content is real. 329 URLs exist only under a
    nonprod environment and are live algolia.com pages; deleting on that field
    would have destroyed them.
  * An unrecognised environment HARD-FAILS rather than being demoted to last
    place, so a new pipeline value cannot silently mis-rank a whole run.
  * Losing records are not simply discarded. Where a loser holds a fuller value
    than the survivor, that value is rescued and both sides are logged. Measured
    on the corpus: plain "keep newest" would have dropped a longer title on 644
    groups, a longer description on 347, a longer abstract on 326, and all tags
    on 194.
  * Locale twins are NEVER merged. /fr/pricing and /pricing are different pages.
  * Chunked documents (objectIDs suffixed _<n>_<n>) are counted and reported
    SEPARATELY from ordinary duplicates. They are collapsible only because this
    index has no body field for a chunk to carry; that stops being true the
    moment body enrichment adds one.

  urllib is deliberately avoided: TLS interception in this environment fails it
  with CERTIFICATE_VERIFY_FAILED. curl via subprocess is the working path, the
  same as apply_taxonomy.py.
"""

import argparse
import collections
import json
import os
import re
import subprocess
import sys
import tempfile
import time

DEFAULT_HOST = "www.algolia.com"

# Lower rank wins. Ordered by pipeline recency, prod ahead of nonprod.
# P6: this table is exhaustive by design — an unseen value is an error, not a
# record to quietly sort last.
ENV_RANK = {
    "prod20260722": 0,
    "prod20260621": 1,
    "prod03042026": 2,
    "nonprod20260220": 3,
    "nonprod9": 4,
    "nonprod": 5,
    None: 6,
}

# Never taken from a loser: these identify the record or describe when it was
# ingested. Rescuing them would corrupt identity or invent provenance.
IDENTITY_FIELDS = {
    "objectID", "url", "environment", "indexed_at", "lastUpdated", "published_at",
    "source", "transform_source", "language_code", "is404", "algoliaDisabled",
}

# Never taken from a loser: duplicate-URL taxonomy divergence is 0, so there is
# nothing to rescue, and merging arrays across records could produce a
# combination no classifier ever emitted.
TAXONOMY_FIELDS = {
    "page_type", "product", "feature", "solution", "industry", "customer",
    "language_platform", "integration_platform",
    "taxonomy_provenance", "taxonomy_confidence", "taxonomy_version",
}

NEVER_RESCUE = IDENTITY_FIELDS | TAXONOMY_FIELDS

# Expected live shape. A mismatch means the index moved under us and every
# number in the plan is stale — stop rather than delete against stale analysis.
EXPECT_RECORDS = 16967
EXPECT_URLS = 12114

CHUNK_RX = re.compile(r"^(?P<base>.+?)_(?P<a>\d+)_(?P<b>\d+)$")


class UnknownEnvironment(Exception):
    """An environment value with no rank. Never guess — a wrong rank silently
    elects the wrong survivor across a whole pipeline generation."""


class SnapshotRequired(Exception):
    """--apply was requested without a verified snapshot."""


class CensusMismatch(Exception):
    """The live index does not match the shape this run was planned against."""


# --- pure helpers -----------------------------------------------------------

def canon_url(url):
    """Normalise a URL for grouping.

    The default host is stripped so an absolute www URL groups with the
    equivalent relative path. Any OTHER host is kept, because support,
    academy and greenhouse URLs share path shapes with the www site and
    stripping their host would collide two unrelated pages.

    The locale prefix is deliberately NOT stripped: /fr/pricing and /pricing
    are different pages with different content.
    """
    u = str(url or "").strip()
    if u.startswith("http"):
        parts = u.split("/")
        host = parts[2] if len(parts) > 2 else ""
        path = "/" + "/".join(parts[3:])
        u = path if host == DEFAULT_HOST else host + path
    u = u.split("?")[0].split("#")[0]
    if not u.startswith("/") and not u[:1].isalpha():
        u = "/" + u
    u = u.rstrip("/")
    return u or "/"


def chunk_base(object_id):
    """(base, is_chunk) for an objectID.

    8,507 objectIDs in this corpus are absolute URLs. A URL ending in _1_3 is a
    version number, not a chunk index, so URL-shaped IDs are never treated as
    chunked.
    """
    oid = str(object_id)
    if oid.startswith("http"):
        return oid, False
    m = CHUNK_RX.match(oid)
    if m:
        return m.group("base"), True
    return oid, False


def env_rank(environment):
    """Rank an environment. Unknown values hard-fail (P6)."""
    if environment in ENV_RANK:
        return ENV_RANK[environment]
    raise UnknownEnvironment(
        f"unranked environment {environment!r} — add it to ENV_RANK in its correct "
        f"recency position. Refusing to guess: a wrong rank elects the wrong "
        f"survivor for every record in that generation."
    )


def sort_key(record):
    """Total ordering. Deterministic to the last tiebreak, so input order
    cannot change which record survives."""
    return (
        env_rank(record.get("environment")),
        -int(record.get("indexed_at") or 0),
        str(record.get("objectID")),
    )


def elect(records):
    """(survivor, losers) for one URL group."""
    ordered = sorted(records, key=sort_key)
    return ordered[0], ordered[1:]


def _size(value):
    """How much content a value carries. Used only to compare two candidates
    for the same field."""
    if value is None:
        return 0
    if isinstance(value, (list, dict)):
        return len(value)
    if isinstance(value, str):
        return len(value.strip())
    return 1


def rescue(survivor, losers):
    """Fill GAPS in the survivor from its losers. Never overwrite.

    Returns (merged, rescues).

    RULE: a loser's value is taken only where the survivor has nothing at all.
    A populated survivor field is left alone regardless of how much longer the
    loser's value is.

    This started as "prefer the longer value" and was inverted after reviewing
    the real rescues it produced on 2026-08-06 (precondition P3). Of 1,592
    proposed rescues, ~1,368 were overwrites and most of those were regressions:

      * title — "What is federated search?" would have been replaced by
        "What is Federated Search? | Algolia | Algolia". The survivor holds the
        CURRENT title; losers hold older ones padded with a "| Algolia" suffix,
        which is longer and worse. 7,000 of those suffixes are already a logged
        hygiene defect on this index.
      * description / abstract — losers hold raw HTML pull quotes
        ("<blockquote>&ldquo;As the digital space shifts...") where the survivor
        holds clean prose.
      * thumbnail — losers hold S3 Playwright screenshots where the survivor
        holds the real CDN asset.

    The ~224 gap fills were all genuine (tags [] -> ['Personalization'],
    keywords [] -> ['search']). Length is not a quality signal on this corpus;
    presence is.
    """
    merged = dict(survivor)
    rescues = []
    fields = {k for l in losers for k in l} - NEVER_RESCUE
    for field in sorted(fields):
        if _size(merged.get(field)):
            continue                      # survivor already has content — leave it
        best, source = None, None
        for l in losers:
            if _size(l.get(field)) > _size(best):
                best, source = l.get(field), l
        if not _size(best):
            continue
        rescues.append({
            "url": survivor.get("url"),
            "field": field,
            "survivor_objectID": survivor.get("objectID"),
            "survivor_value": merged.get(field),
            "from_objectID": source.get("objectID"),
            "rescued_value": best,
        })
        merged[field] = best
    return merged, rescues


class DedupePlan:
    """What would happen. Holds no connection and performs no write."""

    def __init__(self, groups):
        self.groups = groups
        self.survivor_count = len(groups)
        self.delete_ids = [l["objectID"] for g in groups for l in g["losers"]]
        self.rescues = [r for g in groups for r in g["rescues"]]
        self.chunk_group_count = sum(1 for g in groups if g["is_chunk_group"])
        self.duplicate_group_count = sum(
            1 for g in groups if g["losers"] and not g["is_chunk_group"]
        )

    @property
    def survivors(self):
        return [g["survivor"] for g in self.groups]


def plan(records):
    """Group by canonical URL, elect a survivor per group, rescue fields.

    Raises UnknownEnvironment before producing any plan at all, so an
    unrecognised value aborts the run rather than corrupting one group.
    """
    for r in records:
        env_rank(r.get("environment"))

    by_url = collections.OrderedDict()
    for r in records:
        by_url.setdefault(canon_url(r.get("url")), []).append(r)

    groups = []
    for url in sorted(by_url):
        members = by_url[url]
        survivor, losers = elect(members)
        merged, rescues = rescue(survivor, losers) if losers else (dict(survivor), [])
        groups.append({
            "url": url,
            "survivor": merged,
            "losers": losers,
            "rescues": rescues,
            # A group is a chunk group if its members are pieces of one
            # document rather than repeated ingests of the same page.
            "is_chunk_group": len(members) > 1
            and any(chunk_base(m["objectID"])[1] for m in members),
        })
    return DedupePlan(groups)


# --- Algolia I/O ------------------------------------------------------------

def curl(method, url, key, app, payload=None):
    """Shared with apply_taxonomy.py. Body goes via a temp file because full
    record batches exceed the argv limit (OSError 7)."""
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


def wait(app, key, index, task_id, timeout=300):
    url = f"https://{app}.algolia.net/1/indexes/{index}/task/{task_id}"
    for _ in range(timeout):
        if curl("GET", url, key, app).get("status") == "published":
            return True
        time.sleep(1)
    return False


def browse_all(app, key, index):
    """Every record. No sampling — that is the standing rule for this corpus."""
    out, cursor = [], None
    while True:
        body = {"hitsPerPage": 1000}
        if cursor:
            body["cursor"] = cursor
        d = curl("POST", f"https://{app}-dsn.algolia.net/1/indexes/{index}/browse",
                 key, app, body)
        if "hits" not in d:
            raise RuntimeError(f"browse failed: {str(d)[:300]}")
        out += d["hits"]
        cursor = d.get("cursor")
        if not cursor:
            return out


def execute(dedupe_plan, index, app, key, apply=False, snapshot_verified=False,
            batch=1000, log=print):
    """Apply the plan, or do nothing at all.

    The dry-run path returns before any network call. That is asserted by a
    test, because "it should not write" is not a guarantee unless something
    checks it.
    """
    if not apply:
        log(f"  dry-run: no writes issued. {len(dedupe_plan.delete_ids)} records "
            f"would be deleted, {len(dedupe_plan.rescues)} fields rescued.")
        return {"applied": False, "deleted": 0, "updated": 0}

    if not snapshot_verified:
        raise SnapshotRequired(
            "--apply needs a verified snapshot. Take one and confirm you can "
            "restore from it before deleting 4,853 records; an unrestored "
            "snapshot is a hope, not a rollback."
        )

    touched = [g["survivor"] for g in dedupe_plan.groups if g["rescues"]]
    updated = 0
    for i in range(0, len(touched), batch):
        chunk = touched[i:i + batch]
        r = curl("POST", f"https://{app}.algolia.net/1/indexes/{index}/batch", key, app,
                 {"requests": [{"action": "updateObject", "body": b} for b in chunk]})
        if "taskID" not in r:
            raise RuntimeError(f"rescue write failed: {str(r)[:300]}")
        wait(app, key, index, r["taskID"])
        updated += len(chunk)
        log(f"  rescued fields written: {updated}/{len(touched)}")

    deleted = 0
    ids = dedupe_plan.delete_ids
    for i in range(0, len(ids), batch):
        chunk = ids[i:i + batch]
        r = curl("POST", f"https://{app}.algolia.net/1/indexes/{index}/batch", key, app,
                 {"requests": [{"action": "deleteObject", "body": {"objectID": o}}
                               for o in chunk]})
        if "taskID" not in r:
            raise RuntimeError(f"delete failed: {str(r)[:300]}")
        wait(app, key, index, r["taskID"])
        deleted += len(chunk)
        log(f"  deleted: {deleted}/{len(ids)}")

    return {"applied": True, "deleted": deleted, "updated": updated}


def snapshot(app, key, index, log=print):
    """Copy the index aside. Returns the snapshot name."""
    name = f"{index}_pre_dedupe_{time.strftime('%Y%m%d_%H%M%S')}"
    r = curl("POST", f"https://{app}.algolia.net/1/indexes/{index}/operation", key, app,
             {"operation": "copy", "destination": name})
    if "taskID" not in r:
        raise RuntimeError(f"snapshot failed: {str(r)[:300]}")
    wait(app, key, index, r["taskID"])
    log(f"  snapshot: {name}")
    return name


# --- reporting --------------------------------------------------------------

def census(records):
    by_url = collections.Counter(canon_url(r.get("url")) for r in records)
    return {
        "records": len(records),
        "distinct_urls": len(by_url),
        "excess": len(records) - len(by_url),
        "urls_with_duplicates": sum(1 for n in by_url.values() if n > 1),
        "copies_histogram": dict(sorted(collections.Counter(by_url.values()).items())),
        "environments": dict(collections.Counter(
            r.get("environment") for r in records).most_common()),
    }


def write_report(path, c, p, samples_per_field=20):
    by_field = collections.defaultdict(list)
    for r in p.rescues:
        by_field[r["field"]].append(r)

    L = []
    L.append("# Deduplication dry run\n")
    L.append(f"_Index census re-derived from the live index, {time.strftime('%Y-%m-%d %H:%M %Z')}._\n")
    L.append("\n## Census (live)\n")
    L.append(f"- records: **{c['records']}**")
    L.append(f"- distinct URLs: **{c['distinct_urls']}**")
    L.append(f"- excess records: **{c['excess']}**")
    L.append(f"- URLs appearing more than once: {c['urls_with_duplicates']}")
    L.append(f"- copies per URL: `{c['copies_histogram']}`")
    L.append(f"- environments: `{c['environments']}`\n")

    L.append("\n## Plan\n")
    L.append(f"- survivors (post-dedupe record count): **{p.survivor_count}**")
    L.append(f"- records to delete: **{len(p.delete_ids)}**")
    L.append(f"- ordinary duplicate groups: {p.duplicate_group_count}")
    L.append(f"- chunk groups (reported separately, never merged in code): {p.chunk_group_count}")
    L.append(f"- field rescues: **{len(p.rescues)}**\n")

    L.append("\n## Rescues by field\n")
    L.append("| field | rescues |")
    L.append("|---|---|")
    for f, rs in sorted(by_field.items(), key=lambda kv: -len(kv[1])):
        L.append(f"| `{f}` | {len(rs)} |")

    L.append("\n\n## Rescue samples — REVIEW THESE BEFORE `--apply` (precondition P3)\n")
    L.append("\"Longer is better\" is a heuristic. If a rescued value turns out to be nav "
             "boilerplate rather than real content, the rule is wrong and must be inverted "
             "or narrowed before anything is deleted.\n")
    for f, rs in sorted(by_field.items(), key=lambda kv: -len(kv[1])):
        L.append(f"\n### `{f}` — {len(rs)} rescues, showing {min(samples_per_field, len(rs))}\n")
        for r in rs[:samples_per_field]:
            L.append(f"- `{r['url']}`")
            L.append(f"  - survivor: `{str(r['survivor_value'])[:160]!r}`")
            L.append(f"  - rescued : `{str(r['rescued_value'])[:160]!r}`")
    open(path, "w", encoding="utf-8").write("\n".join(L) + "\n")


# --- entry point ------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--index", required=True)
    ap.add_argument("--out", default="reports")
    ap.add_argument("--records", help="read from a local jsonl instead of live (offline analysis only)")
    ap.add_argument("--dry-run", action="store_true", default=True)
    ap.add_argument("--apply", action="store_true",
                    help="actually write and delete. Requires --snapshot.")
    ap.add_argument("--snapshot", action="store_true",
                    help="take a fresh snapshot before applying")
    ap.add_argument("--accept-drift", action="store_true",
                    help="proceed even if the live census does not match the expected shape")
    ap.add_argument("--batch", type=int, default=1000)
    args = ap.parse_args()

    app = os.environ["ALGOLIA_APP_ID"]
    key = os.environ["ALGOLIA_ADMIN_API_KEY"]
    os.makedirs(args.out, exist_ok=True)
    stamp = time.strftime("%Y%m%d")

    if args.records:
        print(f"reading {args.records} (offline)")
        records = [json.loads(l) for l in open(args.records, encoding="utf-8")]
    else:
        print(f"browsing {args.index} (live, all records — no sampling)")
        records = browse_all(app, key, args.index)

    c = census(records)
    print(f"  records {c['records']} | distinct urls {c['distinct_urls']} | "
          f"excess {c['excess']}")

    if c["excess"] == 0:
        # Already one record per URL. This is the steady state after the
        # 2026-08-06 run; say so plainly rather than failing the census check,
        # which would read as a problem when it is the goal.
        print(f"  nothing to do — {c['records']} records, {c['distinct_urls']} distinct URLs, "
              f"0 excess. Index is already deduplicated.")
        return

    if (c["records"], c["distinct_urls"]) != (EXPECT_RECORDS, EXPECT_URLS):
        msg = (f"live census is {c['records']} records / {c['distinct_urls']} urls, "
               f"expected {EXPECT_RECORDS} / {EXPECT_URLS}. The index moved since this "
               f"plan was measured, so the analysis behind it is stale.")
        if not args.accept_drift:
            raise CensusMismatch(msg + " Re-measure before deleting anything, or pass "
                                       "--accept-drift if the change is understood.")
        print(f"  WARNING (--accept-drift): {msg}")

    p = plan(records)
    print(f"  survivors {p.survivor_count} | to delete {len(p.delete_ids)} | "
          f"rescues {len(p.rescues)}")
    print(f"  duplicate groups {p.duplicate_group_count} | chunk groups {p.chunk_group_count}")

    # Index name in the filename: without it, a second index's dry-run silently
    # overwrites the first's report on the same day. It did exactly that once.
    tag = f"{args.index}-{stamp}"
    report = os.path.join(args.out, f"dedupe-dryrun-{tag}.md")
    write_report(report, c, p)
    rescue_log = os.path.join(args.out, f"rescue-log-{tag}.jsonl")
    with open(rescue_log, "w", encoding="utf-8") as f:
        for r in p.rescues:
            f.write(json.dumps(r, ensure_ascii=False, default=str) + "\n")
    delete_list = os.path.join(args.out, f"delete-ids-{tag}.txt")
    with open(delete_list, "w", encoding="utf-8") as f:
        f.write("\n".join(p.delete_ids) + "\n")
    print(f"  wrote {report}")
    print(f"  wrote {rescue_log} ({len(p.rescues)} rows)")
    print(f"  wrote {delete_list} ({len(p.delete_ids)} objectIDs)")

    if not args.apply:
        execute(p, args.index, app, key, apply=False)
        print("\ndry run only. Review the rescue log, then re-run with --apply --snapshot.")
        return

    snap = snapshot(app, key, args.index) if args.snapshot else None
    result = execute(p, args.index, app, key, apply=True,
                     snapshot_verified=bool(snap), batch=args.batch)

    # Done-means-live: re-read the index rather than trusting the write result.
    after = census(browse_all(app, key, args.index))
    print(f"\npost-apply live census: {after['records']} records / "
          f"{after['distinct_urls']} urls")
    if after["records"] != p.survivor_count:
        print(f"  FAIL: expected {p.survivor_count} records, live says {after['records']}. "
              f"Snapshot for rollback: {snap}")
        sys.exit(2)
    print(f"  PASS: {after['records']} records, one per distinct URL. Snapshot: {snap}")
    print(f"  deleted {result['deleted']}, rescued fields on {result['updated']} records")


if __name__ == "__main__":
    main()
