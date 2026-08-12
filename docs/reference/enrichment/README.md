# Search-First Algolia.com — Project Documentation

Living software documentation. Written alongside the work, not after it.

**Asana:** [Create Project Documentation](https://app.asana.com/1/15096140849280/project/1217199861767750/task/1217211372481002) (`1217211372481002`)

## Books

### Book 1 — [Enrichment](./enrichment/)

Turning `Algolia_Prod_Copy_Enhanced` from a metadata catalogue into a filterable index.

Chapters follow execution order, so Deduplication was inserted as Chapter 2 on 2026-08-06 and the
two later chapters shifted down.

| Chapter | Status | Doc |
|---|---|---|
| 1 — Taxonomy Enrichment | **Complete, live** | [chapter-1-taxonomy-enrichment.md](./enrichment/chapter-1-taxonomy-enrichment.md) |
| 2 — Deduplication | **Complete, live** | [chapter-2-deduplication.md](./enrichment/chapter-2-deduplication.md) |
| 3 — Content Enrichment | Not started | [chapter-3-content-enrichment.md](./enrichment/chapter-3-content-enrichment.md) |
| 4 — Enrichment Validation | Not started — next | [chapter-4-enrichment-validation.md](./enrichment/chapter-4-enrichment-validation.md) |

**Index state:** `Algolia_Prod_Copy_Enhanced` holds **12,114 records**, one per distinct URL, as of
Chapter 2. Never rebuild it by copying `Algolia_Prod_Copy_Vanilla` — see Chapter 2 §10.

## Rules for this documentation

**Every number is traceable.** To an artifact on disk or a live API response. No estimate is presented as a measurement. Where something is an estimate, it says so.

**Reversals are documented as carefully as successes.** Chapter 1 records four designs that were built and rejected. Each was caught by a gate, and each teaches more than the version that shipped. A document that records only what worked cannot be trusted, and cannot be learned from.

**State the limits.** Every chapter ends with what it did *not* prove. Chapter 1 proved coverage; it did not prove precision, and says so.

**Write for the person who has to re-run it.** Commands are copy-pasteable. Mechanics that will bite someone (the URL-not-objectID join key, `afterDistinct` on facets, `partialUpdateObject` being unable to remove an attribute) are called out where they matter.
