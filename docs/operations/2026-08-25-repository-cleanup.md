# Repository Cleanup — 2026-08-25

## Outcome

The pre-comparison worktree was classified before cleanup. Durable source, tests, architecture
material, and compact evidence were retained. Generated, private, temporary, duplicate, and bulk
runtime evidence was moved to a recoverable owner-only archive.

- Branch: `codex/repository-cleanup-2026-08-25`.
- Files quarantined: 2,276.
- Bytes quarantined: 1,620,769,605 (about 1.62 GB).
- Hash verification failures: 0.
- Permanently deleted files: 0.
- Pushes, deployments, Agent Studio changes, index changes, and production changes: 0.

## Cleanup list

| Classification | Files | Bytes | Disposition |
|---|---:|---:|---|
| Raw generated evidence | 1,613 | 1,363,157,862 | Quarantined |
| Generated test evidence | 118 | 174,085,612 | Quarantined |
| Private network captures | 120 | 42,496,111 | Quarantined |
| Private local state | 262 | 29,888,970 | Quarantined |
| Generated/cache residue | 157 | 9,725,074 | Quarantined |
| Disposable/duplicate residue | 6 | 1,415,976 | Quarantined |

This includes old Agent Studio and Jahia run packets, raw browser JSON, screenshots, deployment
readbacks, production-comparison runs, UAT artifacts, Playwright logs, Jahia upload probes,
`.local`, `.tmp`, `.planning`, Python/pytest caches, and OS metadata.

The complete per-file list, original path, size, SHA-256, classification, disposition, reason, and
restoration destination is stored at:

```text
/Users/arijitchowdhury/.codex/archives/algolia-com-cleanup/2026-08-25-001/metadata/
  classification.tsv
  ignored-classification.tsv
  moved.tsv
  ignored-moved.tsv
```

The archive is owner-only and contains a repository bundle, pre-cleanup Git patches, the original
untracked inventory, manifests, hashes, and path-preserving quarantined files. Restore a quarantined
file by copying it from `quarantine/<original-path>` back to the repository at `<original-path>`.

## Intentionally retained

- Current source, configuration, tests, deployment tooling, and architecture material.
- Sanitized Markdown evidence and the current Jahia development release record.
- `node_modules`, because it was actively used to verify this cleanup.
- `.development-loop`, because it is the active local audit record and is ignored by Git.
- Local workspace/editor configuration and `.env.local`; these remain ignored and were not staged.
- Previously committed evidence still referenced by executable Team UAT tests and operational
  documentation. Removing that baseline requires a separate fixture/document migration and was not
  mixed into pre-demo housekeeping.

Two modified historical JSON captures were restored to their already committed versions. Their
dirty pre-cleanup overlays remain recoverable in `metadata/unstaged-before.patch`; committing those
new raw captures would have published stale browser identifiers and generated snapshot content.

## Prevention

`.gitignore` now blocks local runtime directories and raw generated evidence-run directories. New
durable evidence should be a compact, sanitized Markdown report at the evidence-directory root;
private raw captures belong outside the repository.

## Verification

- Widget tests: 318 passed.
- Stability harness: 70 passed.
- Deployment safety tests: 81 passed.
- Guardrail mutation tests: 2 passed.
- `git diff --check`: passed before staging.

The current local widget SHA-256 matches the released Jahia development chat asset. Exact release
identity and claim boundaries are in
`docs/evidence/deployments/2026-08-25-current-jahia-development-release.md`.
