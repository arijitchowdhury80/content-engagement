# Workstream 1.1: Personalization & Visitor Intelligence

**Status:** Active execution brief
**Last updated:** 2026-08-13
**Scope:** algolia.com only; app `0EXRPAXB56`; primary agent `www Chat - Orchestrator`; index `Algolia_Prod_Copy_Enhanced`.

## Source Of Truth

Read these first:

- `docs/design/search-experience/discovery-engagement/CONCIERGE-BEHAVIOR-ARCHITECTURE.md`
- `docs/design/search-experience/discovery-engagement/OPERATING-CONTRACT.md`
- `.development-loop/run-2026-08-12-person-intelligence-discovery/01-current-state-audit.md`
- `.development-loop/run-2026-08-12-person-intelligence-discovery/02-native-turn-context-experiment.md`
- `docs/design/search-experience/discovery-engagement/WORKSTREAM-1.1-SIGNAL-FRESHNESS-CONSENT-MATRIX.md`
- `docs/evidence/visitor-intelligence/2026-08-13-1.1.1-live-signal-probe.json`
- `docs/evidence/visitor-intelligence/2026-08-13-1.1.1-consent-write-gate-probe.json`
- Vault ADR: `Projects/Search-First-Algolia-com/wiki/decisions/2026-08-12-concierge-behavior-architecture.md`

## Recovered Architecture

The concierge is browser-led, not prompt-led:

```text
Browser signal collector
  -> consent-aware session intelligence store
  -> deterministic context compiler
  -> proactive decision engine -> widget engagement
  -> native turnContext -> www Chat - Orchestrator
  -> discovery ledger -> specialist handoff
```

Agent Studio `turnContext` is only the safe current-turn transport. It does not collect browser behavior, infer identity, decide proactive interruptions, store discovery memory, or build specialist handoff context.

## Current Findings

- The live Jahia page currently loads the standalone `algolia-chat-tracker.js`, not the richer combined WIP tracker in `algolia-chat-jahia-20260812-wip.js`.
- Live tracker proof confirms page view, profile/session token state, CTA click, custom `trackEvent`, and coarse `page_read` capture.
- Live tracker proof also confirms important gaps: no configured consent group, no `trackSearch`, no generic navigation click capture, no rich read-depth fields, and no event-prop sanitizer.
- Profile context currently means `_ALGOLIA` cookie/session-derived token, visit count, and first-seen time. Company, role, account tier, declared interests, CRM identity, and buying authority require an approved host/backend data source.
- Consent support exists as a tracker capability, and OneTrust globals are present on Jahia, but the published Jahia custom block does not currently pass a consent group to the tracker. Until that is configured and browser-proven, consent is an open acceptance gap.
- A live write-gate probe confirms the tracker can block new writes after a consent adapter is registered, allow writes after grant, and block later writes after revocation. The missing piece is boot-time Jahia consent registration, not the basic write gate.
- Native Agent Studio `metadata.turnContext` was accepted by `www Chat - Orchestrator` with the approved Jahia development origin. This supports using native turn context instead of appending visitor JSON to the user question.
- Deterministic browser signals should be the default real-time personalization substrate because they are fresh, cheap, auditable, and avoid a five-agent cache-miss chain.
- Person-agent synthesis is optional augmentation. It should be enabled only where evaluation proves material lift over deterministic context.
- The deployed `www Person - *` prompts are not aligned with the V1 runtime contract. They still emit older small JSON shapes, so they cannot be counted as live proof for 1.1.
- The old referenced path `docs/discovery-engagement/...` is stale after folder cleanup. Current design docs live under `docs/design/search-experience/discovery-engagement/`.

## Task Map

### 1.1.1 Map Live Visitor Signals, Freshness & Consent

**Purpose:** Build the evidence map of which signals exist, where they are captured, how fresh they are, and whether they are consent-permitted.

**Done when:**

- Every claimed signal has code/runtime evidence or is marked unavailable.
- Freshness, provenance, confidence, partial/error state, and consent behavior are documented.
- Jahia browser proof captures grant and revocation behavior for the actual consent source.
- No raw telemetry, identifiers, query strings, or consent-restricted values are exposed to the visitor or agent.

### 1.1.2 Define The Versioned Visitor-Intelligence Packet

**Purpose:** Define the safe packet shared by tracker, context compiler, turn transport, discovery ledger, proactive controller, specialist handoff, and optional Person-agent synthesis.

**Done when:**

- The packet distinguishes observed, inferred, confirmed, stale, contradicted, missing, and unknown values.
- The native `turnContext` projection is a flat `Record<string, string>` within Agent Studio limits.
- The full runtime packet remains local/runtime-only for proactive rules, ledger, and handoff.
- Producer and consumer contract tests prove schema, privacy filtering, freshness, and failure behavior.

### 1.1.3 Use Visitor Intelligence On Every Production Turn

**Purpose:** Use the latest safe context on every visitor question so answers, retrieval planning, discovery questions, recommendations, and routing adapt to the visitor's journey.

**Done when:**

- Every Chat turn sends fresh safe context through native `metadata.turnContext`.
- The user question remains intact; visitor context is not appended as prompt text.
- Browser tests prove same-question/different-visitor adaptation, session isolation, stale/error fallback, no telemetry leakage, and no unsupported identity inference.
- Optional Person-agent enrichment is evaluated against deterministic context and is not mandatory per turn unless it wins on quality, latency, cost, and safety.

## Next Execution Order

1. Create the 1.1.1 signal/freshness/consent matrix from current tracker code, Jahia markup, and live browser observations.
2. Define the V1 runtime packet and the smaller native `turnContext` projection in a testable schema.
3. Add/update contract tests for privacy filtering, size limits, freshness, partial/error states, and producer/consumer compatibility.
4. Run a real Jahia multi-page journey and capture: stored signal snapshot, compiled safe context, primary request context, visible personalized answer, and leakage checks.
5. Decide whether Person-agent prompts should be updated now or deferred until deterministic context has a baseline journey evaluation.

## Current Blockers

- Consent adapter/source has not been proven active on the published Jahia development surface.
- Current chat widget files are recovered bundles, not a clean source tree; implementation work must establish source/build ownership before deeper runtime edits.
- The Person-agent candidate prompt file named in the 2026-08-12 audit was not found at its old path after cleanup.
- The live standalone tracker exposes `trackEvent`, but not the previously referenced `trackSearch`; search-event capture must be implemented or the richer tracker bundle must be deployed before it is claimed.
- The live standalone tracker stores custom event props without sanitizing sensitive-looking keys; unsafe host event payloads must be filtered before they can be used for visitor intelligence.
