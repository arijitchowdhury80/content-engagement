# Wave 1: Algolia Implementation Audit

> Historical audit. Trigger identifiers recorded below describe the artifacts inspected during this wave. The active canonical singleton identifiers were superseded on 2026-08-23 by `product_page_3s_30_scroll`, `solution_page_3s_30_scroll`, `developer_page_3s_30_scroll`, and `resource_page_3s_30_scroll`.

Baseline: `algolia-com` at `2a1f9ccc330990cf9f4b3be7e7a343887e22285e`
Snapshot manifest: `258732bcb33f1c4f9febf038d2ea2a4c56494a07abbd7536fde50d0866ceb5e6`
Scope coverage: 105/105 `architecture_included` files

## Independent verdict

`algolia-com` is the strongest evidence source for Algolia concierge behavior and operational safety, but it is not a defensible canonical widget source architecture. Preserve and port its tested business capabilities, public compatibility surface, parity fixtures, and Jahia safeguards. Reject its generated-core ownership, singleton browser wiring, private CSS reach-through, and current consent sequencing as target architecture.

## Executed characterization

| Check | Result |
|---|---|
| `npm ci` | Pass; 3 packages, 0 vulnerabilities |
| Widget suite | Pass; 212/212 |
| Local chat parity | Pass; full chain and all eight canonical journeys |
| Team UAT | Fail; 23/25 |
| Deployment unit tests | Pass; 58/58 |
| Tracker browser validator | Pass; five pages, 27 bounded/sanitized events |

The UAT failures are evidence-integrity failures: the hosted artifact differs from the current artifact by four bytes, and a final trace still records the superseded `product_page_10s_50_scroll` trigger instead of `product_page_5s_25_scroll`. The affected evidence cannot be treated as current baseline authority.

No live conversation, automated WCAG/axe audit, screen-reader pass, screenshot comparison, or performance baseline was executed in this wave.

## Capability disposition

### Preserve and port

- The Algolia-specific orchestrator, greeting, journey classifier, generalist, Academy, developer/specialist, and three-judge behavior contracts.
- Versioned and bounded visitor/profile/session/event envelopes, signal collectors, redaction, navigation/dwell/scroll/form/chat capture, and reset behavior.
- `AlgoliaContextPacket.v1`, canonical journey triggers, size limits, sensitive-key filtering, and deterministic metadata compilation.
- Eight deterministic proactive journeys, suppression/cooldown/cap/deduplication lifecycle, greeting validation, and proactive-to-orchestrator handoff.
- The explicit `setOrchestratorTransport` seam used by handoff.
- Jahia snapshot, dry-run, mutation allowlist, hash readback, and rollback safeguards.
- Existing compatibility tests and behavioral fixtures, after repairing stale evidence.

### Redesign

- Shared widget ownership: `algolia-chat.js`, the form tool, and confidence badge are compiled one-line artifacts with no readable source or build pipeline in this repository.
- Consent authority: tracking defaults to allowed when no adapter exists, state initializes before a queued adapter is installed, withdrawal does not clear or deliberately retain state, and the context compiler reads storage and patches fetch without the same consent authority.
- Instance ownership: proactive, engage, and form code target the first `algolia-chat`; singleton globals and installer flags prevent reliable concurrent isolation.
- Transport: remove default `window.fetch` interception and consolidate on explicit per-instance transport middleware.
- Presentation: keep Algolia visual decisions and tokens, but replace private utility chains and `.acs-*` reach-through with semantic parts, states, slots, or typed recipes.
- Release provenance: retain operational safeguards while replacing hard-coded versions and filenames with a content-addressed source-to-artifact manifest.

## Public compatibility surface to freeze

### Widget

- Element: `<algolia-chat>`.
- Methods/properties: `open()`, `ask(text)`, `setPersona(id,label)`, `engage(...)`, `setAnalyzing(bool)`, `autoEngage`, `setAutoEngage(bool)`, and `setVisitorDataSource(source)`.
- The observed `setContextProvider` exists but is empty and requires an explicit compatibility disposition.
- Registry: `window.algoliaChat.registerTheme`, `registerTool`, `setOrchestratorTransport`, and `toolUI` request/settle/dismiss operations.

### Project APIs and events

- `window.algoliaEngagementTracker` and legacy `algoliaTracker`.
- `window.algoliaContextCompiler`, `algoliaProactiveController`, `algoliaHandoffToOrchestrator`, and `algoliaEngage`.
- Chat open/question/engagement/dismiss/click/lead/reset events.
- Engagement signal, proactive opportunity/suppression, and proactive handoff events.

### Persistence and packets

- `algolia_profile` / `AlgoliaEngagementProfile.v1`.
- `algolia_session` / `AlgoliaEngagementSession.v1`.
- `algolia_events` / `AlgoliaEngagementEvents.v1`.
- `AlgoliaContextPacket.v1`, `AlgoliaProactiveDecision.v1`, `AlgoliaProactiveState.v1`, `ProactiveGreetingRequest/Response.v1`, and `ProactiveHandoffContext.v1`.

## Hard-gate result

| Gate | Current result | Reason |
|---|---|---|
| Behavioral correctness | Partial | Core local behavior passes; two UAT evidence checks fail |
| Privacy and consent | Fail | Tracking is not fail-closed and consent is not a single injected authority |
| Accessibility | Unknown | Semantic/string tests exist, but no complete WCAG, keyboard, focus, screen-reader, contrast, or zoom evidence |
| Visual parity | Unknown | Theme assertions exist, but no executable screenshot comparison |
| Rollback safety | Partial | Jahia procedures are strong; source-to-artifact provenance and current artifact parity are incomplete |

## Evidence anchors

- Agent identities and filter ownership: `agents/admin/algoliaComConfig.mjs:34`, `config/deployments/algolia-chat-stack.json:22`.
- Tracker contracts and consent sequencing: `frontend/chat-widget/algolia-engagement-tracker.js:22`, `:114`, `:963`, `:1100`.
- Context bounds, compiler, and fetch patch: `frontend/chat-widget/algolia-context-compiler.js:22`, `:74`, `:620`, `:748`.
- Proactive journeys and state machine: `frontend/chat-widget/algolia-proactive-controller.js:22`, `:1010`, `:1244`, `:1480`.
- Handoff packet and transport: `frontend/chat-widget/handoff-to-orchestrator.js:181`, `:297`, `:322`.
- Theme/private-selector coupling: `frontend/chat-widget/algolia-chat-theme-algolia.js:42`, `:193`, `:220`.
- Deployment safeguards: `tools/deployment/deploy_jahia_engagement_tracker.py:23`, `:197`, `:679`, `:751`.
- Stale UAT assertions: `testing/team-uat/team-uat.test.mjs:151`, `:296`.
