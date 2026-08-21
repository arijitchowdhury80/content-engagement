# Wave 2: Presentation and Design-System Audit

The comparison uses all three immutable snapshots. Focused disposable tests passed: Sajid theme/registry/build/neutrality 42/42, integration equivalents 41/41, and Algolia theme 1/1. The passing integration neutrality test is itself evidence of a guard blind spot: it does not scan CSS.

## Verdict

Use Sajid upstream's typed token/compiler and typed slot data/action vocabulary as the design-system foundation, but not unchanged. Add runtime schemas, pure presentation recipes, comprehensive semantic parts/states, trusted-host controls, CSS-inclusive neutrality enforcement, and per-instance context. Preserve Algolia and Spectrum visual intent as separate consumers; do not preserve private selectors or unsafe raw CSS as contracts.

## Critical findings

### Theme inputs and raw CSS are not safely bounded

Sajid's runtime parses inline and remote themes as unchecked `ChatTheme` casts, stores them without validation, appends raw CSS after naïve root/body rewriting, and permits theme/font network loads. Host slot styles are injected verbatim. Algolia's current parity layer depends extensively on raw CSS. Presentation data can therefore cause network access, obscure controls, bypass a future CSP policy, and mutate behavior-adjacent structure.

Disposition: define validated `ThemeDefinition.v1` for tokens/assets and `PresentationRecipe.v1` for component variants, placement, copy mapping, layout, and motion. Make both immutable pure data. Put raw CSS behind an explicit trusted-host capability with selector, URL, origin, integrity, and CSP restrictions, or remove it from normal theme use.

### Current Algolia confidence colors fail contrast

The current positive, notice, and negative foreground/background pairs measure approximately 3.09:1, 3.36:1, and 4.22:1. They are used as small normal-weight badge text and do not meet WCAG AA's 4.5:1 normal-text requirement.

Disposition: accessibility must intentionally alter this visual baseline before parity can be approved.

### Algolia's brand file remains coupled to renderer internals

The theme targets header child order, exact Tailwind utility chains, private `.acs-*` classes, and a generic absolute dialog selector. Tests positively lock these private selectors into the current contract. The live initial widget exposes only six parts and no `data-state` values.

Disposition: port each raw rule to tokens, typed recipes, public parts, and enumerated states; keep a retirement ledger for every private selector.

### Upstream semantic contracts are strong but incomplete

Typed themes, a single token map, tested inheritance/cycle handling, typed slots/data/actions, and Spectrum's streaming-stable light-DOM topology are strong. However, only a small public part set and almost no stable state markers exist, unknown themes silently fall back, and the registry/listeners are global.

Disposition: version `SemanticSurface.v1` with contract-tested parts and enumerated `data-state`/`data-variant` values. Registries and presentation roots must be per instance or immutable namespaced releases.

### Template capabilities require a trust model

Templates can invoke a fixed action vocabulary, but arbitrary attributes/properties are allowed and the HTML sanitizer only removes scripts/styles/event attributes. It does not establish an untrusted-template boundary against embeds or unsafe URLs.

Disposition: templates are either explicitly trusted-host code, or use a robust sanitizer/Trusted Types plus per-directive attribute/property/URL allowlists and capability-gated actions.

### Spectrum and integration are not multi-instance safe

Spectrum uses a fixed trigger ID, one-time injection, and document-global listeners without teardown. Runtime theme/config is global. The integration baseline further regresses presentation separation by omitting newer upstream template regions and placing blue/white glass styling plus radial brand decoration in neutral core files.

Disposition: unique per-instance IDs, explicit adapter lifecycle/teardown, per-instance registries, and latest semantic template contracts. Preserve integration business behavior, not its presentation structure.

### Business roles do not belong in neutral tokens

The integration theme adds fixed product/technology/sales/evidence role fields and a glass shadow. Concierge roles should map through an Algolia-owned presentation recipe; the neutral schema should express semantic intent and geometry only.

## Anchored summary

| Dimension | Algolia | Sajid upstream | Shared integration |
|---|---:|---:|---:|
| Typed token model | 2 (.90) | 4 (.98) | 3 (.96) |
| Runtime validation/trust | 0 (.99) | 1 (.99) | 1 (.99) |
| Brand isolation | 1 (.99) | 3 (.96) | 1 (.99) |
| Semantic parts/states | 1 (.99) | 2 (.99) | 1 (.98) |
| Slot/template extensibility | 1 (.90) | 4 (.96) | 2 (.98) |
| Accessibility evidence | 1 (.99) | 2 (.85) | 2 (.80) |
| Multi-instance safety | 1 (.90) | 1 (.99) | 1 (.98) |
| Visual parity evidence | 3 (.95) | 3 (.92) | 2 (.80) |

Scores use the normative 0–5 scale; parenthetical values are confidence.

## Target presentation contracts

1. `ThemeDefinition.v1`: validated neutral tokens and declared assets only.
2. `PresentationRecipe.v1`: validated variants, layout, copy mapping, placement, and motion; no transport, storage, telemetry, consent, routing, or state mutation.
3. `SemanticSurface.v1`: launcher, panel, backdrop, header/title/controls, thread, turn, user/assistant/reasoning, source list/item/count, follow-up, confidence, error, proactive, composer/input/send, footer, judge drawer, and tool UI parts; enumerated state and variant values.
4. `TemplateContract.v1`: schema-versioned region data, allowlisted bindings, capability-gated actions, trusted-host or sanitized-HTML mode, unique IDs, and teardown.
5. Per-instance theme/config/slot roots with two-widget characterization.
6. Algolia and Spectrum adapter/theme packages consuming the same public contracts.

## Migration order

1. Freeze semantic and visual fixtures.
2. Add runtime schemas, semantic manifest, and CSS-inclusive neutrality enforcement.
3. Expose parts/states while temporarily retaining old classes.
4. Port Algolia CSS rule by rule and retire private selectors.
5. Promote latest Spectrum templates into an adapter with unique IDs and teardown.
6. Introduce per-instance presentation contexts.
7. Run contrast, keyboard, WCAG, reduced-motion, multi-instance, and visual fixtures.
8. Remove raw/private compatibility only after explicit parity approval.

## Evidence anchors

- Runtime theme casts and remote load: `algolia-chat/src/attributes/readDisplayConfig.ts:65`, `algolia-chat/src/chat-embed.tsx:313`.
- Registry/raw CSS: `chat-central/src/theme/registry.ts:67`, `chat-central/src/theme/compile.ts:35`.
- Theme shape: `chat-central/src/theme/chatThemeTypes.ts:16`.
- Slot/action/binding contracts: `chat-central/src/slots/slotNames.ts:25`, `binding/bindingTypes.ts:5`, `binding/actionDirectives.ts:16`.
- Sanitizer gap: `chat-central/src/slots/binding/bindingHelpers.ts:41`.
- Algolia contrast/private CSS: `frontend/chat-widget/algolia-chat-theme-algolia.js:78`, `:166`.
- Integration brand leakage: `chat-central/src/styles/index.css:13`, `chat-central/src/chat/ChatWidget.tsx:212`.
- Spectrum instance coupling: `website/public/spectrum/slots.html:320`, `website/public/spectrum/slots.js:37`.
