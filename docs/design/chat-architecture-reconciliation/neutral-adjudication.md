# Neutral Architecture Adjudication

## Decision

- A — Algolia unchanged: rejected.
- B — Sajid upstream unchanged: rejected.
- C — shared integration unchanged: rejected.
- D — synthesis using Sajid's clean source history: recommended, subject to the Gate E amendments below.

D is a design decision, not an implementation pass. It passes no Gate I hard gate until built and verified.

## Raw anchored scorecard

| Criterion | Weight | A score/conf. | B score/conf. | C score/conf. | D design score/conf. |
|---|---:|---:|---:|---:|---:|
| Boundary integrity | 25% | 1 / .95 | 3 / .97 | 2 / .98 | 3 / .84 |
| Testability and diagnosability | 20% | 2 / .90 | 3 / .96 | 2 / .97 | 3 / .82 |
| Release isolation | 15% | 3 / .93 | 1 / .98 | 1 / .97 | 2 / .79 |
| Maintainability / DX | 15% | 1 / .91 | 3 / .94 | 1 / .96 | 3 / .76 |
| Performance / bundle impact | 10% | 2 / .64 | 2 / .88 | 1 / .88 | 2 / .55 |
| Migration risk / cost | 10% | 2 / .75 | 3 / .82 | 2 / .92 | 2 / .78 |
| Multi-brand / host extensibility | 5% | 1 / .80 | 4 / .96 | 3 / .93 | 3 / .84 |
| **Weighted total / 100** |  | **34** | **53** | **33** | **53** |
| **Weighted confidence** |  | **.87** | **.94** | **.96** | **.78** |

B and D tie numerically. B is nevertheless ineligible unchanged because non-compensating hard gates fail. D wins as the most reversible compatibility-preserving design that explicitly removes those defects. D's low performance confidence remains an open Gate I risk.

## Hard-gate posture

| Hard gate | A unchanged | B unchanged | C unchanged | D target design |
|---|---|---|---|---|
| Behavioral correctness | Partial | Fail | Fail | Required, unproven |
| Privacy and consent | Fail | Fail | Fail | Required, unproven |
| WCAG 2.2 AA | Fail/unproven | Fail/unproven | Unproven | Required, unproven |
| Algolia/Spectrum parity | Partial/unproven | Fail | Fail/unproven | Required, unproven |
| Rollback safety | Partial | Fail | Fail | Required, unproven |

## Concern verdicts

| Concern | Verdict |
|---|---|
| Source history | Use pristine Sajid upstream as clean, current, attributable base |
| Turn/stream/tool/retry/abort | Start from upstream; port reviewed integration fixes; preserve full abort chain |
| Instance isolation | Implement a new per-instance boundary |
| Theme/slot/template | Adopt upstream typed foundation; harden validation and trust |
| Algolia journeys/policy | Preserve Algolia behavior; keep ownership in `algolia-com` |
| Visitor context/persistence | Combine bounded Algolia records and selected integration contracts behind consent/storage ports |
| Consent/privacy | Fail closed, purpose-bound, installed before initialization, cancellable, and erasable |
| Proactive/handoff | Preserve Algolia behavior; decisions are pure policy, state is per instance |
| Judge | Upstream readable engine + approved Algolia policy + reviewed deterministic fixes; explicit package owner |
| Accessibility | WCAG obligations override pixel-identical parity through an approved baseline update |
| Spectrum | Use latest upstream topology after repairing the two reproduced regressions |
| Release/Jahia | Upstream source build + Algolia safeguards + content-addressed manifest |
| Performance | Measure D against the frozen baseline; do not inherit a passing score |
| Compatibility | Versioned union of required Algolia and upstream contracts; integration additions require evidence |

## Gate E amendments

1. Contracts are dependency roots and import no implementation package.
2. Central source owns contracts, neutral runtime, presentation, web component, Agent Studio transport adapter, neutral judge capability, opt-in Algolia theme, Spectrum adapter/theme, and release tooling.
3. `algolia-com` owns Algolia policy, visitor/browser intelligence integration, project configuration, Jahia adapter, and deployment operations.
4. Add an explicit browser mechanism boundary for storage, consent bridge, signals, history/navigation, and teardown; no implicit global fetch/history patching.
5. Add `@chat/transport-agent-studio`; neutral runtime consumes semantic transport events.
6. Add `@chat/judge` or another explicit neutral judge owner.
7. Enforce logical workspace packages even if units remain unpublished.
8. Themes are separately versioned opt-in artifacts and never auto-register or ship by default.
9. Jahia remains project-local until multiple independent consumers justify a generic adapter.
10. Release tooling consumes outputs/manifests and is never imported by runtime.

## Contract additions

- `ConsentAuthority.v1` with explicit states, purpose grants, pre-initialization installation, changes, cancellation, cache invalidation, and deletion policy.
- `RuntimeInstanceContext.v1` with instance identity, credentials, transport, tools, timers, abort, storage, setup, and teardown.
- `TurnAbortScope.v1` covering transport, tools, person, judge, specialist, retries, and timers.
- `ConversationStore.v1` with namespace, version, TTL, bounds, migration, and reset.
- Separate visitor-derived and system metadata envelopes, final validation, and conversation-ID scope/TTL/no-tracking rules.
- `SemanticSurface.v1` finite parts/states/variants.
- Strict sanitized/Trusted Types templates plus explicit trusted-host legacy HTML/CSS capability.
- Exact versioned public elements/attributes/methods/events/globals/load-order/failure contract, including `stop()` and the empty `setContextProvider` disposition.
- `ReleaseManifest.v1` with source, compatibility, artifacts/maps/hashes/order, storage/theme/adapter versions, rollback, and readback.

## Revised migration order

1. Repair and freeze upstream's two browser regressions, Algolia's stale UAT identity, and useful integration tests affected by harness cascades.
2. Freeze the full public compatibility ledger and semantic/visual fixtures.
3. Establish package/schema/forbidden-import boundaries.
4. Introduce per-instance context and full abort/stop behind compatibility shims.
5. Implement consent/storage/context boundaries before proactive intelligence.
6. Add explicit Agent Studio transport and judge packages.
7. Port pure Algolia policy into `algolia-com`, then connect browser and Jahia adapters.
8. Migrate semantic presentation and Algolia/Spectrum themes.
9. Build the content-addressed release pipeline and pin `algolia-com`.
10. Pass Gate I before retiring globals, private selectors, bundle editing, or tests.

## Dispute register

- Themes are centrally versioned but opt-in; each host pins/registers them.
- Upstream is the source-history base; integration is a donor, never “Sajid code.”
- Algolia policy and Jahia ownership stay in `algolia-com`.
- Raw CSS/templates use a strict normal path and an explicit legacy trusted-host escape hatch only.
- Logical package enforcement is mandatory; external publication is optional.
- Accessibility wins over exact visual parity through an explicit baseline change.
- Legacy globals are single-widget facades and fail safely when instance targeting is ambiguous.
- Current Jahia operations do not prove executable rollback.
- B/D's numerical tie is resolved by B's hard-gate failures and D's reversible design.
- Wire parsing belongs in the concrete Agent Studio transport adapter.

## Gate recommendation

- Gate E: conditional pass after the amendments above are incorporated into the target package.
- Gate G: recommend approving D, explicitly as an architecture to implement, not as an implemented or release-ready system.
- Gates I, K, and L: not reached.
