# SESSION — Search-First Algolia.com

_Last updated: 2026-08-06 10:20 EDT_

## Status

> **Two sessions run on this repo in parallel (Arijit, 2026-08-06).** This file is the
> **backend/enrichment** lane: `docs/70-enrichment/`, writing to `Algolia_Prod_Copy_Enhanced`.
> The frontend lane owns `docs/50-prototype/demo/`, the WU briefs and Asana state.
> Run `git status` before any `git add -A` — the other lane may have work in flight.

**Backend:** WU-11 opened; two sub-tasks shipped. `Algolia_Prod_Copy_Enhanced` carries an 8-axis
taxonomy, applied live and verified by post-write census. Coverage passes on 5 of 8 axes.

**[87] Index deduplication — DONE 2026-08-06, verified live.** The index is now **12,114 records,
one per distinct URL** (was 16,967). 4,853 duplicates deleted, 224 empty fields rescued. `page_type`
still 100%, all 329 nonprod-only URLs kept, and the demo's own filtered view is unchanged at 7,979
before and after. The restore path was rehearsed before the delete. **Both snapshots were deleted afterwards on
Arijit's instruction (2026-08-06) — there is no rollback to the 16,967 state.** Tool:
`docs/70-enrichment/dedupe.py` + 40 tests. Full write-up: Chapter 2.

⚠ **`distinct: true` / `attributeForDistinct: url` was already configured on this index**, so the
duplicates were never visible in search — `nbHits` and facet counts were already per-URL. Dedup was
done for storage, write amplification and analytics, not to fix results. Do not repeat the earlier
claim that duplicates were inflating facets.

**Precision is still unmeasured — taxonomy conformance + correctness are backend's next jobs.**

**Frontend:** the dead-end crawl (WU-05/WU-10) was found redundant and killed; WU-06/04/05/15
rescoped to read from Enhanced; the demo repointed and verified live in-browser. The actual
research phase (WU-06/06/07/08/09/10) has NOT been executed — **WU-07 is frontend's next job.**

## Resume action

**This file covers two parallel lanes on the same repo. Pick the one you were opened for —
do not default to backend just because it's listed first.**

### If backend/enrichment lane

1. Read this file, then `Projects/Search-First-Algolia-com/index.md` in the vault.
2. **Next is `WU-11.3 — URL liveness census.`** HTTP status for all 12,114 distinct URLs, one
   request each, rate-limited and resumable. `is404` cannot answer it — `False` 8,356 · `True` 24 ·
   **absent 8,587** — and a hand check of 6 URLs found 2 dead. Runs before validation so the
   taxonomy is not measured against records about to be removed.
3. **Then taxonomy conformance, then taxonomy correctness.** Scope in
   `docs/80-documentation/enrichment/chapter-4-enrichment-validation.md`. ⚠ **Re-scope it first —
   two of its figures are known stale:**
   - the corpus is **12,114** records, not 16,967 (the 2026-08-06 dedupe)
   - the blind set is **541**, not 2,262. Of those, ~380 are `doc-sdk`/`doc-api-reference` pages
     that should earn URL rules rather than human labelling, leaving ~161 needing judgement
   - `R1`–`R5` were never defined anywhere. The schema's `contract` block is the real
     specification; number the checks against it and drop the R-names
   - there is **no `validate.py`** and there should not be one file: conformance (machine, pass/fail
     on every record) and correctness (corroboration against independent labellers) are different
     jobs with different outputs
   - **Do not sample.** 71.1% of records are URL-deterministic and their rule table is already
     enumerated (394 patterns, 64 cover 95%).
4. Resolve the two open R5 failures (see *Remaining work*).
5. Then, in order: content enrichment → content validation → full-record validation.

### If frontend/demo lane

1. Read this file, then `Projects/Search-First-Algolia-com/index.md` in the vault, then
   `docs/briefs/README.md` (session entry protocol) and `docs/briefs/WU-07.md`.
2. **Run WU-07** — IA taxonomy, intent matrix, page-role classification. Rescoped 2026-08-06 to
   read from `Algolia_Prod_Copy_Enhanced`, not the deleted crawl. Faster than originally scoped —
   Chapter 1's taxonomy (backend lane) already covers page_type/product/feature/solution; this
   unit still owes audience/CTA extraction, the nav-vs-search-source resolution, and the
   must-preserve URL list.
3. WU-07 directly unblocks **WU-08** (the nav→search mapping exercise, shrunk to 3 new axes —
   intent/audience/conversion_action) and **WU-16**. WU-06, WU-12, WU-13 are also ready if
   preferred — see `Projects/Search-First-Algolia-com/tasks.md` for the full ready list.
4. The demo itself (`docs/50-prototype/demo/`) needs no further fix right now — verified working
   2026-08-06 against `Algolia_Prod_Copy_Enhanced`. Revisit only once WU-07/05/14/15 produce new
   facets or ranking signals to wire in.

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
| Scope | All records, all languages, all environment values, enriched equally (16,967 at the time of the taxonomy write; 12,114 after dedupe) |
| Topology | In-place during build phase. Staging + atomic move was designed and documented, deliberately not used yet. |
| Docs platform | **Not Mintlify** — its search competes with Algolia's DocSearch and there is no audience. Markdown in the repo; Docusaurus + Algolia DocSearch if a site is ever needed. |
| Repo visibility | **PUBLIC**, confirmed by Arijit after being flagged |

## Remaining work

**Immediate — Chapter 4, taxonomy validation**

- `validate.py` does not exist. Coverage is proven; correctness is not.
- **R5 fails on two values.** `industry='ecommerce'` 72.3% and `product='ai-search'` 40.4%. The
  ecommerce case is *factually correct* — 764 of 773 tags come from Algolia's own authored
  keywords — but non-discriminating. The rule conflates "wrong" with "useless for narrowing".
  Decide whether R5 should reject correct-but-broad values.
- **A ceiling is already measured, so do not chase 90%:** the two independent labellers agree on
  `product` only **52.2%** of the time (`industry` 79.0%) across 900 shared URLs.

**Then — Chapter 3, content enrichment**

- Three axes short of target and the cause is measured: **no body field**, 526 chars/record
  (re-measured after dedupe; was 437 over 16,967 records).
- 51.8% of the 12,114 distinct URLs already have a body in **three live indices in the same
  Algolia app** — zero fetching, three API reads. Gap: 5,838 URLs.
  Re-measured 2026-08-06 after the local corpus files were deleted: `SEARCHFIRST_WWW_v1` 3,775 ·
  `algolia-central_enterprise_ledger` 3,302 · `AC2_WWW_MULTI_NEURAL_body` 3,037 · union 6,274.
  The deleted local corpora were fully redundant, so coverage is unchanged.
- Rejected, do not revisit: remapping enterprise_ledger's `/old-docs/` onto `/doc/`.

**Then** — content validation, then combined full-record validation. Arijit's standing rule for
all of it: **no sampling**, loop one record at a time, deterministic and predictable.

**Corrections owed**

- `docs/agents/algolia-com-index-audit.md` §0 claims Website records carry ~2,096-char bodies.
  That is **79 Greenhouse job ads**; the real median is 73 chars. **Eight agent prompts were
  written on that false premise and need review.** Same doc: "12,114 records" is the distinct-URL
  count; the record count was 16,967 and is **12,114 as of the 2026-08-06 dedupe** — the two numbers
  have converged, one record per distinct URL.
- **Add a staleness check to `build_schema.py`** (~20 lines). This REPLACES the earlier "name a
  schema owner" ask, which was withdrawn 2026-08-06 as ceremony standing in for a missing check.
  Reasoning: `classify.py` already hard-fails on an unmatched URL and the candidate queue already
  captures unknown values, so **additions** are covered. Neither catches **retirements** — a
  vocabulary value still in the schema that no longer exists on the site. That is exactly how the
  ledger ended up shipping `App Search` and `DocSearch` as current product names. The check
  re-derives the six URL-derived vocabularies from the live sitemap and fails loudly on any schema
  value the site no longer has. Runs on every schema build; no schedule, nobody has to remember.

**Nothing is pending on the backend lane.** Sales/SC interviews (WU-14) belong to the
**frontend lane** — they feed WU-15's case-against and block nothing in WU-11. The schema-owner
ask is withdrawn (see the staleness check above).

**Looker report supplied 2026-08-06:**
https://datastudio.google.com/u/0/reporting/b05b44b9-43bd-436b-8dd3-c92729a93a93/page/p_88bw2x7jxc
Needs an authenticated Google session — not fetchable with curl/WebFetch. Feeds WU-09; pull
subtask `[75]` organic entrances by page type first. See memory `looker-analytics-report`.

**Credential exposure — CLOSED by decision (Arijit, 2026-08-06).** The Asana OAuth client secret
(08-05) and the Asana PAT (08-06) were both pasted into chat transcripts. Arijit's call: not
revoking, this is a solo development workspace. Recorded as a decision, not an open action — do
not re-raise. Both live only in local transcripts and in `.env.asana` (mode 600, gitignored,
never committed); neither is in the public repo.

**Unblocked 2026-08-06** — ✅ **CORRECTION: the Asana PAT was NEVER dead.** Every earlier "401"
was a **duplicated `2/` prefix** in the stored value (`2/2/<gid>/<hash>` — an Asana PAT has exactly
three `/`-segments). Asana answers a malformed token with a bare `Not Authorized`, identical to
revocation. Fixed in `.env.asana` and verified live. **Check the segment count before ever assuming
a token is revoked.** `start_on` **does** persist via REST — the MCP silently discards it, which is
why this project has never had a Gantt. MCP also cannot create sections or reorder tasks.
VPS SSH works: `chowmes`, Ubuntu 24.04.4, connect via
`~/.claude/skills/hostinger-vps-ssh/scripts/ssh-hermes-vps --env "$PWD/.env.vps"`. Caddy runs as a
Docker container; static sites live at `/data/sites/<name>`, Caddyfile at
`/home/chowmesadmin/lab-judge/Caddyfile`. `contentengagement.info` is already wired up. WU-24 is
no longer blocked.

## Reference files

| Thing | Path |
|---|---|
| Pipeline | `docs/70-enrichment/{build_schema.py, classify.py, apply_taxonomy.py}` |
| Schema (the data) | `docs/70-enrichment/taxonomy-schema.algolia-com.json` |
| Assignments | `docs/70-enrichment/taxonomy-assignments.jsonl` (12,114 rows, gitignored) |
| Pre-state dump | `docs/70-enrichment/enhanced-pre-taxonomy-20260805.jsonl` (gitignored) |
| ⚠ Deleted 2026-08-06 | `docs/50-prototype/corpus/records*.jsonl` — gone from disk and git history. Redundant with the live indices; body coverage is unaffected. |
| Documentation | `docs/80-documentation/` — Book 1 Enrichment, Ch.1 complete |
| Asana | WU-11 `1217210533022462` · `[87]` `1217210602718821` · docs tree `1217211372481002` |
| Index (live) | `Algolia_Prod_Copy_Enhanced` |
| Rollback | **none — both snapshots deleted 2026-08-06 after verification** |
| GitHub (PUBLIC) | `arijitchowdhury80/content-engagement` @ `e49ca6b` |
| Demo (frontend lane — VERIFIED 2026-08-06) | `docs/50-prototype/demo/` — confirmed live in-browser against `Algolia_Prod_Copy_Enhanced`: real queries, facets, snippets, zero console errors. Committed `2a882c3`. |

## What has NOT been done

- **Precision has not been measured.** This session proved that fields are *populated*, not that
  values are *correct*. Do not describe the taxonomy as validated.
- `validate.py` does not exist.
- Staging + atomic move is designed and documented but **was not used** — writes went in-place.
- Content enrichment: not started. No body field exists on the index.
- All 25 original work units: untouched by this session.
- The `audience` axis was deliberately dropped, not built.
- `records.jsonl` was removed from public git history by the parallel session; it is also gone from disk.
- **Frontend lane, 2026-08-06:** WU-06, WU-09, WU-12, WU-13, WU-14, WU-15 (the research phase)
  are still not executed — tonight's frontend work was scope correction (killing the dead
  crawl, rescoping WU-07/05/15, fixing the demo), not the research deliverables themselves.
  Recommended next: **WU-07** (unblocks WU-08's mapping exercise and WU-16).
- **New blocker:** real query-log access to the actual production search app (`1QDAWL72TQ`,
  `ALGOLIA_WWW_PROD_V2`) — needed to ground WU-08's 3 remaining axes in real behavior instead
  of guessing. Ask Arijit.
- ~~Asana PAT dead~~ **RESOLVED 2026-08-06** — never dead; the stored value had a duplicated `2/`
  prefix. Fixed and verified live. REST writes work.

## Files written this session

**Code** — `docs/70-enrichment/build_schema.py`, `classify.py`, `apply_taxonomy.py`,
`taxonomy-schema.algolia-com.json`, `taxonomy-assignments.jsonl`, `candidates.jsonl` (empty),
`enhanced-pre-taxonomy-20260805.jsonl`

**Documentation** — `docs/80-documentation/README.md`,
`enrichment/chapter-1-taxonomy-enrichment.md` (226 lines),
`enrichment/chapter-3-content-enrichment.md`, `enrichment/chapter-4-enrichment-validation.md`

**Vault** — `Projects/Search-First-Algolia-com/{index.md, log.md, tasks.md}`, `wiki/log.md`,
`wiki/hot.md`

**Asana** — WU-11 + `[87]`; `Create Project Documentation` → `Enrichment documentation` →
3 chapters + 8 section subtasks under Chapter 1

**Live index** — `Algolia_Prod_Copy_Enhanced` (11 new fields on 16,967 records, facet config),
snapshot `Algolia_Prod_Copy_Enhanced_pre_taxonomy_20260805`
