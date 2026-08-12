---
title: "Chapter 6 — Blog & Case Study: what was enriched, how, and what differed"
description: "The two finished corpora. Fields, mechanism, per-corpus configuration, and the verified end state."
status: complete — both corpora enriched, verified and live, 2026-08-12
asana: "4.1.4 Blog (1217389831620588) · 4.1.21 Case Study (1217390160608523)"
---

# Chapter 6 — Blog & Case Study

Two of the ten corpora in `Algolia_Prod_Copy_Enhanced` are finished: enriched, verified span by
span against their own source pages, and live. This chapter records exactly what was written,
by what mechanism, and where the two corpora needed different treatment.

> **Verified end state, 2026-08-12, measured against the live index — no sampling.**
>
> | Corpus | Records | Spans verified | Quality defects | Drift |
> |---|---:|---:|---:|---:|
> | Blog/blog-post | 2,694 / 2,694 | **21,790 / 21,790** | 0 | 0 |
> | Customer Stories/case-study | 226 / 226 | **1,722 / 1,722** | 0 | 0 |
>
> Reproduce with `algolia_enrich.py verify-corpus --source <S> --page-type <P>`.

---

## 1. The two fields, and nothing else

Enrichment writes exactly two attributes. It creates no records, replaces none, and touches no
other field — the write is `partialUpdateObject`, and `promote.py` refuses any payload carrying a
third key.

| Field | Type | What it holds |
|---|---|---|
| `abstract_enriched` | ordered array of strings | 1–4 sentences, each sliced verbatim from the page, read as one paragraph in page order |
| `keyhighlights_enriched` | ordered array of strings | 2–8 standalone sentences, each of which must make sense **alone** in a result list |

Measured on the live index:

| | Blog | Case Study |
|---|---|---|
| Records enriched | 2,694 | 226 |
| Abstract spans — min / median / max | 2 / 3 / 4 | 2 / 3 / 3 |
| Highlight spans — min / median / max | 2 / 5 / 8 | 4 / 5 / 6 |
| Total spans written | 21,790 | 1,722 |
| Languages | en 898 · de 898 · fr 898 | en 79 · de 74 · fr 73 |

Both fields are in `searchableAttributes` on Enhanced and return hits — verified by querying a
phrase that exists **only** in `abstract_enriched` and nowhere in the record's title or
description.

---

## 2. The mechanism: the model returns numbers, never text

This is the single most important design decision in the pipeline, and everything else follows
from it.

```
page markdown
  → canonicalise()            collapse to one flat, offset-mapped string
  → split_candidates()        cut into NUMBERED sentences, each CLASSIFIED
  → filter_pool()             remove furniture before the model ever sees it
  → apply_pool_gates()        remove what a gate would later reject
  → render_menu()             "[12] The Algolia CLI lets you work with…"
  → writer model              returns {"abstract": [12, 15], "highlights": [18, 22]}
  → resolve_selection()       look 12 up in OUR list and take OUR text
```

**The model emits no content whatsoever.** It returns integers. An integer either indexes a real
sentence from this page or it is out of range and refused. Fabrication is not *detected*, it is
**unrepresentable** — which is why grounding comes out at 21,790/21,790 rather than
"21,780 and we investigated the rest".

This replaced a copy-the-text design that lost whole records to transcription slips.

### What the menu tells the model

Nothing is silently deleted for being ugly; it is **labelled**, and the label is shown:
`[UI]`, `[HEADING]`, `[FRAGMENT]`, `[NONPROSE]`, `[BOILERPLATE]`, `[QUOTED]`,
`[ALREADY INDEXED]`, `[NOT-FIRST]`. The prompt forbids picking a marked entry. A candidate the
model cannot tell from prose is a candidate it will pick — the Blog run's own evidence.

### Scoping: where the page actually starts and ends

Scout returns the complete page, including the global shell. Two positional cuts, computed on the
raw markdown before anything is split:

- `main_content_start` — the page's own headline (H1 **or** H2; `# # #` is not a heading)
- `boilerplate_block_start` — the trailing "About <Company>" block, profile-driven

Neither is used on Blog beyond the headline: the Blog profile declares no
`boilerplate_block_openers`, and `main_content_start` is bit-identical across all 426 cached Blog
pages, so today's splitter changes do not alter Blog's menu.

### Repair before quarantine

A span cut mid-sentence or ending in a colon is a **bad cut, not a bad page**. `span_repair`
extends it over the page's own following words — `canon.text[a.canon_start:b.canon_end]` is one
contiguous slice, so the repaired value contains no character the page does not contain, in the
order the page has them. **Punctuation is never added; that would be writing text.**

On case study, repair recovered 13 of 14 quarantined records.

---

## 3. Blog — 2,694 records

**Profile:** `profiles/Blog__blog-post.yaml`

```yaml
strategy:            editorial
abstract_shape:      editorial_summary
language_policy:     allow_known_english_body
min_body_chars:      1200
abstract_span_count: [1, 3]
highlight_count:     [3, 8]
coverage_target_pct: 0.95
```

### What is specific to Blog

- **`language_policy: allow_known_english_body`.** Blog is the only corpus where `/de/` and `/fr/`
  URLs serve **English** bodies — 100% of blog, 0% of every other source. The language-mismatch
  gate is therefore relaxed here and **only** here. The 898/898/898 language split above is the
  URL's language, not the body's. Do not generalise this ruling: case study uses
  `must_match_record`.
- **The widest span budget in the corpus** — 1–3 abstract spans, 3–8 highlights. Editorial pages
  carry more usable prose than any other family, and the measured output uses it: highlights run
  to a maximum of 8 per record where case study caps at 6.
- **`coverage_target_pct: 0.95`**, the highest of any profile. Blog pages are long, well-formed
  and prose-dense, so a low yield here indicates a defect rather than a thin corpus.
- **No `forbidden_patterns` and no `boilerplate_block_openers`.** Blog pages carry no
  "About <Company>" block — measured, 0 of 426 cached pages. The empty defaults are correct, not
  an oversight.
- **A JSX-in-code-fence quirk.** 22 of 400 Blog bodies (5.5%) contain a code fence holding markup
  such as `<button className=… onClick={…}>`, which makes `canonicalise` non-idempotent: pass one
  leaves the tag, pass two strips it. Harmless to the stored spans, but a verifier that
  canonicalises the span twice and the body once will report a faithful span as absent. See §5.

### Result

2,694 of 2,694 enriched. 21,790 spans, every one re-located character-for-character on its own
page. Zero leakage, chrome, incomplete spans, duplicate-descriptions or template collisions.
Zero content drift.

---

## 4. Case Study — 226 records

**Profile:** `profiles/Customer-Stories__case-study.yaml`

```yaml
strategy:                     case_study
abstract_shape:               case_study_summary
language_policy:              must_match_record
min_body_chars:               900
abstract_span_count:          [2, 3]
highlight_count:              [4, 6]
max_span_distance:            8000
duplicate_description_policy: ban
allow_quotes:                 false
judge_required:               true
coverage_target_pct:          0.85
max_human_review_open_pct:    0.05
```

### What is specific to Case Study

- **`allow_quotes: false`.** A case study is mostly customer testimony in blockquotes. A pulled
  quote is *someone else speaking*, and storing it as the page's own abstract misattributes it.
  Quoted candidates are labelled `[QUOTED]` and cannot be selected.
- **`max_span_distance: 8000`.** Case-study pages have a long tail of unrelated promo content, so
  an abstract stitched from the top and the bottom of the page reads as one claim while being two.
  The gate measures `max(end) − min(start)`.
- **`duplicate_description_policy: ban`.** The dominant case-study failure mode: the page lede is
  almost always a compressed restatement of the meta description. Without this you get grounded,
  faithful, **useless** abstracts that every other gate passes.
- **A tighter, higher floor than Blog** — 2–3 abstract spans (never 1) and a *minimum* of 4
  highlights. A case study that cannot produce four standalone facts is not a case study.
- **`forbidden_patterns`** for CTA furniture (`Read the full case study`, `Ready to get started`),
  the `About Algolia` block, and bare stat tiles (`^\d+%$`, `^\d+x faster$`) — a number with no
  sentence around it is not a highlight.
- **`dead_page_markers` including two soft-404 stubs** — `No Products Found` and
  `Your customer hub for everything Algolia`. See §4.2.

### 4.1 All 237 records accounted for

| Outcome | Count |
|---|---:|
| Enriched, verified, live in Enhanced | **226** |
| Soft 404 — HTTP 200, full body, story removed | 4 |
| Hard 404 — page gone, 205-byte error body | 7 |
| **Total** | **237** |

**The enrichable ceiling is 226, not 237.** Eleven pages no longer exist. 226/226 is complete.

### 4.2 Soft 404s — the failure mode this corpus exposed

Four case studies return **HTTP 200 with a full body** and no story:

- `/customers/kingarthur` (en/de/fr) — redirects to the generic customer hub. Body is 8,230
  characters. The string **"king arthur" appears zero times**.
- `/customers/bringmeister` — renders `# No Products Found!!!`. **"bringmeister" appears zero
  times.**

Confirmed by a **fresh Scout fetch**, not from cache. Every existing check passed them: status
200, `served_url == url`, `redirect_mismatch` false, body far over `min_body_chars`. They had been
labelled `NO_PROSE`, which blames the writer for the page's absence.

Fixed at two levels:
1. **Instance** — dead-page markers now scan a second window at the page's own first heading. They
   previously scanned only `body[:200]`, which on algolia.com is the language switcher on every
   page, so the stubs at offset ~1,200 and ~1,400 were structurally invisible.
2. **Class** — `subject_absent_reason`: *a page that never mentions its own subject is gone,
   whatever the stub says.* The subject comes from the URL slug, so it needs no marker list and no
   model. Verified over **4,421 live pages across four corpora: catches exactly the 4 known soft
   404s, zero false positives.**

Both sides of the match are flattened to alphanumerics — the slug concatenates (`kingarthur`)
what prose spaces out (`King Arthur`). Without that, the check condemns a **real** King Arthur
case study. That was caught by a test, not by inspection.

### 4.3 A gate that could not be satisfied

`/customers/donorschoose` — a healthy page, 200, 16,478 characters — was quarantined across four
attempts. The gate and its own retry measured different things:

```python
GATE:  spread = max(l.end) - min(l.start)                     # first start → LAST END
RETRY: ban if c.start < anchor or c.start > anchor + limit    # by START only
```

A candidate **starting** one character inside the window survived the ban while **ending** past
it. The retry banned 52 candidates, kept 62, and still produced 8,111 against a limit of 8,000 —
111 characters, which is exactly the length of the closing span. The ban now filters on `c.end`.
The record passed on the first attempt afterwards. **21 records across all runs were in this
trap.**

### 4.4 Promotion into Enhanced

Case-study payloads were written to the parallel proving ground first, then promoted. Promotion
into the source index is deliberately harder to invoke than a normal write, because Enhanced holds
the whole taxonomy and has no backup other than a snapshot someone remembered to take:

- a snapshot must **exist** (`…_SNAPSHOT_20260812`, 11,928 records) — the guard's own objection,
  answered rather than argued with
- an **approval file** must name the index and the exact record count
- payloads may carry **only** `objectID` and the two enriched fields
- an **empty** field is refused — the shape that once wrote 96,039 literal nulls into a live index
- after the write: record count unchanged, and every record **read back byte-exact**

Result: 11,928 → 11,928 records, 226/226 read back byte-exact.

---

## 5. Verification, and why it needed new code

Every validation path in the skill was **run-scoped** — `cmd_validate` reads `ctx.run_dir`,
`cmd_verify_live` reads that run's `final/payloads.jsonl`. They answer *"was this run correct?"*
None could answer *"is what is in the index right now correct?"* once a run folder was cleaned up
or the code changed beneath it.

`verify-corpus` (new) reads enriched records straight from the live index, re-locates every stored
span in its cached source page, and re-runs the scripted quality gates. Deterministic, no model.

**Three defects were found in the verifier before it found anything in the corpus.** Recorded
because the transferable lesson is not about these bugs — it is that a verifier's first failures
are usually its own:

| Defect | Would have reported |
|---|---|
| Non-idempotent `canonicalise` treated as fatal | 2,694 Blog records blocked over the verifier's own normalisation |
| "HTTP status must be 200" | 1,805 of 2,694 healthy records flagged — Scout follows redirects, so the cached status is the *first hop* |
| Soft 404s undetectable | 4 deleted pages labelled `NO_PROSE` instead of `DEAD_PAGE` |

Each is now a test. Reported grounding misses are re-tested symmetrically and split into
**verifier artifacts** and **genuine absences**; both are counted, neither is hidden.

---

## 6. What this does NOT prove

Grounding is a **guarantee**; selection quality is a **judgement**.

These 2,920 records are proven **faithful** — every span is present, character for character, on
the page it claims to come from. Nothing here proves a span was the **best** sentence available.
That is the judge's job, and the judge floor remains unresolved (4.1.8).

Nor does it prove the pipeline is **reproducible**. Re-running the writer on identical inputs
produces different picks — measured at 34% status churn on press-release under byte-identical
bodies. What is verified is the data in the index, not that the pipeline would recreate it.
