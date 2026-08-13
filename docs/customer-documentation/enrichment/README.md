# Algolia.com Search Index Enrichment

Customer-facing project documentation for enrichment work on `Algolia_Prod_Copy_Enhanced`.
These chapters explain what changed, why it changed, how it was verified, and what remains open.

**Asana:** [Create Project Documentation](https://app.asana.com/1/15096140849280/project/1217199861767750/task/1217211372481002) (`1217211372481002`)

## Chapters

| Chapter | Status | Doc |
|---|---|---|
| 1 - Taxonomy Enrichment | **Complete, live** | [chapter-1-taxonomy-enrichment.md](./chapter-1-taxonomy-enrichment.md) |
| 2 - Deduplication | **Complete, live** | [chapter-2-deduplication.md](./chapter-2-deduplication.md) |
| 3 - Content Enrichment | In progress history | [chapter-3-content-enrichment.md](./chapter-3-content-enrichment.md) |
| 3b - Build Log | In progress history | [chapter-3-build-log.md](./chapter-3-build-log.md) |
| 4 - Enrichment Validation | Execution record | [chapter-4-enrichment-validation.md](./chapter-4-enrichment-validation.md) |
| 5 - Blog Enrichment Execution | Execution record | [chapter-5-blog-enrichment-execution.md](./chapter-5-blog-enrichment-execution.md) |
| 6 - Blog and Case Study Enrichment | Execution record | [chapter-6-blog-and-case-study-enrichment.md](./chapter-6-blog-and-case-study-enrichment.md) |
| 7 - Documentation Refresh | Complete, live | [chapter-7-documentation-refresh.md](./chapter-7-documentation-refresh.md) |

## Current Enrichment Addendum

**Canonical URL normalization** is tracked as a data-enrichment category because it changes the
retrieval record contract, not agent wording. The deterministic plan and current read-only audit
live at [PLAN-url-normalization.md](../../operations/enrichment/plans/PLAN-url-normalization.md).

Current measured state for that work: `Algolia_Prod_Copy_Enhanced` has **11,928** records,
**10,091** relative `url` values, and **1,837** already-absolute Support/Academy URLs. No mutation
is approved until the script has HTTP-verified all 11,928 rows and produced the approval packet.

## Documentation Rules

**Every number is traceable.** To an artifact on disk or a live API response. No estimate is presented as a measurement. Where something is an estimate, it says so.

**Reversals are documented as carefully as successes.** Chapter 1 records four designs that were built and rejected. Each was caught by a gate, and each teaches more than the version that shipped. A document that records only what worked cannot be trusted, and cannot be learned from.

**State the limits.** Every chapter ends with what it did *not* prove. Chapter 1 proved coverage; it did not prove precision, and says so.

**Write for the person who has to re-run it.** Commands are copy-pasteable. Mechanics that will bite someone (the URL-not-objectID join key, `afterDistinct` on facets, `partialUpdateObject` being unable to remove an attribute) are called out where they matter.
