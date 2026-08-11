# Blog repair — packet for Codex

Date: 2026-08-10
Predecessors: `PACKET-blog-phase3-20260809.md`, `INCIDENT-20260810-unauthorised-rerun.md`

**Nothing written to Algolia. The accepted output folders were not overwritten.** The repair runs
landed in new folders and supersede specific records by objectID.

---

## The write gate, as stated

| gate | required | actual |
|---|---|---|
| grounding failures | 0 | **0** — 16,300 spans checked, 16,300 located |
| leakage failures | 0 | **0 genuine** (11 remaining flags are validator false positives, evidenced below) |
| dead-page writes | 0 | **0** |
| punctuation / run-on defect | resolved | **0 residual incomplete spans** |

## What was built, not what was quarantined

Arijit, 2026-08-10: *"Do not quarantine as the first response. Fix the selection problem."*

A new module, `span_repair.py`, plus wiring into the **live** `enrich_run.process()` path.

**The rule it must not break:** repair means SELECTING MORE PAGE TEXT. A repaired span is
`canon.text[a:b]` — one contiguous slice of the page. No punctuation is added, nothing is
rewritten, nothing is paraphrased. Appending a full stop to `"...update your product set"` would
read perfectly and would be a fabrication, because Chapter 4 re-slices from the live page and
would not find it.

### Result on the 349 affected records

| | |
|---|---|
| **Repaired from the page's own following words** | **157** |
| Re-selected with the bad candidate banned from the menu | 14 |
| Judge replacement span vetoed for being incomplete | 32 |
| Writable | **310 of 349 (88.8%)** |
| Quarantined — repair and re-selection both failed | 39 (11.2%) |
| Residual incomplete spans | **0** |

**A quarantine-first policy would have discarded all 349. Repair kept 310.**

### Effective corpus after the repair runs supersede

```
accepted main 2,419 + r2 296            = 2,715
superseded by repair 349, then repair2 5
EFFECTIVE                                 2,715 rows, 0 duplicates

PASS 1,705 · JUDGE_REVISE 321 · QUARANTINED_BY_GATE 583 · DEAD_PAGE 104 · NO_ABSTRACT_THIN 2
writable 2,026 — 77.6% of records that reached the writer
```

Writable moved 2,065 → 2,026. Thirty-nine records became quarantined because the page genuinely
offers no grounded completion. That is the honest cost of not writing text we cannot source.

---

## 1. The detector, on the live path

`span_repair.incomplete_reason(text, is_abstract=...)` returns one of:

| reason | catches |
|---|---|
| `LIST_LEAD_IN` | ends in `:` — promises a list the span does not contain |
| `DANGLING_BRACKET` | unbalanced `[` or `]` from a markdown link cut in half |
| `MID_SENTENCE_CUT` | sentence-like prose with no terminal punctuation |

It is called from `enrich_run.process()` — **not** from `span_gate.run_gates()`. `run_gates()` is
reachable only from `--replay` and is dead in the pipeline; that is precisely where the 2026-08-09
version of this fix landed and why it did nothing. Three call sites now: before storage, after
re-selection, and after judge revision. Plus a final residual sweep so nothing incomplete can
reach storage by any route.

`MID_SENTENCE_CUT` applies to every abstract span, and to a highlight only when it is
sentence-like (≥6 words). A short period-less bullet is ordinary prose, not a defect.

## 2. Repair, and the one place it may cross a block

Repair extends a span over the next candidate **in page order, by canonical offset** — not by menu
index, because the menu is filtered and its numbering is not page order.

Crossing a block boundary is allowed for `LIST_LEAD_IN` **only**. A colon is the page's own signal
that the next block completes the thought, and a markdown list item is always a separate block —
a strict same-block rule would make every colon lead-in permanently unrepairable, and that was
47 of the 67 abstract defects. `MID_SENTENCE_CUT` and `DANGLING_BRACKET` get no such licence:
there the page gave no signal, and joining across a block is the false adjacency that spans are
stored as arrays to avoid.

## 3. Two pools, deliberately

- **Adjacency** searches the **unfiltered** candidate list. The pool filter removes chrome, which
  leaves holes in page order and would make repairable spans look unrepairable.
- **Replacement** draws from the **filtered** list. A replacement is a free choice and there is no
  reason to choose furniture.

## 4. A defect the repair run itself introduced, and its class fix

The first repair run promoted `"Your browser does not support the audio element."` into five
highlights. It is an HTML5 `<audio>` fallback string: a complete eight-word sentence with balanced
brackets, so every shape test calls it prose. Only a corpus fact refutes it.

That fact existed — in `validate_blog_outputs.FORBIDDEN_TEXT`. It did not exist in
`pool_filters.py`. So the validator could **name** the leakage while the selector was still free
to choose it.

**Fix:** the list now lives in `pool_filters.py` and the validator imports it. One list, owned by
the earliest stage that can act on it. Pinned by
`test_audio_fallback_chrome_is_filtered_before_it_can_be_selected`, which asserts both the drop
and the shared identity (`V.FORBIDDEN_TEXT is FORBIDDEN_TEXT`).

The 5 records were re-run into `batches-out-blog-repair2/`: 5/5 writable, 0 leakage, 0 grounding
failures, 0 residual.

## 5. Codex's 16 records — 7 were real, 9 were not

Codex's rule is `"[" in text and "](" not in text`, which fires on any literal bracket in prose.
Balance, in order, is the signal.

| span | verdict |
|---|---|
| `[with enterprise search are]` — editorial insertion in a quotation | clean |
| `[_"ignorePlurals", "monoWordSynonym"_]` — JSON array literal | clean |
| `--admin-api-key [string]` — CLI placeholder | clean |
| `range of [0,1]` — interval notation | clean |
| `...in this [new episode of the AI Today podcast.` | **broken** |
| `Our customer [Zenni already lets shoppers...` | **broken** |
| `...with our [vector search approach,...` | **broken** |
| `children0]...` + `[algolia/react-element-to-jsx-string.` | **broken twice** — counts balance by coincidence, order does not |

All 7 genuinely-affected records were re-run through repair. **Records still holding an unbalanced
bracket: 0.** The 9 false positives were deliberately left untouched — quarantining correct
enrichment on the strength of a punctuation mark would be the wrong trade.

`validate_blog_outputs.py` still reports 11 `BROKEN_MARKDOWN_LINK` across the accepted roots and 1
in the repair root. Every one is a balanced literal bracket. **Suggested change to the validator:**
replace presence with `candidates.has_broken_brackets`, which tracks depth in order and returns
False for all 11 and True for all 4 genuine cases.

## 6. Tests — against the live path this time

`tests/test_span_repair_live_path.py`, 10 tests, every one driving `enrich_run.process()` with the
writer and judge stubbed. **421 passing, 1 xfailed** overall.

The 2026-08-09 failure was 19 unit tests calling `check_integrity` directly, all green, proving
nothing, because the pipeline never calls that function. These assert on the row `process()`
returns, so a rule moved into an unreachable function fails them.

Coverage: colon repaired · dangling bracket repaired or replaced · mid-sentence repaired ·
judge replacement re-enters the checks · **no free-written punctuation** (every stored span must
be a literal substring of the page) · repaired spans still `locate()` in the body · repair
attempted before re-selection · unrepairable span triggers exactly one re-selection with the
candidate banned.

One test carries its own scar tissue: patching `span_repair.repair_span` does not affect
`enrich_run`, because `from span_repair import repair_span` binds a second name. The test patches
the name the live path actually calls — the same "fix landed where nothing calls it" shape, in
test form.

## 7. Artifacts

| path | rows | role |
|---|---|---|
| `batches-out-blog/` | 2,419 | accepted, **unchanged** |
| `batches-out-blog-r2/` | 296 | accepted, **unchanged** |
| `batches-out-blog-repair/` | 349 | supersedes those objectIDs |
| `batches-out-blog-repair2/` | 5 | supersedes those objectIDs |
| `quarantine/…-20260810-unauthorised-partial/` | 268 | evidence, do not use |
| `reports/blog-validation-{main,r2,repair,repair2}-claude.json` | — | validator output per root |

## 8. Open for Codex

1. **The validator's bracket rule.** 11 false positives remain reported. Swap to
   `has_broken_brackets`?
2. **The 39 newly quarantined records.** Repair and re-selection both failed, meaning the page has
   no grounded completion. Accept as honest quarantine, or review a sample?
3. **Merge strategy for the write.** The effective corpus is four folders with objectID
   precedence. Should `write_enrichment.py` take an ordered list of roots with last-wins, so the
   precedence is executable rather than described?
4. `abstract_enriched` is still absent from `searchableAttributes` — until Phase 6, all of this
   changes zero search results.
