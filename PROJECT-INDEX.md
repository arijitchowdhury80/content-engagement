# Algolia.com Project Index

This repository holds the source, evidence, and operating record for the Search-First Algolia.com
program. Start here, then read `SESSION.md` for the current operational resume point.

## Project map

| Area | Location | What belongs there |
|---|---|---|
| Agent Studio definitions | `agents/definitions/` | Agent configuration, prompts, and provisioning scripts |
| Agent Studio probes | `agents/probes/` | Read-only live checks and short-lived spike tools |
| Frontend prototype | `frontend/search-first-demo/` | Static search-first demo and build helpers |
| Enrichment skill | `.claude/skills/algolia-data-enrichment/` | Supported Python CLI, profiles, tests, and installer |
| Program | `docs/program/` | Vision and work-unit briefs |
| Design | `docs/design/` | Agent Studio, telemetry, and search-experience design work |
| Research | `docs/research/` | Research source, observations, and screenshots |
| Evidence | `docs/evidence/` | Durable API, browser, and validation evidence |
| Operations | `docs/operations/` | Current enrichment state, plans, runs, and reports |
| Reference | `docs/reference/` | Maintained human-readable technical chapters |
| Archive | `docs/archive/` | Superseded plans, legacy tooling, and historical records |

## Status authorities

- `SESSION.md` is the resume point for active enrichment work.
- `.planning/` is local-only task and handoff state. It is not a published project authority.
- Asana is the status authority for assigned work. GitHub contains the versioned implementation and
  evidence.

## Current workstreams

1. Agent Studio concierge design and safety controls.
2. Agent Studio usage telemetry, query metering, and token economics.
3. Grounded corpus enrichment and verification.
4. Search-first experience research and prototype work.

The former `WS5` and `4.1` labels both referred to corpus enrichment. Use **Workstream 3: Corpus
Enrichment** in new material; historical records retain their original labels.
