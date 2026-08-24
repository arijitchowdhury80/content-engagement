# Target Architecture Hypothesis for Adjudication

Status: proposed at Gate E; not yet approved for Stage 2

## Canonical source proposal

Use Sajid upstream commit `e06c6b5ff20c8576bec01fdf000981cd8873cc06` as the clean source-history base because it contains the latest readable typed runtime and presentation contracts. Keep the pristine checkout unchanged. After Gate G, create a separate local worktree and branch:

```text
source repository: /Users/arijitchowdhury/Dropbox/AI-Development/RAG/algolia-central-chat-widget-sajid-latest
implementation branch: codex/chat-design-separation-2026-08-20-001
implementation worktree: /Users/arijitchowdhury/Dropbox/AI-Development/RAG/algolia-central-chat-widget-reconciled-2026-08-20-001
```

This selects a source-history base, not Sajid's architecture wholesale. Shared-integration code is ported by explicit commits after provenance review. `algolia-com` remains the Algolia consumer/policy/Jahia repository and stops owning editable shared compiled bundles.

No remote ownership or push is implied. If the eventual canonical remote differs, that requires a separate repository-governance decision without changing the local architectural base.

## Proposed package graph

```text
@chat/contracts
  ├─> @chat/runtime
  ├─> @chat/presentation
  ├─> @chat/transport-agent-studio
  ├─> @chat/judge
  ├─> @chat/theme-algolia
  ├─> @chat/adapter-spectrum
  └─> algolia-com policy/browser/Jahia modules

@chat/runtime + @chat/presentation
  └─> @chat/web-component

declared build outputs
  └─> @chat/release-tools
```

Package names are local architectural identifiers until repository/package governance is approved.

### `@chat/contracts`

Owns versioned pure types and runtime schemas only:

- public widget attributes, methods, events, and compatibility versions;
- turn, stream, tool, source, judge, error, and semantic UI-state contracts;
- theme, recipe, semantic surface, slot/template, and action-capability schemas;
- visitor signal/intelligence/context envelopes;
- consent, storage namespace, reset, retention, and conversation metadata contracts;
- release-manifest and adapter compatibility schemas.

It has no React, DOM, network, storage, telemetry, brand, Agent Studio, or host dependency.

### `@chat/runtime`

Owns neutral execution:

- `RuntimeInstanceContext` and lifecycle;
- turn state machine, abort scope, retry/error behavior;
- Agent Studio-neutral transport port and streaming parser;
- finite tool loop and human-interaction suspension;
- source/judge data projection;
- injected policy, visitor-context, persistence, and tool ports;
- stable semantic state output and public events.

It cannot import presentation, brand themes, Algolia policy, Jahia, Spectrum, browser storage, site URLs, or project copy.

### `@chat/presentation`

Owns the neutral renderer and design-system implementation:

- React renderer behind a framework-neutral widget interface;
- neutral structural scaffold and accessible interaction patterns;
- validated token compiler and per-instance registry;
- semantic parts/states/variants;
- typed static/dynamic slot and template outlets;
- capability-gated presentation actions;
- reduced-motion and modal/focus contracts.

It consumes typed state and emits declared actions. It cannot perform transport, storage, telemetry, consent, routing, or conversation mutation directly.

### `@chat/web-component`

Owns the host-neutral custom-element facade:

- element registration and nested configuration elements;
- attribute/property parsing through runtime schemas;
- buffered imperative API;
- DOM events and lifecycle;
- shadow/light DOM mounting;
- compatibility shims and deprecation warnings.

It composes one runtime instance with one presentation instance. It contains no brand theme or project policy.

### `algolia-com/frontend/chat-widget/policy`

Remains project-local and owns Algolia concierge behavior:

- visitor signal collectors and canonical page/journey classifier;
- fail-closed consent-aware context projection;
- discovery ledger and question policy;
- proactive eligibility/state/greeting policy;
- specialist routing and handoff composition;
- source/judge/business configuration and copy mappings;
- versioned conversation persistence policy.

Mechanisms remain injected. This module never patches global fetch/history or targets a widget by document query.

### `algolia-com/frontend/chat-widget/browser`

Owns the consent bridge, browser signal collectors, history/navigation integration, storage adapters, namespaces, and lifecycle teardown. It uses explicit host/runtime ports and never patches `window.fetch` or history implicitly.

### `@chat/transport-agent-studio`

Owns concrete Agent Studio URLs, credentials/configuration schema, wire protocol, SSE parsing, and transport errors. It implements the neutral runtime's `TurnTransport` port and produces semantic events; the neutral runtime does not parse provider wire formats.

### `@chat/judge`

Owns neutral judge execution, typed inputs/results, cancellation, timeouts, and deterministic projection. Algolia agent selection, thresholds, labels, and policy remain in `algolia-com`.

### `@chat/theme-algolia`

Owns validated Algolia tokens, assets, presentation recipes, status/confidence variants, copy mappings, responsive geometry, and motion. It preserves current visual intent but replaces private renderer selectors. It intentionally changes inaccessible confidence colors.

### `@chat/adapter-spectrum`

Owns Spectrum theme tokens, templates/components, unique instance IDs, listener lifecycle/teardown, and legacy `acs_*` compatibility. It must not leak Spectrum names/classes/storage into neutral packages.

### `algolia-com/frontend/chat-widget/jahia`

Remains project-local and owns Algolia Jahia script lifecycle, storage namespace mapping, asset/config resolution, custom-code-block generation, snapshot/dry-run/readback/rollback, and release-manifest consumption. It cannot edit shared build output. It becomes a generic central adapter only if multiple independent consumers later justify that boundary.

### `@chat/release-tools`

Owns deterministic builds, source maps, artifact hashing, compatibility/version validation, consumer pinning, readback comparison, performance budgets, and rollback manifests. It consumes declared outputs; runtime never imports it.

## Exact target paths

```text
central source worktree
  packages/contracts/
  packages/runtime/
  packages/presentation/
  packages/web-component/
  packages/transport-agent-studio/
  packages/judge/
  packages/theme-algolia/
  packages/adapter-spectrum/
  packages/release-tools/

algolia-com
  frontend/chat-widget/policy/
  frontend/chat-widget/browser/
  frontend/chat-widget/jahia/
  frontend/chat-widget/releases/<release-id>/
```

These are enforceable workspace units. External package publication is optional and requires separate approval.

## Dependency rules

1. All cross-package imports use declared public exports; no source-path alias bypasses package artifacts.
2. Runtime never imports presentation, themes, policy implementations, or adapters.
3. Presentation never imports transport, persistence implementations, policy implementations, or host adapters.
4. Themes depend only on contracts and declared presentation recipe types. They are separately versioned, opt-in artifacts and never auto-register or ship in the neutral bundle.
5. Policies depend only on contracts/ports, not renderer or host DOM. Browser mechanisms implement explicit ports separately from pure policy.
6. Adapters depend inward on public contracts/composition surfaces; neutral packages never import adapters.
7. Dependency tests scan TypeScript, JavaScript, CSS, templates, package manifests, and build inputs.

## Compatibility strategy

Preserve the deployed `<algolia-chat>` surface behind the new composition:

- current attributes, element topology, global registration APIs, public methods, and DOM events receive explicit versioned dispositions;
- `stop()` and upstream abort semantics are restored;
- Algolia global helper APIs become one-widget compatibility facades over an explicit instance handle;
- a second widget cannot silently share singleton state;
- private CSS selectors are supported only during a measured migration window, then removed after semantic replacements pass;
- `algolia_*` storage remains Algolia-owned; `acs_*` remains only in the Spectrum/legacy adapter;
- bundle filenames/load order remain compatible until the Jahia consumer moves to `ReleaseManifest.v1`.

## Principal contracts

- `RuntimeInstanceContext.v1`
- `WidgetCompatibilityContract.v1`
- `TurnEnvelope.v1` and `TurnAbortScope.v1`
- `TurnTransport.v1` and Agent Studio semantic-event mapping
- `PolicyPorts.v1`
- `ConsentAuthority.v1`
- `VisitorSignalPacket.v1`, `VisitorIntelligencePacket.v1`, and `TurnContext.v1`
- `ConversationStore.v1`
- `ThemeDefinition.v1`
- `PresentationRecipe.v1`
- `SemanticSurface.v1`
- `TemplateContract.v1`
- `HostAdapterLifecycle.v1`
- `ReleaseManifest.v1`

## Strangler sequence

1. Add characterization and versioned contracts without changing runtime behavior.
2. Repair and freeze the two upstream browser regressions, Algolia's stale UAT identity, and integration tests affected by harness cascades.
3. Freeze the full compatibility ledger plus semantic and visual fixtures.
4. Establish package schemas and forbidden-import checks.
5. Restore abort/stop and introduce per-instance context behind legacy singleton facades.
6. Implement consent, storage, browser mechanism, and bounded-context boundaries before proactive intelligence.
7. Add explicit Agent Studio transport and judge packages.
8. Extract runtime policy ports and move Algolia concierge rules into project-local pure policy.
9. Add validated theme/recipe/semantic contracts and port Algolia/latest Spectrum presentation with temporary compatibility selectors.
10. Introduce manifest-driven builds and pin `algolia-com` locally.
11. Run behavioral, privacy, accessibility, visual, concurrency, performance, and rollback gates.
12. Retire global interceptors, private selectors, direct compiled-bundle editing, and duplicate sync/release flows only after Gate I.

## Explicit non-decisions

- No push, package publication, canonical remote change, Jahia deployment, Agent Studio/index mutation, or Spectrum production release.
- No claim that the proposed synthesis passes Gate I before implementation.
- No mechanical merge or rebase of the dirty integration branch.
