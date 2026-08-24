# ADR-001: Modular Chat Architecture and Separation

Status: proposed for Gate G approval
Date: 2026-08-20
Decision authority: user

## Decision

Adopt a selective synthesis. Use pristine Sajid upstream commit `e06c6b5ff20c8576bec01fdf000981cd8873cc06` as the clean source-history base. Do not adopt Sajid upstream unchanged. Port integration work only through the hash-pinned donor manifest and preserve Algolia behavior through explicit compatibility contracts.

The central repository owns shared runtime and reusable presentation mechanisms. `algolia-com` owns Algolia business policy, browser/site integration, composition, Jahia operations, and site-specific presentation.

This ADR approves an architecture to implement. It does not claim Gate I readiness or authorize a push, publication, Jahia deployment, Agent Studio/index mutation, Spectrum production change, or legacy retirement.

## Why this decision

- Algolia current has the best concierge characterization and Jahia operational safety, but no readable canonical shared-widget source and multiple privacy/instance/presentation defects.
- Sajid upstream has the cleanest source/build substrate and strongest typed theme/slot/template foundation, but fails privacy, instance isolation, current Spectrum behavior, accessibility proof, and release provenance.
- Shared integration has high-value pure modules and tests, but its dirty provenance, lost abort chain, policy leakage, and failing static/browser/release gates make wholesale adoption unsafe.
- The synthesis is the only design that explicitly remediates all hard-gate defects while preserving the strongest assets. Its 53/100 design-maturity score ties Sajid unchanged, but Sajid is eliminated by non-compensating hard gates.

## Canonical implementation worktrees

After Gate G, create two isolated Stage 2 branches/worktrees:

```text
central source base
  repository: /Users/arijitchowdhury/Dropbox/AI-Development/RAG/algolia-central-chat-widget-sajid-latest
  base: e06c6b5ff20c8576bec01fdf000981cd8873cc06
  branch: codex/chat-design-separation-2026-08-20-001
  worktree: /Users/arijitchowdhury/Dropbox/AI-Development/RAG/algolia-central-chat-widget-reconciled-2026-08-20-001

Algolia consumer base
  repository: /Users/arijitchowdhury/Dropbox/AI-Development/algolia-com
  base: approved clean Gate F commit
  branch: codex/chat-design-separation-2026-08-20-001
  worktree: /Users/arijitchowdhury/.codex/worktrees/chat-design-separation-2026-08-20-001/algolia-com
```

Only content-addressed artifacts/manifests cross the repository boundary. The pristine upstream checkout remains untouched.

## Central logical packages

These are workspace-enforced units; external publication is optional and separately approved.

```text
packages/contracts/
packages/runtime/
packages/transport-agent-studio/
packages/judge/
packages/visitor-context/
packages/persistence/
packages/presentation/
packages/web-component/
packages/theme-algolia/
packages/theme-spectrum/
packages/adapter-spectrum/
packages/adapter-legacy-storage/
packages/conformance/
packages/release-tools/
```

### Ownership

- `contracts`: pure versioned types and runtime schemas. No DOM, React, network, provider, storage, brand, telemetry, or host dependency.
- `runtime`: per-instance state machine, provider-neutral semantic-event reducer, abort/retry/tool lifecycle, source attachment, and injected ports.
- `transport-agent-studio`: credentials, URLs, HTTP, SSE framing, provider event decoding, redaction, protocol errors, and `TurnTransport` implementation.
- `judge`: neutral judge execution, cancellation, timeouts, result normalization, and typed result projection.
- `visitor-context`: host-neutral packet validation, redaction, normalization, fingerprinting, freshness, and bounded context compilation.
- `persistence`: storage-independent conversation serializer, migrations, stable IDs, interrupted-turn normalization, and restore/reset semantics over an injected store.
- `presentation`: accessible neutral renderer, semantic surface, token compiler, slots/templates, focus/modal/reduced-motion behavior, and pure declared actions.
- `web-component`: neutral element facade, attributes/properties, buffered methods, DOM events, instance handles, lifecycle, and versioned compatibility shims.
- `theme-algolia`: portable Algolia brand tokens/assets, semantic variants, accessibility-safe defaults, and presentation labels only. It is opt-in and never auto-registers.
- `theme-spectrum`: Spectrum tokens, recipes, presentation templates/components, motion, and assets.
- `adapter-spectrum`: Spectrum host lifecycle, composition root, instance IDs, config translation, `acs_*` compatibility use, and teardown.
- `adapter-legacy-storage`: generic translation for existing `acs_profile`, `acs_events`, and `acs_session`; it is not a neutral runtime default.
- `conformance`: reusable public-contract, multi-instance, load-order, storage, accessibility, artifact, and compatibility tests.
- `release-tools`: deterministic builds, maps, hashes, manifests, compatibility checks, budgets, and rollback tooling; runtime never imports it.

## `algolia-com` ownership

```text
frontend/chat-widget/policy/
frontend/chat-widget/browser/
frontend/chat-widget/presentation/
frontend/chat-widget/composition/
frontend/chat-widget/jahia/
frontend/chat-widget/releases/<release-id>/
```

- `policy`: pure journey classification, discovery, proactive eligibility, specialist routing, handoff rules, judge/business configuration, retention/reset policy, prompts, and business copy.
- `browser`: consent bridge, signal collection, storage implementations, navigation subscriptions, browser capability ports, namespace mapping, and teardown. It never replaces `window.fetch`; normal operation never replaces history methods.
- `presentation`: www/Jahia panel geometry, z-index, marketing typography, site layout recipe, and semantic overrides. It contains no private renderer selectors.
- `composition`: constructs and wires one runtime instance, transport, judge, consent, storage, policy, browser mechanisms, theme, presentation, and host inputs. The neutral element never discovers Algolia dependencies.
- `jahia`: script lifecycle, custom-code-block generation, asset resolution, snapshot/dry-run/readback/rollback, and composite manifest consumption.

## Dependency rules

1. All implementation packages depend inward on `contracts`; contracts depend on no implementation.
2. Runtime receives opaque transport, judge, policy, context, storage, tool, and browser ports.
3. Provider event names and wire formats never appear in runtime; runtime reduces finite semantic events.
4. Provider credentials remain inside the transport factory and never enter runtime snapshots, events, logs, persistence, or errors.
5. Presentation cannot perform network, storage, telemetry, consent, routing, or conversation mutation.
6. Policy is pure; browser mechanisms collect and persist; composition wires them.
7. Themes are opt-in artifacts and cannot auto-register or import host/runtime code.
8. Adapters import public contracts/composition surfaces; neutral packages never import adapters.
9. Static imports, dynamic imports, export maps, CSS, templates, build entries, generated source manifests, and bundles are scanned for forbidden dependencies and brand leakage.

## Public compatibility contracts

Freeze the union of required deployed Algolia and upstream contracts before any repair:

- elements/topology, attributes, properties, methods, events, globals, load order, storage schemas, and failure behavior;
- `stop()` and complete abort semantics;
- `setContextProvider` remains a warned legacy no-op in v1; vNext uses typed `VisitorContextPort` rather than silently changing the no-op;
- global pre-load registries (`registerTheme`, `registerTool`, `registerUI`) replay deterministically and may serve multiple instances;
- control APIs use explicit instance handles; legacy no-argument control works only with exactly one eligible instance and fails with a typed/documented error for zero or multiple instances;
- no first/last/active widget fallback or `querySelector` targeting;
- teardown unregisters exact handles.

### Required behavioral invariants

- Judge output is advisory and never replaces, hides, or completes the original streamed answer.
- Sourced specialist output is additive and cannot be demoted by confidence handling.
- Limitation/zero-source text remains secondary.
- Exactly one discovery question follows answer/specialist resolution when policy permits.
- Specialist consent resolves before discovery; accept/decline is one-dispatch and late errors cannot duplicate work.
- Proactive defaults to the approved docked behavior and shares the transcript lane.
- Stable public message IDs, six semantic processing-progress stages, and instance-scoped diagnostics remain available.
- Copy-before-submit behavior is preserved through an injected `ClipboardPort`, not direct neutral DOM code.
- Reset semantics are typed and tested rather than collapsed into one delete call.

## Privacy, storage, and lifecycle contracts

### `ConsentAuthority.v1`

- States: `unknown`, `denied`, `granted`, `withdrawn`; grants are purpose-specific.
- `unknown` fails closed for analytics, personalization, and proactive behavior. Essential user-requested chat transport is a distinct purpose.
- No signal, storage, cache, Person, proactive, or context read occurs before purpose resolution.
- Withdrawal order: mark unavailable → abort affected scopes → block reads/writes → invalidate memory caches → delete purpose-bound persisted data → emit a sanitized completion receipt.
- Generation guards prevent late callbacks from recreating cleared data.
- Withdrawing personalization does not erase an essential visible transcript unless the approved retention contract requires it.

### `TurnAbortScope.v1`

Abort covers transport readers, retry delays, tools, Person/subagents, judge, specialist/human suspension, proactive greeting, timers, and queued semantic events. Reset, unmount, superseding turn, and withdrawal are idempotent. No retry or late callback may update state after abort; instance and turn generations enforce this.

### Storage and reset

Namespace tuple: product/brand, host, logical widget instance, schema, and purpose. TTL is enforced on read/write. Record, transcript, turn, source, key, value, and total sizes are bounded. Malformed/oversized/unknown versions fail closed. Cross-tab behavior, quota degradation, migration, and reset receipts are explicit.

`ResetPolicy.v1` distinguishes session/demo reset, conversation reset, full visitor reset, and consent withdrawal/erasure. Each specifies affected namespaces, event/receipt, idempotency window, preservation rules, and whether fresh state may be created. Denied/withdrawn consent never creates new tracking state.

Visitor-derived context and system metadata remain separate typed envelopes. One final validator runs after policy metadata and conversation identity are composed. Conversation identity is same-tab/session scoped, rotates/reset under declared rules, has a TTL, and cannot become visitor identity or a cross-session tracking key.

## Presentation and trust contracts

- `ThemeDefinition.v1`: validated neutral tokens and declared assets.
- `PresentationRecipe.v1`: validated layout, variants, placement, labels, responsive geometry, and motion; pure data only.
- `SemanticSurface.v1`: finite versioned public parts, states, and variants.
- `TemplateContract.v1`: versioned data regions, capability-gated actions, unique IDs, teardown, and allowlisted attributes/properties/URLs.
- Normal templates use robust sanitization/Trusted Types. Raw HTML/CSS exists only as an explicit trusted-host legacy capability with CSP, origin, integrity, URL, and selector restrictions.

Policy owns prompts, journey/discovery/specialist/handoff language, business explanations, and retention notices. Presentation owns control/status labels and accessibility names. No theme string may influence routing, eligibility, consent, storage, or model instructions.

## Release composition

### Central `ReleaseManifest.v1`

Declares central commit, clean build image, lockfile hashes, build command, compatibility versions, artifact allowlist/hashes/sizes/MIME/source maps, bundle graph/load order/double-load policy, theme/adapter/storage contracts, CSP/Trusted Types requirements, and prior compatible release.

### Project `AlgoliaDeploymentManifest.v1`

Pins one central manifest hash plus the `algolia-com` commit and project policy/browser/presentation/Jahia artifact hashes. It declares the compatibility matrix, exact composition/build inputs, final assembled asset hashes/order, expected Jahia paths/readback, and prior composite release/rollback command.

Project-local compiled policy or presentation is never hand-edited after manifest generation.

## Donor non-loss rule

`integration-donor-manifest.json` freezes 84 non-base architecture items:

- 13 committed-only;
- 20 committed then dirtied;
- 21 base files dirtied;
- 30 untracked additions.

Every row must be marked `port`, `rewrite`, `replace-by-contract`, `retain-as-characterization`, or `retire-with-reason`, with replacement evidence, before donor source is deleted. The clean preservation branch contains separate runtime, UI, adapter, and test commits. Raw/generated/private documentation remains externally quarantined and is not committed.

## Migration sequence

1. Freeze the complete current compatibility/behavior ledger, known failures, semantic fixtures, visual fixtures, storage/load-order contracts, and donor manifest.
2. Create failing characterization for upstream's two regressions, integration abort loss, Algolia stale UAT identity, and every hard-gate gap.
3. Establish logical package boundaries, schemas, export maps, and forbidden dependency checks.
4. Repair baseline regressions only in isolated Stage 2 branches; every intentional contract change amends this ADR.
5. Introduce per-instance context, explicit handles, semantic transport events, and the full abort/stop chain behind enumerated compatibility facades.
6. Implement consent, reset, storage, browser mechanism, visitor-context, and persistence boundaries before proactive intelligence.
7. Add Agent Studio transport, judge, conformance, and composition roots.
8. Port donor contracts/tests before implementations, then pure Algolia policy and browser/Jahia composition.
9. Introduce semantic presentation contracts and migrate portable Algolia, site-specific Jahia, and Spectrum themes/adapters.
10. Build both manifests and pin `algolia-com` to the composite release.
11. Gate I1: prove behavior, privacy, accessibility, visual parity, artifact identity, rollback, performance, and compatibility while only enumerated shims remain.
12. Retire forbidden global interception, private selectors, direct bundle editing, duplicate release flows, and source-text-only tests.
13. Gate I2: rerun boundary and parity gates after retirement. Only explicitly approved public compatibility facades may remain.

No deployment occurs in this sequence.

## Rejected alternatives

- Algolia unchanged: lowest immediate migration but no readable shared source, fail-open privacy, singleton wiring, private presentation coupling, and incomplete provenance.
- Sajid unchanged: best source substrate but current browser regressions, globals, fail-open tracking, accessibility gaps, and no release identity.
- Integration unchanged: rich donor behavior but dirty provenance, abort regression, policy leakage, red static/browser gates, and WIP releases.
- Mechanical merge/rebase: semantic conflict risk across 30 overlapping files and no safe provenance/boundary preservation.
- One omnibus package: preserves current coupling and prevents dependency enforcement.

## Consequences and risks

- More logical packages increase coordination cost. Publication is optional; workspace enforcement and contract clarity are mandatory.
- D has unproven performance and implementation readiness. Gate I budgets and clean-container builds settle this.
- Compatibility shims temporarily add complexity. They are enumerated, single-purpose, instrumented, and retired through Gate I2.
- Accessibility fixes intentionally change some Algolia colors and may update approved visual baselines.

## Approval wording

Approve the synthesis for Stage 2 implementation, with pristine Sajid upstream as the source-history base and Algolia/integration as evidence-backed donors. Do not treat the synthesis as implemented or release-ready.
