# Proactive Concierge E2E Test System

<context>
We are preparing an end-to-end production-readiness test system for the Algolia.com proactive concierge.

The delivery team is Aadhar Gupta (Senior Data Engineer), Harsh Arora (Senior Frontend Developer), Naveen Vedwal (CMS Architect), Rakesh Kumar (Adobe Architect), and Tarun Sharma (Project Manager). Piyush Patel is the executive sponsor. Arijit Chowdhury is the founder of the initiative, and Codex is his founder-level technical and product partner.

The system under test includes the engagement tracker, context compiler, proactive controller, Greetings Agent invocation, greeting and response chips, visitor response capture, handoff to the primary orchestrator, orchestrator answer generation, specialist routing, sources, discovery, and final chat presentation.

Tests must prove complete visitor journeys rather than isolated functions. They must exercise real browser behavior: navigation, clicks, searches, scrolling, dwell, proactive engagement, chip selection or typed response, orchestrator handoff, and continued conversation.

The resulting system must be repeatable, observable, autonomous, and suitable for later conversion into a reusable testing skill. The same contract also governs the immediate team-facing manual test cases and instructions.
</context>

<task>
Design a comprehensive implementation plan for a multi-agent Playwright testing system and derive a manual, visual team test plan from the same journey and evidence contracts.

The automated system must have one central Test Orchestrator and one independently executable Journey Worker for every defined journey. Each worker must follow the same prescriptive protocol, receive a declarative journey specification, execute its browser journey, validate every pipeline boundary, record evidence, identify the first failing subsystem, and return a structured result.

The manual plan must express those same journeys as clear, role-aware instructions that tell testers what to do, why the journey matters, what should happen, what evidence to capture, how to score it, and how the experience supports conversion toward an Algolia sales meeting or evaluation.
</task>

<requirements>
1. Inspect the current code, tests, architecture documentation, local parity site, Agent Studio prompt/configuration snapshots, and trigger definitions before planning. Derive the canonical journey inventory from implementation. Do not invent trigger names, thresholds, storage keys, packet fields, agent IDs, selectors, or handoff behavior.

2. Reconcile discrepancies between documentation, local code, deployed code, and runtime behavior before treating any one of them as authoritative.

3. Define a Test Orchestrator, environment/readiness validator, reusable Journey Worker instantiated per journey, evidence auditor, failure-triage coordinator, serialized repair worker, and regression coordinator.

4. Journey workers are autonomous test executors, not independent code owners. Parallel workers may test and investigate using isolated browser contexts and evidence directories. Only one repair worker may modify a shared owner module at a time. Do not create a persistent Git branch per journey.

5. Every Journey Worker receives a run ID, journey ID, persona, starting state, route, ordered browser actions, click targets, search input, scroll and dwell thresholds, expected trigger, journey moment, message goal, packet fields, greeting behavior, chip strategy, typed-response fallback, orchestrator question, continuation response, specialist expectation, timeout policy, evidence directory, and pass/fail gates.

6. Every Journey Worker executes: fresh context; documented reset; visible persona selection; exact navigation/click/search/scroll/dwell actions; tracker capture; compiler capture; controller candidate and opportunity capture; Greetings Agent request verification; greeting and chip rendering verification; chip or typed engagement; proof that the orchestrator is not called before engagement; proof it is called exactly once afterward; handoff capture; continued conversation; orchestrator validation; specialist validation; link/source/discovery/personality/grounding validation; artifact recording; structured result return.

7. Every worker returns journey status, timestamps, actions, expected and observed trigger, checkpoints, first failed checkpoint, failure class, owner module, assertion evidence, screenshots, trace/video, redacted network log, tracker state, compiler packet, controller trace, greeting request/response, handoff packet, transcript, specialist calls, quality score, repair boundary, and rerun requirements.

8. Validate every boundary: browser action, tracker, compiler, controller, opportunity, greeting request, response validation, widget rendering, visitor engagement, handoff tool, orchestrator request, orchestrator response, specialist routing, sources, discovery, answer quality, and personality. A popup alone is never a pass.

9. Represent every implemented proactive trigger as data in a journey manifest. At minimum cover product-to-pricing, solution-to-pricing, implementation-to-pricing, pricing-to-implementation, product-to-customer-evidence, solution-to-customer-evidence, search-to-documentation, pricing dwell, implementation dwell/scroll, customer-evidence dwell/scroll, product dwell/scroll, solution dwell/scroll, multiple product pages, and multiple solution pages.

10. Define persona-led conversations for developer, merchandiser, and executive visitors. Developer journeys cover implementation, documentation, stack, and POC planning. Merchandiser journeys cover commerce, personalization, recommendations, customer proof, conversion, and basket size. Executive journeys cover products/solutions, pricing, API usage, rate limits, cost control, business value, and commercial evaluation.

11. Use these canonical questions in their natural journeys:

- How are API calls counted and how do they impact pricing, including rate limits and cost control?
- How does the technical implementation of Algolia work, especially regarding frontend integration with InstantSearch or React InstantSearch libraries, and what is the development effort required?
- What is the business value and ROI of Algolia, and how does it impact KPIs like conversion rates and AOV, supported by customer proof?

12. Execute in waves: static contract/readiness validation; two visible headed pilots (product-to-pricing and implementation research); complete deterministic trigger matrix; persona-led live conversations; negative/suppression/retry/resilience cases; affected-journey reruns; full regression and production-readiness report.

13. The first execution of every journey is visible in headed Chromium. Later deterministic regressions may run headlessly when selected. Use bounded concurrency so Agent Studio limits, shared state, or excessive visible browsers do not contaminate results.

14. Each journey records timeline.jsonl, result.json, tracker snapshot, compiler packet, controller trace, redacted network log, greeting payload, handoff payload, transcript, named screenshots, Playwright trace, failure video, quality evaluation, and concise summary. The orchestrator produces a consolidated run manifest and report.

15. Map failures to owners: collection to engagement tracker; packet to context compiler; trigger/suppression to proactive controller; greeting request to Agent Studio client/config; greeting quality to Greetings Agent prompt/config; rendering to widget/message renderer/theme; engagement/handoff to handoff tool; incoming context to orchestrator V010/runtime; routing to orchestrator tool policy or specialist config; answer quality to system prompt/retrieval choreography; source/discovery presentation to renderer/UI.

16. The repair loop identifies the first failed checkpoint, rejects downstream symptoms as root causes, assigns one repair worker, requires a failing automated test, applies the smallest justified fix, runs owner tests, reruns the journey and affected regressions, records before/after evidence, and stops after bounded failed attempts.

17. Preserve proactive tracking, context packets, thresholds, greeting rendering, chips, handoff, streaming, progress states, analogy canvas, typography, spacing, sources, discovery placement, aRRIe personality, specialist routing, and Vanilla-index configuration.

18. Validate locally against the Scout-backed parity environment first. It must contain all required product, solution, pricing, documentation, developer, customer-proof, and search routes. Do not mutate Jahia while local gates fail. Run a limited Jahia smoke suite only after local validation.

19. Keep credentials outside committed files. Redact API keys, authorization, cookies, tokens, and private visitor data. Never expose telemetry or internal handoff context to visitors.

20. Every implementation task states its purpose, files, inputs, outputs, tests written first, steps, verification command, expected evidence, dependencies, concurrency constraints, cleanup/rollback, and completion gate.

21. Derive a branded, browser-based manual test runner for the team from this same contract. Each manual test shows persona, business objective, conversion hypothesis, prerequisites, exact live URL, ordered actions, dwell/scroll timing, expected popup, greeting/chip expectations, conversation input, expected routing, evidence checklist, scoring controls, defect notes, and completion status.

22. Manual findings must distinguish functional correctness, personalization quality, conversation quality, business relevance, visual quality, grounding, routing, and conversion momentum. A finding must identify what happened, what was expected, why it matters to the customer or business, severity, evidence, and recommended owner.

23. Apply the current Algolia deliverable brand system and audit the completed interface using the Algolia brand skills and shared reference files. Update a brand skill only when direct inspection proves its source material or rules are stale.
</requirements>

<constraints>
- Do not change runtime behavior while planning.
- Do not deploy to Jahia during local planning or failing local validation.
- Do not modify triggers, agents, prompts, specialists, index data, or widget design as part of plan creation.
- Do not create one code implementation per journey; instantiate one worker from manifest data.
- Do not allow parallel workers to edit shared files.
- Do not seed storage to fake visible end-to-end journeys.
- Do not exact-match generative prose.
- Do not expose secrets or private telemetry.
- Do not trust stale documentation without verification.
- Avoid unnecessary abstractions and folders.
- Do not turn the process into a skill before execution proves it.
</constraints>

<deliverables>
1. Verified system-under-test inventory.
2. Canonical journey manifest proposal.
3. Multi-agent testing architecture.
4. Test Orchestrator contract.
5. Universal Journey Worker prompt and schemas.
6. Evidence contract and artifact structure.
7. Failure taxonomy and repair ownership map.
8. Concurrency and isolation strategy.
9. Phase-by-phase implementation plan.
10. Exact headed Playwright pilot scripts.
11. Full trigger-matrix, persona conversation, and resilience plans.
12. Autonomous repair and regression loop.
13. Local-to-Jahia promotion gates.
14. Branded manual team test runner specification.
15. Manual tester instructions, scoring rubric, evidence requirements, and feedback workflow.
16. Definition of done with executable verification commands.
</deliverables>

<out_of_scope>
- Runtime implementation during prompt shaping or plan creation.
- Proactive architecture redesign.
- Prompt, specialist, frontend-stack, production-agent, or index-data changes.
- Skill creation before the process has been executed and proven.
</out_of_scope>

<assumptions>
- One reusable Journey Worker is instantiated per manifest journey.
- Test workers can parallelize isolated testing; repair work is serialized by owner module.
- Live Agent Studio conversations use lower concurrency than deterministic browser tests.
- The local Scout site is partial but includes every selected journey route.
- The first three questions are the agreed Gong-derived questions.
- First proof is headed; headless is an optional later regression mode.
- The immediate team-facing runner is a manual test command center; autonomous browser execution is a subsequent phase.
</assumptions>

<original_input>
Arijit requested a methodical, prompt-shaped plan for a repeatable, autonomous, multi-agent Playwright system. It must use a central orchestrator and one worker per journey, prescribe how and what to test, exact sequence and inputs, validation, repair ownership, and evidence recording. It must visibly test clicks, scrolling, dwell, proactive greetings, chips or typed engagement, orchestrator handoff, continued conversation, specialist routing, sources, discovery, personality, and business value across developer, merchandiser, and executive personas. The immediate priority is also a branded visual manual test plan for the delivery team to run against the live development site before the Wednesday demo, with step-by-step instructions, business effects, scoring, findings, and feedback capture. The autonomous testing system follows after the manual testing cycles.
</original_input>
