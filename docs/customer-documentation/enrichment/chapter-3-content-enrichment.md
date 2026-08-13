---
title: "Chapter 3 — Content Enrichment"
description: "Adding real page text to 12,035 records without letting a language model invent a single word."
status: in progress
asana: "Chapter 3 : Content Enrichment (1217211621995392)"
updated: 2026-08-08
---

# Chapter 3 — Content Enrichment

> **Status: in progress.** The pipeline is built, tested and has written to the live index.
> 35 records enriched so far. The method changed fundamentally on 2026-08-08 — see §4.
> Working record of every decision and every bug: [chapter-3-build-log.md](./chapter-3-build-log.md).

## 1. Why this chapter exists

[Chapter 1](./chapter-1-taxonomy-enrichment.md) hit a ceiling that no amount of rule-writing lifts.

`Algolia_Prod_Copy_Enhanced` has **no body field**. Total natural language across the index is
**6.37M characters over 12,035 records — 526 per record.** A title and roughly one sentence.

The existing `abstract` field cannot be used as-is. Measured on the live index:

```
present on 11,570 of 12,114 (95.5%)      length p50 103 chars, p90 444
27.0% (3,273) end in "..."               truncated mid-word
3,340 are byte-identical to `description`
```

Example, in full, from the record for `/doc/value-engineering`:

> `Value Engineering is a free service for qualifying Algolia ecommerce users. It helps you estimate ho...`

Three consequences, all measured rather than assumed:

- **Search has nothing to match.** A buyer typing *"Gartner Magic Quadrant Leader"* or *"CLI
  Homebrew"* finds nothing, though both phrases sit on Algolia's own pages.
- **The taxonomy is capped.** `product` resolves at 42.5% against a 70% target and `feature` at
  73.6% against 75%. Every URL-derived signal is exhausted — 89 rules, SDK method groups, 194 API
  parameters. The residue needs page text that does not exist in the index.
- **Agents can only point.** With no text to quote, they return links instead of answers.

## 2. The requirement that shaped everything

Arijit, 2026-08-07:

> *"It is crucially important that there is absolutely zero and I mean seriously ZERO LLM
> hallucination going in any of the abstract_enriched or keyhighlights_enriched. No LLM
> imagination, no hallucination."*

And on 2026-08-08, after the first attempt at handling model slips by discarding the affected span:

> *"Just throwing away page because GLM is adding a word or two here or there... does not solve our
> problem. That is again taking a shortcut and a lipstick on the pig, not solving the root
> problem... I need every single record to be enriched."*

Both constraints at once: **zero invention, and no record left behind.** That combination is what
forced the final design, and the first two attempts failed it.

## 3. Two designs that were rejected

### 3.1 Generate a summary, then verify it — rejected

The obvious approach: have the model write a summary, have a second model check it for
hallucination. **Rejected before any code was written.**

An LLM verifying an LLM produces an *opinion*. Both can be wrong in the same direction, because
they share training data and failure modes. Asking a model "did you invent this?" cannot reach zero,
and the requirement was zero.

### 3.2 Have the model copy text verbatim, then string-match it — rejected 2026-08-08

Second attempt: the model returns sentences copied from the page; a script asserts each is a
literal substring of the source. Hallucination becomes provable by `str.find()`.

This *worked* — 60 records across two pilots, zero invented words reached the index — but it
failed the second constraint, and the reason is instructive.

**Copying is transcription, and language models are bad at transcription.** GLM-5.2 was caught:

```
page:  eTail Boston 2026  Boston, MA  August 2026 - 12. August 2026
model: eTail Boston 2026  Boston, MA  10. August 2026 - 12. August 2026     <- invented a date

page:  Sie wandte sich an Algolia und implementierte Search & Discovery...
model: Walgreens implementierte Search & Discovery...                        <- rewrote the sentence
```

Every one was rejected and nothing reached the index. But rejection cost the **record**, not the
sentence. And a second, larger population of rejections were not the model's fault at all — they
were faithful copies that failed to match because of source-side noise:

| Page contains | Model wrote | Both correct |
|---|---|---|
| `Algolia’s` (U+2019) | `Algolia's` (U+0027) | yes — cost one page all 3 spans |
| `percentage points , with` | `percentage points, with` | yes — the page has a typo, the model fixed it |
| `[user\n  token](url)` | `user token` | yes — markdown wraps inside link labels |
| `desLaravel` | `des Laravel` | yes — the page's own HTML is malformed |
| `run: sh theme={"system"}` | `run: sh` | yes — MDX component props sit mid-sentence |

Each of those needed a canonicalisation rule, each rule needed tests, and the class was open-ended:
there is always one more way for source text and copied text to differ. **A design whose failure
rate depends on how weird the source HTML is cannot promise that every record gets enriched.**

## 4. The design that holds: the model returns numbers, never text

**A script splits the page into numbered candidate sentences. The model returns only integers. The
script takes its own sentences by index.**

```
script  → splits page into numbered candidates, keeping character offsets
model   → sees   [12] The Algolia CLI lets you work with Algolia's APIs from your terminal.
        → returns {"verdict":"REAL","abstract":[12,15],"highlights":[18,22]}
script  → looks up 12 and 15 in ITS OWN list and stores those
```

**The model emits no content whatsoever.** Invention is not detected — it is *unrepresentable*. An
integer either indexes a real sentence from this page or it is out of range. There is no string to
compare, so there is nothing for an apostrophe or an MDX prop to break.

What this eliminates, all at once:

- Fabrication — structurally, not by inspection
- Every false-rejection class in §3.2 — nothing is being matched
- Transcription slips — the model is not transcribing
- Records lost to source-side noise — the reason they were lost is gone

Verified on the pilot: **0 fabricated spans, 0 out-of-range picks, 0 crashes over 60 records.**

### 4.1 The splitter is now the load-bearing component

Because selection quality depends entirely on what is in the menu, the splitter matters more than
the model. Two bugs surfaced within a minute of writing it, both on real text:

- `12. August 2026` was cut in half — a digit followed by a period is list numbering or a German
  date, never a sentence end.
- `Algolia vs. Coveo` was cut in half — the abbreviation guard's `$` anchor never matched because
  the lookbehind window included the trailing whitespace that triggered the split.

And one design error that mattered more: over-long chunks were **discarded**. On a link-heavy page
that removed almost everything before the model could choose — a 5,273-character page offered only
4 candidates, so the model correctly called it thin. Over-long chunks are now **split at word
boundaries, never dropped.** Same page: 4 candidates → 11.

## 5. Where the guarantee lives, and where it does not

```
script  splits the page into numbered candidates          ← deterministic
LLM #1  picks numbers + a REAL/DEAD/THIN verdict          ← judgement, emits no text
script  resolves numbers into its own sentences           ← THE GUARANTEE
script  G10/G11 context and specificity checks            ← deterministic
LLM #2  judges whether the selection represents the page  ← opinion, different vendor
```

**The judge is never asked whether anything was hallucinated.** Its prompt says faithfulness "is
NOT your concern." It is asked the question no script can answer: is this selection
representative, is it specific enough to be useful, and does the *combination* imply something the
page never said.

> **Drop the judge and the zero-invention guarantee survives intact.
> Drop the script and there is no guarantee, only reassurance.**

That asymmetry is the whole design. Anyone tempted to remove a step to save time should remove the
judge, never the script.

## 6. Handling 43 different record shapes

8 sources, **43 `page_type` values**, 3 languages (en 8,148 · de 1,944 · fr 1,943). Variation is
confined to exactly **two** places; everything else is invariant.

**Place one — the fetch router.** Four paths, one output shape:

| Path | Records | Mechanism |
|---|---|---|
| `doc-md-twin` | 4,337 | every `/doc/*` page serves authored markdown at `<path>.md` |
| `scout` | 5,861 | hosted Scout on the VPS, async job + poll |
| `excluded-support` | 1,695 | **not enriched** — see §7 |
| `auth-wall` | 142 | Academy, behind dashboard sign-in; reported honestly as DEAD |

Boundary tested: `.md` twins exist **only** under English `/doc/*`. `/blog/….md`, `/pricing.md`,
`/fr/events.md` all 404.

**Place two — the family instruction block.** 43 page types collapse to **7 shape families** in
`prompts/shape-families.json`, verified by script against the live index (all 43 mapped, none
duplicated, counts sum exactly). The family changes only *what to look for* and two numeric
thresholds. It never changes the output contract.

```
reference     4,392   API/SDK. Terse. One span is a valid answer.
editorial     4,363   Blog/press. The thesis is rarely in paragraph 1.
instructional 2,586   Procedures. A warning IS a highlight.
evidence        237   Customer stories. A metric without its unit is not a highlight.
commercial      223   Highest risk: the page is written to persuade.
hub             149   The slop trap. No prose describing itself → THIN.
corporate        85   Thin, boilerplate-heavy.
```

## 7. What is deliberately NOT enriched

**Support — 1,695 records, excluded by Arijit 2026-08-08.** Not a limitation; a decision.

Support articles are authored by the technical support team. Measured: **202–604 characters of prose
each**, and the index already stores ~450 of one. Fetching bought 85 characters. One record was
rejected for "information gain 0" because the extracted abstract *equalled* the existing
`description` — there is only one thing the article says.

> Arijit: *"you cannot change what the ruling is... I don't want to add flowery language to what a
> proper technical support team has created."*

Adding a plain-language "explanation" would put our words on someone else's technical ruling. Not
done. This also retired a Zendesk Help Center API call that had been made without approval.

**Greenhouse — 79 job adverts, deleted 2026-08-07**, verified on the live index (12,114 → 12,035).
These were the records that made WU-06's `solutions` query return five job adverts at ranks 1–5.

**Academy — 142 records** sit behind a `dashboard.algolia.com` sign-in. Attempted anyway so the
block is evidenced rather than assumed; all return `DEAD / LOGIN_REQUIRED`.

## 8. What gets written

`abstract_enriched` is an **array of verbatim sentences**, not a joined paragraph.

This was changed deliberately on 2026-08-08. A pre-joined string bakes a **false adjacency** into
the index: two individually-true sentences placed side by side can imply a relationship the page
never stated, and that was the one failure class with no mechanical guard. Storing the array removes
it from the datastore entirely — joining becomes a presentation decision, reversible in the UI.

```
abstract_enriched                 array of verbatim sentences
keyhighlights_enriched            array, 3-8 concrete facts
enrichment_verdict                REAL | THIN | DEAD
enrichment_reason                 closed vocabulary, only when not REAL
enrichment_source_url             the URL actually fetched
enrichment_fetch_path             doc-md-twin | scout | zendesk-api | auth-wall
enrichment_content_hash           sha256 of the exact markdown the model saw
enrichment_fetched_at             so staleness is detectable
enrichment_span_offsets           character ranges into that markdown
enrichment_writer_model           glm-5.2
enrichment_judge_model            gemini-2.5-pro
enrichment_prompt_version         which prompt produced this
enrichment_dropped_fabrications   audit trail; 0 by construction under §4
enrichment_judge_scores           the five quality dimensions
enrichment_validated_at
```

**Writes add fields only.** `abstract`, `description`, `title`, `url` and the entire taxonomy are
untouched, so the whole operation is reversible by deleting these fields.
`partialUpdateObjectNoCreate` is used, never `addObject`: a vanished objectID fails loudly instead
of silently creating a stub. (`partialUpdateObject` cannot *remove* an attribute — setting one to
null stores a literal null, which put 96,039 nulls in a live index on 2026-08-05.)

`THIN` and `DEAD` are written as verdicts with no abstract. **A recorded gap is countable; an absent
field is invisible.**

## 9. Verification — three confirmations of three different kinds

Two independent checks of the same kind are one check run twice.

**1 — Construction.** The model emits no text. Not a check; a property of the data flow.

**2 — Independent re-derivation.** `verify_written.py` reads records back from the **live index**,
**re-fetches every page from the web**, and re-locates every stored sentence from scratch. It shares
no state, cache or data structure with the writer, so a bug in the writer cannot make it pass.
Result on the 35 written records: **151/151 sentences located, 0 not on page.**

**3 — Adversarial and human.** A token census (every number, date and proper noun must be in the
source — catches a real sentence from the *wrong* page), the cross-vendor judge, and a human
reading `reports/REVIEW-english.md`, where every sentence is shown *inside its page text* wrapped
in `>>>` markers.

**A page edited since enrichment is STALE, not WRONG.** You cannot verify text against a page that
is no longer that page. 12 of 23 verified pages had changed within a day; the content hash is what
tells the two apart.

## 10. Model choice, measured

Writer: **glm-5.2** on Algolia's own inference server (`ALGOLIA_INFERENCE_BASE_URL`), the same
inference layer the Agent Studio agents use. Judge: **gemini-2.5-pro**, deliberately a different
vendor — a same-family judge agrees with the writer for the wrong reasons.

A/B on the same 60 records, identical gates and judge, so the writer was the only variable:

| | `claude -p` | glm-5.2 |
|---|---|---|
| cost, 10,340 records | ~$1,673 | **free** |
| latency | ~30 s | **1.6 s** |
| temperature 0 | not available | **supported** |
| reproducible | no — same page gave THIN then REAL | **yes, 8/8 identical** |

Reproducibility is a Chapter 4 requirement and `claude -p` structurally cannot provide it.

**Operational trap:** glm-5.2 charges *reasoning* tokens against `max_tokens`. At 120 it returns
completely empty content with `reasoning_tokens: 121`, indistinguishable from an outage. Keep it
≥4000. The same trap exists on gemini-2.5-pro, where `thinkingBudget: 0` is unsupported and yields
a candidate with no content parts.

## 11. Honest limits

- **Yield is ~47%** of enrichable records on the pilot (28 of 60). Most of the shortfall is correct:
  Academy needs a login, and link-list pages have nothing to summarise. Realistic outcome across
  10,340 enrichable records is **roughly 5,000**, not 12,035.
- **Juxtaposition is not guaranteed.** Two true sentences can together imply something neither says.
  Only the extremes are mechanical (≤4 sections, ≤20,000 characters apart). Storing an array rather
  than a paragraph moves the residual risk to the UI, where it is reversible — but it does not
  delete it.
- **Precision of the selection is not proven.** These sentences are provably *from* the page. Whether
  they are the *right* sentences is the judge's opinion plus a human review of 13 records.
- **`enterprise_ledger` is not used yet.** It holds real bodies for 4,462 records at no fetch cost,
  but carries retired product names (App Search, Enterprise Search) and stale `/old-docs/` content.
  Using it would change the guarantee from "on the live page" to "in another index, possibly stale",
  which is a different provenance class and must be labelled as one.
- **199 chunk records** (`/doc` objectIDs with `-0` suffixes) represent fragments of a page while the
  abstract describes the whole page. Unresolved.

## 12. Reproduce it

```bash
python3 -m pytest docs/archive/enrichment/legacy-tooling/tests/test_span_gate.py -q     # 66 passed
python3 docs/archive/enrichment/legacy-tooling/fetch_router.py --verify-families        # 42 types, sums to 12,035
python3 docs/archive/enrichment/legacy-tooling/snapshot_enhanced.py                     # the only rollback
python3 docs/archive/enrichment/legacy-tooling/fetch_router.py --build-queue
python3 docs/archive/enrichment/legacy-tooling/enrich_run.py --pilot --out reports/run  # writes NOTHING to Algolia
python3 docs/archive/enrichment/legacy-tooling/make_review_pack.py                      # human-readable review
python3 docs/archive/enrichment/legacy-tooling/write_enrichment.py --results reports/run          # dry run
python3 docs/archive/enrichment/legacy-tooling/write_enrichment.py --results reports/run --apply --yes
python3 docs/archive/enrichment/legacy-tooling/verify_written.py                        # must report 0 not-on-page
python3 docs/archive/enrichment/legacy-tooling/test_reproducibility.py --n 8            # must report REPRODUCIBLE
```

## 13. Still to do

1. **Arijit reads `reports/REVIEW-english.md`** and rules. His gate.
2. **Index settings**: add both fields to `searchableAttributes`, `enrichment_verdict` to
   `attributesForFaceting`. Settings-only, no data re-push — Algolia rebuilds internally. It is
   async, and relevance *will* shift, so re-run the demo smoke tests afterwards.
3. Resolve `enterprise_ledger` freshness, then decide whether to use it.
4. Run the remaining ~10,300 records.
5. **Re-run Chapter 1's classifier on the new text.** `product` and `feature` should lift materially.
   This is the reason the chapter exists and it is untouched.
6. Create `WS5.4` in Asana and its brief — Chapter 3 has no work subtask, unlike Chapters 1 and 2.

## 13.5 Description is missing on a real, bounded subset of the corpus — 2026-08-11

Found while diagnosing why the `algolia-data-enrichment` skill's judge routes far more
`Website/press-release` records to human review than `Customer Stories/case-study` (44% vs 1.3%
on matched-size runs). The judge scores `information_gain` by comparing the written abstract
against the record's own `title` and `description` fields — and for a large share of press-release
records, `description` does not exist to compare against.

**Verified against the full live source index (`Algolia_Prod_Copy_Enhanced`, all 11,928 records,
not a sample):**

```
title:       11,928 / 11,928 (100.0%) real content -- every record, no exceptions
description: 10,225 / 11,928 (85.7%)  real content
               938  / 11,928 (7.9%)   empty string
               754  / 11,928 (6.3%)   literal "…" placeholder
                11  / 11,928 (0.1%)   missing entirely
```

By source/page_type, where the gap actually concentrates:

```
source/page_type                    total   no-description   %
Website/press-release                 690        401        58.1%
Blog/blog-post                       2,694        887        32.9%
Resources/resource                     835        291        34.9%
Documentation/doc-rest-api             333         23         6.9%
Customer Stories/case-study            237          7         3.0%
Documentation/doc-guide                586          6         1.0%
```

**This is a real, bounded, source-level fact — not a pipeline bug.** These records genuinely never
had a meta description authored on the live site; it isn't being dropped or lost anywhere in
fetch/enrich (title, for comparison, is 100% present everywhere — verified against the same full
index, no exceptions — an earlier read of `results.jsonl` that suggested title was also missing
was checking the wrong artifact: that file never persists `title` as an output field at all,
regardless of what the judge actually receives at runtime).

**Implication for scope, not yet built:** any judge criterion (or future gate) that compares
against `description` cannot assume it exists. For `Website/press-release`, `Blog/blog-post`, and
`Resources/resource` specifically — the three families with a real gap — backfilling or generating
a usable description needs to become part of what the enrichment pipeline does for those records,
not an input it assumes is already there. `Customer Stories/case-study` and
`Documentation/doc-guide` do not have this problem and don't need it.

## 14. What this unblocks

Higher `product` and `feature` coverage. Real snippets in search results. And grounded answer
synthesis by agents — today they can only route users to pages, because there is no text to
synthesise from.
