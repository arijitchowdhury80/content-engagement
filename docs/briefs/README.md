# Execution briefs — one per work unit

## What lives where

Three artifacts, three jobs, no field duplicated between them.

| Artifact | Owns | Do not put here |
|---|---|---|
| `docs/05-execution-plan.md` | **WHY.** Reasoning, dependencies, critical path, coverage ledger, Asana GID table. | Execution steps. |
| `docs/briefs/WU-NN.md` | **HOW.** Inputs with real paths, method, skill routing, output schema, verify commands, DoD. | Reasoning — link to the plan instead. |
| Asana | **STATUS.** Done/not-done, per-unit progress comments, the human gate. | Method — except in the rich `html_notes` detail view, which may restate the brief's key constraints. See WU-02 for the exemplar. |
| **Vault** `Projects/Search-First-Algolia-com/` | **KNOWLEDGE.** Durable findings that outlive the project: `index.md`, `log.md`, `wiki/`. | Status. |

The plan is SSOT for reasoning. The brief is SSOT for execution. Asana is SSOT for status.
When a brief and the plan disagree about method, the brief wins — the plan was written
before the corpus existed. When they disagree about *why*, the plan wins.

## Session entry protocol

Starting a unit, in this order:

1. Read Asana project `Search-First Algolia.com`
   (`1217199861767750`) → find the lowest-numbered unblocked unit.
2. Read that unit's Asana comments. Prior sessions record findings there; they may
   have already answered part of the unit or changed its scope.
3. Read `docs/briefs/WU-NN.md` — this is the executable brief.
4. Read the plan section for the unit only if the *why* is unclear.
5. Execute. Write artifacts to the paths in the brief.
6. Run the brief's **Verify** block. Paste real output.
7. Post a findings comment to the Asana task. Include counts from disk, not estimates.
8. **Write a vault wiki page** at `Projects/Search-First-Algolia-com/wiki/<topic>.md` and add a
   dated entry to `log.md`. A finding that exists only in an Asana comment is **not recorded** —
   comments are not searchable across projects and do not survive as a wiki.
9. **Stop for review.** Do not tick the Asana checkbox yourself — the gate is Arijit's.

## The CHALLENGE step — do this before writing anything up

Added 2026-08-05 because **two of WU-04's three best findings came from checks that were in no
brief's Method.** This step is not optional and it is where the value has actually come from.

1. **Is this distribution a template artifact rather than real signal?** Test position or
   variance before writing it up. WU-04 nearly published "1729 pages push self-serve signup" —
   a clean, plausible, *wrong* conclusion. Measuring where in the body the CTA sat killed it.
2. **Diff what the source of truth *exposes* against what you actually have. State the delta
   as a number.** This is how the 1885 missing docs pages were found. Every Verify block has
   this blind spot: it audits your own output, so it cannot catch a missing input.
   **WU-02 passed its DoD while covering ~23% of the site.**
3. **What would falsify my headline claim?** Write the answer down even when nothing falsifies it.

## Standing rules for every unit

- **Count from disk, never estimate.** "N records" means you ran `wc -l`.
- **Label derived data.** Anything inferred rather than observed carries a
  `*_source: "derived-*"` field or an explicit sentence. See WU-02's `breadcrumb_source`.
- **A DoD is not met until its Verify block runs clean.** A self-report is not evidence.
- **If a DoD asks for something that does not exist, say so.** WU-02's DoD asked for
  breadcrumbs; algolia.com has none. The answer was to derive and label, not to fabricate.
- **Escalate rather than proceed on partial data** when a blocker bites.

## Unit index

| Unit | Brief | Status | Blocked by |
|---|---|---|---|
| WU-01 Asana project, doc split | — | ✅ done | — |
| WU-02 Crawl algolia.com → corpus | — | ✅ done, awaiting gate | — |
| WU-03 Search overlay teardown | [WU-03](WU-03.md) | ready | — |
| WU-04 IA taxonomy, intent matrix | [WU-04](WU-04.md) | ready | — |
| WU-05 6-axis classification | [WU-05](WU-05.md) | ready after WU-04 | WU-04 |
| WU-06 Analytics analysis | [WU-06](WU-06.md) | **blocked** | Arijit: GA/Looker |
| WU-07 Pattern library | [WU-07](WU-07.md) | ready | — |
| WU-08 Novelty / prior attempts | [WU-08](WU-08.md) | ready | — |
| WU-09 Buyer evidence | [WU-09](WU-09.md) | **blocked** | Arijit: sales/SC |
| WU-10 Feasibility, case-against | [WU-10](WU-10.md) | partial | WU-04, WU-06 |
| WU-11 IA translation, state model | [WU-11](WU-11.md) | ready after WU-05 | WU-05 |
| WU-12 Agent model, Studio capability | [WU-12](WU-12.md) | ready — half answered | WU-05 (soft) |
| WU-13 Threat, latency, governance | [WU-13](WU-13.md) | ready after WU-12 | WU-12 |
| WU-14 Concept architecture | [WU-14](WU-14.md) | — | WU-11, WU-12 |
| WU-15 Build the Algolia index | [WU-15](WU-15.md) | **unblocked 2026-08-05** | WU-05 |
| WU-16 Build Frame 1, CMO wedge | [WU-16](WU-16.md) | — | WU-14, WU-15 |
| WU-17 Build Frame 2, north star | [WU-17](WU-17.md) | — | WU-16 |
| WU-18 Agentic layer | [WU-18](WU-18.md) | — | WU-12 verdict |
| WU-19 Deploy to shareable URL | [WU-19](WU-19.md) | **blocked** | Arijit: VPS SSH |
| WU-20 Journey validation | [WU-20](WU-20.md) | — | WU-19 |
| WU-21 Brief, board, talk track | [WU-21](WU-21.md) | — | WU-20 |

## Facts established so far, that every later unit should reuse

**Corpus (WU-02, verified 2026-08-05):**
`docs/50-prototype/corpus/records.jsonl` — 2323 lines, 2322 `fetch_ok`, 56 MB,
55.6 MB body text, median 23,719 chars/page. 28 page types.
Driver: `docs/50-prototype/crawl_corpus.py` (resumable, `--resume`).
Fields per record: `url, fetch_ok, status_code, title, meta_title, meta_description,
page_type, page_type_source, breadcrumb, breadcrumb_source, cta{text,href,matched},
body, body_chars, chrome_removed_chars, search_overlay_present`.
⚠ `breadcrumb` and `page_type` are **derived from URL path**, not scraped.

**algolia.com facts:**
- Behind Cloudflare but returns 200 to plain curl. No WAF challenge. Stealth path not needed.
- **No `<main>`, no `<nav>`, no breadcrumb markup anywhere.** Content in bare divs.
- The search overlay renders into the DOM of **1738 of 2322 pages (75%)** — already global.
- robots.txt disallows only `/policies/*`.
- English sitemap: `https://www.algolia.com/sitemap-lang.xml`, 2819 URLs, of which
  468 are `/blogaauthorcontainer/author*` CMS artifacts.

**Algolia account (WU-15 blocker cleared 2026-08-05):**
Credentials at `RAG/Algolia-Central-Spectrum/.env.local` —
`ALGOLIA_APP_ID`, `ALGOLIA_ADMIN_API_KEY`, `ALGOLIA_WRITE_API_KEY`.
Verified live: auth OK, 146 indices. **Never print these values.**
- `mode: "neuralSearch"` is live on this app → neural capability is proven, not inferred.
- `AC2_WWW_MULTI_NEURAL` (8353 recs) is **not** reusable as the demo index:
  95% `nonprod20260220`, only 122 prod records, 68% of tagged records are `Doc`,
  and `facets.facet0-5` are 0.6–14% populated and hold blog/docs taxonomy — *not* the 6 axes.

**The 8 non-negotiable journeys** (every frame must serve all 8):
Products · Solutions · Pricing · Developers/Docs · Resources · Customer Stories ·
Contact Sales · Login
