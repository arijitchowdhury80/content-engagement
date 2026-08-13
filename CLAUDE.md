# algolia-com

Read `README.md` for the repository map and `SESSION.md` for current workstream state.

## Runtime Facts

- App: `0EXRPAXB56`
- Dev agent: `www Chat - Orchestrator`
- Index: `Algolia_Prod_Copy_Enhanced`
- Production Ask Algolia is read-only comparison evidence.
- Jahia dev surface: `/sites/www/home/drift/custom-code-block`

## Current Paths

- Agent prompts: `agents/prompts/`
- Agent Studio scripts: `agents/admin/`
- Live read-only checks: `agents/checks/`
- Chat widget JavaScript: `frontend/chat-widget/`
- Enrichment skill: `skills/algolia-data-enrichment/`
- Customer documentation: `docs/customer-documentation/`
- Design contracts: `docs/design/`
- Validation evidence: `docs/evidence/`
- Active operations: `docs/operations/`
- Retired material: `docs/archive/`

## Rules

- Use the project-local enrichment skill, never a global `.claude/skills` copy.
- Do not use stale names: `agents/probes`, `agents/definitions`, `docs/reference/enrichment`, or `docs/discovery-engagement`.
- Do not commit secrets, private Agent Studio dumps, generated run payloads, batches, caches, snapshots, or local temp state.
- Snapshot, dry-run, approval where required, apply, readback, and evidence are mandatory for index or Agent Studio mutations.
- Check `git status` before staging because this repo often has parallel-session changes.
