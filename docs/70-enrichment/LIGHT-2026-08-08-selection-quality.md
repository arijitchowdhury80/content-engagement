# LIGHT run — 2026-08-08 — Chapter 3 selection quality

Development-loop, light path. Target: SESSION.md NEXT ACTION 0, "56% of abstracts draw a judge
REVISE."

## Scope classification

**LIGHT.** Reasoning, written down rather than assumed:

| Dimension | Answer |
|---|---|
| Schema / API / external surface | No. `abstract_enriched` / `keyhighlights_enriched` are locked and unchanged. |
| New dependency | No. Stdlib `re` only. |
| Security-sensitive | No. Writes still go only through `write_enrichment.py`, unchanged, `--dry-run` default. |
| Prod write in this run | **No.** Measurement runs against the existing `cache-fresh50/` pages, free, no index write. |

**One escalation flag, and it is the reason this note has a human gate:** `candidates.py` is the
*core contract* of the zero-invention guarantee. CLAUDE.md guardrail #4 requires a fresh explicit
yes for a core-contract change. See "The decision I am not taking alone" below.

## The diagnosis, and why SESSION.md was wrong about it

SESSION.md called this "Prompt work, not safety work." Both halves of that are wrong.

It is **script work**, not prompt work. And one part of it *is* a safety issue.

`split_candidates()` in `candidates.py` canonicalises the whole page to one flat string and cuts it
only at sentence-ending punctuation. There is **no block-structure step and no chrome filter**.
Consequences, all from that one mechanism:

- A nav bar, a language switcher, a CTA row, a countdown timer and a cookie banner contain no
  sentence-ending punctuation. They therefore never get cut — they **merge into one giant chunk**.
- That chunk exceeds `MAX_CHARS = 400`, so it falls into the `else` branch and is **hard-chopped at
  an arbitrary word boundary**.
- Each chop becomes a numbered candidate that is indistinguishable, to the model, from a real
  sentence.

### Measured on the 50 cached pages, not estimated

```
pages 50   candidates 2,264
fragment-shaped (starts lowercase OR no terminal punctuation):  715 = 31.6%
```

Nearly a third of everything the model is offered cannot be a well-formed sentence. The judge's
top complaint is coherence — mean **2.88**, with **17 of 34** records scoring ≤2. That is not the
model choosing badly. It is the model choosing from a polluted menu.

### The judge's 19 REVISE notes, classified

| Class | n | What the judge saw | Where the fault is |
|---|---|---|---|
| A — chrome offered as prose | 12 | `Loslegen Demo buchen`, `CLAIM YOUR SPOT`, `Fermer`, `Merci!`, `00 TAGE 00 STUNDEN 00 Sekunden`, nav link runs, repeated page title | no chrome filter |
| B — mid-sentence fragments | 6 | `...verändern. wie...`, `the creation and Algolia's Agent Studio closes this gap`, `Within just 30 days of go-live, Crocs` | `MAX_CHARS` chopper |
| C — wrong-entity title | 3 | title says `BIG W`, page is Crocs; title says `At NRF...`, page is the World Cup post | **not this pipeline** — see below |
| D — lead sentence missed | 7 | "a much better single-sentence summary exists at the top of the page" | prompt + ordering |

Classes overlap; 19 records, 28 class hits.

### Class C, now sized: 19 live records carry another customer's title

Measured offline against `snapshots/Algolia_Prod_Copy_Enhanced-20260808-030323.jsonl` — the data
was already on disk, so this needed no API call. Detection is language-neutral and unambiguous:
one `title` shared across **different** `/customers/<slug>` pages.

| Leaked title | Customer pages wrongly carrying it |
|---|---|
| `Dress for the occasion: Oh Polly enhances customer search results…` | `bike-totaal`, `club-med`, `fern-case-study`, `gemo`, `h-e-b-mexico`, `kiko`, `leroy-merlin-brasil`, `madeiramadeira`, `orange` — 9 slugs, and **not** `oh-polly` itself |
| `Algolia helps BIG W achieve better search relevance…` | `bigw` (correct), `crocs` (wrong) |

**19 records across locale variants.** 208 true `/customers/<slug>` case studies exist, so this is
roughly 9% of the customer-story corpus mislabelled.

Two earlier detectors of mine over-counted this and I discarded both rather than report them: a
slug-token-in-title check flagged 73 records, but `hagergroup`→"Hager Group" and `nutscom`→
"Nuts.com" are spacing, and `plieger`→"Century-old wholesaler…" is a real title that simply does
not name the customer. Only the shared-title signal is sound.

This degrades demo search relevance today, independently of enrichment: a query for *Crocs* ranks a
record titled *BIG W*. **Not fixed here** — it needs a title source and a decision on where the
correction is written, which is Chapter 1/2 territory, not Chapter 3's.

### Class C is not a selection defect — do not let it be filed as one

The abstracts for those three records are correct and on-topic. The judge is objecting to the
record's **stored `title`**, which comes from the index, not from the fetched page. So this is a
pre-existing data defect in `Algolia_Prod_Copy_Enhanced`: records whose `title` describes a
different company than their `url` and body. It will be degrading demo search relevance right now,
independently of enrichment. **Logged as a separate finding, not fixed in this run** — the live
index read to size it is still outstanding (the curl in this session failed on an env-var name, not
on the data).

### The safety part

One cached page — `academy.algolia.com/training/01944bec…` — yields a candidate list made of
un-stripped HTML meta attributes and a JSON feature-flag blob:

```
[9]  my_paths":true,"academy_salesforce_sync":true,"academy_search":true,…
[2]  property='og:image' content='https://production-content.workramp.com/uploads/…
```

Every one of those is a **verbatim, offset-verified, gate-passing** slice of the page. The
guarantee holds perfectly and the output is still garbage. This is the existing memory
`verbatim-does-not-mean-truthful` reappearing at the candidate layer rather than the writer layer.
Zero-invention was never the whole job.

## The fix — three script changes, one prompt change

1. **Block-aware segmentation before sentence splitting.** Split on markdown block boundaries
   (headings, list items, link-only lines, blank-line paragraphs) *first*, then sentence-split
   within a block. A nav blob can no longer merge with prose, and a chop can no longer straddle
   two blocks.
2. **Classify each candidate, do not delete it.** Add `kind` ∈ `prose | heading | ui | nonprose`
   and `sentence_complete: bool`. Detection is deterministic: link-density, no verb-bearing
   punctuation, `key":value` / `attr='…'` shape, all-caps, timer patterns, ≤3 words per segment.
3. **Surface the classification in the menu** — `[47] [UI]`, `[48] [FRAGMENT]` — so the model can
   avoid what it currently cannot see. Numbering stays stable; nothing becomes unpickable.
4. **Prompt: prefer the lead prose block.** Class D is the only class that is genuinely prompt
   work, and it is the smallest.

**Why classify rather than exclude.** Arijit's locked constraint is *"I need every single record to
be enriched."* Deleting candidates is what the over-long-chunk comment in `candidates.py` already
warned about: an earlier version dropped long chunks, a 5,273-char page fell to 4 candidates, and
the model then correctly called it THIN. Filtering to fix coherence would re-buy that yield bug.
Labelling costs no yield: a chrome-only page keeps a full menu.

## RESULT — fresh run, 50 records, `reports/fresh50-v12/`

Two baseline runs as control, same 50 cached pages, same models, no index write.

| Judge dimension | run1 | run2 | **v1.2** | vs best baseline |
|---|---|---|---|---|
| coherence | 2.88 | 2.85 | **4.62** | **+1.74** |
| missed_substance | 3.21 | 3.00 | **4.53** | **+1.32** |
| juxtaposition | 3.82 | 3.71 | **4.65** | +0.82 |
| representativeness | 3.32 | 3.09 | **4.00** | +0.68 |
| specificity | 3.85 | 3.50 | **4.26** | +0.41 |

| Status | run1 | run2 | **v1.2** |
|---|---|---|---|
| PASS | 15 | 15 | **25** |
| JUDGE_REVISE | 19 | 19 | **9** |
| QUARANTINED_BY_GATE | 6 | 8 | 8 |
| NO_ABSTRACT_THIN | 6 | 4 | 3 |
| NO_ABSTRACT_DEAD | 4 | 4 | 5 |

Records reaching the judge: 34 in all three runs. Per record vs run1: **12 new PASS, 2 lost**.

**Every dimension improved and yield rose.** PASS 15 → 25, +67%. The trade I was braced for did
not appear: a cleaner menu produced *more* writable records, not fewer, because the old code was
losing records to incoherence, not to scarcity.

### The 2 records that stopped passing

1. `/de/blog/ai/hallucination-mitigation` → `QUARANTINED_BY_GATE`. **The gate working, not a
   regression.** G10 fired: the highlight span is followed by `"Wrong, stale, or out-of-scope"`,
   so selecting it inverts the meaning. Under the old chopped boundaries the span straddled the
   reversal and G10 could not see it. This is a correct rejection that the old menu was hiding.
2. `/fr/blog/…/spain-won-the-world-cup-and-search` → `JUDGE_REVISE`, because **the index title is
   wrong** — the Class C defect above, not a selection problem.

### The 9 remaining REVISE, classified — and none is a fragment or a CTA

| n | Class | Where the fix belongs |
|---|---|---|
| 4 | **Shared analyst/promo block.** `"Reconnue par IDC, Gartner, Forrester et Paradigm B2B…"` appears across resource pages. It is grammatical, complete, specific prose — shape-based classification is *right* to call it prose. It is simply not about the page. | **G8, corpus-wide template collision.** SESSION.md already lists G8 as "specified but not in the runner". A span appearing on many pages is boilerplate; that is exactly what G8 is for. |
| 3 | **Index title defect.** BIG W on `crocs` ×2, World Cup ×1. | Not this pipeline. The 19-record title defect above. |
| 2 | **`reference` family leads with implementation detail** and omits the API's purpose. | Prompt, `reference` family block. Genuine Class D residual. |

The original dominant classes — chrome-as-prose and mid-sentence fragments, 18 of 19 hits — do not
appear once in the remaining nine.

## The decision I am not taking alone

Labelling gets the model to *avoid* fragments. It cannot *guarantee* an abstract is well-formed.
The guaranteeing move is a hard gate — reject an abstract built from a `[FRAGMENT]` or `[UI]`
candidate — and that gate **costs yield**, which collides head-on with the locked "every single
record" constraint.

So: steps 1–4 ship in this run (no yield cost, measurable coherence gain). The hard gate does
**not** ship until Arijit sees the trade-off as a number — coherence gain vs. records lost — which
step 1–4's re-run will produce.

**Update, after the run: the hard gate now looks unnecessary, and I am not proposing it.** The
number came back the opposite way to what I braced for — coherence 2.88 → 4.62 *and* PASS 15 → 25.
Zero prose-labelled fragments survive into the remaining nine REVISE records. A gate that costs
yield to solve a problem that labelling already solved would be pure loss. The live question is
now **G8**, which costs no yield at all: it rejects boilerplate that appears across many pages,
and it is already specified.

## Rollback

`git revert` the single commit. No index write happens in this run, no migration, no state to
unwind. The 35 already-enriched records are untouched and were already slated for re-run under the
numbered design (SESSION.md action 4).

## Verification plan — how I will know, not assume

- `pytest docs/70-enrichment/tests/` — existing **58** span-gate tests stay green, plus new
  candidate-classification tests written before the fix.
- Re-measure fragment-shaped share across the same 50 cached pages. Target: **31.6% → under 5%**
  of *prose-eligible* candidates.
- ~~`enrich_run.py --replay` on the same 50 records~~ — **wrong, and I wrote it before checking.**
  `replay()` re-runs the gates over the *stored* `llm_output`, which is a list of integer picks
  against the OLD candidate numbering. This change renumbers candidates, so those integers now
  resolve to different sentences: replay would silently compare two different selections and call
  it a gate delta. Replay is valid for a gate fix, which is what it was built for, and invalid for
  a menu change. A fresh writer run is the only honest comparison.
- Fresh `--pilot` over the same 50 cached pages: writer is free (GLM, ~1.6s/record), judge is
  ~34 Gemini calls. No fetching, no index write.
- Two baseline runs already exist as a control, so the comparison is against 2.88/19 and 2.85/19
  rather than against one sample.

**No claim of improvement until those numbers exist.** Reproducibility is 19/50 on this design, so
a single-run delta is not evidence; the comparison is against both baseline runs.

## What the fix actually changed — measured, same 50 cached pages

| | baseline | after |
|---|---|---|
| Prose-eligible candidates that are fragment-shaped | **31.6%** (715/2,264, all candidates) | **1.15%** (19/1,655 prose) |
| Total candidates offered | 2,264 | **3,323** |
| Pages offering at least one prose candidate | — (40 scored REAL) | **46 / 50** |
| Candidate mix | unlabelled | prose 1,655 · ui 529 · nonprose 454 · heading 433 · fragment 252 |
| Tests | 66 | **125 passed, 1 xfailed** |

Candidate count went **up** 47%, so this bought coherence without spending yield — blocks split
apart what the old code had welded together.

**One number needs framing rather than spin.** Fragment-shaped share across *all* candidates rose
to 47.7%. That junk was always present; it used to be welded into large merged chunks and is now
isolated into its own labelled entries. The figure that describes what the model is offered as
prose is 1.15%, and that is the one the fix targets.

## Two bugs found by RUNNING it, after the tests above were green

Both were invisible to fixture tests and appeared on the first real page.

1. **The splitter only spoke English.** `_ABBREV` held English abbreviations while 3,887 records
   are de/fr. It cut `3,1 Mio. US-Dollar` in half, and the back half —
   `"US-Dollar erzielte und E-Commerce-Teams dabei unterstützte, …"` — was stored as a highlight
   and drew a judge REVISE on the very first smoke record. It begins with a capital and ends with a
   period, so **neither shape check can catch it**; only knowing the abbreviation can. Fixed as a
   class: de/fr/es/it/pt abbreviations plus single-letter initials, not just the one German word.
2. **My own bug, from this change.** A long unpunctuated markdown heading was merged with the prose
   beneath it, because the block decision is taken at the *start of the next line*, where
   `is_heading` describes that next line — so "the line I just left was a heading" was unknowable.
   `##  Entwickeln Sie mit Algolia erstklassige…` + `Algolia bietet Ihnen…` arrived as one
   candidate and scored coherence 1. Fixed with a `prev_heading` flag; regression test added.

Both now have tests built from the exact source strings that broke them.

---

# Part 2 — G8, corpus-wide boilerplate (`boilerplate.py`, prompt v1.3)

Arijit picked this as the next step after seeing Part 1's numbers. It targets the largest remaining
class: 4 of the 9 surviving REVISE records, and it costs no yield.

## Why no single-record check could ever have caught it

```
"Recognized by IDC, Gartner, Forrester, and Paradigm B2B, Algolia helps
 enterprises turn search into a growth engine for AI-native experiences."
```

Complete, specific, grammatical, named entities, no markup. **Every shape-based heuristic in
Part 1 is correct to call this prose.** It is simply not about the page it sits on. The judge:
*"The abstract and highlights are entirely about general analyst recognition for Algolia. They
completely fail to represent the page's main topic."*

The only signal that separates site furniture from content is **how many different pages carry
it** — and that is invisible from inside one record. Hence a corpus pass.

## Prevention, not post-mortem

`span_gate.check_template_collision` already existed for G8 and **was never called by anything**.
It hashes the first 8 tokens of *stored abstracts* and quarantines clusters over 20. Two problems:
it fires only after 20+ records are already spoiled, and its remedy is to discard them rather than
to pick better text.

So G8 is now two halves, and both are wired in:

| Half | When | What it does |
|---|---|---|
| `boilerplate.py` (new) | **before** selection | marks the sentence `[BOILERPLATE]` in the numbered menu, so the model never picks it and the record keeps a good abstract |
| `check_template_collision` (existed, now called) | after the run | reports sameness in the run's stored output — the safety net for anything that got through |

## Two things measured the hard way, both now tests

**1. Count paths, not URLs.** algolia.com serves *untranslated* English content at `/de/` and
`/fr/`, so one article appears as byte-identical text at three URLs. Counting URLs, **166** prose
sentences on the 50 pages looked like boilerplate. Stripping the locale prefix collapses them to
**11**. Counting URLs would have quarantined real content — the exact outcome Arijit ruled out.

The locale regex needs a `(?=/|$)` boundary, or `/definitions/search` has its "de" stripped and
becomes `finitions/search`, silently merging unrelated pages. That is a test.

**2. The threshold is a share, not a count.** Measured over 29 canonical paths:

```
12 paths  "hi there 👋 need assistance?"                    <- furniture
11 paths  "recognized by idc, gartner, forrester, ..."       <- furniture
10 paths  "klicken sie hier;), um funktionale cookies ..."   <- furniture
 5 paths  "use this file to discover all available pages"
 3 paths  "all requests must use https."                     <- REAL. Run1's judge named this
 3 paths  "successful responses return 2xx statuses."           exact line as a highlight the
 3 paths  "your algolia application id."                        extraction had WRONGLY OMITTED
```

There is an empty gap between 5 and 9. An absolute threshold of 9 fits it — and is badly wrong at
full scale, where 9 of ~6,000 paths is 0.15%: a shared section, not furniture. Site-wide furniture
appears on a large *share* at any corpus size, so the rule is `> 20% of canonical paths`, which
sits inside the measured gap (0.17–0.31) and leaves shared doc text (0.10) well clear.

Below **20** canonical paths the check flags nothing at all — with 4 pages, "appears on a third of
the corpus" means "appears twice". Fails safe.

## Built map, from the 50 cached pages

```
pages 50 | canonical paths 29 | threshold >5.8 paths
boilerplate sentences: 20
```

20 entries, every one genuine furniture — chat widget, cookie notice, analyst/awards block — in
English, German and French. No content sentence among them.

**A bug this found in itself:** `build_map` originally carried its own `len(markdown) < 200` filter.
Short pages were skipped, the path count fell under the minimum, and the function returned `{}` —
*"no boilerplate found"* — for a corpus full of it. A filter that silently changes the answer
belongs at the input boundary, not inside the counting function. Moved to `_pages_from_cache`.

## G8 RESULT — it made things worse. Default is OFF.

Same 50 pages, same models. G8 is the only variable between v1.2 and v1.3.

| | run1 | run2 | **v1.2 (no G8)** | v1.3 (G8 on) |
|---|---|---|---|---|
| coherence | 2.88 | 2.85 | **4.62** | 4.21 |
| missed_substance | 3.21 | 3.00 | **4.53** | 4.14 |
| specificity | 3.85 | 3.50 | **4.26** | 3.96 |
| PASS | 15 | 15 | **25** | 20 |
| JUDGE_REVISE | 19 | 19 | 9 | **8** |
| NO_ABSTRACT_THIN | 6 | 4 | **3** | 8 |

REVISE fell by one. PASS fell by five, and every quality dimension fell. **Net regression.**
`G8_ENABLED = False` in `enrich_run.py`; the default is v1.2, the best measured result. The
post-hoc half stays on — it only reports and cannot cost a record.

### The flaw is structural, not a threshold

**A sentence can be furniture on ten pages and be the content on the eleventh — the page it is
actually about.**

`/fr/awards` is a page *about* Algolia's awards. Its award sentences also sit in ten other pages'
footers, so G8 marked them boilerplate. That page went from **8 prose candidates to 1**, then to
THIN:

```
/fr/awards prose candidates: 8 without G8  ->  1 with G8
  killed: "Reconnue par IDC, Gartner, Forrester et Paradigm B2B, Algolia aide les entreprises..."
  killed: "Algolia est reconnue comme un leader dans le Magic Quadrant™ 2026 de Gartner®..."
  killed: "Algolia a remporté 12 médailles dans 12 catégories lors du Paradigm B2B's..."
  killed: "Une étude de Forrester Consulting a révélé qu'Algolia a généré une VAN de 3,1 M..."
```

G8 was right about the sentences and wrong about the page. Four records were lost this way.

**The fix is known and NOT built:** skip G8 on any page where it would remove most of the prose,
because there the block *is* the content. `/fr/awards` lost 87% — a "don't apply if it removes
>50%" guard would have saved it. That is the next attempt, if Arijit wants one.

### A separate finding, and it argues against something I said earlier

`/fr/customers/walgreens` fell from PASS to REVISE on a fragment the judge called nonsensical
(`"optimiser leur expérience."`). I checked whether classification had missed it. It had not —
the candidate was correctly labelled:

```
candidate [58] kind=fragment complete=False  'optimiser leur expérience. " Grâce à...'
```

**The model picked a `[FRAGMENT]` after being told in three separate places not to.** So the
labels are advisory and the model does not always obey them. In Part 1 I withdrew the proposal for
a hard gate on `[FRAGMENT]`/`[UI]` picks, on the grounds that labelling had already solved it.
That conclusion was too strong: labelling solved it *usually*. A hard gate on `[FRAGMENT]` only —
not `[UI]`, not `[BOILERPLATE]` — is worth measuring, and its yield cost is now knowable rather
than hypothetical. I am not building it unasked.

## Also found, logged, not fixed here

- **`pilot-summary.md` reports a false writer.** Header says writer `claude-sonnet`; every row in
  `results.jsonl` says `glm-5.2`. A hardcoded label in the summary writer. False provenance in a
  report that exists to be trusted — fix with the same commit, it is one line.
- **`candidates.py` defines `MIN_CHARS`, `MAX_CHARS`, `Candidate`, `_NUMBERED` and
  `_is_sentence_boundary` twice** (lines 50–90 and 93–130). The second wins. Dead code, and it
  silently discards the first copy's `.rstrip()`. I first read that as an active bug and checked
  before repeating it: `split_candidates` passes `m.start()`, which sits *before* the whitespace,
  so `$` anchors correctly and both guards do fire. It is a maintenance hazard, not a live defect.
  Deleting the dead first copy is part of this change.
- **`instructional` family yields 0 of 5** — 4 `NO_ABSTRACT_DEAD`, 1 THIN. Prose extraction, not
  selection. Separate root cause, separate run.
