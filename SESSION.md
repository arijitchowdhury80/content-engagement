# SESSION.md — algolia-com

_Updated 2026-08-13 ~01:30. This file is the resume point. Read it first._
_Two lanes run in parallel: the Runtime Contract below is the frontend/Agent-Studio lane (Codex).
The Enrichment section is the backend/corpus lane. Do not overwrite the other lane's section._

## Non-Negotiable Runtime Contract

This contract overrides stale demos, old WIP bundles, and historical notes.

- **Index:** `Algolia_Prod_Copy_Enhanced` is the only permitted chat/retrieval index. `Algolia_Prod_Copy_Vanilla` is obsolete and must never be deployed, copied, or suggested.
- **App and agents:** work only in app `0EXRPAXB56`. The primary chat agent is `www Chat - Orchestrator`; visitor-intelligence agents are `www Person - *`; execution/specialist agents are `www Chat - *`; and the judge layer is distinct answer evaluation: root judge `4479f02f-d5d0-4fce-a875-dafda15de166` with Skeptic `a4c3846b-e538-4c9c-8e39-1bb15a21f2c2`, Referee `c43d7374-801a-4d0f-aa09-ca12830565c3`, and Advocate `f14b8ddf-2285-422c-89e5-180d7fa0b3bf`.
- **Scope:** algolia.com only. Never use, change, validate against, or deploy Spectrum. Never modify production Ask Algolia or its Agent Studio configuration.
- **Jahia test surface:** deploy only to the development Jahia Drift custom-code block at `/sites/www/home/drift/custom-code-block`, then publish its parent `/sites/www/home/drift` with its subtree. This is the shared template block, not a local host HTML file.
- **Current deployment:** published on 2026-08-12 with `data-release="enhanced-local-visual-parity-20260812"`. It uses the Enhanced index, Algolia theme, visitor/person configuration, concierge engagement, specialist routing declarations, judges, and form tool. The chat bundle is versioned as `algolia-chat.js?citationFallback=20260812`; its source-link guard guarantees visible canonical evidence when the model omits Markdown citations. Test URL: `https://tmp-content-eng-algolia.cloud.jahia.com/cms/render/live/en/sites/www/home.html?widgetFinal=20260812`.
- **Deployment discipline:** confirm the target index, app, agent IDs, current live block, before-state, and rollback method before every publish. Read the live JCR block back after publishing and browser-test the actual Jahia page. Do not rely on an old local demo as the deployment source of truth.
- **Status honesty:** the Jahia widget was verified to open and answer a live question with sources. Proactive engagement, visitor intelligence freshness, specialist handoff, judge reliability, and answer-quality superiority each still require their own end-to-end validation; do not claim them complete because their assets/configuration are present. Judge output is diagnostic evidence, never a substitute for source grounding.

## ENRICHMENT LANE — Status (2026-08-13)

**Documentation refreshed and live. Third corpus closed.** Index **11,928 → 9,525**.

| Corpus | Records | What it actually has | Status |
|---|---:|---|---|
| Blog | 2,694 | enriched abstract + highlights | enriched · **no absolute URL, no body** |
| Documentation | 1,934 | body + absolute URL + taxonomy | **refreshed 2026-08-13** |
| Customer Stories | 237 | enriched abstract + highlights (226) | enriched · **no absolute URL, no body** |
| Support | 1,695 | title + desc + absolute URL | untouched |
| Website | 1,123 | title + desc (226 stray enriched) | untouched |
| Developers | 865 | title + desc (2 stray enriched) | untouched |
| Resources | 835 | title + desc (11 stray enriched) | untouched |
| Academy | 142 | title + desc + absolute URL | untouched |

### THE FINDING THAT SHAPES THE NEXT SESSION

**"Done" has meant two incompatible things, and no corpus has both.**
Blog and Customer Stories have enriched abstracts but **relative URLs and zero body**.
Documentation has body and absolute URLs but **no abstracts** (locked no-LLM decision).
Blog is the largest corpus and all 2,694 records still carry relative URLs — the exact class of
problem just fixed for Documentation.

## NEXT TASK (Arijit, 2026-08-13 01:30)

Bring the three closed corpora to ONE consistent, fully-verified standard.

Target for Blog, Customer Stories, Documentation:
taxonomy · title · description · **absolute URL** · **body** · abstract+keyhighlights
(Blog and Customer Stories only — Documentation stays no-LLM).

1. **Blog 2,694** — absolute URLs + body. Currently 0 of 2,694 have either.
2. **Customer Stories 237** — absolute URLs + body. Currently 0 of 237 have either.
3. Re-verify all three against the live index afterwards.

**Arijit: use Teams mode / parallel agents.** Fan out; do not process corpora serially.

⚠️ **Confirm one ambiguity first.** Arijit said "for customer stories and blogs there will not be
an abstract or key highlights" — but they DO have them (2,694 / 226) and Documentation does not.
He most likely meant Documentation. Confirm before acting.

## What this session did

**Documentation refresh, applied and live-verified:**
- Index 11,928 → **9,525** · Documentation 4,337 → **1,934**
- written 1,933 · deleted 2,440 · **all 2,440 quarantined and byte-verified BEFORE deletion**
- title 1,934/1,934 · description 1,927/1,934 · body 1,933/1,934 (avg 8,325 chars, was 0–300)
- absolute URL 1,933/1,934 (**was 0 of 4,337**) · taxonomy violations across all 9,525: **0**

**Root cause:** the corpus was STALE, not duplicated. Captured 2026-07-21; Algolia then rebuilt
its docs on Mintlify, merging per-language SDK pages into single tabbed pages. 57% of stored URLs
no longer resolved. Confirmed two ways within 1.6% — following all 4,337 URLs gave 1,921 live
pages; the site sitemap lists 1,890.

**New modules:** `seed.py` `reconcile.py` `docrefresh.py` `docmerge.py` `docapply.py`
`quarantine.py` `waits.py`. **New commands:** `seed-documentation` `reconcile-documentation`
`fetch-documentation` `build-documentation` `apply-documentation-refresh`.
**376 tests** (257 at session start). Commits `091479d` → `b55913f` (10).

## Eight defects caught, none reached production

Five share one pattern: **absence of information treated as information.**

1. **Scout client discarded 20 of its 23 response fields**, including the `metadata` holding title
   and description. Downstream parsed markdown for them instead — titles were 30/882. Now
   1,934/1,934. *We built a workaround for data we were throwing away.*
2. A url_rule capture group wrote API parameter names (`advancedSyntax`) into `feature`; the merge
   would have **overwritten the correct tag on 90 records**.
3. A full-record replace would have **deleted `abstract` from 4,317 records** — a searchable field.
4. The delete list from the wrong source would have left 8 orphan duplicates.
5. A fast liveness probe recorded blocked requests as dead pages — would have reported 3,580 dead
   against a true 108.
6. `api.py` passed request bodies via argv — broke at ~800kB/batch once bodies existed.
7. 2 records exceeded Algolia's 100kB limit, which rejects the ENTIRE batch.
8. **A fetch failure would have DELETED a live page** (`/doc/onboarding`).

## Open items

- **`feature: unknown` on 592 of 1,934 Documentation records (30.6%)** — slightly worse than
  before (27.1%). Conformance passes because `unknown` is a legal vocabulary value. **Fixable and
  concentrated:** 248 `/doc/libraries/sdk`, 57 `/doc/tools/cli`, 56 `/doc/api-reference/
  api-parameters`, 36 `/doc/rest-api/agent-studio`. Rules already map the OLD per-language method
  paths (`methods/analytics` → analytics, +8 more); the site moved those groups to
  `/doc/libraries/sdk/methods/` and no rule covers the new shape. Mirroring resolves ~131 of 248.
- **`body` is stored but NOT in `searchableAttributes`** — this is the change that turns the
  Documentation work into better Agent Studio answers. Alters ranking index-wide; separate decision.
- 10 Documentation records need human-written descriptions (page genuinely has none).
- 16 taxonomy values marked `unresolved-no-rule`.
- **Academy may have dead links** — a sampled Academy URL returned a WorkRamp "Content Deleted"
  page. Run a liveness census first.
- Stray pilot enrichment: Website 226, Resources 11, Developers 2 — tracked nowhere.
- `solution`/`industry`/`customer` are always empty on Documentation by schema design.

## Index and safety state

- `Algolia_Prod_Copy_Enhanced` — **9,525**
- `Algolia_Prod_Copy_Enhanced_Quarantine` — **2,548** (108 prior + 2,440 retired, byte-verified)
- `Algolia_Prod_Copy_Enhanced_SNAPSHOT_20260813_prerefresh` — **11,928**, full rollback point
- `attributeForDistinct` still `url`; `distinct: true`

## ⚠️ THE SKILL MOVED

`.claude/skills/algolia-data-enrichment/` → **`skills/algolia-data-enrichment/`** (project root):
```bash
python3 skills/algolia-data-enrichment/scripts/algolia_enrich.py <command> --workspace .
```

## Reference files

| Thing | Path |
|---|---|
| **Documentation refresh write-up** | `docs/reference/enrichment/chapter-7-documentation-refresh.md` |
| Blog + Case Study write-up | `docs/reference/enrichment/chapter-6-blog-and-case-study-enrichment.md` |
| Taxonomy chapter | `docs/reference/enrichment/chapter-1-taxonomy-enrichment.md` |
| Run artefacts | `docs/operations/enrichment/runs/20260812-documentation-refresh-a01/` |
| Full-dimension status tool | `.../20260812-documentation-refresh-a01/status.py` |
| Enrichment skill (USE THIS) | `skills/algolia-data-enrichment/` |
| Asana — enrichment SSOT | project `Algolia.com` `1217389830976091`, task 4.1 (4.1.14 now ✅) |

## Operating notes earned this session

- **Build one complete record before launching a bulk run.** 90 minutes of fetching were wasted
  because `health-scout` passed and I read "Scout returns a body" as "the pipeline works".
- **Scout's hosted plan allows 5 concurrent jobs.** Measured: 4 workers → 14 pages/min, 0 errors;
  16 workers → 20 pages/min with 10% failing. More workers buy failures, not speed.
- **Report every dimension, not the two easy to count.** Showing only title/description made
  complete work look half-done. An incomplete report of a complete check is indistinguishable
  from an incomplete check.
- **`unknown` is a legal taxonomy value** — always split real vs `unknown` when reporting coverage.
