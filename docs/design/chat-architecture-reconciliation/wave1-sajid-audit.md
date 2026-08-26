# Historical Wave 1: Sajid Upstream Audit

> The source baseline remains unchanged, but three factual corrections and the current browser rerun belong to Gate 2 of [`MASTER-PLAN-2026-08-25.md`](MASTER-PLAN-2026-08-25.md).

Baseline: `sajid-upstream` at `e06c6b5ff20c8576bec01fdf000981cd8873cc06`
Snapshot manifest: `469f6bf0753f8d542e041dca06bfd39b6ce2b5ff012bc8298b46055f287b14de`
Scope coverage: 246/246 `architecture_included` files

## Independent verdict

Sajid upstream contains the strongest concrete design-system contracts in the comparison, especially typed themes, semantic slots, template bindings, and neutrality tests. Those presentation seams nevertheless sit inside a stateful, module-global complete engine. Privacy, accessibility verification, multi-instance isolation, and release provenance fail or remain below the required hard gates. Preserve its contracts and tests; reject wholesale adoption unchanged.

## Executed characterization

| Check | Result |
|---|---|
| Format, lint, and typecheck | Pass |
| Central unit tests | Pass; 18 files, 280 tests |
| Central, widget, and website builds | Pass |
| Browser suite | Fail; 135 passed, 2 failed, 1 skipped |
| Targeted rerun | Both failures reproduced |
| Production dependency audit | Pass; no known production vulnerability |

The browser failures are current Spectrum-parity regressions: a proactive suggestion remains after submission, and a configured assistant avatar stays hidden. No WCAG 2.2 AA suite, concurrent-widget isolation test, Algolia/Jahia parity test, or executable release rollback exists.

Approximate build output: main widget 497.75 kB / 148.11 kB gzip; central ESM main chunk 222.21 kB / 57.42 kB gzip; optional bundles 1.82–6.79 kB.

## Package and ownership map

- `chat-central` contains connectors, Agent Studio transport/tool loop, turn state, built-in React UI, judge, person/proactive behavior, themes, CSS, slots, templates, and global registries.
- `algolia-chat` wraps central in custom elements and emits a main IIFE plus optional tracker, engage, personalization, form, badge, and brand bundles.
- `website` contains Spectrum host templates/CSS, brand themes, demo policy/data, and copied bundles.

This is a useful source split, but not an enforced runtime/design-system/theme/business-policy/host-adapter architecture. The wrapper aliases central source rather than consuming a pinned built package. Both packages are private and versioned `0.1.0`.

## Preserve and harden

### Typed themes

- `ChatTheme` covers colors, typography, spacing, radii, shadows, motion, geometry, dark mode, inheritance, and a raw-CSS escape hatch.
- The registry supports late registration, replacement notifications, deep inheritance, cycle detection, and neutral fallback.
- The compiler and token map make the theme output reproducible.
- Neutrality tests ban built-in brand themes and brand leakage and constrain URLs, storage, and tool names.

Adopt the model, add runtime schema validation and an explicit trusted-host policy for raw CSS, and scope registries per runtime/host rather than globally.

### Semantic presentation contracts

- Static replacement regions cover launcher, panel, header, thread, welcome, composer, footer, judge drawer, and tool UI.
- Dynamic regions cover messages, sources, suggestions, thinking/errors, deep dives, discovery, proactive, welcome, judge, and sample questions.
- Thirteen typed slot-data contracts expose neutral data and a constrained action vocabulary.
- Light-DOM portal and template patching preserve streaming DOM identity and support external design-system components.

Adopt these as the main design-system seam, extend semantic parts/states, and export/version the contracts as a public package boundary.

## Redesign requirements

### Per-instance ownership

Active config, credentials, proactive timers/state, record fields, visitor source/tracker, tools, themes, and UI registries are module-global. Engage and controller code selects the first widget in the document. Conversation state is per renderer, but surrounding state is not.

Target disposition: per-instance runtime/configuration container with explicit lifecycle and teardown.

### Privacy and consent

The tracker defaults to immediate collection when no adapter exists. Withdrawal stops new writes but does not erase stored or pending data. Personalization lacks the same consent authority, retention expiry is unspecified, and local stored data is exposed when person support is enabled.

Target disposition: preserve pluggable consent, make the default fail closed, install authority before initialization, define withdrawal/retention, and apply it uniformly.

### Accessibility

Dialog semantics, Escape dismissal, live regions, names, and reduced-motion coverage exist. There is no complete WCAG scanner or manual evidence, modal focus trap/initial focus/focus restoration/inert background contract is absent, and body overflow restoration is unsafe.

Target disposition: retain semantics and add an enforced modal interaction contract plus WCAG 2.2 AA verification.

### Release provenance

Builds use stable unversioned filenames, no source maps/hashes/manifest/rollback identity, and website sync copies mutable output. Target disposition: content-addressed release manifests and pinned consumption.

### Boundary enforcement

Presentation is injectable but remains packaged with transport, state, judge, person/proactive behavior, business strings, and storage. Satellite bundles duplicate SSE and visitor mechanisms.

Target disposition: split contracts/runtime/presentation/policy/adapters, consolidate mechanisms, and retain optional delivery only where security or loading needs justify it.

## Public compatibility surface

- Elements: `algolia-instant-search`, `algolia-chat`, `algolia-agent`, `algolia-chat-person`, `algolia-chat-confidence`, `algolia-chat-visitor`, `algolia-chat-engage`, `algolia-chat-form`, `algolia-confidence-badge`, and `algolia-brand`.
- Widget API: `open`, `ask`, `stop`, `setPersona`, `engage`, `setAnalyzing`, `autoEngage`, `setAutoEngage`, and `setVisitorDataSource`.
- Events: chat engaged/persona/open/auto-engage/state changes plus widget-added/removed lifecycle events.
- Window APIs: theme, tool, and UI registration; tool UI lifecycle; tracker, engage, personalization, and form-tool APIs.
- Presentation: typed `ChatTheme`; static/template slot unions; thirteen slot-data interfaces; data binding/action/event directives; semantic parts; `data-streaming` and `data-input-blocked` states.

## Hard-gate result

| Gate | Current result | Reason |
|---|---|---|
| Behavioral correctness | Fail | Two reproducible browser regressions |
| Privacy and consent | Fail | Immediate tracking default and incomplete withdrawal/retention |
| Accessibility | Unknown/likely deficient | Useful semantics but no WCAG evidence and modal focus gaps |
| Spectrum parity | Fail | Proactive suggestion and avatar regressions |
| Rollback safety | Fail | No release identity, manifest, readback, or rollback contract |

## Evidence anchors

- Central public surface: `chat-central/src/index.ts:3`.
- Source alias/package metadata: `algolia-chat/vite.config.ts:12`, `chat-central/package.json:3`.
- Theme types/registry/compiler: `chat-central/src/theme/chatThemeTypes.ts:16`, `registry.ts:27`, `compile.ts:137`.
- Neutrality guard: `chat-central/src/__tests__/neutrality.guard.test.ts:74`.
- Slot names/contracts/runtime: `chat-central/src/slots/slotNames.ts:25`, `contracts/index.ts:1`, `SlotOutlet.tsx:24`, `TemplateOutlet.tsx:262`.
- Module globals: `chat-central/src/config/active.ts:27`, `config/runtime.ts:34`, `config/proactive.ts:77`.
- First-widget targeting: `algolia-chat/src/engage-embed.ts:213`, `chat-central/src/engagement/engagementController.ts:120`.
- Tracking default and initialization: `algolia-chat/src/tracker-embed.ts:17`, `:149`, `:484`.
- Runtime theme cast/raw CSS: `algolia-chat/src/attributes/readDisplayConfig.ts:65`, `chat-central/src/theme/compile.ts:44`.
- Browser regressions: `tests/spectrum-chrome.spec.ts:538`, `:593`.
- Release copying: `algolia-chat/vite.config.ts:30`, `website/scripts/sync-widget.mjs:30`.
