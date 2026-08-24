# Proactive Content Engagement Journey Foundation

## Role

Act as the architect and implementation lead for Algolia Content Engagement. Design a deterministic, category-driven proactive engagement system that works across Algolia.com page families without hard-coding a small list of individual URLs.

Do not begin or continue implementation until this contract is reviewed. Separate confirmed requirements from unresolved policy decisions. Do not silently invent thresholds, suppression rules, or popup behavior.

## Objective

Build a reliable foundation for four composable visitor paths:

1. Technical evaluation: Product -> Documentation.
2. Business proof: Solution -> Customer Story.
3. Commercial evaluation: Product or Solution -> Pricing.
4. Technical/resource depth: Developer Hub, Documentation, and Resource pages.

The system must understand page categories and transitions so visitors can mix and match paths naturally. It must not require a bespoke trigger for every possible URL pair.

## Architecture Invariants

- `algolia-engagement-tracker.js` observes and stores visitor behavior.
- `algolia-context-compiler.js` converts stored behavior into one bounded context packet.
- `algolia-proactive-controller.js` determines whether and when a proactive opportunity exists.
- The Greetings Agent creates the greeting and chips from the qualified packet.
- The chat widget renders the greeting and captures the response.
- `handoff-to-orchestrator.js` carries the greeting, chips, response, and context into the main orchestrator.
- The controller owns timing; the model does not decide when the widget opens.
- The visitor's raw clickstream is never narrated back or exposed.

## Test Session Reset

Make the Algolia Assistant identity/logo in the chat header clickable as the UAT reset control.

On activation:

1. Animate the logo through one visible 360-degree rotation.
2. Clear only Content Engagement-owned state from `localStorage` and `sessionStorage`.
3. Preserve unrelated Jahia, website, and browser storage, including Jaya history and browser storage.
4. Create a fresh profile/session/events envelope and record the current page as the first page of the new journey.
5. Reset proactive opportunities, pending greetings, cooldown state, and debug trace.
6. Reset the visible conversation through the widget's existing conversation-reset behavior.

The reset exists so a tester can complete one scenario, reset, and begin the next scenario without old journey signals contaminating the new test.

## Category Model

Classify every page into a reusable category. At minimum:

- `product`
- `solution`
- `documentation`
- `developer`
- `resource`
- `customer_story`
- `pricing`
- `conversion`
- `other`

Rules must operate on categories and observed page metadata. Individual URLs may be fixtures in tests, but must not be the production trigger logic.

## Journey 1: Technical Evaluation

### Product depth

- Applies to any page classified as `product`.
- Confirmed threshold: at least 3 seconds of dwell and at least 30% scroll depth.
- Expected result: one Product Research opportunity grounded in the current product/topic.
- This is the entry point for the technical journey: Product -> Documentation.

### Product -> Documentation

- The tracker must retain the product context when the visitor follows a product link into its documentation.
- The documentation-page opportunity must incorporate both the prior product and the current documentation topic.
- Confirmed destination threshold: at least 3 seconds of dwell and at least 30% scroll depth.
- The greeting should frame the moment as moving from product interest into implementation validation without sounding like surveillance.

### Return path

- Documentation -> Product must remain visible in journey history.
- Whether this return creates a new popup is an explicit policy decision, not an automatic assumption.

## Journey 2: Business Proof

### Solution depth

- Applies to any page classified as `solution`.
- Confirmed threshold: at least 3 seconds of dwell and at least 30% scroll depth.
- Expected result: one Solution Research opportunity grounded in the current solution/industry focus.
- This is the entry point for the business journey: Solution -> Customer Story/Proof.

### Solution -> Customer Story

- Applies when a visitor moves from any Solution page into a customer story/case study.
- The context must retain the solution/industry focus and add the proof page as the current evidence moment.
- The greeting should help connect the proof to the visitor's likely business problem, industry, use case, or KPI without inventing metrics.
- Destination dwell and scroll thresholds require explicit confirmation.

## Journey 3: Commercial Evaluation

- Support both Product -> Pricing and Solution -> Pricing.
- Preserve the relevant product or solution trail in the packet.
- The greeting should interpret the transition as a cost/value/evaluation moment, not merely announce that the visitor reached Pricing.
- Decide explicitly whether the transition fires on Pricing arrival or only after Pricing dwell/depth.

## Journey 4: Developer And Resource Depth

- Applies to Developer Hub, Documentation, and Resource pages.
- Do not trigger in the hero or immediately on page load.
- The visitor must move into substantive page content, described as beyond 50% or the next meaningful content section.
- Decide whether percentage scroll is sufficient or whether the tracker must observe named section entry.
- The greeting should be grounded in the current technical/resource topic and offer the next useful depth: implementation, architecture, proof, or POC scope.

## Opportunity Lifecycle

The same page/moment must never produce duplicate greetings.

The desired staged journey includes a possible greeting on the category page and another richer greeting on the destination page. Define this policy explicitly:

- Never render a second proactive greeting while the widget is already open.
- Never interrupt again after the visitor has engaged and handed off to the orchestrator.
- Proposed behavior requiring confirmation: if the earlier greeting was shown but dismissed or ignored, a higher-value cross-page transition may create one later greeting.
- Session cap and cooldown must not accidentally suppress the intended destination transition.

## Trigger Grammar

Implement a small reusable grammar:

- Category-depth trigger: category + qualified dwell/depth.
- Transition trigger: prior category + current category + qualified destination evidence.
- Comparison trigger: multiple distinct pages within the same category.
- Commercial trigger: product/solution/developer context + pricing.

Do not enumerate every route permutation. Add a new rule only when it represents a new semantic moment, not merely a new URL.

## Context Packet Requirements

Every proactive request must include:

- current page category, topic, title, and path;
- bounded recent page trail;
- product and solution focus trails;
- current transition;
- confirmed persona when available;
- observed dwell and depth signals;
- inferred intent/friction with confidence and evidence;
- message goal and reason codes;
- opportunity ID;
- a safe internal story hint that summarizes the moment without exposing telemetry.

The same packet must remain compatible with downstream handoff to the orchestrator.

## Testing Requirements

Write failing tests before runtime changes.

At minimum, test:

- reset clears only project-owned state and preserves unrelated storage;
- logo animation and reset activation;
- thresholds immediately below and exactly at each boundary;
- any correctly classified Product/Solution/Documentation/Developer/Resource/Customer Story page inherits its category rule;
- Product -> Documentation retains product context;
- Solution -> Customer Story retains solution context;
- Product/Solution -> Pricing retains the relevant trail;
- ignored/dismissed greeting versus engaged/handoff behavior;
- duplicate, cooldown, cap, and widget-open suppression;
- greeting request, rendering, chip response, handoff, and orchestrator continuation;
- debug output explains every suppression and every pipeline stage.

Verify first in the local parity site with a headed browser. Do not deploy to Jahia or publish prompt/config changes until the local journeys pass and the unresolved policy decisions are approved.

## Deliverables

1. Approved trigger-policy table with thresholds and lifecycle rules.
2. Tracker reset behavior and tests.
3. Generic category classification and tests.
4. Controller trigger grammar and tests.
5. Greetings Agent trigger guidance for the new semantic moments.
6. Updated customer-facing technical, flow, and data documentation.
7. Headed local-browser evidence for each journey.
8. Separate deployment approval and rollback plan for Jahia.

## Open Decisions Requiring Arijit

1. Product -> Documentation destination depth: 40% or 50%?
2. Solution -> Customer Story destination dwell/depth threshold?
3. Pricing transition: immediate on arrival or qualified by Pricing dwell/depth?
4. Developer/Resource depth: raw 50% scroll or named meaningful-section entry?
5. Can a dismissed/ignored first greeting be followed by one richer transition greeting in the same session?
6. Should clicking the logo clear the confirmed demo persona, or preserve it while resetting only the journey?
