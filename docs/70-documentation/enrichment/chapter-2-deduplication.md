---
title: "Chapter 2 — Deduplication"
description: "Collapsing 16,967 records onto 12,114 distinct URLs without losing a single field of content."
status: complete
asana: "[WU-26.2] Index deduplication (1217241770015375)"
---

# Chapter 2 — Deduplication

> **Status: complete and verified live, 2026-08-06.** 16,967 → 12,114 records.

## 1. What the index looked like

`Algolia_Prod_Copy_Enhanced` held **16,967 records over 12,114 distinct URLs**. 4,853 records — 28.6% of the index — were surplus.

| | |
|---|---|
| Records | 16,967 |
| Distinct URLs | 12,114 |
| **Excess** | **4,853 (28.6%)** |
| URLs appearing more than once | 2,371 |
| Worst case | **38 copies** of `/fr/resources/asset/ebook-technical-buyers-guide-to-site-search` |

Copies per URL: 9,743 URLs appear once · 1,170 twice · 668 three times · 251 four · then a tail out to 38.

Measured by browsing every record from the live index. No sampling.

## 2. The justification was wrong, and checking is what found it

The plan for this chapter opened with a confident sentence:

> *"Every duplicate inflates facet counts, wastes result slots, and lets the same page occupy several positions in one result set."*

**That is false.** The index already had `distinct: true` with `attributeForDistinct: url`.

| Check | Result |
|---|---|
| `nbHits` on an empty query | **12,114**, not 16,967 |
| Facet `blog-post` | live **2,800** — matches per-URL truth, not the per-record 3,102 |
| Facet `doc-sdk` | live **2,203** — per-record was 2,308 |
| Facet `support-article` | live **1,695** — no duplicates to collapse |

Algolia applies `distinct` to facet counts as well as hits. **Duplicates were invisible to every user, every query, and the demo, the entire time.**

This was found by accident. A rollback rehearsal printed `nbHits`, the number was unexpected, and pulling that thread produced the settings. Nobody had read the index settings before writing the problem statement.

**The lesson generalises past this project:** record count and result count answer different questions. A browse returns every record; a query applies `distinct`. Reading a raw record count and inferring a search defect skips the step that decides whether a user ever sees it.

### What remained true

Deduplication went ahead on a cost-and-robustness case, not a correctness one:

1. **40% record overhead** — 16,967 stored and billed where 12,114 would do.
2. **40% write amplification** — every pipeline run fans out to all 16,967. Chapter 1's taxonomy write paid it, and every future write would too.
3. **Analytics fragmentation** — clicks and conversions for one page split across several objectIDs.
4. **`distinct` is a query-time mask over a data defect.** Remove the setting, add a replica without it, or send one query with `distinct: false`, and 4,853 duplicates appear instantly.

That is a weaker argument than the original claim, and it was put to Arijit as a decision rather than carried on momentum.

## 3. Why the duplicates existed — and what `environment` actually is

Every record carries an `environment` field. The obvious theory — that duplicates are simply one copy per environment snapshot — does not survive measurement.

| Cause | URLs |
|---|---|
| Each copy under a different `environment` | 867 |
| **Same `environment`, genuinely duplicated** | **430** |
| Mixed | 1,074 |

Inside the single newest value alone (`prod20260722`): **14,394 records over 11,566 URLs — 2,828 excess.** So `environment` does not explain it.

What the values look like:

| `environment` | records | `indexed_at` span |
|---|---|---|
| `prod20260722` | 14,394 | all on **2026-07-21** — one bulk crawl |
| `nonprod20260220` | 2,133 | 2026-02-20 → 2026-07-15 |
| `prod20260621` | 191 | **2026-07-22 → 2026-08-04** |
| `nonprod9` | 130 | 2025-12-08 → 2026-01-13 |
| `prod03042026` | 96 (over 51 URLs) | 2026-03-10 → 2026-07-21 |
| `nonprod`, `nonprod10` | 22, 4 | 2025-12 |

The telling row is `prod20260621`: named for June 21, but its records were indexed **July 22 to August 4** — *after* the `prod20260722` crawl. So the tag cannot be stamped by the indexer at ingest. It most likely comes off the page itself, a build or deployment identifier emitted by the site. The date formats also disagree (`20260722` vs `03042026`), pointing at different tooling eras.

**This is inference from the data, not confirmed.** The ingest pipeline was not located and its owner is unknown.

**Counter-evidence against blaming environments at all:** `AC2_WWW_MULTI_NEURAL` carries the same `environment` field and has **zero duplicates** (8,353 records / 8,353 URLs).

**The 430 same-environment duplicates remain unexplained.** They originate upstream, in `Algolia_Prod_Copy_Vanilla`, which is off-limits for writes.

### ⚠ `environment` is not a content-quality signal

An early draft of this work proposed deleting the 2,285 `nonprod*` records as "test content polluting a production index." **That would have destroyed real data.** The claim came from reading the word "nonprod" in a string field rather than from looking at the records.

| | Count |
|---|---|
| `nonprod*` records | 2,285 over 2,252 distinct URLs |
| …whose URL **also** exists in a prod record | 1,923 — ordinary duplicates |
| …whose URL exists **only** under nonprod | **329** |

Those 329 are real algolia.com pages: `/customers/kingarthur`, `/blog/product/avoid-no-results-pages`, `/de/customers/DocMorris`, 68 `/doc/rest-api` pages, 43 support articles, 32 job ads. Spot-checked 6 against the live site: 4 returned 200, 2 returned 404.

**Rule: never filter or delete on `environment`.** Its only legitimate use is survivor ranking.

## 4. Chunks are not duplicates

objectIDs come in two shapes: plain (`en_7ed2856b-…`, 15,567 records) and chunk-suffixed (`en_7ed2856b-…_3_0`, **1,400 records across 417 base documents**). The 38-copy ebook is a chunked PDF: `_0_65`, `_0_66`, `_0_67`…

A URL-level dedupe written without knowing this would collapse them silently.

348 of the 417 base groups have byte-identical `title`/`abstract`/`description` — **weaker evidence than it looks**, because in the sampled group `abstract` was empty on every chunk, so "identical" means "both empty." **69 groups differ outright.**

Collapsing chunks is defensible *in this index only*, because there is no `body` field for a chunk to carry. **That stops being true the moment content enrichment adds one.** The tool therefore counts and reports chunk groups **separately** from ordinary duplicates and never merges the two populations in one code path.

Also relevant: **8,507 objectIDs are absolute URLs.** A URL ending in `_1_3` is a version number, not a chunk index, so URL-shaped objectIDs are excluded from chunk detection by construction — verified as zero false positives today, and guarded by a test so it stays that way.

## 5. The survivor rule, and the heuristic that had to be thrown away

Every duplicate group needed a rule for which record lives. The first attempt — **"keep the longer field value, it has more content"** — proposed **1,592 rescues**. Reading the actual pairs killed it.

| Field | Proposed rescues | What "longer" actually meant |
|---|---|---|
| `title` | 644 | `"What is federated search?"` → `"What is Federated Search? \| Algolia \| Algolia"`. Longer only because of a doubled suffix — and 7,000 `\| Algolia` suffixes are already a logged hygiene defect. |
| `description` | 351 | Clean prose → raw HTML pull quotes: `<blockquote>&ldquo;As the digital space shifts…` |
| `abstract` | 333 | Same. |
| `thumbnail` | 28 | Real CDN asset → S3 Playwright screenshot. |

On a corpus that has been through several ingestion pipelines, **the longer string is often the older or dirtier one.** Length correlates with boilerplate, markup and stale suffixes at least as strongly as with information.

### The rule that shipped

1. **No filtering on `environment`.** Every record enters the dedupe.
2. **Group by canonical URL.** The default host is stripped so an absolute `www.algolia.com` URL groups with the equivalent path; **any other host is kept**, because support, academy and greenhouse URLs share path shapes with the www site. The **locale prefix is deliberately not stripped** — `/fr/pricing` and `/pricing` are different pages.
3. **Elect a survivor** by `environment` recency rank, then `indexed_at` descending, then `objectID` ascending. Total and deterministic: input order cannot change the outcome.
4. **Gap-fill only.** A loser's value is taken **only where the survivor has nothing at all**. A populated field is never overwritten, however much longer the alternative.
5. Write the merged survivor, then delete the losers.

Result: **1,592 → 224 rescues**, every one replacing `null`, `[]` or `""`. Verified zero overwrites.

| Field | Rescues |
|---|---|
| `tags` | 194 |
| `keywords` | 12 |
| `abstract` | 8 |
| `description` | 4 |
| `authors` | 3 |
| `category` | 2 |
| `thumbnail` | 1 |

Identity fields (`objectID`, `url`, `environment`, timestamps, `source`, `is404`) and all taxonomy fields are never rescued. Duplicate-URL taxonomy divergence was already **0**, so there was nothing to merge, and merging arrays across records could have produced a combination no classifier ever emitted.

### An unknown environment is an error, not a default

The rank table knows six values. An unrecognised one **hard-fails and names itself** rather than being demoted to last place — the same discipline as `classify.py` hard-failing on an unmatched URL. A silently mis-ranked generation would elect the wrong survivor for every record in it.

## 6. Preconditions, all met before anything was deleted

| | |
|---|---|
| **Tests before the destructive path** | 40 tests, written first — survivor election over every rank and both tiebreaks, input-order independence, gap-fill including the whitespace-only case, identity/taxonomy never rescued, chunk detection vs URL-shaped IDs, locale twins never merged, non-default hosts preserved, unknown environment aborting the plan, and **a guard asserting `--dry-run` issues zero write calls**. |
| **Rollback rehearsed, not assumed** | The existing snapshot was restored into a scratch index, browsed, confirmed at 16,967 raw records, and the scratch deleted. A snapshot nobody has restored from is a hope. |
| **Rescue heuristic settled on real data** | See §5. The dry-run prints sample pairs per field precisely so this can be judged rather than trusted. |
| **Numeric success criterion, stated up front** | Exactly 12,114 records, taxonomy divergence 0, all 329 nonprod-only URLs present. |
| **Frontend clearance** | The demo's own filtered view was compared before and after — see §8. |

## 7. Running it

```bash
# default: writes nothing
python3 dedupe.py --index Algolia_Prod_Copy_Enhanced --out reports/

# after reviewing reports/rescue-log-*.jsonl
python3 dedupe.py --index Algolia_Prod_Copy_Enhanced --apply --snapshot
```

`--dry-run` is the default. It re-derives the census **from the live index** and hard-fails if it does not match the expected shape — every figure the plan was built on came from a local dump, so live re-derivation is the first thing that has to pass. It emits the census, chunk groups and duplicate groups counted separately, every group with its survivor and why each loser lost, `rescue-log.jsonl` with survivor value beside loser value, and the exact objectIDs that would be deleted.

`--apply` refuses to run without a fresh snapshot and re-verifies against live afterwards.

**`urllib` is unusable here** — TLS interception fails it with `CERTIFICATE_VERIFY_FAILED: self-signed certificate in certificate chain`. Every Algolia call shells out to `curl`, reusing `apply_taxonomy.py`'s helper.

**No model is involved at any point.** Group, rank, merge, delete. Run it twice, get the same answer.

## 8. Verified result

All numbers read back from the live index after the final write.

| Check | Result |
|---|---|
| Records | **12,114** |
| Distinct canonical URLs | 12,114 |
| URLs still carrying >1 record | **0** |
| `page_type` coverage | **100.00%** |
| `taxonomy_version` | uniform |
| 329 nonprod-only URLs | **all present** |
| Records deleted | 4,853 |
| Fields rescued | 224, across 213 survivors |

**Frontend impact: none.** The demo filters on `environment:"prod20260722" AND language_code:"en" AND NOT is404:true`. That view returned **7,979 distinct URLs before** and **7,979 nbHits after** — identical. The demo was then loaded in a headless browser and driven with a real query: Algolia returned 200s, facets and results rendered, **zero console errors**.

**Content impact: none negative.** On the 151 URLs where the elected survivor differs from the record Algolia was previously displaying, after gap-fill rescue **zero end up with less content** and one ends up with more. The remainder are equal-length variants of the same page, where Algolia's previous choice was itself an arbitrary internal tiebreak.

**Idempotent.** Re-running now reports `nothing to do — 12,114 records, 12,114 distinct URLs, 0 excess`.

## 9. Side effect worth carrying into Chapter 3

**14.0% of the index's text was duplicate.** Total natural language fell from 7.41M to 6.37M characters. Characters-per-record rose from 437 to 526 — **purely because the denominator shrank**, not because anything was added. Chapter 3's conclusion is unchanged and arguably sharper: 526 characters is still a title and one sentence.

## 10. ⚠ The one thing that undoes this work

`Algolia_Prod_Copy_Enhanced` is a **copy of `Algolia_Prod_Copy_Vanilla`**. Every one of its 12,114 objectIDs exists in Vanilla, and **Vanilla still holds all 4,853 duplicates** — the exact objectIDs deleted here are still sitting there.

Vanilla is off-limits for writes: a colleague's live Agent Studio agents query it. So the duplicates cannot be fixed at source.

> **Never rebuild `Algolia_Prod_Copy_Enhanced` by copying `Algolia_Prod_Copy_Vanilla`.**
> A raw copy restores all 4,853 duplicates **and wipes the entire 8-axis taxonomy** — the second loss being much the larger one.
> The refresh path is: copy → `classify.py` → `apply_taxonomy.py` → `dedupe.py`, in that order.

Nothing currently writes to Enhanced — it is a frozen copy, and the dedupe will not silently undo itself. The risk is a human running a convenience copy.

## 11. What this chapter did NOT prove

- **That the duplicates will not come back.** The upstream cause is unidentified, lives in Vanilla, and 430 same-environment duplicates have no explanation at all.
- **That any of these URLs are still live.** `is404` cannot answer it: `False` 8,356 · `True` 24 · **absent 8,587**. A spot check of 6 URLs found 2 dead. A liveness census is its own job.
- **That the surviving record is the *best* record.** It is the deterministically-elected one, gap-filled so it is never poorer than what was displayed before. That is a weaker and more honest claim.
- **That `distinct: true` should stay on.** It is now redundant — one record per URL — but leaving it means any future re-duplication would be invisible again, exactly as it was this time. Unresolved.
