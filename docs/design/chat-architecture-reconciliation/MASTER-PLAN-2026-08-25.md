# Master Plan: Reconcile, Standardize, Separate, Verify, and Release

Status: revised after 2026-08-25 source revalidation; architecture not approved; implementation blocked

Decision authority: user

Historical evidence package: run `2026-08-20-001`

Current revalidation package: `/Users/arijitchowdhury/.codex/archives/algolia-chat-architecture/2026-08-25-001-revalidation/`

## 1. Purpose

This program reconciles the complete readable widget source, the current Algolia implementation, the Spectrum implementation, and useful shared-integration work into a maintainable architecture without sacrificing current behavior.

It has four outcomes:

1. Establish one trustworthy source-to-artifact lineage for the reusable chat widget.
2. Separate shared execution from presentation and from consumer-owned intelligence/policy.
3. Preserve the Algolia and Spectrum experiences as complete, independently owned implementations of shared contracts.
4. Leave the repositories, release process, deployment inputs, and rollback path clean and reproducible.

This is a standardization and reconciliation program. It is not a new chat product, a new InstantSearch implementation, or permission to redesign the current experience.

## 2. Current conclusion and confidence

The 2026-08-25 revalidation supports the following hypothesis:

- Sajid upstream is the strongest complete readable source substrate.
- `algolia-com` is the strongest source of current Algolia behavior, Content Engagement intelligence, and Jahia operational safeguards.
- Shared integration contains valuable source-level additions and tests but is a donor, not a safe wholesale base.
- No current repository should be adopted unchanged.
- The safe direction is selective source convergence followed by enforceable separation.

Confidence is approximately 90–96% in this diagnosis. Confidence in the old fourteen-package topology and exact Stage 2 sequence is only 50–60%; those details are reopened and must be derived from current dependency evidence and the user walkthrough.

No plan can provide a literal 1000% guarantee. This plan achieves release confidence through behavioral equivalence, small reversible steps, immutable artifacts, explicit approval gates, and rehearsed rollback.

## 3. Current evidence baselines

### 3.1 Sajid upstream

- Repository: `/Users/arijitchowdhury/Dropbox/AI-Development/RAG/algolia-central-chat-widget-sajid-latest`
- Commit: `e06c6b5ff20c8576bec01fdf000981cd8873cc06`
- State: clean, detached, equal to current `origin/main`
- Role: immutable readable-source evidence and candidate reconciliation base
- Current evidence: format, lint, typecheck, 280 unit tests, deterministic builds, and production dependency audits pass; two Spectrum functional browser regressions remain reproducible.

### 3.2 Current committed Algolia

- Repository: `/Users/arijitchowdhury/Dropbox/AI-Development/algolia-com`
- Remote baseline: `origin/main` at `7e1deb1f8df0e391823407328c191be9bedfc03f`
- Distance from August baseline `2a1f9cc`: 56 commits
- Role: current committed Algolia behavior and operations evidence
- Current evidence: full committed automation passes, including 324 widget tests, 25/25 Team UAT, all eight proactive journeys, local full-chain parity, and 93 deployment tests plus two subtests.

### 3.3 Current local Algolia overlay

- Local `HEAD`: `4ece5bbb023383a03d64223b16833c0f6cccf896`
- Relationship: 20 commits behind current `origin/main`
- Observed state: 346 Git-status entries at capture
- Role: current local work that must be classified and reconciled without overwriting parallel work
- Current evidence: 318 local widget tests pass; focused Compare, judge, and Jahia deployment-tool tests pass.

The remote baseline and local overlay are distinct evidence inputs. Neither may silently replace the other.

### 3.4 Shared integration

- Repository: `/Users/arijitchowdhury/Dropbox/AI-Development/RAG/algolia-central-chat-widget`
- Commit: `f5a399589ab2dfc21210fbfa525a25cedb464cd4`
- Role: donor and provenance evidence
- Current delta from the August frozen snapshot: four changed source files affecting retry identity and confidence handling
- Current evidence: 317 unit tests pass; typecheck, lint, and formatting fail.

### 3.5 Historical evidence

The August 20 reports remain evidence about their frozen snapshots. Their scores, counts, current-state labels, and approval language are not current authority.

## 4. Safety envelope and non-goals

### 4.1 Demo freeze

Until the user explicitly lifts the pre-demo freeze:

- no runtime architecture refactor;
- no source-base switch;
- no public API, event, storage, load-order, CSS, or asset change;
- no dependency/package restructuring;
- no Jahia deployment;
- no Agent Studio or index mutation;
- no Spectrum deployment;
- no push or history rewrite.

Allowed during the freeze:

- read-only inspection;
- immutable snapshots;
- documentation and comparison updates;
- disposable tests and proof-of-concepts;
- local characterization fixtures that do not alter production inputs;
- classification of dirty work without deleting or staging it.

### 4.2 Explicit non-goals

- Rebuilding the product from scratch.
- Reopening InstantSearch as the product architecture absent a concrete dependency finding.
- Mechanically merging or rebasing the integration branch into Sajid upstream.
- Treating Algolia or Spectrum as only a color theme.
- Moving all `algolia-com` code into the shared repository.
- Redesigning the approved Algolia experience during source reconciliation.
- Using weighted scores to override privacy, accessibility, correctness, or rollback failures.

## 5. Three coordinated swim lanes

### Swim lane A — Source and architecture reconciliation

Determine the source lineage, logical ownership, dependency direction, public contracts, and smallest safe physical repository/package structure.

Outputs:

- current source/provenance graph;
- dependency and import graph;
- shared-versus-consumer capability ledger;
- revised target architecture options;
- decision records and rejected alternatives;
- incremental source convergence sequence.

### Swim lane B — Presentation and implementation standardization

Compare and preserve both complete implementations:

- Algolia implementation: brand presentation, Content Engagement behavior, browser mechanisms, composition, and Jahia integration;
- Spectrum implementation: theme, component composition, templates, assets, host behavior, and its existing compatibility surface.

Outputs:

- semantic presentation contract;
- Algolia and Spectrum ownership maps;
- private-selector retirement ledger;
- visual, responsive, accessibility, and interaction fixtures;
- explicit keep/move/rewrite/retire decisions.

### Swim lane C — Repository, build, release, and housekeeping

Protect current work, classify files, establish deterministic builds, define artifact provenance, and make cleanup reviewable and reversible.

Outputs:

- current-state classification manifests;
- isolated preservation commits/branches where authorized;
- generated/private/archive/disposable dispositions;
- release-manifest decision;
- rollback procedure and rehearsal evidence;
- clean final worktrees.

### Combined stage

The lanes converge into one approved compatibility ledger, target architecture, migration sequence, verification matrix, and release/rollback contract. No lane may independently select a source base, delete donor work, or alter a public behavior.

## 6. Provisional ownership model

The walkthrough starts with four coarse ownership zones. These are logical boundaries, not preapproved package names.

### Zone 1 — Shared execution

Candidate contents:

- per-instance conversation and turn state;
- provider-neutral semantic events;
- transport/tool/retry/abort mechanisms behind ports;
- source and answer data models;
- judge mechanism and neutral projection;
- persistence mechanism and migrations behind storage ports;
- web-component public facade;
- accessibility semantics required by every implementation.

It must not contain Algolia journeys, Spectrum markup, brand CSS, Jahia paths, customer copy, analytics eligibility, or first-widget globals.

### Zone 2 — Presentation contracts

Candidate contents:

- semantic parts, states, variants, and regions;
- typed theme tokens;
- presentation recipes;
- template/slot data and action contracts;
- focus, modal, reduced-motion, responsive, and trust requirements;
- conformance fixtures usable by both implementations.

It specifies what an implementation may render or customize. It does not perform transport, storage, telemetry, consent, routing, or conversation mutation.

### Zone 3 — Algolia implementation

Candidate contents:

- Algolia brand and complete visual composition;
- Content Engagement journey classification and proactive eligibility;
- discovery, specialist, handoff, and business-copy policy;
- Algolia browser signal collection and consent integration;
- Compare with Production;
- token telemetry;
- judge business configuration and presentation;
- Algolia.com/Jahia composition and host adapter;
- Algolia-specific storage namespace compatibility.

Each capability must be classified as reusable mechanism, Content Engagement policy, Algolia.com host policy, or presentation. “Algolia implementation” does not automatically mean everything stays in one file or one repository.

### Zone 4 — Spectrum implementation

Candidate contents:

- Spectrum tokens and full component composition;
- Spectrum templates, slots, assets, copy, motion, and responsive behavior;
- Spectrum host lifecycle and compatibility adapter;
- temporary `acs_*` storage/API compatibility;
- Spectrum-specific browser fixtures and release consumer.

Spectrum is not reduced to a theme. Its composition and host behavior are first-class implementation concerns.

### Cross-cutting release infrastructure

Build, conformance, provenance, and release tooling support all four zones but do not belong in the runtime dependency graph.

## 7. Capability decision ledger

Before the ADR is approved, every current capability receives one decision:

- `shared-mechanism`;
- `presentation-contract`;
- `content-engagement-policy`;
- `algolia-host-policy`;
- `algolia-presentation`;
- `spectrum-presentation`;
- `host-adapter`;
- `release-tooling`;
- `compatibility-shim`;
- `retire-with-replacement`;
- `retire-with-reason`.

Each row records current source, current consumer, behavior evidence, privacy/accessibility impact, proposed owner, alternative, migration step, compatibility obligation, test, rollback effect, confidence, and user disposition.

Minimum capability inventory:

- public elements, methods, attributes, properties, events, globals, and preload registries;
- streaming, sources, Markdown, retries, abort/stop, tools, and errors;
- conversation identity, persistence, restoration, reset, and storage schemas;
- judge-core, confidence panel, grounding admission, provisional scoring, and race handling;
- specialist routing, consent, additive output, limitations, and follow-up cardinality;
- discovery ledger and question projection;
- eight proactive journeys and the current 3-second/30% contract;
- visitor signals, page/journey classification, bounded context, consent, and retention;
- Greetings Agent and orchestrator handoff;
- Compare with Production;
- token telemetry;
- TLDR/direct-read, progress states, source tiles, resizing, docked/maximized/mobile modes;
- Algolia and Spectrum composition, templates, assets, and responsive behavior;
- script order, optional bundles, double-load behavior, CSP, and Trusted Types;
- Jahia snapshot, dry-run, CAS, readback, rollback, and asset identity.

## 8. Revised gate sequence

### Gate 0 — Revalidation accepted

Entry: August evidence exists.

Exit:

- current snapshots are stable and hash-verified;
- current remote/local divergence is recorded;
- claim-by-claim corrections are available;
- no stale score or count is treated as current.

Status: complete on 2026-08-25.

### Gate 1 — Algolia convergence baseline

Purpose: establish what “our current implementation” means before comparing or changing it.

Required work:

1. Classify the 20 remote commits absent from local `HEAD`.
2. Classify the local tracked/untracked overlay against current `origin/main`.
3. Resolve overlaps without overwriting parallel work.
4. Produce separate committed-remote, local-overlay, and intended-current manifests.
5. Re-run focused tests on the intended-current disposable reconstruction.

Exit criteria:

- every architecture-relevant remote/local delta has a disposition;
- no local work is silently discarded;
- intended-current behavior is reproducible from a frozen input;
- the user can see which code is current, pending, experimental, or obsolete.

### Gate 2 — Refreshed comparison and donor ledger

Purpose: update the comparison, not repeat unchanged research.

Required work:

- retain confirmed Sajid findings and correct its three factual errors;
- update Algolia findings for Compare, telemetry, judge-core, explicit transport, resize, grounding, current journeys, and Jahia tooling;
- amend the integration donor ledger for its four-file delta;
- regenerate public API, storage, script-order, dependency, presentation, and test inventories;
- rerun numerical scoring across all baselines using the same denominator;
- label every score as adjudication and every empirical result as evidence.

Exit criteria:

- 100% of current architecture scope is dispositioned;
- every changed claim links to current source or executed evidence;
- all historical-only claims are labeled;
- disputed and low-confidence rows are visible.

### Gate 3 — User architecture walkthrough

Purpose: authentically decide what to keep, move, merge, rewrite, shim, and retire.

Walkthrough order:

1. Repository and source lineage.
2. Current folder structures and build outputs.
3. Shared runtime lifecycle and transport.
4. Public web-component/API compatibility.
5. Algolia complete implementation.
6. Spectrum complete implementation.
7. Content Engagement and Algolia.com ownership.
8. Presentation contracts and private-selector migration.
9. Privacy, consent, storage, and reset.
10. Tests, release composition, and rollback.

For every section, present:

- current Sajid behavior;
- current Algolia behavior;
- integration contribution;
- conflict or drift;
- realistic options;
- recommendation with evidence and confidence;
- behavioral and migration consequences;
- explicit user decision or open question.

Exit criteria:

- all material choices have a recorded disposition;
- unresolved items are explicitly deferred with safe defaults;
- visual behavior is not called “approved” until reviewed;
- Content Engagement ownership is explicit.

### Gate 4 — Revised architecture options and proof-of-concepts

Purpose: derive physical boundaries from dependency seams.

Required work:

- produce at least two viable repository/package arrangements;
- compare a minimal four-zone monorepo with any justified finer-grained split;
- compare one composite release manifest with two-level central/project manifests;
- run disposable proof-of-concepts for tied or high-risk decisions;
- demonstrate that shared execution can run with both Algolia and Spectrum presentation fixtures;
- demonstrate the intended transport and per-instance seams without changing deployed assets.

Exit criteria:

- physical packages are justified by dependency enforcement, release cadence, and ownership;
- no package exists merely to mirror an abstract diagram;
- the smallest reversible compatible option is identified.

### Gate 5 — Adversarial review

Inputs:

- refreshed comparison;
- user decision ledger;
- architecture options;
- proposed ADR;
- compatibility, test, migration, release, and rollback plans.

Review requirements:

- independent Codex adversarial review;
- factual-source verification;
- missing-capability and non-loss challenge;
- privacy/security and accessibility challenge;
- build/release/rollback challenge;
- migration-order and demo-risk challenge.

Exit criteria:

- no unresolved P0/P1 finding;
- every accepted concern changes the plan or records a reasoned rejection;
- review does not approve implementation on the user’s behalf.

### Gate 6 — Architecture approval

The user approves:

- canonical source base and repository topology;
- logical and physical ownership;
- compatibility ledger;
- Algolia/Spectrum/Content Engagement dispositions;
- implementation sequence;
- test budgets and exceptions;
- release and rollback design.

Approval does not authorize deployment, push, Agent Studio/index mutation, or Spectrum release.

### Gate 7 — Pre-implementation readiness

Required before changing production-source behavior:

- demo freeze explicitly lifted;
- clean isolated worktrees from approved current baselines;
- preservation commits or archives for all donor/local work;
- characterization harness green or known failures frozen;
- old artifact and rollback inputs available;
- feature flags/compatibility facade designed;
- stop conditions and ownership assigned.

### Gate 8 — Surgical implementation waves

Implementation is incremental. Each wave has its own entry tests, change budget, differential evidence, rollback point, and review.

#### Wave 8.1 — Reproducible source build

- Establish a clean source build producing the current compatible artifact.
- Preserve public API, DOM behavior, storage, script order, and visual fixtures.
- Do not redesign runtime or presentation in this wave.
- Prove source-to-artifact identity and keep the previous artifact deployable.

#### Wave 8.2 — Boundary enforcement without behavior change

- Add dependency rules, export maps, runtime schemas, and source/CSS/template scans.
- Establish the four ownership zones in the smallest practical directory structure.
- Keep compatibility shims explicit and tested.

#### Wave 8.3 — Per-instance execution and transport

- Move credentials, timers, active state, transport, tools, judge, and context behind instance-owned ports.
- Preserve the current explicit Algolia transport seam.
- Remove the default global fetch interceptor only after differential tests pass.
- Restore and verify complete abort/stop behavior.

#### Wave 8.4 — Privacy, storage, and lifecycle

- Introduce purpose-specific consent.
- Preserve essential transcript behavior separately from analytics/personalization/proactive purposes.
- Add bounded versioned storage, migrations, reset receipts, erasure, generation guards, and teardown.
- Maintain backward-readable storage until approved migration completion.

#### Wave 8.5 — Presentation contracts

- Introduce validated tokens, recipes, semantic parts/states, and slot/template trust controls.
- Add focus containment/restoration, reduced motion, zoom/reflow, contrast, and screen-reader contracts.
- Temporarily map old classes/selectors to semantic surfaces.
- Do not remove private selectors until both implementations pass parity.

#### Wave 8.6 — Algolia implementation migration

- Move Algolia brand/composition and Content Engagement capabilities to their approved owners.
- Preserve Compare, telemetry, judge behavior, TLDR, source presentation, resize, progress, all journeys, specialist/handoff, and Jahia composition.
- Replace direct compiled-bundle editing only after the source-built artifact is proven equivalent.

#### Wave 8.7 — Spectrum implementation migration

- Preserve Spectrum component topology, templates, assets, copy, motion, and host behavior.
- Fix the two known functional regressions behind characterization tests.
- Add unique instance IDs and teardown.
- Retain `acs_*` shims only where the approved ledger requires them.

#### Wave 8.8 — Legacy retirement

- Remove global/first-widget fallback, private selectors, duplicated transport/engagement mechanisms, stale build-copy paths, and bundle-text-only tests only after their replacements pass.
- Every removal must have a replacement test and rollback point.

### Gate 9 — Implementation verification

No weighted score can compensate for a failed hard gate.

Required evidence:

- format, lint, typecheck, unit, integration, build, and browser suites;
- old/new deterministic semantic differential on canned streams;
- public API/event/attribute/global/load-order compatibility;
- two concurrent widgets with different credentials, themes, storage, transports, timers, and teardown;
- consent unknown/denied/granted/withdrawn and purpose separation;
- PII exclusion, bounded context, TTL, storage migration, quota/corruption, and reset scopes;
- streaming, abort, retry, late error, tools, sources, judge, specialist, discovery, proactive, handoff, persistence, Compare, and telemetry;
- Algolia and Spectrum visual fixtures across desktop/mobile/docked/maximized/resized states;
- WCAG 2.2 AA automation plus manual keyboard, focus, screen-reader, zoom/reflow, forced-colors, and reduced-motion checks;
- CSP/Trusted Types, malformed theme/template, unsafe URL, optional bundle, double-load, and script-order tests;
- two clean builds with identical allowlisted hashes and source maps;
- measured bundle, startup, interaction, and multi-instance performance budgets;
- executable rollback to the prior artifact.

### Gate 10 — Local consumer migration

`algolia-com` may switch locally only when:

- it pins the approved source-built artifact or manifest;
- project-owned Algolia/Content Engagement/Jahia inputs remain readable source;
- old and new run side-by-side against the same fixtures;
- storage is backward-readable;
- no direct shared-bundle edit remains necessary;
- local browser and deployment dry runs pass;
- the previous pinned artifact remains a one-command local rollback.

Spectrum production remains untouched unless separately approved.

### Gate 11 — Release approval

The user separately approves:

- exact source and artifact commits/hashes;
- dry-run mutation plan;
- current Jahia snapshot;
- rollback artifact and command;
- headed-browser test plan;
- deployment window and stop conditions.

### Gate 12 — Jahia deployment and readback

If approved:

1. Snapshot current edit/live block and referenced assets.
2. Verify rollback inputs and restoration command before apply.
3. Build into a new immutable versioned directory.
4. Inspect the allowlisted dry-run.
5. Publish only approved Algolia assets/references.
6. Read back edit and live states.
7. Verify exact hashes, load order, configuration, and storage compatibility.
8. Run headed browser characterization and smoke tests.
9. Save sanitized evidence.
10. Roll back immediately on a correctness, privacy, accessibility, visual, artifact, or readback hard-gate failure.

Production Ask Algolia remains read-only. Agent Studio/index mutation and Spectrum deployment require separate processes and approvals.

### Gate 13 — Housekeeping and final handoff

Classify every remaining changed or untracked item as:

- durable source;
- compact evidence;
- generated;
- private;
- archive;
- duplicate;
- disposable.

Before staging:

1. Re-run `git status --porcelain=v2`.
2. Compare current hashes with the classification manifest.
3. Abort on unexpected changes.
4. Stage explicit paths only.
5. Secret/PII-scan before and after staging.
6. Inspect staged diffs and hook rewrites.
7. Commit in reviewable groups without mixing unrelated work.

No deletion of uncertain material, no history rewrite, and no push without authorization.

## 9. Test strategy

### Layer A — Characterization

Answers: “What do the current implementations actually do?”

- black-box browser fixtures;
- current public surface inventory;
- storage/load-order/failure fixtures;
- Algolia and Spectrum visual baselines;
- known failures recorded rather than hidden.

### Layer B — Differential equivalence

Answers: “Did the surgical change preserve behavior?”

- identical canned SSE/tool streams into old and new;
- normalized semantic-event, turn, source, judge, specialist, and persistence comparison;
- DOM/accessibility-tree snapshots at stable states;
- storage and event-log diffs;
- exact allowed-difference ledger.

### Layer C — Boundary and contract enforcement

Answers: “Can drift re-enter?”

- import/export dependency tests;
- TS/JS/CSS/template/generated-manifest neutrality scans;
- runtime schema validation;
- two-instance isolation;
- provider/brand/host leakage checks;
- compatibility-shim inventory tests.

### Layer D — User-facing quality

Answers: “Does it still look, behave, and feel correct?”

- Algolia/Spectrum visual regression;
- responsive geometry and resize;
- keyboard/focus/screen-reader/reduced-motion;
- progressive streaming and failure states;
- all proactive and specialist journeys;
- Compare, telemetry, judge, TLDR, sources, and follow-ups.

### Layer E — Release and recovery

Answers: “Can we ship and recover safely?”

- deterministic clean builds;
- content hashes/source maps/load order;
- dry-run/CAS/readback;
- shadow or canary rehearsal where the host permits;
- timed rollback drill with objective recovery time and hash verification.

## 10. Rollback model

Every implementation wave has two rollback levels:

### Source rollback

- wave-specific local branch and commit boundary;
- no destructive history rewrite;
- compatibility shims remain until Gate 9 passes;
- donor snapshots remain immutable.

### Runtime rollback

- prior immutable artifact and manifest remain available;
- deployment switches references rather than overwriting the prior artifact;
- pre-apply snapshot and CAS protect against concurrent changes;
- rollback restores prior references/assets and verifies edit/live hashes;
- failure evidence is retained without retrying an unsafe release.

## 11. Housekeeping commit model

When cleanup is authorized after classification, use separate local commits for:

1. comparison/architecture documentation;
2. characterization and compatibility tests;
3. shared-source build and runtime boundaries;
4. presentation contracts and implementations;
5. Content Engagement/Algolia capability migration;
6. host and release tooling;
7. consumer pin/migration;
8. legacy retirement;
9. generated/private/archive cleanup.

Do not combine cleanup with behavioral changes merely to obtain a clean status.

## 12. Required deliverables

Before implementation approval:

- current baseline and intended-current manifests;
- refreshed scope and capability matrices;
- amended donor ledger;
- current test/hard-gate report;
- user decision ledger;
- dependency graph and architecture options;
- revised ADR;
- refreshed compatibility contract;
- full test and allowed-difference plan;
- migration and rollback plan;
- adversarial-review disposition.

Before release approval:

- source/artifact manifest and hashes;
- clean-build reproducibility evidence;
- complete compatibility and parity results;
- accessibility and performance evidence;
- rollback rehearsal result;
- exact Jahia dry-run and snapshot;
- known limitations and stop conditions.

## 13. Program completion criteria

The program is complete only when:

- the current comparison denominator is 100% dispositioned;
- source lineage is readable and reproducible;
- shared execution, presentation contracts, Algolia implementation, and Spectrum implementation have enforceable dependencies;
- Content Engagement ownership is explicit;
- Algolia and Spectrum parity obligations pass or have approved intentional differences;
- privacy, accessibility, multi-instance, and rollback hard gates pass;
- `algolia-com` consumes pinned reproducible artifacts without editing the shared bundle;
- direct global interception, first-widget selection, and private renderer selectors are retired or explicitly approved shims;
- both mutable repositories are clean on reviewable local branches;
- Sajid's pristine baseline and restricted archives remain unchanged and restorable;
- no unapproved push, deployment, Agent Studio/index mutation, Spectrum release, or history rewrite occurred.

## 14. Immediate next action

Do not implement separation yet.

The next action is Gate 1: reconcile current `origin/main` with the local Algolia overlay and produce the intended-current baseline. Then refresh the comparison ledger at Gate 2 and walk through it with the user at Gate 3.
