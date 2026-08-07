# WU-07 — IA audit, intent matrix, page-role classification

Unit: WU-07 · Covers `[WU-07.1] [WU-07.2] [WU-07.3] [WU-07.4] [WU-07.5]` (+ `[WU-05.2]` as `mega-menu.json`)
Date: 2026-08-05 · Source: WU-05 corpus, 2322 records
Brief: `docs/briefs/WU-07.md` · Asana: `1217199862117010`

Derived artifacts in this directory are **generated**, not hand-authored:
`build_ia_artifacts.py` → `ia-map.json` + `sitemap-inventory.csv`. Re-run it after any
corpus re-crawl. `mega-menu.json` is extracted from the live DOM.

---

## BLUF

algolia.com is an SEO content property with a thin conversion layer bolted on.
**62.6% of pages exist to acquire organic traffic. 6.8% exist to convert.**
99.6% of URLs must stay addressable.

That shape decides the concept's risk profile. A search-led homepage changes how people
*discover* pages; it cannot change the fact that 1454 pages earn their living from Google
landing directly on them. **The SEO objection is therefore not a side risk — it is the
main risk**, and `[WU-07.4]`'s numbers are the reason.

Second finding, unexpected and material: **the documentation is not in the corpus at all.**
1885 `/doc` URLs live behind a sitemap the main sitemap index never references. Developers/
Docs is one of the 8 non-negotiable journeys and there is currently no content to serve it.

---

## `[WU-07.4]` Page role — the numbers that matter

| Role | Pages | Share | What it means |
|---|---|---|---|
| seo-acquisition | 1454 | **62.6%** | blog 1086 + resources 358 + webinars/events. Organic entry points. |
| enablement | 362 | 15.6% | code-exchange 275, playbook 39, developer 47. Post-sale / implementation. |
| trust-building | 340 | 14.6% | press-release 233, customer-story 82, company, trust, partner. |
| conversion | **157** | **6.8%** | product 24, industry 13, solution 12, use-case 11, pricing 5, competitor 7, contact 4, landing 77. |
| utility | 9 | 0.4% | thank-you, oauth-result, 404. |

**`must_preserve` = 2313 of 2322 (99.6%).** Only the 9 utility pages are genuinely disposable.

## `[WU-07.3]` Intent

| Intent | Pages | Share |
|---|---|---|
| learn | 1690 | 72.8% |
| implement | 361 | 15.5% |
| evaluate | 241 | 10.4% |
| buy | 9 | 0.4% |
| compare | 7 | 0.3% |
| apply | 4 | 0.2% |
| troubleshoot | 1 | 0.04% |

Assigned per page-type cluster, not per page — 2322 individual judgments would be noise.
Vocabularies and the full mapping are in `ia-map.json`.

**The distribution is lopsided in a way that matters.** 72.8% of the site serves *learn*,
while *buy*, *compare* and *troubleshoot* — the three intents closest to revenue and
retention — are served by **17 pages combined.** A search experience tuned on content
volume will bury the commercial pages under blog posts. WU-08's facet schema and WU-16's
ranking model both have to correct for this deliberately; relevance-by-default will not.

## `[WU-07.1]` Taxonomy

32 page types after re-typing, zero unclassified. Full counts in `ia-map.json`.
The 57 records the URL classifier could not type resolved to: `playbook` 39,
`trust` 5, `code-exchange` 3, `program` 2, `landing-page` 2, `utility` 2,
`blog-hub` 1, `customer-hub` 1, `partner` 1, `services` 1.

Note `master-list-for-code-exchnage` — the typo is in the live URL, not in this document.

### CTA structure — verified, not assumed

The corpus shows 1729 pages with a "get started" CTA and 561 with "get a demo". That
initially looks like a global header button leaking into the body. It is not. Checking the
CTA's relative position within each page body:

| CTA | n | median position | reading |
|---|---|---|---|
| get a demo | 541 | **0.109** | hero CTA, top of page |
| get started | 1729 | **0.501** | template CTA block, mid/end of content |

Only **72 of 2322 pages carry both.** So the site routes each page type into one of exactly
two conversion actions, and they are near-mutually-exclusive: commercial pages lead with a
demo request, content pages close with a self-serve signup.

98% of pages point at one of two destinations — `dashboard.algolia.com/users/sign_up`
(1686 pages) or `/demorequest` (551 pages).

**Consequence for WU-08:** the "conversion action" axis has an honest cardinality of about
two, not six. Do not invent granularity the site does not have.

## `[WU-07.2]` Repeated IA patterns

Five templates carry the whole site:

1. **Content article** (1454) — H1, body, template signup CTA at ~50% depth. blog + resources.
2. **Commercial pitch** (157) — hero + demo CTA at ~11% depth, social proof, feature grid.
   Products, industries, use-cases, search-solutions, competitor comparisons all share it.
3. **Proof** (340) — customer stories and press releases. Narrative + result claims.
4. **Enablement** (362) — code-exchange, playbook, developer. Task-oriented, step-shaped.
5. **Utility** (9) — forms, redirects, errors.

URL depth is flat: 1892 of 2322 (81.5%) sit at depth 3, 303 at depth 2, 42 at depth 1.
There is no deep hierarchy to flatten — **the site is already shallow. Its problem is
breadth, not depth**, which is the correct framing for the concept: 2322 pages across one
horizontal nav bar, not a deep tree users get lost in.

## `[WU-07.5]` Nav taxonomy vs search-source taxonomy — the tension, and its resolution

**The tension.** The two taxonomies are not different in detail. They are orthogonal.

The nav organises by **buyer frame** — and it does so along *six simultaneous axes*:

| Nav menu | Axis |
|---|---|
| Products | product capability |
| Industries | business context / vertical |
| Use cases | visitor intent / job to be done |
| Department | audience / role |
| Search solutions | integration platform |
| Developers | implementation surface |

The search overlay organises by **source system**: Documentation · Support · Blog ·
Website · Developers · Resources · Academy · Customer Stories.

**The resolution.** The source taxonomy is not a user model — it is an infrastructure
artifact. It exists because Algolia's content physically lives in five separate systems,
and the evidence for that claim is concrete: **three of the eight sources are not on
www at all.** Documentation is at `/doc` (own sitemap, 1885 URLs, unreferenced by the main
index). Support is `support.algolia.com`. Academy is `academy.algolia.com`. The filter
exposes Algolia's CMS boundaries to the visitor and asks them to care.

A buyer does not think *"I want Documentation rather than Resources."* They think
*"does this work for grocery"* or *"how do I do this in React."*

So: **facet on the nav's buyer axes; demote source to metadata.** Concretely —

- The six nav axes become the six WU-08 facet axes. `Department` is already the audience
  axis and `Use cases` is already the intent axis; this is not a new invention, it is the
  nav's own model made filterable instead of positional.
- Source becomes a display badge and a tiebreaker, not a primary filter. Keep it available
  for the one population that does think in sources — developers looking specifically for
  reference docs.
- **This is the strongest structural argument for the whole concept.** The nav needs six
  axes and a horizontal bar can only express one order. A search box expresses all six at
  once. The current mega-menu is not badly designed; it is over-subscribed. That is a
  problem search solves and information architecture cannot.

## Must-preserve destinations

2313 URLs, in `sitemap-inventory.csv` (`must_preserve` column). Plus these off-corpus
destinations the 8 journeys depend on, verified reachable 2026-08-05:

| Destination | Status | Journey |
|---|---|---|
| `dashboard.algolia.com/users/sign_in` | 403 | **Login** |
| `www.algolia.com/doc` | 200 | **Developers/Docs** |
| `support.algolia.com` | 302 | Support |
| `academy.algolia.com` | 302 | Resources (Academy) |
| `trust.algolia.com` | 200 | Trust |
| `changelog.algolia.com` | 200 | Products |
| `status.algolia.com` | 200 | Trust |

**Login is not a page — it is an external app on another subdomain.** It cannot be a search
result. This confirms the WU-16 brief's call that Login and Contact Sales must be persistent
utility links.

---

## Gaps and what this hands downstream

**BLOCKING-ADJACENT — the docs gap.** 1885 `/doc` URLs are absent from the corpus.
Developers/Docs is a non-negotiable journey. Three options, and this is a decision for
Arijit, not for a later unit to quietly pick:
1. Crawl `/doc/sitemap.xml` as a WU-05 follow-on (~1885 pages, ~13 min at the measured
   2.39 pages/sec) and index it alongside www. Makes the journey real.
2. Use the prod subset of `AC2_WWW_MULTI_NEURAL` — but that is only 122 prod records, too
   thin to carry the journey.
3. Scope the Docs journey to "search surfaces the docs entry point" rather than docs
   content. Cheapest, and honest if labelled.

**Recommendation: option 1.** It is 13 minutes of crawl for a journey that is 1 of 8, and
without it acceptance criterion 2 cannot pass.

**To WU-08:** six axes are already named by the nav — capability, vertical, intent,
audience, platform, implementation surface. Conversion-action cardinality is ~2, not 6.
Correct for the 72.8%-learn skew.

**To WU-15 `[WU-15.3]`:** 62.6% seo-acquisition, 1454 pages, is the quantified SEO exposure.
The 6.8% conversion layer is what the redesign actually touches.

**To WU-16:** ranking must deliberately promote the 157 conversion and 17 buy/compare pages
against 1454 content pages. Relevance-by-default will bury them.

**To WU-20:** index www + docs, or state that the Docs journey is scoped down.

## Verification

Run from `docs/`:

```bash
python3 20-research/build_ia_artifacts.py
python3 -c "
import json; d=json.load(open('20-research/ia-map.json'))
print('page types:',len(d['page_types']),'| must-preserve:',d['must_preserve_count'])
print('unclassified:',d['page_types'].get('other',0))
"
python3 -c "
import csv; r=list(csv.DictReader(open('20-research/sitemap-inventory.csv')))
print('rows:',len(r)); print('no role:',sum(1 for x in r if not x['role']))
"
```

Output on 2026-08-05: 2322 rows, 32 page types, 2313 must-preserve, **0 unclassified**.
