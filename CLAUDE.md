# algolia-com

This repository holds the Algolia.com concierge work: Agent Studio definitions, enrichment
tooling, evidence, docs, and the search-first frontend prototype.

Start with this file for the repository map and `SESSION.md` for the current resume state. If
those disagree, verify live systems and update the stale file before acting.

## Current Map

| Area | Path | Purpose |
|---|---|---|
| Enrichment skill | `skills/algolia-data-enrichment/` | Project-local skill, Python CLI, profiles, tests, and runbooks |
| Agent prompts | `agents/prompts/` | Versioned agent prompts, judge prompts, and shared prompt fragments |
| Agent admin | `agents/admin/` | Agent Studio config builders and provisioning scripts |
| Agent probes | `agents/probes/` | Read-only Agent Studio inspection, spot-check, and sweep scripts |
| Chat widget | `frontend/chat-widget/` | Recovered Jahia widget JavaScript artifacts; source gap must be closed |
| Frontend prototype | `frontend/search-first-demo/` | Search-first demo and local build helpers |
| Runtime/config notes | `config/` | Public, non-secret configuration documentation |
| Current evidence/runs | `docs/operations/` and `docs/evidence/` | Durable execution artifacts and verification evidence |
| Human reference docs | `docs/reference/` | Maintained narrative documentation |
| Historical material | `docs/archive/` | Superseded plans and legacy tooling; do not run unless explicitly reviving |

## Runtime Facts

- Agent Studio app: `0EXRPAXB56`.
- Primary dev chat agent: `www Chat - Orchestrator`.
- Retrieval index: `Algolia_Prod_Copy_Enhanced`.
- Production Ask Algolia is read-only comparison evidence. Do not modify it.
- Do not touch Spectrum or host HTML.
- `Algolia_Prod_Copy_Vanilla` is not a deployment target and must not be copied over Enhanced.

## Working Rules

- Use the project-local enrichment skill from `skills/algolia-data-enrichment/`.
- Run enrichment commands as:

```bash
PYTHONPATH=skills/algolia-data-enrichment/scripts \
python3 skills/algolia-data-enrichment/scripts/algolia_enrich.py <command> --workspace .
```

- Snapshot, dry-run, approval, apply, and readback gates are mandatory for index writes.
- Never claim completion without fresh verification output.
- Check `git status` before staging; this repo often has unrelated work from parallel sessions.
- Do not commit secrets, Agent Studio private exports, or local environment files.
- Keep this file short. Put details in `SESSION.md` or scoped runbooks.

## Agent Files

- `agents/prompts/instructions_*.md` are versioned agent prompts.
- `agents/prompts/judge/` contains judge prompts.
- `agents/admin/algoliaComConfig.mjs` contains shared agent constants and builders.
- `agents/admin/build_algolia_com_agents.mjs` creates or patches configured agents.
- `agents/probes/agent-tool-handoff/` contains read-only live dump, spot-check, and sweep tools.

## Documentation Discipline

- Project status belongs in Asana and `SESSION.md`.
- Durable implementation evidence belongs under `docs/evidence/` or `docs/operations/`.
- Long historical explanations do not belong in `CLAUDE.md`.
