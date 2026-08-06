# Execution Plan — 21 Work Units, 86 Source Tasks

Date: 2026-08-05
Status: WU-1 complete (verified by Asana readback 2026-08-05). Next: WU-2.
Session note: session crashed 2026-08-05 ~1:20pm EDT immediately after WU-1 verification. No work lost — Asana held state. Recovered 2:15pm EDT.
Owner: Arijit Chowdhury

**This file is SSOT for WHY.** Reasoning, dependencies, critical path, coverage ledger, Asana GID map. Source task numbers `[n]` refer to the verbatim research tasks in `docs/90-archive/2026-08-05-search-first-algolia-com-plan.md`.

**It is NOT the execution brief.** Three artifacts, three jobs, no field duplicated:

| Artifact | Owns |
|---|---|
| **this file** | WHY — reasoning, dependencies, critical path, coverage ledger |
| **`docs/briefs/WU-NN.md`** | HOW — inputs with real paths, method, skill routing, output schema, runnable verify commands, DoD |
| **Asana** | STATUS — done/not-done, per-unit findings comments, the human gate |

**To execute a unit, read `docs/briefs/README.md` and then that unit's brief.** Asana task
descriptions are deliberately pointers, not copies — a description you can execute from is
a second copy of the plan, and two copies drift. Where a brief and this file disagree about
*method*, the brief wins: the briefs were written after the corpus existed. Where they
disagree about *why*, this file wins.

Added 2026-08-05 because the original Asana-holds-status / plan-holds-reasoning split left
nothing that owned execution: parent tasks had a four-line description and all 86 subtasks
had empty notes.

## End goal

A URL Arijit can send to anyone at Algolia that opens a working search-led algolia.com — two concept frames on a real Algolia index of real algolia.com content — with a one-page concept frame and a research body that answers SEO, conversion, accessibility, latency, and safety objections on the spot.

Acceptance criteria: (1) real index, zero fixtures; (2) all 8 non-negotiable journeys work; (3) faster to destination than today's algolia.com on ≥5 of 8, measured; (4) both frames on one index; (5) mobile works; (6) shareable without Arijit present; (7) every objection has a written answer on disk.

## Execution model

One work unit per session. Read Asana → pick next unblocked unit → execute → write artifacts → verify against DoD → update Asana → **stop for review**.

The gate between units is a real stop. It is where a bad research artifact gets caught before six more are built on top of it.

## Sections

`P0 Setup` · `P1 Ground Truth` · `P2 Pattern & Critique` · `P3 Models` · `P4 Concepts` · `P5 Build` · `P6 Show`

---

## P0 Setup

### WU-1 — Asana project, doc split, strike approval framing
Covers `[8]` · Blocked by: **Asana OAuth** · Tier: inline

- [x] Create `docs/` output tree
- [x] Move manifesto to `docs/00-vision-manifesto.md`
- [x] Archive the 1293-line plan to `docs/90-archive/` with a superseded header — nothing deleted
- [x] `[8]` Strike approval framing; recast Ask 1 / Ask 2 as build scope, not approval paths
- [x] Authenticate Asana MCP — OAuth completed 2026-08-05 on second attempt; first flow's state expired before the callback came back
- [x] Create project + 21 work-unit tasks + 86 subtasks
- [~] 7 sections — **not created.** This MCP exposes no create-section tool, only `get_project_sections`. Phases encoded as zero-padded name prefixes (`P1 · WU-02 …`) which sort correctly. Drag into real sections in the UI if wanted.
- [x] Read the project back through the MCP — verified `num_tasks: 21`, and `num_subtasks` per parent summing to exactly 86

**DoD: MET.** Verified by readback, not self-report: project `num_tasks` = 21; per-parent subtask counts 1,2,1,5,1,13,6,1,3,11,8,8,12,6,0,1,0,0,0,2,5 = **86**.

---

## P1 Ground Truth

### WU-2 — Crawl algolia.com → corpus
Covers `[11] [18]` · Blocked by: WAF risk · Tier: Sonnet + `scout`

- `[11]` Crawl current algolia.com navigation, footer, sitemap, key landing pages, conversion flows
- `[18]` Extract every mega-menu item from Products, Solutions, Developers, Resources

**DoD:** N records on disk in `docs/50-prototype/corpus/`, each with url, title, page-type, body, breadcrumb, CTA. Record count stated, not estimated.
**Risk:** algolia.com may be behind Akamai/Cloudflare. Fallback is the stealth path in `algolia-audit-browser`. If both fail, this blocks WU-4, WU-5, WU-15 — escalate immediately rather than proceeding on partial data.

### WU-3 — Current search overlay teardown
Covers `[12]` · Blocked by: WU-2 · Tier: Sonnet + Playwright MCP

- `[12]` Audit the overlay: filters, source counts, AI-mode prompts, suggestions, result groupings, result metadata, expansion paths

**DoD:** `20-research/22-search-overlay-teardown.md` with annotated screenshots. This is the strongest existing precedent for the whole thesis — treat it as the baseline the concept promotes, not as background.

### WU-4 — IA taxonomy, intent matrix, page-role classification
Covers `[13] [14] [15] [16] [17]` · Blocked by: WU-2 · Tier: Sonnet

- `[13]` Complete taxonomy: top-level nav, subnav, page types, CTAs, audiences, use cases, product concepts, resource types
- `[14]` Identify repeated IA patterns across product/solution/industry/comparison/docs/pricing/contact/proof/resources/partners/company pages
- `[15]` Map each page to likely user intent
- `[16]` Classify each page SEO-acquisition vs conversion vs trust-building
- `[17]` Compare explicit nav taxonomy against the implicit search-source taxonomy

**DoD:** `20-research/21-ia-audit.md` + `ia-map.json` + `sitemap-inventory.csv`; must-preserve destination list; the `[17]` tension named and resolved, not just observed.

### WU-5 — 6-axis classification → nav→search mapping
Covers `[19]` · Blocked by: WU-4 · Tier: Haiku (mechanical, high volume)

- `[19]` Classify every item by visitor intent, audience, business context, product capability, content type, conversion action

**DoD:** `20-research/23-nav-to-search-mapping.md`; every record tagged on all 6 axes per the mapping hypothesis in the archive. This becomes the facet schema for WU-15.

### WU-6 — Analytics analysis
Covers `[6] [64]–[75]` · Blocked by: **Arijit's GA/Looker export** · Tier: Opus (small input, judgment)

13 subtasks: `[6]` directional pull, then `[64]` landing pages · `[65]` nav clicks · `[66]` site-search usage rate · `[67]` query report · `[68]` source-filter usage · `[69]` path exploration · `[70]` conversion paths for the 8 journeys · `[71]` segments · `[72]` search-vs-no-search conversion · `[73]` page depth and time-to-destination · `[74]` content engagement · `[75]` SEO dependency by page type.

**DoD:** `20-research/24-analytics-note.md`. Every number traces to a named report. No estimate presented as a measurement. Also carries the 29-metric instrumentation baseline from the archive.

---

## P2 Pattern & Critique

### WU-7 — Pattern library
Covers `[20]–[25]` · Blocked by: — · Tier: up to 4 Sonnet researchers (only unit with real fan-out)

- `[20]` Eyebuydirect and Lacoste as search-plus-nav hybrids
- `[21]` Additional best-in-class search-dominant ecommerce and content discovery
- `[22]` Command palettes in modern SaaS
- `[23]` Developer-docs search patterns
- `[24]` AI answer/search hybrids: answer panels, prompt chips, citations, refinements, next actions
- `[25]` Homepage search across Google, Perplexity, Stripe docs, Vercel docs, AWS, Shopify, ecommerce and marketplace leaders

**DoD:** `20-research/25-pattern-library.md` + interaction scorecard + component inventory + annotated screenshots in `20-research/screenshots/`. Every pattern claim carries a URL.

### WU-8 — Novelty / prior-attempts check
Covers `[2]` · Blocked by: — · Tier: Sonnet · **Hard 3h cap**

- `[2]` Has any B2B SaaS or enterprise software company tried search-led marketing-site navigation? What pattern, and did public evidence show success, retreat, or failure?

**DoD:** `20-research/26-novelty-prior-attempts.md` with an explicit verdict. The archive flags "no software company has done this" as unproven. It either earns evidence here or it leaves the brief. Five starting sources are already in the archive.

### WU-9 — Buyer evidence
Covers `[5] [26] [27]` · Blocked by: **Arijit** · Tier: human

- `[5]` Lightweight buyer-premise check: 3–5 quick reactions from sales / solution consulting
- `[26]` Interview 2–3 sales or SC stakeholders on buyer paths, objections, discovery needs
- `[27]` Review win/loss notes, call snippets, discovery summaries

**DoD:** `20-research/27-buyer-evidence.md` with verbatim quotes. Summaries fail the gate — the whole point is language Arijit can quote back.

### WU-10 — Feasibility, critique, case-against
Covers `[7] [54]–[63]` · Blocked by: WU-4, WU-6 · Tier: **escalate (fable)**

- `[7]` Strongest case against, written as a CMO who prefers the current site
- `[55]` **SEO implications — priority.** Riskiest assumption #4, the only one at confidence *low-to-medium*, and the archive's own no-go bar
- `[54]` buyer comprehension · `[56]` accessibility · `[57]` enterprise trust routing · `[58]` brand distinctiveness · `[59]` how much conventional nav must remain · `[60]` radical vs balanced vs conservative · `[61]` whether analytics supports search-takeover-after-engagement · `[62]` which questions need named stakeholder input · `[63]` targeted stakeholder interviews *(Arijit)*

**DoD:** `20-research/28-feasibility-and-critique.md`. The case-against must be genuinely adversarial — if it reads as a strawman it fails the gate. Also carries a validation task per each of the 10 riskiest assumptions.

---

## P3 Models

### WU-11 — IA translation + state/component model
Covers `[29]–[36]` · Blocked by: WU-5 · Tier: Opus

- `[29]` nav categories → search affordances · `[30]` overlay elements → homepage architecture · `[31]` which elements become facets, chips, promoted modules, suggestions, result categories, answer panels, or persistent utility links
- Five states: `[32]` pre-query · `[33]` autocomplete · `[34]` post-query results · `[35]` navigational query · `[36]` zero-result and ambiguous-intent

**DoD:** `30-models/31-ia-translation-model.md` + `32-state-and-component-model.md` + query-intent taxonomy. `[36]` is the one most likely to be skipped and most likely to be attacked in a demo.

### WU-12 — Agent model + Agent Studio capability
Covers `[37]–[44]` · Blocked by: WU-5 · Tier: **escalate (fable)**

- `[43]` **Research actual Agent Studio and neural search capability — the hidden gate.** Riskiest assumption #7, confidence `unknown`. Its verdict decides whether WU-18 builds a real agentic layer or a designed one. Run it first in this unit, not last.
- `[37]` agent taxonomy (concierge, product, industry/use-case, developer, academy, support, sales/SC) · `[38]` routing logic · `[39]` content access per agent · `[40]` answer formats · `[41]` handoff rules · `[42]` trust guardrails · `[44]` map each of the 8 journeys to its agent flow

**DoD:** `30-models/33-agent-taxonomy-and-routing.md` + `34-agent-content-access-matrix.md`, plus a written capability verdict on `[43]` that WU-18 can act on. If Agent Studio has no public documentation, say so plainly rather than inferring capability.

### WU-13 — Threat model, latency budget, governance, eval plan
Covers `[1] [3] [4] [45]–[53]` · Blocked by: WU-12 · Tier: **escalate (fable)**

- `[45]` Threat-model prompt injection, jailbreaks, competitor manipulation, false public claims, screenshot attacks, scraping, bot abuse, LLM cost attacks
- `[3]` Public-agent safety spike · `[4]` latency spike · `[1]` confirm the precommitted thresholds
- `[46]` anonymous usage controls · `[47]` per-layer latency budgets · `[48]` fallback UX
- `[49]` regulated answer categories · `[50]` source-of-truth and approval workflow per category · `[51]` the line between generate-freely / extractive+cited / route-to-approved-page / hand-to-human
- `[52]` eval harness requirements · `[53]` ongoing quality loop

**DoD:** `30-models/35-public-agent-threat-model.md`, `36-latency-and-fallback-model.md`, `37-regulated-claim-governance.md`, `38-agent-eval-plan.md`. The archive's numeric bars (300ms p95, $0.01/session, 1000-prompt suite) are recorded here as **launch gates for a future build** — there is no launch to gate, so they do not block this demo. This is the artifact a security reviewer will attack; write it to survive that.

---

## P4 Concepts

### WU-14 — Concept architecture, both frames
Covers `[9] [76] [77] [78] [80] [81]` · Blocked by: WU-11, WU-12 · Tier: Opus

- `[76]` Define 2 website frames + 1 optional capability layer
- `[77]` Per frame: homepage, search expansion, results, product page, pricing path, developer path, contact-sales path
- `[78]` Agentic flows — scoped to WU-12's capability verdict
- `[9]` Decide the agentic layer's role in the demo: real, bounded, or labeled future-state
- `[80]` **Reframed.** The archive says "data model for mocked results." Define the *real* index schema instead — fixtures fail acceptance criterion 1
- `[81]` What must be clickable vs illustrative

**DoD:** `40-concepts/41-frame1-cmo-wedge.md`, `42-frame2-search-first.md`, `43-flow-map.md`, `44-prototype-scope.md`. Every one of the 8 non-negotiable journeys has a defined path in both frames, or the frame is cut.

---

## P5 Build

### WU-15 — Build the Algolia index
No source task — implied by the real-index requirement · Blocked by: **App ID + admin API key**, WU-2, WU-5 · Tier: Sonnet

Reuse the `algolia-content-fetch` skill — built for third-party sites you do not own, bypassing the Crawler's domain-ownership gate.

**DoD:** index live and queryable by API; facets configured on all 6 taxonomy axes; record count stated. Verified by a real query returning real algolia.com records.

### WU-16 — Build Frame 1, CMO wedge
Covers `[79]` · Blocked by: WU-14, WU-15 · Tier: Sonnet

Reuse `frontend-builder` → `algolia-design` → `artifact-design-arijit`. Sora typography, Algolia palette.

**DoD:** runs against the live index; all 8 journeys reachable within one interaction.

### WU-17 — Build Frame 2, search-first north star
Blocked by: WU-16 · Tier: Sonnet

**DoD:** shares WU-15's index and WU-16's components; same 8-journey test passes.

### WU-18 — Agentic layer: real or designed
Covers `[78]` revisited · Blocked by: WU-12's verdict · Tier: Sonnet

**DoD:** either built against real capability, or shipped as a designed layer with an honest on-screen label. Never implied capability that does not exist.

### WU-19 — Deploy to a shareable URL
No source task — implied by acceptance criterion 6 · Blocked by: **VPS SSH access** · Tier: inline

Hermes VPS + Caddy. A localhost server or an artifact link fails criterion 6.

**DoD:** loads from a real domain in a browser, unauthenticated, on someone else's machine.

---

## P6 Show

### WU-20 — Journey validation
Covers `[28] [86]` · Blocked by: WU-19 · Tier: Sonnet + Playwright

- `[86]` Validation checklist: usability, responsiveness, narrative clarity
- `[28]` Usability-test with ≥5 participants across buyer, developer, existing-customer *(Arijit; directional evidence, explicitly not statistically valid)*

**DoD:** `60-show/63-journey-validation.md`. All 8 journeys, desktop + mobile, click-count and time recorded against current algolia.com, screenshot each. Acceptance criterion 3 is a measurement — if it fails, report the failure rather than reframing it.

### WU-21 — Brief, board, talk track
Covers `[10] [82] [83] [84] [85]` · Blocked by: WU-20 · Tier: Opus

- `[82]` Convert research findings into visual and interaction requirements
- `[83]` Final routes and states · `[84]` copy and sample queries · `[85]` prototype success criteria
- `[10]` The one-page concept frame — recast from "executive concept board for approval" to the frame around a live demo

**DoD:** `10-decision-brief.md`, `60-show/61-concept-board.html`, `60-show/62-talk-track.md`. Five-minute talk track drives the live demo rather than narrating slides. WU-10's case-against is attached, not buried.

---

## Critical path

```
OAuth → WU-1 → WU-2 → WU-4 → WU-5 → WU-14 → WU-15 → WU-16 → WU-19 → WU-20 → WU-21
                       WU-3, WU-7, WU-8 run parallel
                       WU-11, WU-12, WU-13 feed WU-14
                       WU-6, WU-9 gated on Arijit
                       WU-10 feeds WU-21
```

## Coverage ledger

| Work unit | Source tasks | Count |
|---|---|---|
| WU-1 | 8 | 1 |
| WU-2 | 11, 18 | 2 |
| WU-3 | 12 | 1 |
| WU-4 | 13–17 | 5 |
| WU-5 | 19 | 1 |
| WU-6 | 6, 64–75 | 13 |
| WU-7 | 20–25 | 6 |
| WU-8 | 2 | 1 |
| WU-9 | 5, 26, 27 | 3 |
| WU-10 | 7, 54–63 | 11 |
| WU-11 | 29–36 | 8 |
| WU-12 | 37–44 | 8 |
| WU-13 | 1, 3, 4, 45–53 | 12 |
| WU-14 | 9, 76–78, 80, 81 | 6 |
| WU-16 | 79 | 1 |
| WU-20 | 28, 86 | 2 |
| WU-21 | 10, 82–85 | 5 |
| **Total** | | **86** |

WU-15, WU-17, WU-18, WU-19 carry no source task — they are build steps the archive never specced because it assumed a mock prototype.

## Known blockers

| Blocker | Blocks | Unblocked by |
|---|---|---|
| Asana OAuth | WU-1 completion, all status tracking | Arijit's browser authorization |
| Algolia app ID + admin key | WU-15 → WU-16, 17, 19, 20 | Arijit |
| VPS SSH | WU-19 | Arijit |
| GA/Looker export | WU-6 → WU-10 | Arijit (has access) |
| Sales/SC availability | WU-9 | Arijit |
| algolia.com WAF | WU-2 → WU-4, 5, 15 | stealth crawl path, or unresolvable |
| Agent Studio documentation | WU-12 → WU-13, 18 | may dead-end; label honestly if so |

## Asana IDs

Workspace `Algolia` = `15096140849280` (is_organization) · Team `Algolia` = `15096170870583`
Project `Search-First Algolia.com` = `1217199861767750` · **privacy: private**
https://app.asana.com/1/15096140849280/project/1217199861767750

The only team in this org is `Algolia`, org-wide and public — so `private_to_team` would have exposed this to the whole company. Project is private to Arijit. Widen it in one click when ready; the reverse is not one click.

This MCP exposes no create-section tool, so phases are encoded as zero-padded name prefixes (`P1 · WU-02 …`) which sort correctly in list view. Drag into real sections in the UI if wanted.

| WU | Asana task GID |
|---|---|
| WU-01 | 1217199733725847 |
| WU-02 | 1217200058577419 |
| WU-03 | 1217199733642672 |
| WU-04 | 1217199862117010 |
| WU-05 | 1217199853099684 |
| WU-06 | 1217200058604945 |
| WU-07 | 1217199862179049 |
| WU-08 | 1217199733884821 |
| WU-09 | 1217200058617398 |
| WU-10 | 1217199862299501 |
| WU-11 | 1217199853264026 |
| WU-12 | 1217200058633111 |
| WU-13 | 1217199667262100 |
| WU-14 | 1217200058631866 |
| WU-15 | 1217199667315356 |
| WU-16 | 1217199853469216 |
| WU-17 | 1217200058913307 |
| WU-18 | 1217199734241960 |
| WU-19 | 1217199734270443 |
| WU-20 | 1217199667505773 |
| WU-21 | 1217200059043740 |
