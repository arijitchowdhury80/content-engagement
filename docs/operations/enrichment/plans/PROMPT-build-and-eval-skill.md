# Goal prompt: build `algolia-corpus-enrichment` with skill-creator, then eval and self-correct

Paste everything below the line as a single goal. It is self-contained — do not summarise it.

---

## Goal

Use `skill-creator` to build the `algolia-corpus-enrichment` skill, then run the eval loop
defined here, fix what fails, and repeat until the exit criteria are met or a stop condition
fires. Report the result with real command output.

**You are building software, not prose.** The skill is one CLI over an internal Python
package. The LLM is called for exactly two things: the writer selecting candidate IDs, and
the judge scoring quality. Everything else — fetch, canonicalisation, candidate slicing,
grounding, repair, validation, payload building, write control, live verification — is
deterministic Python that must be identically reproducible on a re-run.

## Read first, in this order. Do not re-derive any of it.

1. `docs/70-enrichment/PLAN-skill-algolia-corpus-enrichment.md` — the build spec. Sections
   that are binding: *Arijit's Scope Correction For v0*, *Script Promotion Audit* (the
   measured carry list), *Command Contracts*, *Command Test Requirements*, *Enforcement
   Primitives*, *Body Source*, *Strategy Dispatch*, *Grounding Contract*, *Writer And Judge
   Contract*, *Source Profiles*, *v0 Definition of Done*, *SKILL.md Contract*.
2. `docs/70-enrichment/REVIEW-v3-recommendations-for-codex.md` — the reasoning behind the
   constraints. Read when a constraint looks arbitrary; it is not.
3. `CLAUDE.md` — project hard constraints. **Note it is stale on one point:** it says the
   enriched fields are not searchable. They are. Verified 2026-08-10.

## Already true. Do not redo, do not re-verify from scratch.

```text
source index    Algolia_Prod_Copy_Enhanced            11,928 records
target index    Algolia_Prod_Copy_Enhanced_Parallel   created, 0 records,
                settings copied from source, both enriched fields searchable
Scout           https://scout.chowmes.com  (hosted VPS, NOT localhost:8421)
                key SCOUT_HOSTED_API_KEY in .env.local
                body at result.scrape.markdown; served URL at result.scrape.final_url
inference       ALGOLIA_INFERENCE_BASE_URL in .env.local
                large/xlarge -> glm-5.2 (WRITER)   small -> gemma-4-26b-a4b-nvfp4 (JUDGE)
                medium -> gemma-4-31b-it-nvfp4     assert on the SERVED string, not the tier
case-study      237 records | en 83, de 78, fr 76 | 226 usable
                9 return 404 while the index says is404:False
                2 return 200 but redirect: /customers/bringmeister -> /customers,
                                           /customers/kingarthur   -> /customer-hub
documentation   4,337 across 12 real doc-* page_types; 3 profile groups already written
scout cache     docs/70-enrichment/cache-scout/  9,579 bodies, 243 MB
already built   docs/70-enrichment/skill/algolia_enrichment/{__init__,errors,state,lock,
                artifacts}.py  + skill/tests/  -> 16 tests passing. Extend, do not rewrite.
already fixed   candidates.py `_SENT_END` now Unicode-uppercase aware (was ASCII-only)
```

## Hard constraints — violating any one is a failed build

1. Scout is the only page-body source. No `curl`, no `WebFetch`, no `.md` twin, no fallback.
2. The writer returns **candidate IDs only**. A model that returns prose is a hard failure,
   not something to parse around.
3. Every stored string is resolved from source offsets and then **re-located in the source
   body without trusting the offsets**. Both checks, always.
4. Repair extends or reselects contiguous source text only. Never add punctuation, a
   connector, or a bridging word. That is fabrication.
5. Exactly three fields may be written: `objectID`, `abstract_enriched`,
   `keyhighlights_enriched`. No provenance, no metadata, no verdicts, no offsets.
6. Never write to `Algolia_Prod_Copy_Enhanced`. Never copy, rename, swap, or merge an index.
7. No command prints PASS after checking zero records or zero spans. Zero work is failure.
8. All output lands under `docs/70-enrichment/runs/<run-id>/`. Nothing loose in the repo.
9. One canonicalisation function, in `canonical.py`, shared by candidate slicing, repair,
   validation and live verification. Two implementations is the defect that caused both
   Blog grounding failures.
10. `enrich` must be structurally unable to run against a cache that `fetch` did not produce
    in the same run folder. Today fetch and enrich are two programs joined by a human;
    `bodysource.py` is where they join.

## Build order — do not reorder

1. CLI skeleton + command registry. Extend the existing `state/lock/artifacts/errors`
   modules; add `ledger.py` and `approvals.py`.
2. `canonical.py` — extract `canonicalise()` out of `span_gate.py`. Property tests:
   idempotence, and no branch divergence between the markdown-link path and the plain path.
3. `bodysource.py` — `BodySource` protocol, `ScoutRefetch` implementation. Served-URL
   identity asserted, never the status code.
4. Profiles: YAML loader, `base.yaml`, `Customer-Stories__case-study.yaml`,
   the three Documentation profiles, `profile-lint`.
5. Read-only commands: `census`, `plan-slice`, `corpus-status`.
6. `validate/` split into `grounding.py`, `quality.py`, `payload.py`, `live.py`. Never one
   god-object.
7. Approval parser + **all 17 refusal tests, before any write command exists**.
8. `fetch`, `enrich`, `repair`, `build-final`, `review-pack`.
9. `dry-run-write`, `apply-write`, `verify-live`, `prepare-target-index`.
10. `SKILL.md` per the plan's SKILL.md Contract.

Carry the 15 files named in the plan's Script Promotion Audit. Do not copy the other 25.
`enrich_run.py` and `span_gate.py` are **split**, never copied whole — they contain the
known dead gate paths.

## Eval — four gates, run in order, all must pass

Run these as literal commands and paste real output. A gate with no output is a failed gate.

**Gate 1 — unit and refusal tests**
```bash
cd docs/70-enrichment && python3 -m pytest skill/tests -q
cd docs/70-enrichment && python3 -m pytest tests -q     # must stay 472 passed, 1 xfailed
```
Pass: skill tests all green; the pre-existing 472 unchanged. A drop means the promotion lost
something. All 17 commands have a passing refusal test.

**Gate 2 — independent grounding re-verification**

Write a grounding checker that shares **no code** with `validate/grounding.py`. Run it over
the existing Blog enrichment against `cache-scout/`.
```
Pass: reproduces 21,790 / 21,790 spans located.
Fail: report the exact delta. That number is more important than the build.
```

**Gate 3 — target-index write-path smoke, 10 Blog records**
```
prepare-target-index -> dry-run-write -> apply-write -> verify-live
```
Pass, all five:
- payload contains only the three allowed fields
- every stored string re-locates in its Scout body
- live values on the target byte-match the approved payload
- a query for enriched-only text returns > 0 hits on the target index
- `Algolia_Prod_Copy_Enhanced` record count is still 11,928 and its settings are unchanged

**Gate 4 — de/fr smoke, 10 case studies (4 de, 4 fr, 2 en)**

Full pipeline, every command. Pass:
- all 10 grounded, all 10 written to the target index and verified live
- candidate counts and span-length distributions compared across en/de/fr and reported

**A systematic skew by language is a defect, not a curiosity.** 65% of the case-study slice
is de/fr and that path has never run. One monolingual defect was already found by
inspection; assume siblings.

## Autonomous loop

```
for iteration in 1..5:
    run Gate 1 -> 2 -> 3 -> 4, stopping at the first failure
    if all pass: exit SUCCESS
    diagnose the root cause, not the symptom
    fix the class: if a gate is wrong for one profile, ask whether it is wrong for all
    append to runs/<run-id>/eval-log.md: iteration, gate, failure, root cause, fix, result
    re-run from Gate 1 (never resume mid-sequence — an earlier gate may have regressed)
exit FAILED_MAX_ITERATIONS
```

**Stop immediately and report, do not iterate, if any of these occur:**
- any write is attempted against `Algolia_Prod_Copy_Enhanced`
- `Algolia_Prod_Copy_Enhanced` record count is not 11,928
- Gate 2 does not reproduce 21,790/21,790 — this invalidates the promotion premise and is a
  decision for Arijit, not something to fix in a loop
- the same gate fails twice with the same root cause — you are patching a symptom
- Scout returns empty bodies on 3 consecutive jobs — the service is degraded, not the code
- you are about to weaken a gate, a threshold, or a test to make something pass

That last one is the important one. **Never make a test pass by lowering the bar.** If a
gate is genuinely wrong, say so in the eval log with evidence and stop.

## Success is exactly this

1. All four gates green, with pasted output.
2. `Algolia_Prod_Copy_Enhanced`: 11,928 records, settings unchanged.
3. `Algolia_Prod_Copy_Enhanced_Parallel`: exactly the smoke records, each verified live.
4. Every file written lives under `runs/<run-id>/` or the skill package. Nothing loose.
5. `runs/<run-id>/eval-log.md` records every iteration, including the ones that failed.
6. `SKILL.md` exists and routes a fresh agent to the CLI and away from the 25 dropped scripts.

## Report format

```
GATE 1  PASS/FAIL   <real output>
GATE 2  PASS/FAIL   <n>/<n> spans located
GATE 3  PASS/FAIL   <records written, live-verified, enriched-only query hits>
GATE 4  PASS/FAIL   <per-language candidate counts and span-length distributions>

iterations used      : n of 5
source index         : <count> records, settings <unchanged/CHANGED>
target index         : <count> records
files outside runs/  : <list, must be empty>
what I could not do  : <explicit, or "nothing">
```

Report failures as failures. A partial pass is a number, never a completion word. If you
skipped something, say which and why — that is a better outcome than a false green.
