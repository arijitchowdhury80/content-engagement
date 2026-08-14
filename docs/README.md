# Docs

This folder separates readable project documentation from generated execution output.

| Path | Purpose |
|---|---|
| `customer-documentation/` | Narrative chapters and end-customer documentation. |
| `design/` | Architecture, behavior contracts, implementation plans, and experiments. |
| `evidence/` | Compact validation reports, screenshots, probes, and readbacks. |
| `operations/` | Active operational packets and mutation evidence. |
| `program/` | Durable project coordination notes. Asana is the task source of truth. |

Generated batches, fetched page caches, full run directories, snapshots, and work queues do
not belong in Git. Keep durable summaries in `docs/evidence/` and executable process in
project-owned source folders.
