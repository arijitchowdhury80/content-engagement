# Workstream 1 Agent Studio Capability Audit

Captured: 2026-08-12

## Scope

- App: `0EXRPAXB56`
- Canonical handoff target: `www Chat - Orchestrator`
- Live Agent Studio target found: `www Chat - Orchestrator` in the handoff corresponds to `www Chat – Orchestrator` in the API, ID `e2c8596a-4420-41d2-80bb-5cd4aaeffda6`.
- Production `[Prod] Algolia.com Website Search/Chatbot` screenshots are read-only comparison evidence only.
- No Agent Studio config was changed.
- Only Algolia.com-owned surfaces were inspected; host HTML was not touched.

## Evidence

Local evidence:

- Production UI screenshot: `docs/evidence/agent-studio/safety-controls/production-guardrails.png`
- Production UI screenshot: `docs/evidence/agent-studio/safety-controls/production-cost-controls.png`
- Production UI screenshot: `docs/evidence/agent-studio/safety-controls/production-rate-limiting.png`
- Production UI screenshot: `docs/evidence/agent-studio/safety-controls/production-approved-domains.png`
- Production UI screenshot: `docs/evidence/agent-studio/customization/production-conversation-features.png`
- Production UI screenshot: `docs/evidence/agent-studio/customization/production-user-interface.png`
- Production UI screenshot: `docs/evidence/agent-studio/customization/production-advanced-settings.png`
- Production UI screenshot: `docs/evidence/agent-studio/customization/production-follow-up-suggestions-modal.png`
- Gitignored raw Agent Studio snapshot: `docs/research/search-experience/workstream-1-agent-studio-readonly-snapshot.json`
- Gitignored app configuration snapshot: `docs/research/search-experience/workstream-1-agent-studio-app-configuration.json`
- Gitignored completion smoke stream: `docs/research/search-experience/workstream-1-completion-smoke-stream.txt`

Official Algolia documentation:

- Agent Studio API overview: https://www.algolia.com/doc/rest-api/agent-studio
- Agent configuration: https://www.algolia.com/doc/guides/algolia-ai/agent-studio/how-to/agent-configuration
- Guardrails: https://www.algolia.com/doc/guides/algolia-ai/agent-studio/how-to/guardrails
- Approved domains: https://www.algolia.com/doc/guides/algolia-ai/agent-studio/how-to/approved-domains
- Agent Studio dashboard: https://www.algolia.com/doc/guides/algolia-ai/agent-studio/how-to/dashboard
- Agent Studio integration: https://www.algolia.com/doc/guides/algolia-ai/agent-studio/how-to/integration
- Client-side tools: https://www.algolia.com/doc/guides/algolia-ai/agent-studio/how-to/tools/client-side-tools
- Memory: https://www.algolia.com/doc/guides/algolia-ai/agent-studio/how-to/memory/overview
- Completion API: https://www.algolia.com/doc/rest-api/agent-studio/create-agent-completion
- Chat widget: https://www.algolia.com/doc/api-reference/widgets/chat/js
- User authentication and memory: https://www.algolia.com/doc/guides/algolia-ai/agent-studio/how-to/user-authentication
- Feedback API: https://www.algolia.com/doc/rest-api/agent-studio/create-feedback

## Live Configuration Summary

Read-only Agent Studio API results:

- App configuration: `maxRetentionDays: 90`.
- `www Chat – Orchestrator` status: `published`.
- Model: `medium`.
- Config keys returned: `memory`, `suggestions`, `enableAlgoliaMcp`.
- Memory: `config.memory.enabled: true`.
- Suggestions: `config.suggestions.enabled: true`; model `medium`; no custom `system_prompt`; empty `generation` and `context` objects.
- Guardrails: no `config.guardrail` object returned.
- Cost controls: no explicit `max_tokens`, `max_iterations`, or `thread_depth` returned.
- Rate limits: no `rate_limit` object returned.
- Approved domains: empty list, which Algolia documents as accepting any origin.
- Tools: one Algolia search tool over `Algolia_Prod_Copy_Enhanced`; client-side `ask_specialist`; client-side `get_visitor_profile`.
- The completion smoke stream requested `get_visitor_profile` and the Algolia search tool. With no client runtime supplying the client-side tool result, the direct API smoke produced search hits but no assistant text.

## Responsibility Matrix

| Control | Available in UI | Read API | Write API | Current `www Chat – Orchestrator` value | Correct owner | Test method | Recommendation |
|---|---:|---:|---:|---|---|---|---|
| Guardrail enablement | Yes, visible in production screenshot | Yes, `config.guardrail.enabled` on agent JSON when configured | Yes, PATCH agent `config.guardrail.enabled` | Absent; effective default off | Agent Studio | Read agent JSON; send clear blocked and allowed prompts in playground/browser; assert guardrail event/fallback | Configure on `www Chat – Orchestrator` only after approval; remove prompt-only safety language that duplicates native enforcement. |
| Guardrail classifier provider/model | Yes | Yes, `config.guardrail.providerId` and `model` | Yes, PATCH agent `config.guardrail` | Absent | Agent Studio | Read JSON; induce guardrail pass/fail; watch latency/errors | Use a fast classifier model already approved for the app; record provider/model before mutation. |
| Agent scope | Yes | Yes, `config.guardrail.scope` | Yes | Absent | Agent Studio | Read JSON; test in-scope vs off-topic boundary prompts | Move domain-scope policy into native guardrail scope, capped at documented 1,024 chars. |
| Rejected input/output categories | Yes | Yes, `config.guardrail.categories[]` with `scope` | Yes | Absent | Agent Studio | Test representative input/output category violations; verify fallback and event | Define small category set. Avoid over-broad categories; docs warn too many categories can reduce accuracy. |
| Guardrail fallback responses | Yes | Yes, `categories[].fallbackResponse` | Yes | Absent | Agent Studio | Trigger each category and verify user-facing fallback | Use concise Algolia.com-safe fallback copy; do not encode discovery/answer strategy here. |
| Allowed-content examples | Yes in production screenshot | Unknown: official guardrail config reference does not list an allowed-content field | Unknown/not documented | Absent | Unknown until UI/API diff proves field name | If UI exposes it on target, change one non-prod/dry-run agent and read JSON diff; do not mutate target first | Treat as UI-visible but API-unknown. Do not claim config-as-code support for this field yet. |
| Response token limit | Yes | Yes, `config.max_tokens` | Yes | Absent; docs say omitted/0 uses model/provider default | Agent Studio | Read JSON; force long-answer eval; assert truncation/finish reason where possible | Set an explicit ceiling only after answer-quality tests pick a floor that does not damage completeness. |
| Conversation-depth limit | Yes | Yes, `config.thread_depth.max_messages` | Yes | Absent; docs say null/0/omitted means no message limit | Agent Studio for hard cap; runtime for reset UX | Multi-turn browser test past threshold; verify API rejection and user reset path | Use native hard cap for abuse/cost; keep discovery-memory logic in runtime. |
| Max steps per completion | Yes | Yes, `config.max_iterations` | Yes | Absent; docs say omitted/0 uses default 50, while production UI screenshot labels "Unlimited" | Agent Studio | Tool-loop test with known maximum; inspect error/finish behavior | Resolve UI-vs-doc wording before copying production. For this agent, explicit finite cap is safer than inherited default. |
| Agent rate limit | Yes | Yes, `config.rate_limit.agent` | Yes | Absent; docs say no per-agent limit enforced when omitted | Agent Studio | Burst completion requests; assert `429`, `Retry-After`, and UI copy | Configure after approved traffic budget. Runtime must show friendly too-many-requests state. |
| Per-IP rate limit | Yes | Yes, `config.rate_limit.ip` | Yes | Absent; no per-IP limit enforced when omitted | Agent Studio | Burst from same IP; assert `429` and headers | Configure after approval; keep client-side retry/backoff UX in widget. |
| Approved domains | Yes | Yes, `GET /agents/{id}/allowed-domains` | Yes, POST/DELETE allowed-domains endpoints | Empty list; docs say empty list accepts any origin | Agent Studio | Completion from allowed origin succeeds; disallowed/no-origin request returns 403 | Highest-priority native control gap. Proposed target needs approval before mutation. |
| App data retention | Yes in settings docs | Yes, `GET /configuration` | Yes, PATCH `/configuration` with `logs` ACL | `maxRetentionDays: 90` | Agent Studio/app admin | Read app config; verify conversation/cache retention behavior where possible | Leave unchanged for WS1 unless privacy/legal requirements change. |
| Memory | Likely yes as conversation feature; actual API returns config | Partially: `config.memory.enabled` observed; completion API has `memory=false` query param; user auth docs define user-scoped memory | Partially supported by generic config PATCH, but direct memory config reference is not explicit | Enabled | Agent Studio stores memory; runtime must pass secure user token and current context | Authenticated multi-turn browser test with stable user token; repeat without token to verify scoping | Keep enabled, but do not rely on it for visitor intelligence. Discovery ledger and consent/freshness belong in runtime. |
| Follow-up suggestions | Yes | Yes, `config.suggestions` | Yes | Enabled; model `medium`; no custom prompt; default generation/context | Agent Studio generates; widget renders; prompt controls quality only through suggestion system prompt | Browser completion must display suggestions; direct stream should contain suggestions after client-side tool path works | Native suggestions are real. Current target likely needs custom concise suggestion prompt and runtime rendering verification. |
| Thumbs up/down feedback | Widget supports `feedback: true`; production parity required by WS1 | Yes via Feedback API; create/list feedback endpoints | Yes, create feedback entries | Not an agent config value; current local demo has no chat feedback UI | Widget/runtime plus Agent Studio feedback API | Browser click thumbs; verify feedback API record with messageId/agentId/vote | Implement/runtime-enable feedback; do not put this in the prompt. |
| Optional feedback detail | Not proven native in chat widget docs beyond `notes` in Feedback API | Yes via Feedback API `notes` | Yes | Not present in current local demo | Widget/runtime | Submit detail; read feedback entry | Runtime-owned modal/form if required; Agent Studio API can store notes. |
| Regenerate | Chat widget docs mention regenerate sends `cache=false`; completion API exposes `cache` query param | Request-level only; not persistent agent config | Runtime call with `cache=false` | Not present in current local demo | Widget/runtime | Same message regeneration creates new run/message and bypasses cache | Runtime-owned. Preserve approved context and assign distinct run ID. |
| Clear/reset conversation | Native chat widget HTML exposes clear button; local demo has no chat | Conversation APIs exist, but clear is UI state | Runtime/UI | Not present in current local demo | Widget/runtime | Browser reset clears state and starts new conversation; memory/ledger reset policy verified | Runtime-owned, with explicit discovery-ledger reset behavior. |
| Maximize/minimize/close chat | Native chat widget HTML exposes maximize and close buttons | No agent config | Runtime/UI | Not present in current local demo | Widget/runtime | Browser accessibility and mobile layout tests | Runtime-owned. |
| Stop/resume streaming | Chat widget connector exposes `stop()` and `resumeStream()` | Completion endpoint streams; resume is client behavior | Runtime/UI | Not present in current local demo | Widget/runtime | Abort during stream; reload/resume in-flight stream | Runtime-owned. |
| Source UX and inline links | Search tool returns hits; chat widget offers templates, not source policy | Read through tool output stream | Runtime controls rendering; prompt controls citation behavior | Direct smoke returned 7 search hits; local demo source links exist only for search-result cards | Runtime plus prompt | Browser answer must show used sources and links resolving to cited evidence | Prompt can require grounded links, but rendering and integrity checks are runtime-owned. |
| Visitor profile tool | Agent Studio supports client-side tools in agent config | Yes, tool schema in agent JSON; direct completion stream showed `get_visitor_profile` call | Agent config writable; tool execution is client runtime | Present as client-side tool, but current local demo does not execute Agent Studio chat tools | Widget/runtime | Browser sends visitor packet; completion continues after tool result; answer changes by visitor context | This is a hard WS1 runtime gap. Do not try to solve with prompt text. |
| Specialist handoff tool | Agent Studio supports client-side tools in agent config | Yes, `ask_specialist` schema in agent JSON | Agent config writable; handoff transport is runtime | Present as client-side tool | Widget/runtime plus prompt decision rules | Browser test: answer first, offer after consent, transfer context to selected specialist | Keep concise prompt rules; implement consent, suppression, packet transport, and specialist execution in runtime. |
| Proactive engagement | No native Agent Studio control found in docs/screenshots | No public API found | No public API found | `www Chat – Proactive Concierge` agent exists, but no runtime trigger controller in current local demo | Widget/runtime | Multi-page browser journey with trigger/no-trigger reason codes | Runtime-owned. Agent can generate copy, not decide interruption policy alone. |

## Proposed Agent Studio Changes Requiring Approval

No changes have been made. Before any of these are applied, approval is required because they affect Agent Studio.

| Target | Current value | Intended value | Rollback | Validation |
|---|---|---|---|---|
| `www Chat – Orchestrator` allowed domains | Empty list; any origin accepted | Add approved domains for the actual algolia.com/Jahia test and production origins after final host list is confirmed | Delete added domain IDs via allowed-domains API; empty list restores current behavior | Allowed origin completion succeeds; unapproved origin/no-origin request returns 403; dashboard playground domain included only if needed for testing. |
| `www Chat – Orchestrator` guardrail | No `config.guardrail` | Enable guardrail with classifier model/provider, Algolia.com scope, small rejected category set, and fallbacks | PATCH `config.guardrail.enabled:false` or restore previous absent config from snapshot | Playground/browser blocked and allowed cases; verify guardrail event/fallback and no false-positive on core Algolia questions. |
| `www Chat – Orchestrator` cost controls | No explicit `max_tokens`, `max_iterations`, `thread_depth` | Set explicit ceilings after benchmark identifies safe values | PATCH values back to absent/previous snapshot | Long-answer, specialist, and multi-turn tests preserve quality; forced over-limit case fails gracefully. |
| `www Chat – Orchestrator` rate limits | No `rate_limit` | Configure per-agent and per-IP limits after traffic budget is approved | PATCH `enabled:false` or restore previous absent config | Burst tests return 429 with user-friendly widget state. |
| `www Chat – Orchestrator` suggestions | Enabled with default generation/context and no custom prompt | Consider concise custom suggestion prompt and `include_tool_outputs:true` if browser stream proves suggestions render after client-side tool execution | Restore current `config.suggestions` from snapshot | Browser answer emits grounded, non-repeating suggestions; direct stream includes suggestions only after client tool path is handled. |

## Immediate Conclusions

1. The handoff hypothesis is mostly right: hard safety, domain, rate, and cost controls belong in Agent Studio when configured; visitor intelligence, proactive timing, discovery ledger, specialist transport, feedback detail, regenerate, and source UX are runtime responsibilities.
2. The current `www Chat – Orchestrator` has the most important native security gap: approved domains are empty, so the completion endpoint is not origin-restricted.
3. The current orchestrator already depends on runtime client-side tools (`get_visitor_profile`, `ask_specialist`). A direct API call without client tool execution can retrieve search hits but cannot complete the intended answer path.
4. The local demo under `frontend/search-first-demo/demo/` is search-only and does not implement the Agent Studio chat widget or the Workstream 1 controls. That is evidence of a missing local runtime, not evidence that the real deployed widget lacks them.
5. The orchestrator prompt contains grounding rules, not broad platform policy text. The audit found only one occurrence of "guardrail" in the prompt, in the answer-grounding section. There is no obvious bulk safety/rate/domain policy to remove until native controls are configured and validated.
6. The later customization screenshots materially strengthen the native-first strategy: memory, follow-up suggestions, UI entry points, feedback, and a separate follow-up-suggestion prompt are native surfaces and should not be forced through the main orchestrator prompt.
7. Guardrails are useful but not sufficient for grounding. Algolia documents them as category classifiers for user input and agent output. Grounding still requires search/tool usage, runtime source rendering and validation, prompt-level answer rules, and eval coverage.
