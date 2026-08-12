---
title: "Chapter 4 — Enrichment Validation"
description: "Proving the values are correct, not merely present."
status: in-progress — Blog and Case Study verified 2026-08-12; taxonomy precision still open
asana: "Chapter 4 : Enrichment Validation (1217211571015558)"
---

# Chapter 4 — Enrichment Validation

> **Status: in progress.** Blog and Case Study are verified end to end (§0). Taxonomy precision
> — the original subject of this chapter — is still unmeasured.

## 0. Corpus verification: Blog and Case Study, every record — 2026-08-12

Two corpora were re-verified against the **live index**, one record at a time, no sampling.

| | Records | Spans checked | Located | Genuine absences | Quality defects | Drift |
|---|---:|---:|---:|---:|---:|---:|
| Blog/blog-post | 2,694 | 21,790 | **21,790** | **0** | 0 | 0 |
| Customer Stories/case-study | 225 | 1,714 | **1,714** | **0** | 0 | 0 |

Command: `algolia_enrich.py verify-corpus --source <S> --page-type <P>`.
Artifacts: `docs/70-enrichment/runs/20260812-blog-verify-final/` and `…-cs-verify-final/`, each
carrying a per-record JSONL line. Commit `e97f0c8`.

### Why this needed new code

Every validation path in the skill was **run-scoped** — `cmd_validate` reads `ctx.run_dir`,
`cmd_verify_live` reads that run's `final/payloads.jsonl`. All of them answer *"was this run
correct?"* None could answer *"is what is in the index right now correct?"*, which is the only
question that survives a run folder being cleaned up or the code changing underneath it. The Blog
corpus had been validated on 2026-08-10 against **local batch outputs**; the live records had
never been re-checked.

`live_corpus.py` reads enriched records straight from the index, re-locates every stored span in
its own cached source page, and re-runs the scripted quality gates. Deterministic; no LLM.

### Case Study, fully accounted for

237 records, and the enrichable ceiling is **226**, not 237:

| | Count |
|---|---:|
| Enriched, verified, promoted into Enhanced | **225** |
| `donorschoose` — recoverable, spans 8,111 chars apart vs an 8,000 limit (1.4% over) | 1 |
| **Soft 404** — HTTP 200, full body, story removed | 4 |
| Hard 404 — page gone, 205-byte error body | 7 |

The 225 were promoted from the parallel holding pen into `Algolia_Prod_Copy_Enhanced` after a
snapshot was taken (`…_SNAPSHOT_20260812`). Record count unchanged at 11,928, all 225 read back
byte-exact, searchability proven by query. Case-study enrichment in Enhanced went **1 → 225**.

### Three verifier defects found while producing these numbers

Each would have produced a confident, wrong answer. They are recorded because the lesson is not
about these bugs — it is that **a verifier's first failures are usually its own**.

1. **`canonicalise` is not idempotent on 5.5% of Blog bodies** (22 of 400) — a JSX snippet inside
   a code fence; pass one leaves the tag, pass two strips it. Grounding compares
   `canon_text(span)` against `canonicalise(body).text`, canonicalising the span twice and the
   haystack once, so a span that IS on the page reported as absent. Written first as *fatal*,
   which would have blocked all 2,694 records over the verifier's own normalisation. Now reported,
   and every miss is re-tested symmetrically and split into artifact vs genuine absence.
2. **"HTTP status must be 200" flagged 1,805 of 2,694 records.** All false. Scout follows
   redirects, so the cached status is the *first hop* — 1,881 Blog pages cached as 301 — while
   `served_url` records where the chain landed. On all of them `served_url == url`. The status
   code was never the signal.
3. **Soft 404s were structurally undetectable.** Dead-page markers were scanned only in
   `body[:200]`, which on algolia.com is the language switcher on every page. Four case studies
   returned 200 with 3.7–8.2 KB and no story — `/customers/kingarthur` serves the generic customer
   hub and says "king arthur" **zero times**. They had been labelled `NO_PROSE`, which blames the
   writer for the page's absence. Fixed at two levels: a second marker window at the page's own
   first heading (instance), and `subject_absent_reason` — *a page that never mentions its own
   subject is gone, whatever the stub says* (class). Verified on **4,421 live pages across four
   corpora: catches exactly the 4 known soft 404s, zero false positives.**

### What this does NOT prove

Grounding is a guarantee; selection quality is a judgement. These records are proven to be
**faithful** — every span is on the page it claims. Nothing here proves a span was the **best**
sentence to choose. That remains the judge's job, and the judge floor is unresolved.

## 0b. Taxonomy correctness: measured for every rule-derived value — 2026-08-12

This chapter was created to answer *"are the taxonomy values correct?"*, deferred here by
Chapter 1 §7. Half of that question is now answered, deterministically.

**Conformance** (`taxonomy-preflight`) proves the contract on all 11,928 records:
`violation_count: 0`. But `taxonomy.py`'s own docstring says it "verifies conformance, not
semantic correctness", and it never reads a URL or a page — so it cannot distinguish a page about
NeuralSearch tagged `product: recommend` from a correct one.

**Correctness** (`taxonomy-correctness`, new) re-runs the schema's own `url_rules` table against
each record's URL and compares to what is stored. No model, no sampling:

| Axis | Checked | Correct | **Wrong** |
|---|---:|---:|---:|
| `page_type` | 11,928 | 11,928 | **0** |
| `feature` | 2,423 | 2,423 | **0** |
| `product` (where applicable) | 155 | 155 | **0** |
| **Total** | **14,506** | **14,506** | **0** |

### The population this does not reach

**5,519 text-matched** and **2,778 legacy-field** assignments. No rule predicts them, so nothing
deterministic can confirm them. Measured provenance across the index: `page_type` is 100%
URL-derived; of ~15,400 non-`page_type` assignments only ~35% are URL-derived. **That minority is
the entire residual risk surface — and it is a risk surface, not a measured error rate. No
taxonomy error has been found anywhere.**

### A schema inconsistency this surfaced

`url_rules` names `product: ["ai-search"]` on `/doc/libraries/{lang}/{ver}/methods/search` paths,
while the axes model puts `doc-sdk` in neither `required_on` nor `opportunistic_on` for `product`.
Applicability wins, so the 726 affected records are right to omit it and there is **no data
defect** — but those rule entries are dead configuration. Reported separately by the command as
`rule_contradicts_applicability` rather than folded into the defect count, because conflating a
schema bug with a data bug is how 726 false defects get reported.

### Two traps, both hit before the number above was trustworthy

1. `url_rules` carry a `host`. Ignoring it matched `academy.algolia.com` against
   `www.algolia.com` rules — **142 phantom `page_type` mismatches**.
2. Treating "rule predicts a value, record has none" as a defect without consulting the
   applicability model — **726 false defects**.

Both are now pinned by tests, and the checker refuses to report a pass when no rule predicted
anything at all.

## The distinction this chapter exists to make

[Chapter 1](./chapter-1-taxonomy-enrichment.md) proved **coverage** — the fields are populated. It did **not** prove **precision** — that the values are correct.

Those are different questions, and only the second matters to a user. A classifier that tagged every page `faceting` would score 100% coverage and be worthless.

Worse, a wrong tag **fails silently**. A mis-tagged page simply stops appearing in a filtered result set, and nobody reports a result they never saw. Under-tagging is visible as a gap; mis-tagging is invisible.

## Why this is not a sampling problem

Error is not uniform across this corpus, so estimating one error rate from a random sample would be the wrong instrument.

| Population | Size | Error type | Treatment |
|---|---|---|---|
| URL-deterministic | **12,056 (71.1%)** | Table bugs, not noise | Enumerate the table — done in Ch.1 |
| Text-dependent, independently labelled | 2,198 URLs | Disagreement | Free cross-validation |
| Text-dependent, blind | **541 URLs** | Genuine unknown | The only place human labelling pays |

> **Corrected 2026-08-06.** This table originally said 2,262 (Blog 1,265 · Resources 554 ·
> Website 443). Measured live on canonical URLs: 8,235 distinct URLs, 2,784 carrying a
> text-match value, 2,243 of those corroborated by an independent labeller — leaving **541**
> genuinely blind. ~380 are `doc-sdk`/`doc-api-reference`/`doc-rest-api`/`doc-tool` pages that
> should earn URL rules, so the irreducible human queue is roughly **161**.

**394 distinct URL patterns exist; 64 cover 95% of records.** The deterministic majority was verified in Chapter 1 by reviewing that table exhaustively — 100.00% coverage, 0 unmatched. That is certainty, not an estimate, and it is already done.

**2,198 URLs already carry independent labels** — 1,263 from `algolia-central_enterprise_ledger`, 1,440 from the six-axis prototype, 900 from both. Free cross-validation with no human effort. Where our classifier agrees with an existing labeller, no review is needed. Where it disagrees, that becomes the review queue: a discovered, bounded set rather than a random draw.

**The blind set is 541 URLs.** This is where hand-labelling earns its keep, and nowhere else — and ~380 of them are `doc-sdk`, `doc-api-reference`, `doc-rest-api` and `doc-tool` pages whose URLs are structured enough to earn a rule instead. **The irreducible human queue is roughly 161.**

## A ceiling already measured

The ledger and the six-axis prototype independently labelled **900 of the same URLs**. Measured agreement:

| Axis | Comparable pairs | Agree | Disagree |
|---|---|---|---|
| `product` | 824 | **52.2%** | 47.8% |
| `industry` | 485 | **79.0%** | 21.0% |

That was a *generous* test — containment, not equality — and `product` still fails half the time. Two serious independent attempts at this task on this corpus land near coin-flip.

A single 90% precision gate is therefore not achievable. Per-axis targets were set to measured reality instead:

`page_type` 98 · `language_platform` 98 · `integration_platform` 95 · `customer` 95 · `industry` 85 · `solution` 80 · `feature` 75 · `product` 70

## What to build

**Two tools, not one.** Conformance and correctness are different questions
with different outputs, and an earlier plan for a single `validate.py` conflated them:

**a. conformance** — machine, pass/fail on every one of the 12,114 records
**b. correctness** — corroboration against independent labellers, which can never be pass/fail

Between them:

- Cross-check assignments against the 2,198 independently-labelled URLs. Agreement → confidence. Disagreement → the review queue.
- Enumerate the 541-URL blind set specifically, not a corpus-wide sample. **Precision cannot be *computed* there** — a blind set has no ground truth by definition. The output is the queue; scoring it is a separate, later job.
- Run the conformance checks per axis. **⚠ `R1`–`R5` were never defined anywhere** — grepped the
  repo and vault, and only fragments survive in code comments (R3 = slug form, R4 = closed
  vocabulary, R5 = >40% value share). The schema's `contract` block is the real specification:
  number the checks against its clauses and retire the R-names.
- Report the candidate queue — values seen but absent from the vocabulary. That queue is the schema's improvement backlog: the system reporting what it does not yet know, rather than silently discarding it. Currently empty.

## The `description` field is missing exactly where it is most searchable

**This is in scope for Chapter 4 and it is not optional.** Everything above validates values the
pipeline *writes*. This validates a field the pipeline *reads and depends on* — and which is
absent on one record in seven.

### Measured, full census, no sampling

Verified 2026-08-11 against every one of the **11,928** records in `Algolia_Prod_Copy_Enhanced`,
not a sample: **85.7% of records carry a real description. 14.3% do not** — 7.9% an empty string,
6.3% the literal `…` placeholder character, 0.1% genuinely null.

The corpus-wide number hides the shape of the problem. It is not spread evenly; it is
concentrated in three content families:

| source / page_type | total | no description | % |
|---|---:|---:|---:|
| Website/press-release | 690 | 401 | **58.1%** |
| Resources/resource | 835 | 291 | **34.9%** |
| Blog/blog-post | 2,694 | 887 | **32.9%** |
| Documentation/doc-rest-api | 333 | 23 | 6.9% |
| Customer Stories/case-study | 237 | 7 | 3.0% |
| Documentation/doc-guide | 586 | 6 | 1.0% |

Customer Stories and Documentation do not have this problem. The three families at the top do,
and press-release is more than half missing.

### Why this is a search defect and not a metadata blemish

`description` is a **searchable attribute, ranked immediately after `title`** — position in
`searchableAttributes` *is* ranking priority in Algolia. A record with no description is not
merely thinner; it is absent from the second-highest-priority matching lane altogether. On
press-release that is 401 of 690 pages.

This is the opposite failure to the one recorded in Chapter 3. There, enriched fields were
populated but *not searchable*, so the work changed zero results. Here the field **is**
searchable and is *not populated*. Both end in the same place — no effect on what a user finds —
and neither is visible from a coverage number.

### Two pipeline gates are silently inert without it

Confirmed in code, not inferred. `pipeline.evaluate_selection` passes the record's description
into the splitter as `already_indexed`, and `filters.drop_reason` uses it for both
`DUPLICATE_DESC_EXACT` and `DUPLICATE_DESC_NEAR`. With an empty description:

- the **duplicate-description gate does nothing** — there is no value to be a duplicate *of*;
- the `[ALREADY INDEXED]` label never appears in the menu, so the writer is never warned it is
  about to restate a field the record already stores.

`Website/press-release` sets `duplicate_description_policy: ban`. On 58.1% of that slice, that
ban is enforcing nothing. A gate that cannot fire is not a passing gate, and this is the same
false-green shape as the pool filter that could not see the corpus facts it was asked to enforce.

### What has to be decided before anything is built

The gap is a **source-data fact**, not a pipeline bug: these pages never had a description
upstream. So filling it is new enrichment scope, with the same standards as the rest:

1. **Scope.** Press-release, blog and resources — 1,579 records with no description. Confirm the
   count at run time from the live index; do not carry this number forward as an input.
2. **Provenance.** Generating a description from the page is the same class of task as
   `abstract_enriched`, so it inherits the same guarantee: **verbatim spans selected by index,
   never model-written text.** A generated description is a new field, written to the parallel
   index, and must never overwrite an existing real one — gap-fill only, never overwrite.
3. **The ordering trap.** `abstract_enriched` is *also* derived from the page. If a backfilled
   description and the abstract are both cut from the same lede, the record gains a duplicate,
   the duplicate gate then starts firing against a value this pipeline itself wrote, and
   `information_gain` collapses. Decide which field owns the lede before generating either.
4. **Do not report coverage as the outcome.** Populating 1,579 descriptions proves nothing on its
   own. The claim to make is a measured change in what search returns — and per Chapter 3 that
   requires checking the served result, not the settings.

> **Open, awaiting Arijit's decision:** whether description backfill runs as part of Chapter 4 or
> becomes its own chapter. It is recorded here because it was measured here; the sequencing is
> not mine to set.

## Two open gate failures inherited from Chapter 1

R5 rejects any value covering more than 40% of the records where its axis is written. It currently fails on:

- `industry='ecommerce'` at **72.3%**
- `product='ai-search'` at **40.4%**

The `ecommerce` case is the interesting one. **764 of those 773 tags come from Algolia's own authored keywords** on blog and resource posts — only 9 from URL paths. The tag is *factually correct*. It simply does not narrow anything.

So R5 as written conflates two different faults: **"wrong"** and **"non-discriminating."** This chapter has to decide whether the rule should reject correct-but-broad values, or only incorrect ones — and if the former, whether the fix is a finer-grained vocabulary rather than a rejected tag.
