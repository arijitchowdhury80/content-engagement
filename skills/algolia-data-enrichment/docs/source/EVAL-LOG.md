# Eval log — building `algolia-corpus-enrichment`

Every iteration, including the ones that failed. Four failures happened; three were defects in
things written during this build, one was a gate whose assertion was wrong. None was fixed by
lowering a bar.

Run ids used:
- `20260810-skillbuild-a01` — this log and the Gate 2 probe
- `20260810-blog-blog-post-a01` — Gate 3, write-path smoke, 10 Blog records
- `20260810-customer-stories-case-study-a01` — Gate 4, de/fr smoke, 4 de + 4 fr + 2 en

---

## Iteration 1

### Gate 1 — PASS

`skill/tests` 160 passed. `tests` 472 passed, 1 xfailed — unchanged from the pre-existing
baseline, so the promotion lost nothing. All 17 v0 commands have a refusal test that enters
through `algolia_enrich.main()` and asserts the process exit code.

Two defects were found *by writing the tests*, before any gate ran:

| # | defect | root cause | fix |
|---|---|---|---|
| 1a | `RunCache.load()` accepted a body whose `fetcher` said `CurlByHand` | the provenance check filtered the body list on `fetcher == "ScoutRefetch"` **before** checking provenance — a body was excluded from the check by the same lie the check exists to catch | check every body against the source the **fetch manifest** declares, which is written by `fetch` and is independent of what the body claims about itself |
| 1b | every record in the enrich tests came back `DEAD_PAGE` | the test fixture body was 779 chars against the case-study profile's 900-char floor | lengthened the fixture. **The profile was correct** — it was the fixture that was lying about being a page |

### Gate 2 — FAIL, 17,302 / 21,790

Delta 4,488. **Not reported as a corpus finding**, because the first two failures inspected were
spans containing markdown links, which pointed at the checker rather than the corpus.

- **Root cause:** the independent checker tokenised the RAW body, so
  `[github.com/algolia/cli](https://github.com/algolia/cli)` contributed the label's tokens
  *followed by the target URL's tokens*. The span's token run was interrupted by words no reader
  ever sees. Under-stripping, in the checker.
- **Fix:** strip link targets, bare URLs and HTML tags before tokenising. Purely subtractive.
- **Not a weakening:** the threshold stayed 21,790/21,790 and the strictness that matters — every
  word present, in order, contiguous — is untouched.

Corroborating signal noticed here and worth recording: the checker's strict `raw` mode counted
**9,597**, which is exactly the historical packet's `exact: 9597`. Two implementations agreeing
on a sub-count before agreeing on the total.

### Gate 2 — FAIL again, 21,723 / 21,790

Delta 67. Different root cause from the first failure, so the "same gate fails twice with the
same root cause" stop condition did **not** fire — this was checked deliberately, not assumed.

All 67 were fused words: `servingfrom`, `areused`, `fullycompliant`, `Asite`. Settled by reading
the raw source rather than reasoning about it. The page says:

```
...and serving**from 900K to 30M searches a month**.
```

There is no space before the bold marker, so markdown renders `servingfrom` as one word and the
stored span is faithful to what a reader sees.

- **Root cause:** the checker treated `*` as a word separator. That makes it disagree with
  markdown, not with the pipeline.
- **Fix:** delete emphasis markers before tokenising.
- **Honest caveat:** this is a rule the two implementations now share. It is markdown's rule, not
  either implementation's choice. Independence here is in the algorithm — a one-pass regex strip
  plus word-token subsequence matching, versus a character walk carrying an offset map — not in
  inventing different semantics for the source format.

### Gate 2 — PASS, 21,790 / 21,790

```
modes: {'raw': 9597, 'token': 12193}
```

The historical packet reported `{'canonical': 12193, 'exact': 9597}`. Two independently written
implementations reproduce not just the total but **the same partition of it**. The promotion
premise for `validate/grounding.py` holds.

### Gate 3 — blocked at `enrich`, then PASS

```
FAIL [enrich] EnrichmentError: model pinning failed:
  writer tier 'large' serves 'large', config pins 'glm-5.2'
  judge tier 'small' serves 'small', config pins 'gemma-4-26b-a4b-nvfp4'
```

The gate fired correctly — it refused to run against models it could not identify — but for the
wrong reason.

- **Root cause:** `/models` returns the served string in `served_model`, and the parser guessed at
  `root` / `served_model_name` / `metadata.model`. The real defect was the fallback: it ended
  `out[alias] = served or alias`. Had the field merely been renamed, every tier would have
  resolved to its own alias and the pin would have compared `"large" == "large"` — **passing
  while proving nothing about which model graded the corpus.** A vacuous assertion that reads
  exactly like a real one.
- **Fix:** read `served_model`, and **remove the fallback entirely**. A tier with no served model
  is omitted and then refused by name. Regression test added
  (`test_a_tier_with_no_served_model_is_refused_not_silently_accepted`).

After the fix: 10 fetched, 10 enriched `PASS`, 80/80 spans grounded, 10 written, 10 byte-matched
live, 5 enriched-only probes returning hits, source index 11,928 and settings unchanged.

### Gate 4 — FAIL at `verify-live`, `extra=10`

Evidence gathered before touching anything: the 10 "extra" records were **exactly** the Gate 3
Blog manifest, and the set of target records planned by *no* run was empty.

- **Root cause:** the check compared the whole target index against **one run's** manifest. The
  target index accumulates slices by design, so every previously written slice reads as
  contamination. The assertion was wrong, not the behaviour.
- **Fix:** compare against the union of **every** run's manifest — "no record in the target index
  was planned by no run."
- **Is this a weakening?** Stated plainly so it can be judged rather than taken on trust: the new
  assertion checks *more* records than the old one (all of them, not just this run's) and still
  fires on the case the check exists for — a record no run of this skill ever planned, which is
  how an unknown writer would appear. Two regression tests pin both halves:
  `test_a_previous_slice_in_the_target_is_not_contamination` and
  `test_a_record_no_run_planned_is_still_caught`. If Arijit reads this differently, the check is
  one line and reverting it costs nothing.

---

## Iteration 2 — full re-run from Gate 1

Code changed in iteration 1 (`model_io.py`, `validate/live.py`, `algolia_enrich.py`), so the
sequence was re-run from the top rather than resumed.

| gate | result |
|---|---|
| 1 | PASS — 163 skill tests (3 added in iteration 1), 472 passed + 1 xfailed unchanged |
| 2 | PASS — 21,790 / 21,790 |
| 3 | PASS — 80/80 grounded, 10/10 byte-match live, source 11,928 unchanged |
| 4 | PASS — 78/78 grounded, 10/10 byte-match live, 0 extra, source 11,928 unchanged |

**Deviation from the loop, stated rather than hidden:** the loop specifies re-running from Gate 1
after *each* failure. Within iteration 1 the failures were fixed forward and the sequence
continued; the complete re-run happened once, as iteration 2. The end state is the same — every
gate green against the final code — but the intermediate gates in iteration 1 were not each
re-run against every later fix.

Gates 3 and 4 in iteration 2 were re-run as `validate` + `verify-live` against the live surfaces,
not re-fetched and re-written. Those two commands are what the gates actually assert, and they
exercise all three changed modules. Re-fetching 20 pages to rewrite identical records would have
cost Scout jobs without checking anything new.

---

## Stop conditions — all checked, none fired

| condition | status |
|---|---|
| a write attempted against the source index | never; `assert_write_target` refuses structurally and two tests pin it |
| source index record count ≠ 11,928 | 11,928 before and after every write, asserted by the runner itself |
| Gate 2 not reproducing 21,790/21,790 | it reproduces, and the mode partition matches too |
| same gate failing twice with the same root cause | Gate 2 failed twice with **different** root causes (link targets, then emphasis markers); explicitly checked before continuing |
| Scout empty on 3 consecutive jobs | 21 of 21 real jobs returned bodies (1 health + 10 Blog + 10 case-study) |
| about to weaken a gate, threshold or test | the Gate 4 change is the only candidate and is argued above with evidence rather than asserted |

## The number that is not green

Every gate passes, and **none of them measures whether the abstracts are worth having.** Blog's
own record is that the judge asked for a revision on 56% of abstracts while grounding was
flawless. Grounding is a guarantee; selection quality is a judgement, and 20 records is far below
the ±2-PASS noise band measured on this corpus at n=50. The review packs in both run folders are
the artifact for that question and it is a human's to answer.
