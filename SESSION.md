# SESSION — Search-First Algolia.com

_Last updated: 2026-08-07 03:30 UTC_

## Target for the next session

**Build the first cut of the UI.** To get there, finish the mapping and research that feeds it.
**Validation is TABLED (Arijit, 2026-08-07)** — taxonomy and dedup are done and that is enough to
build against. Do not start conformance/correctness work.

### Do these, in order

1. **`WU-07` — IA taxonomy, intent matrix, page-role classification.** Brief:
   `docs/briefs/WU-07.md`. Rescoped to read from `Algolia_Prod_Copy_Enhanced`, not the deleted
   crawl. Smaller than originally written: Chapter 1's taxonomy already covers
   `page_type`/`product`/`feature`/`solution`. What it still owes is **audience + CTA extraction,
   the nav-vs-search-source resolution, and the must-preserve URL list.**
2. **`WU-08` — nav→search mapping.** Shrunk to 3 new axes: `intent`, `audience`,
   `conversion_action`. ⚠ Wanted real query logs from `1QDAWL72TQ` / `ALGOLIA_WWW_PROD_V2` and we
   do not have access — decide whether to proceed on judgement and label it, or ask Arijit.
3. **`WU-16` — IA translation + state/component model**, then **`WU-19` — concept architecture**.
4. **Build the UI.** `docs/50-prototype/demo/` already works against Enhanced. The first cut means
   wiring in whatever new facets and ranking signals WU-07/WU-08 produce.

`WU-12` (pattern library), `WU-13` (novelty check) and `WU-06` (overlay teardown) are also ready
and unblocked if a parallel track is wanted.

## State — verified live 2026-08-07

| | |
|---|---|
| `Algolia_Prod_Copy_Enhanced` | **12,114 records**, one per distinct URL. 8-axis taxonomy, `page_type` 100%. This is the index of record. |
| `Algolia_Prod_Copy_Vanilla` | **16,967 records — dedupe NOT applied.** See *Open* below. |
| `SEARCHFIRST_WWW_v1` | **DELETED 2026-08-07**, verified 404. 325 unique bodies rescued first. |
| Demo | `docs/50-prototype/demo/` — verified in a headless browser against Enhanced: real query, facets, results, zero console errors. |
| Asana | Restructured. `WU-01..26` across 7 phase sections + Documentation. **Data enrichment is `WU-11`, in `P1 — Research & data`.** |
| Rollback | **None.** All snapshots deleted on Arijit's instruction. Take a fresh one before any destructive op. |

## Done, and where it is written up

- **Chapter 1 — Taxonomy enrichment.** 8 axes live on every record. Coverage passes on 5 of 8.
  **Precision was never measured** — do not call the taxonomy validated.
- **Chapter 2 — Deduplication.** 16,967 → 12,114. 4,853 deleted, 224 empty fields rescued.
  Demo's filtered view unchanged at 7,979 before and after.
- Both in `docs/80-documentation/enrichment/`. Chapters 3 (content) and 4 (validation) are scoped,
  not started.

## Constraints that will bite you

- **`Algolia_Prod_Copy_Enhanced` has `distinct: true` on `url`.** `nbHits` is the distinct-URL
  count, not the record count. Read index settings before diagnosing any duplicate problem — this
  made a whole plan's premise false on 2026-08-06.
- **Never rebuild Enhanced by copying Vanilla.** It restores 4,853 duplicates *and wipes the
  taxonomy*. Path is copy → `classify.py` → `apply_taxonomy.py` → `dedupe.py`.
- **`body-rescue-searchfirst-20260806.jsonl` is single-copy** (gitignored, 6MB, 325 records). It is
  the only surviving source for those bodies. Chapter 3 should consume it early.
- **No sampling.** Full census, one record at a time, verified against the live surface.
- **Do not tick an Asana checkbox.** Stop at Arijit's gate.
- Repo is **PUBLIC**. Nothing internal, no dumps of task notes — one was pushed on 2026-08-06 and
  had to be scrubbed from history.

## Open

- **Dedupe `Algolia_Prod_Copy_Vanilla` — requested by Arijit, BLOCKED.** The permission guard
  refused the write because CLAUDE.md marks Vanilla off-limits (a colleague's live Agent Studio
  agents query it). Dry-run is clean and identical to Enhanced: 16,967 → 12,114, 4,853 deletions,
  224 rescues. Vanilla also has `distinct:true` on `url`, so its agents already see 12,114 — the
  only visible change is which record is displayed on ~151 URLs. Run with:
  `python3 docs/70-enrichment/dedupe.py --index Algolia_Prod_Copy_Vanilla --out docs/70-enrichment/reports --apply --snapshot`
- **Query-log access** to `1QDAWL72TQ` / `ALGOLIA_WWW_PROD_V2` — needed to ground WU-08's 3 axes in
  real behaviour. Ask Arijit.
- **Looker report** feeds WU-09; needs an authenticated Google session, cannot be curled.
- **`docs/30-models/agent-studio-capability-verdict.md`** exists now; the rest of WU-17's design
  work (WU-17.1–17.7) does not.
- **The duplicate root cause is unknown.** 430 same-environment duplicates were never explained,
  and the cause lives upstream in Vanilla.

## Standing checks

```bash
# every docs/ path cited by an Asana task still exists; exit 1 on a broken link
ASANA_PAT=... python3 docs/70-enrichment/check_artifact_links.py

# 40 tests on the dedupe engine
python3 -m pytest docs/70-enrichment/tests/test_dedupe.py -q
```

## The failure pattern from 2026-08-06/07 — worth reading before you claim anything is done

Four separate times, a claim was written and the reality was never checked on the surface the claim
was about:

1. duplicates diagnosed from the **record count** without reading the index's `distinct` setting —
   the stated problem turned out not to exist
2. a migration reported **PASS** after re-deriving its rename map from already-renamed state, so it
   verified against an empty map
3. `SEARCHFIRST_WWW_v1` documented as deleted for a full day because the deletion was checked
   against the **filesystem**, not the account
4. a chapter-alignment check compared **counts** and passed while every heading disagreed

Same error each time: check a proxy, then report on the thing. Name the surface, query that
surface, quote the output.
