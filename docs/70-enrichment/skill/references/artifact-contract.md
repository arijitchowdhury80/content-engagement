# Artifact contract

Everything a slice produces lives under exactly one run folder:

```
docs/70-enrichment/runs/<run-id>/
  .lock  state.json  manifest.json  census-before.json  effective-config.json
  artifact-manifest.json  ledger.jsonl  metrics.json  fetch-manifest.json
  cache-scout/          bodies this run's own fetch produced
  outputs/base/ outputs/repair/
  final/results.jsonl  final/payloads.jsonl  final/human-review-queue.jsonl
  validation/           coverage, grounding, payload, live, method-check, target-index
  reports/              packet.md, review-pack.md
  approvals/  probes/  logs/  tmp/  archive/
```

Run ids are `YYYYMMDD-source-page_type-aNN`. The attempt suffix is load-bearing: without it a
same-day rerun of the same slice collides on the folder and the lock.

## Rules

- Commands write only under `runs/<run-id>/`. `RunFolder.resolve()` refuses a path that escapes
  it, and `handoff` is the one declared exception (`HANDOFF-current.md`).
- Validation reads `artifact-manifest.json`, never a directory glob. Historical artifacts poisoned
  validation on this project — a base output and a repair output for the same record, and
  whichever the glob read last won. `build-final` applies explicit precedence instead.
- No overwriting `final/results.jsonl` without `rerun-approved.json`.
- Probes live in `probes/`, are disposable, and package code never imports from them. A probe
  output is not approval evidence unless it is promoted into `validation/`.
- No `PACKET-*.md`, `blog-*.json`, `*-codex-*.json` or `*-claude-*.json` at the top level or in
  the shared reports folder during a run. That convention is how the reports folder reached 67
  files.

## The fetch/enrich join

`enrich` takes a run folder, never a cache path. `RunCache.load()` refuses unless
`fetch-manifest.json` exists, names THIS run id, and every body's hash still matches the file on
disk. Every body is then checked against the body source the manifest declares — checked against
the manifest, not against the body's own claim about itself, because a body that lies about its
fetcher would otherwise skip the check that exists to catch it.

Before this, fetch and enrich were two programs joined by a human running them in the right
order; nothing verified that the bodies the runner read were the bodies the fetcher wrote.

## Cleanup

Default: keep `manifest.json`, `final/`, `validation/`, `reports/packet.md`, approvals. Move
`tmp/`, transient logs and superseded attempts to `archive/`.

`cache-scout/` grows faster than anything else. While the run is open, keep it in full. At CLOSED,
archive the bodies and **retain the content hashes** — drift checking needs the hashes, not the
bodies. Never delete a cached body a still-open human-review row points at.

Deletion requires `cleanup-approved.json`. Accepted final artifacts, approval files, live-write
snapshots and the validation JSON used for approval are never deleted.
