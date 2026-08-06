# SESSION — Search-First Algolia.com

_Last updated: 2026-08-06 00:40 EDT_

## Status

> **Two sessions run on this repo in parallel (Arijit, 2026-08-06).** This file is the
> **backend/enrichment** lane: `docs/60-enrichment/`, writing to `Algolia_Prod_Copy_Enhanced`.
> The frontend lane owns `docs/50-prototype/demo/`, the WU briefs and Asana state.
> Run `git status` before any `git add -A` — the other lane may have work in flight.

**WU-26 opened and its first sub-task shipped.** `Algolia_Prod_Copy_Enhanced` (16,967 records)
now carries an 8-axis taxonomy, applied live and verified by post-write census. Coverage passes
on 5 of 8 axes. **Precision is unmeasured** — that is the next job. The demo track was untouched
this session; it remains at 6 of 25 work units, acceptance criteria 2 met · 2 partial · 3 not met.

## Resume action

1. Read this file, then `Projects/Search-First-Algolia-com/index.md` in the vault.
2. **Write `docs/60-enrichment/validate.py`** — taxonomy validation. Scope is already written in
   `docs/70-documentation/enrichment/chapter-3-enrichment-validation.md`:
   - Cross-check assignments against the **2,198 URLs that already carry independent labels**
     (1,263 from `algolia-central_enterprise_ledger`, 1,440 from the six-axis prototype, 900 from
     both). Agreement → confidence. Disagreement → the review queue.
   - Measure precision on the **2,262-URL blind set** (Blog 1,265, Resources 554, Website 443).
   - Run R1–R5 per axis; report the candidate queue.
   - **Do not sample.** 71.1% of records are URL-deterministic and their rule table is already
     enumerated (394 patterns, 64 cover 95%).
3. Resolve the two open R5 failures (see *Remaining work*).
4. Then, in order: content enrichment → content validation → full-record validation.

## Where we stopped (exact)

The last operation was a full live census of `Algolia_Prod_Copy_Enhanced` confirming the write
landed: 16,967 records, `page_type` 100%, 0 nulls, 0 duplicate array values. Then the Asana
documentation tree and the four documentation files were written, then the git push was verified
in sync at `e49ca6b`. Nothing was left half-finished.

## Decisions locked

| Decision | Choice |
|---|---|
| Axes | **8** — `product`, `feature`, `solution`, `industry`, `customer`, `language_platform`, `integration_platform`, `page_type` |
| Dropped axes | `intent` (a pure lookup on `page_type`, adds no information), `audience` (regex guessing — rebuild later, do not inherit) |
| Cardinality | **One ordered array per tag axis**, element 0 = primary by contract. Not a `primary` + `_all` pair. `page_type` single. |
| Empty states | **Three** — resolved / not-applicable (field omitted) / undetermined (`"unknown"`) |
| Applicability | Per axis as a function of `page_type`: **required / opportunistic / not-applicable**, derived from a measured resolution matrix |
| Signals | URL path → legacy field → locale twin → text match, with provenance recorded per axis |
| Vocabularies | From algolia.com's own IA; the site wins over the ledger on conflict |
| Write mode | **Full-record replace** (`updateObject`). `partialUpdateObject` cannot remove an attribute. |
| Packaging | Schema-as-data + generic engine — a new corpus means a new JSON, not new code |
| Scope | All 16,967 records, all languages, all environment snapshots, enriched equally |
| Topology | In-place during build phase. Staging + atomic move was designed and documented, deliberately not used yet. |
| Docs platform | **Not Mintlify** — its search competes with Algolia's DocSearch and there is no audience. Markdown in the repo; Docusaurus + Algolia DocSearch if a site is ever needed. |
| Repo visibility | **PUBLIC**, confirmed by Arijit after being flagged |

## Remaining work

**Immediate — Chapter 3, taxonomy validation**

- `validate.py` does not exist. Coverage is proven; correctness is not.
- **R5 fails on two values.** `industry='ecommerce'` 72.3% and `product='ai-search'` 40.4%. The
  ecommerce case is *factually correct* — 764 of 773 tags come from Algolia's own authored
  keywords — but non-discriminating. The rule conflates "wrong" with "useless for narrowing".
  Decide whether R5 should reject correct-but-broad values.
- **A ceiling is already measured, so do not chase 90%:** the two independent labellers agree on
  `product` only **52.2%** of the time (`industry` 79.0%) across 900 shared URLs.

**Then — Chapter 2, content enrichment**

- Three axes short of target and the cause is measured: **no body field**, 419 chars/record.
- 51.8% of the 12,114 distinct URLs already have a body in other indices in the same app or in
  local corpus files — **zero fetching**. Gap: 5,838 URLs.
- Rejected, do not revisit: remapping enterprise_ledger's `/old-docs/` onto `/doc/`.

**Then** — content validation, then combined full-record validation. Arijit's standing rule for
all of it: **no sampling**, loop one record at a time, deterministic and predictable.

**Corrections owed**

- `docs/agents/algolia-com-index-audit.md` §0 claims Website records carry ~2,096-char bodies.
  That is **79 Greenhouse job ads**; the real median is 73 chars. **Eight agent prompts were
  written on that false premise and need review.** Same doc: "12,114 records" is the distinct-URL
  count; the record count is 16,967.
- Name an owner for `taxonomy-schema.algolia-com.json`, or the vocabulary rots exactly as the
  ledger's did (it still carries the retired names App Search and DocSearch).

**Still open from prior sessions** — Asana PAT (Gantt/sections/custom fields), VPS SSH (WU-19 →
WU-20 → criteria 3 and 6), GA/Looker export (WU-06 → WU-10), Sales/SC interviews (WU-09), and
⚠ resetting the Asana OAuth client secret pasted into chat 2026-08-05.

## Reference files

| Thing | Path |
|---|---|
| Pipeline | `docs/60-enrichment/{build_schema.py, classify.py, apply_taxonomy.py}` |
| Schema (the data) | `docs/60-enrichment/taxonomy-schema.algolia-com.json` |
| Assignments | `docs/60-enrichment/taxonomy-assignments.jsonl` (12,114 rows, gitignored) |
| Pre-state dump | `docs/60-enrichment/enhanced-pre-taxonomy-20260805.jsonl` (gitignored) |
| ⚠ Deleted 2026-08-06 | `docs/50-prototype/corpus/records*.jsonl` — gone from disk and git history. Redundant with the live indices; body coverage is unaffected. |
| Documentation | `docs/70-documentation/` — Book 1 Enrichment, Ch.1 complete |
| Asana | WU-26 `1217210533022462` · `[87]` `1217210602718821` · docs tree `1217211372481002` |
| Index (live) | `Algolia_Prod_Copy_Enhanced` |
| Rollback | `Algolia_Prod_Copy_Enhanced_pre_taxonomy_20260805` |
| GitHub (PUBLIC) | `arijitchowdhury80/content-engagement` @ `e49ca6b` |
| Demo (other session's lane) | `docs/50-prototype/demo/` — now points at `Algolia_Prod_Copy_Enhanced`, not `SEARCHFIRST_WWW_v1` |

## What has NOT been done

- **Precision has not been measured.** This session proved that fields are *populated*, not that
  values are *correct*. Do not describe the taxonomy as validated.
- `validate.py` does not exist.
- Staging + atomic move is designed and documented but **was not used** — writes went in-place.
- Content enrichment: not started. No body field exists on the index.
- All 25 original work units: untouched by this session.
- The `audience` axis was deliberately dropped, not built.
- `records.jsonl` was removed from public git history by the parallel session; it is also gone from disk.

## Files written this session

**Code** — `docs/60-enrichment/build_schema.py`, `classify.py`, `apply_taxonomy.py`,
`taxonomy-schema.algolia-com.json`, `taxonomy-assignments.jsonl`, `candidates.jsonl` (empty),
`enhanced-pre-taxonomy-20260805.jsonl`

**Documentation** — `docs/70-documentation/README.md`,
`enrichment/chapter-1-taxonomy-enrichment.md` (226 lines),
`enrichment/chapter-2-content-enrichment.md`, `enrichment/chapter-3-enrichment-validation.md`

**Vault** — `Projects/Search-First-Algolia-com/{index.md, log.md, tasks.md}`, `wiki/log.md`,
`wiki/hot.md`

**Asana** — WU-26 + `[87]`; `Create Project Documentation` → `Enrichment documentation` →
3 chapters + 8 section subtasks under Chapter 1

**Live index** — `Algolia_Prod_Copy_Enhanced` (11 new fields on 16,967 records, facet config),
snapshot `Algolia_Prod_Copy_Enhanced_pre_taxonomy_20260805`
