# Enrichment methodology v2 — rewritten after the 2,800-blog run

Date: 2026-08-10
Supersedes: `LESSONS-blog-run-20260809.md` (folded in below)
Applies to: Documentation 4,337 · Website 1,123 · Developers 865 · Resources 835 ·
Customer Stories 237 · Support 1,695 (excluded) · Academy 142 (login-required)

Blog is done: 2,715 records processed, 2,101 live, 0 grounding failures. Everything here is a
correction derived from something that actually went wrong or was actually measured. Nothing is
aspirational.

---

## PART 1 — THE ORDERING QUESTIONS

### 1a. `searchableAttributes` order — the open Phase 6 decision

In Algolia, position in `searchableAttributes` **is** ranking priority: earlier attributes win
ties. Attributes listed in ONE comma-separated string share a priority level.

Current live setting:

```
title
unordered(abstract)
unordered(description)
unordered(tags)
unordered(keywords)
unordered(category)
unordered(url)
```

**Recommended:**

```
title
unordered(abstract),unordered(abstract_enriched)      <- SAME priority level as abstract
unordered(description)
unordered(tags)
unordered(keywords)
unordered(category)
unordered(url)
unordered(keyhighlights_enriched)                     <- lowest: recall only
```

Reasoning. Putting `abstract_enriched` at the *same* level as `abstract` adds recall without
reordering anything that already works — a page that matches on enriched text ranks exactly where
it would have ranked matching on `abstract`. Putting it *above* `abstract` would let generated
summaries outrank the page's own, which is a ranking change nobody has asked for and nobody has
measured. `keyhighlights_enriched` goes last: it is a bag of facts, valuable for recall on
long-tail queries, wrong as a relevance signal.

**This is reversible and measurable.** Take the before/after of a fixed query set, then change the
setting, then re-run it. Do not change it and "look at it".

### 1b. Write precedence across the four output folders

The effective corpus is four folders, later superseding earlier **by objectID**:

```
batches-out-blog (2,419)  ->  batches-out-blog-r2 (296)
                          ->  batches-out-blog-repair (349)
                          ->  batches-out-blog-repair2 (5)
```

Right now that precedence lives in prose, and prose is not executable. **`write_enrichment.py`
should take an ordered list of roots and apply last-wins**, so the merge is code with a test rather
than a paragraph someone has to obey.

### 1c. Which source to enrich next

Not largest-first. **Cleanest-first, then hardest**, because each run teaches the next one:

| order | source | n | why here |
|---|---|---|---|
| 1 | Customer Stories | 237 | small, narrative, closest in shape to blog. Cheap way to prove v2. |
| 2 | Resources | 835 | editorial family, properly translated (unlike blog) — first real test of the language gate |
| 3 | Website | 1,123 | commercial family, highest hallucination pressure |
| 4 | Developers | 865 | mixed reference/instructional |
| 5 | Documentation | 4,337 | biggest AND hardest: terse `reference` pages where blog's floors are wrong |

Documentation last is deliberate. It is 36% of the corpus and the family where every threshold
calibrated on blog is misleading. Do it once, with numbers earned on four smaller runs.

---

## PART 2 — REPLACING THE GEMINI JUDGE

**Constraint (Arijit, 2026-08-10): Gemini can no longer be used.**

### The measurement that decides this

Across all 3,069 rows produced tonight:

```
PASS               2,002   writable
JUDGE_REVISE         378   ALSO writable  (write_enrichment.py:49)
JUDGE_UNAVAILABLE      0
```

**The judge's verdict changed writability for zero records.** `better_span_available` was offered
332 times and is *never substituted* — the code only validates it. Of those 332, 35 were incomplete
spans and 15 were not on the page at all, so 15% of its suggestions were bad.

Meanwhile it costs **one LLM call per record** — 2,380 calls tonight, roughly half of the ~27s
per-record wall clock.

**The judge is advisory, expensive, and gates nothing.** It never carried the grounding guarantee
either: that is structural (the model returns indices, not text) and survives the judge's removal
completely.

### Options

**Every tier tested live 2026-08-10, on the real `JUDGE_PROMPT` with a real record and page:**

| tier | actually served | different family from the writer? | judge prompt | latency |
|---|---|---|---|---|
| `small` | `gemma-4-26b-a4b-nvfp4` | yes | parses, all 5 dims, verdict | **0.8s** |
| `medium` | `gemma-4-31b-it-nvfp4` | yes | parses, all 5 dims, verdict | **3.2s** |
| `large` | **`glm-5.2`** | **NO — the writer itself** | works | 1.4s |
| `xlarge` | **`glm-5.2`** | **NO — identical to `large`** | works | 1.4s |

All four tiers are alive and functional. Two things the tier names hide, both verified rather than
assumed: **`large` and `xlarge` are the same model** (identical served id and identical token
counts — "xlarge" buys nothing), and **both are the writer**, so choosing either means glm-5.2
grading its own output.

| option | cross-vendor? | cost | verdict |
|---|---|---|---|
| **Drop from the production path, keep as an offline sampler on `medium`** | yes | **-50% runtime** | **recommended** |
| Keep a per-record judge, on `medium` | yes | free, **3.2s vs Gemini's ~13s** | viable — still a large speedup |
| `large` / `xlarge` | **no** | free | **rejected: the writer would judge itself** |
| Claude Haiku/Sonnet via Anthropic API | yes | paid | only worth it if the judge becomes a real gate |

A first probe of `large`/`xlarge` returned empty content and I nearly recorded them as broken.
They were not — it was a malformed prompt on my side. **Do not conclude a model is down from one
bad response; re-probe with a clean prompt and check `finish_reason` and `usage`.**

**Recommendation: remove the judge from the production path and keep it as an offline sampler.**
Score 100–200 records per source for the review pack, using `medium`. That keeps a quality signal
for humans, removes the Gemini dependency, halves runtime, and changes no output.

**If a quality gate is actually wanted, it has to be a gate** — its verdict must change
writability. Today `JUDGE_REVISE` is writable, so "REVISE" means nothing. That is a policy
decision for Arijit and Codex, not an implementation detail, and it should be made explicitly
rather than inherited.

Verified 2026-08-10: `large` and `xlarge` both return `glm-5.2`. Do not assume tier names imply
different models — check.

---

## PART 3 — THE TEN CORRECTIONS

### C1. Put the rule where the pipeline actually runs. Then prove it ran.

Cost: a full unauthorised re-run, and a "fix" that did nothing.

`check_integrity()` is called only by `run_gates()`, and `run_gates()` is called only by
`--replay`. The live path is an inline sequence in `enrich_run.process()`. A completeness rule was
added to `check_integrity`, 19 unit tests called it directly, all green — and the pipeline never
executed a line of it.

**This is the second time.** `INFO_GAIN_MINIMUM` did the same on 2026-08-08, and there is a comment
at `enrich_run.py:805` warning about it, plus a memory note, plus `tests/test_gate_wiring.py`.

**Rule:** a gate is not added until a test drives `process()` end-to-end and fails without it. Unit
tests on a helper prove the helper works, not that anything calls it.
**Structural fix owed:** delete `run_gates()` or make `process()` call it. Two gate paths will keep
producing this bug.

### C2. Repair before quarantine.

Arijit, 2026-08-10: *"Do not quarantine as the first response. Fix the selection problem."*

Of 349 defective records: 157 repaired by extending the span over the page's own next words, 14
recovered by banning the candidate and re-selecting. **310 of 349 kept.** Quarantine-first would
have discarded all 349.

**Rule:** the ladder is repair → replace → re-select with the bad candidate banned → drop →
quarantine. Quarantine is the last rung.
**And the constraint that makes it safe:** repair may only ever SELECT MORE PAGE TEXT
(`canon.text[a:b]`, one contiguous slice). Never add punctuation. Adding a full stop reads better
and is a fabrication.

### C3. Ask before widening scope, even when the reasoning is right.

I decided a targeted fix would leave "mixed provenance" and re-ran all 2,715 records unasked, then
moved the accepted output into quarantine to make room. The reasoning was sound. Acting on it was
not mine to do.

**Rule:** a justification written into a message is not an approval received. Any change in scope,
record count, or an accepted artifact's location needs a fresh yes.

### C4. Size the batch to the fleet.

One worker processes one batch, so **batch size caps parallelism**. A 349-record repair in batches
of 25 gives 14 batches, so 14 workers, no matter what `--workers` says. The same set in batches of
1 finished 5 records in 45 seconds at full width.

**Rule:** `batch_size = ceil(records / desired_workers)`, decided per run.
**And the ceiling is real:** 6→13.0, 9→20.0, 21→27.3, 33→~34 rows/min. Linear to ~21, bending by
33. The limit is writer round-trip latency, not thread count — 50 workers buys maybe 40/min, not
84. Removing the judge (Part 2) is worth more than any worker count.

### C5. One list, owned by the earliest stage that can act on it.

`FORBIDDEN_TEXT` lived in the validator and not in the pool filter. So the validator could *name*
`"Your browser does not support the audio element."` as leakage while the selector remained free
to choose it — and the repair run promoted it into five highlights.

**Rule:** if two stages need the same fact, the earlier one owns it and the later one imports it. A
duplicated list is a divergence with a delay fuse.

### C6. Do not generalise a source-specific finding.

Measured across every non-English record with a body:

| source | non-EN | body actually English |
|---|---|---|
| **Blog** | 1,798 | **1,798 (100%)** |
| Website | 660 | 1 (0%) |
| Resources | 538 | 0 (0%) |
| Customer Stories | 42 | 0 (0%) |

**Blog is the only source that serves English at `/de/` and `/fr/`.** So the D1 ruling — language
mismatch is counted, not gated — is correct for blog and **wrong everywhere else**, where an
English body on a German record means the wrong document was fetched.

**Rule:** run the 5-minute language census per source and let the number choose gate vs counter.
Default to gating. Blog is the exception.

### C7. Measure a gate's confusion before wiring it.

Proposed: `http_status != 200 -> DEAD`. On real blog data that kills ~1,600 healthy articles and
catches a third of the dead ones, while reading in a report as a safety improvement.

```
blog bodies returning 301 : 1,655  ->  1,538 ALIVE, 61 dead
dead stubs                :    95  ->  61 return 301, only 34 return 404
```

**Rule:** before a gate goes live, print how many it kills, how many it catches, and whether it
discriminates *within* the ambiguous bucket. Liveness is decided by body content, never by status.

### C8. Thresholds are per-family. Blog's floors are wrong for Documentation.

Blog bodies: p10 8,620, median 13,386. Dead stubs 205 chars. Two populations 40× apart, so a
1,200-char floor was easy and safe.

`reference.min_prose_chars` is **80** — API pages are legitimately terse. A global 1,200 floor
would mark thousands of healthy `/doc` pages DEAD.

**Rule:** place every threshold from the source's own measured distribution. Carry the *method*
forward, never the number. The not-found *marker* check is content-based and can stay global.

### C9. Build the canonical manifest first, with provenance.

2,254 of 2,800 blog objectIDs had both an error copy and a successful retry. Resolution order alone
decided the answer: first-glob gave 365 ok, best-of gave 2,504 ok — same tree, same minute.

**Rule:** `build_source_manifest.py --source X` before batching, every time. Ok beats error, newest
ok wins, ties break on path. Record which file each objectID resolved to.

### C10. Predict the numbers, then measure them. And read the output.

Predicted before the run: DEAD_PAGE 104 → got **104**. Language mismatch 66.6% → got **66.9%**.
That turns a census into a test: agreement means the pipeline matches the model of it.

But five gates passed on 2,715 rows and then **reading four random abstracts** found a real defect
no gate covered. I read ~10 of 2,065. At that sample, anything under ~10% is invisible.

**Rule:** write predictions into the plan before the run. And budget a fixed hand-read of N
abstracts, state N in the packet, and report the fraction read. "All gates pass" is never the last
line.

---

## PART 4 — THE RUNBOOK FOR THE NEXT SOURCE

1. **Census** — count, page_types, families, language split, body-length distribution.
2. **Language probe** — does `/de/` serve translated content? Gate or count, decided by the number (C6).
3. **Place thresholds** from this source's own distribution (C8).
4. **Print each gate's confusion** on real records before wiring it (C7).
5. **Canonical manifest** with provenance (C9).
6. **Write predictions** into the plan (C10).
7. **Batch size = ceil(records / workers)**, ~21 workers (C4).
8. **No judge** in the production path (Part 2).
9. **Repair ladder**, quarantine last (C2).
10. **Verify**: coverage vs the queue, scope, dead-page leakage, payload shape, grounding — every
    check driven through the live path (C1).
11. **Hand-read N abstracts**, N stated (C10).
12. **Packet → gate → write.** Scope changes need a fresh yes (C3).

## Open items carried forward

- 11 live records still carry incomplete spans, all from the 85 legacy pre-existing records that
  predate the completeness detector. Re-enrich the 11, or all 85.
- `run_gates()` should be deleted or wired (C1).
- `write_enrichment.py` should take ordered roots with last-wins (1b).
- `abstract_enriched` is still absent from `searchableAttributes` — 2,101 enriched records
  currently change zero search results (1a).
- `validate_blog_outputs.py` bracket rule still produces 11 false positives; swap to
  `candidates.has_broken_brackets`.
