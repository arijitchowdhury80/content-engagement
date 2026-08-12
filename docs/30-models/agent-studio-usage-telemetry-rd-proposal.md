---
title: "Agent Studio Usage Telemetry"
description: "R&D proposal to extend Agent Studio Analytics with turn-level search usage, LLM economics, and traceability"
status: proposal
date: 2026-08-12
scope: "Agent Studio product proposal, informed by the Algolia.com chat widget spike"
related_asana: "2.2 Algolia Query Metering; 2.3 Token & Cost Economics; 2.4 End-to-End Turn Observability & Traceability"
asana_task_2_2_2: "https://app.asana.com/0/0/1217389911594494/f"
---

# Agent Studio Usage Telemetry

## Proposal in one sentence

Extend the Agent Studio Analytics and Conversations features that already exist. Let customers see
the search work, LLM token use, estimated cost, and trace for each conversation and turn, then
roll the same facts up by agent, tenant, and date.

This is not a new chat-widget backend. It applies to every Agent Studio use case: a shopping
assistant, content assistant, conversational search, internal knowledge assistant, or custom
workflow. The chat widget is a useful product spike, not the system of record.

The first delivery track is [Asana 2.2.2: Instrument, display, and reconcile Algolia
operations](https://app.asana.com/0/0/1217389911594494/f). This proposal is also the shared product
direction for 2.3 token and cost economics and 2.4 end-to-end traceability.

## What exists today

Agent Studio already has the hard part: a server-side, multi-user conversation and analytics
foundation. The current [Analytics documentation](https://www.algolia.com/doc/guides/algolia-ai/agent-studio/how-to/analytics)
describes aggregate conversations, input tokens, output tokens, and Search-tool calls.

The live Analytics screen in the Flagship - Accelerator Program account confirms that foundation.
It shows totals and daily charts for conversations, input and output tokens, Search calls, feedback,
block rates, latency, conversation depth, and an agent-by-agent breakdown. The Conversations screen
already shows one conversation's token totals, Search queries, transcript, feedback, and JSON export.

A read-only check of a real stored conversation confirmed that Agent Studio persists:

| Stored fact | What it gives us |
|---|---|
| Conversation totals and timestamps | A durable conversation summary |
| Per-message input and output tokens | Turn-level token measurement |
| Cached-input and reasoning-token details | A better token breakdown when the provider supplies it |
| Tool-call and tool-result parts | A trace of which tools the agent used |
| Search-tool arguments and resolved search parameters | A way to explain the agent's search plan without copying the prompt into analytics |

In the checked conversation, the agent made three total tool calls: two built-in Algolia Search-tool
calls and one non-search tool call. The conversation screen reports two Search queries, which matches
the two Search-tool calls. Those two tool calls contained four logical query-plan items in total.

That is an important result: a visitor turn, a Search-tool call, a logical query-plan item, a Search
API request, and a billed search request are not automatically the same number.

## The problem to solve

Today's aggregate Analytics page answers, "How much did this agent use?" The Conversations page
answers, "What did this person and agent say?"

Customers still cannot reliably answer these practical questions:

- What happened in this one turn?
- How many times did the agent choose the Search tool?
- How many logical searches did it plan, and how many requests reached the Search API?
- What did the model use in input, output, cached, and reasoning tokens?
- What did that work cost, and is that number reported or estimated?
- Can the conversation detail, Analytics total, and billing record be reconciled?

The value is not another dashboard for its own sake. It is one clear line from a visible answer to
the search and model work behind it.

## The measurement model

The product must label each unit plainly. It must never turn one into another just because they are
close.

| Unit | Meaning | Why it matters |
|---|---|---|
| Visitor turn | One submitted natural-language message or proactive action | Explains what the visitor did |
| Search-tool call | One time the agent invokes its built-in Algolia Search tool | This is the current Agent Studio Analytics Search calls measure |
| Logical query-plan item | One query object inside a Search-tool call | Explains what the tool planned to search |
| Search API request | One request that actually reaches Algolia Search | Explains technical retrieval traffic |
| Billed search request | The unit counted under the customer's contract | Explains possible Algolia cost |
| LLM usage | Provider-reported token use, or a documented estimate | Explains model use and cost |

The [Agent Studio Search tool](https://www.algolia.com/doc/guides/algolia-ai/agent-studio/how-to/tools/algolia-search)
can search several indices in parallel or in sequence. It may also make more than one tool call in a
single turn. Therefore, one visitor message is not automatically one retrieval or one billed
request.

Search-as-you-type is different. It can send a request for each debounced text change. An Agent
Studio visitor normally sends one finished natural-language turn. The agent may then choose to make
zero, one, or several Search-tool calls. The act of typing is not an Agent Studio retrieval.

Source pills do not count as retrievals. They are display metadata from results already returned.
The spike must prove with browser-network evidence that opening or rendering a source pill does not
send another Algolia request. Suggested follow-up questions are counted only when they cause a real
Search-tool call or request.

## What we know and what is missing

The existing conversation record is a strong base, but it is not yet a complete economics trace.

| Question | Available now | Needed enhancement |
|---|---|---|
| Token totals by conversation and message | Yes | Keep the current fields and expose them in a stable usage object |
| Cached and reasoning tokens | Present when supplied | Preserve the source and availability for each value |
| Search-tool calls | Yes | Name this exact unit clearly in the API and UI |
| Logical query-plan items | Derivable from stored tool arguments | Store a normalized count so exports do not require callers to parse tool parts |
| Actual Search API requests | Not present in the checked conversation record | Add request-level IDs, outcome, cache state, and request count from the server-side tool execution |
| Billed search requests | Not assignable to a conversation today | Reconcile against contract-aware usage data; do not invent a per-turn billable count |
| Exact provider model and cost | Not complete | Persist the resolved provider and exact model version used for each completion, then apply a versioned price registry |
| Analytics for one conversation via API | Conversation data is available | Add a supported Analytics API filtered by conversation and turn |

The checked assistant message had token totals but no resolved model value. The agent configuration
uses a provider and the friendly model alias medium; the provider-model API returns the aliases
medium and small, not an exact billed model and price. A customer-facing cost cannot honestly be
called reported until the resolved model and provider usage are persisted. Until then it must be
called estimated and show the price-registry version used.

The [Usage API](https://www.algolia.com/doc/rest-api/usage) is useful for app-level reconciliation.
It reports totals such as search requests and search operations over a time window. It cannot, by
itself, assign billed usage to a particular conversation or turn. Current public pricing also says
that a federated search across three active indices counts as one search request, which is another
reason not to multiply a cost by the number of indices or result chunks.

## Product shape

Use the two surfaces customers already understand. Do not create a third telemetry application.

~~~mermaid
flowchart LR
  C["Agent Studio conversation"] --> S["Compact usage summary"]
  S --> A["Agent Studio Analytics: conversation drill-down"]
  E["Agent execution"] --> R["Conversation record and trace"]
  R --> S
  R --> A
  A --> X["JSON export and supported Analytics API"]
  A --> U["Tenant and agent rollups"]
  U --> B["Contract-aware usage reconciliation"]
~~~

### 1. Conversation view: the short receipt

Keep the current conversation page focused on the actual conversation. Add a small **Usage** summary
next to the existing token and Search-query information:

- Search-tool calls
- Logical query-plan items
- Search API requests, when the server recorded them
- Input, output, cached, and reasoning tokens
- LLM cost with a clear reported or estimated label
- A **View telemetry** link

The link opens Agent Studio Analytics already filtered to the agent and conversation. It does not
open a separate product and it does not require the visitor to opt in before the system records
usage.

### 2. Analytics: the full explanation

Add a conversation drill-down to the existing Analytics area. The default Analytics overview stays
as it is. When a practitioner selects an agent and conversation, show:

- one row for every turn, in time order;
- the agent, tool, phase, status, duration, and retry outcome;
- token and cost breakdown by completion;
- Search-tool calls, query-plan items, actual API requests, and reconciled billing data as separate
  columns;
- request and correlation IDs when available; and
- rollups for the selected conversation, agent, and date range.

This makes the conversation page a good starting point and Analytics the right place to investigate.
It also keeps the existing aggregate charts and agent breakdown useful for operators.

### 3. JSON and APIs: the same facts for customers and practitioners

The current [Get conversation API](https://www.algolia.com/doc/rest-api/agent-studio/conversations/get-conversation)
returns a conversation record. The [Export conversations API](https://www.algolia.com/doc/rest-api/agent-studio/conversations/export-conversations)
provides an export for operators with the required logs ACL. These are the right starting points,
but callers should not have to reverse-engineer usage by parsing tool parts.

Add a stable usage and trace object to each exported conversation and message. It should contain
only measurements and identifiers, not a second copy of the prompt or response text.

~~~json
{
  "usage": {
    "inputTokens": 33204,
    "outputTokens": 1139,
    "cachedInputTokens": 0,
    "reasoningTokens": 0,
    "cost": {
      "amount": 0.00,
      "currency": "USD",
      "basis": "estimated",
      "priceRegistryVersion": "2026-08-12"
    }
  },
  "trace": {
    "searchToolCalls": 2,
    "logicalQueryPlanItems": 4,
    "observedSearchApiRequests": null,
    "reconciledBilledSearchRequests": null
  }
}
~~~

The numbers above illustrate the shape only. Null means the value was not measured or cannot yet
be assigned safely. It must not be replaced with zero.

Add a first-class Agent Studio Analytics API for the dashboard's current metrics and the drill-down.
This is a proposed API, not an existing endpoint. It should support filters for agent ID,
conversation ID, turn ID, and date range, then return the same definitions used by the web UI and
JSON export.

For end users, conversation access remains user-scoped through a secure user JWT with the required
search ACL. For internal practitioners and customer operators, the logs ACL permits broader
conversation access and export. A logs key must remain server-side. This is the existing security
model described in the [Conversations guide](https://www.algolia.com/doc/guides/algolia-ai/agent-studio/how-to/conversations),
not a new browser-side admin channel.

## Data ownership and privacy

Agent Studio should remain the server-side system of record for Agent Studio work. It already sees
the execution, conversation, tokens, and Search-tool calls across every customer and user.

The chat widget can later show a personal usage drawer for the current session. That drawer is a
presentation feature. It can add browser-only facts such as rendering time, but it must not become
the authority for retrieval counts, token totals, or billing.

The telemetry record should avoid raw prompt text, answer text, IP address, email address, and user
profile data by default. Use existing conversation, agent, tenant, user-token, turn, and request
identifiers for joins. Any decision to retain readable text in a shared reporting system needs its
own privacy and retention review.

## R&D deliverables

1. Document the current definitions and data source for every Agent Studio Analytics metric.
2. Persist normalized per-turn usage and trace fields from the server-side execution path.
3. Add the compact Usage summary and deep link to the Conversation view.
4. Add the filtered conversation drill-down inside Analytics.
5. Extend JSON export and provide a supported Analytics API with the same definitions.
6. Add a versioned price registry and label every cost as reported or estimated.
7. Reconcile aggregate search usage against account-level Usage API and contract data without
   claiming unsupported per-turn billing precision.

## Spike proof points

The Algolia.com spike should prove the proposal without pretending that it is already a global
telemetry service:

- Source pills make no extra Algolia request.
- Follow-up suggestions are metered only when they actually retrieve.
- A visitor turn, Search-tool call, query-plan item, API request, and billed request stay separate.
- Primary, specialist, and judge agent work can be distinguished.
- Retries, cache hits, failures, cancellations, resets, and long conversations do not double-count.
- Provider-reported tokens are preserved; estimates are visibly labeled.
- The Conversation summary, Analytics drill-down, export, and aggregate rollups agree.

## R&D ask

Treat Agent Studio Usage Telemetry as an enhancement to Agent Studio Analytics and Conversations,
not a widget-only feature and not a duplicate collector. The product already has the right
foundation. R&D should add the missing trace, economics, definitions, drill-down, and API so every
Agent Studio customer can understand the retrieval and model work behind every answer.
