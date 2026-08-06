# Sample questions — Algolia.com

Source: Gong Assistant call analysis. 8 categories, 5 questions each, ordered by how often they came up in real sales calls. Pricing is the most frequent category overall; competitive is second.

Use these verbatim when testing any agent or search experience. Wording matters: Agent Studio caches completions by exact query text, so a reworded question generates a fresh answer and silently hides whatever is cached against the original.

## 1. Pricing Questions (most frequent overall)
- How does the pricing model work — usage-based, API calls, search volume, or flat fee?
- What's the minimum cost for an annual/committed plan?
- Are AI, recommendations, and personalization included or extra?
- Is autocomplete priced separately from search?
- What's the difference between self-service (Grow) vs. enterprise (Elevate) plans?

## 2. API Questions
- What counts as an API call (keystrokes, filters, page loads)?
- Can customers create/manage their own API keys (e.g., read-only for analytics)?
- Can analytics data be pulled via API into other systems like Salesforce?
- Can rate limiting be applied to control cost/abuse?
- What factors affect API response time?

## 3. Feature Questions
- Can we trial advanced AI features (personalization, AI synonyms, dynamic re-ranking)?
- How does personalization identify and target users?
- Is there conversational/natural-language search ("AI Assistant")?
- How does Neural Search handle synonyms/concepts (e.g., "pants" vs. "trousers")?
- What are "AI Collections" and how do they work?

## 4. Integration Questions
- How does Algolia integrate with platforms like Shopify, Magento, WordPress — plugin vs. custom API work?
- How much dev effort/time does a full implementation take?
- Is it a headless, API-first solution compatible with ERP/PIM/CMS systems?
- Can it provide federated search across multiple data sources (e.g., site + blog)?
- How are existing platform customizations (e.g., Magento) handled?

## 5. Product Questions
- What's included out-of-the-box vs. requiring paid add-ons/configuration?
- How does analytics/event tracking work, and what counts as a "search"?
- Is a free trial available?
- How does the "Recommend" feature work outside of search (e.g., in-cart)?
- Are SSO and custom domains included in the plan?

## 6. Competitive Questions
- Who are Algolia's main competitors (Bloomreach, Searchspring, Coveo, Constructor, Elasticsearch, Typesense)?
- How does Algolia compare to a specific competitor?
- Key differences when evaluating multiple vendors side by side?
- Is Algolia a replacement for a current tool, or can they coexist?
- How does the implementation/support model differ from competitors offering more hands-on coding help?

## 7. Solutioning Questions
- Can non-technical/marketing teams manage search, or is a developer required?
- How customizable is the front end for branding?
- Can multiple content types (products, blog, pages) be unified in one search?
- Can search be tuned for strategic goals like margin or shipping proximity?
- How is personalization handled for logged-in vs. anonymous users, and does it rely on cookies?

## 8. Best Practices Questions
- What's the best practice for out-of-stock items in results?
- Should data use multiple indexes or one combined index?
- Is caching search queries recommended?
- What's the best practice for managing synonyms?
- Should a sandbox app be used for testing?

---

## Frequency ranking (last 6 months, by Gong citation count)

Citation count = number of transcript snippets Gong tagged as supporting that question/theme — a proxy for "how many times asked," not a verified exact tally. Wording in this table differs slightly from the category lists above; both are recorded because Agent Studio caches on exact query text, so the two versions are two different cache keys.

| Rank | Question | Category | Times Cited |
|---|---|---|---|
| 1 | Who are your main competitors? | Competitive | 52 |
| 2 | How does your pricing model work — usage, API calls, volume, or flat fee? | Pricing | 42 |
| 3 | We're also evaluating [Competitor]; what are the key differences? | Competitive | 17 |
| 4 | What counts as an API call (keystroke, filter, page load)? | API | 16 |
| 5 | How does analytics/event tracking work — what counts as a "search"? | Product | 13 |
| 6 | How does personalization work, and how does it identify the user? | Feature | 10 |
| 7 | Can we create/manage our own API keys (e.g., read-only for analytics)? | API | 9 |
| 8 | How does Algolia integrate with our platform (Shopify/Magento/WordPress) — plugin or custom? | Integration | 8 |
| 8 | How customizable is the front-end experience/branding? | Solutioning | 8 |
| 10 | Are AI, recommendations, and personalization included or priced separately? | Pricing | 7 |
| 11 | Can we implement rate limiting on the API? | API | 6 |
| 11 | How much dev effort/time does a full implementation take? | Integration | 6 |
| 11 | Is Algolia headless/API-first, compatible with ERP/PIM/CMS? | Integration | 6 |
| 11 | Are SSO and custom domains included in our plan? | Product | 6 |
| 15 | Do you have conversational search / an "AI Assistant"? | Feature | 5 |
| 15 | How does Neural Search handle synonyms/concepts? | Feature | 5 |
| 15 | Is Algolia a replacement for our current tool, or used together? | Competitive | 5 |
| 15 | Can our non-technical/marketing team manage search? | Solutioning | 5 |
| 19 | What are "AI Collections" and how do they work? | Feature | 4 |
| 19 | Can Algolia provide federated search across multiple data sources? | Integration / Solutioning | 4 |
| 19 | What's included out-of-the-box vs. paid add-on? | Product | 4 |
| 22 | What's the minimum cost for a committed plan? | Pricing | 3 |
| 22 | Can analytics be accessed via API (e.g., for Salesforce)? | API | 3 |
| 22 | What factors affect API response time? | API | 3 |
| 22 | How does Algolia compare to [specific competitor]? | Competitive | 3 |
| 22 | How does your implementation support differ from competitors (Coveo/Bloomreach)? | Competitive | 3 |
| 22 | How can Algolia support strategic goals (margin, shipping proximity)? | Solutioning | 3 |
| 22 | How is personalization handled for logged-in vs. anonymous users/cookies? | Solutioning | 3 |
| 22 | Best practice for handling out-of-stock items? | Best Practices | 3 |
| 22 | Is caching search queries a best practice? | Best Practices | 3 |
| 22 | Best practice for managing synonyms? | Best Practices | 3 |

**No citation count / unranked** (Gong didn't tag repeat occurrences): autocomplete vs. search pricing, self-service vs. enterprise plan pricing, trialing advanced AI features, handling existing platform customizations, free trial availability, the "Recommend" feature for non-search use cases, indexing strategy (multiple vs. single index), sandbox usage for testing.

## Canonical location

**This file is the source of truth for the sample questions.** It replaces the earlier copy in `RAG/Algolia-Central-Spectrum/docs/plans/sample_questions.md`, which is Adobe Spectrum's repo and no longer owns any Algolia.com work.

## Test results against these questions

`Algolia_Generalist` was swept with all 40 verbatim on 2026-08-05 (post-fix): 36 synthesized answers, 0 document-lists, 4 short refusals (2 pricing, 2 competitive — the agent's deliberate refusal rule). Full table and raw records:

- `docs/agents/2026-08-05-sweep40-generalist-results.md`
- `docs/evidence/2026-08-05-sweep40-generalist.jsonl`

Re-run with: `node scripts/spikes/agent-tool-handoff/sweep-sample-questions.mjs <agentId> <questionsFile> <outJsonl>`
