---
title: "Chapter 1 — Taxonomy Enrichment"
description: "Classifying all 16,967 records of Algolia_Prod_Copy_Enhanced on eight axes, using only data the index already had."
status: complete
applied: 2026-08-06
index: Algolia_Prod_Copy_Enhanced
asana: "Chapter 1 : Taxonomy Enrichment (1217211516276070)"
work_unit: "WU-11 subtask [WU-11.1] (1217210602718821)"
---

# Chapter 1 — Taxonomy Enrichment

> **Status: complete and live.** Applied to `Algolia_Prod_Copy_Enhanced` on 2026-08-06 and verified against the live index. Rollback available at `Algolia_Prod_Copy_Enhanced_pre_taxonomy_20260805`.

## 1. The problem

A full census of the index — all 16,967 records browsed, not sampled — found **30.4% of field values empty**.

The emptiness was not spread evenly. It sat almost entirely in one place:

| Source | Records | tags | keywords | hierarchy | facets | is404 |
|---|---|---|---|---|---|---|
| **Documentation** | **8,507 (50.1%)** | **6%** | **0%** | **0%** | **0%** | **0%** |
| Blog | 3,102 | 97% | 100% | 100% | 100% | 100% |
| Support | 1,695 | 0% | 0% | 0% | 0% | 100% |
| Website | 1,205 | 56% | 56% | 93% | 0% | 93% |

`category` on all 8,507 Documentation records was the literal string `"Doc"`. One value, zero discriminating power. **Half the corpus could not be filtered, faceted, or narrowed by anything.**

Meanwhile every single record carried a usable URL — **16,967 / 16,967**, zero absent, zero blank, 100% yielding at least one path segment. The taxonomy was already sitting in the URLs. Nobody had extracted it into fields.

That is what this chapter does. No crawling, no model calls, no new content — only rearranging information the index already held.

## 2. What was built

**Eight axes.** Seven are ordered arrays; `page_type` is a single string.

| Field | Type | Meaning |
|---|---|---|
| `product` | `string[]` | Which Algolia product |
| `feature` | `string[]` | Which capability |
| `solution` | `string[]` | Which use case |
| `industry` | `string[]` | Which vertical |
| `customer` | `string[]` | Which customer |
| `language_platform` | `string[]` | Python, Go, React… |
| `integration_platform` | `string[]` | Shopify, Magento, SFCC… |
| `page_type` | `string` | What kind of page |
| `taxonomy_provenance` | `object` | Per axis: where the value came from |
| `taxonomy_confidence` | `object` | Per axis: high / medium / low |
| `taxonomy_version` | `string` | Which schema generation produced it |

**Four files**, in `docs/60-enrichment/`:

| File | Role |
|---|---|
| `build_schema.py` | Emits the schema — vocabularies, 89 URL rules, applicability, aliases |
| `taxonomy-schema.algolia-com.json` | **The data.** A new corpus means a new JSON, not new code |
| `classify.py` | **The engine.** Generic; contains no Algolia-specific logic |
| `apply_taxonomy.py` | Fan-out writer plus facet configuration |

The split between the last two is the reusability contract: `classify.py` knows how to read a schema and apply it; it does not know what Algolia is.

## 3. Three design decisions worth understanding

### 3.1 One ordered array, not a primary + `_all` pair

A tag field is asked to do five jobs. Filtering and faceting want *many* values; the result card, ranking, and grouping want *one*. The obvious answer is two fields — `product` (single) and `product_all` (array).

That was built, then rejected. **Arrays are ordered and Algolia preserves that order**, so `product[0]` *is* the primary. One field serves all five jobs.

The two-field version fails for reasons that will recur in any dataset:

- **The two fields can disagree and nothing prevents it.** `product="recommend"` alongside `product_all=["search"]` is a structurally valid, silently wrong record. The design needed a `_all ⊇ primary` verification gate — and a schema that requires a gate to stay self-consistent is worse than one that cannot become inconsistent.
- **Two answers to "which field do I filter on?"** is one too many. Someone filters the single-valued field, silently loses recall, and never finds out, because a missing result reports nothing.
- **It doubles the surface** — 15 tag fields instead of 8, and double the facet config, agent instructions, and docs.

**The contract:** element 0 is the highest-confidence, most specific value. Order is URL-derived first, then authored-field matches, then text matches by descending evidence.

The one real cost: a facet can count membership but not *primary* membership. That is an analytics question, computable offline, not a search question.

### 3.2 Empty is three states, not one

The naive design writes `"unknown"` wherever an axis fails to resolve. Applied to `customer`, that would have made the largest bucket in the customer facet `"unknown"` with **16,697 records** — the same "null as a value" defect found in the reference index this work studied.

| State | Meaning | Storage |
|---|---|---|
| **Resolved** | We determined it | the value |
| **Not applicable** | There is nothing to determine — a doc page has no customer | **field omitted entirely** |
| **Undetermined** | It applies, but we could not tell | `"unknown"` |

Omission is the datastore's native "no": the record drops out of that facet and counts stay honest. `"unknown"` survives only where it is a genuine classifier miss, so it stays a *measurable, improvable* number rather than noise.

Applicability is declared per axis as a function of `page_type`, and it is **derived from a measured resolution matrix, not asserted**. The evidence: `customer` resolves on 100% of case-study pages and 2% of blog posts. A blog post naming no customer is not a gap; a case study without one is.

This distinction alone moved `customer` from 9.3% to 100%.

### 3.3 Accuracy is not a sampling problem

Error is not uniform across this corpus, so estimating one error rate by sampling would be the wrong instrument.

| Population | Size | Error type | Treatment |
|---|---|---|---|
| URL-deterministic | **12,056 (71.1%)** | Table bugs, not noise | Enumerate the table |
| Text-dependent, independently labelled | 2,198 URLs | Disagreement | Free cross-validation |
| Text-dependent, blind | **2,262 URLs** | Genuine unknown | The only place human labelling pays |

**394 distinct URL patterns exist. 64 cover 95% of all records; 284 cover 99%.** So the deterministic majority is verified by *reviewing 64 rules exhaustively* — certainty, not an estimate. That review is what surfaced the bugs in §5.

## 4. How it runs

```bash
# 1. Snapshot. Blocking — nothing proceeds without it.
#    Verified 16,967 entries / 15.9 MB, identical to source.

# 2. Emit the schema from the corpus + declared vocabularies
python3 docs/60-enrichment/build_schema.py

# 3. Classify every distinct URL
python3 docs/60-enrichment/classify.py \
  --schema      docs/60-enrichment/taxonomy-schema.algolia-com.json \
  --records     docs/60-enrichment/enhanced-pre-taxonomy-20260805.jsonl \
  --out         docs/60-enrichment/taxonomy-assignments.jsonl \
  --candidates  docs/60-enrichment/candidates.jsonl

# 4. Write to the index and set facet config
python3 docs/60-enrichment/apply_taxonomy.py \
  --index Algolia_Prod_Copy_Enhanced \
  --records     docs/60-enrichment/enhanced-pre-taxonomy-20260805.jsonl \
  --assignments docs/60-enrichment/taxonomy-assignments.jsonl \
  --replace --batch 500 --settings
```

**Two mechanics that matter:**

**The join key is the URL, never `objectID`.** In this corpus 8,507 objectIDs are absolute URLs while 8,460 are locale-prefixed UUIDs — there is no single format and it cannot be derived. Assignments are computed once per distinct URL (12,114) and fanned out to every objectID sharing it (16,967). One ebook URL carries **38 records**; without the fan-out, 37 of them would be silently skipped.

**Facets are declared `afterDistinct(...)`.** The index runs `distinct:true` on `url`. Without `afterDistinct`, facet counts would include the 4,853 duplicate records — the facet would read 900 while the result set showed 600.

## 5. Four bugs, all self-inflicted, all caught by the gates

This section exists because it is more useful than the parts that worked.

### 5.1 `min_evidence=2` discarded 90.6% of all text matches

The intent was "require enough evidence." The implementation counted **distinct alias strings for the same concept** — so a page saying "facet" once scored 1 and was discarded. With a median of 419 characters per record, a concept almost never surfaces two different aliases.

Measured: **13,184 of 14,559 hits thrown away.** Lowering to 1 moved `feature` from 19.2% to 38.2%. Precision protection lives in the generic-term ban (§5.3), not in this threshold.

### 5.2 `applies_to: "*"` on five axes

Asserting that every doc-SDK page should have an `industry` and every blog post a `customer`. Both false. This inflated the `unknown` rate to over 80% and made the classifier look far worse than it was. Fixed by the three-state model in §3.2.

### 5.3 A customer named after an English word

`customer="end"` collected **70 false text matches** on the word "end" — END. is a fashion retailer — against 5 genuine URL-derived ones.

The fix had to be surgical, not blanket: `walgreens` (15 text matches) and `gymshark` (12) are **real citations in blog posts** and had to be kept. So the guard is per-value, not per-axis: a vocabulary value that is also an ordinary English word may be assigned from a URL path or an authored field, but never from free text.

A related case at the axis level: `"search"` appears in the title, abstract, or URL of **47.9% of all records**. Generic terms are barred from text matching entirely for the same reason.

### 5.4 96,039 nulls written into the live index

The worst one. To clear stale fields before rewriting, the writer used `partialUpdateObject` with each taxonomy field set to `null`.

**`partialUpdateObject` can add or overwrite an attribute. It cannot remove one.** Setting a field to `null` stores a literal `null`. The result was 96,039 null values across the index — reproducing precisely the "null as a value" defect this entire schema exists to prevent.

Caught by the post-write census, not by anything upstream. Fixed by switching to full-record replace: build the complete record (original fields plus only the applicable taxonomy fields) and `updateObject` it. A non-applicable axis is then genuinely absent.

That fix is also **idempotent**, which is the property an ongoing, re-runnable pipeline actually needs. The bug forced the better design.

## 6. Measured result

Verified by browsing all 16,967 records from the live index after the final write.

| Check | Result |
|---|---|
| Record count | **16,967** — unchanged, no creates, no drops |
| `page_type` present | **100.00%** |
| `taxonomy_version` present | 16,967 |
| NULL values | **0** |
| Literal `"null"` string | **0** |
| Duplicate values within an array | **0** |
| Axis values written | 22,730, of which **15.0%** `"unknown"` |

**Coverage against target, on records where each axis is *required*:**

| Axis | Required n | Resolved | Target | |
|---|---|---|---|---|
| `page_type` | 12,114 | **100%** | 98% | PASS |
| `customer` | 237 | **100%** | 95% | PASS |
| `integration_platform` | 119 | **100%** | 95% | PASS |
| `language_platform` | 2,246 | **99.8%** | 98% | PASS |
| `solution` | 28 | **89.3%** | 80% | PASS |
| `feature` | 7,168 | 73.6% | 75% | short |
| `industry` | 49 | 69.4% | 85% | short |
| `product` | 562 | 42.5% | 70% | short |

**Live queries** (real API responses, not the local file):

```
language_platform:python AND feature:faceting      →  4 hits
industry:fashion AND page_type:case-study          → 21 hits
integration_platform:shopify AND page_type:support-article → 200 hits
product:agent-studio                               → 252 hits
"typo tolerance" + page_type:support-article       → 30 hits
```

## 7. Known open issues

**R5 fails on two values.** The rule rejects any value covering more than 40% of the records where its axis is written.

- `industry='ecommerce'` at **72.3%**
- `product='ai-search'` at **40.4%**

The `ecommerce` case is worth stating precisely, because it exposes a flaw in the rule rather than in the data: **764 of those 773 tags come from Algolia's own authored keywords** on blog and resource posts — only 9 from URL paths. The tag is *factually correct*. It simply does not narrow anything. R5 as written conflates "wrong" with "non-discriminating". Resolving that is Chapter 3's job.

**Three axes below target**, and the cause is measurable: there is no body field. Median text per record runs 117 characters on `doc-rest-api`, 160 on `doc-api-reference`, 203 on `doc-guide`, 370 on `blog-post`. Every URL-derived signal has been mined — 89 rules including SDK method groups and 194 API parameters. The residue needs text that does not exist in the index. That is Chapter 2.

**Precision is unmeasured.** This chapter proved coverage. It did not prove the values are *correct*. That is Chapter 3.

## 8. What makes this repeatable

- **`taxonomy_version` on every record** turns staleness into a query. A record with no version is un-enriched; bump the version and every record on the old one becomes the work queue automatically.
- **Full-record replace is idempotent.** Re-running is always safe, so re-processing everything is the default rather than an exception.
- **The candidate queue** captures every value seen but absent from the vocabulary. Currently empty. It is the schema's improvement backlog: the system reporting what it does not yet know, instead of silently discarding it.
- **The engine is generic.** Pointing it at a new dataset means authoring a new schema JSON, not writing new code.
