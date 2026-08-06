# algolia-com — Search-First Algolia.com

Read `SESSION.md` first. It is the resume point.

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
- **Two indices, do not confuse them.** `SEARCHFIRST_WWW_v1` (4,196 records) is the demo.
  `Algolia_Prod_Copy_Enhanced` (16,967 records) is the production copy being enriched.
  `Algolia_Prod_Copy_Vanilla` is off limits — a colleague's live agents query it.
- **Coverage is not correctness.** The taxonomy is applied but unvalidated. Never report a field
  being populated as if it were verified.
- **No sampling.** Arijit's standing rule for enrichment and validation: process one record at a
  time, verify by full census against the live surface.
- Do not tick an Asana checkbox yourself. Stop at Arijit's gate.
