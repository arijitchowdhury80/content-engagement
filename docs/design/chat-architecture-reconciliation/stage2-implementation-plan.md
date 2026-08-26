# Historical Stage 2 Implementation Specification

Status: superseded on 2026-08-25; do not execute

The current plan is [`MASTER-PLAN-2026-08-25.md`](MASTER-PLAN-2026-08-25.md). This file is retained to preserve the August 20 decision history. Its baseline, 84-row denominator, stale UAT finding, exact package split, and migration order require the revised Gate 1–6 work before implementation.

## Worktrees

Create an isolated central branch from pristine Sajid upstream `e06c6b5ff20c8576bec01fdf000981cd8873cc06` and an isolated `algolia-com` branch from the approved Gate F commit. Keep the pristine checkout and live shared worktrees untouched. Exchange only content-addressed artifacts and manifests.

## Ordered work packages

1. Freeze executable compatibility tests, known failures, visual/semantic fixtures, storage/load-order behavior, and the 84-item donor ledger.
2. Add versioned contracts/runtime schemas, export maps, dependency rules, CSS/template/source boundary scans, and failing hard-gate tests.
3. Repair the two upstream browser regressions, integration abort loss, and stale Algolia UAT identity with characterization proof.
4. Extract per-instance runtime state, provider-neutral semantic events, full abort/stop behavior, and explicit transport/judge/context/storage ports.
5. Implement fail-closed consent, reset scopes, bounded persistence, browser mechanisms, visitor-context validation, and generation-safe teardown.
6. Implement semantic presentation surfaces, validated themes/recipes/templates, accessible neutral rendering, and trusted-host restrictions.
7. Port portable Algolia and Spectrum themes; keep www/Jahia layout in project presentation and host lifecycle in adapters.
8. Port each integration donor item by `port`, `rewrite`, `replace-by-contract`, `retain-as-characterization`, or `retire-with-reason` disposition.
9. Port Algolia journey/discovery/proactive/specialist/handoff policy as pure project code, then compose browser and Jahia adapters.
10. Build central and project manifests, run old/new canned streams and browser fixtures, and migrate `algolia-com` incrementally.
11. Gate I1 verifies compatibility with only enumerated shims. Retire forbidden globals/interception/private selectors/direct bundle edits, then rerun Gate I2.

## Required verification

- Format, lint, typecheck, unit, build, browser, boundary, and deterministic-artifact tests.
- Concurrent widgets with independent credentials, themes, timers, state, transport, storage, and teardown.
- Consent unknown/denied/withdrawn, erasure, bounded context, PII exclusion, late-callback prevention, and all reset scopes.
- Streaming, abort, retries, tools, sources, judge, specialist, discovery, proactive, handoff, persistence, and failure behavior.
- WCAG 2.2 AA: contrast, keyboard, focus, screen-reader semantics, zoom/reflow, and reduced motion.
- Approved Algolia and Spectrum visual comparison, malformed theme/template/CSP tests, script ordering, optional/double-load behavior.
- Reproducible hashes, source maps, performance budgets, composite manifest identity, and executable rollback.

## Commit order

Characterization/contracts; runtime; consent/storage/context; presentation contracts; themes; project policy/browser; adapters; release tooling; pinned consumer migration; legacy retirement/documentation. No push or deployment without separate approval.

Any architectural deviation requires an ADR amendment. Failing a hard gate cannot be compensated by a weighted score.
