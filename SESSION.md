# SESSION — Search-First Algolia.com

_Last updated: 2026-08-08 evening_

## Status

Chapter 3 enrichment is **built, measured, and human-reviewed for safety**. It has **not** been run
on the corpus. Phase 0 of the full-corpus run is committed. Nothing new was written to the live index.

## Resume action

1. **Read the plan: `~/.claude/plans/then-what-the-hell-zippy-squid.md`.** It is the bootstrap for
   the full-corpus run and Arijit approved it.
2. **Run the Phase 1 gate** (may already be done — check `batches-out/doc-md-twin-reference-001/`):
   ```
   D=~/Dropbox/AI-Development/algolia-com/docs/70-enrichment
   python3 "$D/run_batches.py" --batches "$D/batches" --out "$D/batches-out" \
           --cache "$D/cache-batches" --only doc-md-twin-reference-001 --workers 1
   ```
   **≥60% gate-pass or stop.** That family is 4,392 records and Arijit's review marked 3 of 3 bad.
3. If the gate fails, fix the `reference` prompt against the 3 records in
   `reports/review-pack-verdicts-filled2.md` and re-run. Do not launch 4,392 records on a failing family.
4. If it passes, Phase 2: fetch. **Blocked on Arijit** — see below.

**USE ABSOLUTE PATHS IN EVERY COMMAND.** Three failures this session came from chaining `cd` into a
command whose cwd had already moved. One made the calibration run silently never start; only a
zero-byte log revealed it.

## Where we stopped (exact)

- Phase 0 complete and committed: `41e1926` (batching, retry, orchestrator), `bcfdff0` (lock +
  completion fix). **160 tests pass**, 1 xfailed (a documented residual).
- **Phase 1 gate: PROVISIONAL FAIL — 42% gate-pass against a 60% bar.**
  `doc-md-twin-reference-001`, 50 records: 19 QUARANTINED_BY_GATE, 11 JUDGE_REVISE, 10 PASS,
  10 NO_ABSTRACT_THIN. Only 21 of 50 produced an abstract at all.
  **Provisional because the results file is contaminated** — 59 rows for 50 records. A pre-lock
  process was still writing while a locked one ran, so the numbers above are a dedupe-by-last-row
  read, not a clean measurement. **Re-run it clean first** (nothing else running):
  ```
  D=~/Dropbox/AI-Development/algolia-com/docs/70-enrichment
  pgrep -f enrich_run   # must be empty
  python3 "$D/run_batches.py" --batches "$D/batches" --out "$D/batches-out" \
          --cache "$D/cache-batches" --only doc-md-twin-reference-001 --workers 1
  ```
  `is_complete` now treats any duplicate as incomplete, so the re-run will redo it properly.
  **But 42% vs a 60% bar is too wide a gap to be contamination alone.** Expect the reference
  family to genuinely fail and plan to fix the prompt, not to re-measure your way past it.
  The `abstract_must_not_be` constraint added this session is in play and clearly not sufficient.
- Fresh snapshot `snapshots/Algolia_Prod_Copy_Enhanced-20260808-125143.jsonl` — **12,036 records**,
  verified against live. This is the rollback floor and it makes the write gate pass.

## What changed this session

**Selection quality — fixed at the candidate layer, not the prompt.** The previous diagnosis in
this file said "prompt work, not safety work." Both halves were wrong. `canonicalise()` collapses
every newline to a space, so `candidates.py` received each page as one flat string and could only
cut at sentence-ending punctuation. Nav bars, CTA rows and countdown timers contain none — they
merged into one chunk, hit `MAX_CHARS=400`, and were chopped at an arbitrary word boundary.
**715 of 2,264 candidates (31.6%) were mid-sentence fragments.**

| | baseline | now |
|---|---|---|
| judge coherence | 2.88 / 2.85 | **4.62** |
| PASS | 15/50 | **25/50** |
| prose candidates fragment-shaped | 31.6% | **1.15%** |
| abstract spans out of page order | 7/34 | **0/33** |
| tests | 66 | **160** |

**Arijit's first human review — the gate that had been open for three days.** 10 English records:
**5 good, 5 not good, 0 hallucinations.** The zero-invention guarantee held under human inspection.
His review found four things the LLM judge did not, listed under Remaining work.

**G8 corpus-wide boilerplate: built, measured twice, OFF.** Lost both times (coherence 4.21 then
4.52 vs 4.62). The flaw is structural, not a threshold — a sentence can be furniture on ten pages
and be the content on the eleventh. `/fr/awards` is a page *about* Algolia's awards and G8 stripped
7 of its 8 prose candidates. `boilerplate.py` and its 11 tests are kept because Arijit's review
confirms the defect is real. **Do not flip `G8_ENABLED` without a measured run.**

**Full-corpus Phase 0 built:** `make_batches.py` (208 batches, partition asserted exhaustive),
a retry/backoff/429 layer (neither model call had *any* retry, and neither could even see an HTTP
status — at 8 workers that would have dropped records silently while every batch reported success),
`run_batches.py` (parallel, flock per batch, batch-level resume), and `fetch_router.py --from-batch`.

## Decisions locked (Arijit, this session)

- **Judge every record**, in parallel. ~4h rather than ~40h sequential.
- **Write everything gate-passed**, not just judge-ACCEPT. Add `JUDGE_REVISE` to `WRITABLE` in
  `write_enrichment.py` — those records have valid zero-invention abstracts; the judge only said a
  better sentence existed. Takes yield from 56% to 76%.
- **Calibration batch before the full launch.**
- **`searchableAttributes` order** (approved, with one change I argued for and he accepted the
  reasoning on): `title / abstract_enriched / description / keyhighlights_enriched / abstract / …`
  **Apply AFTER the corpus run** — partial enrichment makes enriched records outrank unenriched
  ones for the same query. Note it also swaps `abstract` and `description` from the live order,
  which affects all 12,036 records and is a separate decision.

## Remaining work

**Quality gaps Arijit's review found, unfixed:**
- **`reference` family leads with protocol boilerplate** — 3 of 3 bad, and it is 4,392 records
  (43% of enrichable). A negative constraint was added to `shape-families.json`; **unvalidated**.
  The Phase 1 gate measures it.
- **Non-sentence facts are unreachable.** The DevCon date (`Sept 30 - Oct 1, 2026 - VIRTUAL`) never
  reaches the output *because it is not a sentence*. Candidates are sentence-based with a 25-char
  floor, so dates, prices and specs are structurally invisible. This needs a design change, not a
  prompt tweak.

**The run:** Phase 2 fetch (10,125 pages) → Phase 3 parallel enrich → Phase 4 write → Phase 5 triple
verify → Phase 6 settings. Detail in the plan file.

## Open — need Arijit

| # | Item |
|---|---|
| 1 | **`HOSTED_JOB_QUEUE_WORKERS=2`** on the shared Scout container. Caps the 10,125-page fetch near 7h, and fetch now gates everything. **The critical path.** |
| 2 | **A junk record is in the live index** — `{"hitsPerPage":1,"objectID":"7825fa8b-…"}`, a search query body stored as a document, written today by something outside this pipeline (all runs were `--pilot`). Delete it? And what wrote it? |
| 3 | `searchableAttributes` change — approved in principle, sequenced after the run |
| 4 | Rotate credentials: Resend SMTP password, both Scout keys |
| 5 | `reports/fresh50-run1|2/` are tracked in git (~400KB of page-text excerpts in a PUBLIC repo). `reports/*/` now ignores future runs; the existing two are your call |
| 6 | Two payload files untracked via `git rm --cached` but still in git history — rewrite or leave? |

## What has NOT been done

- **The corpus run.** 0 of 10,198 records. 35 records in the index are from the retired copy-text design.
- Phase 1 gate result — running at persist time.
- `JUDGE_REVISE` is **not yet** in `write_enrichment.py`'s `WRITABLE` set (decision made, not coded).
- G5 language check still not in the runner.
- `enterprise_ledger` as a body source: measured (4,462 records) but unwired.
- Chapter 1's classifier has **not** been re-run on enriched text — the actual payoff, untouched.
- The 19 records carrying another customer's title (`crocs` titled "BIG W") — sized, not fixed.

## Reference files

```
~/.claude/plans/then-what-the-hell-zippy-squid.md   THE PLAN — read first
docs/70-enrichment/LIGHT-2026-08-08-selection-quality.md   full diagnosis + every measurement
docs/70-enrichment/reports/review-pack-verdicts-filled1.md, filled2.md   Arijit's review
docs/70-enrichment/reports/REVIEW-v12-english.md    current review pack
docs/80-documentation/enrichment/chapter-3-build-log.md   the 12 earlier bugs
```

## Constraints that will bite you

- **Absolute paths.** See Resume action.
- **`certifi` cannot reach the Algolia API from this machine** (corporate TLS interception). Every
  script uses curl via subprocess. `urllib`/`requests` dies at record 1.
- **A filter on a non-faceted attribute returns EMPTY, not an error.** Browse and filter client-side.
- **glm-5.2 charges reasoning tokens against `max_tokens`.** Keep ≥4000. Same trap on gemini-2.5-pro.
- **`abstract_enriched` is several spans joined by a space** — verify via `enrichment_span_offsets`,
  never by locating the joined string.
- **The eval's noise floor is ±2 PASS records.** Measured from two same-config runs. Do not report a
  smaller delta as a finding — four such reports this session were noise, and two decisions were
  reversed on them.
- **A page changed since enrichment is STALE, not failed.**
- **No sampling. Full census.** Do not tick an Asana checkbox. Repo is **PUBLIC**.

## Files written this session

```
docs/70-enrichment/  candidates.py  span_gate.py  enrich_run.py  fetch_router.py
                     boilerplate.py  make_batches.py  run_batches.py  .gitignore
                     prompts/shape-families.json  boilerplate-map.json
                     tests/  test_candidates.py  test_boilerplate.py  test_batching_and_retry.py
                     LIGHT-2026-08-08-selection-quality.md
                     snapshots/Algolia_Prod_Copy_Enhanced-20260808-125143.jsonl
                     reports/REVIEW-v12-english.md  (REVIEW-english.md deleted — superseded)
vault  Projects/Search-First-Algolia-com/{index,log,tasks}.md · wiki/hot.md · wiki/log.md
       Projects/AI-OS/My-Projects.md
memory 4 new: fifty-record-ab-is-below-the-noise-floor · structure-destroyed-upstream-cannot-be-
       fixed-downstream · monolingual-regex-on-multilingual-corpus · unknown-writer-on-the-live-index
       · enrichment-field-not-in-searchable-attributes  + MEMORY.md + session_pointer.md
commits e8c6379 · 41e1926 · bcfdff0
```
