# Content Engagement Team Demo and UAT Guide

## Purpose

This guide gives the Algolia team one repeatable way to test four demo stories and eight proactive journeys. It tests the complete experience, not only whether a popup appears.

Every scenario validates:

`Reset -> Browse -> Track -> Compile context -> Trigger -> Personalized greeting -> Natural tester response -> Handoff -> Orchestrator -> Specialist when appropriate -> Grounded answer -> Discovery question`

## Authoritative Hosted Evidence

All eight journeys were recaptured in a visible browser against the internal Jahia surface on 2026-08-19. The final evidence set validates 8/8 journeys. `S1-retry` is the authoritative S1 result and replaces the earlier failed S1 attempt.

| Scenario | Canonical trigger | Browser evidence | Runtime trace |
|---|---|---|---|
| T1 | `product_page_3s_30_scroll` | [Answer](../../docs/evidence/visitor-intelligence/2026-08-19-jahia-headed-final/T1/01-answer.png) | [Trace](../../docs/evidence/visitor-intelligence/2026-08-19-jahia-headed-final/T1/01-trace.json) |
| T2 | `product_to_documentation` | [Answer](../../docs/evidence/visitor-intelligence/2026-08-19-jahia-headed-final/T2/02-answer.png) | [Trace](../../docs/evidence/visitor-intelligence/2026-08-19-jahia-headed-final/T2/02-trace.json) |
| B1 | `solution_page_3s_30_scroll` | [Answer](../../docs/evidence/visitor-intelligence/2026-08-19-jahia-headed-final/B1/03-answer.png) | [Trace](../../docs/evidence/visitor-intelligence/2026-08-19-jahia-headed-final/B1/03-trace.json) |
| B2 | `solution_to_customer_story` | [Answer](../../docs/evidence/visitor-intelligence/2026-08-19-jahia-headed-final/B2/04-answer.png) | [Trace](../../docs/evidence/visitor-intelligence/2026-08-19-jahia-headed-final/B2/04-trace.json) |
| C1 | `product_to_pricing` | [Answer](../../docs/evidence/visitor-intelligence/2026-08-19-jahia-headed-final/C1/05-answer.png) | [Trace](../../docs/evidence/visitor-intelligence/2026-08-19-jahia-headed-final/C1/05-trace.json) |
| C2 | `solution_to_pricing` | [Answer](../../docs/evidence/visitor-intelligence/2026-08-19-jahia-headed-final/C2/06-answer.png) | [Trace](../../docs/evidence/visitor-intelligence/2026-08-19-jahia-headed-final/C2/06-trace.json) |
| S1 | `developer_page_3s_30_scroll` | [Answer](../../docs/evidence/visitor-intelligence/2026-08-19-jahia-headed-final/S1-retry/07-answer.png) | [Trace](../../docs/evidence/visitor-intelligence/2026-08-19-jahia-headed-final/S1-retry/07-trace.json) |
| S2 | `resource_page_3s_30_scroll` | [Answer](../../docs/evidence/visitor-intelligence/2026-08-19-jahia-headed-final/S2/08-answer.png) | [Trace](../../docs/evidence/visitor-intelligence/2026-08-19-jahia-headed-final/S2/08-trace.json) |

### Current Acceptance Baseline

| Scenario | Runtime | Complete acceptance | Current finding |
|---|---|---|---|
| T1 | **Pass** | Product trigger, grounded answer, one discovery question, and continuity validated |
| T2 | **Pass** | Product-to-documentation replacement greeting and same-origin context continuity validated |
| B1 | **Pass** | Solution trigger, grounded business answer, one discovery question, and continuity validated |
| B2 | **Pass** | Solution-to-customer-proof replacement greeting, grounding, and continuity validated |
| C1 | **Pass** | Product-to-pricing replacement greeting, grounded answer, and continuity validated |
| C2 | **Pass** | Solution-to-pricing replacement greeting, grounded answer, and continuity validated |
| S1 | **Pass** | Developer specialist routed; evidence gate safely demoted its output and preserved the grounded answer |
| S2 | **Pass** | Evidence specialist routed; evidence gate safely demoted its output and preserved the grounded answer |

This baseline proves the current internal Jahia build under the captured conditions. Team UAT should still record what actually happens with natural responses and report any regression or intermittent behavior.

## Tester Response Rule

There is no scripted question and no prescribed answer. After aRRIe greets you, respond as a real visitor would:

- choose any relevant chip;
- type your own question;
- challenge an assumption;
- redirect the conversation while staying reasonably connected to the journey; or
- give an incomplete or unexpected response and see whether the system recovers.

The system passes only when it can understand and work with the response you actually give. Topic examples are inspiration, not a script.

## Before Every Scenario

1. Open the internal Algolia.com proving environment with proactive debugging enabled.
2. Click the Algolia Assistant logo once.
3. Confirm the logo rotates and Algolia-owned profile, session, event, opportunity, greeting, and chat state is cleared.
4. Begin from the first page. Do not open chat manually.
5. Keep the tab visible while satisfying dwell thresholds.

For every failure, capture the URL, screenshot or recording, approximate time, visible greeting and answer, stored opportunity or context packet when available, specialist/tool trace when expected, and a short note describing the mismatch.

## Technical

### T1 Individual Product Engagement

**Story:** A technical visitor is evaluating one Algolia product deeply enough to merit help before leaving the page.

**Canonical test route:** `/products/ai-search`. The runtime rule applies to any correctly classified individual product page.

**Steps**

1. Reset the journey.
2. Open **Products -> AI Search**.
3. Keep the page visible for at least 3 seconds.
4. Scroll to at least 30% depth.
5. Wait briefly for the concierge. Do not open it yourself.
6. Respond naturally using any chip or your own text.

**Expected trigger:** `product_page_3s_30_scroll`

**Expected experience**

- The greeting appears only after both dwell and scroll conditions are met.
- It identifies the actual product or capability without saying the visitor was tracked.
- It offers useful directions such as fit, implementation, proof, or evaluation.
- The orchestrator starts only after the tester responds.
- Broad orientation may stay with the orchestrator; deep technical questions should route to the appropriate Product Specialist.
- Factual claims are grounded, sources are visible, and the answer ends with one relevant discovery question.

**Pass:** The greeting is product-specific, the tester's chosen response survives handoff, routing matches the depth of the question, and the answer remains grounded.

### T2 Product To Documentation

**Story:** A visitor moves from product interest into implementation evidence. The concierge should remember both moments.

**Route:** `/products/ai-search` -> **Read the AI Search docs** -> the same-origin InstantSearch.js documentation page.

The canonical logical destination is `/sites/www/doc/guides/building-search-ui/what-is-instantsearch/js`. On the internal Jahia surface, the CTA resolves to `/cms/render/live/en/sites/www/home/doc/guides/building-search-ui/what-is-instantsearch/js.html`. Both identify the same internal documentation content; the browser must remain on `tmp-content-eng-algolia.cloud.jahia.com` so session context survives.

**Steps**

1. Reset the journey.
2. Open **Products -> AI Search** and dwell at least 3 seconds.
3. Scroll beyond 30% and let the product greeting appear. Leave that greeting unanswered.
4. Open the multilingual AI Search FAQ and click **Read the AI Search docs**.
5. Confirm the internal InstantSearch.js documentation route opens without leaving the internal site.
6. On documentation, dwell at least 3 seconds and scroll beyond 30%.
7. Wait for the destination greeting to replace the first greeting. Only then respond naturally.

**Expected trigger:** `product_to_documentation`

**Expected experience**

- The greeting connects prior product interest with the current implementation topic.
- The handoff preserves the product trail, documentation topic, greeting, chips, and the tester's actual response.
- Implementation, SDK, API, or InstantSearch depth routes to the Developer Specialist after visitor consent.
- Technical claims come from documentation, developer, API, or SDK evidence.

**Pass:** Both pages shape the greeting and answer, specialist routing is visible when needed, and no API behavior, code, or effort estimate is invented.

## Business

### B1 Explore A Business Priority

**Story:** A business leader is exploring an industry challenge or business priority and should receive outcome-oriented guidance in business language.

**Canonical test route:** `/industries/grocery`. The runtime rule applies to any correctly classified individual solution page.

**Steps**

1. Reset the journey.
2. Open **Solutions -> Grocery**.
3. Keep it visible for at least 3 seconds.
4. Scroll to at least 30% depth.
5. Wait for the concierge and respond naturally.

**Expected trigger:** `solution_page_3s_30_scroll`

**Expected experience**

- The greeting uses the actual solution, industry, or business problem.
- It translates capabilities into possible business outcomes without inventing metrics.
- The handoff carries solution context and the tester's real response.
- Customer names, KPIs, metrics, and ROI claims require retrieved evidence.
- Grounding uses current English, non-404 records from the declared production corpus. Testers remain free to ask a different relevant question and may receive a different valid source mix.

**Pass:** The greeting feels written for the solution journey, the conversation follows the tester rather than a script, every proof or outcome claim is supported by current filtered evidence, and the answer ends with one relevant discovery question.

### B2 See How Another Brand Solved It

**Story:** A business leader moves from a priority they care about to evidence that another brand achieved a meaningful outcome.

**Route:** Solution page -> its linked customer story. Use `/industries/grocery` -> `/customers/h-e-b-mexico` by clicking **Read their story**.

**Steps**

1. Reset the journey.
2. Open a solution page, dwell at least 3 seconds, and scroll beyond 30%.
3. Let the solution greeting appear. Leave that greeting unanswered.
4. Follow a visible customer story, case study, proof, or Customers link.
5. On the proof page, dwell at least 3 seconds and scroll beyond 30%.
6. Wait for the destination greeting to replace the first greeting. Only then respond naturally.

**Expected trigger:** `solution_to_customer_story`

**Expected experience**

- The greeting connects the original business problem to the proof now being evaluated.
- It helps assess similarity, KPIs, operating context, or next evidence.
- The handoff preserves both solution and proof context.
- Customer names, quotations, and metrics remain attached to their exact source.

**Pass:** The system remembers the solution, uses the proof accurately, follows the tester's direction, and never stitches a customer from one source to a metric from another.

## Commercial

### C1 Product To Pricing

**Story:** A visitor moves from capability research into commercial evaluation.

**Canonical test route:** `/products/ai-search` -> `/pricing`. The runtime rule applies to any qualified product-to-pricing transition.

**Steps**

1. Reset the journey.
2. Open **Products -> AI Search**, dwell at least 3 seconds, and scroll beyond 30%.
3. Let the product greeting appear. Leave that greeting unanswered.
4. Use website navigation to open Pricing.
5. Wait for the destination greeting to replace the first greeting.
6. Only then respond naturally with any commercial, value, effort, POC, or adjacent question.

**Expected trigger:** `product_to_pricing`

**Expected experience**

- The greeting reflects the prior product, not generic pricing help.
- It recognizes the shift from capability to cost, value, effort, or evaluation.
- It avoids unsupported plan, quota, contract, or exact-price claims.
- Deep implementation questions may route to a Product Specialist.

**Pass:** The product remains visible in the commercial conversation, the response is grounded in pricing, support, and product evidence, and uncertainty is stated instead of guessed.

### C2 Solution To Pricing

**Story:** A visitor moves from a business solution into cost-versus-value evaluation.

**Canonical test route:** `/industries/grocery` -> `/pricing`. The runtime rule applies to any qualified solution-to-pricing transition.

**Steps**

1. Reset the journey.
2. Open **Solutions -> Grocery**, dwell at least 3 seconds, and scroll beyond 30%.
3. Let the solution greeting appear. Leave that greeting unanswered.
4. Use website navigation to open Pricing.
5. Wait for the destination greeting to replace the first greeting.
6. Only then respond naturally with any relevant value, cost, proof, evaluation, or POC direction.

**Expected trigger:** `solution_to_pricing`

**Expected experience**

- The greeting connects the original solution or industry problem to commercial evaluation.
- It frames cost alongside business value and proof without inventing ROI.
- The handoff keeps solution and pricing context intact.
- Sources support every pricing mechanism, customer example, or KPI claim.

**Pass:** The conversation remains anchored in the solution journey, answers the tester's chosen direction, and advances toward a sensible evaluation step without forcing a sale.

## Specialist

### S1 Developer And Implementation Depth

**Story:** A developer is deeply engaged with implementation material and expects technical accuracy, not a surface summary.

**Canonical test route:** `/developers`. The runtime rule applies to correctly classified developer, documentation, API, SDK, and implementation pages.

**Steps**

1. Reset the journey.
2. Open **Developers**.
3. Continue beyond the hero into substantive implementation content.
4. Keep the page visible for at least 3 seconds and scroll to at least 30% depth.
5. Wait for the concierge and respond naturally, including technical challenges.

**Expected trigger:** `developer_page_3s_30_scroll`

**Expected experience**

- The greeting recognizes implementation intent and offers architecture, stack, records, events, UI, API, or POC depth.
- Detailed implementation questions route to the Developer Specialist.
- The specialist uses relevant documentation, SDK, API, or developer evidence.
- The final answer retains aRRIe's consultative voice while preserving technical precision.

**Pass:** Specialist routing is visible, the answer is technically grounded, unsupported timelines or syntax are avoided, and the conversation handles the direction the tester chooses.

### S2 Resource And Research Depth

**Story:** A visitor is studying a report, guide, infographic, or research asset and wants help turning information into a useful next decision.

**Canonical test route:** `/resources/asset/infographic-unlock-the-power-of-agentic-ai`. The runtime rule applies to correctly classified substantive resource pages.

**Steps**

1. Reset the journey.
2. Open the **Unlock the Power of Agentic AI** resource.
3. Move beyond the hero or library overview into substantive content.
4. Keep the page visible for at least 3 seconds and scroll to at least 30% depth.
5. Wait for the concierge and respond naturally.

**Expected trigger:** `resource_page_3s_30_scroll`

**Expected experience**

- The greeting reflects the resource topic and research intent.
- It can synthesize takeaways, connect implementation implications, find proof, or suggest the next evidence path.
- The orchestrator stays general unless the tester creates real specialist depth.
- Any customer, metric, or strategic claim is tied to retrieved evidence.

**Pass:** The resource topic survives handoff, the answer supports the tester's direction with relevant sources, and one thoughtful discovery question advances the journey.

## Evidence And Issue Reporting

For each scenario, record:

- scenario ID and tested route;
- pass, needs work, or blocked;
- screenshots or a short recording showing the starting page, source qualification, CTA and destination for transitions, greeting, and final answer;
- exact tester response, whether chip or free text;
- observed trigger and timing;
- stored opportunity/context packet when available;
- orchestrator handoff and specialist/tool trace, including the trace ID;
- sources shown and any unsupported claim;
- expected behavior versus actual behavior; and
- reproducibility after a fresh reset.

## Completion Criteria

Team UAT is complete when:

1. All eight scenarios have been tested from a fresh reset.
2. Every scenario has a recorded runtime verdict and a separate complete-acceptance verdict.
3. Every failure has reproducible evidence or is explicitly marked intermittent.
4. Natural tester responses survive handoff and drive the next answer.
5. Specialist routing is proven by an accepted specialist/tool trace where technical depth requires it.
6. Grounding, source presentation, and discovery behavior are reviewed.
7. Known gaps are documented before the executive demo or promotion decision. A completed test cycle may still conclude that a journey is not ready.

This guide does not authorize runtime, prompt, Agent Studio, trigger, specialist configuration, Jahia, or production changes.
