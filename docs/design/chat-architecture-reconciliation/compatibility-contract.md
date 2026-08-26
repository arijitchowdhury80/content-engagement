# Public Compatibility Contract — Stage 2 Input

Status: historical draft; inventory refresh required before approval

The current plan is [`MASTER-PLAN-2026-08-25.md`](MASTER-PLAN-2026-08-25.md). This draft omits current Compare, token-telemetry, judge-core, resize, grounding, load-order, and deployment surfaces and does not represent an approved compatibility contract.

This contract freezes behavior to characterize and deliberately disposition. It is not a promise that every legacy surface survives indefinitely.

## Browser surface

- Custom element: `<algolia-chat>` and its documented element topology.
- Attributes/configuration: identity and copy, corpus/index/credentials, agents and judge, sources, welcome/samples, open and engagement modes, discovery/analyzing timing, record mappings, theme/theme source, icons/assets, and font configuration.
- Methods: `open`, `ask`, `stop`, `setPersona`, `engage`, `setAnalyzing`, `setAutoEngage`, `setVisitorDataSource`, reset operations, and explicit instance lookup/control.
- `setContextProvider` remains a warned legacy no-op in compatibility v1. New context enters through `VisitorContextPort`.
- Events: open change, question, engagement lifecycle, lead/tool lifecycle, reset, engagement signal, proactive opportunity/suppression/handoff, and instance diagnostics.
- Pre-load registries for themes/tools/UI replay deterministically. No API selects the first, last, or globally active widget when multiple instances exist.

## Behavioral invariants

- A streamed answer remains visible and persisted; judge output is advisory and never becomes a second answer completion.
- Sourced specialist material remains additive. Confidence handling cannot hide or demote it.
- Limitation and zero-source projections remain secondary to the answer.
- When policy permits, exactly one discovery question follows answer/specialist resolution; specialist consent resolves first.
- Accept/decline dispatches once, and late failures cannot duplicate specialist or discovery work.
- Proactive engagement defaults to the approved docked mode and shares the transcript lane.
- Message IDs are stable. Six provider-neutral progress stages are observable without provider wire names.
- Reset clears conversation state before emitting one composed, bubbling reset event; dual paths deduplicate.

## Data and lifecycle

- Preserve and version the Algolia profile/session/event, context, proactive decision/state, greeting, and handoff schemas through explicit migrations or compatibility adapters.
- `ResetPolicy.v1` distinguishes demo/session, conversation, visitor, and consent-withdrawal resets, including namespaces, receipts, idempotency, preservation, and recreation rules.
- Consent is purpose-specific and fail-closed. No analytics, personalization, proactive collection, storage read, or context injection occurs while consent is unknown/denied/withdrawn.
- Abort covers transport, reader, retry delay, tools, Person/subagents, judge, specialist suspension, proactive greeting, timers, and queued events.
- Storage is instance-, host-, schema-, and purpose-scoped with TTL and size bounds. Unrelated host keys survive scoped resets.

## Presentation and embedding

- Preserve characterized Algolia visual intent and Spectrum component topology through versioned semantic parts/states, themes, recipes, and slots—not private classes or child-order selectors. Visual intent becomes approved only through the user walkthrough.
- Existing load order is characterized; the replacement manifest defines deterministic order, double-load behavior, and compatibility versions.
- Accessibility corrections may intentionally change colors or geometry and require an approved visual-baseline update.

## Retirement rule

Every legacy surface is marked `preserve`, `shim`, `replace-by-contract`, or `retire-with-reason`. A shim is removed only after its source-level contract and black-box replacement pass Gate I2.
