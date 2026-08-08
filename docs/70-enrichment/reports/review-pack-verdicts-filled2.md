# Sign-off — Review pack, English pages only

Companion to the pack generated 2026-08-08 from `reports/fresh50-v12/`, config
`abstract_enrichment_v1.2` (writer `glm-5.2`, judge `gemini-2.5-pro`).
Blocks below are in pack order and can be pasted into the `VERDICT:` slots.

> **Why this is a separate file.** The pack's evidence value rests on the `>>>` markers
> coming from the pipeline. Re-emitting a hand-copied pack would put a human transcription
> between the reader and that evidence. Keyed companion instead.

---

## Result

**5 good · 5 not good · 0 HALLUCINATION**

| # | Type | Verdict |
|---|---|---|
| 1 | event | not good |
| 2 | doc-rest-api | not good |
| 3 | doc-rest-api | not good |
| 4 | product-page | good |
| 5 | doc-tool | good |
| 6 | doc-rest-api | not good |
| 7 | press-release | not good |
| 8 | blog-post | good |
| 9 | case-study | good |
| 10 | blog-post | good |

**No hallucinations.** Records 1 and 2 were additionally checked against the live pages
(`web_fetch`, same day as the run). Every sentence appeared verbatim, and every `PAGE`
context was accurate. The stop condition is not invoked.

The judge's own scores imply 8 good / 2 wants-a-better-sentence. The divergence is not
disagreement about fidelity — it is that the judge's third dimension scored 5/5 on all ten
records, including three records with sentences that do not survive being lifted off the page.

---

## Filled verdict blocks

### 1. event — https://www.algolia.com/devcon

```
VERDICT:  not good
notes:    Summary is a fair description of the page. Key points fail Q2 outright: the three
          Connect / Grow / Build tiles carry no information a reader could act on.
          The decisive omission is that the page states "Sept 30 - Oct 1, 2026 - VIRTUAL"
          under the heading "Building in the era of AI Search", and none of it reaches the
          summary or the key points, because none of it is a sentence. For an event record,
          date and format are the whole value in a search result. Judge scored specificity
          5/5; disagree.
          Live check: all five sentences verbatim, contexts accurate. Two lesser notes -
          the summary's sentences appear in reverse page order, and the page's own
          "WATCH THE REPLAYS" plus zeroed countdown make the stored summary tense-ambiguous
          (on first read I took it for a past event).
```

### 2. doc-rest-api — https://www.algolia.com/doc/rest-api/search

```
VERDICT:  not good
notes:    Summary describes the Client libraries section, not the Search API. Agree with the
          judge's 2/5.
          Live check establishes this is a selection bug, not a method ceiling: the page
          carries its own description in a blockquote directly under the H1 - "The Algolia
          Search API lets you search, configure, and manage your indices and records" - and
          the extractor passed over it for the first sentence of the following section.
          Key point 1 dangles. On the page, "If your subscription includes a Distributed
          Search Network, this ensures..." is a sub-bullet hanging off the -dsn base URL;
          lifted out, "this" has no referent. Key points 2-5 are shared REST boilerplate.
```

### 3. doc-rest-api — https://www.algolia.com/doc/rest-api/recommend

```
VERDICT:  not good
notes:    Weakest record in the pack. Neither summary sentence says anything about
          recommendations; both are generic REST boilerplate. Key points 3-6 are the
          2xx / 4xx / 5xx / message block split into four separate points, and they are the
          same four sentences already stored for records 2 and 6. Agree with the judge's
          1/5 and 1/5.
```

### 4. product-page — https://www.algolia.com/products/ai/agent-studio

```
VERDICT:  good
notes:    Summary is an accurate and useful definition; key points are specific and
          non-overlapping. Two things to fix before this pattern ships at scale:
          (a) key point 4 is stored with a leading "0" - accordion widget state leaking into
              the field. Strip it.
          (b) both summary sentences come from the FAQ accordion at the foot of the page
              rather than the main body. It works here, but worth knowing that is where the
              selector is finding its best prose on commercial pages.
```

### 5. doc-tool — https://www.algolia.com/doc/tools/cli/authentication

```
VERDICT:  good
notes:    Best record in the pack, no reservations. The three-sentence summary describes the
          page accurately and completely, and all five key points are specific and
          self-standing.
          Diagnostically useful: this is the same reference family as records 2, 3 and 6, and
          the only difference is that this page opens with real prose. That is the whole
          story of those three failures.
```

### 6. doc-rest-api — https://www.algolia.com/doc/rest-api/query-suggestions

```
VERDICT:  not good
notes:    Marked on the key points alone. The summary is genuinely good - it explains what
          Query Suggestions is and why someone would want it - and needs no change.
          Key point 1 ("Use the URL that matches your analytics region") is meaningless once
          separated from the two base URLs it follows. Key points 2, 3 and 4 are the shared
          boilerplate, identical or near-identical to records 2 and 3.
```

### 7. press-release — https://www.algolia.com/about/news/algolia-brings-agentic-commerce-to-the-modern-storefront

```
VERDICT:  not good
notes:    The summary's first sentence opens "closes this gap by...". The gap is defined in
          preceding page text that is not included, so read cold in a search result the
          sentence has no subject matter. Clearest instance in the pack of the defect class
          the judge scored 5/5 on all ten records.
          Key points 3-5 are About-Algolia and awards footer material rather than the
          announcement. Key point 5 additionally has CTA link text ("Download the TEI study")
          welded onto the end with no terminal period.
          Fix the first sentence and drop 3-5 and this becomes good.
```

### 8. blog-post — https://www.algolia.com/blog/ai/language-model-training

```
VERDICT:  good
notes:    No reservations. Summary is specific and accurate, and all seven key points are
          self-standing and are the things a reader would actually want: 90-day retention,
          EU/US regionality, Elevate-plan scope, HIPAA exclusion, opt-out. Extraction works
          well on explanatory blog prose.
```

### 9. case-study — https://www.algolia.com/customers/crocs

```
VERDICT:  good
notes:    Summary accurate. The quantitative key points (1-3) survive extraction intact, and
          the 175% figure in the summary is consistent with key point 2.
          One note only: key point 4 is a single 45-word sentence doing the work of a feature
          list. Acceptable, but at the upper limit of what reads well in a search result.
```

### 10. blog-post — https://www.algolia.com/blog/algolia/spain-won-the-world-cup-and-search

```
VERDICT:  good
notes:    Strongest three-sentence summary construction in the pack. Two notes, neither
          fatal:
          (a) key point 5 opens "Product data must therefore be..." - dangling connective.
          (b) the key points are the bodies of the four numbered lessons with the lesson
              headings dropped, so "Demand can spike without warning" - the actual point - is
              lost while its supporting sentence is kept. Consider allowing headings as
              key-point candidates.
```

---

## Cross-cutting findings

### 1. The failures are one page type, not scattered noise

All three hard failures are `doc-rest-api`. Record 5 is the same reference family and passes,
because that page opens with prose. Reference pages lead with boilerplate, so boilerplate is
what gets extracted.

Record 2 shows part of this is fixable selection logic rather than a ceiling: the ideal summary
sentence was present on the page, in the description blockquote under the H1, and was skipped.

The mechanism is visible in the pack's own `PAGE` lines — they are flattened text. The live
pages are served as markdown with headings and a description blockquote. Once that structure is
discarded, a sentence under `## Response status and errors` competes on equal footing with the
page description.

**Two fixes fall out:**
- Weight the description blockquote and lead paragraph above body sentences.
- Blacklist the shared boilerplate block — "Successful responses return 2xx statuses",
  "Request bodies must be JSON objects", the `/1/` version sentence — which currently ships in
  records 2, 3 and 6 as though it were page-specific content.

### 2. Sentences that do not survive being lifted

Record 7 summary ("this gap"), record 2 key point 1 ("this ensures"), record 10 key point 5
("must therefore"). Record 10 also drops the section headings that carried the actual lessons.

A leading demonstrative or connective with no antecedent in the selected span is mechanically
detectable. This class can be rejected before a human ever sees it, and should be, because the
judge does not catch it.

### 3. Scrape artifacts are reaching stored fields

Record 4 key point 4 has a leading `0` from accordion state. Record 7 key point 5 ends with
link text and no terminal period. Both would ship as-is. Neither is a fidelity problem —
both strings are on the page — which is precisely why the `>>>` proof does not catch them.

### 4. One judge dimension is not discriminating

"Do the sentences mislead when read together" scored 5/5 on all ten records, including the
three with dangling references. Zero variance means zero information, but it does lift the
headline:

| dimension | mean |
|---|---|
| represents the page | 4.3 |
| specific enough | 4.4 |
| does not mislead | 5.0 |
| **all three** | **4.57** |
| **excluding the saturated dimension** | **4.35** |

The 4.62 vs 2.88 comparison cannot be checked from this pack. The improvement is probably real;
if the same saturated dimension sits in both figures, the level is overstated.

### 5. Sampling risk is composition, not just size

The pack is candid about 10 of 10,198 and frames the residual risk as sample size. The sharper
risk is which types those 10 were. Reference-family pages are plausibly a large share of an
Algolia corpus, and that is exactly the family running near a zero pass rate.

**7/10 does not extrapolate.** What is needed before the full run is pass rate per page type,
weighted by each type's share of the 10,198.

### 6. Downstream, not a pipeline defect

Record 7 stores "1.75 trillion searches ... 18,000 businesses"; record 10 stores "nearly
2 trillion ... more than 18,000 companies". Both are faithful to their pages. Sitting adjacent
in one index they will read as an error.

---

## On the review instrument

The pack offers `good`, `not good`, and a project-stopping `HALLUCINATION`. Records 2, 3 and 6
are faithful *and* systematically unfit, and there is no verdict for that. Worth adding one, so
that the only way to register a structural objection is not the destructive lever.

## What this sign-off supports

The method produces abstracts worth having **on pages that contain their own prose summary** —
records 5, 8, 9, 10 are good work, and 4 is good with a field-cleaning fix.

It does not support the full run, and not only for the reasons the pack already gives (~1%
fetched, staged write still needed). It should not proceed on `doc-rest-api` or any page type
whose lead content is boilerplate until findings 1 and 2 are addressed and the per-type pass
rates are known.
