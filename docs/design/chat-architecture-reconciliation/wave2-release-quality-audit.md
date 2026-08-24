# Wave 2: Build, Release, Jahia, Test, Accessibility, and Performance Audit

## Verdict

No baseline is release-ready. Use Sajid upstream as the source/build/package starting point, port Algolia's Jahia mutation safeguards, and replace both release mechanisms with a content-addressed release contract.

- Sajid is the only clean readable baseline with passing format, lint, typecheck, unit, and build gates.
- Algolia has the strongest snapshot, dry-run, allowlist, hash, edit/live readback, and rollback-input discipline.
- Shared integration has useful features and a single-file Jahia proof of concept, but its quality gates and WIP packaging contradict one another.

## Source-to-runtime provenance

Algolia's deployment configuration is environment configuration, not an artifact manifest. Its Jahia tool records and verifies mutations well, but the checked-in runtime is already compiled and rollback is restoration data rather than an executed first-class command. The sanitized observation proves identical edit/live block and asset hashes at capture time; it does not connect them to a source commit/build.

Sajid and integration can build bundles but do not emit a source commit, artifact hashes, compatibility/storage versions, consumer pin, deployed readback, or executable rollback manifest.

Disposition: release/rollback hard gate fails for all current baselines.

## Sajid build and package evidence

Two disposable builds produced identical hashes for all 27 outputs on one machine. Format/lint/typecheck, 280 unit tests, and all builds passed. The main widget measured 497,747 bytes / 147.70 KB gzip; optional bundles measured approximately 1.8–6.8 KB.

Gaps:

- no source maps or `.map` files;
- private `0.1.0` packages and no meaningful compatibility versioning;
- no root workspace and separate lockfiles;
- React/InstantSearch externalized but declared as dev rather than peer dependencies;
- wrapper aliases sibling source and bypasses the package boundary;
- optional builds retain stale output with `emptyOutDir:false`;
- website copies every JavaScript file without clearing, allowlisting, or hashing;
- plain script tags are not proved by the website build.

## Shared Jahia proof-of-concept

The single-entry import order is useful. It is not the standard build, its form-tool inclusion contradicts the runbook, the fragment test points into duplicated nested release directories, the runbook admits an uncommitted WIP tree, and it has no manifest/maps/pin/readback/rollback.

Disposition: preserve as experiment evidence, do not promote its artifacts.

## Test and quality evidence

| Baseline | Static/unit | Browser/contract | Release implication |
|---|---|---|---|
| Algolia | 212 widget and local journey checks pass | UAT 23/25; local/deployed bytes and journey trace stale | Behavior asset is valuable; evidence must be repaired |
| Sajid | Format/lint/typecheck and 280 unit pass | Two reproducible functional regressions plus one environment-sensitive timeout in the full run | Best substrate, not green release |
| Integration | 317 unit pass; format/lint/typecheck fail | Artifact 3/5; 32 pass/48 fail/1 skip with real consent defects and server cascades | Not release evidence |

Visual tests in upstream are opt-in and platform-specific; existing-server reuse can target the wrong server. No baseline enforces coverage or mutation testing.

## Accessibility and security

No baseline includes an axe/Pa11y-equivalent release scan. Labels, dialog semantics, Escape behavior, progress semantics, and reduced-motion checks are useful, but keyboard traversal, focus containment/restoration, screen readers, contrast enforcement, forced colors, zoom/reflow, and mobile keyboard behavior remain unproven.

Runtime style injection lacks an explicit CSP strategy. Template/Spectrum paths use home-grown sanitization or `innerHTML`; no Trusted Types policy, attack corpus, SRI/signing, CSP browser matrix, or dependency-policy gate exists. Auxiliary globals lack a whole-bundle double-load guarantee, so listeners/timers/storage writes may duplicate.

## Performance

| Baseline | Main raw bytes | Gzip |
|---|---:|---:|
| Sajid | 497,747 | 147.70 KB |
| Shared integration | 524,392 | 157.45 KB |
| Captured Algolia Jahia chat | 526,878 | not established in this audit |

Integration is approximately 5.4% larger raw and 6.6% larger gzip than Sajid before extra Jahia aggregation. No baseline measures parse/evaluation, memory, long tasks, open latency, streaming responsiveness, or concurrent-instance cost. The target 10% threshold cannot yet be evaluated.

## Anchored current-baseline score

| Criterion | Algolia | Sajid | Integration |
|---|---:|---:|---:|
| Boundary integrity (25%) | 1 | 3 | 2 |
| Testability/diagnosability (20%) | 2 | 3 | 2 |
| Release isolation (15%) | 3 | 1 | 1 |
| Maintainability/DX (15%) | 1 | 3 | 1 |
| Performance/bundle impact (10%) | 2 | 2 | 1 |
| Migration risk/cost (10%) | 2 | 3 | 2 |
| Multi-brand/host extensibility (5%) | 1 | 4 | 3 |
| **Weighted score / 5** | **1.70** | **2.65** | **1.65** |

Confidence is high for source/build/test/release evidence and medium for performance/manual accessibility because measurement is absent. Hard-gate failure overrides totals.

## `ReleaseManifest.v1`

Each release is an immutable versioned directory/object declaring:

- release ID, compatibility version, canonical source repository/commit, clean-tree assertion, and build image digest;
- lockfile hashes, exact build command, artifact allowlist, hashes, sizes, MIME types, roles, source maps, and source manifest;
- required/optional bundle dependency graph, load order, and double-load policy;
- runtime, design, theme, adapter, public API/event/attribute, storage, and consent contract versions;
- CSP/Trusted Types requirements;
- prior compatible release and executable rollback command;
- `algolia-com` consumer pin;
- expected Jahia edit/live paths and hashes;
- post-deploy readback/browser checks and sanitized evidence IDs.

Consumers build into a new cleared versioned directory, copy only manifest-listed files, verify hashes, and fail on missing or extra output.

## Migration order

1. Freeze Sajid source as build base and port reviewed source, never WIP bundles.
2. Enforce workspace/package dependency and peer/public contracts.
3. Add characterization before public API change.
4. Establish deterministic clean-container builds and source maps.
5. Generate the content-addressed manifest/versioned artifact directory.
6. Add allowlist, double-load, optional dependency/load-order, and CSP tests.
7. Add automated accessibility plus manual keyboard/focus/screen-reader gates.
8. Pin Algolia/Spectrum visuals to a Linux browser image.
9. Establish bundle/startup/interaction/multi-instance budgets.
10. Port Algolia snapshot/dry-run/allowlist/edit-live readback.
11. Test actual rollback against a disposable Jahia fixture.
12. Pin `algolia-com`, prove parity, then retire editable compiled assets and WIP release trees.

No Jahia release is eligible until stale UAT evidence, browser regressions, accessibility, provenance, and rollback gaps are resolved.

## Evidence anchors

- Algolia deployment config and operations: `config/deployments/algolia-chat-stack.json:1`; `tools/deployment/deploy_jahia_engagement_tracker.py:197`, `:750`, `:789`, `:913`, `:1210`.
- Algolia stale UAT: `testing/team-uat/team-uat.test.mjs:151`, `:296`.
- Sajid package/build boundary: `chat-central/package.json`, `chat-central/vite.config.ts:25`, `algolia-chat/vite.config.ts:13`, `website/scripts/sync-widget.mjs:30`.
- Upstream visual/server settings: `playwright.config.ts:43`, `:60`.
- Integration Jahia contradiction: `algolia-chat/src/jahia-embed.ts:1`, `algolia-chat/vite.jahia.config.ts:19`.
- Template/CSP surfaces: `algolia-chat/src/chat-embed.tsx:340`, `chat-central/src/slots/binding/bindingHelpers.ts:42`, `website/public/spectrum/slots.js:40`.
