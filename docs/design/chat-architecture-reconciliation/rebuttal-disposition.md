# Historical Rebuttal Disposition

> This file records the 2026-08-20 review only. Its Gate E/G readiness statements are superseded. See [`MASTER-PLAN-2026-08-25.md`](MASTER-PLAN-2026-08-25.md).

The independent Algolia, integration, and skeptical runtime/privacy rebuttals did not overturn synthesis D. They identified material Gate E omissions, now incorporated into ADR-001.

## Accepted

- Freeze compatibility and known failures before any repair.
- Use isolated Stage 2 worktrees for both central source and `algolia-com`.
- Split portable Algolia theme from www/Jahia site presentation.
- Split Spectrum theme from Spectrum lifecycle/legacy adapter.
- Add explicit Algolia and Spectrum composition roots.
- Keep provider credentials and wire/SSE parsing in `transport-agent-studio`; runtime reduces semantic events.
- Add explicit neutral judge, visitor-context, persistence, conformance, Clipboard/browser capability, progress, diagnostics, and generic legacy-storage ownership.
- Distinguish multi-instance preload registries from one-widget legacy control facades.
- Specify compatibility behavioral invariants for judge, specialist, discovery, proactive, stable IDs, progress, copy, and reset.
- Define consent boot/withdraw ordering, generation guards, full abort propagation, storage namespace/bounds/quota/cross-tab behavior, final metadata validation, and reset scopes.
- Prefer router/Navigation API subscriptions; forbid normal history and all fetch replacement.
- Add central `ReleaseManifest.v1` and project `AlgoliaDeploymentManifest.v1` for composite provenance.
- Add Gate I1 before forbidden-mechanism retirement and Gate I2 after retirement.
- Create a hash-pinned integration donor manifest and clean preservation branch before cleanup.
- Enforce the non-loss rule for all 84 non-base donor items.

## Accepted with qualification

- Central `theme-algolia` remains valid only for portable brand tokens/assets/semantic defaults; Jahia layout/typography/z-index stays project-local.
- `acs_*` compatibility is generic legacy storage, consumed by Spectrum or other legacy hosts, and never becomes a neutral runtime default.
- The single-file Jahia topology remains a build option/characterization, not the current WIP artifact.
- Logical package boundaries are mandatory; external publication of every package is not.

## Rejected

The Algolia rebuttal requested changing Algolia's accessibility posture from `Fail/unproven` to only `Unproven`. The broader WCAG posture is indeed unproven, but the presentation audit measured concrete normal-text contrast failures in the frozen theme: approximately 3.09:1, 3.36:1, and 4.22:1 against a 4.5:1 requirement. The accurate label is therefore:

```text
Fail for confirmed confidence-badge contrast; broader WCAG 2.2 AA remains unproven.
```

No other rebuttal requested a repository winner change or produced evidence that invalidated the 559-file denominator, frozen snapshots, or synthesis selection.

## Gate effect

The earlier conditional Gate E omissions are resolved by:

- `ADR-001-chat-architecture-separation.md`;
- `integration-donor-manifest.json`;
- the amended target module graph and migration sequence;
- four scoped integration preservation commits;
- the cleanup ledger and restricted external quarantine.

Historical status: the August review considered Gate E ready. That readiness is superseded; current work is at revised Gate 1, and the revised Gates 6/9/11/12 have not been reached.
