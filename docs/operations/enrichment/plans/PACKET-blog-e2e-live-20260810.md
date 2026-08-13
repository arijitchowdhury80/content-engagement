# Blog E2E validation packet — live, final

_Regenerated 2026-08-10 after three authorised production write episodes (§6). 13 Algolia API calls for this validation, all read-only._

## Verdict

**PASS.** All 30 gates pass. 30 of 30.

Three items were open across earlier runs of this packet. All three were remediated on Arijit's
explicit instruction:

| was | now |
|---|---|
| 5 records carried 12 `enrichment_*` bookkeeping fields | 0 records carry any |
| enriched fields absent from `searchableAttributes` | both present, proven by query |
| 2 unclassified records with no `source` | quarantined and deleted; the distinct-URL gap is closed |

## Accounting, as measured

| | expected | measured | |
|---|---:|---:|---|
| main index records | 11,928 | 11,928 | PASS |
| main distinct-URL groups | 11,928 | 11,928 | PASS |
| main Blog records | 2,694 | 2,694 | PASS |
| Blog with `abstract_enriched` | 2,694 | 2,694 | PASS |
| Blog with `keyhighlights_enriched` | 2,694 | 2,694 | PASS |
| quarantine index total | 108 | 108 | PASS |
| ...Blog records | 106 | 106 | PASS |
| ...non-Blog | 2 | 2 | PASS |
| quarantined ids still in main | 0 | 0 | PASS |
| live spans grounded | all | 21,790 / 21,790 | PASS |

Source facet: `{"Documentation": 4337, "Blog": 2694, "Support": 1695, "Website": 1123, "Developers": 865, "Resources": 835, "Customer Stories": 237, "Academy": 142}`

The facet now sums exactly to the record count. Before the quarantine it summed to 11,928 against
11,930 records, and the two extras were the unclassified records removed in §6.3.

## Gate-by-gate

| gate | result | detail |
|---|---|---|
| A1 artifact row count | PASS | 2800 rows, 2800 distinct, 0 duplicates |
| A2 artifact writable count | PASS | 2694 writable (expected 2694); status {'JUDGE_REVISE': 341, 'PASS': 2353, 'DEAD_PAGE': 104, 'NO_ABSTRACT_THIN': 2} |
| A3 artifact quarantine count | PASS | 106 non-enrichment (expected 106) |
| 3a main total (records) | PASS | record count with distinct:false = 11928 (expected 11928) |
| 3b index-wide URL uniqueness accounted for | PASS | records 11928, distinct-URL groups 11928, gap 0. A gap of 0 means one record per URL. The single null-url record that used to cause a gap of 1 (7825fa8b-...) was quarantined and deleted 2026-08-10, so equality is now the correct assertion rather than a tolerance |
| 3c main Blog facet | PASS | source:Blog = 2694 (expected 2694) |
| 3d Blog shard scan reconciles | PASS | scanned 2694 records, 2694 distinct, facet said 2694; shards {'de': 898, 'en': 898, 'fr': 898} |
| 3b2 Blog: one record per URL, every record has a URL | PASS | 2694 Blog records, 2694 distinct urls, 0 duplicated, 0 with no url |
| 3e Blog with abstract_enriched | PASS | 2694 of 2694 (expected 2694) |
| 3f Blog with keyhighlights_enriched | PASS | 2694 of 2694 (expected 2694) |
| 3g no Blog record missing either field | PASS | 0 records missing at least one field |
| 4a quarantine Blog records | PASS | 106 Blog records (expected 106); index total 108, scanned 108, distinct 108; source breakdown {'Blog': 106, None: 2} |
| 4b every non-Blog quarantine record has a reason | PASS | 2 non-Blog records, all with a _quarantine_reason: ['SEARCH_PARAMS_AS_DOCUMENT', 'UNCLASSIFIED_DASHBOARD_RECORD'] |
| 4c quarantine DEAD_PAGE count | PASS | DEAD_PAGE = 104 (expected 104); all reasons {'DEAD_PAGE': 104, 'NO_ABSTRACT_THIN': 2} |
| 4d quarantine NO_ABSTRACT_THIN count | PASS | NO_ABSTRACT_THIN = 2 (expected 2) |
| 4e quarantine reason matches the artifact per record | PASS | 0 records whose live reason differs from the artifact status |
| 5 quarantined ids absent from main | PASS | 0 of 108 quarantined objectIDs still present in main |
| 5b quarantined Blog set is exactly the artifact's non-enrichment set | PASS | live-only 0, artifact-only 0; plus 2 non-Blog entries not from this artifact |
| 6a expected writable payloads | PASS | 2694 expected |
| 6b exact live matches | PASS | 2694 byte-identical of 2694 |
| 6c missing | PASS | 0 expected records absent from main |
| 6d mismatched | PASS | 0 field mismatches across 0 records |
| 6e no extra enriched Blog records | PASS | 0 enriched Blog records in main that the artifact does not expect |
| 7a every live Blog record has its Scout body | PASS | 0 live records with no cached body to check against |
| 7b grounding | PASS | 21790 live spans checked, modes {'canonical': 12193, 'exact': 9597}, 0 failures |
| 7c leakage | PASS | 0 leakage failures |
| 7d no dead-page record is enriched live | PASS | 0 records the artifact called DEAD_PAGE are enriched in main |
| 8a no pipeline/audit metadata on live records | PASS | 0 records carrying bookkeeping fields |
| 8b both enrichment fields present on every Blog record | PASS | abstract_enriched on 2694, keyhighlights_enriched on 2694, of 2694 |
| 9 enrichment fields are searchable | PASS | abstract_enriched searchable=True, keyhighlights_enriched searchable=True; searchableAttributes=['title', 'unordered(description)', 'unordered(abstract_enriched)', 'unordered(keyhighlights_enriched)', 'unordered(abstract)', 'unordered(tags)', 'unordered(keywords)', 'unordered(category)', 'unordered(url)'] |

## Searchability, proven by query not by settings

```
searchableAttributes = [
 "title",
 "unordered(description)",
 "unordered(abstract_enriched)",
 "unordered(keyhighlights_enriched)",
 "unordered(abstract)",
 "unordered(tags)",
 "unordered(keywords)",
 "unordered(category)",
 "unordered(url)"
]
```

Order set by Arijit 2026-08-10: title, then description, then the two enriched fields, then the
legacy `abstract` demoted below both. `abstract` is 96.1% populated but 28.6% of its values end in
an ellipsis and 54.5% are under 120 characters, and on 30.4% of records it is byte-identical to
`description` — so it is a weak signal and the demotion is evidence-based.

A settings value is a claim. The test is whether text stored **only** in `abstract_enriched`
returns hits:

| phrase stored verbatim in `abstract_enriched` | before | after | via that attribute alone |
|---|---:|---:|---:|
| `Rather than showing the same fixed set` | 0 | 3 | 3 |
| `Exact match testing obscures the agent's performance` | 0 | 3 | 1 |

`keyhighlights_enriched` is reachable too. `abstract` is still independently searchable —
regression-checked explicitly, because a bad settings syntax had briefly broken it (§6.2).

## 6. The production writes

### 6.1 Five-record field cleanup

Full-record replace, not `partialUpdateObject` — partial update cannot REMOVE an attribute, and
setting one to null stores a literal null, which once put 96,039 nulls in a live index.

Pre-flight: `unretrievableAttributes` null, `attributesToRetrieve` null, no replicas — so a full
fetch returns every attribute and a replace loses nothing. Snapshot first.

Verified after: fields 39→27 and 38→26, **0 leftover** `enrichment_*`, both enrichment fields
byte-identical to the snapshot on all 5, no other attribute lost.

The gate first reported **9** forbidden fields; there were **12**. It matched a hand-written
marker list, and `enrichment_fetched_at` / `enrichment_source_url` / `enrichment_validated_at`
matched none of them. The gate now tests the `enrichment_` **namespace**. The cleanup removed all
12 regardless, because it was built from each record's own keys rather than the detector's list.

### 6.2 searchableAttributes — and the syntax that broke `abstract`

The documented same-priority form does not survive the round trip:

```
sent:   "unordered(abstract),unordered(abstract_enriched)"
stored: "abstract),unordered(abstract_enriched"
```

Algolia stripped the outer wrapper and stored one garbage attribute name, which **silently
removed `abstract` from the searchable set** — an index-wide relevance regression. HTTP 200, task
`published`, no warning. Caught only because the verification step was a query, not a reading of
the settings value. Exposure window about two minutes: 17:30:31 → 17:32:24.

Fix: one attribute per priority level, never comma-joined inside `unordered()`.

### 6.3 Quarantine and delete of the two unclassified records

Ordered write-then-verify-then-delete, never the reverse. Snapshot first:
`reports/PRE-DELETE-snapshot-2-unclassified-20260810.json`.

| objectID | what it was | `_quarantine_reason` |
|---|---|---|
| `7825fa8b-7dd1-48d3-81ff-82f09c8832dd` | two fields only — `objectID` and `hitsPerPage: 1`. A search query body written as a document. No url, title, source, language or content; unreachable by any query including a blank one. | `SEARCH_PARAMS_AS_DOCUMENT` |
| `116204c4832786_dashboard_generated_id` | the live Search Grader lead-gen page, `https://www.algolia.com/ai-search-grader` (HTTP 200), hand-created in the Algolia dashboard so it had content but no `source`/`environment`/`category`/`is404`/timestamps | `UNCLASSIFIED_DASHBOARD_RECORD` |

Verified before deleting: both present in quarantine with every original field preserved
byte-for-byte, plus four `_quarantine*` fields. Verified after: both absent from main;
records 11,930 → **11,928**; distinct-URL groups 11,929 → **11,928**, so **the gap is closed** —
the null-url record was its sole cause.

**A recommendation was overridden, and that is recorded deliberately.** The Search Grader page was
the only record for its URL and ranked #1 for `search grader` whenever it was allowed to compete;
it was invisible in the demo solely because it lacked `environment`. The recommendation was to
backfill `source`, `environment` and a normalised relative URL. Arijit chose to quarantine both
records instead. Consequence, accepted: that page is now absent from search entirely.

## Language accounting — which denominator a number means

Verified live 2026-08-10. Two true statements that must not be conflated:

- **By label**, 898 of the 2,694 enriched Blog records are `language_code: en`; 898 are `de`, 898 `fr`.
- **By content**, all 2,694 are English — `/de/` and `/fr/` blog pages serve the English article.

The demo filters by label, on both of its two Algolia requests (there is no unfiltered path):
`environment:"prod20260722" AND language_code:"en" AND NOT is404:true`

| | records |
|---|---:|
| Blog records enriched | 2,694 |
| `language_code: en` | 898 |
| also passing `environment` | **866** |
| dropped by `environment` | 32 |
| dropped by `is404` | 0 |

**866 of 2,694 enriched records (32%) are reachable from the demo.** State that alongside the 2,694.

`language_code` is now present on **all 11,928** records. The single record that lacked it was
quarantined on 2026-08-10, so the demo's language filter cannot drop real content by omission.

| source | en | de | fr | total | demo-visible |
|---|---:|---:|---:|---:|---:|
| Documentation | 4,337 | 0 | 0 | 4,337 | 4,258 |
| Blog | 898 | 898 | 898 | 2,694 | 866 |
| Support | 1,695 | 0 | 0 | 1,695 | 1,652 |
| Website | 387 | 368 | 368 | 1,123 | 364 |
| Developers | 288 | 288 | 289 | 865 | 285 |
| Resources | 279 | 278 | 278 | 835 | 260 |
| Customer Stories | 83 | 78 | 76 | 237 | 72 |
| Academy | 142 | 0 | 0 | 142 | 142 |
| **total** | **8,109** | **1,910** | **1,909** | **11,928** | **7,899** |

**The demo searches 7,899 records, not 11,928.** Documentation, Support and Academy are English-only
and lose almost nothing; every localised source loses roughly two thirds.

### Sequencing finding

Demo-visible value, not total, is the number that should choose the next source:

| next source | total | demo-visible |
|---|---:|---:|
| Customer Stories | 237 | **72** |
| Documentation | 4,337 | **4,258** |

Customer Stories is 72 useful records, not 237. Documentation is 4,258 because it is English-only —
roughly 59x more demo-visible value. That inverts the "cleanest first, Documentation last" plan,
which was chosen on totals. A finding, not a decision.

### Correction: language triplication was a harness artefact

An earlier run of the ten-query set reported 30–60% redundant results from de/en/fr duplication and
named it the largest outstanding problem. That run did not apply the demo's filters. Re-run with
them, redundancy is **0 on all ten queries**. A `content_id` / `attributeForDistinct` remediation was
scoped at about two hours; it would have fixed nothing the demo experiences and was not done.

## Two findings for the frontend session, not actioned here

`frontend/search-first-demo/demo/` belongs to the frontend session, so these are reported rather than changed:

1. `attributesToSnippet` is `["abstract:32","description:26"]` — it does **not** include
   `abstract_enriched`. The field now drives ranking but the demo will not display or highlight the
   matched enriched text. This is the more consequential of the two.
2. A code comment cites "Blog (2,800)" and "Website (1,202 records)". Live values are 2,694 and 1,123.

## Query-set findings that survive the demo filter

Of three defects found in the ten-query run, one was my artefact and two are real:

- `customer stories in grocery` → 1 hit, a Blog post. The right answer,
  `H-E-B México redefines omnichannel grocery shopping`, is in Customer Stories — 72 demo-visible
  records, zero enrichment.
- `contact sales` → 9 hits, all Support Q&A, not the Contact Sales page.
- `how do I add search to React` → 33 hits, top result is a Support article about filter-value errors.

## What is still not proven

- Grounding is verified against the **cached Scout body the writer was given**. That proves no
  invention. It does not prove the live page still says it; a re-fetch census is a separate job.
- **Relevance impact is not measured.** The enriched fields are searchable and return hits, which is
  a capability check, not a quality one. Only Blog is enriched — 866 demo-visible of 7,899 — so
  results now skew toward Blog. No A/B was run: `searchableAttributes` is index-level, so comparing
  orderings needs two production writes.
- Roughly 10 of 2,694 abstracts have been read by a human. Gates passing is not a good abstract.
- **504 records lack `environment: "prod20260722"`** and are invisible to the demo for that reason
  alone. Not censused. Worth doing before the next source, since enriching a record the demo cannot
  see delivers nothing.

## Exact command outputs

### Gate 1 — no enrichment/fetch/write processes running
```
$ pgrep -fl "enrich_run|run_batches|fetch_router|write_enrichment"
none running
```

### Gate 2 — full test suite
```
$ python3 -m pytest docs/archive/enrichment/legacy-tooling/tests/ -q
472 passed, 1 xfailed
```

The 1 xfail is documented and out of scope: form-confirmation prose is shape-identical to content
prose, so shape-based detection cannot separate them.

### Gates 3–9 — live validation
```
$ python3 docs/archive/enrichment/legacy-tooling/verify_blog_e2e_live.py \
      --out reports/blog-e2e-live-20260810-postquarantine.json
[PASS] A1 artifact row count — 2800 rows, 2800 distinct, 0 duplicates
[PASS] A2 artifact writable count — 2694 writable (expected 2694); status {'JUDGE_REVISE': 341, 'PASS': 2353, 'DEAD_PAGE': 104, 'NO_ABSTRACT_THIN': 2}
[PASS] A3 artifact quarantine count — 106 non-enrichment (expected 106)
[PASS] 3a main total (records) — record count with distinct:false = 11928 (expected 11928)
[PASS] 3b index-wide URL uniqueness accounted for — records 11928, distinct-URL groups 11928, gap 0. A gap of 0 means one record per URL. The single null-url record that used to cause a gap of 1 (7825fa8b-...) was quarantined and deleted 2026-08-10, so equality is now the correct assertion rather than a tolerance
[PASS] 3c main Blog facet — source:Blog = 2694 (expected 2694)
[PASS] 3d Blog shard scan reconciles — scanned 2694 records, 2694 distinct, facet said 2694; shards {'de': 898, 'en': 898, 'fr': 898}
[PASS] 3b2 Blog: one record per URL, every record has a URL — 2694 Blog records, 2694 distinct urls, 0 duplicated, 0 with no url
[PASS] 3e Blog with abstract_enriched — 2694 of 2694 (expected 2694)
[PASS] 3f Blog with keyhighlights_enriched — 2694 of 2694 (expected 2694)
[PASS] 3g no Blog record missing either field — 0 records missing at least one field
[PASS] 4a quarantine Blog records — 106 Blog records (expected 106); index total 108, scanned 108, distinct 108; source breakdown {'Blog': 106, None: 2}
[PASS] 4b every non-Blog quarantine record has a reason — 2 non-Blog records, all with a _quarantine_reason: ['SEARCH_PARAMS_AS_DOCUMENT', 'UNCLASSIFIED_DASHBOARD_RECORD']
[PASS] 4c quarantine DEAD_PAGE count — DEAD_PAGE = 104 (expected 104); all reasons {'DEAD_PAGE': 104, 'NO_ABSTRACT_THIN': 2}
[PASS] 4d quarantine NO_ABSTRACT_THIN count — NO_ABSTRACT_THIN = 2 (expected 2)
[PASS] 4e quarantine reason matches the artifact per record — 0 records whose live reason differs from the artifact status
[PASS] 5 quarantined ids absent from main — 0 of 108 quarantined objectIDs still present in main
[PASS] 5b quarantined Blog set is exactly the artifact's non-enrichment set — live-only 0, artifact-only 0; plus 2 non-Blog entries not from this artifact
[PASS] 6a expected writable payloads — 2694 expected
[PASS] 6b exact live matches — 2694 byte-identical of 2694
[PASS] 6c missing — 0 expected records absent from main
[PASS] 6d mismatched — 0 field mismatches across 0 records
[PASS] 6e no extra enriched Blog records — 0 enriched Blog records in main that the artifact does not expect
    grounding 500/2694 ... 6s
    grounding 1000/2694 ... 7s
    grounding 1500/2694 ... 8s
    grounding 2000/2694 ... 10s
    grounding 2500/2694 ... 11s
[PASS] 7a every live Blog record has its Scout body — 0 live records with no cached body to check against
[PASS] 7b grounding — 21790 live spans checked, modes {'canonical': 12193, 'exact': 9597}, 0 failures
[PASS] 7c leakage — 0 leakage failures
[PASS] 7d no dead-page record is enriched live — 0 records the artifact called DEAD_PAGE are enriched in main
[PASS] 8a no pipeline/audit metadata on live records — 0 records carrying bookkeeping fields
[PASS] 8b both enrichment fields present on every Blog record — abstract_enriched on 2694, keyhighlights_enriched on 2694, of 2694
[PASS] 9 enrichment fields are searchable — abstract_enriched searchable=True, keyhighlights_enriched searchable=True; searchableAttributes=['title', 'unordered(description)', 'unordered(abstract_enriched)', 'unordered(keyhighlights_enriched)', 'unordered(abstract)', 'unordered(tags)', 'unordered(keywords)', 'unordered(category)', 'unordered(url)']

========================================================================
gates run: 30  passed: 30  failed: 0
VERDICT: PASS
report: reports/blog-e2e-live-20260810-postquarantine.json
```
