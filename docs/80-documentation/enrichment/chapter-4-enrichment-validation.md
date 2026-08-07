---
title: "Chapter 4 — Enrichment Validation"
description: "Proving the values are correct, not merely present."
status: not-started
asana: "Chapter 4 : Enrichment Validation (1217211571015558)"
---

# Chapter 4 — Enrichment Validation

> **Status: not started.** This is the immediate next step.

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

## Two open gate failures inherited from Chapter 1

R5 rejects any value covering more than 40% of the records where its axis is written. It currently fails on:

- `industry='ecommerce'` at **72.3%**
- `product='ai-search'` at **40.4%**

The `ecommerce` case is the interesting one. **764 of those 773 tags come from Algolia's own authored keywords** on blog and resource posts — only 9 from URL paths. The tag is *factually correct*. It simply does not narrow anything.

So R5 as written conflates two different faults: **"wrong"** and **"non-discriminating."** This chapter has to decide whether the rule should reject correct-but-broad values, or only incorrect ones — and if the former, whether the fix is a finer-grained vocabulary rather than a rejected tag.
