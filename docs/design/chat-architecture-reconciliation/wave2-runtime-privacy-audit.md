# Historical Wave 2: Runtime, Business Policy, and Privacy Audit

> Frozen August 20 comparison. Current transport improvements, remaining consent/global-state defects, and revised purpose-specific privacy rules are governed by [`MASTER-PLAN-2026-08-25.md`](MASTER-PLAN-2026-08-25.md).

## Verdict

No baseline passes privacy or multi-instance gates unchanged. Compose the target concern by concern:

- preserve Algolia's characterized concierge behavior and deployed compatibility;
- use Sajid upstream's typed streaming/tool-loop mechanics, abort path, and specialist consent gate;
- promote selected integration work: bounded native turn context, visitor contracts, versioned conversation persistence, pure discovery ledger, explicit transport concept, and visible-answer projection;
- reject all module-global runtime/configuration/transport/storage ownership;
- move Algolia journey, discovery, proactive, specialist, and handoff rules behind business-policy ports.

The integration branch cannot be selected wholesale because it regressed upstream abort/stop behavior.

## Hard-gate findings

### Consent fails open everywhere

- Algolia defaults to collection allowed without an adapter, initializes before queued adapters, retains data on withdrawal, and lets the compiler read/inject retained records independently.
- Sajid upstream has no consent surface in its visitor source and sends raw profile/event/page data through Person-agent requests.
- Integration adds optional consent but treats absence as granted; the default source omits consent while each turn hardwires deterministic visitor context.

Target: explicit `unknown | denied | granted | withdrawn`, purpose-specific grants, change notifications, deletion and cache invalidation. No behavioral intelligence may be read, compiled, cached, or transported without a current grant.

### Multi-widget isolation fails everywhere

Algolia auxiliary scripts are page singletons and patch global history/fetch. Sajid uses per-renderer conversation stores but global credentials, config, proactive state, visitor source, caches, field mapping, and engagement target. Integration retains those and adds a global transport slot.

Target: one `RuntimeInstanceContext` owns credentials, transport, agent graph, record mapping, visitor source, consent, storage namespace, proactive state, timers, abort scope, tools, and conversation identity. Legacy singleton shims support at most one widget and fail safely on a second mount.

### Integration lost abort/stop behavior

Upstream propagates `AbortController.signal` from `useChat` through the turn and transport layers. Integration removes that chain.

Target: every turn owns an abort scope covering transport, tools, visitor/person acquisition, judge and specialist work, retries, and timers. Reset, unmount, explicit stop, superseding turns, and consent withdrawal terminate it deterministically.

### Business policy is embedded in runtime

Algolia's large browser modules combine collection, classification, eligibility, persistence, transport, and UI targeting. Integration's `turnRunner` combines journey/path routing, discovery prompt construction, context transport, conversation metadata, model transport, source projection, and UI mutation.

Target: neutral engine consumes `ContextProjectionPolicy`, `DiscoveryPolicy`, `SpecialistPolicy`, `SourceProjection`, `JudgePort`, and `TurnTransport`. It contains no Algolia journey rules, commercial questions, page groups, or agent-specific prompt copy.

### Conversation identity bypasses bounds

Integration bounds visitor context, then appends `conversation_id` after validation. The persisted ID has no purpose, namespace, TTL, or retention contract.

Target: separate typed system-metadata and visitor-derived envelopes, validate both after final composition, and define conversation ID scope, rotation, reset, TTL, and non-tracking guarantees.

### Persistence needs a real adapter

Algolia has useful bounded/versioned intelligence records and session expiry. Integration adds readable versioned transcript persistence and interrupted-stream normalization. It lacks transcript TTL/size limits, namespaces, migrations, and consent-linked cleanup.

Target: `ConversationStore` with schema version, namespace, TTL, size bounds, migrations, and explicit reset scopes.

## Anchored scores

| Concern | Algolia | Sajid upstream | Integration |
|---|---:|---:|---:|
| Per-instance isolation | 0 / .98 | 1 / .98 | 1 / .99 |
| Transport/tool boundary | 2 / .91 | 3 / .94 | 2 / .97 |
| Turn lifecycle/failure handling | 2 / .82 | 3 / .94 | 2 / .98 |
| Source/judge projection | 2 / .82 | 3 / .89 | 3 / .94 |
| Visitor/privacy contract | 2 / .99 | 1 / .99 | 2 / .99 |
| Proactive determinism | 3 / .96 | 2 / .94 | 2 / .91 |
| Persistence/reset | 3 / .95 | 1 / .93 | 3 / .97 |
| Policy/mechanism separation | 1 / .97 | 2 / .95 | 1 / .99 |

Scores are `score / confidence`. Hard-gate failure overrides averages.

## Migration order

1. Freeze canned-stream, Jahia, abort/reset, and concurrent-widget behavior.
2. Introduce `RuntimeInstanceContext` and one-instance compatibility wrappers.
3. Restore the upstream abort/stop chain.
4. Move transport, field mapping, tools, visitor source/cache, and proactive state into instance context.
5. Replace fetch/history interception with explicit ports.
6. Add fail-closed consent/storage contracts and lifecycle tests.
7. Adopt bounded signal/context schemas and validate the final metadata envelope.
8. Extract a neutral turn engine.
9. Move discovery, proactive journeys, routing, handoff, and copy to Algolia policy modules.
10. Put persistence behind namespaced TTL-bound adapters.
11. Add two-widget isolation tests.
12. Retire global interceptors, first-widget selectors, and singleton config/transport/source state.

## Evidence anchors

- Algolia consent/init/compiler: `frontend/chat-widget/algolia-engagement-tracker.js:114`, `:1156`; `algolia-context-compiler.js:479`, `:721`.
- Algolia globals/interception: tracker `:77`, `:1047`; compiler `:748`; proactive controller `:405`, `:1021`.
- Upstream visitor/person data: `chat-central/src/person/visitorDataSource.ts:56`, `personAgent.ts:130`.
- Upstream globals: `config/active.ts:27`, `config/runtime.ts:46`, `config/proactive.ts:77`.
- Upstream abort chain: `chat-central/src/chat/useChat.ts:268`, `turnRunner.ts:406`; `shared/agentStudio.ts:419`.
- Integration consent/context default: `person/visitorDataSource.ts:83`, `person/personAgent.ts:237`, `chat/useChat.ts:296`.
- Integration policy coupling and metadata: `chat/turnRunner.ts:422`, `:695`, `:721`, `:740`, `:953`.
- Integration persistence: `chat/conversationPersistence.ts:3`.

## Executed evidence

- Algolia selected checks: 116 passing; two isolated-copy harness dependency/fixture failures, not reviewed-module assertions.
- Sajid selected runtime tests: 63/63 passing.
- Integration selected persistence/discovery/visitor/context/specialist/projection tests: 105/105 passing.
