# Proactive Concierge Headed E2E Test System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a repeatable headed Playwright test system that visibly exercises every proactive journey from browser behavior through greeting, user engagement, orchestrator handoff, grounded conversation, and evidence capture.

**Architecture:** Use one Playwright harness with two explicit lanes. The deterministic local lane runs against the Scout-backed Algolia.com parity site and proves tracker, compiler, trigger, greeting rendering, and handoff contracts without model variability. The live integration lane uses the development Agent Studio agents and proves the real Greetings Agent, orchestrator, specialists, streamed response, sources, personality, and discovery flow. A short Jahia smoke lane runs only after both local gates pass.

**Tech Stack:** Node.js, Playwright 1.62, Chromium headed mode, the existing Python local parity server, Scout route captures, Node test assertions, Agent Studio development agents, JSON/JSONL evidence artifacts.

**Spec:** `docs/customer-documentation/proactive-engagement/README.md`, `docs/design/search-experience/discovery-engagement/ALGOLIA-PROACTIVE-CONTROLLER.md`, `docs/design/search-experience/discovery-engagement/ALGOLIA-PROACTIVE-GREETING-AGENT.md`, and `docs/design/search-experience/discovery-engagement/HANDOFF-TO-ORCHESTRATOR-CLIENT-TOOL.md`

## Global Constraints

- Run the visible suite with Chromium `headless: false`, `workers: 1`, and `slowMo: 250` so Arijit can watch every navigation, scroll, popup, and conversation.
- Use `Algolia_Prod_Copy_Vanilla` for every live orchestrator test.
- Treat the Scout local site as a selected-page parity harness, not a full Algolia.com mirror.
- Keep runtime credentials in `.env.local`; never write API keys, authorization headers, cookies, or tokens into screenshots, traces, JSONL, Markdown, or Git.
- Redact `x-algolia-api-key`, `authorization`, `cookie`, `set-cookie`, and URL query secrets before persisting network evidence.
- Start each trigger test in a fresh browser context so cooldown and session caps cannot contaminate another journey.
- Do not seed browser storage for visible journey tests. Persona, page views, clicks, search, scroll, and dwell must be produced through browser actions. Storage seeding remains allowed only in isolated unit tests.
- A popup is not a pass by itself. The selected trigger, opportunity packet, greeting request, visible greeting, visitor response, handoff context, orchestrator request, streamed answer, sources, and discovery question must all be accounted for.
- Model prose is never asserted by exact string. Contracts and state are deterministic assertions; greeting and answer quality use structural checks plus the existing judge panel.
- Do not modify or deploy Jahia while the local deterministic or local live gate is failing.
- Do not consume an opportunity when the greeting request fails, configuration is late, or rendering is refused.
- Keep generated run artifacts under ignored `test-results/` and `playwright-report/`. Commit only the test code, runbook, and a redacted summary explicitly selected as durable evidence.

---

## Test Model

### Pipeline checkpoints

Every positive journey records and validates these checkpoints in order:

1. **Observed action:** the visible click, search, scroll, or dwell occurred.
2. **Tracker:** `algolia_profile`, `algolia_session`, and `algolia_events` contain the expected observed facts.
3. **Compiler:** `AlgoliaContextPacket.v1` contains the correct current page, persona, recent journey, and inferred fields without inventing confirmed facts.
4. **Controller:** exactly one highest-priority candidate is selected with the expected `moment`, `trigger`, and `messageGoal`.
5. **Greeting request:** exactly one completion POST is made to the Greetings Agent with matching `opportunityId` and `metadata.turnContext`.
6. **Greeting render:** the chat widget opens and visibly shows one valid greeting plus zero to three chips; no raw telemetry appears.
7. **Visitor engagement:** a chip click or typed answer is captured as the visitor's actual response.
8. **Handoff:** the primary orchestrator request contains the visible visitor response plus one internal `PROACTIVE_HANDOFF_CONTEXT` block with the original greeting, chips, selected chip, request packet, and latest context.
9. **Orchestrator:** the response streams without service error and answers the visitor's question before discovery.
10. **Answer UX:** inline links work, source tiles appear after the answer, and one consultant-led discovery question appears below the sources.
11. **Quality:** grounding, depth, relevance, aRRIe voice, analogy-canvas use, business-value translation, and specialist routing are scored and recorded.

### Canonical conversation questions

The first live suite uses the three Gong-derived questions that correspond to the three personas and journey moments:

| ID | Persona | Question |
|---|---|---|
| `Q1_COST` | Executive | How are API calls counted and how do they impact pricing, including rate limits and cost control? |
| `Q2_IMPLEMENTATION` | Developer | How does the technical implementation of Algolia work, especially regarding frontend integration with InstantSearch or React InstantSearch libraries, and what is the development effort required? |
| `Q3_ROI_PROOF` | Merchandiser | What is the business value and ROI of Algolia, and how does it impact KPIs like conversion rates and AOV, supported by customer proof? |

### Pilot journeys

| ID | Persona | Visible path | Trigger | First engagement |
|---|---|---|---|---|
| `PILOT_01_PRODUCT_PRICING` | Executive | Select Executive → AI Search → Pricing within 5 seconds | `product_to_pricing` | Click the most cost-relevant chip, then ask `Q1_COST` verbatim |
| `PILOT_02_IMPLEMENTATION` | Developer | Select Developer → Developers → type `React InstantSearch implementation` → Docs | `search_to_docs` | Type `Q2_IMPLEMENTATION` verbatim as the first response |

The first pilot proves chip handoff. The second proves typed-response handoff. Both must pass before the full trigger matrix runs.

### Full deterministic trigger matrix

Each row runs in a new browser context with `?algoliaChatDebug=1&algoliaProactiveDebug=1&algoliaProactiveReset=1`.

| ID | Exact visible actions | Expected trigger | Expected moment |
|---|---|---|---|
| `TR01` | Open AI Search; click Pricing within 5 seconds | `product_to_pricing` | `commercial_evaluation` |
| `TR02` | Open InstantSearch Docs; click Pricing within 5 seconds | `implementation_to_pricing` | `commercial_evaluation` |
| `TR03` | Open Commerce solution; click Pricing within 5 seconds | `solution_to_pricing` | `commercial_evaluation` |
| `TR04` | Open Pricing; click Docs within 5 seconds | `pricing_to_implementation` | `implementation_research` |
| `TR05` | Open AI Recommendations; click Customers within 5 seconds | `product_to_customer_story` | `customer_proof` |
| `TR06` | Open Marketplace solution; click Customers within 5 seconds | `solution_to_customer_story` | `customer_proof` |
| `TR07` | Open Developers; type `React InstantSearch implementation`; click Docs | `search_to_docs` | `implementation_research` |
| `TR08` | Open Pricing directly; remain visible for 8.5 seconds | `pricing_8s_dwell` | `commercial_evaluation` |
| `TR09` | Open Developers directly; remain visible for 15.5 seconds | `developer_page_15s_dwell` | `implementation_research` |
| `TR10` | Open Docs directly; use visible wheel scrolling until tracker reports at least 60%, before 15 seconds | `developer_page_60_scroll` | `implementation_research` |
| `TR11` | Open Customers directly; remain visible for 12.5 seconds | `customer_story_12s_dwell` | `customer_proof` |
| `TR12` | Open Customers directly; use visible wheel scrolling until tracker reports at least 60%, before 12 seconds | `customer_story_60_scroll` | `customer_proof` |
| `TR13` | Open AI Search directly; remain visible for 10.5 seconds | `product_page_10s_dwell` | `product_research` |
| `TR14` | Open Commerce directly; remain visible for 10.5 seconds | `solution_page_10s_dwell` | `solution_research` |
| `TR15` | Open Personalization directly; use visible wheel scrolling until tracker reports at least 50%, before 10 seconds | `product_page_50_scroll` | `product_research` |
| `TR16` | Open Financial Services directly; use visible wheel scrolling until tracker reports at least 50%, before 10 seconds | `solution_page_50_scroll` | `solution_research` |
| `TR17` | Open AI Search; click AI Recommendations within 5 seconds | `multiple_product_pages` | `journey_shift` |
| `TR18` | Open Commerce; click Marketplace within 5 seconds | `multiple_solution_pages` | `journey_shift` |

For scroll tests, Playwright repeatedly calls `page.mouse.wheel(0, 500)` and reads the tracker snapshot after each visible movement. It stops as soon as the recorded depth reaches the threshold. It does not use `page.evaluate(() => scrollTo(...))` for the visible run.

### Persona conversation journeys

| ID | Persona | Path | Question and continuation | Routing expectation |
|---|---|---|---|---|
| `CV01` | Executive | AI Search → Pricing | Click a cost chip; ask `Q1_COST`; answer the discovery question with `We are projecting a high-traffic launch and want predictable spend.` | Orchestrator may answer directly; specialist is optional |
| `CV02` | Developer | Developers → search → Docs | Ask `Q2_IMPLEMENTATION`; continue with `We use React, a headless CMS, and a PIM. What should the first POC slice include?` | An implementation/product specialist should be invoked or the absence must be flagged |
| `CV03` | Merchandiser | AI Recommendations → Customers | Click a proof chip; ask `Q3_ROI_PROOF`; continue with `Fashion ecommerce; conversion and basket size matter most.` | A customer-evidence or commerce specialist should be invoked or the absence must be flagged |

## Acceptance Gates

### Deterministic pass criteria

- One and only one opportunity reaches `shown` for the expected trigger.
- The selected candidate is the highest-priority candidate when multiple candidates are eligible.
- `journeySummary.productTrail` or `solutionTrail` matches every qualifying page visited in order, up to the documented bound.
- The greeting request and handoff use the same `opportunityId`, `moment`, `trigger`, and `messageGoal`.
- The greeting popup is visible within 5 seconds of an immediate transition trigger and within threshold plus 3 seconds for dwell/scroll triggers.
- The selected chip or typed text is preserved as the visible user response.
- The orchestrator is not called before the visitor engages.
- The orchestrator is called exactly once after engagement.
- No visitor-facing text contains `tracking`, `telemetry`, `localStorage`, `sessionStorage`, `clickstream`, `PROACTIVE_HANDOFF_CONTEXT`, raw paths, or internal configuration.

### Answer-quality pass criteria

- Existing judge panel: grounding at least 8/10, coverage at least 7/10, depth at least 7/10, relevance at least 8/10, and `gateTripped=false`.
- Q1-Q3 each answer the literal question before asking discovery.
- Q1-Q3 contain exact, clickable retrieved Algolia URLs for factual feature, documentation, and customer-proof references.
- `analogy_canvas` appears for Q1-Q3 unless the runtime classifies a turn as precise pricing, legal, security, support policy, refusal, or unsafe.
- The analogy is a question-specific real-life parallel, not a generic search metaphor.
- aRRIe voice is direct, lively, candid, consultative, and useful; the judge must flag generic openings such as `Short answer:` when no personality follows.
- Recommendations translate technical capability into business effect such as conversion, basket size, effort, risk, or speed rather than stopping at `findability`.
- Sources are rendered after the completed answer; one discovery question is rendered after a divider below the sources.
- Q2 and Q3 record whether `ask_specialist` ran. Missing specialist routing is a failed routing expectation, not silently treated as a pass.

### Negative and resilience criteria

- Hovering over Products or Solutions on Home for 15 seconds never opens the chat.
- Product at 9 seconds and 45% scroll does not trigger; Solution at 9 seconds and 45% does not trigger; Developers at 14 seconds and 55% does not trigger; Pricing at 7 seconds does not trigger; Customers at 11 seconds and 55% does not trigger.
- An already-open chat records `chat_already_open` and does not create a second greeting.
- A visible greeting starts cooldown; an unshown failed greeting does not start cooldown or consume the session cap.
- Missing greeting-agent configuration records the exact missing field, preserves the opportunity, and succeeds if configuration becomes available within the bounded retry window.
- Malformed JSON, mismatched opportunity ID, telemetry-exposing greeting, or mismatched handoff summary never renders.
- Navigating away during a greeting request never renders a stale greeting on the new page.
- A service error leaves a retry-safe state and never displays model output as a valid answer.

---

### Task 1: Freeze the journey and evidence contracts

**Files:**
- Create: `frontend/chat-widget/tests/e2e/journey-manifest.mjs`
- Create: `frontend/chat-widget/tests/e2e/journey-manifest.test.mjs`
- Modify: `.gitignore`

**Interfaces:**
- Produces: `TRIGGER_JOURNEYS`, `PERSONA_CONVERSATIONS`, `NEGATIVE_CASES`, `QUESTION_BANK`, and `ARTIFACT_SCHEMA` used by every later test.

- [ ] **Step 1: Write the manifest contract test**

Assert that trigger IDs are unique, all 18 runtime trigger strings appear exactly once, every journey names a start path and expected moment, and the three conversation questions are non-empty exact strings.

- [ ] **Step 2: Run the test and verify it fails because the manifest does not exist**

Run: `node --test frontend/chat-widget/tests/e2e/journey-manifest.test.mjs`

- [ ] **Step 3: Implement the manifest from the tables in this plan**

Export frozen objects. Each trigger row includes `id`, `persona`, `startPath`, `actions`, `expectedTrigger`, `expectedMoment`, `expectedMessageGoal`, and `thresholdMs` where applicable.

- [ ] **Step 4: Ignore generated Playwright output**

Add `test-results/`, `playwright-report/`, and `blob-report/` to `.gitignore`.

- [ ] **Step 5: Run the manifest test**

Expected: all 18 triggers, three persona conversations, and all negative cases pass schema checks.

- [ ] **Step 6: Commit**

```bash
git add .gitignore frontend/chat-widget/tests/e2e/journey-manifest.mjs frontend/chat-widget/tests/e2e/journey-manifest.test.mjs
git commit -m "test: define proactive journey matrix"
```

### Task 2: Add visible persona controls and live/mock runtime modes to the local site

**Files:**
- Modify: `local-sites/algolia-com-parity/index.html`
- Modify: `tools/local_chat_parity_server.py`
- Create: `frontend/chat-widget/tests/e2e/local-parity-controls.test.mjs`

**Interfaces:**
- Consumes: `.env.local` values `ALGOLIA_APP_ID`, `ALGOLIA_SEARCH_API_KEY`, `ALGOLIA_GREETINGS_AGENT_ID`, and `ALGOLIA_ORCHESTRATOR_AGENT_ID` in live mode.
- Produces: visible `[data-persona="developer"]`, `[data-persona="merchandiser"]`, and `[data-persona="executive"]` controls; `?agentMode=mock|live`; redacted `/__test/runtime-config` response.

- [ ] **Step 1: Write a failing browser test for visible persona selection**

The test clicks each persona button and asserts `algolia_profile.persona` has the selected value, state `confirmed`, and source `demo_selector`.

- [ ] **Step 2: Write a failing server test for mode separation**

Assert mock mode intercepts Agent Studio requests, live mode does not, and the HTML never contains a private credential.

- [ ] **Step 3: Add the three persona buttons to the local navigation**

Each click calls `window.algoliaEngagementTracker.setPersona(value)` and visibly marks the active persona. The control is part of the local test harness only.

- [ ] **Step 4: Make the mock intercept selective**

In mock mode, intercept the Greetings Agent and orchestrator with deterministic fixture responses. In live mode, allow both requests to reach the development Agent Studio endpoints using public browser-safe app/search credentials supplied at runtime.

- [ ] **Step 5: Run the local control tests and the existing suite**

Run: `node --test frontend/chat-widget/tests/e2e/local-parity-controls.test.mjs && npm test`

- [ ] **Step 6: Commit**

```bash
git add local-sites/algolia-com-parity/index.html tools/local_chat_parity_server.py frontend/chat-widget/tests/e2e/local-parity-controls.test.mjs
git commit -m "test: add local persona and agent modes"
```

### Task 3: Build the headed Playwright harness and evidence recorder

**Files:**
- Create: `playwright.config.mjs`
- Create: `frontend/chat-widget/tests/e2e/helpers/journey-actions.mjs`
- Create: `frontend/chat-widget/tests/e2e/helpers/pipeline-snapshot.mjs`
- Create: `frontend/chat-widget/tests/e2e/helpers/network-recorder.mjs`
- Create: `frontend/chat-widget/tests/e2e/helpers/artifact-writer.mjs`
- Create: `frontend/chat-widget/tests/e2e/helpers/widget-actions.mjs`
- Create: `frontend/chat-widget/tests/e2e/helpers/quality-checks.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces: `startJourney()`, `selectPersona()`, `clickNav()`, `typeSiteSearch()`, `scrollUntilTrackedDepth()`, `waitForExpectedOpportunity()`, `readPipelineSnapshot()`, `waitForGreeting()`, `engageByChip()`, `engageByText()`, `waitForOrchestratorAnswer()`, and `writeJourneyArtifacts()`.

- [ ] **Step 1: Add `@playwright/test` at version `1.62.1`**

Run: `npm install --save-dev @playwright/test@1.62.1`

- [ ] **Step 2: Configure visible sequential execution**

Set Chromium to `headless: false`, `workers: 1`, `fullyParallel: false`, viewport `1440x1000`, `launchOptions.slowMo: 250`, trace `retain-on-failure`, video `retain-on-failure`, and screenshot `only-on-failure`. Allow `PW_HEADLESS=1` only for CI.

- [ ] **Step 3: Implement action helpers using visible input**

Use locator clicks, keyboard typing, and `page.mouse.wheel`. Do not mutate storage or call controller functions to manufacture positive visible journeys.

- [ ] **Step 4: Implement the pipeline snapshot**

Read the three storage keys, `algolia_proactive_state`, compiler output, controller debug trace, current chat state, greeting/chips, and latest opportunity. Return a JSON-safe object matching `ARTIFACT_SCHEMA`.

- [ ] **Step 5: Implement network recording with mandatory redaction**

Record Agent Studio request URL without secret query values, agent ID, sanitized request body, status, response timing, and SSE event types. Drop credential headers entirely.

- [ ] **Step 6: Implement artifact writing**

For each test write `timeline.jsonl`, `pipeline.json`, `network.jsonl`, `transcript.json`, `summary.md`, and named screenshots under `test-results/proactive-e2e/<run-id>/<test-id>/`.

- [ ] **Step 7: Add package scripts**

```json
{
  "test:e2e:proactive:headed": "playwright test frontend/chat-widget/tests/e2e --project=chromium --headed --workers=1",
  "test:e2e:proactive:pilot": "playwright test frontend/chat-widget/tests/e2e/01-pilot --project=chromium --headed --workers=1",
  "test:e2e:proactive:matrix": "playwright test frontend/chat-widget/tests/e2e/02-trigger-matrix.spec.mjs --project=chromium --headed --workers=1"
}
```

- [ ] **Step 8: Test redaction and artifact schema**

Feed the recorder fake authorization and Algolia key headers. Assert neither secret appears anywhere in the serialized artifact.

- [ ] **Step 9: Run helper tests and commit**

```bash
node --test frontend/chat-widget/tests/e2e/helpers/*.test.mjs
git add package.json package-lock.json playwright.config.mjs frontend/chat-widget/tests/e2e/helpers
git commit -m "test: add headed proactive e2e harness"
```

### Task 4: Implement and watch the two pilot journeys

**Files:**
- Create: `frontend/chat-widget/tests/e2e/01-pilot-product-pricing.spec.mjs`
- Create: `frontend/chat-widget/tests/e2e/01-pilot-implementation.spec.mjs`

**Interfaces:**
- Consumes: headed helpers and local mock mode.
- Produces: the first complete browser-visible proof of chip handoff and typed handoff.

- [ ] **Step 1: Implement `PILOT_01_PRODUCT_PRICING`**

Click Executive, click AI Search, wait for tracker page view, click Pricing within 5 seconds, wait for `product_to_pricing`, inspect the greeting, click the most cost-relevant chip, and assert one orchestrator request begins only after that click. Then type `Q1_COST` and capture the answer.

- [ ] **Step 2: Implement `PILOT_02_IMPLEMENTATION`**

Click Developer, click Developers, type `React InstantSearch implementation` into the site search, click Docs, wait for `search_to_docs`, inspect the greeting, type `Q2_IMPLEMENTATION` as the first response, and assert handoff contains the typed response and developer persona.

- [ ] **Step 3: Run both pilots visibly in mock mode**

Run: `npm run test:e2e:proactive:pilot`

Expected: Arijit sees both journeys, popup timing, chip/typed engagement, and deterministic mock orchestrator answers. Every checkpoint is green in the artifact summary.

- [ ] **Step 4: Run both pilots visibly in live mode**

Run with `ALGOLIA_E2E_AGENT_MODE=live npm run test:e2e:proactive:pilot`.

Expected: real Greetings Agent and real orchestrator responses, no mock response markers, no service errors, and complete transcripts.

- [ ] **Step 5: Stop on the first failed boundary**

Classify the failure as tracker, compiler, controller, greeting request, greeting validation, widget render, handoff, orchestrator, specialist, answer quality, or UX. Do not patch another layer until the first failing boundary is proven.

- [ ] **Step 6: Commit the passing pilot tests**

```bash
git add frontend/chat-widget/tests/e2e/01-pilot-product-pricing.spec.mjs frontend/chat-widget/tests/e2e/01-pilot-implementation.spec.mjs
git commit -m "test: cover proactive pilot journeys"
```

### Task 5: Script every trigger permutation

**Files:**
- Create: `frontend/chat-widget/tests/e2e/02-trigger-matrix.spec.mjs`

**Interfaces:**
- Consumes: all 18 `TRIGGER_JOURNEYS` definitions.
- Produces: one isolated deterministic test and artifact folder per runtime trigger.

- [ ] **Step 1: Generate one Playwright test per manifest row**

Each test selects its persona, performs only the listed visible actions, snapshots every boundary, waits for the exact trigger, and asserts that no higher-priority unexpected trigger won.

- [ ] **Step 2: Add timing tolerances without weakening thresholds**

Transition triggers must show within 5 seconds. Dwell and scroll triggers receive a 3-second processing allowance after the configured threshold. The test must still assert the stored dwell/scroll fact met the configured threshold.

- [ ] **Step 3: Run the matrix visibly**

Run: `npm run test:e2e:proactive:matrix`

Expected: 18/18 trigger tests pass, in sequence, with no retries hiding flaky behavior.

- [ ] **Step 4: Repeat the matrix three times**

Run three independent headed passes. Production-readiness gate: 54/54 journey executions pass without manual intervention. A test that passes only on retry is flaky and fails the gate.

- [ ] **Step 5: Commit**

```bash
git add frontend/chat-widget/tests/e2e/02-trigger-matrix.spec.mjs
git commit -m "test: cover all proactive triggers"
```

### Task 6: Add negative, suppression, and recovery tests

**Files:**
- Create: `frontend/chat-widget/tests/e2e/03-suppression-recovery.spec.mjs`

**Interfaces:**
- Produces: proof that silence is intentional, diagnosed, and does not burn future opportunities.

- [ ] **Step 1: Implement hover and below-threshold cases**

Use the exact negative thresholds in this plan and assert no visible popup, no `shown` opportunity, and the expected debug suppression or no-trigger state.

- [ ] **Step 2: Implement chat-open, cooldown, cap, duplicate, and hidden-page cases**

Assert each reason code and verify no duplicate visible greeting.

- [ ] **Step 3: Implement readiness recovery**

Start without greeting-agent ID, produce a valid journey, assert no opportunity is consumed, expose configuration within the bounded retry window, and assert the same journey can then show exactly once.

- [ ] **Step 4: Implement invalid response cases**

Return malformed JSON, wrong opportunity ID, telemetry language, and mismatched handoff summary from the mock agent. Assert none renders.

- [ ] **Step 5: Run three times headed**

Expected: all negative tests remain silent for the correct recorded reason, and recovery tests visibly recover without refresh.

- [ ] **Step 6: Commit**

```bash
git add frontend/chat-widget/tests/e2e/03-suppression-recovery.spec.mjs
git commit -m "test: prove proactive suppression and recovery"
```

### Task 7: Run the three live persona conversations and judge the results

**Files:**
- Create: `frontend/chat-widget/tests/e2e/04-live-persona-conversations.spec.mjs`
- Create: `tools/testing/summarize-proactive-e2e.mjs`

**Interfaces:**
- Consumes: live Agent Studio mode, Q1-Q3, and the existing judge configuration.
- Produces: full transcripts, specialist-routing evidence, source URLs, judge JSON, and a redacted comparison table.

- [ ] **Step 1: Implement `CV01` Executive conversation**

Run Product → Pricing, click a cost chip, ask Q1, respond to discovery with the high-traffic-launch detail, and verify the second orchestrator turn uses prior conversation plus proactive context without restating telemetry.

- [ ] **Step 2: Implement `CV02` Developer conversation**

Run Developers → implementation search → Docs, ask Q2, provide the React/headless CMS/PIM follow-up, and capture specialist/tool events. Fail the routing expectation if no specialist delegation is observable.

- [ ] **Step 3: Implement `CV03` Merchandiser conversation**

Run AI Recommendations → Customers, click a proof chip, ask Q3, provide fashion/conversion/basket-size context, and capture customer-proof retrieval and specialist/tool events.

- [ ] **Step 4: Validate response presentation**

For each answer assert: no service error, non-empty stream, inline links resolve to approved Algolia hosts, sources follow the answer, discovery follows the sources, and internal context is absent from visible text.

- [ ] **Step 5: Run the existing judge panel on each final answer**

Persist raw Chief, Skeptic, Referee, and Advocate JSON. Apply the quality thresholds in this plan. Keep deterministic UX failures separate from subjective answer scores.

- [ ] **Step 6: Generate the run summary**

Create one table with journey, trigger, greeting, chip/typed response, handoff result, orchestrator latency, specialist used, source count, judge dimensions, personality verdict, and final pass/fail.

- [ ] **Step 7: Commit**

```bash
git add frontend/chat-widget/tests/e2e/04-live-persona-conversations.spec.mjs tools/testing/summarize-proactive-e2e.mjs
git commit -m "test: validate live persona conversations"
```

### Task 8: Add the Jahia development smoke gate

**Files:**
- Create: `frontend/chat-widget/tests/e2e/05-jahia-smoke.spec.mjs`

**Interfaces:**
- Consumes: `ALGOLIA_JAHIA_BASE_URL` from `.env.local`.
- Produces: post-local proof that the deployed development site matches the tested local behavior.

- [ ] **Step 1: Implement two non-destructive smoke journeys**

Run Product → Pricing with Executive and Developers → Docs with Developer. Use query-string reset/debug controls and a fresh browser context. Do not submit forms or mutate Jahia content.

- [ ] **Step 2: Assert deployed asset identity**

Record script URLs, release markers, and content hashes for the tracker, compiler, controller, handoff, theme, and chat bundle so a stale deployment cannot masquerade as a runtime failure.

- [ ] **Step 3: Execute visibly only after local gates pass**

Expected: both journeys show, hand off, and answer on the live development site with the same trigger and packet contracts as local.

- [ ] **Step 4: Commit**

```bash
git add frontend/chat-widget/tests/e2e/05-jahia-smoke.spec.mjs
git commit -m "test: add Jahia proactive smoke gate"
```

### Task 9: Document the run, repair, and release process

**Files:**
- Create: `docs/testing/proactive-concierge-e2e-runbook.md`
- Modify: `docs/customer-documentation/proactive-engagement/README.md`
- Modify: `README.md`

**Interfaces:**
- Produces: one operator-facing command sequence and one customer-facing architecture/testing explanation.

- [ ] **Step 1: Document prerequisites and exact commands**

Include browser installation, local server startup, mock pilot, live pilot, full matrix, persona conversations, Jahia smoke, artifact paths, and how to stop a run.

- [ ] **Step 2: Document failure classification**

Use the eleven pipeline checkpoints. The operator fixes the first failed boundary, reruns the smallest affected test, reruns both pilots, then reruns the full matrix before declaring recovery.

- [ ] **Step 3: Document the production-readiness gate**

Required evidence: unit suite green, local parity green, two pilots green in mock and live modes, 54/54 trigger repetitions green, all negative cases green, three persona conversations above quality thresholds, and two Jahia smoke journeys green.

- [ ] **Step 4: Explain future skill extraction without creating the skill**

Record that a skill is justified only after the runbook succeeds in at least three full repair/retest cycles. The future skill should orchestrate the proven scripts, not encode unproven testing logic.

- [ ] **Step 5: Run complete verification**

```bash
npm test
npm run test:e2e:proactive:pilot
npm run test:e2e:proactive:matrix
ALGOLIA_E2E_AGENT_MODE=live npm run test:e2e:proactive:headed
```

- [ ] **Step 6: Review the generated evidence for secrets and residue**

Search generated artifacts for credential header names and known key prefixes. Confirm generated directories are ignored and `git status --short` lists only intended source and documentation changes.

- [ ] **Step 7: Commit**

```bash
git add README.md docs/testing/proactive-concierge-e2e-runbook.md docs/customer-documentation/proactive-engagement/README.md
git commit -m "docs: add proactive e2e release gate"
```

## Execution Order And Stop Conditions

1. Implement Tasks 1-3.
2. Run the existing unit/local parity suite. Stop if it regresses.
3. Implement and visibly run the two mock pilots.
4. Run the two pilots live. Stop at the first failed pipeline boundary.
5. Implement the full trigger matrix and obtain 54/54 clean executions.
6. Implement negative/recovery cases.
7. Run the three live persona conversations and judge them.
8. Repair one proven failure at a time; rerun the affected test, both pilots, then the matrix.
9. Run the two Jahia smoke journeys.
10. Publish the redacted summary and update the runbook.

The suite is not production-ready if any test needs a retry, any live leg is mocked, any trigger is untested, any internal context appears to the visitor, any expected specialist is absent without an explicit product decision, or any evidence artifact contains credentials.

## Self-Review

- Spec coverage: tracker, compiler, controller, greeting, widget render, chip and typed response, handoff, orchestrator, specialists, sources, discovery, personas, all 18 triggers, negative cases, local/live/Jahia lanes, and repair loops are each mapped to a task.
- Placeholder scan: no implementation step depends on an unnamed route, question, trigger, threshold, file, artifact, or pass criterion.
- Type consistency: manifest trigger strings match the current controller; packet schemas remain `AlgoliaContextPacket.v1`, `AlgoliaTurnContext.v1`, `ProactiveGreetingRequest.v1`, `ProactiveGreetingResponse.v1`, and `ProactiveHandoffContext.v1`.
- Known pre-execution correction: `docs/design/search-experience/discovery-engagement/ALGOLIA-PROACTIVE-GREETING-AGENT.md` still documents the removed 12-34-word greeting rule. Before using that document as an executable contract, reconcile it with the live prompt and controller validation so the test does not preserve a stale limit.
