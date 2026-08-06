# Design thinking — both frames

Compressed from the `frontend-builder` 6-question workflow. Inputs came from WU-04/WU-05
rather than being derived here, so this records decisions, not exploration.

## 1. Mental model

**Frame 1 (CMO wedge):** metaphor is *"the homepage I know, but the search box finally
does something."* A CMO must recognise algolia.com in the first second. Hero, nav, social
proof, CTA all stay. Search is promoted from a magnifying-glass icon to the primary
engagement surface *in place*.
**What would confuse them:** removing the nav. Frame 1 keeps it.

**Frame 2 (search-first north star):** metaphor is *"Algolia's own product, applied to
Algolia."* Closer to a command palette than a website. Search IS the navigation.
**What would confuse them:** losing Login and Contact Sales. WU-04 proved Login is an
external 403 app on another subdomain — it can never be a search result. Both frames keep
them as persistent utility links.

## 2. Information architecture — emphasis tiers

| Tier | Frame 1 | Frame 2 |
|---|---|---|
| **Hero** | The search input | The search input |
| **Primary** | Prompt chips · results · the 6 facet axes | Results · facets · direct-hit card |
| **Secondary** | Conventional nav · social proof | Journey rail (the 8 journeys) |
| **Supporting** | Source badge · page-type · result count | Same |

**Tier inflation flagged and avoided:** `source` (Documentation/Blog/Website…) is
Supporting, *not* a primary filter. WU-04 `[17]` established it is an infrastructure
taxonomy, not a user model. It shows as a badge; the six buyer axes are the facets.

## 3. Interaction flow

Three most common actions, all 1 interaction:
1. Type a query → results
2. Click a prompt chip → pre-loaded query
3. Click a journey in the rail → filtered destination

**Happy path:** land → see prompt chips → type or click → direct-hit card if navigational,
faceted results otherwise → click through to the real algolia.com URL.
**No dead ends:** zero-result state offers the 8 journeys and 3 broadened queries.

## 4. Cognitive load budget

Pre-query chunks: search input, prompt chips, journey rail, trust strip = **4**. Under 5. ✅
Post-query: search input, direct-hit (conditional), facets, results, count = **5**. At the
limit. Facets collapse to a drawer on mobile to stay under it.

## 5. Emotional journey

Recognition → curiosity → *"oh, it actually knew what I meant"* → confidence.
The load-bearing moment is the **navigational direct-hit**: typing `pricing` and landing on
`/pricing` instead of 886 results. That single interaction is the entire argument, so it
gets a distinct visual treatment rather than being result #1.

## 6. Pre-mortem

**Tigers**
- *Looks generic-AI.* → Algolia brand tokens (`#003DFF`, Sora display), not default gray.
- *Docs bury commercial pages.* → **Already happened.** Live index put a Salesforce doc above
  `/pricing`. Mitigated with Algolia Rules (navigational best-bets) + `optionalFilters`.
- *Breaks at 375px.* → facets become a drawer; journey rail becomes horizontal scroll.
- *Accessibility.* → real `<main>`, `<nav>`, `<search>` landmarks, `aria-live` on results,
  visible focus rings. The current algolia.com has **none** of these; not repeating that.
- *Empty query looks broken.* → pre-query state is designed, not blank.

**Elephants**
- No real user has seen this. WU-20 is the test; tonight is directional only.
- **Neural search is OFF.** Algolia rejects `mode:neuralSearch` on an index with no event
  history. The demo runs standard ranking. This must be said out loud, not implied.
- The corpus is English-only and ~55% of the real site (www + docs, no de/fr).

## 7. Aesthetic

`theme-clean` base, overridden by **Algolia brand tokens** — the page must look like
algolia.com, not like a generic tool. Sora for display, Inter for body, `#003DFF` primary.
