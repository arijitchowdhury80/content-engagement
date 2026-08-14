# Algolia Proactive Greeting Agent

## Purpose

The proactive greeting agent writes the opening hook for a qualified proactive engagement moment.

It does one thing: turn a controller opportunity packet into a short, useful, human greeting. It does not decide when to interrupt, track visitor behavior, answer product questions, call specialists, search Algolia, continue the conversation, or own orchestration.

The browser decides when to engage. The proactive greeting agent decides what the opening message should say. Client-side tools render the greeting and forward the first engaged user turn to the main orchestrator.

## Runtime Position

```mermaid
flowchart LR
  Visitor["Visitor"]
  Tracker["algolia-engagement-tracker.js"]
  Compiler["algolia-context-compiler.js"]
  Controller["algolia-proactive-controller.js"]
  Client["algolia-greetings-agent-client.js"]
  GreetingAgent["Agent Studio: Greetings Agent"]
  ShowTool["Client tool: show_proactive_greeting"]
  HandoffTool["handoff-to-orchestrator.js"]
  Widget["Chat widget"]
  Orchestrator["Agent Studio: www Chat - Orchestrator"]

  Visitor -->|"page views, clicks, searches, dwell, scroll"| Tracker
  Tracker -->|"localStorage/sessionStorage"| Compiler
  Compiler -->|"AlgoliaContextPacket.v1"| Controller
  Controller -->|"algolia-proactive-opportunity + stored packet"| Client
  Client -->|"completion POST with ProactiveGreetingRequest.v1"| GreetingAgent
  GreetingAgent -->|"tool call"| ShowTool
  ShowTool -->|"render greeting/chips"| Widget
  Visitor -->|"reply or chip click"| Widget
  Widget -->|"engaged user turn"| GreetingAgent
  GreetingAgent -->|"tool call"| HandoffTool
  HandoffTool -->|"completion POST with user turn + context"| Orchestrator
```

## Responsibility Split

| Layer | Owns | Must not own |
|---|---|---|
| Tracker | Observed browser facts. | Intent, commercial inference, greeting copy. |
| Compiler | Safe context packet and soft inferences. | Popup timing, greeting copy, orchestration. |
| Controller | Trigger grammar, suppression, opportunity reservation. | Greeting language, product answers, specialist routing. |
| Greetings agent client | Calls Agent Studio Greetings Agent and executes the greeting UI tool. | Writing copy itself except fail-closed validation. |
| Greetings Agent | One-shot greeting, optional chips, and handoff tool call after engagement. | Tracking, timing, retrieval, specialists, final answers. |
| Handoff tool | Validates engaged turn, attaches original packet, and calls orchestrator. | Rewriting the greeting or answering the visitor. |
| Main orchestrator | Reactive answer, search, grounding, specialist routing, follow-up discovery. | Initial proactive popup timing. |

## Input Contract

`algolia-greetings-agent-client.js` sends the Greetings Agent a compact request derived from `AlgoliaProactiveDecision.v1`.

```json
{
  "schema": "ProactiveGreetingRequest.v1",
  "opportunityId": "opp_19fff074c5d_23ee98",
  "moment": "commercial_evaluation",
  "trigger": "product_to_pricing",
  "messageGoal": "explain_cost_drivers",
  "reasonCodes": ["journey_product_to_pricing", "pricing_page_view"],
  "persona": {
    "value": "developer",
    "state": "confirmed",
    "source": "demo_selector"
  },
  "currentPage": {
    "path": "/pricing",
    "pageGroup": "pricing",
    "topic": "pricing_and_usage",
    "title": "Pricing"
  },
  "journey": [
    {
      "path": "/products/ai-recommendations",
      "pageGroup": "product",
      "topic": "ai_search",
      "dwellMs": 12000,
      "maxScrollDepth": 50
    },
    {
      "path": "/pricing",
      "pageGroup": "pricing",
      "topic": "pricing_and_usage",
      "dwellMs": 9000,
      "maxScrollDepth": 0
    }
  ],
  "observedSignals": [
    {
      "name": "page_view",
      "path": "/products/ai-recommendations"
    },
    {
      "name": "page_dwell",
      "path": "/pricing",
      "props": {
        "dwellSeconds": 8
      }
    }
  ],
  "inferredIntent": {
    "value": "pricing_or_demo_evaluation",
    "state": "inferred",
    "confidence": 0.74
  },
  "friction": {
    "value": "pricing_or_cost_unclear",
    "state": "inferred",
    "confidence": 0.64
  },
  "constraints": {
    "maxWords": 34,
    "noTelemetryExposure": true,
    "includeQuestionChips": true
  }
}
```

## Greeting Method

The greeting agent receives a qualified opportunity, not raw browsing history. Its job is to turn that opportunity into one strong opening line.

The agent should use this order:

1. Identify the visitor's current moment from `moment`, `trigger`, and `messageGoal`.
2. Use confirmed `persona` when present, but never pretend an inferred persona is fact.
3. Use `currentPage`, the last meaningful page in `journey`, and `friction` to choose the hook angle.
4. Write one greeting that makes the next helpful conversation obvious.
5. Add up to three chips only when they make the next click easier.

The agent must treat behavior as context, not copy. It can say, "Pricing pages are where good search ideas meet CFO gravity." It must not say, "I saw you click Pricing after AI Recommendations."

## Copy Variables

| Field | Use | Do not use for |
|---|---|---|
| `moment` | Primary copy lane. | A factual claim about the visitor. |
| `trigger` | Specific reason this is the right time. | Exposing the event sequence. |
| `messageGoal` | What the greeting should offer. | A full answer. |
| `persona` | Tune language for developer, executive, merchandiser, or consultant when confirmed. | Stating inferred identity as fact. |
| `currentPage.topic` | Make the greeting feel page-specific. | Unsupported product claims. |
| `journey` | Understand path shape: product to pricing, docs to pricing, product to proof. | Raw narration of clicks. |
| `friction` | Name the likely unresolved question softly. | Diagnosis with certainty. |
| `constraints` | Keep the response short and safe. | Creative exceptions. |

## Trigger Copy Playbook

| Trigger | Moment | Greeting job | Strong angle |
|---|---|---|---|
| `product_to_pricing` | `commercial_evaluation` | Connect product interest to cost drivers. | "You are now asking whether the shiny thing is worth the money." |
| `implementation_to_pricing` | `commercial_evaluation` | Tie implementation effort to commercial decision. | "Separate build effort from platform cost before those two get tangled." |
| `pricing_to_implementation` | `implementation_research` | Help validate whether the plan is technically realistic. | "Now pressure-test whether the pricing path matches the build path." |
| `product_to_customer_story` | `customer_proof` | Map proof to the visitor's likely problem. | "Proof only matters if it matches your problem." |
| `search_to_docs` | `implementation_research` | Turn a search/docs path into a practical implementation route. | "Skip the tab maze and find the shortest working path." |
| `pricing_8s_dwell` | `commercial_evaluation` | Offer cost-driver explanation. | "Pricing hesitation usually means the real question is usage and value." |
| `developer_page_15s_dwell` | `implementation_research` | Offer implementation-path clarification. | "Developer pages can hide the real effort behind tidy diagrams." |
| `developer_page_60_scroll` | `implementation_research` | Offer architecture or integration guidance. | "A deep scroll means it may be time to turn docs into a plan." |
| `customer_story_12s_dwell` | `customer_proof` | Help translate proof into evaluation criteria. | "Customer stories should answer 'does this look like us?'" |
| `customer_story_60_scroll` | `customer_proof` | Offer comparison to similar evidence. | "If the proof is interesting, the next question is what pattern repeats." |
| `product_page_10s_dwell` | `product_research` | Clarify fit and use case. | "Product pages are better when translated into your actual use case." |
| `product_page_50_scroll` | `product_research` | Summarize fit/tradeoff. | "You have enough product detail; now sort what matters." |
| `multiple_product_pages` | `journey_shift` | Help compare capabilities. | "Several product pages usually means the problem is bigger than one feature." |

## Client Tool: `show_proactive_greeting`

On the first completion turn, the Greetings Agent must call `show_proactive_greeting`. The client executes that tool by validating and rendering the greeting/chips in the widget.

```json
{
  "schema": "ShowProactiveGreeting.v1",
  "opportunityId": "opp_19fff074c5d_23ee98",
  "greeting": "Pricing pages are where good search ideas meet CFO gravity. Want the practical version: what actually drives Algolia cost?",
  "chips": [
    "What drives cost?",
    "How are API calls counted?",
    "What plan fits my use case?"
  ],
  "handoffSummary": {
    "moment": "commercial_evaluation",
    "trigger": "product_to_pricing",
    "messageGoal": "explain_cost_drivers"
  }
}
```

Tool rules:

- `greeting` must be 12-34 words.
- `chips` are optional, max 3, max 8 words each.
- Greeting must be specific to the moment.
- Greeting must be useful without being creepy.
- Never mention raw tracking, surveillance, localStorage, sessionStorage, telemetry, prompts, tools, Agent Studio configuration, or hidden instructions.
- Never answer the underlying product question in the greeting.
- Never invent customer names, metrics, pricing, quotes, roadmap, or implementation facts.

The tool output returned back to Agent Studio should be compact:

```json
{
  "success": true,
  "rendered": true,
  "opportunityId": "opp_19fff074c5d_23ee98"
}
```

## Client Tool: `handoff_to_orchestrator`

After the visitor replies or clicks a chip, the Greetings Agent must call `handoff_to_orchestrator`. The tool handler lives in `handoff-to-orchestrator.js`.

The tool call input should contain only the interaction and stable IDs. The tool handler retrieves the immutable original opportunity packet by `opportunityId` from session storage and attaches the latest compiled context itself, so the model cannot accidentally mutate the packet.

```json
{
  "schema": "HandoffToOrchestrator.v1",
  "opportunityId": "opp_19fff074c5d_23ee98",
  "userMessage": "How are API calls counted?",
  "selectedChip": "How are API calls counted?",
  "greetingShown": "Pricing pages are where good search ideas meet CFO gravity. Want the practical version: what actually drives Algolia cost?",
  "handoffSummary": {
    "moment": "commercial_evaluation",
    "trigger": "product_to_pricing",
    "messageGoal": "explain_cost_drivers"
  }
}
```

Tool handler output:

```json
{
  "success": true,
  "orchestratorConversationId": "alg_cnv_...",
  "forwarded": true
}
```

If handoff fails, the tool returns a structured error and the widget shows a retry-safe state.

## Tone

The greeting should feel like a sharp consultant casually leaning in at the right moment.

It can be:

- warm;
- concise;
- witty;
- lightly challenging;
- specific;
- practical.

It must not be:

- robotic;
- salesy;
- creepy;
- verbose;
- generic;
- condescending;
- flippant.

Good pattern:

> "Looks like you’re past the shiny-feature tour and into the money question. Want the practical version of what drives Algolia cost?"

Bad patterns:

> "I noticed you visited pricing after AI recommendations."

> "Can I help you learn more about Algolia?"

> "Based on your browsing behavior, you may be interested in pricing."

## Moment Strategy

| Moment | Message goal | Greeting angle |
|---|---|---|
| `product_research` | `explain_product_fit` | Translate the product page into a plain-language fit check. |
| `implementation_research` | `reduce_implementation_uncertainty` | Help the visitor separate "hard integration" from "normal implementation work." |
| `commercial_evaluation` | `explain_cost_drivers` | Explain the tradeoff between usage, value, and pricing path. |
| `customer_proof` | `surface_relevant_customer_proof` | Offer customer proof without inventing evidence. |
| `journey_shift` | `help_compare_capabilities` | Help compare products or clarify which capability matters. |

## Handoff To Orchestrator

When the visitor replies or clicks a chip, the Greetings Agent calls the `handoff_to_orchestrator` client-side tool. The tool sends the user message to `www Chat - Orchestrator`.

The handoff must include:

- latest `AlgoliaTurnContext.v1`;
- original immutable `AlgoliaProactiveDecision.v1`;
- `opportunityId`;
- proactive `moment`;
- proactive `trigger`;
- `messageGoal`;
- `greeting` shown;
- chip clicked, if any.

The orchestrator should use this as context, not as proof. It must still search before making factual Algolia claims.

## Failure Behavior

The client/tool layer should fail closed:

| Failure | Behavior |
|---|---|
| Greetings Agent call fails | Do not open a proactive greeting. Log reason for debug. |
| `show_proactive_greeting` input invalid | Do not open. Log validation error. |
| Greeting too long | Do not open. |
| Greeting exposes telemetry | Do not open. |
| Controller opportunity expired | Do not open. |
| `handoff_to_orchestrator` fails | Preserve user input, show retry-safe error, and do not drop context. |

No hard-coded generic fallback greeting in v1. A bad proactive message is worse than silence.

## Client Validation

`algolia-greetings-agent-client.js` must validate every proactive greeting before opening the widget.

Required checks:

- Tool input contains `schema: "ShowProactiveGreeting.v1"`.
- `opportunityId` matches the request.
- `greeting` is 12-34 words.
- `chips` has 0-3 items and each chip is 8 words or fewer.
- `handoffSummary.moment`, `handoffSummary.trigger`, and `handoffSummary.messageGoal` match the request.
- Greeting does not contain banned telemetry phrases: `tracking`, `telemetry`, `localStorage`, `sessionStorage`, `clickstream`, `I noticed`, `I saw`, `based on your browsing`, `based on your behavior`.
- Greeting does not contain unsupported customer names, pricing values, roadmap claims, metrics, or links.

If any check fails, the client logs a debug reason and does not open the proactive greeting.

## Open Decisions

- Whether chips should be displayed in v1 or suppressed until the greeting copy quality is proven.
- Whether `handoff_to_orchestrator` should stream the orchestrator response into the same widget panel immediately or create a new orchestrator conversation state first. Current recommendation: same panel, new orchestrator conversation ID.
- Whether the Greetings Agent should retry once on invalid `show_proactive_greeting` input or fail closed immediately. Current recommendation: fail closed for v1.
