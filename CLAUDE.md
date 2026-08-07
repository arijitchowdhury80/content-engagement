# algolia-com — Search-First Algolia.com

Read `SESSION.md` first. It is the resume point.

**Two sessions run in parallel on this repo, intentionally (Arijit, 2026-08-06).**
Backend session: `docs/70-enrichment/` taxonomy/enrichment pipeline, writes to
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
| Enrichment pipeline | `docs/70-enrichment/` |
| Software documentation | `docs/80-documentation/` |
| Execution briefs | `docs/briefs/` |

## Hard constraints

- **`.env.local` is a symlink into shared `commons/`.** Never write project secrets there — use
  `./.env.asana` or another project-local file. Never commit either.
- **This repo is PUBLIC**: `github.com/arijitchowdhury80/content-engagement`. Arijit's explicit
  decision. Do not add credentials, internal system-prompt text, or anything you would not want
  indexed. `docs/20-research/agent-studio-inventory.json` is gitignored for exactly this reason.
- **`SEARCHFIRST_WWW_v1` no longer exists.** [Corrected 2026-08-06] It was built from a
  from-scratch crawl (WU-05/WU-10) that duplicated content already on the account — killed
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
  See `docs/80-documentation/enrichment/chapter-2-deduplication.md` §10.
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

Restructured 2026-08-06. **One numbering scheme. The number equals the position.**

```
P0 — Foundation & governance   WU-01 .. WU-04
P1 — Research & data           WU-05 .. WU-11     <- WU-11 is Data enrichment
P2 — Evidence & critique       WU-12 .. WU-15
P3 — Models & governance       WU-16 .. WU-18
P4 — Concept architecture      WU-19
P5 — Build                     WU-20 .. WU-24
P6 — Validation & comms        WU-25 .. WU-26
Documentation                  Create Project Documentation
```

- **Sections** hold the phases. That is what makes the board grouped.
- **Work units**: `WU-NN — <name>`, no phase prefix. The number is contiguous and ascending
  across sections, so reading order and numeric order are the same thing.
- **Subtasks**: `WU-<parent>.<n> — <name>`, numbered 1..n within their parent.
- WU-04's risk register keeps its own `[RA-n]`. The documentation tree is unnumbered by design.

**Adding a work unit:** it goes at the end of its phase, and every later unit shifts. Use the
script — do not hand-edit, the numbers are cross-referenced in ~830 places including the brief
filenames.

**Adding a subtask:** next free `.n` under its parent. Never renumber siblings to insert in the
middle.

### The two scripts, and the trap in both

- `docs/70-enrichment/asana_restructure.py` — sections, prefix removal, subtask renumbering
- `docs/70-enrichment/asana_renumber_units.py` — work-unit renumbering to match phase order

Both rewrite Asana notes, sweep the repo and vault, and re-read from Asana to verify. The unit
script also `git mv`s `docs/briefs/WU-NN.md` in two phases so a rename cannot collide.

**Substitution must be a single pass with a callback.** Sequential replaces double-apply:
`04→07`, then that same `07→12`. **And build the rename map from a pre-change snapshot** — run
either script twice and it derives an empty map, then verifies against it and prints a
meaningless `PASS`.

Resolvers: `asana-number-map.json` (old `[NN]` → subtask label) and `wu-renumber-map.json`
(old → new WU number). `docs/05-execution-plan.md` is an **archive** and keeps the original
numbers by design.
