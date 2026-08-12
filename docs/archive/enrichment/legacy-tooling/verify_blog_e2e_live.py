#!/usr/bin/env python3
"""
Blog E2E validation against the LIVE indices, after the 106 non-enrichment records were quarantined.

READ ONLY. Every request is a search or a settings GET, issued with ALGOLIA_SEARCH_API_KEY. There
is no write path in this file and the write key is never read.

WHAT THIS ANSWERS THAT AN ARTIFACT CHECK CANNOT
  An artifact says what we intended to write. Only the index says what is served. The two have
  disagreed on this project before -- an index survived a day after being "deleted" because the
  claim was checked against the filesystem. So every number below comes off the live index, and
  the artifact is used only as the EXPECTED side of a comparison.

TWO COUNTING TRAPS THIS FILE HANDLES EXPLICITLY
  1. `Algolia_Prod_Copy_Enhanced` has `distinct: true` on `url`. A search's `nbHits` is therefore a
     DISTINCT-URL count, not a record count. Both are reported, separately and labelled, because
     reading one as the other made a whole plan's problem statement false on 2026-08-06.
  2. Pagination is capped (`paginationLimitedTo`, 1000 by default) and the search key has no
     `browse` ACL. So the Blog set is walked in per-language shards, each under the cap, and the
     shard totals are reconciled against the facet count. A silent truncation would show up as a
     shard sum that does not match.

    python3 docs/70-enrichment/verify_blog_e2e_live.py --out reports/blog-e2e-live-20260810.json
"""

from __future__ import annotations

import argparse
import collections
import json
import pathlib
import subprocess
import sys
import time

HERE = pathlib.Path(__file__).parent
sys.path.insert(0, str(HERE))

from census_blog_quality import BodyCache, grounded, load_bodies  # noqa: E402
from validate_blog_outputs import span_leak_reasons  # noqa: E402
from verify_repair_packet import quality_defects  # noqa: E402

MAIN = "Algolia_Prod_Copy_Enhanced"
QUAR = "Algolia_Prod_Copy_Enhanced_Quarantine"
WRITABLE = {"PASS", "JUDGE_REVISE"}

# The only two fields this project is allowed to have added to a live record.
ALLOWED_NEW_FIELDS = {"abstract_enriched", "keyhighlights_enriched"}

# Anything matching these on a live record is pipeline bookkeeping that leaked into production.
AUDIT_FIELD_MARKERS = (
    "enrichment_verdict", "enrichment_reason", "span_offsets", "abstract_spans_stored",
    "writer_model", "judge_model", "judge", "prompt_version", "gate_", "pool_dropped",
    "llm_output", "candidates", "processed_at", "writer_cost", "verdict", "insufficient_reason",
    "content_hash", "repair_trace", "selection_attempt", "reselect_banned", "_quarantine",
    "pilot_reason", "out_of_range_picks", "dropped_fabrications", "language_observed",
    "language_mismatch", "prose_chars", "truncated", "served_url", "redirect_mismatch",
    "fetch_path",
)


def env() -> dict[str, str]:
    """Credentials from the shared .env.local. Only the SEARCH key is read."""
    out: dict[str, str] = {}
    path = HERE.parents[1] / ".env.local"
    for line in path.read_text().splitlines():
        if "=" in line and not line.strip().startswith("#"):
            k, v = line.split("=", 1)
            out[k.strip()] = v.strip().strip('"').strip("'")
    return out


class Algolia:
    """curl, not urllib: this machine's TLS chain is intercepted and urllib refuses it."""

    def __init__(self, app: str, key: str) -> None:
        self.app, self.key = app, key
        self.calls = 0

    def _run(self, args: list[str]) -> dict:
        self.calls += 1
        proc = subprocess.run(args, capture_output=True, text=True, timeout=120)
        if proc.returncode != 0:
            raise RuntimeError(f"curl failed: {proc.stderr[-300:]}")
        return json.loads(proc.stdout)

    def query(self, index: str, body: dict) -> dict:
        return self._run(["curl", "-s", "-X", "POST",
                          f"https://{self.app}-dsn.algolia.net/1/indexes/{index}/query",
                          "-H", f"X-Algolia-Application-Id: {self.app}",
                          "-H", f"X-Algolia-API-Key: {self.key}",
                          "-d", json.dumps(body)])

    def settings(self, index: str) -> dict:
        return self._run(["curl", "-s",
                          f"https://{self.app}-dsn.algolia.net/1/indexes/{index}/settings",
                          "-H", f"X-Algolia-Application-Id: {self.app}",
                          "-H", f"X-Algolia-API-Key: {self.key}"])

    def scan(self, index: str, filters: str, attributes: list[str],
             shard_facet: str = "", shards: list[str] | None = None) -> list[dict]:
        """Every matching record, paginated, with `distinct` OFF so records are not collapsed.

        Sharding exists only to stay under `paginationLimitedTo`. When a shard list is given the
        caller must reconcile the total afterwards -- see `reconcile`.
        """
        hits: list[dict] = []
        shard_values = shards or [""]
        for value in shard_values:
            flt = f"{filters} AND {shard_facet}:{value}" if value else filters
            page = 0
            while True:
                res = self.query(index, {
                    "query": "", "hitsPerPage": 1000, "page": page, "distinct": False,
                    "filters": flt, "attributesToRetrieve": attributes,
                })
                if "hits" not in res:
                    raise RuntimeError(f"{index} query failed: {str(res)[:300]}")
                hits += res["hits"]
                page += 1
                if page >= res.get("nbPages", 0):
                    break
        return hits


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--artifact",
                    default=str(HERE / "batches-out-blog-effective-final" / "ready"
                               / "results.jsonl"))
    ap.add_argument("--out", default=str(HERE / "reports" / "blog-e2e-live-20260810.json"))
    ap.add_argument("--expect-total", type=int, default=11_928)
    ap.add_argument("--expect-blog", type=int, default=2_694)
    ap.add_argument("--expect-quarantine", type=int, default=106,
                    help="BLOG records expected in quarantine. The index also holds non-Blog "
                         "entries, counted separately -- see gate 4a.")
    args = ap.parse_args()

    started = time.time()
    e = env()
    api = Algolia(e["ALGOLIA_APP_ID"], e["ALGOLIA_SEARCH_API_KEY"])
    gates: list[dict] = []

    def gate(name: str, ok: bool, detail: str, failures: list | None = None) -> None:
        gates.append({"gate": name, "pass": bool(ok), "detail": detail,
                      "failures": (failures or [])[:50],
                      "failure_count": len(failures or [])})
        print(f"[{'PASS' if ok else 'FAIL'}] {name} — {detail}", flush=True)

    # ---- expected side: the final effective artifact -------------------------------------
    rows = [json.loads(l) for l in open(args.artifact) if l.strip()]
    by_id = {r["objectID"]: r for r in rows}
    expected_writable = {r["objectID"]: r for r in rows if r.get("status") in WRITABLE}
    expected_quarantine = {r["objectID"]: r for r in rows if r.get("status") not in WRITABLE}
    art_status = collections.Counter(r.get("status") for r in rows)

    gate("A1 artifact row count", len(rows) == 2800,
         f"{len(rows)} rows, {len(by_id)} distinct, {len(rows) - len(by_id)} duplicates")
    gate("A2 artifact writable count", len(expected_writable) == args.expect_blog,
         f"{len(expected_writable)} writable (expected {args.expect_blog}); "
         f"status {dict(art_status)}")
    gate("A3 artifact quarantine count", len(expected_quarantine) == args.expect_quarantine,
         f"{len(expected_quarantine)} non-enrichment (expected {args.expect_quarantine})")

    # ---- gate 3: the live main index -----------------------------------------------------
    total_distinct = api.query(MAIN, {"query": "", "hitsPerPage": 0})["nbHits"]
    total_records = api.query(MAIN, {"query": "", "hitsPerPage": 0, "distinct": False})["nbHits"]
    facets = api.query(MAIN, {"query": "", "hitsPerPage": 0, "facets": ["source"]})
    blog_facet = facets.get("facets", {}).get("source", {}).get("Blog", 0)
    lang_facet = api.query(MAIN, {"query": "", "hitsPerPage": 0, "filters": "source:Blog",
                                  "facets": ["language_code"]}).get("facets", {}) \
                                  .get("language_code", {})

    # These two numbers answer DIFFERENT questions and the index makes it easy to conflate them.
    # `distinct: true` on `url` means a search returns one hit per URL, so nbHits is a
    # distinct-URL count. With `distinct: false` it is a record count. A gap between them is
    # duplicate URLs, which is exactly what the 2026-08-06 dedupe existed to remove.
    gate("3a main total (records)", total_records == args.expect_total,
         f"record count with distinct:false = {total_records} (expected {args.expect_total})")
    # A gap between these two has TWO possible causes and they mean opposite things:
    #   duplicate URLs (a data defect the 2026-08-06 dedupe existed to remove), or
    #   records with NO url at all (Algolia gives them no distinct group).
    # The first version of this gate assumed "duplicate" and reported a defect that does not
    # exist: a full browse of all 11,930 records found 11,930 distinct url values and zero
    # duplicates. The single-record gap is one junk record with `url: null`. Reported below as a
    # diagnostic, and NOT as a Blog gate, because it is neither Blog nor caused by this work.
    index_gap = total_records - total_distinct
    gate("3b index-wide URL uniqueness accounted for", index_gap == 0,
         f"records {total_records}, distinct-URL groups {total_distinct}, gap {index_gap}. "
         f"A gap of 0 means one record per URL. The single null-url record that used to cause a "
         f"gap of 1 (7825fa8b-...) was quarantined and deleted 2026-08-10, so equality is now "
         f"the correct assertion rather than a tolerance")
    gate("3c main Blog facet", blog_facet == args.expect_blog,
         f"source:Blog = {blog_facet} (expected {args.expect_blog})")

    live_blog = api.scan(MAIN, "source:Blog",
                         ["objectID", "abstract_enriched", "keyhighlights_enriched", "source",
                          "url", "language_code"],
                         shard_facet="language_code", shards=sorted(lang_facet))
    live_by_id = {h["objectID"]: h for h in live_blog}
    gate("3d Blog shard scan reconciles", len(live_blog) == blog_facet == len(live_by_id),
         f"scanned {len(live_blog)} records, {len(live_by_id)} distinct, facet said {blog_facet}; "
         f"shards {dict(lang_facet)}")

    # Blog's OWN uniqueness, from the complete shard scan rather than from a distinct-count
    # subtraction. This is the in-scope version of 3b and it needs no browse ACL.
    blog_urls = collections.Counter(h.get("url") for h in live_blog)
    blog_dupes = sorted(u for u, n in blog_urls.items() if n > 1)
    blog_nourl = sorted(h["objectID"] for h in live_blog if not h.get("url"))
    gate("3b2 Blog: one record per URL, every record has a URL",
         not blog_dupes and not blog_nourl,
         f"{len(live_blog)} Blog records, {len(blog_urls)} distinct urls, "
         f"{len(blog_dupes)} duplicated, {len(blog_nourl)} with no url",
         blog_dupes + blog_nourl)

    have_abs = [h["objectID"] for h in live_blog if h.get("abstract_enriched")]
    have_hl = [h["objectID"] for h in live_blog if h.get("keyhighlights_enriched")]
    missing_either = sorted(h["objectID"] for h in live_blog
                            if not h.get("abstract_enriched")
                            or not h.get("keyhighlights_enriched"))
    gate("3e Blog with abstract_enriched", len(have_abs) == args.expect_blog,
         f"{len(have_abs)} of {len(live_blog)} (expected {args.expect_blog})")
    gate("3f Blog with keyhighlights_enriched", len(have_hl) == args.expect_blog,
         f"{len(have_hl)} of {len(live_blog)} (expected {args.expect_blog})")
    gate("3g no Blog record missing either field", not missing_either,
         f"{len(missing_either)} records missing at least one field", missing_either)

    # ---- gate 4: the quarantine index ----------------------------------------------------
    q_total = api.query(QUAR, {"query": "", "hitsPerPage": 0, "distinct": False})["nbHits"]
    q_hits = api.scan(QUAR, "", ["objectID", "source", "_quarantine_reason", "url",
                                 "abstract_enriched", "keyhighlights_enriched"])
    q_by_id = {h["objectID"]: h for h in q_hits}
    q_sources = collections.Counter(h.get("source") for h in q_hits)
    q_reasons = collections.Counter(h.get("_quarantine_reason") for h in q_hits)

    # THE BLOG ASSERTION MUST BE SCOPED TO BLOG.
    #
    # This gate used to assert the quarantine index held exactly 106 records and that every one was
    # Blog. On 2026-08-10 two non-Blog records were quarantined -- a search-params-as-document
    # artefact and the unclassified Search Grader page -- which made a correct index fail a
    # Blog-scoped check. Widening the number would have hidden the distinction; scoping it keeps
    # both facts visible.
    #
    # Counted in Python from a full scan, never by a `source:` filter: the quarantine index has NO
    # attributesForFaceting, so a filter on `source` returns 0 rather than erroring, and would have
    # read as "no Blog records quarantined".
    q_blog = [h for h in q_hits if h.get("source") == "Blog"]
    q_nonblog = [h for h in q_hits if h.get("source") != "Blog"]
    gate("4a quarantine Blog records", len(q_blog) == args.expect_quarantine,
         f"{len(q_blog)} Blog records (expected {args.expect_quarantine}); "
         f"index total {q_total}, scanned {len(q_hits)}, distinct {len(q_by_id)}; "
         f"source breakdown {dict(q_sources)}")
    gate("4b every non-Blog quarantine record has a reason",
         all(h.get("_quarantine_reason") for h in q_nonblog),
         f"{len(q_nonblog)} non-Blog records, all with a _quarantine_reason: "
         f"{sorted({h.get('_quarantine_reason') for h in q_nonblog})}",
         sorted(h["objectID"] for h in q_nonblog if not h.get("_quarantine_reason")))
    blog_reasons = collections.Counter(h.get("_quarantine_reason") for h in q_blog)
    q_reasons = blog_reasons  # the 4c/4d expectations are about the Blog set
    gate("4c quarantine DEAD_PAGE count", q_reasons.get("DEAD_PAGE") == 104,
         f"DEAD_PAGE = {q_reasons.get('DEAD_PAGE')} (expected 104); all reasons {dict(q_reasons)}")
    gate("4d quarantine NO_ABSTRACT_THIN count", q_reasons.get("NO_ABSTRACT_THIN") == 2,
         f"NO_ABSTRACT_THIN = {q_reasons.get('NO_ABSTRACT_THIN')} (expected 2)")

    # The reason recorded live must be the reason the artifact decided, per objectID -- not just
    # the right totals. Matching totals with swapped labels would pass a count-only check.
    # Only the Blog records came from the artifact; a non-Blog quarantine entry has no artifact row.
    reason_mismatch = [
        {"objectID": h["objectID"], "live": h.get("_quarantine_reason"),
         "artifact": by_id.get(h["objectID"], {}).get("status")}
        for h in q_blog
        if by_id.get(h["objectID"], {}).get("status") != h.get("_quarantine_reason")]
    gate("4e quarantine reason matches the artifact per record", not reason_mismatch,
         f"{len(reason_mismatch)} records whose live reason differs from the artifact status",
         reason_mismatch)

    # ---- gate 5: no overlap --------------------------------------------------------------
    overlap = sorted(set(q_by_id) & set(live_by_id))
    gate("5 quarantined ids absent from main", not overlap,
         f"{len(overlap)} of {len(q_by_id)} quarantined objectIDs still present in main", overlap)

    expected_q_ids = set(expected_quarantine)
    blog_q_ids = {h["objectID"] for h in q_blog}
    gate("5b quarantined Blog set is exactly the artifact's non-enrichment set",
         blog_q_ids == expected_q_ids,
         f"live-only {len(blog_q_ids - expected_q_ids)}, "
         f"artifact-only {len(expected_q_ids - blog_q_ids)}; "
         f"plus {len(q_nonblog)} non-Blog entries not from this artifact",
         sorted((blog_q_ids ^ expected_q_ids)))

    # ---- gate 6: live payload == intended payload ----------------------------------------
    missing = sorted(set(expected_writable) - set(live_by_id))
    extra = sorted(oid for oid in live_by_id if oid not in expected_writable)
    mismatched = []
    for oid, want in expected_writable.items():
        got = live_by_id.get(oid)
        if not got:
            continue
        # THE INTENDED PAYLOAD IS THE SPAN ARRAY, NOT THE JOINED STRING.
        #
        # `write_enrichment.py:78` writes `"abstract_enriched": spans`, where `spans` is the
        # artifact's `abstract_spans_stored`. The artifact ALSO carries an `abstract_enriched`
        # string, which is the spans joined with a space -- a local convenience field that is
        # never written. Comparing live-array against artifact-string reported 2,694 of 2,694
        # records as mismatched on the first run of this script: a 100% failure rate is almost
        # always the comparison, not the data, and it was.
        want_abstract = want.get("abstract_spans_stored") or []
        if list(got.get("abstract_enriched") or []) != list(want_abstract):
            mismatched.append({"objectID": oid, "field": "abstract_enriched",
                               "live": (got.get("abstract_enriched") or [])[:2],
                               "expected": list(want_abstract)[:2]})
        if list(got.get("keyhighlights_enriched") or []) != list(
                want.get("keyhighlights_enriched") or []):
            mismatched.append({"objectID": oid, "field": "keyhighlights_enriched",
                               "live_n": len(got.get("keyhighlights_enriched") or []),
                               "expected_n": len(want.get("keyhighlights_enriched") or [])})
    gate("6a expected writable payloads", len(expected_writable) == args.expect_blog,
         f"{len(expected_writable)} expected")
    gate("6b exact live matches",
         len(expected_writable) - len(missing) - len({m['objectID'] for m in mismatched})
         == args.expect_blog,
         f"{len(expected_writable) - len(missing) - len({m['objectID'] for m in mismatched})} "
         f"byte-identical of {len(expected_writable)}")
    gate("6c missing", not missing, f"{len(missing)} expected records absent from main", missing)
    gate("6d mismatched", not mismatched,
         f"{len(mismatched)} field mismatches across "
         f"{len({m['objectID'] for m in mismatched})} records", mismatched)
    gate("6e no extra enriched Blog records", not extra,
         f"{len(extra)} enriched Blog records in main that the artifact does not expect", extra)

    # ---- gate 7: grounding, every live span ----------------------------------------------
    bodies = load_bodies()
    cache = BodyCache()
    spans = 0
    modes = collections.Counter()
    ground_fail: list[dict] = []
    leak_fail: list[dict] = []
    no_body: list[str] = []
    dead_writable: list[str] = []

    for n, (oid, hit) in enumerate(sorted(live_by_id.items()), 1):
        src = bodies.get(oid)
        if not src:
            no_body.append(oid)
            continue
        body = src["markdown"]
        title, desc = src.get("title") or "", src.get("description") or ""
        # Both live fields are arrays of spans -- see the payload note above. A str fallback is
        # kept because 85 legacy records predate the array policy and would otherwise be iterated
        # character by character, which would "pass" grounding on every single letter.
        live_abstract = hit.get("abstract_enriched") or []
        if isinstance(live_abstract, str):
            live_abstract = [live_abstract]
        live_highlights = hit.get("keyhighlights_enriched") or []
        if isinstance(live_highlights, str):
            live_highlights = [live_highlights]
        for field, vals in (("abstract", list(live_abstract)),
                            ("highlight", list(live_highlights))):
            for span in vals:
                if not span:
                    continue
                spans += 1
                mode = grounded(cache, oid, body, span)
                modes[mode or "NOT_FOUND"] += 1
                if mode is None:
                    ground_fail.append({"objectID": oid, "field": field, "span": span[:200],
                                        "url": hit.get("url")})
                reasons = span_leak_reasons(span, title, desc)
                if reasons:
                    leak_fail.append({"objectID": oid, "field": field, "reasons": reasons,
                                      "span": span[:200]})
        if by_id.get(oid, {}).get("status") == "DEAD_PAGE":
            dead_writable.append(oid)
        if n % 500 == 0:
            print(f"    grounding {n}/{len(live_by_id)} ... {int(time.time()-started)}s",
                  flush=True)

    gate("7a every live Blog record has its Scout body", not no_body,
         f"{len(no_body)} live records with no cached body to check against", no_body)
    gate("7b grounding", not ground_fail,
         f"{spans} live spans checked, modes {dict(modes)}, {len(ground_fail)} failures",
         ground_fail)
    gate("7c leakage", not leak_fail, f"{len(leak_fail)} leakage failures", leak_fail)
    gate("7d no dead-page record is enriched live", not dead_writable,
         f"{len(dead_writable)} records the artifact called DEAD_PAGE are enriched in main",
         dead_writable)

    # ---- gate 8: field hygiene -----------------------------------------------------------
    # A separate fetch with attributesToRetrieve ['*'] -- the scan above asked for named fields, so
    # it could not have seen an extra one. Sampling is not allowed, so this walks every record.
    full = api.scan(MAIN, "source:Blog", ["*"],
                    shard_facet="language_code", shards=sorted(lang_facet))
    audit_leaks: list[dict] = []
    all_keys: collections.Counter = collections.Counter()
    for hit in full:
        for key in hit:
            all_keys[key] += 1
        # PREFIX FIRST, marker list second.
        #
        # The marker list alone under-counted: it reported 9 forbidden fields per record when there
        # were 12. `enrichment_fetched_at`, `enrichment_source_url` and `enrichment_validated_at`
        # matched none of the markers, so a hand-written enumeration silently became the definition
        # of "audit metadata". Any attribute this pipeline adds is namespaced `enrichment_*`, so the
        # namespace is the rule and the marker list only catches strays outside it.
        bad = sorted(k for k in hit
                     if (k.startswith("enrichment_")
                         or any(m in k for m in AUDIT_FIELD_MARKERS))
                     and k not in ALLOWED_NEW_FIELDS)
        if bad:
            audit_leaks.append({"objectID": hit["objectID"], "fields": bad})
    gate("8a no pipeline/audit metadata on live records", not audit_leaks,
         f"{len(audit_leaks)} records carrying bookkeeping fields", audit_leaks)
    gate("8b both enrichment fields present on every Blog record",
         all_keys.get("abstract_enriched") == len(full)
         and all_keys.get("keyhighlights_enriched") == len(full),
         f"abstract_enriched on {all_keys.get('abstract_enriched')}, "
         f"keyhighlights_enriched on {all_keys.get('keyhighlights_enriched')}, of {len(full)}")

    # ---- gate 9: searchability, REPORTED not changed -------------------------------------
    settings = api.settings(MAIN)
    searchable = settings.get("searchableAttributes") or []
    flat = " ".join(searchable)
    abs_searchable = "abstract_enriched" in flat
    hl_searchable = "keyhighlights_enriched" in flat
    # This is a REPORT, not a gate on correctness -- the brief says do not change settings. It is
    # recorded as a pass/fail only so it cannot be skimmed past.
    gate("9 enrichment fields are searchable", abs_searchable and hl_searchable,
         f"abstract_enriched searchable={abs_searchable}, "
         f"keyhighlights_enriched searchable={hl_searchable}; "
         f"searchableAttributes={searchable}")

    report = {
        "generated_at_epoch": int(time.time()),
        "read_only": True,
        "api_calls": api.calls,
        "artifact": args.artifact,
        "artifact_status": dict(art_status),
        "main_index": MAIN,
        "quarantine_index": QUAR,
        "main_total_distinct_urls": total_distinct,
        "main_total_records": total_records,
        "main_source_facet": facets.get("facets", {}).get("source"),
        "main_blog_language_facet": lang_facet,
        "live_blog_records": len(live_by_id),
        "live_blog_with_abstract": len(have_abs),
        "live_blog_with_highlights": len(have_hl),
        "quarantine_total": q_total,
        "quarantine_reasons": dict(q_reasons),
        "quarantine_sources": dict(q_sources),
        "spans_checked": spans,
        "grounding_modes": dict(modes),
        "searchable_attributes": searchable,
        "gates": gates,
        "all_pass": all(g["pass"] for g in gates),
        "elapsed_seconds": round(time.time() - started, 1),
    }
    out = pathlib.Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2))

    failed = [g["gate"] for g in gates if not g["pass"]]
    print(f"\n{'=' * 72}")
    print(f"gates run: {len(gates)}  passed: {len(gates) - len(failed)}  failed: {len(failed)}")
    if failed:
        print("FAILED GATES: " + ", ".join(failed))
    print(f"VERDICT: {'PASS' if not failed else 'FAIL'}")
    print(f"report: {out}")
    return 0 if not failed else 2


if __name__ == "__main__":
    raise SystemExit(main())
