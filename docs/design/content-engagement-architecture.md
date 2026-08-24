# Content Engagement Architecture

This page explains the two connected systems behind the Algolia.com content-engagement experience:

1. the personalized concierge that recognizes a visitor's journey and starts a useful conversation;
2. the asynchronous judge panel that evaluates a completed grounded answer.

The diagrams use business language first and place the implementation detail directly beneath it. The runtime source remains authoritative if implementation and illustration ever drift.

## Personalized Concierge

![How Personalized Concierge Engagement Works](../diagrams/how-personalized-concierge-engagement-works.png)

### 1. Remember what the visitor did

`frontend/chat-widget/algolia-engagement-tracker.js` records page visits, clicks, dwell, scroll, navigation, search, and chat activity.

- `sessionStorage` is the primary working memory for the current tab: `algolia_session`, `algolia_events`, `algolia_proactive_state`, and the active handoff context.
- `localStorage` contains optional durable profile context in `algolia_profile`, such as anonymous identity and a confirmed persona when one has actually been provided.

The current journey does not depend on a guessed persona. It is driven primarily by observed session behavior.

### 2. Understand the journey and decide when to help

`frontend/chat-widget/algolia-context-compiler.js` converts browser state into `AlgoliaContextPacket.v1` and a bounded `AlgoliaTurnContext.v1`. The packet preserves the broader journey while identifying the immediate page move used for a transition decision.

`frontend/chat-widget/algolia-proactive-controller.js` applies deterministic trigger rules. It checks the current page or direct transition, dwell and scroll qualification, duplicate suppression, cooldown, session limits, widget readiness, page visibility, and whether a greeting or conversation is already active.

Current page-moment qualification is 3 seconds of dwell and 30% scroll. The controller owns the trigger decision; the language model does not decide whether a trigger fired.

### 3. Start the right conversation

When a moment qualifies, the controller sends the visitor context, why-now signal, and message goal to the Agent Studio `www Chat - Proactive Concierge` agent. The agent returns one personalized greeting and up to three useful choices using the `ProactiveGreetingResponse.v1` contract.

The controller validates that response and the chat widget displays it. The visitor can select a choice or type a different response; the interaction is not scripted.

### 4. Continue with the full story

`frontend/chat-widget/handoff-to-orchestrator.js` packages:

- the same visitor context;
- the greeting shown;
- every choice shown;
- the selected choice, if any;
- the visitor's typed response, if any.

The main Agent Studio `www Chat - Orchestrator` receives that `ProactiveHandoffContext.v1`, retrieves evidence, answers with the full journey in mind, and asks one useful discovery question. The handoff is JavaScript transport code, not a second conversational agent.

For the full storage, trigger, greeting, and handoff contracts, see [`docs/customer-documentation/proactive-engagement/README.md`](../customer-documentation/proactive-engagement/README.md).

## Asynchronous Judge Panel

![How Three Judgments Become One Accountable Score](../diagrams/How%20Judges%20Work.png)

The judge panel evaluates the answer after answer execution. It does not hide, delay, or replace the answer.

### 1. Freeze one fair starting point

`frontend/chat-widget/algolia-judge-core.js` creates one immutable evaluation package containing the visitor question, final answer, ordered retrieved evidence, sentence manifest, typed context, and answer/evidence hashes. Every judge receives the same package.

### 2. Review through three independent lenses

Three Agent Studio agents run in parallel with no search tool:

- `Algolia_Judge_Skeptic` looks hardest for material risk and unsupported claims.
- `Algolia_Judge_Referee` applies the shared rubric literally and neutrally.
- `Algolia_Judge_Advocate` recognizes genuine value without excusing fabrication.

Their prompts live in `agents/prompts/judge/`; their configuration lives in `agents/admin/algoliaComConfig.mjs`.

### 3. Score the same four qualities

Each judge scores four semantic dimensions from 0 to 10:

- **Grounding:** Is the answer supported by the supplied evidence?
- **Completeness:** Did it answer the whole question?
- **Depth:** Is the explanation sufficiently developed?
- **Relevance:** Is it focused and useful?

Judges also return claim assessments, evidence references, and rationale.

### 4. Let code verify the process

Deterministic code validates the report shape, role, score bounds, exact flagged answer text, sentence references, evidence IDs, and evaluation identity. An invalid report is rejected and can be retried against the same frozen packet with precise validation feedback. Code verifies integrity; it does not decide whether a claim is true.

### 5. Build consensus with safeguards

At least two valid reports are required. Two reports produce a provisional result; three produce a complete panel.

- Dimension scores are the mean across valid judges.
- The composite is the mean of Grounding, Completeness, Depth, and Relevance.
- A grounding finding becomes a panel finding when at least two judges agree on the same answer claim.
- The current runtime does not cap the composite (`appliedCap` is `null`). Grounding findings remain visible separately for review.

### 6. Show trust, not just a number

`frontend/chat-widget/algolia-confidence-badge.js` presents the composite, four dimension scores, per-judge reports, claims to review, and a plain-language explanation. If fewer than two judges return valid reports, confidence is unavailable rather than fabricated.

## Source Of Truth

| Concern | Authoritative source |
|---|---|
| Browser tracking and storage | `frontend/chat-widget/algolia-engagement-tracker.js` |
| Journey compilation | `frontend/chat-widget/algolia-context-compiler.js` |
| Trigger decisions and greeting request | `frontend/chat-widget/algolia-proactive-controller.js` |
| Greeting-to-orchestrator handoff | `frontend/chat-widget/handoff-to-orchestrator.js` |
| Judge packet, validation, and aggregation | `frontend/chat-widget/algolia-judge-core.js` |
| Judge presentation | `frontend/chat-widget/algolia-confidence-badge.js` |
| Agent Studio configuration | `agents/admin/algoliaComConfig.mjs` |
| Agent prompts | `agents/prompts/` |
