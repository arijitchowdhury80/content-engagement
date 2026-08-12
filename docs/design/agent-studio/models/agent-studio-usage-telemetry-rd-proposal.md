---
title: "Agent Studio Usage Telemetry"
description: "R&D proposal to extend Agent Studio Analytics with turn-level search usage, LLM economics, and traceability"
status: proposal
date: 2026-08-12
scope: "Agent Studio product proposal, informed by the Algolia.com chat widget spike"
related_asana: "2.2 Algolia Query Metering; 2.3 Token & Cost Economics; 2.4 End-to-End Turn Observability & Traceability"
asana_task_2_2: "https://app.asana.com/0/0/1217389911359035/f"
asana_task_2_2_1: "https://app.asana.com/0/0/1217389989753201/f"
asana_task_2_2_2: "https://app.asana.com/0/0/1217389911594494/f"
asana_task_2_3: "https://app.asana.com/0/0/1217389957695997/f"
asana_task_2_3_1: "https://app.asana.com/0/0/1217389831395535/f"
asana_task_2_3_2: "https://app.asana.com/0/0/1217389911611814/f"
---

# Agent Studio Usage Telemetry

## Proposal in one sentence

Extend the Agent Studio Analytics and Conversations features that already exist. Let customers see
the search work, LLM token use, estimated cost, and trace for each conversation and turn, then
roll the same facts up by agent, tenant, and date.

This is not a new chat-widget backend. It applies to every Agent Studio use case: a shopping
assistant, content assistant, conversational search, internal knowledge assistant, or custom
workflow. The chat widget is a useful product spike, not the system of record.

This proposal guides [2.2 Algolia Query Metering](https://app.asana.com/0/0/1217389911359035/f),
[2.3 Token & Cost Economics](https://app.asana.com/0/0/1217389957695997/f), and 2.4 end-to-end
traceability. It is a product enhancement proposal, not a claim that those workstreams are complete.

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

Agent Studio also already provides the first correlation key that the original proposal treated as a
future requirement. It persists a conversation for every completion request with messages and
returns its ID in the `X-Conversation-Id` response header. A client can instead supply the
conversation and message IDs itself. This means the Algolia.com widget can associate its own browser
completion legs with a stored conversation today, after a browser-readability check for that header
and after it keeps the same conversation/message IDs across turns. It does not mean that the widget
can see Agent Studio's internal Search API work or price calculation.

## Current scope assessment: 2.2 and 2.3

The screenshots and live API evidence change the delivery shape. Most aggregate measurement and
conversation persistence already exist in Agent Studio. We should extend those surfaces, not build a
second telemetry service beside them.

| Asana task | Already in Agent Studio | Still needed in the Algolia.com spike | Still needed from Agent Studio R&D |
|---|---|---|---|
| [2.2.1 Boundary and contract](https://app.asana.com/0/0/1217389989753201/f) | Analytics defines a Search call as a built-in Search-tool invocation; Conversations persist tool calls and metadata | Record the exact unit labels and prove source pills/suggestions do not create a request | Publish the same definitions in API schemas and analytics help text |
| [2.2.2 Instrument and reconcile](https://app.asana.com/0/0/1217389911594494/f) | Aggregate Search calls by date and agent; per-conversation Search-query total; conversation ID response header | Capture safe browser completion observations, retain the conversation ID, and run the negative network proofs | Persist per-turn Search-tool, logical-query-plan, actual Search API request, cache/retry, index, and billing-reconciliation trace |
| [2.3.1 Token capture and prices](https://app.asana.com/0/0/1217389831395535/f) | Aggregate input/output tokens and averages; conversation and message token totals; cached-input/reasoning fields when supplied | Verify the response/header and conversation fields on real widget turns; do not invent a client tokenizer | Persist token provenance and resolved provider/model version; maintain a versioned price registry with effective dates |
| [2.3.2 Economics and reconciliation](https://app.asana.com/0/0/1217389911611814/f) | Analytics overview, per-agent token totals, conversation JSON export | Reconcile the widget turn to the stored conversation and show only values with an authority | Add per-turn/per-agent cost, reported-versus-estimated basis, price version, CSV/usage export, estimator error, and supported Analytics API |

### What is already solved

- Agent Studio already collects multi-user, server-side aggregate conversations, token usage, and
  Search-tool calls. The dashboard filters by time period and agent.
- It already shows a conversation's input/output token total and Search-query total, and it exports
  stored conversations as JSON for operators.
- Its conversation API exposes per-message token counts, tool calls, tool results, and timestamps.
- A secure user JWT can scope conversation retrieval to one end user. The dashboard/operator path
  remains separate and must keep its `logs` access server-side.

### What is not solved

- The dashboard's **Search calls** metric is a Search-tool call count. It is not a count of logical
  query items, Search API requests, or billed requests.
- Current conversation data does not show a complete request-level execution trace or safely assign a
  billing unit to one turn.
- Token totals exist, but the checked stored assistant message did not expose the resolved billed
  model. Therefore a customer-facing cost cannot yet be provider-reported.
- There is no documented Agent Studio Analytics API that returns the dashboard's aggregate metrics
  or a filtered turn-level drill-down. Conversation APIs and JSON export are useful inputs, not a
  substitute.
- The existing UI does not link a conversation's short summary to a turn-level Analytics view.

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

### Why this is an R&D enhancement, not an answer-quality feature

This proposal does not change retrieval quality, grounding, or the answer a visitor receives. Agent
Studio already performs that work and already records useful aggregate analytics. The value is
operational: it lets a customer and Algolia understand the units that drive future capacity and cost
estimates without confusing them with one another.

For example, a customer can currently see that an agent made Search-tool calls. The proposed
Conversation drill-down would explain which turn made them and whether the number represents a tool
invocation, a planned query, an observed API request, or a contract-billable request. The proposed
LLM extension would add the pricing basis and model provenance needed to turn token totals into an
honest sizing estimate.

The product recommendation is deliberately phased:

1. **Useful dashboard enhancement:** extend existing Conversations and Analytics with a per-turn
   Search-tool and token breakdown, precise labels, and an estimated-cost basis where the resolved
   model and price registry are known. This is the immediate value for capacity planning, agent
   optimization, and customer conversations.
2. **Execution and billing reconciliation:** add server-side Search API request, cache, retry, and
   contract-aware billing fields only where Agent Studio can authoritatively provide them. This is a
   later operational and enterprise-accounting capability; it must remain unavailable rather than
   estimated when the platform cannot assign it safely to one turn.

Neither phase requires a widget-owned telemetry collector. The widget spike can validate the
existing Conversation join and provide product evidence, but Agent Studio remains the system of
record.

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
2. Document and expose the existing multi-turn conversation/message ID contract, including CORS-safe
   access to `X-Conversation-Id` for browser clients that use it.
3. Persist normalized per-turn usage and trace fields from the server-side execution path.
4. Add the compact Usage summary and deep link to the Conversation view.
5. Add the filtered conversation drill-down inside Analytics.
6. Extend JSON export and provide a supported Analytics API with the same definitions.
7. Add a versioned price registry and label every cost as reported or estimated.
8. Reconcile aggregate search usage against account-level Usage API and contract data without
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
