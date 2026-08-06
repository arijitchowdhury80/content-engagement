# algolia-com — Search-First Algolia.com

Read `SESSION.md` first. It is the resume point.

**Two sessions run in parallel on this repo, intentionally (Arijit, 2026-08-06).**
Backend session: `docs/60-enrichment/` taxonomy/enrichment pipeline, writes to
`Algolia_Prod_Copy_Enhanced`. Frontend session: `docs/50-prototype/demo/`, the WU-briefs,
Asana task state. Each stays in its lane. Before running `git add -A`, check
`git status` first — the other session may have its own uncommitted work in flight.

## Where things are

| Thing | Path |
|---|---|
| Session state | `./SESSION.md` |
| Memory | `~/.claude/projects/-Users-arijitchowdhury-Dropbox-AI-Development-algolia-com/memory/` |
| Vault project (knowledge SSOT) | `~/Dropbox/AI-Development/Obsidian/Arijit-Second-Brain/Projects/Search-First-Algolia-com/` |
| Status SSOT | Asana project `1217199861767750` |
| Enrichment pipeline | `docs/60-enrichment/` |
| Software documentation | `docs/70-documentation/` |
| Execution briefs | `docs/briefs/` |

## Hard constraints

- **`.env.local` is a symlink into shared `commons/`.** Never write project secrets there — use
  `./.env.asana` or another project-local file. Never commit either.
- **This repo is PUBLIC**: `github.com/arijitchowdhury80/content-engagement`. Arijit's explicit
  decision. Do not add credentials, internal system-prompt text, or anything you would not want
  indexed. `docs/20-research/agent-studio-inventory.json` is gitignored for exactly this reason.
- **`SEARCHFIRST_WWW_v1` no longer exists.** [Corrected 2026-08-06] It was built from a
  from-scratch crawl (WU-02/WU-22) that duplicated content already on the account — killed
  by Arijit, deleted, scrubbed from git history. **The demo now queries
  `Algolia_Prod_Copy_Enhanced` directly** (**12,114 records** after the 2026-08-06 dedupe — one per
  distinct URL, down from 16,967; note `distinct:true` on `url` is set, so search always saw 12,114
  anyway — 8 sources,
  Chapter 1's taxonomy already applied). Do not recreate `SEARCHFIRST_WWW_v1` or re-crawl
  algolia.com — Enhanced is the source of truth for both the backend enrichment work and
  the frontend demo.
  `Algolia_Prod_Copy_Vanilla` is off limits for writes — a colleague's live Agent Studio
  agents (`www Chat`, `Algolia_*`) query it. Reading it is fine.
- **Coverage is not correctness.** The taxonomy is applied but unvalidated. Never report a field
  being populated as if it were verified.
- **No sampling.** Arijit's standing rule for enrichment and validation: process one record at a
  time, verify by full census against the live surface.
- Do not tick an Asana checkbox yourself. Stop at Arijit's gate.
