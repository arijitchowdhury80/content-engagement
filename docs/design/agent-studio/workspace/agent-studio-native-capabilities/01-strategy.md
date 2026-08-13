# Agent Studio Native Capabilities Strategy

Captured: 2026-08-12

Mode: FULL strategy canvas

## Evidence Base

- Handoff: `.planning/workstream-1-superior-concierge-handoff.md`
- Canonical IDs only: `.planning/HANDOFF.json`
- Prior safety-control evidence: `docs/evidence/agent-studio/safety-controls/workstream-1-agent-studio-capability-audit.md`
- Production safety screenshots: `docs/evidence/agent-studio/safety-controls/production-*.png`
- Production customization screenshots: `docs/evidence/agent-studio/customization/production-*.png`
- Read-only app: `0EXRPAXB56`
- Live target: `www Chat - Orchestrator` in the handoff corresponds to `www Chat – Orchestrator` in Agent Studio, ID `e2c8596a-4420-41d2-80bb-5cd4aaeffda6`

Official docs used:

- https://www.algolia.com/doc/guides/algolia-ai/agent-studio/how-to/guardrails
- https://www.algolia.com/doc/guides/algolia-ai/agent-studio/how-to/agent-configuration
- https://www.algolia.com/doc/guides/algolia-ai/agent-studio/how-to/approved-domains
- https://www.algolia.com/doc/guides/algolia-ai/agent-studio/how-to/dashboard
- https://www.algolia.com/doc/guides/algolia-ai/agent-studio/how-to/integration
- https://www.algolia.com/doc/guides/algolia-ai/agent-studio/how-to/tools/client-side-tools
- https://www.algolia.com/doc/guides/algolia-ai/agent-studio/how-to/memory/overview

## Strategic Correction

We were over-assigning responsibility to prompt text.

Agent Studio already provides native controls for several things we were treating as prompt obligations: guardrails, approved domains, rate limits, cost controls, memory, follow-up suggestions, UI entry points, and feedback. The right Workstream 1 strategy is therefore:

1. Native Agent Studio controls first for enforceable platform policy.
2. Runtime implementation for browser state, visitor intelligence, consent, client-side tools, source rendering, and trigger behavior.
3. Prompt only for answer strategy, tool-use decisions, tone, and edge cases that cannot be expressed as native controls.

## 1. Vision

Build a superior concierge experience that feels personal, grounded, controlled, and production-grade without turning the main agent prompt into an overloaded policy document.

The product value should come from the orchestration and runtime experience: knowing the visitor's context, asking better follow-ups, using specialists at the right time, staying grounded in Algolia-owned evidence, and giving the user visible control. The safety and operating envelope should come from Agent Studio wherever the platform supports it.

## 2. Market Segments

Primary segment: visitors on algolia.com evaluating Algolia for search, discovery, ecommerce, developer implementation, or support research.

Secondary segment: Algolia internal teams who need the agent to be auditable, tunable, and safe without requiring prompt surgery for every policy change.

Constraints:

- The agent must answer from Algolia-owned sources wherever possible.
- The system must avoid hallucinated competitive, pricing, support, legal, or security claims.
- The configuration must be maintainable across the orchestrator, specialists, proactive concierge, and person agents.
- Production `[Prod] Algolia.com Website Search/Chatbot` remains read-only comparison evidence.

## 3. Relative Costs

Prompt-only control is cheap to start and expensive to operate. It creates hidden coupling, longer prompts, higher latency, harder regression testing, and unclear ownership.

Native controls reduce operating cost because policy changes become config changes with explicit rollback. Runtime controls cost more than prompt edits, but they are the correct place for UI, visitor context, source display, consent, and client-side tool execution.

The cost position we want: use Agent Studio for hard limits and reusable policy; use runtime only where the browser or backend must actually do work; keep prompts short enough to be testable.

## 4. Value Propositions

For visitors:

- Before: generic chat, vague sources, possible over-answering, and unclear next steps.
- How: grounded answers, context-aware follow-ups, visible source links, feedback controls, and specialist routing when useful.
- After: faster confidence and clearer path to docs, demo, pricing, support, or technical implementation.
- Alternatives: site search, docs search, generic LLM, support contact form, sales handoff.

For Algolia operators:

- Before: safety, cost, domain, memory, and suggestion behavior buried in prompt text.
- How: platform-native guardrails, domains, rate/cost controls, memory, suggestions, and feedback configured where Agent Studio supports them.
- After: smaller prompts, clearer responsibility boundaries, easier rollback, and better evidence for feature-gap requests.
- Alternatives: custom widget logic for everything, ad hoc prompt expansion, or waiting for feature enhancements before using existing controls.

## 5. Trade-offs

We will not treat the main prompt as the source of truth for controls Agent Studio can enforce natively.

We will not claim guardrails make answers fully grounded. Guardrails classify and block categories on input/output. They help with off-topic, unsafe, or policy-violating content, but they do not guarantee that the model avoided training knowledge. Grounding must be enforced through tool selection, retrieval constraints, answer rules, source rendering, and evals.

We will not overfit one giant orchestrator configuration and ignore the rest of the agent family. The control pattern must apply to `www Chat – Orchestrator`, specialists, proactive concierge, and relevant `www Person – *` agents.

We will not mutate Agent Studio without an approval packet: target, current value, intended value, rollback, and validation.

## 6. Key Metrics

North Star Metric: percentage of concierge sessions that produce a helpful, source-grounded answer or appropriate routed next step without policy violation.

One Metric That Matters now: native-control coverage across the `www Chat – *` agent family, with evidence-backed current state, intended state, rollback, and validation per control.

Supporting metrics:

- Guardrail false-positive rate on valid Algolia questions.
- Guardrail true-positive rate on off-topic/silly/unsafe prompts.
- Grounded-answer rate: answers with cited Algolia-owned evidence.
- Source integrity: cited URLs resolve and support the answer.
- Client-side tool completion rate for visitor profile and specialist handoff.
- Feedback rate and negative-feedback reason capture.
- Cost per successful session and 429 rate after limits.

## 7. Growth

This is product-led conversion infrastructure. The concierge should increase qualified engagement by making the site feel responsive and expert without forcing every visitor into a sales motion.

Native Agent Studio features help growth by making controlled iteration faster:

- Follow-up suggestions can shape next questions without bloating the main prompt.
- Search bar AI mode and searchable prompt suggestions can start conversations earlier.
- Floating chat trigger and proactive concierge can increase assisted sessions, but trigger timing belongs in runtime UX policy.
- Feedback creates the measurement loop for improving answers, sources, prompts, and control configuration.

## 8. Capabilities

### Native Agent Studio Controls

| Capability | Should we use it? | Responsibility |
|---|---|---|
| Guardrails | Yes | Block/refuse off-topic, unsafe, or policy categories with concise fallback responses. |
| Approved domains | Yes, highest-priority gap | Restrict completion calls to approved origins. Empty list currently means any origin. |
| Cost controls | Yes | Hard ceilings for response tokens, conversation depth, and max completion steps after benchmarks. |
| Rate limiting | Yes | Per-agent and per-IP abuse/cost protection; runtime handles friendly 429 UX. |
| Memory | Yes, carefully | Preferences and past outcomes for authenticated users; not a substitute for current-page context or visitor-intelligence runtime. |
| Follow-up suggestions | Yes | Native generator with custom concise prompt, max suggestions, max words, and model selection. |
| UI entry points | Yes where native fits | AI mode, searchable prompt suggestions, floating trigger, feedback rendering through widget/runtime. |
| System prompt | Yes, but smaller | Behavior, tool-use, grounding contract, and orchestration rules only. |

### Runtime Controls

Runtime owns what Agent Studio cannot enforce alone:

- Secure user token and memory scoping.
- Visitor intelligence packet and consent/freshness policy.
- Current page, locale, UTM, account-fit, and journey context.
- Client-side tool execution for `get_visitor_profile` and `ask_specialist`.
- Specialist handoff UX, suppression, and context packet.
- Proactive trigger timing and no-interrupt rules.
- Source display, cited-link integrity, regenerate, clear/reset, stop/resume streaming, feedback notes.
- Browser tests that prove controls work in the deployed experience.

### Prompt Controls

The prompt should retain only the rules that are naturally language-model behavior:

- Use Algolia tools before answering factual questions.
- Prefer retrieved Algolia-owned evidence over model prior knowledge.
- Say when evidence is missing instead of inventing.
- Ask concise clarifying questions when the visitor's goal is ambiguous.
- Decide when to offer a specialist and when not to interrupt.
- Maintain tone, structure, and answer quality.

## 9. Defensibility

The defensibility is not "a huge prompt." A huge prompt is easy to copy and hard to maintain.

The defensible system is a disciplined control stack:

- Agent Studio enforces hard platform policy.
- Runtime binds the agent to real visitor context and source-rendering behavior.
- Search tools ground the answer in Algolia-owned content.
- Feedback and evals continuously expose gaps.
- Prompts stay concise and auditable.

That stack is harder to copy because it combines product context, runtime telemetry, source quality, user memory, control-plane configuration, and eval discipline.

## Native-First Responsibility Matrix

| Requirement | Platform | Runtime | Prompt | Notes |
|---|---|---|---|---|
| Block off-topic/silly/unsafe content | Primary | Test UX | Fallback tone only | Guardrails classify input/output categories; keep category count small because docs warn too many can reduce accuracy. |
| Guarantee grounded answers | Partial only | Primary | Primary behavior rule | Guardrails do not guarantee grounding. Search tools, retrieval constraints, source rendering, and evals are required. |
| Stop use of training data | No hard guarantee found | Validate/catch | Instruct | Agent Studio docs say tools ground responses in real data; they do not document a config switch that disables model priors. |
| Approved origins | Primary | Validate origin behavior | None | Current `www Chat – Orchestrator` allowed domain list is empty, which docs say accepts any origin. |
| Cost ceilings | Primary | Graceful degradation | None | Configure only after answer-quality benchmark. |
| Rate limits | Primary | 429 handling and retry copy | None | Configure only after traffic budget. |
| Memory | Primary storage/tooling | Secure user token, consent, context | Use/disclose appropriately | Current orchestrator has memory enabled but no evidence yet of memory tools/preload/preflight on target. |
| Follow-up suggestions | Primary | Render/click tracking | Separate suggestion prompt | Do not load main prompt with suggestion-generation rules. |
| AI mode/searchable prompt suggestions | Primary/InstantSearch | Integration | None | Production UI shows native controls; local runtime must choose how to expose them. |
| Floating chat trigger | Primary component | Trigger policy | None | Native trigger can open chat; runtime decides proactive timing. |
| Feedback | Widget/API | Capture detail, audit loop | None | Feedback API supports vote and notes; runtime should expose detail if needed. |
| Specialist handoff | Tool schema | Primary execution and consent | Decision rule | Current target already has client-side `ask_specialist`; direct API cannot complete this without runtime tool execution. |

## Agent Family Application

| Agent group | Native controls | Runtime controls | Prompt posture |
|---|---|---|---|
| `www Chat – Orchestrator` | Guardrails, approved domains, cost/rate controls, memory, suggestions | Visitor profile, specialist handoff, source UX, feedback, reset/regenerate | Concise orchestration and grounding rules. |
| `www Chat – * Specialist` | Guardrails, approved domains, cost/rate controls; suggestions only if exposed directly | Specialist answer rendering and source validation | Expert answer style and tool usage; no broad platform policy. |
| `www Chat – Proactive Concierge` | Guardrails, approved domains, cost/rate controls | Trigger timing, suppression, journey context | Short proactive copy and handoff rules. |
| `www Person – *` | Guardrails, approved domains, cost/rate controls if called by public runtime | Secure user scoping if memory is enabled | Persona-specific expertise only. |

## Immediate Sequence

1. Complete read-only inventory of all `www Chat – *` and relevant `www Person – *` native controls.
2. Prepare approval packet for approved domains across public-facing agents.
3. Prepare guardrail category set: small, testable, and scoped to Algolia.com.
4. Benchmark answer quality before setting token/depth/iteration limits.
5. Configure follow-up suggestions natively with concise prompt, max suggestions, max words, and model.
6. Decide memory posture: authenticated only, retention-aware, with `toolsEnabled`, `preload`, and `preflight` only if API evidence and runtime tests prove correct behavior.
7. Implement or verify runtime support for client-side tools, feedback, source rendering, regenerate/reset, and proactive triggers.
8. Shrink the main prompt only after native controls are configured and evals pass.

## Approval Gate Template

Before any Agent Studio mutation:

| Field | Required value |
|---|---|
| Target | Agent name and ID |
| Current value | Exact API value and screenshot/API source |
| Intended value | Exact config/domain/category value to write |
| Rollback | Exact PATCH or delete action |
| Validation | Browser/API checks and expected pass/fail results |
| Blast radius | Which agents/users/origins are affected |
| Approval | Arijit approval captured before write |

## Current Position

Arijit's critique is correct. The platform appears to provide more than a few of the controls we need. We should stop asking the prompt to impersonate a control plane.

The only caveat is equally important: native guardrails are not a replacement for grounding. They reduce bad/off-topic/policy-violating content. The "100% grounded" ambition must be enforced by the retrieval/runtime/prompt/eval stack together.
