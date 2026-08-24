# Wave 1: Shared Integration Audit

Baseline: `shared-integration` at `f5a399589ab2dfc21210fbfa525a25cedb464cd4`
Snapshot manifest: `74fb8fe1b8372ae8dc45fa8b1ea09c8f06485d6e134609b1ecb810bb39d2b619`
Scope coverage: 208/208 `architecture_included` files

## Provenance

| Current-state layer | Files |
|---|---:|
| Unchanged from `c9d252e` | 124 |
| Changed only by 19 Arijit commits | 13 |
| Changed by Arijit commits, then dirtied again | 20 |
| Base files changed only in dirty overlay | 21 |
| Untracked additions/experiments | 30 |
| **Total** | **208** |

All 19 integration commits are authored by `arijitchowdhury80`. Dirty or committed integration behavior must never be attributed to Sajid.

## Independent verdict

Selectively port the integration's pure runtime primitives, bounded visitor contracts, concierge behavior, judge/source/Markdown improvements, and useful characterization tests. Do not merge or rebase it mechanically. Replace its global runtime, fail-open consent, business policy inside the turn runner, presentation regression, duplicate engagement implementations, and ad hoc release flows.

## Executed characterization

| Check | Result |
|---|---|
| Central unit tests | Pass; 26 files, 317 tests |
| Formatting | Fail; 18 files |
| Lint | Fail; 17 errors, 9 warnings |
| Typecheck | Fail; `TurnRequest.turnContext` contract mismatch |
| Central/widget/website builds | Pass |
| Fresh widget size | 524.39 kB / 157.45 kB gzip |
| Artifact contract tests | Fail; 3/5 |
| Playwright | Fail; 32 passed, 48 failed, 1 skipped |
| Production dependency audits | Pass; zero production vulnerabilities |

The 48 browser failures are not 48 independent product defects: later failures followed dev-server loss. Directly reproduced failures still include public compatibility gaps, deep-dive/person-intelligence startup, and all three consent contracts. A green unit suite therefore does not establish browser or release correctness.

## Preserve and port

- Agent Studio SSE parsing, retry, multi-step tool loop, accepted-specialist termination, and human-consent suspension.
- Answer cleanup, Markdown compatibility, multiple follow-ups, source grouping, and deterministic judge improvements from Arijit's commits.
- Typed theme/compiler concepts and semantic slot data contracts, using latest upstream presentation contracts where integration is older.
- Versioned visitor/person schemas, fingerprints, deterministic fallback, bounded per-turn projection, and freshness.
- Conversation restoration with interrupted-turn normalization.
- Source-field mapping/normalization and the single-file Jahia entrypoint concept.
- Useful untracked browser/contract characterization after repairing mismatched interfaces.

## Redesign requirements

### Runtime instance ownership

Credentials, active config, proactive state, visitor source, transport override, tool registry, and pending UI gate are module-global. Engage/controller code targets the first widget. The two-consumer test resets a singleton sequentially and does not prove concurrency.

Disposition: per-instance runtime context and explicit lifecycle; retain only deliberate namespaced page-global registries.

### Privacy and consent

Tracking defaults to allowed, missing consent is treated as fully allowed, personalization bypasses tracker consent, legacy context injects arbitrary host data into prompts, and queued consent denial leaves intelligence records intact. The newer bounded native turn-context projection is materially safer.

Disposition: port versioned bounded contracts; install one fail-closed host consent authority before initialization; retire raw legacy prompt injection; block personalization until consent is affirmative.

### Business policy versus runtime

The neutral turn runner contains Algolia commercial discovery copy, journey/path rules, and fixed specialist choices. The discovery ledger encodes commercial qualification fields.

Disposition: move discovery, routing, fallback questions, eligibility, greeting transport, journey classification, and lead-form policy to an Algolia concierge package. Core retains state-machine and tool mechanisms.

### Presentation boundary

The token/registry/slot concepts are useful, but runtime theme input is unvalidated, raw CSS is unrestricted, specialist roles are hard-coded into neutral theme fields, and CSS escapes neutrality scanning. Components still combine state, persistence, policy, copy, and implementation classes.

Disposition: use latest typed semantic contracts, runtime schemas, CSS/template trust policy, public parts/states, and brand-owned presentation recipes.

### Release provenance

Two widget-copy paths use different source selection, Jahia output can retain stale files, nested release material is incomplete, and no content-addressed source/artifact/source-map/rollback manifest exists.

Disposition: preserve incomplete experiments in explicit local history, then replace copy flows and WIP releases with one manifest-driven build and consumer verification.

### Duplicate engagement mechanisms

Central exports a generic controller that production does not instantiate, while the engage bundle reimplements collection, widget lookup, SSE, policy, and storage.

Disposition: one injected lifecycle/state-machine mechanism in core; Algolia thresholds, Agent Studio client, storage, and page rules in business/host packages.

## Port, move, retire

| Action | Contents |
|---|---|
| Port | Pure transport/tool mechanics, neutral turn state machine, semantic design contracts, bounded visitor projection, source/judge/Markdown improvements, characterization tests |
| Move | Discovery/routing/proactive/greeting/journey/form policy to Algolia capability package; Jahia lifecycle and storage mapping to host adapter |
| Retire/replace | Globals, first-widget lookup, arbitrary context prompt injection, duplicate controllers/SSE parsers, privileged browser personalization, unvalidated remote themes/raw CSS, ad hoc sync/release trees, bundle-text-only tests |

Keep `acs_*` storage compatibility only inside the Spectrum/legacy adapter until a separately approved migration.

## Hard-gate result

| Gate | Current result | Reason |
|---|---|---|
| Behavioral correctness | Fail | Public/browser contract failures and unstable harness |
| Privacy and consent | Fail | Three consent contracts fail; fail-open defaults and bypasses exist |
| Accessibility | Unknown | No complete WCAG evidence |
| Visual parity | Unknown/fail for affected contracts | Presentation and artifact truth diverge |
| Rollback safety | Fail | No enforced source-to-artifact identity or complete rollback manifest |

## Evidence anchors

- Runtime globals: `chat-central/src/config/runtime.ts:46`, `config/active.ts:27`, `config/proactive.ts:77`, `config/orchestratorTransport.ts:1`.
- First-widget selection: `chat-central/src/engagement/engagementController.ts:124`, `algolia-chat/src/engage-embed.ts:240`.
- Consent/privacy: `algolia-chat/src/tracker-embed.ts:135`, `chat-central/src/person/personAgent.ts:237`, `algolia-chat/src/personalization-embed.ts:113`.
- Legacy and bounded context: `chat-central/src/config/visitorContext.ts:31`, `chat-central/src/person/turnContext.ts:9`.
- Embedded business policy: `chat-central/src/chat/turnRunner.ts:422`, `:453`, `:695`; `discoveryLedger.ts:16`.
- Theme/slot strengths and gaps: `chat-central/src/theme/types.ts:1`, `theme/registry.ts:67`, `theme/compile.ts:35`, `slots/regions.ts:29`.
- Neutrality CSS blind spot: `chat-central/src/__tests__/neutrality.guard.test.ts:43`.
- Duplicate engagement: `chat-central/src/engagement/engagementController.ts:149`, `algolia-chat/src/engage-embed.ts:207`.
- Release-copy drift: `website/scripts/sync-widget.mjs:19`, `scripts/sync-widget.mjs:16`, `algolia-chat/vite.jahia.config.ts:19`.
