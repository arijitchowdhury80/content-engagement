# Algolia.com Concierge

This repository is the working home for the Algolia.com discovery concierge: Agent Studio
configuration and prompts, the Jahia chat widget JavaScript, visitor-intelligence work,
corpus enrichment tooling, validation evidence, and project documentation.

Start here for the folder map. Read `SESSION.md` next for the current state of the active
workstreams.

## Current Runtime

- Agent Studio app: `0EXRPAXB56`
- Primary development agent: `www Chat - Orchestrator`
- Retrieval index: `Algolia_Prod_Copy_Enhanced`
- Production Ask Algolia is read-only comparison evidence. Do not mutate it from this repo.
- Jahia development surface: `/sites/www/home/drift/custom-code-block`

## Folder Map

| Path | What lives there |
|---|---|
| `agents/prompts/` | Versioned prompt files and judge prompts that belong in Git. |
| `agents/admin/` | Agent Studio config builders and patch/provisioning scripts. |
| `agents/checks/` | Read-only live Agent Studio dump, spot-check, and sweep scripts. |
| `frontend/chat-widget/` | Current project-owned chat widget JavaScript files. Keep source files flat here; create `dist/` only for generated packages. |
| `frontend/search-first-demo/` | Local prototype/demo code. This is not the Jahia deployment source of truth. |
| `skills/algolia-data-enrichment/` | Project-local enrichment skill, CLI, tests, references, and runbooks. |
| `tools/inspection/` | Small inspection/probe scripts used by workstream validation. |
| `config/` | Public configuration notes only. Secrets stay in ignored local env files. |
| `docs/customer-documentation/` | Narrative documentation chapters written for the project/customer record. |
| `docs/design/` | Durable architecture, design, and implementation contracts. |
| `docs/evidence/` | Compact validation evidence and reports that should remain reviewable in Git. |
| `docs/operations/` | Active operational plans, state, prompts, and incident notes. Generated run payloads are ignored. |
| `docs/archive/` | Historical plans, legacy scripts, and retired material. Do not use as current source unless explicitly reviving them. |

## Important Boundaries

- `agents/checks/` replaced the old `agents/probes/` idea. These scripts inspect live systems; they are not prompt source.
- `agents/prompts/` replaced the old `agents/definitions/` naming. Prompts and judges belong here.
- `skills/algolia-data-enrichment/` is the project-local skill. Do not use a global `.claude/skills/algolia-data-enrichment` copy for this project.
- `docs/customer-documentation/enrichment/` replaced `docs/reference/enrichment/`.
- `docs/operations/enrichment/runs/`, batches, caches, snapshots, and work queues are generated execution payloads. They are intentionally ignored and should not be committed.

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
