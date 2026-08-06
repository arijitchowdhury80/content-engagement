# Algolia_Prod_Copy_Vanilla — index config + record structure audit (2026-08-05)

Queried live: `Algolia_Prod_Copy_Vanilla` settings/schema, plus `Algolia_Prod_Copy_Enhanced`, `algolia-central_enterprise_ledger`, `AC2_WWW_MULTI_NEURAL`, `AC2_WWW_MULTI_NEURAL_body` for comparison (all same parent app `0EXRPAXB56`).

## 0. Headline finding — CORRECTED 2026-08-05 afternoon: content depth VARIES BY SOURCE

> ⚠️ **The original Section 0 below was WRONG and is retained only as an audit trail.** It claimed the index has no page content at all. That conclusion came from reading `abstract` only, on a sample skewed to the two shallowest sources (`Documentation`, `Academy`). Re-measured against 200 live records per source: `Website` and `Support` records DO carry real page bodies — `Website` in `description` (typical 2,096 chars, up to 11,319), `Support` in both fields (typical 744, up to 6,727). `Website`'s `abstract` is near-empty, which is exactly what produced the false "no content" read.
>
> **Canonical measured table lives in `scripts/agents/_shared_grounding_algolia.md` (§ CONTENT DEPTH VARIES BY SOURCE). That file is the SSOT — do not re-derive these numbers here.**
>
> Consequence: the agents CAN synthesize substantive grounded answers, from `Website` and `Support` bodies. All 8 prompt files were rewritten on this corrected premise and redeployed live. `Documentation`/`Developers`/`Blog`/`Academy` remain genuinely thin (60–160 chars) — for those, titles are the API surface and the agents route/link rather than synthesize.
>
> A second, independent cause of the shallow-answer symptom was the `is404:false` search filter, which silently excluded Documentation records entirely. Removed the same session.

### ~~Original (incorrect) finding — audit trail only~~

~~`Algolia_Prod_Copy_Vanilla` has **no body/content field at all**.~~ Its `searchableAttributes` are `title, abstract, description, tags, keywords, category, url`. The original read of "real records" was:

| Source | Sample abstract length | Sample |
|---|---|---|
| Documentation | 11–103 chars | `"Get started"` (11 chars, for the docs homepage) |
| Academy | **0 chars** | every sampled record — empty abstract |
| Developers | 41–149 chars | `"Technical features: undefined Use cases: "` — looks like a broken/partial scrape |
| Blog | ~191 chars | consistent short meta-description length |

~~This is a **schema-wide fact, not a sampling artifact**~~ — it WAS a sampling artifact: four thin sources sampled, `description` never read, `Website`/`Support` never sampled.

**`Algolia_Prod_Copy_Enhanced` is NOT the fix.** Checked directly: identical schema, identical 12,114 records, abstract still 126 chars on the same sample record. The only settings difference from Vanilla is `semanticSearch.neuralSearchPreset` (`"custom"` vs `"default"`) — a relevance-tuning variant, not a content upgrade.

**AC2 already solved this exact problem.** `AC2_WWW_MULTI_NEURAL` (same parent app) has the identical metadata-only schema as our Vanilla/Enhanced pair. Its `_body` replica (`AC2_WWW_MULTI_NEURAL_body`) adds real fields: `body` (sampled 26,805 chars of actual page text), `crawled_bodyLen`, `h1`, `crawled_metaDescription`, `enriched` flag, `_snippetResult`. That's what a RAG-ready version of this exact kind of website index looks like.

**Consequence for this port — SUPERSEDED, see the correction at the top of Section 0.** The paragraph below was written on the false premise and its conclusion no longer holds; the agents ARE synthesizing grounded answers from `Website`/`Support` bodies as of 2026-08-05 afternoon. Retained as audit trail: with content this thin, `Algolia_Generalist`/`Algolia_Specialist`/`Algolia_Academy` cannot give substantive grounded answers to real product/documentation/technical questions — the corpus literally doesn't contain the answer text, just a title and a one-line blurb. Answers would be either near-useless ("here's a link, I can't tell you more") or, if not carefully prompted, tempted to fabricate beyond the blurb — which breaks this project's 110%-grounded rule. This needs a decision before agent prompts get written: re-ingest/enrich this index with body content (mirroring AC2's `_body` pattern) first, or explicitly scope the agents to be link-surfacing/title-matching only (a much weaker product than what ACS does for Spectrum, which grounds on full page text).

## 1. Index config comparison (the part you asked to optimize)

| Setting | `Algolia_Prod_Copy_Vanilla` (current) | `algolia-central_enterprise_ledger` | `AC2_WWW_MULTI_NEURAL(_body)` | Recommendation |
|---|---|---|---|---|
| `mode` | `neuralSearch` | `neuralSearch` | `neuralSearch` | Keep. |
| `queryType` | `prefixNone` | (n/a, uses `prefixLast` elsewhere) | `prefixLast` | **Change to `prefixLast`** — `prefixNone` disables prefix matching entirely, meaning partial/in-progress queries (agent tool calls often pass sub-phrases) get no prefix expansion. Both comparison indices use `prefixLast`. |
| `customRanking` | `desc(indexed_at)` only | `desc(priority), desc(updated_at), desc(nb_clicks), desc(view_count)` | `desc(published_at)` | **Weak.** Ranking purely by crawl recency, not by any engagement/priority signal. No `nb_clicks`/`view_count`/`priority` field exists in our schema to rank by — this is itself a symptom of the same thin-metadata problem (Section 0), not a settings fix I can make without new fields. |
| `attributesToHighlight`/`attributesToSnippet` | `null`/`null` | highlights `title, summary, content, description`; snippets `content:50, description:50` | snippets `body:60` | **Currently unset — should be set** once/if a content field exists. Right now there's nothing worth snippeting beyond `abstract`/`description`, which are already snippet-length. |
| `removeStopWords` | `["en"]` | `false` | (not set) | Fine as-is — English-only scope (confirmed) makes stopword removal reasonable. |
| `distinct` / `attributeForDistinct` | `true` / `url` | not set | not set (base); base+`_body` pattern uses separate indices instead of distinct | Keep — dedupes the multi-environment/multi-language duplicates already flagged in the port spec. |
| `advancedSyntax` | not set (defaults false) | `true` | not set | Not needed for agent-driven queries (no boolean operator syntax expected from an LLM tool call). Leave off. |
| `synonyms` | 8 generic pairs (`plan/program`, `image/picture`, `human/man`, `tv/video`, `hello/hi`, `role/use`, `agent/agentic`, `cli/command line interface`) | none configured at index level (presumably handled differently) | 7 Algolia-product-specific pairs (`ranking/relevance/sorting results`, `personalization/personalisation`, `documentation/docs`, `vector search/neural search/neuralsearch/semantic search`, `typo tolerance/typing mistakes/typos/misspellings`, etc.) | **Vanilla's synonym set is generic/low-value for this domain** (`hello/hi`, `human/man` do nothing for product questions). `AC2_WWW_MULTI_NEURAL`'s synonym set is the right template — Algolia-product-vocabulary pairs. Recommend replacing Vanilla's synonyms with a domain-relevant set before agent build (e.g. add `API key/API credential`, `index/collection`, `facet/filter`, `crawler/scraper`, matching the real question vocabulary in `sample_questions.md`). |
| `exactOnSingleWordQuery` | `word` | `attribute` | `attribute` | Minor — `attribute` (used by both comparisons) tends to favor exact matches in higher-weighted fields; `word` is looser. Low priority, worth aligning for consistency but not a correctness issue. |
| `attributesForFaceting` | matches `AC2_WWW_MULTI_NEURAL` almost exactly (`source`, `category`, `environment`, `language_code`, `tags`, `authors`, `facets.facet0-5`, `is404`, `transform_source`) | different shape (tag-based: `industry_tag`, `product_tag`, `customer_tag`, etc.) | identical to Vanilla | Already matches the proven `AC2_WWW_MULTI_NEURAL` pattern — no change needed. This is the SAME ingestion pipeline/schema as AC2's site index, confirming both went through the same crawler tooling. |

**Bottom line on config:** most settings already mirror the proven `AC2_WWW_MULTI_NEURAL` pattern (this index was built by the same pipeline). The two real, actionable fixes are `queryType: prefixNone → prefixLast`, and replacing the generic synonym set with domain-relevant pairs. Everything else (ranking signals, highlight/snippet config) is blocked on Section 0's content-depth gap, not a settings change I can make independently.

## 2. Record structure — full field inventory (`Algolia_Prod_Copy_Vanilla`)

12,114 records (pre-distinct; `distinct:true` + `attributeForDistinct:"url"` dedupes at query time across the multi-language/multi-environment duplicates).

**All fields present on every record:**
`objectID, title, abstract, description, url, source, category, tags, keywords, authors, language_code, environment, published_at, lastUpdated, indexed_at, is404, thumbnail, hierarchicalCategories, facets, transform_source, _highlightResult`

| Field | Type | Notes |
|---|---|---|
| `title` | string | Page title, often with `\| Algolia` suffix on some sources |
| `abstract` / `description` | string | **Identical content in every sampled record** — appears to be the same underlying meta-description duplicated into two fields, not two distinct pieces of content. 0–200 chars depending on source. |
| `url` | string | Relative path (`/doc/value-engineering`) or absolute (`https://academy.algolia.com/...`) — inconsistent, locale-prefixed for translated pages (`/de/...`, `/fr/...`) |
| `source` | string | The 8-value facet already used for filter design (Documentation/Blog/Support/Website/Developers/Resources/Customer Stories/Academy) |
| `category` | string | 49-value facet, finer-grained than `source`; **empty string on some Developers records** (seen in sample) |
| `tags` | array | Often empty (`[]`); populated inconsistently — some Developers/Blog records have 1 tag, most don't |
| `keywords` | array | Not observed populated in any sample — likely always empty, unconfirmed at scale |
| `authors` | array | Not observed populated in samples |
| `language_code` | string | `en`/`fr`/`de` — confirmed, drives the English-only filter already in the port spec |
| `environment` | string | The 6-value snapshot facet already resolved to `prod20260722` in the port spec |
| `published_at` / `lastUpdated` / `indexed_at` | timestamp | Crawl/publish metadata |
| `is404` | boolean | Dead-link flag — **not currently filtered out** anywhere in the port spec's proposed agent filters; should be added (`is404:false`) so agents don't surface broken links as sources |
| `thumbnail` | string (path) | Image path, not useful for a text-answering agent |
| `hierarchicalCategories` | object | `{lvl0: [...]}` — only ever populated one level deep in samples (e.g. `["events"]`); not the rich multi-level taxonomy the name implies |
| `facets` | object | `{facet0..facet6}` — sparse, inconsistent (e.g. `facet4: ["Adobe Launch"]`, `facet6: ["InstantSearch"]` on one Developers record, empty `{}` on most others). Looks like a generic extraction slot, not a designed schema. |
| `transform_source` | string | Pipeline provenance tag (e.g. `jnt-page`) — internal, not useful to an agent |

**Depth verdict:** structurally rich-LOOKING (lots of fields), but functionally shallow — the only fields with real natural-language content (`title`, `abstract`/`description`) top out at ~200 characters combined. Everything else is a filter/facet or pipeline metadata.

## 3. What this means for drafting `Algolia_Generalist`/`Algolia_Specialist`/`Algolia_Academy`

- Prompts must NOT be written assuming rich retrieved passages (the way ACS's Spectrum prompts can, since that corpus has full doc/code content). They need to work with title+one-line-blurb+URL as the retrieval unit.
- Realistic answer shape without a content fix: agent identifies the right page(s) by title/category match and tells the user "this page covers X, here's the link" rather than synthesizing a real in-depth answer FROM the content — because there isn't enough content to synthesize from.
- Add `is404:false` to every agent's filter (Section 4 of the port spec doesn't currently include this).
- Recommend fixing the two config items in Section 1 (`prefixLast`, domain synonyms) regardless of the content-depth decision — they're free wins.

## 4. Decisions (Arijit, 2026-08-05)

- **No content enrichment on `Algolia_Prod_Copy_Vanilla`, ever.** That's what the two-index split is for: `Algolia_Prod_Copy_Vanilla` = a vanilla copy of production, config-tunable but content stays as-is. `Algolia_Prod_Copy_Enhanced` = the future home of BOTH config updates and content enrichment. Enrichment is separate future work, scoped to Enhanced only, not part of this build.
- **Agents proceed against `Algolia_Prod_Copy_Vanilla` now**, thin content accepted as a known limitation (Section 3's page-finder/router framing applies) — not blocking the build.
- **Config fixes SKIPPED on `Vanilla`** — Live-checked blast radius: Sajid's 4 `www Chat` agents (Orchestrator, Developer Specialist, Product Specialist, Customer Evidence Specialist) already query that exact index. Changing shared settings would change their live behavior too, which conflicts with the standing "don't touch www Chat" boundary — even applied indirectly via the index instead of their own config. Revisit as a coordinated change with Sajid, not unilaterally.
- **Config fixes APPLIED + verified live on `Algolia_Prod_Copy_Enhanced` (2026-08-05)** — no `www Chat` dependency on this index (confirmed via the same live scan). Applied: `queryType: prefixNone → prefixLast`; synonyms cleared (8 generic pairs removed) and replaced with the 7-pair domain set ported from `AC2_WWW_MULTI_NEURAL`. Verified against actual Algolia task-completion status, not just the initial API response (`clearExistingSynonyms=true` on the batch endpoint did NOT actually clear on first attempt — had to call `/synonyms/clear` explicitly, then re-batch, then poll task status to `published` before trusting the read).
