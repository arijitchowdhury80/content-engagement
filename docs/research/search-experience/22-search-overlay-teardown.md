# 22 — Current search overlay teardown

**WU-06** · captured live from `https://www.algolia.com` on **2026-08-07** · headless Chromium

Every number in this document comes from the overlay's own Algolia API responses, captured
off the wire while driving the live site. Nothing is read off a rendered number and nothing
is inferred. Raw evidence:

| File | What it holds |
|---|---|
| `overlay-observations.json` | the five states, per-state DOM reads |
| `overlay-network.json` | 77 captured search requests + responses |
| `overlay-journeys.json` | the 8-journey probe, ranked results per query |
| `overlay-searchpage.json` | expansion-path and `/search` probe |
| `overlay-zero-persistence-recheck.json` | the correction pass — zero-result and chat persistence, each in a clean context |
| `overlay-annotations.json` | callout coordinates behind the annotated screenshots |
| `screenshots/` | captures, including five `overlay-<state>-annotated.png` |

Scripts that produced them, all read-only and re-runnable:
`overlay_recon.py` · `overlay_teardown.py` · `overlay_journey_probe.py` ·
`overlay_searchpage_probe.py` · `verify_zero_and_persistence.py` · `annotate_overlay_states.py`

**Start with the five annotated screenshots.** Each carries numbered callouts and a legend, and
each is a single element capture of the overlay taken in its own fresh browser context.

---

## 1. The one-line finding

**Algolia's own website already ships a search-led discovery surface — and it cannot
navigate its own site.** Of the 8 journeys the concept is forbidden to break, today's
overlay lands 1 of them at the top of results. Five it cannot reach at all.

That is the case for this project, stated by the current site rather than about it.

---

## 2. What the overlay is, architecturally

Trigger: a single `<button id="globalSearchButton">` labelled **"Search or Ask AI"**, sitting
in the global header. Its markup — filter rail, prompt chips, suggestions, results, chat panel —
is **rendered into the DOM on page load**, before any click. Opening it is a visibility toggle,
not a fetch.

It is built on InstantSearch (`ais-*` class names throughout) and queries **two** indices:

| Index | Role | Called |
|---|---|---|
| `ALGOLIA_WWW_PROD_V2` | the content corpus | on load, and on each keystroke |
| `ALGOLIA_WWW_PROD_query_suggestions` | the "Suggestions" list | twice per keystroke (`hitsPerPage` 8 and 4) |

App ID `1QDAWL72TQ`. Every content query carries the same scope:

```
filters:        language_code:en AND NOT is404:true AND NOT algoliaDisabled:"true"
numericFilters: indexed_at >= 1785988800
facets:         facets.facet0 … facet8, source
hitsPerPage:    3
```

Two consequences worth carrying forward:

- **The overlay is English-only by configuration.** `language_code:en` is hard-filtered. This
  is a live precedent for the multilingual scope question in WU-23.
- **`hitsPerPage` is 3.** See §6 — this is the single most limiting thing about the surface.

### Total searchable corpus

`nbHits` on the empty query: **8,217 records** (en, not-404, not-disabled).

---

## 3. The 8 source filters

Read from `facets.source` in the API response to the empty query, so these are the
unfiltered totals:

| Source | Records | Share | What the label names | Where it lives |
|---|---:|---:|---|---|
| Documentation | 4,337 | 52.8% | a system | `algolia.com/doc` |
| Support | 1,695 | 20.6% | a system | `support.algolia.com` |
| Blog | 938 | 11.4% | a content type | `algolia.com/blog` |
| Website | 457 | 5.6% | **the leftovers** | mixed — see below |
| Developers | 288 | 3.5% | a system | `algolia.com/developers` |
| Resources | 277 | 3.4% | a content type | `algolia.com/resources` |
| Academy | 142 | 1.7% | a system | `academy.algolia.com` |
| Customer Stories | 83 | 1.0% | a content type | `algolia.com/customers` |
| **Total** | **8,217** | 100% | | |

Some of these sit on subdomains rather than `www`. **That is a hosting detail and nothing
more** — it is all Algolia, and a search-first front door sending a visitor to
`support.algolia.com` is a perfectly good outcome. Do not read anything into it.

**The actual problem with this taxonomy is that the eight labels do not describe the same
kind of thing.** Four name a *system* the content happens to be stored in. Three name a
*content type*. And "Website" names whatever was left over — which is not even clean:

> **5 of the 9 "Website" hits captured in this run are `job-boards.greenhouse.io` job
> postings.** Searching `solutions` returns five of them in the top five (§7). A recruiting
> ATS is filed under the same label as `/products` and `/pricing`.

This is what WU-07 [WU-07.5] meant by an infrastructure taxonomy rather than a user model.
Nobody browsing for a solution thinks "I want the Website bucket." The exact share of
`Website` that is Greenhouse was **not measured** — the index exposes no host facet — so it
is an observation from 9 captured hits, not a census.

Documentation alone is more than half the corpus, and Documentation + Support together are
**73.4%**. Any relevance behaviour on this index is dominated by technical content unless
something actively counteracts it. Nothing does — see §7.

---

## 4. The five states

### 4.1 Pre-query — `screenshots/overlay-pre-query-annotated.png`

Opens onto a populated panel, not an empty box. Three sections:

- **Filter by source** — the 8 facets above, with counts, left rail
- **Suggestions** — 4 generic entries: *Algolia API integration · Algolia search benefits ·
  Algolia scalability · AI search for ecommerce*
- **Products & Resources** — 3 default hits (`/products/ai-search`, `/events`,
  `/distributed-secure/security-compliance`)

Plus 4 AI-mode prompt chips:

> How will Algolia improve our search experience and conversions?
> How do I integrate Algolia search into my app?
> Can Algolia help shoppers find products faster and increase sales?
> Will Algolia scale with our traffic and data size?

All four are **vendor-voiced sales questions**, not things a visitor arrives wanting to ask.
Note what is absent: no recent searches, no popular searches, no personalisation, no entry
point per journey.

### 4.2 Autocomplete — `screenshots/overlay-autocomplete-annotated.png`

Query-as-you-type against both indices. Results and facet counts update per keystroke, and
the Suggestions list switches from generic to query-derived
(`ecommerce search solutions`, `ecommerce site search and discovery`, …).

**A defect surfaces here.** Typing four characters, `ecom`:

| | Records returned | Total in that source |
|---|---:|---:|
| Support | 1,695 | 1,695 — **all of them** |
| Academy | 142 | 142 — **all of them** |
| Website | 83 | 457 |
| Documentation | 13 | 4,337 |
| Blog | 5 | 938 |
| Customer Stories | 2 | 83 |
| Resources | 2 | 277 |
| **Total** | **1,942** | |

Every single Support and Academy record matches a four-character prefix — **1,837 of 1,942
results, 94.6%, are two sources matching in their entirety.** The user sees "1942 results"
and believes it is a corpus signal. It is not. At the full query `ecommerce search` the same
two sources drop to 10 and 5, so this is specific to short queries — that is, to the state
the user is in while typing, which is most of the time.

Mechanism not established; it needs someone with index access to look at the searchable
attributes on those two sources. Recorded here as an observation, not a diagnosis.

### 4.3 Post-query — `screenshots/overlay-post-query-annotated.png`

`ecommerce search` → **371 results**, facets recomputed
(Blog 118 · Documentation 70 · Website 65 · Customer Stories 50 · Resources 40 ·
Developers 13 · Support 10 · Academy 5 — sums to 371).

Three hits shown.

### 4.4 AI mode — `screenshots/overlay-ai-mode-annotated.png`

**The trigger is Enter, not the toggle.** This was mis-stated in the first draft of this
document and is corrected here. Typing filters results live. **Pressing Enter submits the query
to Algolia Assist**, in a fresh browser context that has never touched the ✨ AI mode button —
verified in `overlay-zero-persistence-recheck.json` §A, where `chat_view_visible` and
`assist_transcript` are both true with no toggle click anywhere in the run. The ✨ AI mode
button is the entry point from the *empty* state, where the prompt chips live; it is not the
only way in.

So the current product is **already a hybrid**: one Enter gives you a ranked result list and a
generated answer, side by side. That is a much stronger precedent for this project than "there
is an AI button somewhere."

The chat view (`agentic-search-chat-mode`) appears **below** the results rather than replacing
them, branded **Algolia Assist**, with **New chat** and **Back to results** controls, an input
reading *"Ask anything about Algolia,"* and copy / regenerate / thumbs controls on each answer.

The answer for `ecommerce search` ran to 2,818 characters, streamed, and was **generative and
uncited**. The only links in the panel were a footer *"AI powered by Algolia"* pointing at
`/products/ai/agent-studio` and a `javascript:void(0)` anchor. **No source attribution, no
citations, no links back into the 371 results sitting directly above it.** The retrieval layer
and the answer layer are on the same screen and are not connected to each other. That is the
single clearest gap for Ask 2 to close.

**Chat persistence: unresolved.** A same-context reload after a short chat showed no transcript
(`B_after_reload_same_context`), but a later run in which the answer had fully streamed *did*
carry the transcript across a navigation, and a `algolia.agenticChat.v1` localStorage key is
written. The two observations disagree and the rule was not established. Do not cite either way
without re-testing.

### 4.5 Zero-result — `screenshots/overlay-zero-result-annotated.png`

> **Corrected 2026-08-07.** The first capture of this state ran in a browser context that had
> already used AI mode, and the leftover chat made this section wrong in two ways. It was
> re-tested in a fresh context (`overlay-zero-persistence-recheck.json` §A) and rewritten. The
> original claim — "no way back, the most exposed state on the site" — was **too harsh and is
> withdrawn**.

`zzqqxwvplump` → **"No results"**, twice, and:

- 0 hits
- **the filter rail empties** — the `FILTER BY SOURCE` heading stays, 0 facet items beneath it,
  the left column goes blank. Confirmed in the clean context (`facet_items: 0`).
- "Show more results" disappears
- Suggestions revert to the 4 generic entries — **unrelated to what was typed**
- **no** AI prompt chips (`ai_prompts: 0` — the chips seen in the contaminated capture were
  left over from the prior state)

**But the state is not a dead end, and that matters.** Because Enter routes to Algolia Assist
(§4.4), the failed query is simultaneously answered by the AI, which replies:

> *"I'm not sure what you're looking for with 'zzqqxwvplump.' Could you please clarify what
> you'd like to know about Algolia? For example, are you interested in: How Algolia's search
> works · Pricing and plans · Integration with your platform · A specific use case · Something
> else?"*

That is a real recovery affordance, and it is arguably better than a did-you-mean, because it
re-routes on *intent* rather than on spelling.

What is genuinely missing is the **keyword-search** half: no did-you-mean, no spelling
correction, no query relaxation, no popular-searches fallback, and a facet rail that blanks
instead of degrading. The honest reading is that **the AI layer is already carrying the
zero-result state on its own, and the search layer contributes nothing to it.**

---

## 5. Result anatomy

Each hit is `.agentic-search-hit`, composed of exactly four parts:

| Part | Content |
|---|---|
| `__thumb` | thumbnail image |
| `__title` | page title, `\| Algolia` suffix left intact where present |
| `__meta` | `Source • category` |
| `__cta` | `Learn more →` on every result, regardless of what it is |

**Grouping: none.** Results are a flat list. Source is a filter in the rail, never a grouping
of the results. Nothing clusters by product, journey, or intent.

**Breadcrumb: no — and the substitute is broken.** The brief asked specifically whether the
overlay synthesises a breadcrumb, since the pages themselves have no breadcrumb markup. It does
not. What it renders instead is a two-token `Source • category` line, which degenerates for
several sources:

- `Blog • Blog`
- `Resources • Resources`
- `Documentation` (one token, second is empty)
- `Academy • Algolia Certified Advanced Business User (ACABU)` (a certification name, in a slot
  a visitor reads as a location)

So the label meant to tell you *where a result lives* frequently tells you nothing, repeats
itself, or names something that is not a place.

**Also absent:** no snippet or description, no date, no highlight of the matched term in the
displayed row (highlighting *is* returned by the API and is discarded by the UI), no result
type badge beyond the meta line.

---

## 6. Expansion paths — the ceiling

This is the most consequential section for the concept.

| Path | Exists? | Behaviour |
|---|---|---|
| Show more results | yes | appends **3** hits per click. Verified 3 → 6 → 9. |
| URL changes on expand | **no** | stays `https://www.algolia.com/` across every click |
| Per-source drill-in | partial | facet checkbox filters in place; no dedicated source view |
| Full results page | **orphaned** | `/search` exists but the overlay never links to it |

Three findings fall out:

1. **A search on algolia.com has no URL.** No query string, no shareable link, no back-button
   history, no bookmark, no way to send a colleague a set of results. Search is not addressable.
2. **The result set is effectively unreachable.** `ecommerce search` returns 371 results at 3
   per click — **123 clicks** to see them. The overlay shows the user a number it has no way of
   letting them reach.
3. **A full search page exists and is abandoned.** `https://www.algolia.com/search` returns 200
   with `<title>Search | Algolia</title>` (confirmed real: nonsense paths 404). But it contains
   **zero inbound links from the overlay**, and it **ignores `?query=`** — loading
   `/search?query=pricing` leaves the input empty and shows the same three default hits as an
   untouched overlay. Someone built the destination and never wired it up.

There is no SEO surface, no analytics surface, and no shareable artifact for any search
performed on algolia.com.

---

## 7. The 8-journey baseline

**Rubric** (agreed with Arijit 2026-08-07, `docs/program/work-units/WU-06.md`): **PASS** = canonical
destination is result #1 · **PARTIAL** = in the top 5 · **FAIL** = anything else, including
not present.

**Method.** One query per journey, and the query *is the nav label* — the concept's claim is
that search can replace the navigation, so the nav label is the fair test. The overlay shows 3
hits, so one "Show more results" click was used to expose ranks 4–6; scoring is by rank
position. Every canonical destination was verified HTTP 200 on 2026-08-07 first
(`/customer-stories` is a 404; the real page is `/customers`).

| # | Journey | Query | Destination | Rank | Verdict |
|---|---|---|---|---:|---|
| 1 | Products | `products` | `/products` | 2 | 🟡 PARTIAL |
| 2 | Solutions | `solutions` | `/solutions` | 6 | 🔴 FAIL |
| 3 | Pricing | `pricing` | `/pricing` | 2 | 🟡 PARTIAL |
| 4 | Developers/Docs | `developers` | `/developers` | 1 | 🟢 PASS |
| 5 | Resources | `resources` | `/resources` | — | 🔴 FAIL |
| 6 | Customer Stories | `customer stories` | `/customers` | — | 🔴 FAIL |
| 7 | Contact Sales | `contact sales` | `/demorequest` | — | 🔴 FAIL |
| 8 | Login | `login` | `dashboard.algolia.com` | — | 🔴 FAIL |

**1 PASS · 2 PARTIAL · 5 FAIL.**

Two independent robustness checks, because this table is the number that leaves this document:

**Scoring strictness.** Scored twice, once matching the hub page exactly and once accepting
anything beneath it. **Identical result.** No verdict depends on how strictly the destination
is read.

**Stability across runs.** The probe was run a second time hours later
(`overlay-journeys-run1.json` vs `overlay-journeys.json`). **All 8 journeys returned the same
six URLs in the same order** — byte-identical. Only a result *count* moved, `products`
930 → 931. The concern going in was that Products and Pricing sit at rank 2, one position from
PASS; both held. This table is a stable property of the current ranking, not a lucky draw.

### What beat the real page

- **`pricing`** → rank 1 is `/doc/integration/salesforce-commerce-cloud-b2c/guides/pricing-and-promotions`.
  A Salesforce Commerce Cloud integration guide outranks the pricing page. This project has hit
  this exact failure once before, in the demo, before ranking Rules were added.
- **`solutions`** → ranks 1–5 are **all Greenhouse job postings** — Solutions Engineer, Solutions
  Architect. A buyer searching for solutions is shown five job adverts.
- **`resources`** → ranks 1–6 are Support articles and REST API endpoints for listing
  *authentication resources*. The word matched; the meaning did not.
- **`contact sales`** → 16 results, all Support FAQs. No route to the sales form exists in the
  index.
- **`customer stories`** → 38 results, none of which is the customer stories hub; ranks 2–6 are
  Magento and rate-limit support articles.
- **`login`** → the dashboard is a separate application and is not in the index. Search
  structurally cannot serve this journey.

### The pattern

Four of the five failures are the same mechanism: **Documentation and Support are 73.4% of the
corpus and there is no ranking signal that privileges a commercial destination over a technical
one.** A literal keyword match inside a support article beats the exact page the visitor named.

This is directly actionable for the build:

| Journey | What the new UI must do |
|---|---|
| Products, Pricing, Solutions, Resources, Customer Stories | a commercial-intent ranking signal or pinned destinations — the demo's `commercial_rank` / Rules approach, applied to these five specifically |
| Contact Sales | the conversion form must be indexed, or routed to by a rule rather than by relevance |
| Login | **not a search problem.** External app, not a page. Search-first must keep a non-search route. |
| Developers/Docs | already works; do not regress it |

---

## 8. What the overlay does not do

The gap list the concept must close, all observed above:

1. No addressable search — no URL, no share, no back, no bookmark
2. No full results page in use; `/search` exists, orphaned, and ignores `?query=`
3. 3 results per view, +3 per click; 371 results is 123 clicks away
4. No grouping of results by anything
5. No breadcrumb, and the `Source • category` substitute repeats itself or names a certification
6. No snippet, no date, no highlighting (the API returns highlighting; the UI throws it away)
7. Zero-result: the *search* layer offers nothing — no did-you-mean, no relaxation, no relevant
   fallback, and it blanks the filter rail. The AI layer carries the state single-handed (§4.5)
8. AI answers are uncited and disconnected from the 371 retrieved results on the same screen
9. AI prompt chips are vendor sales questions, not visitor questions
10. Source filters are an infrastructure taxonomy — three labels name systems, three name
    content types, and "Website" is a leftovers bucket that includes Greenhouse job postings
11. Short queries return whole sources wholesale (94.6% of results for `ecom`)
12. English-only by hard filter
13. No recent searches, no popular searches, no personalisation
14. `Learn more →` on every result regardless of type — one CTA for a doc page, a job advert,
    and a pricing page alike

---

## 9. What this means for the concept

The strongest argument for search-first is not that Algolia should build something new. It is
that **Algolia already built it, put it on every page behind the global header, and then
capped it at three results with no URL.**

Everything the concept needs already exists in this overlay: a corpus, facets, query
suggestions, an AI answer layer, a hit template — and, established during the correction pass
in §4.4, **a working hybrid**. One Enter already returns a ranked list *and* a generated answer
on the same screen. Nobody has to be sold the idea that search and answers belong together;
algolia.com already does it.

What is missing is not capability. It is **promotion** — giving the surface a page, a URL, room
to breathe, ranking that knows a buyer from a developer, and an answer layer that cites the
results sitting six inches above it.

The 8-journey table is the number to quote. Algolia's own site search gets a visitor to the
right page first time on **one of the eight things the site exists to do**.

---

## Caveats

- **State captures must each get a fresh browser context.** The first pass drove all five states
  through one context in sequence, so the zero-result capture inherited an open Algolia Assist
  chat from the AI-mode state. That made two claims in §4.5 wrong — one of them, "no way back,
  the most exposed state on the site," was the punchiest line in the document and it was false.
  Both are corrected above. Anything re-run here must keep the per-state isolation in
  `annotate_overlay_states.py`.
- **Result counts drift between runs.** `ecommerce search` returned 371 on the capture run and
  373 an hour later. Treat every count here as of 2026-08-07, not as a constant.
- **The `ecom` whole-source match is an observation, not a diagnosis.** The mechanism needs
  index-settings access to confirm.
- **One query per journey.** The rubric fixed one nav-label query per journey. A buyer-language
  variant (`how much does algolia cost`) was not run and would likely score differently. This is
  now the single largest untested assumption in the table.
- **Two runs, one day.** The journey probe was run twice, hours apart, with byte-identical
  results on all 8 journeys (§7). Stable within a day; not evidence about weeks. Re-run
  `overlay_journey_probe.py` to re-measure — about six minutes, read-only.
- **The probe's scoring was wrong once and is now fixed at source.** It matched destinations by
  substring, which scored Pricing as PASS because rank 1 was
  `/doc/.../guides/pricing-and-promotions`. It now compares parsed paths exactly, carries a
  comment explaining the failure, and the verdicts stored in both evidence files have been
  re-derived. Every accepted destination is verified HTTP 200 before use — `/customer-stories`
  was in the original list and is a 404.
- The previously-cited "overlay on 1738 of 2322 pages (75%)" claim was **retired on 2026-08-07**
  on Arijit's instruction — the corpus file behind it was deleted with the WU-05 crawl and it
  conflated design intent with usage. It is not used anywhere in this document.
