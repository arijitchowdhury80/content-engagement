# Algolia Content Engagement - White Glove Concierge

This repository is the working home for the Algolia.com discovery concierge: Agent Studio
configuration and prompts, the Jahia chat widget JavaScript, visitor-intelligence work,
validation evidence, and project documentation.

Start here for the folder map and current runtime boundaries.

## Current Runtime

- Agent Studio app: `0EXRPAXB56`
- Primary development agent: `www Chat - Orchestrator`
- Retrieval index: `Algolia_Prod_Copy_Vanilla`
- Production Ask Algolia is read-only comparison evidence. Do not mutate it from this repo.
- Jahia development box: `https://tmp-content-eng-algolia.cloud.jahia.com/`

## Folder Map

| Path | What lives there |
|---|---|
| `agents/prompts/` | Versioned prompt files and judge prompts that belong in Git. |
| `agents/admin/` | Agent Studio config builders and patch/provisioning scripts. |
| `agents/checks/` | Read-only live Agent Studio dump, spot-check, and sweep scripts. |
| `frontend/chat-widget/` | Current project-owned chat widget JavaScript files. Keep source files flat here; create `dist/` only for generated packages. |
| `backend/jahia-modules/` | Jahia OSGi modules (Maven/Java) providing server-side endpoints for the chat widget, e.g. the token-telemetry API-key proxy. |
| `testing/` | Project-owned test contracts, journey definitions, manual test plans, automation specifications, and durable test summaries. |
| `skills/algolia-data-enrichment/` | Project-local enrichment skill, CLI, tests, references, and runbooks. |
| `tools/inspection/` | Small inspection/probe scripts used by workstream validation. |
| `config/` | Public configuration notes only. Secrets stay in ignored local env files. |
| `docs/customer-documentation/` | Narrative documentation chapters written for the project/customer record. |
| `docs/design/` | Durable architecture, design, and implementation contracts. |
| `docs/evidence/` | Compact validation evidence and reports that should remain reviewable in Git. |
| `docs/operations/` | Active operational packets and mutation evidence. Generated run payloads are ignored. |

## Important Boundaries

- `agents/checks/` replaced the old `agents/probes/` idea. These scripts inspect live systems; they are not prompt source.
- `agents/prompts/` replaced the old `agents/definitions/` naming. Prompts and judges belong here.
- `skills/algolia-data-enrichment/` is the project-local skill. Do not use a global `.claude/skills/algolia-data-enrichment` copy for this project.
- Proactive engagement runtime source files live directly in `frontend/chat-widget/`: `algolia-engagement-tracker.js`, `algolia-context-compiler.js`, `algolia-proactive-controller.js`, and `handoff-to-orchestrator.js`.
- Generated batches, caches, snapshots, and work queues are intentionally ignored and should not be committed.

## Common Commands

```bash
# Agent Studio inventory
node agents/admin/build_algolia_com_agents.mjs --list

# One live Agent Studio spot check
node agents/checks/spotcheck-live.mjs <agentId> "What is Algolia?"

# Enrichment CLI
PYTHONPATH=skills/algolia-data-enrichment/scripts \
python3 skills/algolia-data-enrichment/scripts/algolia_enrich.py <command> --workspace .
```

Before any Agent Studio or index mutation: snapshot the target, record rollback, dry-run where
possible, get approval when required, apply the smallest payload, read back, and save evidence.
