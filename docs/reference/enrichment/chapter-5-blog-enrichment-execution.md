---
title: "Chapter 5 — Blog Content Enrichment: Execution, Repair and Live Validation"
description: "The first of eight sources, taken from design to live and validated against the index rather than the artifact."
status: live-validated, 30/30 gates pass
asana: "WS5.4 — Content enrichment (Blog)"
---

# Chapter 5 — Blog Content Enrichment: Execution, Repair and Live Validation

> **Status: Blog is live and all 30 validation gates pass.** 2,694 of 2,800 Blog records carry
> `abstract_enriched` and `keyhighlights_enriched`. 106 non-enrichable records were moved to a
> quarantine index and deleted from the main one. All 21,790 live spans were re-located in their
> source pages with **zero** grounding failures.
>
> Two items were open when this chapter was first written — 5 records carrying pipeline metadata,
> and the enriched fields not being searchable. Both were remediated on 2026-08-10 on Arijit's
> explicit instruction. §7 records what was done, including a two-minute live relevance regression
> caused by the settings syntax.

[Chapter 3](./chapter-3-content-enrichment.md) designed the mechanism: the model returns candidate
*numbers*, never text, so invention is unrepresentable rather than merely forbidden. This chapter
is what happened when that design met 2,800 real pages — including two defect classes the design
did not anticipate, and the accounting change that quarantine introduced.

---

## 1. What shipped

| | records |
|---|---:|
| Blog records in the corpus | 2,800 |
| **Enriched and live** | **2,694** |
| Moved to quarantine index | 106 |
| — `DEAD_PAGE` (no article to enrich) | 104 |
| — `NO_ABSTRACT_THIN` (shell-only duplicate URLs) | 2 |

Of the 2,694: `PASS` 2,353, `JUDGE_REVISE` 341. Both are writable — see §6 on why the judge does
not gate.

**Two indices now exist:**

- `Algolia_Prod_Copy_Enhanced` — 11,930 records, the served index
- `Algolia_Prod_Copy_Enhanced_Quarantine` — 106 records, each carrying `_quarantine_reason`

The quarantine index is the part worth arguing about, so: a dead page has no article text, so it
has nothing to enrich, and a search result pointing at it is worse than no result. Deleting it
outright would destroy the evidence for *why* it was excluded, and the next person would re-crawl
it. Moving it preserves the decision, per record, with its reason attached.

### 1.1 The accounting, and the trap in it

The record count moved 12,114 → 12,035 → 11,930 across three operations, and reconciling it
requires care because **two different numbers both look like "the total"**:

`Algolia_Prod_Copy_Enhanced` has `distinct: true` on `url`. A search's `nbHits` is therefore a
**distinct-URL count**; only `distinct: false` gives a **record count**.

```
12,114  after Chapter 2's dedupe (2026-08-06)
  - 79  job-board records deleted (2026-08-07)
12,035  distinct-URL count recorded in the handover
 - 106  Blog records moved to quarantine
11,929  distinct-URL count now
11,930  RECORD count now
```

The last two differ by one because a single junk record carries `url: null`, and Algolia gives a
record with no value for `attributeForDistinct` no distinct group. **This is not a duplicate.** A
full browse of all 11,928 records found 11,930 distinct `url` values and zero duplicates. The first
version of the validation gate read the gap as a duplicate URL and reported a defect that does not
exist — see §8.

### 1.2 Language accounting, and what the demo actually searches

Two different true statements get confused here, so both are stated:

- **By label**, 898 of the 2,694 Blog records are `language_code: en`. The other 1,796 are
  `de` and `fr`, 898 each — exactly even, because every article exists in all three.
- **By content**, all 2,694 are English. `/de/blog/…` and `/fr/blog/…` serve the English article —
  probed live 2026-08-09, byte-identical with and without a German `Accept-Language` header. The
  label is correct (the URL really is `/de/`); the body is not translated.

So enrichment covers all 2,694 and every span is genuinely grounded. But the **demo filters by
label**, and it always has:

```js
filters: 'environment:"prod20260722" AND language_code:"en" AND NOT is404:true'
```

Confirmed 2026-08-10: the demo makes exactly two Algolia requests — the search in `run()` and the
index-stats call — and **both** carry that filter. There is no unfiltered query path.

Which gives two different denominators, and reports must say which one they mean:

| | records |
|---|---:|
| Blog records enriched | **2,694** |
| ...that are `language_code: en` | 898 |
| ...that also pass `environment:"prod20260722"` | **866** |
| ...excluded by `environment` alone | 32 |
| ...excluded by `is404` | 0 |

**866 of the 2,694 enriched records — 32% — are reachable from the demo.** The other 1,828 are
correct, grounded and invisible to it. That is not a defect; it is the cost of the ruling to enrich
all three languages, and it should be stated wherever the 2,694 is stated.

#### `language_code` coverage across the whole index

Census of all 11,928 records, 2026-08-10:

| | records |
|---|---:|
| `language_code` present and non-empty | **11,929** |
| absent | **1** — `7825fa8b-7dd1-48d3-81ff-82f09c8832dd` |

That one record has no `url`, no `source` and no `title` either. It is the same junk record behind
the distinct-URL gap in §1.1, and it is not from this pipeline. Every real record carries a
language, so the demo's filter cannot silently drop content by omission.

Values: `en` 8,110 · `de` 1,910 · `fr` 1,909 · absent 1.

#### The two records with no source, diagnosed

Both fall outside the enrichment pipeline and they need **opposite** fixes:

- **`7825fa8b-7dd1-48d3-81ff-82f09c8832dd`** has exactly two fields: `objectID` and
  `hitsPerPage: 1`. `hitsPerPage` is a *search parameter*, so this is a query body written as a
  document. No url, title, source or content — nothing to classify. It is also the cause of the
  distinct-URL gap in §1.1. Only one record in the index carries that attribute, so it was a single
  accidental write. **Recommended: delete.**
- **`116204c4832786_dashboard_generated_id`** is the Search Grader landing page
  (`https://www.algolia.com/ai-search-grader`), created through the Algolia dashboard rather than
  the crawl, so it has content but no `source`, `environment`, `category` or `is404`.
  Because it lacks `environment` it fails the demo filter: unfiltered it is **hit #1** for
  "search grader"; under the demo filter it is **absent**. It is the only record for that URL, so
  deleting it would remove the page from search. **Recommended: backfill, not delete.**

Neither has been changed — both fixes are writes and are unauthorised. Full diagnosis in
[[corpus-by-language]] in the vault.

#### Records by language and source

| source | en | de | fr | total | demo-visible (en + env + not 404) |
|---|---:|---:|---:|---:|---:|
| Documentation | 4,337 | 0 | 0 | 4,337 | 4,258 |
| Blog | 898 | 898 | 898 | 2,694 | **866** |
| Support | 1,695 | 0 | 0 | 1,695 | 1,652 |
| Website | 387 | 368 | 368 | 1,123 | 364 |
| Developers | 288 | 288 | 289 | 865 | 285 |
| Resources | 279 | 278 | 278 | 835 | 260 |
| Customer Stories | 83 | 78 | 76 | 237 | **72** |
| Academy | 142 | 0 | 0 | 142 | 142 |
| **total** | **8,109** | **1,910** | **1,909** | **11,928** | **7,899** |
**Updated 2026-08-10 after quarantine.** The table previously carried a `(no source)` row for two
unclassified records. Both were moved to `Algolia_Prod_Copy_Enhanced_Quarantine` and deleted from
the main index on Arijit's explicit instruction, so the eight real sources now sum exactly to the
record count with no residual row:

| | before | after |
|---|---:|---:|
| main records | 11,930 | **11,928** |
| main distinct-URL groups | 11,929 | **11,928** |
| records == distinct URLs | no, gap of 1 | **yes** |
| quarantine index | 106 | **108** (106 Blog + 2 non-Blog) |
| `en` total | 8,110 | 8,109 |

The distinct-URL gap is **closed**: the record with no `url` was the sole cause. The two quarantined
records carry `_quarantine_reason` `SEARCH_PARAMS_AS_DOCUMENT` and `UNCLASSIFIED_DASHBOARD_RECORD`,
each with a `_quarantine_note` recording what it was and why it went.


**The demo searches 7,899 records, not 11,930.** Documentation, Support and Academy are English-only
and lose almost nothing. Every localised source loses roughly two thirds.

#### What this changes about sequencing

For planning the next source, the number that matters is the demo-visible column, not the total:

| next source | total | demo-visible |
|---|---:|---:|
| Customer Stories | 237 | **72** |
| Documentation | 4,337 | **4,258** |

Customer Stories is 72 useful records, not 237. Documentation is 4,258 — **59× more demo-visible
value**, because it is English-only. That inverts the "cleanest source first, Documentation last"
sequencing, which was chosen on total counts. Recorded as a finding, not yet a decision.

#### A correction this replaces

An earlier version of this validation reported language triplication — the same article appearing
three times in a result list — as the largest outstanding problem, measured at 30–60% redundancy in
the top 10. **That was an artefact of an unfiltered test harness.** Re-run under the demo's real
filters, redundancy is **0 on all ten queries**. A `content_id` / `attributeForDistinct` change was
scoped at about two hours to fix it; it would have fixed nothing the demo experiences and was not
done.

---

## 2. The defect that cost the most: a gate asked too late

The first full run quarantined **589 of 2,800** records. The gates were doing their job; they were
doing it at the wrong moment.

Census of why those 589 failed:

| class | records | what the gate objected to |
|---|---:|---|
| `REVERSAL` | 364 | the page contradicts the span in its *next* sentence |
| `MISSING_SUBJECT` | 80 | the abstract opens with "It"/"They" and names nothing |
| `SELF_REFERENCE` | 71 | "in this article", "in this post", "this page" |
| `SPANS_TOO_FAR` | 56 | picks stitched from opposite ends of the document |
| `EXCLUDED_SECTION` | 45 | span taken from "Next Steps", "Common mistakes" |
| `CHROME` | 19 | cookie/consent/newsletter text |
| `INCOMPLETE_SPAN` | 3 | mid-sentence cut with no grounded completion |

**Every one of those verdicts is decidable from the page before the model picks anything.**
`followed_by`, `section` and the span text are all properties of the *candidate*. Running the check
after selection meant one bad sentence killed a whole record — on pages that carried, in the median
case, about a hundred other usable sentences.

### 2.1 The fix: make the bad answer unpickable

This is the same move the project had already made twice and not generalised. `candidates.py` made
fabrication unrepresentable by having the model return integers. `pool_filters.py` made site
furniture unpickable by deleting it from the menu. `pool_gates.py` extends that to the remaining
gates: a candidate that *would* fail a gate is either repaired or removed before the menu is
rendered, so the gate has nothing left to fire on.

The bans are computed by calling **span_gate's own predicates**, never by re-implementing them. A
second copy of a rule is a rule that drifts, and this repo has paid for that twice already.

What it did across the 589 records, counted per candidate:

| pool action | candidates |
|---|---:|
| `REVERSAL_EXTENDED` — extended over its own contradiction, kept | **1,180** |
| `EXCLUDED_SECTION` — removed | 613 |
| `REVERSAL_UNREPAIRABLE` — removed | 480 |
| `BLACKLIST` — self-reference / chrome / dominant CTA | 308 |
| `EXCLUDED_SECTION_EXTRA` — signup, webinar, support, nav | 114 |
| `SPEECH_QUOTE` — someone else talking | 58 |
| `EXTENSION_DUPLICATE_TITLE` — extension grew into the title | 4 |

The median menu shrank only from 100 candidates to 96. The ban is nearly free.

**Reversal is repaired before it is banned**, per the standing ruling that a bad span is a bad
*cut*, not a bad page. When the page states the contrast in its next sentence, the span is extended
over it — `canon.text[a:b]`, one contiguous slice — and both halves are kept. That preserved 1,180
candidates that a ban-first rule would have thrown away. Nothing is written and no punctuation is
added; the extension is page text or it does not happen.

### 2.2 Three positional and set-level cases the ban cannot express

- **`MISSING_SUBJECT` is positional.** "It reorders them in real time" is a fine *second* span and
  a useless *first* one. Banning it from the pool would delete legitimate sentences, so it is
  labelled `[NOT-FIRST]` in the menu and banned only on the retry a subject failure triggers.
- **`SPANS_TOO_FAR`, mixed languages, section spread and information gain are properties of the
  SET**, not of any candidate. No per-candidate ban can express them.
- Both are handled by a **bounded retry ladder** in `enrich_run.process()`: a gate failure names
  what was wrong, that narrows the menu, and the writer is asked again. Maximum three attempts,
  and it stops early whenever the failure yields no ban hint — asking the same question of the same
  menu returns the same answer and would only burn a call.

Result on the 589: **588 recovered, 1 left quarantined.** Writer calls per record: 533 needed one,
50 needed two, 6 needed three.

The one that stayed quarantined is a code-heavy tutorial
(`building-a-store-locator-in-react-…-part-3`) whose abstract candidates are mid-sentence cuts the
page never completes. Three attempts, 205 candidates banned, then it stopped. It exhausted the
ladder rather than failing on first refusal, which is the standard the work was held to.

---

## 3. The second defect class: `canonicalise` was not idempotent

This one is subtler and it surfaced four separate times over two days, looking like a different bug
each time.

`span_gate.canonicalise()` does **two jobs that want opposite things**:

1. it is the **lookup key** for "is this span on the page?", which wants aggressive normalisation
   so a curly-vs-straight apostrophe does not cause a false rejection;
2. it is also the text that gets **stored** in `abstract_enriched`, which wants to be exactly what
   the page says.

Every rule added to help job 1 silently edits the artifact for job 2.

And it has **two implementations** — the main character loop, and a separate inner loop for
markdown link labels. Every rule must be written twice. Five rules; the label loop had two of them.

| rule | main loop | label loop |
|---|---|---|
| `_FOLD` (curly quotes, dashes) | yes | **was missing — fixed** |
| space-before-closing-punctuation | yes | **was missing — fixed** |
| `_SPACEY` (`\|`) | yes | still diverges |
| `_TAG` (`<b>`) | yes | still diverges |
| `_LINE_LEAD` (`-`, `#`) | yes | still diverges |

The rule itself was also **wrong independently of the two loops**. It dropped the space before any
of `,.;:!?`. That is right for `points , with` — a typo models silently correct — and wrong for a
*leading* mark, where the space is real. So `Algolia has a .NET API Client` was stored as
`a.NET`, `your .env` as `your.env`, `as .vtt` as `as.vtt`.

Consequences, all real, all found by comparison rather than by reading:

| symptom | records | rule |
|---|---:|---|
| `don’t` inside a link stayed curly; outside it folded to straight | 3 | `_FOLD` |
| `your .env` stored as `your.env` | 12 | space-before-punct |
| offset map points a synthesised space at the next character | — | whitespace collapse |

The 12 were in **already-accepted, already-validated output**. They only surfaced because the fix
made the stored text no longer findable in its own page — which is the correct behaviour of a
correct comparison against text that was wrong all along.

### 3.1 What was actually fixed, and what was not

Fixed: both rules, in both loops, plus `tests/test_canonicalise_idempotent.py`, which asserts the
real invariant — `canonicalise(canonicalise(x)) == canonicalise(x)`. That is the class-level guard:
any future divergence touching a tested character fails immediately instead of shipping into the
corpus.

**Not fixed:** three rules still diverge between the two loops. They currently bite zero records —
verified, not assumed: the full-corpus census located all 21,780 spans, so no stored span depends
on them. That is luck, not design. Two options, recorded in §9.

---

## 4. How the 589 were repaired without touching accepted work

The repair reused **the exact cached Scout bodies the failing run was given**. Re-fetching would
have changed the source under the comparison and could not have answered the only question that
mattered: was the refusal about the page, or about the selection? Same bytes in, so any difference
in outcome is the pipeline's.

`make_quarantine_batches.py` builds a batch set from a prior run's *result set* rather than from the
work queue, and pre-seeds the fetched manifest so `run_batches.py` finds a complete cache and never
calls the fetcher.

The folder precedence that defines the effective corpus used to live only as prose in a handover
note, which meant every consumer re-derived it. It is now `EFFECTIVE_ORDER` in
`make_quarantine_batches.py`, imported by the census rather than re-typed.

---

## 5. Validation: against the index, not the artifact

An artifact says what we *intended* to write. Only the index says what is *served*. Those have
disagreed on this project before — an index survived a full day after being reported deleted,
because the claim was checked against the filesystem and never against the account.

So validation runs at two levels.

### 5.1 Full-corpus census of the local artifact

`census_blog_quality.py` — every enriched record, re-checked against its cached Scout body with the
code as it stands. No sampling, per the standing rule.

```
enriched records   : 2,693
spans checked      : 21,780
grounding          : 9,588 byte-exact + 12,192 canonical = 21,780 / 21,780
grounding failures : 0
leakage failures   : 0
quality defects    : 0   (all seven classes, re-checked on the stored bytes)
```

This pass is what found the 12 canonicalise casualties. The per-run packets never could have: each
one saw only its own folder, and the accepted records had been validated under the *old*
canonicaliser. **A grounding verdict computed with a different comparison function is not evidence
about the current one.**

### 5.2 Live E2E validation

`verify_blog_e2e_live.py` — 30 gates, read-only, 13 API calls, all searches plus one settings GET.

```
gates run: 30  passed: 28  failed: 2
FAILED GATES: 8a no pipeline/audit metadata on live records,
              9 enrichment fields are searchable
```

What passed, measured off the live index:

| check | measured |
|---|---|
| main index records | 11,930 |
| main Blog records | 2,694 |
| Blog with `abstract_enriched` | 2,694 |
| Blog with `keyhighlights_enriched` | 2,694 |
| Blog records missing either field | 0 |
| Blog: one record per URL, no null URLs | 2,694 / 2,694 distinct |
| quarantine index records | 106, all `source: Blog` |
| quarantine reasons | 104 `DEAD_PAGE`, 2 `NO_ABSTRACT_THIN` |
| quarantine reason matches artifact **per record** | 106 / 106 |
| quarantined objectIDs still in main | 0 |
| live payload vs intended payload | 2,694 byte-identical, 0 missing, 0 mismatched, 0 extra |
| **live spans grounded** | **21,790 / 21,790** (9,597 exact + 12,193 canonical) |
| leakage failures | 0 |
| dead-page records enriched live | 0 |

Two design points in that list are load-bearing:

- **The quarantine reason is checked per record, not by total.** Matching totals with swapped
  labels would pass a count-only check.
- **The Blog set is walked in per-language shards** because the search key has no `browse` ACL and
  pagination is capped at 1,000. The shard sum is reconciled against the facet count, so a silent
  truncation shows up as a mismatch instead of as a clean pass.

---

## 6. What is written to a live record, and why it is so little

```json
{
  "abstract_enriched":      ["span one.", "span two."],
  "keyhighlights_enriched": ["bullet one", "bullet two", "bullet three"]
}
```

Two fields, both arrays of verbatim page spans. Nothing else. No verdict, no judge score, no
offsets, no model ID, no prompt version.

`abstract_enriched` is an **array**, not a joined string. The local artifact also carries an
`abstract_enriched` *string* — the spans joined with a space — which is a convenience field and is
never written. Confusing the two is not hypothetical: the first run of the live validator compared
live-array against artifact-string and reported **2,694 of 2,694 records as mismatched**. A 100%
failure rate is almost always the comparison, not the data.

**The judge does not gate.** `PASS` and `JUDGE_REVISE` are both writable, and across 3,069 rows the
judge's verdict changed zero outcomes. It is advisory. The guarantee is the script — integer
indices into a menu the script built — not the judge. Drop the judge and zero-invention survives;
drop the script and there is only reassurance.

---

## 7. The two open failures, and how they were closed

Neither was caused by the enrichment. Both were remediated on 2026-08-10 under explicit
instruction, with a snapshot taken first because this index has no rollback.

### 7.1 Five live records carried pipeline metadata — FIXED

```
de_c24c5190-0199-4e64-8afc-c588db1bdee9
de_4987b9ed-6862-4112-86b7-91bffd526df3_0_1
en_4987b9ed-6862-4112-86b7-91bffd526df3_0_1
fr_c24c5190-0199-4e64-8afc-c588db1bdee9
fr_4987b9ed-6862-4112-86b7-91bffd526df3_0_1
```

Each carried **twelve** fields that do not belong on a served record: `enrichment_verdict`,
`enrichment_judge_scores`, `enrichment_span_offsets`, `enrichment_writer_model`,
`enrichment_judge_model`, `enrichment_prompt_version`, `enrichment_content_hash`,
`enrichment_fetch_path`, `enrichment_truncated`, `enrichment_fetched_at`,
`enrichment_source_url`, `enrichment_validated_at`.

The gate first reported **nine**, not twelve. It matched a hand-written marker list, and three
fields matched none of the markers — so an enumeration had quietly become the definition of "audit
metadata". The gate now tests the `enrichment_` **namespace** first and uses the marker list only
to catch strays outside it. The cleanup removed all twelve regardless, because it was built from
each record's own keys rather than from the detector's list.

These were survivors of an early pilot write; `write_enrichment.py` has shipped a lean payload
since 2026-08-09.

**Fixed by full-record replace**, not `partialUpdateObject` — a partial update cannot *remove* an
attribute, and setting one to null stores a literal null. Pre-flight: `unretrievableAttributes` and
`attributesToRetrieve` are both null and there are no replicas, so a full fetch returns every
attribute and a replace loses nothing. Verified after: fields 39→27 and 38→26, **0 leftover**
`enrichment_*`, both enrichment fields byte-identical to the pre-write snapshot on all 5, no other
attribute lost.

### 7.2 The enriched fields were not searchable — FIXED, after breaking `abstract` for two minutes

```
searchableAttributes = ["title", "unordered(abstract)", "unordered(description)",
                        "unordered(tags)", "unordered(keywords)", "unordered(category)",
                        "unordered(url)"]
```

Both were absent, so all 2,694 enriched records changed zero search results — demonstrated, not
assumed: phrases stored verbatim in live records returned **0 hits**.

**The first fix attempt broke production.** The documented same-priority form puts two attributes in
one comma-joined string. Algolia stripped the outer wrapper and stored a single garbage attribute
name:

```
sent:   "unordered(abstract),unordered(abstract_enriched)"
stored: "abstract),unordered(abstract_enriched"
```

That silently removed `abstract` from the searchable set — a live relevance regression on the whole
index, not just Blog. It was caught because the verification probe still returned 0 hits for a
phrase that should have matched, and because the settings were **re-read** rather than trusted.
Exposure window about two minutes: published 17:30:31, corrected 17:32:24.

The fix gives every attribute its own priority level, so nothing is nested inside `unordered()`:

```
["title", "unordered(abstract)", "unordered(abstract_enriched)", "unordered(description)",
 "unordered(tags)", "unordered(keywords)", "unordered(category)", "unordered(url)",
 "unordered(keyhighlights_enriched)"]
```

Cost of the nuance: `abstract_enriched` now sits one level **below** `abstract` instead of sharing
it. That is closer to the intent than a broken attribute name, and sharing a level can be revisited
deliberately.

**Proven by query, not by settings value.** A settings value is a claim; the test is whether text
stored only in `abstract_enriched` returns hits:

| phrase, stored verbatim in `abstract_enriched` | before | after | via that attribute alone |
|---|---:|---:|---:|
| `Rather than showing the same fixed set` | 0 | 3 | 3 |
| `Exact match testing obscures the agent's performance` | 0 | 3 | 1 |

`keyhighlights_enriched` is reachable too. And `abstract` is still independently searchable —
checked explicitly, because that is what the bad syntax had broken. Record and facet counts
unchanged: 11,930 records, Blog 2,694.

---

## 8. Three things this validation got wrong before it got them right

Recorded because a validator that has never been wrong has usually never been tested.

1. **Compared the wrong field** — live array vs artifact joined string, reporting 2,694/2,694 as
   mismatched. Corrected by reading `write_enrichment.py:78` to find what is actually written.
2. **Called a null-url record a duplicate URL** — inferred from subtracting two counts. Corrected
   by a full browse: 11,928 records, 11,928 distinct URLs, 0 duplicates.
3. **Reported a URL sweep that had silently truncated** — per-source shards above the 1,000
   pagination cap covered only 7,896 of 11,930 records. That result was discarded rather than
   reported.
4. **Under-reported the field-hygiene defect as 9 fields when it was 12** — the detector matched a
   marker list instead of the `enrichment_` namespace (§7.1).
5. **Broke `abstract` searchability with the same-priority settings syntax** and caught it only
   because the post-write probe was a query rather than a reading of the settings value (§7.2).

All three would have produced a confident, wrong report. The pattern in all three: a number that
looked decisive was an artefact of how it was measured.

---

## 9. Honest limits

- **Relevance is not measured.** Searchable is not the same as better. Only Blog is enriched, so
  the index is now asymmetric by design until the other seven sources land.
- **Three canonicalise divergences remain** (§3.1). They bite nothing today, verified by census.
  The cheap fix is to make the label loop call the main loop recursively — one implementation, all
  divergences gone, permanently. The correct fix is to separate the two jobs: store the raw page
  slice and use the canonical projection only as a comparison key, so no normalisation rule can
  ever edit stored output. The second changes what is already live in 2,694 records, so it is a
  decision, not a cleanup. **This is a labelled stopgap, not a completed class fix.**
- **Grounding is verified against the cached body the writer was given.** That proves no invention.
  It does **not** prove the live page still says it. A re-fetch census is a separate job.
- **`de/` and `fr/` Blog pages serve the English article** — probed live, byte-identical with and
  without a German `Accept-Language`. So an English abstract is the true description of an English
  page. Counted, not gated, and **blog-only**: every other source is properly translated and this
  ruling must not be generalised.
- **Quality was measured by gates, not by reading.** Roughly 10 of 2,694 abstracts have been read
  by a human. At that sample any defect below ~10% is invisible. Gates passing is not the same as
  a good abstract.
- **The 1 xfail in the suite is real and out of scope**: form-confirmation prose
  (`"Ihre Anfrage wurde erfolgreich übermittelt."`) is shape-identical to content prose, so
  shape-based detection cannot separate them. Needs a DOM-proximity or judge-side signal.
- **Blog is 2,800 of 11,930 records — 23.5% of the corpus.** Seven sources are untouched.

---

## 10. Reproduce it

```bash
# tests
python3 -m pytest docs/archive/enrichment/legacy-tooling/tests/ -q
# -> 472 passed, 1 xfailed

# full-corpus census of the local artifact, no sampling
python3 docs/archive/enrichment/legacy-tooling/census_blog_quality.py \
    --out reports/blog-corpus-census-20260810.json

# live E2E validation, read-only, 30 gates
python3 docs/archive/enrichment/legacy-tooling/verify_blog_e2e_live.py \
    --out reports/blog-e2e-live-20260810.json
```

| artifact | what |
|---|---|
| `docs/operations/enrichment/plans/PACKET-blog-e2e-live-20260810.md` | the live validation packet, verbatim outputs |
| `docs/operations/enrichment/reports/blog-e2e-live-20260810.json` | all 30 gates, every failure with objectIDs |
| `docs/operations/enrichment/reports/blog-corpus-census-20260810.json` | full-corpus census |
| `docs/operations/enrichment/plans/PACKET-blog-quarantine-repair-20260810.md` | the 589-record repair, 10 before/after |
| `docs/archive/enrichment/legacy-tooling/pool_gates.py` | gates as pre-selection bans |
| `docs/archive/enrichment/legacy-tooling/tests/test_pool_gates_live_path.py` | drives `process()`, not the helper |
| `docs/archive/enrichment/legacy-tooling/tests/test_canonicalise_idempotent.py` | the idempotence guard |

---

## 11. What this unblocks, and what it does not

**Unblocked:** the methodology is now proven end to end on a real source, including two defect
classes discovered the hard way. Customer Stories (237 records) is next and is the cleanest
remaining source; Documentation (4,337) is the hardest and should be last.

**Not unblocked:** any claim that enrichment has *improved* search. The fields are now searchable
and return hits, which is a **capability** check, not a quality one. Relevance impact is unmeasured,
and because only Blog is enriched — 2,694 of 11,930 records — results now skew toward Blog. That is
expected, and it is the next thing worth measuring.
