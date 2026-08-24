# Parallel Feature Development and Integration Standard

Status: mandatory workflow for future feature work

## The rule

Work intended for this project must begin from the current source of truth and return as a reviewable change to that source. A working standalone implementation is a prototype or donor implementation; it is not yet a project feature.

The source of truth is the current protected `origin/main` plus its pinned dependency and deployment manifests. A live environment is validation evidence, not an unversioned place to continue development.

## Correcting the PR #4 lesson

PR #4 did descend from this repository. Its base was `76f3a0b`; it was not built without any Git source. The integration problem arose because:

- the branch remained on an older base while main advanced by six commits;
- the live Jahia runtime advanced independently of the branch's deployment assumptions;
- the feature was attached to a deployment path that owned much more than the feature;
- those conditions were detected late, after the feature had already been developed.

The future rule must therefore be stronger than "clone the repository."

## Before writing code

The developer must:

1. Obtain access to the canonical repository.
2. Clone it or refresh an existing clone.
3. Fetch the remote and branch from current `origin/main`.
4. Record the starting main SHA in the work item or PR.
5. Read `README.md`, `AGENTS.md`, the relevant design contracts, and the deployment manifest.
6. Run the relevant tests on the untouched branch and record the baseline.
7. Identify the exact files and runtime surfaces the feature is allowed to own.
8. If the work touches a deployed surface, run a read-only source-versus-live manifest check before implementation.

Recommended commands:

```bash
git clone https://github.com/arijitchowdhury80/content-engagement.git
cd content-engagement
git fetch origin
git switch --create feature/<name> origin/main
git rev-parse origin/main
git status --short
```

The relevant Git operations are `clone`, `fetch`, and `rebase` or merge. There is no `git get` command.

## Source-of-truth preflight

For a feature that will touch Jahia, Agent Studio, an index, or another live service, the work item must contain:

- repository and base commit SHA;
- relevant source files and owning repository;
- live environment and authorized operator;
- read-only live manifest or snapshot timestamp;
- expected source/live versions and hashes;
- known drift and its owner;
- mutation allowlist;
- rollback boundary;
- acceptance tests.

If source and live differ before development starts, stop feature work at the deployment boundary. Either reconcile live back into versioned source or create an explicit compatibility adapter. Do not guess which version should win.

## While developing

The developer must keep the branch current:

```bash
git fetch origin
git rebase origin/main
```

Do this before substantial new work, before requesting review, and whenever main changes in an overlapping area. If team policy prefers merge commits, merge `origin/main` instead; do not mix rebase and merge casually on the same shared branch.

For long-running work:

- rebase or merge main at least daily when the receiving area is active;
- keep commits small enough to review and port independently;
- add tests with each behavior change;
- do not copy entire current files into the branch from another checkout;
- do not edit generated bundles when versioned source exists;
- do not deploy private branch code as a new live baseline;
- do not solve integration by overwriting the receiving implementation.

## Feature ownership must be narrow

Every feature must declare what it owns and what it does not own.

For example, an additive Compare feature may own:

- its companion module;
- its configuration block;
- its local proxy route;
- its tests;
- its one deployment adapter.

It does not thereby own the chat bundle, tracker, controller, theme, entire files subtree, or entire Jahia page. Its deployment path must mutate only its declared assets and references.

The smaller mutation boundary is the safe merge boundary.

## Pull request requirements

A PR is ready for review only when it states:

- base main SHA and final head SHA;
- whether it is current with `origin/main`;
- feature-owned files and explicitly excluded files;
- user-visible behavior and failure behavior;
- tests run and results;
- deployment mutation allowlist;
- secrets and evidence handling;
- rollback procedure;
- live validation owner;
- any known source/live drift.

Before marking the PR ready:

```bash
git fetch origin
git rebase origin/main
git diff --check origin/main...HEAD
npm test
```

Use the repository's complete language-specific tests in addition to `npm test` where applicable.

## Required automated gates

Branch protection and CI should require:

- branch is up to date with protected main;
- build and complete test suite pass at the reviewed SHA;
- changed deployment paths pass mutation-scope tests;
- secret scanning includes generated configuration, evidence, logs, and rollback artifacts;
- content-addressed asset/version checks pass;
- adversarial code and security reviews agree on the same head SHA;
- unresolved review threads are zero;
- no direct merge is allowed when a deployment changes unrelated assets.

Automated review should produce one qualified result:

- `NO_VALIDATED_BLOCKER`
- `VALIDATED_CHANGES_REQUIRED`
- `HUMAN_REVIEW_REQUIRED`

It must distinguish a developer code defect from an environment/access task owned by an authorized operator.

## When a developer starts elsewhere

Sometimes useful work already exists in a prototype, fork, another repository, or standalone script. Treat it as donor code:

1. Create an integration branch from current main.
2. Identify the smallest capability slice worth retaining.
3. Port behavior and tests, not whole stale files.
4. Rebuild adapters at the current repository boundaries.
5. Resolve configuration and deployment against current manifests.
6. Credit the donor implementation in the integration PR.
7. Run the same gates as native work.

Donor code is evidence of a working idea. Current main remains the receiving architecture.

## Deployment discipline

Merging source and deploying source are separate approvals.

Every mutation follows:

```text
exact source SHA
-> read-only live snapshot
-> dry-run and mutation diff
-> approval
-> smallest scoped apply
-> EDIT/LIVE readback
-> browser/API acceptance
-> durable redacted evidence
-> rollback on failure
```

Every deployed asset must identify its source commit or content hash. Direct live changes that are not reconciled into Git are temporary emergency changes and must immediately create a reconciliation task. Until reconciled, they block overlapping deployments.

## Review responsibility

The developer owns code and tests that can be executed with the access they were given. The integration owner owns adaptation to current main. Only an authorized operator owns authenticated live mutation and acceptance evidence.

Never assign a required acceptance step to someone who cannot access the system needed to perform it.
