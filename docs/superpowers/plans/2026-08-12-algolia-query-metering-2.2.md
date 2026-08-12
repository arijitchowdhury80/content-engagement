# Algolia Query Metering (2.2) Design and Evidence Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task by task. Steps use checkbox syntax for tracking.

**Goal:** Show truthful per-turn and conversation-level Algolia retrieval usage for the Algolia.com chat widget, backed by browser and Agent Studio evidence.

**Architecture:** Agent Studio remains the authoritative server-side source for agent Search-tool usage. The widget records only what it directly observes: its own Agent Studio completion requests, their phases, returned result records, and non-Agent-Studio browser traffic. A reconciliation step joins that evidence to the Agent Studio conversation record. We do not add a parallel telemetry collector.

**Tech Stack:** TypeScript, React, Agent Studio completions SSE, Playwright, Vitest, Agent Studio Conversations API, Algolia Usage API.

## Global Constraints

- Scope is Algolia.com only. Do not inspect, use, or modify Spectrum.
- Do not modify host HTML. The widget/runtime owns behavior and UI.
- Production Ask Algolia is read-only comparison evidence.
- Use App ID `0EXRPAXB56` and the existing `www Chat - Orchestrator` test path only.
- Preserve unrelated work in both repositories.
- Never label a source count, tool count, or completion count as a billed search request.
- Never expose an Admin or `logs` API key in the browser.
- Do not add a client-to-server usage collector. Agent Studio owns the durable usage record.
- A passing unit test or document does not close 2.2.2. Browser and Agent Studio reconciliation are required.

---

## 1. Decision Summary

This design supports:

- **2.2.1 Define query-metering boundary and telemetry contract**
- **2.2.2 Instrument, display, and reconcile Algolia operations**

It deliberately does not implement 2.3 cost or 2.4 full traceability. It creates the contract those
workstreams will use.

The central finding is that the current widget has a field called `searchCount`, but it is not a
search-request counter. In
`chat-central/src/chat/turnRunner.ts`, `sourcesPatch()` sets it from normalized, grouped source
records. It is a display count of returned sources. It must remain available as a source count, but
it cannot be used for query metering.

The current Agent Studio conversation record supplies a better server-side starting point. A
read-only record check showed two Algolia Search-tool calls, three total tool calls, and four logical
query-plan items in one conversation. That proves that those three numbers differ before we even
consider Search API requests or billing.

## 2. Canonical Measurement Contract

| Unit | Definition | Authority | May be displayed as |
|---|---|---|---|
| Visitor turn | One submitted chat question or proactive action | Widget state and Agent Studio conversation | Turn |
| Completion request | One browser POST to an Agent Studio agent completions endpoint | Browser network observation | Agent Studio request |
| Search-tool call | One invocation of Agent Studio's built-in Algolia Search tool | Agent Studio conversation/analytics | Search-tool call |
| Logical query-plan item | One query object inside a Search-tool call | Agent Studio tool arguments | Query plan |
| Search API request | One request that reaches an Algolia Search endpoint | Request-level Agent Studio execution data or direct browser network evidence | Search API request |
| Billed search request | A contract-defined billing unit | Contract-aware account usage reconciliation | Billed search request |
| Returned source record | One record returned in a tool output, before or after source normalization | Widget SSE parser | Source record |

The UI must use these labels exactly. It must not use the vague word "query" alone.

### Current truth levels

| Metric | Current status | Rule |
|---|---|---|
| Completion request | Observable in the browser | Count directly and attribute by agent, phase, and turn |
| Returned source record | Observable in the completion SSE | Count separately from all retrieval measures |
| Normalized source count | Observable in the widget | Keep as source display information only |
| Search-tool call | Available after Agent Studio stores the conversation | Reconcile post-turn; do not infer from source records |
| Logical query-plan item | Derivable from stored Search-tool arguments | Normalise for evidence, not billing |
| Search API request | Not available in the checked widget or conversation record | Report as unavailable until server-side evidence exists |
| Billed search request | Not attributable to one conversation today | Reconcile only at an aggregate time window; never estimate per turn |

## 3. Data Map

| Layer | Current file or API | Fact available now | What it cannot prove |
|---|---|---|---|
| Browser completion transport | `chat-central/src/shared/agentStudio.ts` | Every browser-direct POST to an agent completions endpoint, response status, response headers, and SSE body | Internal Agent Studio search work |
| Widget turn orchestration | `chat-central/src/chat/turnRunner.ts` | Primary and specialist execution legs; Person prefetch happens before the primary turn | A built-in Search-tool call inside Agent Studio |
| Widget turn state | `chat-central/src/chat/types.ts` | Turn, segment, agent, lifecycle, raw hits, normalized sources | Conversation ID, request ID, or billable usage |
| Source rendering | `chat-central/src/chat/components/SourcePills.tsx` | Rendering and opening a source pill | A retrieval; source pills should create no search request |
| Person intelligence | `chat-central/src/person/personAgent.ts` | Person sub-agent, retry, cache hit/miss, and orchestrator completion legs | Search usage inside those agents |
| Specialist handoff | `chat-central/src/chat/turnRunner.ts` | A separate specialist completion leg after consent | Search usage inside the specialist |
| Judge path | `chat-central/src/judge/hostedJudgeClient.ts` and `chat-central/src/judge/chiefJudge.ts` | Hosted judge HTTP calls or Agent Studio judge completions | Search usage unless the judge has its own Search tool |
| Agent Studio conversation | Get Conversation API | Stored messages, token totals, tool parts, Search-tool arguments, conversation totals | Exact Search API request count, billed request count, resolved per-message model/cost |
| Account usage | Usage API | Aggregate search operations and search requests for a time period | Assignment to a conversation, turn, or tool call |

### Browser traffic classification

The network probe must classify every relevant request into one of these categories:

| Category | URL or behavior | Included in 2.2 retrieval total? |
|---|---|---|
| `agent_completion` | `/agent-studio/1/agents/{agentId}/completions` | No. Count separately as a completion request |
| `direct_search` | A browser request to an Algolia Search endpoint | Yes, as an observed Search API request |
| `page_search_or_autocomplete` | Host page search, search-as-you-type, or autocomplete traffic | No. Record separately to prove exclusion |
| `insights_or_analytics` | Insights, click, conversion, view, or analytics traffic | No |
| `hosted_judge` | The judge HTTP service | No |
| `other` | Any unclassified request | No until classified |

Agent Studio's built-in Search tool runs behind a browser completion request. The absence of a
browser-direct Search API request does not mean the agent made no retrieval. It means the browser
cannot see that internal request.

## 4. Wire-Level Proof Plan

### Safe capture rules

- Use the Algolia.com local test surface only.
- Capture request method, URL class, agent ID, start/end time, HTTP status, response headers,
  completion sequence, and a SHA-256 hash of the request body.
- Do not save raw prompts, answer text, IP address, user token, API keys, cookies, or response bodies
  in committed evidence.
- Save temporary raw capture files under `/tmp/algolia-query-metering/<run-id>/`.
- Commit only redacted summaries, screenshots, and assertions that do not include visitor content.
- Obtain conversation detail with a server-side or local operator script only. Never call a logs ACL
  endpoint from the widget.

### Correlation chain

1. Generate a local `probeRunId` and a sequential `browserRequestId`.
2. Record each browser completion request with its agent ID, role, phase, and request-body hash.
3. Record response status and safe response headers, including correlation or request IDs when present.
4. Parse the SSE stream without changing response handling. Preserve start and tool metadata only when
   the frame actually contains it.
5. Record the widget turn and segment IDs that initiated the request.
6. After the turn settles, fetch the matching Agent Studio conversation through an operator-only path.
7. Compare the browser completion legs with stored Search-tool calls and query-plan items.
8. Compare the aggregate time window with Usage API/account evidence when access permits.
9. Mark missing facts as unavailable. Do not replace missing data with zero.

### Required scenarios

| Scenario | Browser evidence | Agent Studio evidence | Passing condition |
|---|---|---|---|
| Primary answer with search | Primary completion leg | Search-tool calls and arguments | Counts agree at their own measurement levels |
| Primary answer without search | Primary completion leg | Zero Search-tool calls | No source count is presented as a search call |
| Source pills render and open | No new classified retrieval request | No new Search-tool call | Pill interaction adds zero retrieval traffic |
| Follow-up generated but not clicked | No new completion after answer | No new Search-tool call | Suggestions alone add zero |
| Follow-up clicked | New primary completion leg | New turn and any Search-tool calls | Counts attach to the new turn only |
| Person cache miss | Person sub-agent and Person orchestrator legs | Agent Studio records for those agents | Person work is separated from primary work |
| Person cache hit | No duplicate Person completion legs | No duplicate Person work | Cache state is visible in evidence |
| Specialist accepted | Primary and specialist legs | Specialist Search-tool calls separated | No double-counting into primary |
| Judge run | Judge service or judge agent leg | Judge work separately attributed | Judge traffic is not treated as retrieval by default |
| Retry or failure | Multiple attempts and status | Attempts retained | Failure/retry is shown, not collapsed |
| Parallel client tools | Concurrent completion/tool evidence | Child work preserved | Each leg appears once |
| Reset and long conversation | New session state and many turns | Conversation totals remain stable | No leakage or double-counting |

## 5. Widget Evidence and Display Design

### What the widget can truthfully show before R&D changes

For each visible answer segment, the widget may show an internal trust-telemetry row or drawer with:

- Agent Studio completion requests observed
- Agent and phase: primary, Person, specialist, or judge
- Completion status and retry attempt
- Returned source records
- Normalized source pills

These are valuable diagnostics, but the labels must stay precise. The existing "searched" copy driven
by `searchCount` must be renamed or separated because it means returned source records, not searches.

### What the widget must not show yet

Do not show any of the following unless the value has a server-side source:

- "Retrievals"
- "Search API requests"
- "Billable search requests"
- A dollar cost for Algolia search
- A total that merges page search, autocomplete, Insights, Person, specialist, or judge activity

### Target display after the Agent Studio join exists

Conversation/turn telemetry uses these lines:

| Label | Source | Empty state |
|---|---|---|
| Agent Studio requests observed | Widget network probe | 0 only when the widget observed none |
| Search-tool calls | Agent Studio conversation | Not available |
| Query-plan items | Agent Studio conversation | Not available |
| Search API requests | Server execution trace | Not available |
| Billed search requests | Reconciliation | Not assigned to this turn |
| Source records returned | Widget SSE parser | 0 only when no records returned |

The cumulative conversation total is the sum of the same metric across its turns. It must never sum
different units into one "query" number.

## 6. R&D Delta

These requirements cannot be completed in the Algolia.com widget repository because the widget does
not own Agent Studio's server execution trace.

1. Persist a stable conversation ID, turn ID, run ID, agent ID, phase, and retry attempt with every
   Agent Studio completion.
2. Persist each built-in Search-tool invocation with tool name, query-plan count, index list, cache
   outcome, status, error, duration, request ID, and correlation ID when available.
3. Persist the count of actual Search API requests separately from the count of Search-tool calls.
4. Provide a contract-aware reconciliation field. It may be null for a single turn when the billing
   system cannot safely assign the unit.
5. Expose a supported Analytics API filtered by agent, conversation, turn, and date range.
6. Return the conversation and run identifiers in a browser-safe completion response or provide a
   user-scoped read API that the widget can call with a secure user JWT.
7. Keep customer/operator conversation export behind existing server-side logs access.

This is an Agent Studio Analytics enhancement. It is not a request to send fabricated events through
Insights and it is not a request for a new widget-owned collector.

## 7. Implementation File Map

The first implementation must remain a small, testable vertical slice. Do not start it until this
design is approved and Asana 2.2.1 has the contract checklist.

| File | Change |
|---|---|
| Create `chat-central/src/telemetry/queryMetering.ts` | Pure types, aggregation, null-safe metric rules, and redaction helpers |
| Create `chat-central/src/__tests__/queryMetering.test.ts` | Unit coverage for aggregation, retries, unavailable values, and no unit mixing |
| Modify `chat-central/src/shared/agentStudio.ts` | Add optional safe request/response and SSE-metadata callbacks without changing completion behavior |
| Modify `chat-central/src/chat/types.ts` | Add an optional per-segment metering model; keep source counts separate |
| Modify `chat-central/src/chat/turnRunner.ts` | Attribute completion legs to turn, segment, agent, and phase; never derive retrievals from hits |
| Modify `chat-central/src/chat/components/ThinkingIndicator.tsx` | Remove ambiguous searched-count copy |
| Create `chat-central/src/chat/components/TurnUsage.tsx` | Render exact labels and unavailable states |
| Modify `chat-central/src/chat/components/ChatMessage.tsx` | Place the per-segment usage disclosure beside existing trust telemetry |
| Create `tests/query-metering.spec.ts` | Playwright wire probe with network classification and source-pill/follow-up assertions |
| Modify `chat-central/src/__tests__/agentStudio.test.ts` | Cover callback metadata, response headers, and no raw-content persistence |
| Modify `chat-central/src/__tests__/turnRunner.discovery.test.ts` | Cover primary, Person, specialist, retry, and reset attribution |
| Modify `docs/30-models/agent-studio-usage-telemetry-rd-proposal.md` | Link final browser evidence and R&D API findings after validation |

## 8. Execution Plan

### Task 1: Freeze the 2.2 contract in Asana and code

**Files:**
- Modify: Asana task 2.2.1
- Modify: Asana task 2.2.2
- Reference: `docs/30-models/agent-studio-usage-telemetry-rd-proposal.md`
- Reference: this plan

**Interfaces:**
- Produces: the canonical metric labels and each field's authority.
- Blocks: all implementation work that would show a retrieval count.

- [ ] Add this design artifact and the R&D proposal links to 2.2.1 and 2.2.2.
- [ ] Add the five measurement units and the source-count prohibition to 2.2.1.
- [ ] Add the wire-proof scenario matrix and the close condition to 2.2.2.
- [ ] Record that the current widget `searchCount` is a source-record display count.
- [ ] Record that source pills and suggestions have negative network tests.
- [ ] Commit documentation only with message: `docs: define query metering evidence plan`.

### Task 2: Add a pure widget metering model

**Files:**
- Create: `chat-central/src/telemetry/queryMetering.ts`
- Create: `chat-central/src/__tests__/queryMetering.test.ts`

**Interfaces:**
- Produces: `TurnMetering`, `MetricValue`, `CompletionObservation`, and
  `aggregateConversationMetering(turns)`.
- Consumes: explicit observations only. It must not inspect source-pill counts to create retrieval data.

- [ ] Write failing tests for a primary completion, a specialist completion, a retry, an unavailable
  Search-tool count, and a zero source-record count.
- [ ] Define a metric source union: `browser`, `agent_studio_conversation`,
  `agent_studio_execution`, and `usage_reconciliation`.
- [ ] Make every unavailable measurement `null` with a reason. Do not use zero as a default.
- [ ] Implement aggregation that adds only equal metric names and sources.
- [ ] Run: `npm test --prefix chat-central -- queryMetering`.
- [ ] Commit with message: `feat: add query metering model`.

### Task 3: Observe widget completion legs without changing the wire contract

**Files:**
- Modify: `chat-central/src/shared/agentStudio.ts`
- Modify: `chat-central/src/__tests__/agentStudio.test.ts`

**Interfaces:**
- Adds optional callbacks: `onRequest(observation)`, `onResponse(observation)`, and
  `onSseMetadata(observation)`.
- `observation` contains no raw prompt or answer text.

- [ ] Write failing tests that prove callbacks receive agent ID, method, safe URL class, status,
  duration, and safe response headers.
- [ ] Write a failing test proving raw request JSON and text deltas never enter an observation.
- [ ] Preserve existing `onText` and `onProgress` behavior exactly.
- [ ] Capture SSE start/tool metadata only when it is present; do not manufacture conversation or
  tool IDs.
- [ ] Run: `npm test --prefix chat-central -- agentStudio`.
- [ ] Commit with message: `feat: observe Agent Studio completion legs`.

### Task 4: Attribute observations to chat turns and segments

**Files:**
- Modify: `chat-central/src/chat/types.ts`
- Modify: `chat-central/src/chat/turnRunner.ts`
- Modify: `chat-central/src/chat/useChat.ts`
- Modify: `chat-central/src/__tests__/turnRunner.discovery.test.ts`

**Interfaces:**
- Adds `metering?: TurnMetering` to `AnswerSegment`.
- The primary leg uses phase `primary`; Person uses `person`; an accepted specialist uses
  `specialist`; judge work uses `judge`.

- [ ] Write failing tests for primary, Person cache hit/miss, specialist acceptance, retry, failure,
  and chat reset.
- [ ] Pass observation callbacks from each `runToolLoop` call into the segment that caused it.
- [ ] Record a completion request even when the agent returns no source records.
- [ ] Preserve `searchCount` as a source count until the UI migration in Task 5.
- [ ] Run: `npm test --prefix chat-central -- turnRunner.discovery`.
- [ ] Commit with message: `feat: attribute completion observations to turns`.

### Task 5: Replace ambiguous source-count copy and add the disclosure

**Files:**
- Modify: `chat-central/src/chat/components/ThinkingIndicator.tsx`
- Create: `chat-central/src/chat/components/TurnUsage.tsx`
- Modify: `chat-central/src/chat/components/ChatMessage.tsx`
- Create: `chat-central/src/__tests__/TurnUsage.test.tsx`

**Interfaces:**
- `TurnUsage({ metering, sourceRecordCount })` renders only the labels defined in Section 5.
- `null` uses the exact copy: `Not available from this surface`.

- [ ] Write failing component tests for completion requests, source records, unavailable Search-tool
  calls, and no false billed count.
- [ ] Rename any visible source-count copy so it says source records or sources, never searched.
- [ ] Add the compact per-segment Usage disclosure near the existing confidence/trust controls.
- [ ] Keep the panel clean by default. The disclosure expands only on request.
- [ ] Run: `npm test --prefix chat-central -- TurnUsage`.
- [ ] Commit with message: `feat: show precise turn usage disclosure`.

### Task 6: Prove the browser path and reconcile with Agent Studio

**Files:**
- Create: `tests/query-metering.spec.ts`
- Create temporarily: `/tmp/algolia-query-metering/<run-id>/`
- Modify: Asana task 2.2.2 evidence comment

**Interfaces:**
- Produces: a redacted network classification summary and a comparison table for each required
  scenario.

- [ ] Add Playwright request and response listeners before loading the local Algolia.com test surface.
- [ ] Classify every relevant request with the categories in Section 3.
- [ ] Use unique, non-sensitive probe questions to find the matching conversation through the
  operator-only API path.
- [ ] Prove source-pill rendering and opening add no new retrieval request.
- [ ] Prove unclicked suggestions add no request; prove a clicked suggestion creates a new turn.
- [ ] Run primary, Person, specialist, judge, retry, failure, parallel, reset, and long-conversation
  cases.
- [ ] Run: `npm test --prefix chat-central`.
- [ ] Run: `npx playwright test tests/query-metering.spec.ts`.
- [ ] Run: `npm run verify`.
- [ ] Post changed files, commands, redacted results, risks, rollback note, and the R&D gaps to
  Asana 2.2.2.
- [ ] Mark 2.2.2 complete only when the authoritative Search-tool count is reconciled for every
  required scenario.
- [ ] Commit with message: `test: prove query metering boundaries`.

## 9. Acceptance Checklist

2.2 is ready to close only when all statements are true:

- [ ] A source record count is never called a retrieval, API request, or billed request.
- [ ] The UI identifies every value by measurement unit.
- [ ] Browser evidence distinguishes widget completion traffic from page search, autocomplete,
  Insights, Person, specialist, and judge traffic.
- [ ] Source pills and unclicked suggestions produce no extra retrieval traffic.
- [ ] Primary, Person, specialist, judge, retries, failures, parallel work, resets, and long
  conversations have separate evidence.
- [ ] Search-tool calls are obtained from Agent Studio, not inferred from hits.
- [ ] Search API requests and billing values are null when no authoritative source exists.
- [ ] Per-turn and conversation totals reconcile within each metric type.
- [ ] Evidence is redacted and no privileged key reaches the browser.
- [ ] The exact browser and Agent Studio evidence is posted to Asana 2.2.2.

## 10. Known Risks and Rollback

| Risk | Control | Rollback |
|---|---|---|
| SSE does not expose a conversation ID | Use operator-only post-turn matching for the spike; raise R&D delta | Disable reconciliation display and retain browser-only diagnostics |
| Browser cannot observe internal Search API requests | Treat Agent Studio as authority; do not infer | Show the metric as unavailable |
| Current source count is mistaken for search count | Rename UI and add regression tests | Revert only the usage disclosure; leave source pills unchanged |
| A privileged conversation key leaks into the widget | Keep all logs access in local operator tooling or server code | Remove the integration immediately and rotate key |
| Retry adds duplicate counts | Preserve attempt identity and status | Exclude duplicate rollup only when event identity proves it is a duplicate |
| R&D API is unavailable | Keep 2.2.2 open; use spike evidence to support the request | Do not replace it with a fake collector |
