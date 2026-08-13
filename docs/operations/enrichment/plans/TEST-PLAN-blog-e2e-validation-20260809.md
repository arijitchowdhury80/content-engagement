# Blog E2E Enrichment Validation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to execute this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Validate that all 2,800 Blog records in `Algolia_Prod_Copy_Enhanced` have a correct outcome, and that every written `abstract_enriched` and `keyhighlights_enriched` value is grounded, useful, and search-improving.

**Architecture:** Validation is split into three gates: accounting/grounding, quality/completeness, and search impact. The first gate is deterministic and must run across all 2,800 records. The second gate combines deterministic checks, source-limited LLM judging, and human review. The third gate tests whether the enriched fields improve retrieval and conversational-search usefulness before any live write or searchable-attributes change.

**Tech Stack:** Python 3.13 scripts under `docs/operations/enrichment/`, Algolia browse/search APIs, Scout-only page bodies, GLM/Gemini only as source-limited judges, pytest.

## Global Constraints

- Live writes may only add `abstract_enriched` and `keyhighlights_enriched`.
- No `enrichment_*` metadata may be written to Algolia records.
- Scout is the only approved source for fetched page bodies.
- Model-generated prose is not allowed in written fields; written values must resolve to source spans.
- Verification artifacts stay on disk, not in Algolia records.
- Dead, thin, redirect, login, and fetch-failed records get counted outcomes; they must not be force-enriched.
- `Algolia_Prod_Copy_Vanilla` must not be changed.
- Final approval gate is before live Algolia write and before searchable-attributes settings change.

---

## Target Accounting

The target universe is all records where `source == "Blog"` in `Algolia_Prod_Copy_Enhanced`.

Expected current partition, to be recomputed at runtime:

| bucket | expected now | validation meaning |
|---|---:|---|
| Already verified skip records | 85 | Leave untouched unless explicitly reprocessed |
| Cached Phase 3 batch records | 2,419 | Enrich from existing Scout bodies |
| Refetch backlog | 296 | Scout refetch, then enrich successes or count failures |
| Total Blog records | 2,800 | Must reconcile exactly |

Final success does not mean 2,800 abstracts. It means:

```text
already_verified
+ newly_verified_enriched
+ verified_honest_non_enrichment
+ explicitly_unresolved_failures
= 2,800
```

`explicitly_unresolved_failures` should be zero before write unless Arijit accepts a partial run.

---

## Validation Levels

### Level 0 — Run Freeze And Artifact Inventory

**Purpose:** Do not validate moving files.

- [ ] Confirm no local enrichment/fetch/write process is still writing result artifacts:

```bash
ps -o pid,etime,command -ax \
  | rg 'run_batches.py|enrich_run.py|fetch_router.py|write_enrichment.py|verify_written.py' \
  | rg -v 'rg '
```

- [ ] If any process is still running against `batches-out-blog/`, `batches-out-blog-refetch/`, `cache-scout/blog-refetch/`, or `batches-out-*`, stop validation and wait.
- [ ] Identify final artifact roots:
  - `batches-out-blog/`
  - refetch enrichment output root, if separate
  - `batches-out-blog-refetch/`
  - `cache-scout/blog-batches/`
  - `cache-scout/blog-refetch/`
  - `reports/blog-skip-ids.json`
  - `reports/blog-dead-page-ids.json`
  - `reports/blog-refetch-ids.json`

**Pass gate:** no active writers, all expected artifact roots exist, no unknown output root is mixed into the count.

### Level 1 — Code And Test Baseline

**Purpose:** Ensure validation is running on a coherent pipeline.

- [ ] Run the full enrichment test suite:

```bash
python3 -m pytest docs/archive/enrichment/legacy-tooling/tests/ -q
```

- [ ] Record exact output in the packet.
- [ ] Fail the packet if any test fails.
- [ ] Run `git status --short docs/operations/enrichment` and record modified/new validation files, because uncommitted code is part of the evidence.

**Pass gate:** test suite passes; known xfails are named.

### Level 2 — 2,800 Record Reconciliation

**Purpose:** Prove every Blog record is accounted for exactly once.

- [ ] Load the live Blog queue from `work-queue.jsonl`.
- [ ] Load skip IDs from `reports/blog-skip-ids.json`.
- [ ] Load every result row from all final Blog result roots.
- [ ] Assert every result row has:
  - `source == "Blog"`
  - `page_type == "blog-post"`
  - non-empty `objectID`
- [ ] Assert no duplicate `objectID` across result rows.
- [ ] Assert no skip ID appears in a writable payload.
- [ ] Assert:

```text
len(skip_ids) + len(distinct_result_ids) == 2800
```

- [ ] If the 296 refetch created new enriched outputs, include them in `distinct_result_ids`.
- [ ] If a refetched page still failed and has no enrichment result row, require an explicit `FETCH_FAILED` row or explicit unresolved list.

**Pass gate:** exactly 2,800 Blog records accounted for; zero duplicate IDs; zero non-Blog rows.

### Level 3 — Outcome Taxonomy

**Purpose:** Separate enriched records from honest non-enrichment outcomes.

- [ ] Count rows by `status`.
- [ ] Count rows by `verdict`.
- [ ] Count rows by `(language_code, language_observed)`.
- [ ] Count writable rows:
  - `PASS`
  - `JUDGE_REVISE`, if writer policy still allows it
- [ ] Count non-writable/honest outcomes:
  - `DEAD_PAGE`
  - `FETCH_FAILED`
  - `NO_ABSTRACT_THIN`
  - `NO_CANDIDATES_AFTER_FILTER`
  - `REDIRECT_CANONICAL`
  - `REDIRECT_UNINDEXED`
  - `LOGIN_REQUIRED`
  - `EXCLUDED`
- [ ] Count quarantined rows and group by gate failure reason.
- [ ] Fail if a row has `verdict == "REAL"` but no writable spans and no quarantine reason.
- [ ] Fail if a dead-page body produces writable enrichment.

**Pass gate:** every non-writable row has a counted reason; no silent drops.

### Level 4 — Scout Provenance And Right-Document Check

**Purpose:** A span copied from the wrong page is still wrong.

- [ ] For every result row, locate its source body in the Scout cache path used by the run.
- [ ] Assert source body path is under:
  - `cache-scout/blog-batches/`, or
  - `cache-scout/blog-refetch/`
- [ ] Fail if any source path is under:
  - `cache-batches/`
  - `cache/`
  - `cache2/`
  - `cache-fresh50/`
  - any `doc-md-twin` tree
- [ ] For every fetched row, compare requested URL and served URL using normalized path.
- [ ] If `redirect_mismatch == true`, assert row is not writable unless Arijit has explicitly accepted that redirect class.
- [ ] For de/fr blog rows serving English bodies, report as language mismatch, not grounding failure, because the served document is the English body.

**Pass gate:** every enriched row is backed by a Scout body for the record's own served document.

### Level 5 — Deterministic Grounding Check For Every Written Span

**Purpose:** Prove no generated/invented text can enter `abstract_enriched` or `keyhighlights_enriched`.

For every writable row:

- [ ] Treat `abstract_enriched` as an array of spans. Fail if it is a joined string.
- [ ] Treat `keyhighlights_enriched` as an array of spans. Fail if it is a joined string.
- [ ] For every abstract span:
  - exact substring is accepted when present in the Scout markdown body
  - canonicalized substring is accepted when present in the canonicalized Scout markdown body
  - visible-Markdown substring is accepted when Scout markdown inserts link syntax around visible page text, for example `[label](url)` in the source and `label` in the stored span
  - span must not be empty
- [ ] For every highlight span:
  - exact substring is accepted when present in the Scout markdown body
  - canonicalized substring is accepted when present in the canonicalized Scout markdown body
  - visible-Markdown substring is accepted when Scout markdown inserts link syntax around visible page text, for example `[label](url)` in the source and `label` in the stored span
  - span must not be empty
- [ ] Do not rely only on stored offsets. Search the body without offsets.
- [ ] If offsets exist in artifacts, verify they point to the same text, but report offset mismatches separately. Offset success or failure must not decide grounding; only body/visible-text location decides grounding.
- [ ] Do not use fuzzy similarity, token overlap, or nearest-window matching as a pass condition. Those are diagnostic only.
- [ ] Fail on first not-found span and list:
  - `objectID`
  - URL
  - field name
  - missing span
  - source body path

**Pass gate:** `spans_found == spans_checked`; zero not-found spans.

### Level 6 — Leakage And Junk Check

**Purpose:** Verbatim junk is still junk.

For every writable row, fail if any written span contains or is dominated by:

- `Page not found`
- `Search Algolia`
- `API Status`
- `Home page`
- `Support`
- cookie/banner text
- newsletter/signup promo
- "Book a demo"
- "Start building"
- navigation/footer chrome
- code comments
- broken Markdown links, for example an unmatched `[` carried into the stored span
- corrupted inline code expressions that read like source-code fragments rather than article prose
- route fragments
- JSON snippets
- duplicate of `title`
- duplicate of `description`
- generic boilerplate with no page-specific information

Required deterministic checks:

- [ ] exact duplicate against `description`
- [ ] near duplicate against `description` after lowercasing and punctuation stripping
- [ ] body-position sanity check: do not accept spans only from top/bottom chrome blocks
- [ ] dead-page marker check
- [ ] code-comment prefix check: `//`, `# `, `/*`, `* `, `-- `

**Pass gate:** zero writable spans from dead pages, nav, furniture, code comments, broken Markdown, corrupted inline code, or duplicate-description text.

### Level 7 — Abstract Quality And Completeness

**Purpose:** The abstract must be useful, not merely grounded.

Every writable record receives an automated source-limited quality judgement. The judge sees:

- title
- description
- URL
- source body excerpts/candidates
- chosen abstract spans
- chosen highlight spans
- headings extracted from the body

The judge must not introduce facts. It scores only against supplied source text.

Per-record rubric:

| dimension | pass requirement |
|---|---|
| Representativeness | Abstract captures the central topic of the article |
| Specificity | Abstract says something more specific than title/description |
| Completeness | No major article section is ignored if it changes the point of the article |
| Reader utility | A search user can tell whether this result answers their need |
| Non-duplication | Does not merely restate `title` or `description` |
| Coherence | Multiple spans do not create false adjacency or a misleading combined claim |
| Language policy | de/fr English-body mismatch is reported, not hidden |

Automated quality thresholds:

- [ ] `representativeness >= 4/5`
- [ ] `specificity >= 4/5`
- [ ] `reader_utility >= 4/5`
- [ ] `missed_major_substance == false`
- [ ] `misleading_join == false`
- [ ] `duplicate_description == false`

Rows below threshold are not automatically written. They go to `QUALITY_REVIEW_REQUIRED`.

**Pass gate:** every writable row either passes quality thresholds or is explicitly held from write.

### Level 8 — Key Highlights Quality And Completeness

**Purpose:** Highlights must expose searchable facts and conversational answer hooks.

For every writable record:

- [ ] Highlight count must be within policy, normally 3–6.
- [ ] Highlights must be distinct from each other.
- [ ] Highlights must not duplicate the abstract.
- [ ] Highlights should cover different aspects of the article:
  - problem/context
  - method/solution
  - result/benefit
  - named product/feature/concept
  - data point/customer/example if present
- [ ] If article has headings, highlights should collectively touch the major content regions.
- [ ] Fail if all highlights come from one paragraph while the article has multiple substantive sections.
- [ ] Fail if highlights are generic marketing claims that could apply to many articles.

Automated checks:

- [ ] exact grounding for every highlight
- [ ] pairwise near-duplicate detection
- [ ] overlap against abstract
- [ ] heading coverage report
- [ ] named-entity/keyword coverage report

**Pass gate:** all key highlights are grounded, distinct, useful, and not just abstract repeats.

### Level 9 — Human Review Pack

**Purpose:** Catch judgement failures that deterministic gates cannot.

Create a review pack with at least 120 records:

| stratum | count |
|---|---:|
| English records | 25 |
| German URL serving English body | 20 |
| French URL serving English body | 20 |
| Dead-page outcomes | 10 |
| JUDGE_REVISE rows | 15 |
| Quarantined rows | 15 |
| Long articles p90+ body length | 10 |
| Multi-span abstracts | 20 |
| Records with high title/description overlap risk | 10 |

For each sampled record, show:

- URL
- title
- description
- abstract spans
- key highlights
- source excerpt around each span
- article headings
- judge scores
- failure/quarantine reason if any

Manual reviewer answers:

- [ ] Is every written sentence genuinely from the blog body?
- [ ] Is the abstract enough to decide whether to click?
- [ ] Do highlights improve search/discovery?
- [ ] Is anything misleading due to span joining?
- [ ] Would this be embarrassing in production search?

**Pass gate:** zero grounding failures; zero severe misleading records; quality issues converted to holds or accepted with written rationale.

### Level 10 — Search Impact Evaluation

**Purpose:** Verify that enriched fields improve search and conversational discovery.

This must run before changing live `searchableAttributes`.

Create an offline query set:

| query class | count | examples |
|---|---:|---|
| Exact article topic | 50 | product discovery, dynamic facets, query rules |
| Long-tail buyer problem | 50 | improve ecommerce conversion with search |
| Conversational question | 50 | how can Algolia personalize search results |
| Feature/technical concept | 50 | facet ordering, browse API, merchandising |
| Industry/use-case query | 50 | search for marketplaces, B2B commerce search |
| Freshness/news style | 25 | product updates, announcements |
| Ambiguous query | 25 | personalization, recommendations, analytics |

Minimum query set: 300 queries.

Evaluate two configurations:

- Baseline: current searchable attributes.
- Candidate: baseline plus `unordered(abstract_enriched)` and `unordered(keyhighlights_enriched)` in a proposed order.

Metrics:

- [ ] Recall@10 for known relevant article
- [ ] MRR@10
- [ ] top-3 relevance judgement
- [ ] number of conversational queries with a useful result in top 5
- [ ] false-positive rate caused by generic enriched text
- [ ] language mismatch impact on de/fr URL records

Pass criteria:

- [ ] Candidate improves or matches Recall@10.
- [ ] Candidate improves conversational-query top-5 usefulness.
- [ ] Candidate does not materially increase false positives.
- [ ] Enriched fields produce visible wins on queries that baseline misses.
- [ ] Any regression query is listed with before/after ranks and judged before settings change.

**Pass gate:** enrichment demonstrates measurable search value, not just clean data.

### Level 11 — Conversational Search Usefulness Review

**Purpose:** Test whether the enrichment helps the intended search-first experience.

Build a small evaluator that simulates the search/answer layer:

- [ ] query
- [ ] retrieved Blog records
- [ ] abstract/highlights visible to answer generator
- [ ] expected answer intent

For each query, judge:

- [ ] Can the abstract tell the agent what this page is about?
- [ ] Do highlights provide answerable facts?
- [ ] Are there enough concrete nouns/verbs/products/use-cases for retrieval?
- [ ] Is the page likely to be chosen over weaker results?
- [ ] Would the agent cite or recommend this page correctly?

Minimum: 100 conversational queries.

Pass criteria:

- [ ] At least 80% of conversational queries have a useful top-5 Blog candidate.
- [ ] At least 60% show an improvement attributable to enriched fields.
- [ ] Zero answers rely on facts not present in abstract/highlights/source.

**Pass gate:** enriched Blog content materially helps the concierge/search experience.

### Level 12 — Writer Dry Run

**Purpose:** Ensure live payload is lean and safe.

- [ ] Run writer dry-run over final approved result roots.
- [ ] Assert every payload has only:
  - `objectID`
  - `abstract_enriched`
  - `keyhighlights_enriched`
- [ ] Assert no payload includes:
  - `enrichment_verdict`
  - `enrichment_reason`
  - `enrichment_requested_url`
  - `enrichment_served_url`
  - `enrichment_source_url`
  - `enrichment_fetch_path`
  - `enrichment_content_hash`
  - `enrichment_span_offsets`
  - `enrichment_writer_model`
  - `enrichment_judge_model`
  - `enrichment_prompt_version`
  - `enrichment_validated_at`
- [ ] Assert no protected fields are present:
  - `abstract`
  - `description`
  - `title`
  - `url`
  - `source`
  - `page_type`
  - `objectID` is allowed only as update key
- [ ] Assert skip IDs are absent from payload unless explicitly reprocessed.

**Pass gate:** dry-run payload count equals approved writable count; zero forbidden fields.

### Level 13 — Live Write Verification

**Purpose:** Verify the write after it happens, not from API success alone.

Only after Arijit approves live write:

- [ ] Take fresh snapshot.
- [ ] Run write with `partialUpdateObjectNoCreate`.
- [ ] Browse live index after write.
- [ ] For every payload objectID, assert live fields exactly equal payload values.
- [ ] Assert live index total unchanged.
- [ ] Assert Blog enriched count increased by payload count, adjusted for any deliberate overwrite.
- [ ] Assert `Algolia_Prod_Copy_Vanilla` untouched.
- [ ] Re-run grounding check against live records and artifacts.

**Pass gate:** exact live match for every written record; zero missing; zero mismatch.

### Level 14 — Searchability Settings Gate

**Purpose:** Avoid writing fields that search never uses.

Only after data write is verified:

- [ ] Read current settings for `Algolia_Prod_Copy_Enhanced`.
- [ ] Confirm `abstract_enriched` and `keyhighlights_enriched` are absent/present as expected.
- [ ] Propose exact `searchableAttributes` diff.
- [ ] Run search impact tests on a replica or controlled settings path first.
- [ ] Apply settings only after explicit approval.
- [ ] Re-run the 300-query search impact set.

**Pass gate:** settings change improves or preserves search quality and does not touch Vanilla.

---

## Required Packet Format

Final validation packet must include:

1. **Run Inventory**
   - result roots
   - cache roots
   - skip list
   - test output

2. **Accounting**
   - Blog live count
   - skip count
   - result row count
   - duplicate count
   - missing count
   - total reconciled count

3. **Outcome Breakdown**
   - status counts
   - verdict counts
   - writable count
   - non-enrichment count
   - unresolved count

4. **Grounding**
   - records checked
   - abstract spans checked/found/not found
   - highlight spans checked/found/not found
   - exact substring result
   - canonical substring result
   - right-document/served-url result

5. **Leakage**
   - dead-page leakage
   - nav/furniture leakage
   - duplicate-description leakage
   - code/comment leakage

6. **Quality**
   - judge score distribution
   - records below threshold
   - missed-substance count
   - misleading-join count
   - human review pack result

7. **Search Impact**
   - query set size
   - baseline metrics
   - candidate metrics
   - wins
   - regressions
   - recommendation

8. **Write Safety**
   - dry-run payload count
   - forbidden-field check
   - protected-field check
   - skip-ID check

9. **Decision**
   - `WRITE_APPROVED_RECOMMENDED`
   - `WRITE_BLOCKED`
   - `PARTIAL_WRITE_RECOMMENDED`
   - exact reason

---

## Stop Conditions

Stop and do not write if any of these happen:

- any written span is not found in the source body
- any enriched row is sourced from a non-Scout body
- any enriched row is sourced from the wrong served URL
- any dead-page body produces writable enrichment
- any payload contains forbidden metadata fields
- duplicate objectIDs appear in result rows
- total accounting does not reconcile to 2,800
- search impact evaluation shows material regression without a mitigation
- human review finds severe misleading abstract/highlight joins

---

## Execution Order After Claude Finishes

- [ ] Run Level 0–3 immediately after both Phase 2 and Phase 3 finish.
- [ ] Run Level 4–6 over all writable rows.
- [ ] Generate quality judge pack for Level 7–8.
- [ ] Generate human review pack for Level 9.
- [ ] Run search impact eval Level 10–11.
- [ ] Run writer dry-run Level 12.
- [ ] Present packet and recommendation.
- [ ] Wait for explicit approval before Level 13 live write.
- [ ] Wait for separate explicit approval before Level 14 searchability settings.
