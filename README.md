# Algolia.com Content Engagement

This repository is the public project record for the Search-First Algolia.com program. It holds
Agent Studio configuration, evidence, research, operating records, and the static search-first
prototype. Start with [PROJECT-INDEX.md](PROJECT-INDEX.md) and [SESSION.md](SESSION.md).

## Where Work Belongs

| Surface | Source of truth | Purpose |
|---|---|---|
| Program, agent definitions, evidence, and operations | This repository | Project control plane and durable evidence |
| Static search-first prototype | `frontend/search-first-demo/` | Prototype only; it is not the deployed chat widget |
| Production-style chat widget source | [`smomin/algolia-central-chat-widget`](https://github.com/smomin/algolia-central-chat-widget) | Separate implementation repository owned by the widget team |
| Development host | Jahia Drift custom-code block | Published integration surface; see the operating contract |

The active development Jahia host is
`https://tmp-content-eng-algolia.cloud.jahia.com`. Its allowed edit surface, release marker, and
verification rules are in
[the discovery-engagement operating contract](docs/design/search-experience/discovery-engagement/OPERATING-CONTRACT.md).

## Repository Map

- `agents/definitions/`: Agent Studio configuration, prompts, and provisioning scripts.
- `agents/probes/`: Read-only live checks and spikes.
- `frontend/search-first-demo/`: Static prototype.
- `docs/design/`: Designs, product proposals, and implementation plans.
- `docs/evidence/`: Browser, API, and deployment evidence.
- `docs/operations/`: Current enrichment runs, state, plans, and reports.
- `docs/archive/`: Historical material; not active operating instruction.
- `.claude/skills/algolia-data-enrichment/`: Supported enrichment CLI and tests.

## Deployment Boundary

There is no automatic GitHub-to-Jahia deployment and no automatic synchronization from the widget
repository into this repository. A widget release is complete only when all three facts are
recorded:

1. The widget source revision is committed in its own repository.
2. The built asset hashes match the uploaded Jahia assets.
3. The Jahia page is published, read back, and browser-verified.

The latest verified Jahia asset comparison is recorded in
[Jahia release sync evidence](docs/evidence/agent-studio/jahia-release-sync-2026-08-12.md).
