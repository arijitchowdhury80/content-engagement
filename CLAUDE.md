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
| Status SSOT — **enrichment** | Asana project `algolia.com` = `1217323957361215`, section "Workstream 5 — algolia.com Target Surface" |
| Status SSOT — search-first redesign | Asana project `Search-First Algolia.com` = `1217199861767750` |
| **Enrichment skill (USE THIS)** | `.claude/skills/algolia-data-enrichment/` |
| Enrichment run output + history | `docs/70-enrichment/` |
| Software documentation | `docs/80-documentation/` |
| Execution briefs | `docs/briefs/` |

## Hard constraints

- **`.env.local` is a symlink into shared `commons/`.** Never write project secrets there — use
  `./.env.asana` or another project-local file. Never commit either.
- **This repo is PUBLIC**: `github.com/arijitchowdhury80/content-engagement`. Arijit's explicit
  decision. Do not add credentials, internal system-prompt text, or anything you would not want
  indexed. `docs/20-research/agent-studio-inventory.json` is gitignored for exactly this reason.
- **`SEARCHFIRST_WWW_v1` is DELETED — 2026-08-07, verified 404.** Do not recreate it and do not
  re-crawl algolia.com. Read the history here, because it is the interesting part: this file
  claimed it was deleted on **2026-08-06**, but only the local crawl output was removed that day.
  The index itself survived a further day, unnoticed, because the claim was checked against the
  filesystem and never against the account. **Verify a deletion on the surface you deleted from.**
  Before it went, its **325 unique body records** — URLs whose body text existed in no other index —
  were rescued to `docs/70-enrichment/body-rescue-searchfirst-20260806.jsonl` (gitignored), so
  Chapter 3's body coverage is unchanged at 6,497 URLs. The from-scratch crawl work units
  (WU-05/WU-10) remain superseded.
- **The demo queries `Algolia_Prod_Copy_Enhanced` directly** — **12,114 records** after the
  2026-08-06 dedupe, one per distinct URL, down from 16,967. `distinct:true` on `url` is set, so
  search always returned 12,114 anyway. 8 sources, Chapter 1's taxonomy applied. Enhanced is the
  source of truth for both the backend enrichment work and the frontend demo. Do not re-crawl
  algolia.com.
  `Algolia_Prod_Copy_Vanilla` is off limits for writes — it is the raw upstream copy. Reading it
  is fine, but live `www Chat` and `Algolia_*` answering agents now query Enhanced.
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
- **Enriched fields ARE searchable — corrected 2026-08-11, proven by query.** This entry
  previously said the opposite, and that stale claim was repeated to Arijit twice in one session
  before anyone re-checked the account. `searchableAttributes` on `Algolia_Prod_Copy_Enhanced` is
  `['title', 'unordered(description)', 'unordered(abstract_enriched)',
  'unordered(keyhighlights_enriched)', 'unordered(abstract)', 'unordered(tags)',
  'unordered(keywords)', 'unordered(category)', 'unordered(url)']`. Verified the way this project
  requires — by QUERY, not by reading settings: a phrase present only in one record's
  `abstract_enriched`, and absent from its title and description, returns that record. The 2,694
  enriched Blog records do deliver search value today. **The lesson is the one already written
  down for index deletion: check the account, not the note.**
- **Two indices, because the architecture changed mid-project. Know which one you mean.**
  `Algolia_Prod_Copy_Enhanced` is the real corpus — 11,928 full records, queried by the demo and
  the live answering agents. Blog's 2,694 enriched records are here, written directly by the OLD
  pre-skill pipeline. `Algolia_Prod_Copy_Enhanced_Parallel` is a **payload holding pen, not a
  corpus**: 255 records carrying exactly three fields each — `objectID`, `abstract_enriched`,
  `keyhighlights_enriched`. No title, url, source or page_type. The skill writes there on purpose
  so a bad run cannot damage the real index. 225 case-study + 30 blog payloads are parked there,
  validated and byte-verified, and **invisible to every consumer** until promoted. That is why a
  census of Enhanced reports case-study as 1/237 while the work is actually done. See WS5.20.
- **Judge model: `small` (gemma-4-26b) on the Algolia inference server. Gemini is banned
  (Arijit, 2026-08-10).** Never point the judge at `large` or `xlarge` — both serve **glm-5.2,
  which is the writer**, so either would be the model grading its own output.
- **Repair before quarantine.** A span that is cut mid-sentence or ends in a colon is a bad CUT,
  not a bad page. Extend it over the page's own following words (`span_repair.py`). Never add
  punctuation — that is fabrication.
- **Run enrichment through the skill, never the loose scripts.**
  `python3 .claude/skills/algolia-data-enrichment/scripts/algolia_enrich.py <command> --workspace .`
  25 of the 40 `docs/70-enrichment/*.py` files do not belong in the pipeline at all, and two of
  the ones that do contain gate paths the runner never reached. The skill carries 15 of them,
  split rather than copied. 166 tests.
- **`span_gate.run_gates()` is NOT in the skill, deliberately.** It is the function the historical
  runner never called and that was "fixed" inside twice while every unit test passed. The skill
  has one live path — `pipeline.evaluate_selection` — and `test_gate_wiring.py` proves a gate is
  reached by driving the CLI and reading the run's own output, not by importing the gate.
- **Two runs are parked at the approval gate** (`case-study a03` 225 payloads, `blog a02` 50).
  `corpus-status` is RED until they are resolved, and the skill's own rule blocks a new slice on
  red. Nobody but Arijit writes an approval file.
- Do not tick an Asana checkbox yourself. Stop at Arijit's gate.

## Asana structure

### Enrichment lives in `algolia.com` now — renamed to the Workstream scheme (2026-08-11, Arijit)

`WU-11 — Data enrichment` and its 12 subtasks moved to the **`algolia.com`** project
(`1217323957361215`), section "Workstream 5 — algolia.com Target Surface", and were **renamed
`WU-11` → `WS5`, `WU-11.n` → `WS5.n`**. `Enrichment documentation` (5 chapters) moved with them
and is now a top-level task there rather than a child of `Create Project Documentation`.

Measured before the rename, not assumed: **55 occurrences in 15 files**, no `docs/briefs/WU-11.md`
to `git mv`. 40 were rewritten in one pass; 15 were left alone on purpose (below). Asana GIDs are
unchanged by a move or a rename, so every `asana:` frontmatter pointer in the chapter files still
resolves.

**Three files keep `WU-11` deliberately** — they are history, and rewriting them would corrupt the
record they exist to preserve: `docs/05-execution-plan.md` (the archived plan),
`docs/70-enrichment/wu-renumber-map.json` and `asana-number-map.json` (the resolvers for the
EARLIER renumber). Do not "finish the job" by sweeping these.

**The phase table below still says `WU-11`, and that is correct.** It describes the historical
`Search-First Algolia.com` numbering, where WU-11 occupied that slot. That project now runs
WU-01..WU-26 **with WU-11 vacant** — the numbers were NOT closed up, because renumbering 15 work
units to reclaim one slot would rewrite every brief filename for no gain.

Restructured 2026-08-06. **One numbering scheme. The number equals the position.**

```
P0 — Foundation & governance   WU-01 .. WU-04
P1 — Research & data           WU-05 .. WU-11   <- WU-11 VACATED, now WS5 in algolia.com
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
