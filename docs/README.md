# Docs

This folder separates readable project documentation from generated execution output.

| Path | Purpose |
|---|---|
| `customer-documentation/` | Narrative chapters and end-customer documentation. |
| `design/` | Architecture, behavior contracts, implementation plans, and experiments. |
| `evidence/` | Compact validation reports, screenshots, probes, and readbacks. |
| `operations/` | Active operational plans, state files, prompts, and incidents. |
| `program/` | Work-unit coordination notes that mirror Asana structure. |
| `research/` | Research artifacts and local readbacks that are safe to commit. |
| `archive/` | Superseded plans, legacy tooling, and retired material. |

Generated enrichment batches, fetched page caches, full run directories, snapshots, and work
queues do not belong in Git. Keep durable summaries in `docs/evidence/` and executable process in
`skills/algolia-data-enrichment/`.
