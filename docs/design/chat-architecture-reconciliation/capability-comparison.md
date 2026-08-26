# Historical Capability Comparison

> Current Algolia capabilities and test evidence have materially changed. Retain this as August 20 evidence; regenerate the current matrix at Gate 2 of [`MASTER-PLAN-2026-08-25.md`](MASTER-PLAN-2026-08-25.md).

Status: evidence synthesis pending neutral adjudication
Scope: 559/559 frozen architecture files dispositioned

No repository wins wholesale. Current evidence supports a selective synthesis rooted in Sajid's typed source/contracts, constrained by a new per-instance runtime boundary, enriched with integration's bounded/pure modules, and preserving Algolia's concierge behavior and Jahia safeguards as project-owned capabilities.

| Capability | Algolia current | Sajid upstream | Shared integration | Preliminary target disposition |
|---|---|---|---|---|
| Canonical readable widget source | Compiled core only | Strong TS/React source | Readable but divergent/dirty source | Use an approved clean central source; never make `algolia-com` own editable shared bundles |
| Turn/stream/tool mechanics | Characterized through bundles | Typed parser/tool loop, abort, finite steps | Adds fixes but loses abort | Base on upstream mechanics; selectively port fixes; enforce abort scope |
| Runtime instance ownership | Page globals and interceptors | Per-renderer conversation, global surrounding config | Same globals plus transport singleton | New per-widget `RuntimeInstanceContext` |
| Public web-component compatibility | Deployed and deeply tested | Broad element/API surface | Attempts compatibility with failures | Freeze Algolia + upstream superset; version/shim/retire each difference |
| Theme tokens/compiler | Consumes theme conventions | Strong typed token/compiler/registry | Older fork plus product-specific fields | Adopt upstream model; runtime validate; remove business roles from neutral tokens |
| Semantic slots/templates | Sparse live parts, private CSS | Strong typed static/dynamic contracts | Older incomplete slot system | Adopt latest upstream contracts; version/expand semantic surface |
| Brand/theme ownership | Separate Algolia file but structural reach-through | Host-owned brand/Spectrum files | Brand CSS leaks into core | Separate Algolia and Spectrum theme/adapter packages; CSS-inclusive neutrality |
| Raw CSS/templates trust | Extensive unrestricted CSS | Unchecked JSON/remote/raw CSS and weak sanitizer | Same class of defect | Validated schemas, CSP/integrity/origin policy, trusted-host capability or strict sanitizer |
| Concierge journey policy | Strongest, eight characterized journeys | Generic/prototype behavior | Rich policy embedded in turn runner | Preserve Algolia behavior in `algolia-concierge-policy` ports |
| Visitor signal collection | Rich bounded event/profile/session model | Tracker/person mechanism, limited consent | Adds versioned visitor contracts | Port bounded collectors/contracts behind one consent/storage authority |
| Turn context | Deployed compiler with limits but global fetch patch | Person-agent raw data path | Strong bounded native projection plus metadata bypass | Adopt bounded projection; separate/validate system metadata; explicit transport port |
| Consent/privacy | Fail open; initializes before queued adapter | Fail open/no uniform contract | Optional consent interpreted as granted | New fail-closed purpose-specific consent contract; withdrawal clears caches according to policy |
| Proactive engagement | Most deterministic lifecycle and evidence | Duplicated controller/embed approach | Policy and mechanism coupled | One neutral lifecycle; Algolia eligibility/greeting policy injected; per-instance state |
| Specialist routing/handoff | Strong deployed compatibility and retry | Typed specialist gate | Useful routing fixes, business rules in core | Upstream mechanism + selected fixes; Algolia routing/handoff policy outside core |
| Conversation persistence | Project intelligence/session records | No equivalent transcript persistence | Versioned transcript and interrupted-turn normalization | Port behind namespaced versioned bounded TTL `ConversationStore` |
| Source/answer/follow-up projection | Strong characterized presentation | Typed source/judge models | Useful cleanup/grouping/multiple follow-ups | Neutral data projection in core; display placement/copy in recipes |
| Judge/confidence | Deployed three-judge behavior and badge | Readable judge engine and badge | Deterministic improvements | Readable capability module; Algolia policy/config separate; accessible theme tokens |
| Accessibility | Useful labels/reduced motion, incomplete audit; contrast failure | Better semantics, modal focus gaps | Inherits gaps | WCAG 2.2 AA contract and test harness; visual baseline intentionally updated where needed |
| Spectrum parity | Not a Spectrum source | Strong fixtures with two current failures | Older incomplete presentation branch | Preserve latest upstream Spectrum topology; repair failures before approval |
| Algolia parity | Current Jahia is hash-identified oracle | Not characterized against Jahia | Partial and divergent tests | Canned + browser fixtures against sanitized current baseline; accessibility can approve intentional drift |
| Multi-instance | Fails | Fails | Fails | Mandatory concurrent two-widget tests with distinct config, storage, themes, transports, teardown |
| Build/package boundary | No widget source/build | Source packages but aliases, private/unpinned | Multiple builds/sync paths | Enforced packages and dependency graph from ADR; consumer uses pinned release artifacts |
| Artifact provenance | Jahia hash/readback strong, source link absent | No manifest/hash/rollback | Duplicate sync and incomplete release trees | Content-addressed `ReleaseManifest.v1` from source commit through browser readback |
| Jahia operations | Strong snapshot/dry-run/allowlist/readback | No Jahia release contract | Useful experiments but non-reproducible | Preserve Algolia safeguards inside explicit Jahia adapter and manifest consumer |
| Tests/diagnostics | Deep behavior suite; stale UAT evidence | Strong unit/E2E; two red cases | Green units but red browser/contracts and unstable harness | Layered mandatory gates; eliminate bundle-text archaeology after source-level replacements |

## Split concerns

| Concern | Mechanism owner | Policy owner | Presentation owner |
|---|---|---|---|
| Source ordering | Neutral source projection contract | Optional host/business ranking policy | Source layout, count, typography, expansion |
| Follow-ups | Turn/policy capability produces typed suggestions | Algolia rules/prompts decide content eligibility | Recipe decides placement, grouping, labels, motion |
| Visible answer | Core exposes typed answer segments | Business policy may redact/shape allowed content through an injected projector | Theme/recipe controls typography and progressive disclosure |
| Proactive | Instance lifecycle evaluates an injected decision port | Algolia policy owns signals, thresholds, caps, greetings, consent eligibility | Theme/recipe owns launcher/greeting appearance |
| Specialist handoff | Core owns typed transition, consent suspension, abort/retry | Algolia policy selects specialist and composes bounded context | UI contract renders consent, status, and result |
| Confidence/judge | Judge capability produces typed result | Algolia config selects agents/thresholds | Theme/recipe maps semantic confidence to accessible treatment |
| Persistence/reset | Storage adapter implements schemas, TTL, namespace, deletion | Host policy chooses retention and consent purposes | UI invokes declared reset scopes; it never deletes storage directly |

## Current hard-gate state

| Baseline | Behavior | Privacy | Accessibility | Brand parity | Rollback |
|---|---|---|---|---|---|
| Algolia | Partial; stale UAT | Fail | Unproven; confirmed contrast defect | Runtime baseline exists, no executable visual suite | Partial safeguards, missing source provenance |
| Sajid upstream | Fail; two reproducible browser regressions | Fail | Unproven with modal gaps | Spectrum currently red | Fail |
| Shared integration | Fail; browser/contracts and abort regression | Fail | Unproven | Algolia/Spectrum truth diverges | Fail |
| Proposed synthesis | Design obligation only | Design obligation only | Design obligation only | Design obligation only | Design obligation only |

Only Gate I can turn the synthesis obligations into implementation passes.
