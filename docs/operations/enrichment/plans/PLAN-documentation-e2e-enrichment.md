# Documentation Metadata Audit Plan

## Decision

Documentation is definitive technical material, not an LLM enrichment target. The skill must
**not** generate, repair, judge, or infer `abstract_enriched` or `keyhighlights_enriched` for
any `Documentation` record. Its one permitted deterministic transformation is to copy an
already-approved nonblank `description` verbatim into `abstract_enriched`.

The Documentation work is a deterministic audit of the index metadata already owned by the
record: the eight-axis taxonomy, URL, title, description, language, source, and page type. For
records that pass that audit, it prepares `description -> abstract_enriched` payloads. It never
fetches pages through Scout, calls an LLM, generates highlights, deletes records, or writes
without a separate approval.

## Enforced policy

All twelve Documentation page types route to the `no_abstract` strategy:

| Group | Page types | Records |
|---|---|---:|
| Reference | `doc-sdk`, `doc-api-reference`, `doc-sdk-unified`, `doc-rest-api`, `doc-ui-library` | 3,411 |
| Guides | `doc-guide`, `doc-tool`, `doc-integration`, `doc-framework-integration` | 923 |
| Hubs | `doc-hub`, `doc-changelog`, `doc-glossary` | 3 |
| **Total** | **12** | **4,337** |

`no_abstract` skips inference-client initialization. A Documentation run therefore cannot make a
writer or judge call even if someone invokes `enrich` by mistake. The separate deterministic copy
command is the only path that can prepare Documentation payloads.

## Audit contract

Run the skill command below with a new run ID. Its output lives only in that run folder:

```bash
python3 skills/algolia-data-enrichment/scripts/algolia_enrich.py \
  audit-documentation --workspace . --run-id YYYYMMDD-documentation-metadata-aNN \
  --source-index Algolia_Prod_Copy_Enhanced \
  --target-index Algolia_Prod_Copy_Enhanced_Parallel
```

For every record whose `source` is `Documentation`, the audit checks:

1. `objectID`, `url`, `title`, `description`, `source`, `page_type`, and `language_code` are
   present and non-blank.
2. `language_code` is `en`; a mismatch is a metadata defect, not a reason to infer content.
3. `page_type` resolves through the existing profile map and every Documentation route has the
   enforced `no_abstract` strategy.
4. Each of the twelve page-type counts is reported, so taxonomy drift is visible.
5. Pre-existing `abstract_enriched` or `keyhighlights_enriched` values are listed as **legacy
   fields only**. The audit neither treats them as proof of quality nor edits them.
6. The report explicitly confirms `writer_or_judge_called: false`.

The output is `validation/documentation-metadata-audit.json`. A missing required field, language
mismatch, unknown page type, or non-`no_abstract` Documentation profile exits non-zero.

Before any source slice can be planned, the skill also runs `taxonomy-preflight` against the
versioned Chapter 1 schema. It hard-checks every live record's eight axes: required-axis presence,
ordered-array shape, controlled vocabulary, absence of null/empty values, and matching taxonomy
provenance and confidence keys. This proves **taxonomy conformance**, not the editorial truth of
every tag; the documented sampled review remains the correctness check.

## Deterministic copy contract

After the audit, run `prepare-documentation-copy` under a new run ID. It creates:

- `documentation-copy/payloads.jsonl`: exactly `objectID` and
  `abstract_enriched: [description]` for metadata-complete Documentation records;
- `documentation-copy/human-review-queue.jsonl`: records with missing or invalid metadata;
- `documentation-copy/report.json`: the complete count reconciliation.

It deliberately omits `keyhighlights_enriched`. No technical claim is added, summarized, or
selected from page content. A future write must use this sealed payload artifact and receive a
separate approval; this plan does not authorize it.

## First audit result: 2026-08-11

The first live, read-only audit checked all 4,337 records:

| Check | Result |
|---|---:|
| Taxonomy routes correct | 12 of 12 page types |
| Language mismatch | 0 |
| Writer or judge calls | 0 |
| Legacy enriched records, untouched | 4 |
| Missing required metadata | 29 |
| Missing field on all 29 | `description` |
| Deterministic copy-ready records | 4,308 |
| Copy payload fields | `objectID`, `abstract_enriched` only |
| Eight-axis taxonomy conformance, full live index | 11,928 of 11,928 records; 0 violations |

The metadata audit is **correctly red** until those 29 descriptions are supplied by the
Documentation content owner or an approved deterministic source-of-truth process. The 4,308
complete records are copy-ready, but the 29 gaps must not be fabricated from an LLM response or
silently copied from an arbitrary page sentence.

## Completion criteria

Documentation is complete when a fresh audit reports:

- 4,337 records and the same twelve page types;
- zero missing required fields;
- zero language mismatches;
- zero profiles that permit LLM enrichment;
- zero writer/judge calls;
- 4,337 deterministic copy-ready records after the 29 descriptions are supplied; and
- no source-index, parallel-index, Scout, or model writes before explicit write approval.

The 29 missing descriptions are a content-governance remediation task. They are not candidates
for `abstract_enriched` or `keyhighlights_enriched`.
