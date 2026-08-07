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
- **NEVER rebuild `Algolia_Prod_Copy_Enhanced` by copying `Algolia_Prod_Copy_Vanilla`.**
  Enhanced is a copy of Vanilla, but it has since been enriched and deduplicated. Vanilla still
  holds all **4,853 duplicate records** that were deleted on 2026-08-06, and none of the 8-axis
  taxonomy. A raw copy restores the duplicates **and wipes the entire taxonomy** — the second loss
  is much the larger one. The only refresh path is:
  copy → `classify.py` → `apply_taxonomy.py` → `dedupe.py`, in that order.
  Nothing currently writes to Enhanced; the risk is a human running a convenience copy.
  See `docs/70-documentation/enrichment/chapter-2-deduplication.md` §10.
- **`Algolia_Prod_Copy_Enhanced` has `distinct: true` on `url`.** Search always returns one result
  per URL, so `nbHits` is the distinct-URL count, not the record count. Read the index settings
  before diagnosing anything as a duplicate-records problem — this is what made a whole plan's
  problem statement false on 2026-08-06.
- **There is no snapshot of the pre-dedupe index.** Both were deleted on Arijit's instruction
  (2026-08-06). Take a fresh one before any destructive operation.
- **Coverage is not correctness.** The taxonomy is applied but unvalidated. Never report a field
  being populated as if it were verified.
- **No sampling.** Arijit's standing rule for enrichment and validation: process one record at a
  time, verify by full census against the live surface.
- Do not tick an Asana checkbox yourself. Stop at Arijit's gate.

## Asana structure

Restructured 2026-08-06. **One numbering scheme, and the phase lives in a section, not in the name.**

- **Sections** hold the phases: `P0 — Foundation & governance` … `P6 — Validation & comms`, plus
  `Documentation`. This is what makes the board ordered and grouped.
- **Work units**: `WU-01 — <name>`. No phase prefix — it was redundant (WU-01…21 already run in
  phase order) and it was doing a job sections exist to do.
- **Subtasks**: `WU-<parent>.<n> — <name>`, numbered 1..n within their parent. The old global
  `[NN]` scheme is gone; nothing about `[44]` told you it belonged to WU-12.
- WU-25's risk register keeps its own `[RA-n]`. The documentation tree is unnumbered by design.

`docs/60-enrichment/asana-number-map.json` resolves every old `[NN]` to its new label.
`docs/05-execution-plan.md` is an **archive** and deliberately keeps the original numbers.

**Adding a subtask:** next free `.n` under its parent. **Never** renumber siblings to insert in the
middle — the numbers are cross-referenced inside the task briefs and in `docs/briefs/WU-NN.md`.

To re-run or extend the restructure: `docs/60-enrichment/asana_restructure.py --dry-run`. It rewrites
Asana notes and sweeps the repo and vault in one pass, then re-reads from Asana to verify.
**Build its rename map from a pre-change snapshot** — running it twice against already-renamed tasks
produces an empty map and a meaningless "PASS".
