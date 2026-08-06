---
title: "Chapter 3 — Enrichment Validation"
description: "Proving the values are correct, not merely present."
status: not-started
asana: "Chapter 3 : Enrichment Validation (1217211571015558)"
---

# Chapter 3 — Enrichment Validation

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
| Text-dependent, blind | **2,262 URLs** | Genuine unknown | The only place human labelling pays |

**394 distinct URL patterns exist; 64 cover 95% of records.** The deterministic majority was verified in Chapter 1 by reviewing that table exhaustively — 100.00% coverage, 0 unmatched. That is certainty, not an estimate, and it is already done.

**2,198 URLs already carry independent labels** — 1,263 from `algolia-central_enterprise_ledger`, 1,440 from the six-axis prototype, 900 from both. Free cross-validation with no human effort. Where our classifier agrees with an existing labeller, no review is needed. Where it disagrees, that becomes the review queue: a discovered, bounded set rather than a random draw.

**The blind set is 2,262 URLs** — Blog 1,265, Resources 554, Website 443. This is where hand-labelling earns its keep, and nowhere else.

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

`validate.py`:

- Cross-check assignments against the 2,198 independently-labelled URLs. Agreement → confidence. Disagreement → the review queue.
- Measure precision on the 2,262-URL blind set specifically, not on a corpus-wide sample.
- Run R1–R5 and report per axis.
- Report the candidate queue — values seen but absent from the vocabulary. That queue is the schema's improvement backlog: the system reporting what it does not yet know, rather than silently discarding it. Currently empty.

## Two open gate failures inherited from Chapter 1

R5 rejects any value covering more than 40% of the records where its axis is written. It currently fails on:

- `industry='ecommerce'` at **72.3%**
- `product='ai-search'` at **40.4%**

The `ecommerce` case is the interesting one. **764 of those 773 tags come from Algolia's own authored keywords** on blog and resource posts — only 9 from URL paths. The tag is *factually correct*. It simply does not narrow anything.

So R5 as written conflates two different faults: **"wrong"** and **"non-discriminating."** Chapter 3 has to decide whether the rule should reject correct-but-broad values, or only incorrect ones — and if the former, whether the fix is a finer-grained vocabulary rather than a rejected tag.
