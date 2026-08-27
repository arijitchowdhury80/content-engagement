# algolia-com

Read `README.md` for the repository map.

## Runtime Facts

- App: `0EXRPAXB56`
- Dev agent: `www Chat - Orchestrator`
- Index: `Algolia_Prod_Copy_Vanilla`
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

- Use the project-local enrichment skill, never a global `.Codex/skills` copy.
- Do not use stale names: `agents/probes`, `agents/definitions`, `docs/reference/enrichment`, or `docs/discovery-engagement`.
- Do not commit secrets, private Agent Studio dumps, generated run payloads, batches, caches, snapshots, or local temp state.
- Snapshot, dry-run, approval where required, apply, readback, and evidence are mandatory for index or Agent Studio mutations.
- Check `git status` before staging because this repo often has parallel-session changes.

## Locked Judge Runtime

- Browser judging is mandatory. `<algolia-chat-confidence>` must not have a `mode` attribute.
- Compare is read-only with respect to judging. It must not query, enable, disable, cancel, or render the judge lifecycle.
- Exactly one skeptic, referee, and advocate must receive the same sealed evidence package in parallel.
- Do not change judge prompts, models, agents, rubric, scoring, grounding, lifecycle, or presentation without Arijit's explicit approval.
- Every Jahia custom-code-block mutation must use `tools/deployment/deploy_jahia_engagement_tracker.py::set_block_html`; direct GraphQL HTML mutation is prohibited elsewhere.
- Every deployment that can republish `algolia-chat.js` must pass `tools/deployment/judge_release_guard.py` before mutation.
- UI-only and Compare-only releases must not republish or reconfigure judge runtime assets.
