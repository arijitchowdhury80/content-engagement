# Sweep — all 40 sample questions, verbatim, vs live `Algolia_Generalist` (2026-08-05)

Agent `40bdd425-1929-46e5-91ff-c95f0d8c85f1`, index `Algolia_Prod_Copy_Vanilla`, post-fix (prompt patch + `is404` filter removal + `hitsPerPage:15` deployed 13:41 EDT).

Questions taken **verbatim** from the 40 bullets in `docs/sample_questions.md`. Verbatim matters: Agent Studio caches completions by exact query text, so rewording silently dodges any cached pre-fix failure. An earlier pass used the 31-row frequency table instead of these 40 bullets — different wording, different cache keys, invalid as a test of this set.

Verdict rule (`scripts/spikes/agent-tool-handoff/sweep-sample-questions.mjs`): `LINK-LIST` = 60%+ of lines carry a link and under 400 chars of unlinked prose. `THIN` = under 250 chars total. Else `SYNTHESIS`.

## Result: 36 SYNTHESIS / 0 LINK-LIST / 4 THIN

**No question in this set returned a document list.** The reported "returns documents instead of synthesised answers" symptom does not reproduce on any of the 40 via the completions API.

All 4 THIN answers are the Generalist's deliberate pricing/competitive refusal rule firing, not a retrieval or synthesis failure. See the open issue below.

| # | Category | Verdict | Answer chars | Prose chars | Hits | Question |
|---|---|---|---|---|---|---|
| 1 | Pricing | SYNTHESIS | 1956 | 1477 | 15 | How does the pricing model work — usage-based, API calls, search volume, or flat fee? |
| 2 | Pricing | THIN | 217 | 217 | 15 | What's the minimum cost for an annual/committed plan? |
| 3 | Pricing | THIN | 244 | 244 | 15 | Are AI, recommendations, and personalization included or extra? |
| 4 | Pricing | SYNTHESIS | 699 | 529 | 15 | Is autocomplete priced separately from search? |
| 5 | Pricing | SYNTHESIS | 1916 | 1709 | 21 | What's the difference between self-service (Grow) vs. enterprise (Elevate) plans? |
| 6 | API | SYNTHESIS | 2144 | 1542 | 15 | What counts as an API call (keystrokes, filters, page loads)? |
| 7 | API | SYNTHESIS | 1692 | 1006 | 15 | Can customers create/manage their own API keys (e.g., read-only for analytics)? |
| 8 | API | SYNTHESIS | 1762 | 1248 | 29 | Can analytics data be pulled via API into other systems like Salesforce? |
| 9 | API | SYNTHESIS | 2929 | 2272 | 15 | Can rate limiting be applied to control cost/abuse? |
| 10 | API | SYNTHESIS | 2721 | 2110 | 36 | What factors affect API response time? |
| 11 | Feature | SYNTHESIS | 2416 | 1911 | 15 | Can we trial advanced AI features (personalization, AI synonyms, dynamic re-ranking)? |
| 12 | Feature | SYNTHESIS | 2476 | 1740 | 15 | How does personalization identify and target users? |
| 13 | Feature | SYNTHESIS | 1450 | 1384 | 15 | Is there conversational/natural-language search ("AI Assistant")? |
| 14 | Feature | SYNTHESIS | 2191 | 1592 | 15 | How does Neural Search handle synonyms/concepts (e.g., "pants" vs. "trousers")? |
| 15 | Feature | SYNTHESIS | 1594 | 1170 | 15 | What are "AI Collections" and how do they work? |
| 16 | Integration | SYNTHESIS | 2677 | 2008 | 15 | How does Algolia integrate with platforms like Shopify, Magento, WordPress — plugin vs. custom API work? |
| 17 | Integration | SYNTHESIS | 1482 | 1205 | 32 | How much dev effort/time does a full implementation take? |
| 18 | Integration | SYNTHESIS | 1688 | 1135 | 30 | Is it a headless, API-first solution compatible with ERP/PIM/CMS systems? |
| 19 | Integration | SYNTHESIS | 2246 | 1208 | 15 | Can it provide federated search across multiple data sources (e.g., site + blog)? |
| 20 | Integration | SYNTHESIS | 2521 | 1726 | 30 | How are existing platform customizations (e.g., Magento) handled? |
| 21 | Product | SYNTHESIS | 2245 | 2144 | 15 | What's included out-of-the-box vs. requiring paid add-ons/configuration? |
| 22 | Product | SYNTHESIS | 3503 | 2799 | 27 | How does analytics/event tracking work, and what counts as a "search"? |
| 23 | Product | SYNTHESIS | 1179 | 737 | 6 | Is a free trial available? |
| 24 | Product | SYNTHESIS | 1706 | 1573 | 15 | How does the "Recommend" feature work outside of search (e.g., in-cart)? |
| 25 | Product | SYNTHESIS | 2056 | 1220 | 15 | Are SSO and custom domains included in the plan? |
| 26 | Competitive | THIN | 147 | 147 | 0 | Who are Algolia's main competitors (Bloomreach, Searchspring, Coveo, Constructor, Elasticsearch, Typesense)? |
| 27 | Competitive | THIN | 168 | 168 | 0 | How does Algolia compare to a specific competitor? |
| 28 | Competitive | SYNTHESIS | 2343 | 1641 | 15 | Key differences when evaluating multiple vendors side by side? |
| 29 | Competitive | SYNTHESIS | 1529 | 978 | 15 | Is Algolia a replacement for a current tool, or can they coexist? |
| 30 | Competitive | SYNTHESIS | 1367 | 1244 | 13 | How does the implementation/support model differ from competitors offering more hands-on coding help? |
| 31 | Solutioning | SYNTHESIS | 1185 | 1182 | 15 | Can non-technical/marketing teams manage search, or is a developer required? |
| 32 | Solutioning | SYNTHESIS | 2569 | 1933 | 29 | How customizable is the front end for branding? |
| 33 | Solutioning | SYNTHESIS | 2404 | 1612 | 15 | Can multiple content types (products, blog, pages) be unified in one search? |
| 34 | Solutioning | SYNTHESIS | 2651 | 1816 | 44 | Can search be tuned for strategic goals like margin or shipping proximity? |
| 35 | Solutioning | SYNTHESIS | 2987 | 2324 | 15 | How is personalization handled for logged-in vs. anonymous users, and does it rely on cookies? |
| 36 | Best Practices | SYNTHESIS | 2892 | 2216 | 15 | What's the best practice for out-of-stock items in results? |
| 37 | Best Practices | SYNTHESIS | 2806 | 2256 | 15 | Should data use multiple indexes or one combined index? |
| 38 | Best Practices | SYNTHESIS | 1380 | 1005 | 15 | Is caching search queries recommended? |
| 39 | Best Practices | SYNTHESIS | 3435 | 2892 | 15 | What's the best practice for managing synonyms? |
| 40 | Best Practices | SYNTHESIS | 1748 | 1477 | 15 | Should a sandbox app be used for testing? |

## The 4 THIN answers, verbatim

**Q2 (Pricing, 15 hits):** What's the minimum cost for an annual/committed plan?

> Pricing and competitive-comparison details aren't something I can speak to accurately. The right next step for specific information on the minimum cost for annual or committed plans is to talk to Algolia's sales team.

**Q3 (Pricing, 15 hits):** Are AI, recommendations, and personalization included or extra?

> Pricing and packaging details for AI, recommendations, and personalization are not something I can speak to accurately. The best next step to get specific information on what is included in different plans is to speak with Algolia's sales team.

**Q26 (Competitive, 0 hits):** Who are Algolia's main competitors (Bloomreach, Searchspring, Coveo, Constructor, Elasticsearch, Typesense)?

> I cannot speak to pricing or competitive-comparison details accurately. The best next step for this information is to talk to Algolia's sales team.

**Q27 (Competitive, 0 hits):** How does Algolia compare to a specific competitor?

> Pricing and competitive-comparison details aren't something I can speak to accurately. The right next step is to talk to Algolia's sales team for a detailed comparison.

## Open issue this sweep surfaced

The refusal rule silently overrides the prompt's own `SEARCH FIRST — NO EXCEPTIONS` rule. Both competitive refusals returned **0 hits** — the agent never called the search tool. The shared grounding file states a negative "must come from having searched and found nothing, never from memory." These two answers come from memory. The two pricing refusals did search (15 hits) and then declined, which is consistent with the rule; the competitive pair is not.

Second-order: pricing and competitive are the **top two most-asked categories** in the Gong data (52 and 42 citations). The most likely question a tester or a real visitor types is the one that gets a one-line deflection. Whether that is correct is a product call, not a bug — but it explains a tester concluding "the agent doesn't answer."

Raw per-question records including full answer text: `docs/evidence/2026-08-05-sweep40-generalist.jsonl`.
