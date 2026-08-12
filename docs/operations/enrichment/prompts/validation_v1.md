---
title: "Abstract enrichment validation — v1"
status: draft, not yet run
pairs_with: abstract_enrichment_v1.md
split: 9 scripted gates (the guarantee) + 1 LLM judge (quality only)
---

# Validation — v1

## The split, and why it is this way round

The scripted gates decide whether a record is **safe**. The LLM judge decides whether it is
**good**. Those are different questions and only the first one can be guaranteed.

Every gate that protects against hallucination is a string operation. No model votes on whether
a fabrication occurred, because a model's vote is an opinion and Arijit asked for zero.

**Order matters.** Gates run before the judge. A record that fails a gate never reaches the
judge, so we never spend a model call arguing about text that is already disqualified.

---

## Part 1 — scripted gates

All nine run on every record. Any failure quarantines the record; nothing partial is written.

### G1 — verbatim containment (the guarantee)

For every span in `abstract_spans`, `keyhighlights_spans` and `verdict_evidence`:

```
source.find(span) != -1
```

Exact. No normalisation, no case-folding, no whitespace collapsing — because normalising is
exactly where a paraphrase would slip through. Record the character offset of each span; it is
stored as provenance and it is what makes Chapter 4 re-verifiable without a re-fetch.

**This gate is the entire zero-hallucination claim.** Everything else is hygiene.

### G2 — no fabricated numbers, dates or entities

Belt and braces on G1, and it catches a specific failure G1 cannot: a model that copies a real
span but from the *wrong* page (a stale cache, a mixed-up batch).

Extract from the joined output every: digit run, percentage, currency amount, date, version
string, and capitalised token sequence. Each must appear in the source. Any that does not is a
hard fail and is logged with the record — that pattern means a batching bug, not a bad abstract.

### G3 — span integrity

- No span is empty or whitespace-only
- No span contains another span
- No span is duplicated within or across the two arrays
- `abstract_spans` length within the family's `expected_span_count`
- `keyhighlights_spans` length 0–8
- Each highlight span ≤ 300 characters

### G4 — subject presence in span 1

`abstract_spans[0]` must contain at least one of: a capitalised token that is not the first word
of the sentence, a token from `title`, or a digit. Blocks the context-free opener
("It also supports…") that reads as meaningless in a search result.

### G5 — language match

`language_observed` must equal the record's `language_code`. Additionally, run a scripted
language detector over the joined spans and require it to agree. A mismatch is **not** a
failure to hide — it is quarantined and counted, because on 3,887 fr/de records a systematic
mismatch would mean the site is serving English at a localised URL, which is a finding worth
more than the abstract.

### G6 — no chrome, no self-reference

Reject any span matching the chrome blacklist (cookie/consent, newsletter, "related articles",
"share this", author bio, footer legal) or the self-reference blacklist ("in this guide",
"this page", "this article will", "read on to", "we'll show you"). Blacklist is a versioned
file; every addition is dated in the build log.

### G7 — information gain

The joined `abstract_enriched` must contain at least 8 content tokens (stopwords removed) that
appear in neither `title` nor `description`. A record already exists 3,340 times where
`abstract == description` byte-for-byte — restating the title is a proven failure mode in this
index, not a hypothetical one.

### G8 — template collision, whole-corpus

Not per record. After the run, hash the first 8 tokens of all `abstract_enriched` values and
count. Any prefix appearing more than 20 times is a template, not an abstract — the whole
cluster is quarantined and the prompt is revised. This is the only slop check that can catch
sameness, because sameness is invisible from inside a single record.

### G10 — misleading selection (catches imagination, not hallucination)

Added 2026-08-07 after an adversarial probe put four **fully verbatim** abstracts past G1–G7.
Verbatim means the words are on the page. It does not mean the page says this.

| Check | Catches |
|---|---|
| blockquote spans rejected unless family is `evidence` | a customer's line about a *competitor* stored as Algolia's own claim |
| **reversal lookahead** — next 140 chars open with *It does not / However / In fact / Actually / Incorrect* | the meaning-inversion class: page says *"Teams often assume vector search alone improves relevance. It does not."* — selecting only the first sentence reverses it |
| section deny-list — Common mistakes, Troubleshooting, Deprecated, Legacy, Changelog, Testimonial, Related reading, Next steps | a deprecated product presented as current |
| ≤2 distinct sections, spans within 8,000 characters | an abstract stitched from opposite ends of a 278,634-character page |

Requires structure that canonicalisation would otherwise destroy: it strips `>` and `#`, so
section and quotation are captured per character while still visible.

**What G10 does not close:** two true sentences from legitimate sections that together imply
something neither states. Only the extremes are mechanical. The rest is the judge's
`juxtaposition` dimension and is **not guaranteed.**

### G9 — provenance completeness

Every written record must carry the full audit block, or it is not written:

```
abstract_enriched
keyhighlights_enriched
enrichment_source_url        the URL actually fetched
enrichment_fetch_path        scout | doc-md-twin | zendesk-api
enrichment_content_hash      Scout content_hash, or sha256 of the markdown
enrichment_fetched_at        Scout fetched_at
enrichment_span_offsets      [[start,end], ...] per span, from G1
enrichment_verdict           REAL | DEAD | THIN
enrichment_model             writer model id
enrichment_judge_model       judge model id
enrichment_prompt_version    abstract_enrichment_v1
enrichment_validated_at      timestamp
```

`enrichment_span_offsets` is the point of the whole block: any future session can prove any
abstract against the stored hash without re-fetching the page.

---

## Part 2 — the LLM judge

Runs only on records that passed G1–G7. Because G1 already proved every word is on the page,
the judge is **not** asked "is this hallucinated" — that question is settled. It is asked the
question a script cannot answer.

**A different model from the writer.** Same model judging its own selection shares its blind
spots and inflates agreement.

```text
You are reviewing an extraction, not writing one. Every sentence below was copied verbatim
from the page — that is already machine-verified, so faithfulness is not your concern.

Judge only this: does this selection represent the page?

  PAGE_TYPE : {{PAGE_TYPE}}
  TITLE     : {{TITLE}}
  ABSTRACT  : {{ABSTRACT_ENRICHED}}
  HIGHLIGHTS: {{KEYHIGHLIGHTS_ENRICHED}}
  PAGE      : {{PAGE_MARKDOWN}}

Score each 1-5 and quote your evidence from the page:

  representativeness  Does the abstract convey what this page is mainly about, or did it pick
                      a peripheral sentence?
  specificity         Would this help someone scanning search results decide to click, or is
                      it generic enough to describe a hundred other pages?
  missed_substance    Is there a materially more informative sentence on the page that was
                      passed over? If yes, quote it verbatim.
  coherence           Do the spans read as belonging together?
  juxtaposition       Read the spans as one paragraph. Does the COMBINATION assert anything
                      the page does not actually say? Two true sentences side by side can
                      imply a causal or conditional link that neither states. Score 1 if the
                      pairing misleads, even though every sentence is individually accurate.
                      This is the one failure the scripted gates cannot settle, so it is the
                      dimension that most needs your attention.

Return JSON:
{
  "representativeness": 1-5,
  "specificity": 1-5,
  "missed_substance": 1-5,
  "coherence": 1-5,
  "better_span_available": null | "<verbatim span from the page>",
  "verdict": "ACCEPT" | "REVISE"
}

Return REVISE when any score is 1 or 2. When you propose better_span_available it must be
copied verbatim from PAGE — it is substring-checked exactly like the writer's spans, and an
invented suggestion fails your review, not the writer's.
```

### Gate B — the judge is checked too

The judge's `better_span_available` runs through G1. A judge that cannot produce a real span
has its verdict discarded. This is what stops "looks fine to me" reviewing, and it is the
reason the judge is useful rather than decorative.

---

## Part 3 — disposition

| Outcome | Action |
|---|---|
| All gates pass, judge ACCEPT | write |
| Gates pass, judge REVISE | one retry. **The judge does not review the retry** — see below. Retry re-runs every scripted gate. |
| Retry still REVISE | quarantine. **Never write a third attempt.** |
| Any scripted gate fails | quarantine immediately, no retry, no judge call |
| Verdict DEAD | no abstract. Quarantine for Arijit's delete decision. Never auto-deleted. |
| Verdict THIN | no abstract. `enrichment_verdict: THIN` is written so the gap is visible and countable rather than silent. |

**Repair is capped at one attempt on purpose.** A writer allowed to re-roll until a judge
blinks is how a bad record gets laundered into production.

### The self-agreement loop, and how it is broken

v1.0 had a rubber stamp in it: the judge proposed `better_span_available`, the writer used that
span on retry, and the judge then reviewed its own suggestion and approved it. Two model calls,
one opinion, dressed up as independent review.

Fixed by three rules:

1. **The judge never reviews a retry.** Its verdict on attempt 1 is its only vote.
2. The retry gets the judge's *critique dimension* ("the abstract was not representative") but
   **not** its suggested span. The writer re-selects from the page itself.
3. If attempt 2 passes the scripted gates, it is written. The scripted gates are the authority —
   they are the ones that can prove something.

The judge's `better_span_available` is still collected and logged, because a pattern of the same
kind of miss across many records is a prompt defect worth fixing at source. It is evidence for
revising the prompt, not an input to the record.

## Part 4 — the final census

The run is not done when the loop finishes. Re-read all written records from the live index and
re-run G1 against the stored markdown. Report the failure count as a number.

Not a sample — the whole set. If G1 fails on even one record post-write, the write path
corrupted something and the run is void. This is the check that would have caught four of the
six failures listed in SESSION.md, all of which were claims verified against a proxy instead of
the surface the claim was about.
