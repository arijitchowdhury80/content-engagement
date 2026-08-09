# /goal — Enrich the Algolia corpus. Loop until done. Do not stop at "the pipeline works."

## THE GOAL

**Every enrichable record in `Algolia_Prod_Copy_Enhanced` carries a verified abstract, live, and
Arijit has signed it off.**

Not "the pipeline is built." Not "the pilot looks good." Not "we're ready to run." Those have all
been claimed already and none of them is this.

## DEFINITION OF DONE — all six, or not done

| # | Condition | How it is proved |
|---|---|---|
| 1 | **All 10,198 enrichable records attempted.** Every one has either an abstract or an honest THIN/DEAD verdict. Arijit: *"I need every single record to be enriched."* | count rows across `batches-out/*/results.jsonl` == 10,198 distinct objectIDs |
| 2 | **Written to the live index**, add-only, record count unchanged | `write_enrichment.py --apply --yes` post-write read-back passes |
| 3 | **Zero invention at scale** | `verify_written.py` re-fetches every page, re-locates every span → **0 not found** |
| 4 | **`abstract_enriched` in `searchableAttributes`** — without this the whole run changes zero search results | read settings live, confirm the field is present, run a query that matches only enriched text |
| 5 | **Arijit signs off a review pack from the REAL run**, stratified across families, not English-only, not a pilot | his verdicts recorded in a file |
| 6 | **Committed**, with the live index named as the verified surface | commit hash + a live query quoted in the report |

**Any of 1–6 unmet ⇒ not done. Keep going.**

## HARD RULES — violating one of these is worse than being slow

1. **A red gate stops you. Only Arijit reopens it.** The Phase 1 calibration gate is ≥60%. It
   failed at 42%, and the last session started the next phase anyway on the word "continue".
   *"Continue" is not authorisation to cross a red gate. Neither is a blocker being removed.*
2. **Before every phase transition, state what is about to happen and get an explicit yes for
   THAT.** Name the phase, the records affected, and whether it is reversible.
3. **Never report a delta smaller than the noise floor as a finding.** Measured: **±2 PASS records
   out of 50, ±0.06 coherence**, from two identical runs. Four deltas inside that band were
   reported as findings last session and two decisions were reversed on them. If you want to
   compare configs, either use a sample large enough to resolve the effect or use a deterministic
   check instead of a judge score.
4. **When output looks bad, print the exact input the model received before theorising.** Three
   times in one day the diagnosis was "the model chooses badly" and three times the cause was a
   script parameter calibrated for a different input shape.
5. **Absolute paths in every command.** Chained `cd` broke three commands silently, one of which
   meant a calibration run never started.
6. **Nothing is done because a subagent said so.** Check the artefact.
7. **Do not relax a gate to make a number pass** without saying out loud that you are changing the
   measure after seeing the measurement, and getting a yes.

## STATE AT HANDOFF

- **HALTED. Under external review.** Arijit does not trust the last session's judgement. **Do not
  start until he rules.**
- Nothing written to the live index this session. 35 records exist from a retired design.
- **167 tests pass.** Commits `e8c6379`, `41e1926`, `bcfdff0`, `81215de`.
- Phase 1 gate **FAILED at 42%**. A threshold fix is in place and **unverified** — the re-run was killed.
- ~3,400 `.md` pages cached from the aborted Phase 2.
- Snapshot `Algolia_Prod_Copy_Enhanced-20260808-125143.jsonl`, 12,036 records — the rollback floor.

## THE LOOP

```
until DONE:
    1. Read SESSION.md and this file.
    2. Is there an unresolved question for Arijit? Ask it. Wait. Do not guess.
    3. Is the Phase 1 gate green (>=60%, clean file, no duplicates)?
         no  -> diagnose the largest failure bucket, fix the CAUSE, re-run the gate. Loop.
         yes -> ask Arijit for explicit go on the next phase.
    4. Run the next phase. One phase per turn. Report the real number.
    5. Re-check the six done conditions. Any unmet -> loop.
```

**Stop conditions that are NOT done:** tests pass · a pilot scores well · the plan is written ·
the code is committed · "ready to run."

**Stop conditions that ARE valid:** all six met · or Arijit halts it · or the same fix has failed
three times, in which case stop and say so rather than trying a fourth.

## WHAT WILL PROBABLY GO WRONG

- **`reference` family, 4,392 records, 43% of the corpus.** Arijit's review: 3 of 3 bad. The gate
  fails on it. Expect to fix this properly, not to tune a threshold past it.
- **Non-sentence facts** (event dates, prices, versions) are structurally unreachable — candidates
  are sentences with a 25-char floor. Needs a design change.
- **Gemini 429s at 8 workers.** The retry layer exists but has never run under real concurrency.
- **An unknown writer is touching the live index.** It can collide with a 7,750-record write.

## FILES

```
plan      ~/.claude/plans/then-what-the-hell-zippy-squid.md
review    docs/70-enrichment/EXTERNAL-REVIEW-PROMPT.md
state     SESSION.md
gate      docs/70-enrichment/batches-out/doc-md-twin-reference-001/results.jsonl
baselines docs/70-enrichment/reports/fresh50-run1|run2 (noise floor), fresh50-v12 (best)
human     docs/70-enrichment/reports/review-pack-verdicts-filled1|2.md
code      docs/70-enrichment/{candidates,span_gate,enrich_run,fetch_router,make_batches,run_batches,write_enrichment,verify_written}.py
tests     cd <repo> && python3 -m pytest docs/70-enrichment/tests/ -q
```
