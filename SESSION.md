# SESSION — Search-First Algolia.com

**Date:** 2026-08-05 (evening)
**Read this first, then `docs/briefs/README.md`.**

## Status

Working two-frame demo on a real 4196-record Algolia index. 6 of 25 work units done.
Asana fully built out (96/96 subtask notes). **The artifact exists; the research that
defends it does not.** Acceptance criteria: 2 met · 2 partial · 3 not met.

## Resume action

1. Start the demo: `cd docs/50-prototype/demo && python3 -m http.server 8899` →
   http://127.0.0.1:8899/index.html
2. Open Asana: https://app.asana.com/1/15096140849280/project/1217199861767750/list
3. **Run WU-12.** Read `docs/briefs/WU-12.md`. Start with subtask `[43]` — inspect the
   `ps_chat_algolia_prospect_intelligence_assistant` (11,750 recs) and
   `ps_chat_algolia_onboarding_implementation_assistant` (3,738 recs) indices on the Algolia
   account **before** any desk research. Also read `RAG/Algolia-Central-Spectrum/` — it
   already solved the "agent returns links instead of answers" failure.
4. Produce `docs/30-models/agent-studio-capability-verdict.md`. That verdict decides whether
   WU-18 builds a real agentic layer or ships a labelled designed one.
5. Post findings to the Asana task, write a vault wiki page, **stop for Arijit's gate.**

## Where we stopped (exact)

Finished writing notes into all 96 Asana subtasks and verified by readback (0 empty,
avg 1,463 chars). Then ran /persist. No work was in flight when the session ended.
Background processes: a `python3 -m http.server 8899` serving the demo — kill it or leave it.

## Decisions locked

- **Artifact-first ordering.** Build the demo, backfill the research. Already applied.
- **Agentic layer: investigate first, then decide** (Arijit, 2026-08-05). WU-12 `[43]` runs
  before anything is built.
- **Multilingual: OUT of scope, but disclosed** (Arijit). de+fr = 5459 URLs, unaddressed.
  Must be said in WU-21's talk track, not omitted.
- **Hosting: local + screenshots** for now; VPS tomorrow. Criterion 6 stays unmet.
- **Four-artifact split.** `05-execution-plan.md` = WHY · `docs/briefs/WU-NN.md` = HOW ·
  Asana = STATUS · vault = KNOWLEDGE. Brief wins on method, plan wins on reasoning.
- **One unit per session with a hard human gate.** Never tick the Asana checkbox yourself.
- **CHALLENGE step before any write-up** (`docs/briefs/README.md`): is this a template
  artifact? diff source-of-truth vs what I have as a number. what would falsify my claim?

## Remaining work

**Ready now, nothing blocking:** WU-12 (highest value) · WU-03 (⚠ Playwright MCP was killed —
confirm reconnection) · WU-07 (fan-out, ~200k tokens, declare budget first) · WU-08 (premise
test, 3h cap) · WU-23 · WU-24 · WU-25.

**Chained:** WU-11 ← WU-03 · WU-13 ← WU-12 · WU-14 ← WU-11+WU-12 · WU-18 ← WU-12 ·
WU-20 ← WU-19 · WU-21 ← WU-20+WU-10+WU-25.

**Blocked on Arijit:**
- **Asana PAT** → Gantt start dates, phase sections, custom fields.
  `echo 'ASANA_PAT=2/...' > algolia-com/.env.asana` — **NOT `.env.local`**, that is a symlink
  into shared `commons/`. He said "done" but nothing landed on disk.
- **VPS SSH** → WU-19 → WU-20 → criteria 3 and 6
- **GA/Looker export** → WU-06 → WU-10. If only one report, ask for `[75]` organic entrances
  by page type.
- **Sales/SC recruiting** → WU-09
- **SECURITY: reset the Asana OAuth client secret** pasted into chat 2026-08-05.

**Demo defects logged, not fixed:**
- `how do I add search to React` chip returns irrelevant blog posts (OCR, information density)
- Frame 1 top-nav items fire a search instead of navigating to the real page
- Zero-result state is coded but has never been visually verified
- Snippet noise: raw markdown and adroll tracking URLs in some record bodies

## Reference files

| What | Where |
|---|---|
| Reasoning SSOT | `docs/05-execution-plan.md` |
| Execution briefs + session protocol | `docs/briefs/README.md`, `docs/briefs/WU-NN.md` (19 files) |
| Original 1293-line plan | `docs/90-archive/2026-08-05-search-first-algolia-com-plan.md` |
| Corpus | `docs/50-prototype/corpus/records.jsonl` (2322), `records-doc.jsonl` (1885) |
| Crawler | `docs/50-prototype/crawl_corpus.py` (resumable, `--resume`) |
| Index builder | `docs/50-prototype/build_index.py` (idempotent) |
| Demo | `docs/50-prototype/demo/index.html` + `config.js` (gitignored) |
| IA findings | `docs/20-research/21-ia-audit.md`, `ia-map.json`, `sitemap-inventory.csv` |
| Six axes | `docs/20-research/six-axis-classification.jsonl`, `facet-schema.json` |
| Vault | `Obsidian/Arijit-Second-Brain/Projects/Search-First-Algolia-com/` |
| Algolia creds | `RAG/Algolia-Central-Spectrum/.env.local` — **never print** |

**Index:** `SEARCHFIRST_WWW_v1` · app has 146 indices · 23 navigational Rules ·
41–62ms processing.

## What has NOT been done

- **No Gantt chart.** `start_on` is silently discarded by the Asana MCP. Timeline shows
  markers, not duration bars. Needs the PAT.
- **No phase sections** in Asana — all 25 tasks sit in "Untitled section". MCP has no
  create-section tool.
- **No custom fields, no milestones, no bug tracking, no resource model.**
- **19 of 25 parent task descriptions are still plain text**, not `html_notes`. Content is
  correct; formatting is not.
- **WU-16 and WU-17 are not formally complete** even though a demo exists — their DoDs
  (all 8 journeys in one interaction, screenshots of all states) are unverified.
- **Zero research units run.** WU-03, 06, 07, 08, 09, 10, 11, 12, 13 all untouched.
- **Criterion 3 unmeasured, criterion 6 unmet, criterion 7 unmet.**
- **Two archive inventories still untracked:** ~28 metrics, ~76 named outputs. Only the
  86 tasks and the 10 riskiest assumptions are in Asana.
- WU-05 owes a hand-verified error rate on a 20-record sample.
- Nothing committed to git.

## Files written this session

**Code:** `docs/50-prototype/crawl_corpus.py` (streaming fix) · `build_index.py` ·
`docs/20-research/build_ia_artifacts.py` · `build_six_axis.py`
**Data:** `corpus/records-doc.jsonl` (1885) · `corpus/urls-doc.txt` ·
`20-research/six-axis-classification.jsonl` · `facet-schema.json` · `ia-map.json` ·
`sitemap-inventory.csv` · `mega-menu.json` · `50-prototype/index-build-report.json`
**Docs:** `20-research/21-ia-audit.md` · `40-concepts/44-design-thinking.md` ·
`docs/briefs/README.md` (+ CHALLENGE step) · 19 × `docs/briefs/WU-NN.md`
**Demo:** `50-prototype/demo/index.html` · `config.js` · `.gitignore`
**Vault:** `Projects/Search-First-Algolia-com/{index.md,log.md,tasks.md}` ·
`wiki/{ia-findings.md,coverage-gaps.md}` · `Projects/AI-OS/My-Projects.md` (registered)
**Memory:** 3 new files + `MEMORY.md` + `session_pointer.md`
