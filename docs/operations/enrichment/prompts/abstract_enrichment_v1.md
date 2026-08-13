---
title: "Abstract enrichment prompt — v1"
status: draft, not yet run
chapter: docs/customer-documentation/enrichment/chapter-3-content-enrichment.md
produces: verdict · abstract_enriched · keyhighlights_enriched
guarantee: zero hallucination by construction — output is verbatim spans only
---

# Abstract enrichment prompt — v1

## The one rule this whole design rests on

**The model points. The script cuts.**

The model returns spans it believes matter. Those strings are used **only to locate the text in
the source**, and are then thrown away. `span_gate.py` slices the corresponding characters out
of the page markdown itself, and *that* slice is what gets stored.

So the indexed value is, by construction, text that came off the page. Hallucination is not
"checked for" — it is unrepresentable. There is no code path by which a word the model invented
reaches the output.

> **Revised 2026-08-07 (v1.1).** v1.0 asked the model to copy character-for-character and
> compared strings exactly. That was wrong, and would have quarantined most of the corpus for
> reasons unrelated to hallucination: markdown hard-wraps sentences, so a faithful model writing
> a space where the source has a newline failed the check. Both sides are now canonicalised
> (whitespace collapsed, emphasis/link/tag syntax removed) before matching. Canonicalisation only
> ever deletes formatting and collapses whitespace, so it can never introduce a word — the proof
> survives intact and the false-rejection problem disappears. See `chapter-3-build-log.md` D-009.

Consequences, all of them wanted:

| | |
|---|---|
| Hallucination | structurally impossible, not merely unlikely |
| Invented numbers, dates, customer names | impossible — the top hallucination vector, gone |
| Translation leakage on the 3,887 fr/de records | impossible — a French page can only yield French spans |
| Reproducibility | a span either is in the source or is not, forever |
| Verification | one substring check, no second model's opinion required |

The trade: the abstract reads as the page's own sentences, not smooth original prose. Accepted
deliberately. See `chapter-3-build-log.md` § D-002.

## Inputs the loop supplies per record

| Placeholder | Source | Why the model needs it |
|---|---|---|
| `{{URL}}` | record `url`, absolutised | disambiguates locale and section |
| `{{TITLE}}` | record `title` | the page's own subject, for the pronoun rule |
| `{{SOURCE}}` | record `source` — 8 values | tone expectation |
| `{{PAGE_TYPE}}` | record `page_type` — 43 values | precise shape |
| `{{FAMILY}}` | derived, `shape-families.json` — 7 families | selects the instruction block below |
| `{{LANGUAGE_CODE}}` | record `language_code` — en/de/fr | language check |
| `{{FAMILY_INSTRUCTION}}` | `shape-families.json` | what to lead with, what counts as a highlight |
| `{{MIN_PROSE_CHARS}}` | `shape-families.json` | THIN threshold for this family |
| `{{SPAN_MIN}}` / `{{SPAN_MAX}}` | `shape-families.json` | expected span count for this family |
| `{{PAGE_MARKDOWN}}` | Scout, doc `.md` twin, or Zendesk API | the only permitted source of words |

`{{PAGE_MARKDOWN}}` is passed **unmodified**, including code blocks. Nothing is pre-cleaned:
the gate slices from exactly the bytes the model saw, so any pre-edit would shift offsets.

### Size policy — required, the tail is heavy

Median page is ~10,000 characters, but the `commercial` family runs to **278,634 characters**
(measured on `/competitors/compare-algolia-vs-coveo`). Passing that raw would blow the context
window and dominate cost.

| Rule | Value |
|---|---|
| Hard cap passed to the model | 60,000 characters of markdown |
| How it is cut | keep the first 45,000 and the last 15,000, joined by a marker line |
| Why both ends | the thesis is near the top; pricing tables, limits and metrics are near the bottom. A head-only truncation loses the numbers, which are what highlights are made of. |
| What the model is told | the marker line states text was removed, so it never treats the join as a sentence boundary |
| Recorded per record | `enrichment_truncated: true/false` and the original length |

Offsets stay valid because the gate canonicalises **the same truncated string** that was sent.
A page over the cap is flagged, so a later pass can revisit the long tail deliberately rather
than silently abstracting half a page.

### Worked examples given to the model

Two examples are prepended to every call — one REAL, one THIN. For a task this constrained,
showing the shape of a correct refusal is worth more than another paragraph of rules.

```text
EXAMPLE 1 — a documentation page
PAGE: "# Dynamic Facets\n\nDynamic facets **reorder** filters based on the user's query
intent. Requires at least 1,000 search events.\n\n- Available on all plans.\n"
CORRECT OUTPUT:
{"verdict":"REAL",
 "verdict_evidence":"Available on all plans.",
 "abstract_spans":["Dynamic facets reorder filters based on the user's query intent."],
 "keyhighlights_spans":["Requires at least 1,000 search events.","Available on all plans."],
 "language_observed":"en","insufficient_reason":null}
NOTE: the markdown ** was dropped — that is fine. No word was changed. verdict_evidence is a
different sentence from the abstract span.

EXAMPLE 2 — a hub page with nothing to say
PAGE: "# Resources\n\n- [Ebooks](/resources/ebooks)\n- [Webinars](/resources/webinars)\n
- [Reports](/resources/reports)\n"
CORRECT OUTPUT:
{"verdict":"THIN","verdict_evidence":"Resources",
 "abstract_spans":[],"keyhighlights_spans":[],
 "language_observed":"en","insufficient_reason":"LINKS_ONLY"}
NOTE: an abstract like "This page collects Algolia's ebooks, webinars and reports" would be
inferred from the link labels, not stated by the page. Returning nothing is the correct answer.
```

---

## The prompt

```text
You are an extraction tool operating on one web page. You do not write prose. You select
existing text from the page and label it.

PAGE METADATA
  url            : {{URL}}
  title          : {{TITLE}}
  source         : {{SOURCE}}
  page_type      : {{PAGE_TYPE}}
  shape family   : {{FAMILY}}
  expected language : {{LANGUAGE_CODE}}

ABSOLUTE CONSTRAINT — this is checked mechanically after you answer
  Every span you return in abstract_spans, keyhighlights_spans and verdict_evidence must be
  text that is ALREADY PRESENT in PAGE_MARKDOWN. Copy it out; do not compose it.
    - Do not paraphrase, summarise, shorten or smooth.
    - Do not translate. Return the language the page is written in.
    - Do not merge text from two different parts of the page into one span.
    - Do not fix typos or change wording, even when it is clearly wrong.
  You may safely drop markdown syntax (**bold**, `code`, [link](url), #, >, |) and you may
  write a wrapped sentence on one line. Formatting is normalised on both sides before the
  check, so those differences are harmless. Changing a WORD is not.

  A span whose words are not on the page discards the whole record.

WHAT YOU DECIDE
  Which sentences matter. That is a real judgement and it is the only judgement you make.

STEP 1 — VERDICT
  Read PAGE_MARKDOWN and classify the page:
    REAL  — a genuine content page carrying human-written sentences about a subject
    DEAD  — an error page, "not found" page, sign-in wall, or a page whose only content is
            an error or an invitation to log in
    THIN  — a real page with almost no prose: a link list, a menu, a bare table of
            contents, or nothing but code. Nothing was wrong with the fetch.
  Do not attempt to count characters. Prose length is measured by script before you are
  called; judge the page as a reader would.

  Return verdict_evidence: one span, copied from the page, that justifies your verdict. For
  DEAD, quote the error text. For THIN, quote the longest prose you found. For REAL, quote a
  sentence supporting the verdict that is NOT one of your abstract_spans — it is a second,
  independent piece of evidence, not a repeat.

  If verdict is DEAD or THIN: return empty arrays for abstract_spans and keyhighlights_spans
  and set insufficient_reason. Do not attempt an abstract. Returning nothing is correct and
  expected; it is not a failure.

STEP 2 — ABSTRACT SPANS  (only when verdict is REAL)
  Select {{SPAN_MIN}} to {{SPAN_MAX}} complete sentences, in the order they appear on the page,
  that together state what this page is and what a reader gets from it.
  {{FAMILY_INSTRUCTION}}
  Rules:
    - A span is one complete unit of the page's own text: a sentence, a list row, or a table
      row. On API and SDK pages there is often no full sentence at all — a parameter row is a
      valid span there, and one span is a valid answer.
    - The FIRST span must name its own subject — it must contain a proper noun, product name,
      or the page's topic. A span beginning "It also supports…" or "This means that…" is
      rejected: out of context it says nothing.
    - Prefer sentences from the page's own body over its hero banner or meta description.
    - Never select a sentence from a cookie notice, nav menu, related-links block, author bio,
      newsletter signup, or the site footer.
    - Never select a sentence that is only about the page itself ("In this guide we will…",
      "This page explains…"). State the content, not the container.
    - If the page's real substance is inside code blocks and the prose is only scaffolding,
      that is THIN, not REAL.

STEP 3 — KEY HIGHLIGHT SPANS  (only when verdict is REAL)
  Select 3 to 8 spans that carry the page's concrete specifics.
  {{FAMILY_INSTRUCTION}}
  Rules:
    - Verbatim, as above. A span may be a sentence, a list item, or a heading.
    - Each must be independently meaningful when read alone in a search result.
    - Prefer spans containing a number, a limit, a name, a version, or a named capability.
    - No span may duplicate or contain another. No span may repeat an abstract span.
    - Fewer is correct when the page has less. Do not pad to reach three; if you cannot find
      three that carry specifics, return what you found.

STEP 4 — LANGUAGE
  Report language_observed: the language PAGE_MARKDOWN is actually written in (en, de, fr, or
  other). Report what you see. Do not report {{LANGUAGE_CODE}} back to us — a mismatch is a
  finding we need, not an error to hide.

OUTPUT
  Return one JSON object and nothing else. No commentary before or after.

  {
    "verdict": "REAL" | "DEAD" | "THIN",
    "verdict_evidence": "<verbatim span>",
    "abstract_spans": ["<verbatim span>", ...],
    "keyhighlights_spans": ["<verbatim span>", ...],
    "language_observed": "en" | "de" | "fr" | "other",
    "insufficient_reason": null | "ERROR_PAGE" | "LOGIN_REQUIRED" | "NO_PROSE" |
                           "LINKS_ONLY" | "CODE_ONLY" | "LANGUAGE_MISMATCH" | "PAYWALL"
  }

  insufficient_reason must be one of those exact strings or null. Do not invent a reason.

WHEN YOU ARE UNSURE
  Return THIN with a reason. An empty result is cheap to fix and safe. A confident abstract of
  a page you did not really understand is expensive and dangerous. Under-reporting is always
  the correct failure direction.
```

---

## Per-family instruction blocks

Substituted into `{{FAMILY_INSTRUCTION}}`. Derived from the 2026-08-07 census —
7 families over 43 `page_type` values. Counts in `shape-families.json`.

**reference** — 4,392 records
> This is API or SDK surface. Lead with what the method, endpoint or parameter does. Highlights
> should be parameter names, required-vs-optional status, return shape, and limits. Prose here
> is often a single sentence — one span is a correct answer. Do not turn a code sample into a
> claim about behaviour.

**instructional** — 2,586 records
> This is a procedure. Lead with the task the reader can accomplish. Highlights should be the
> prerequisites, the ordered steps, and any stated constraint or warning. If the page warns
> about something, that warning is a highlight.

**editorial** — 4,363 records
> This is narrative marketing or news writing, and its thesis is usually not in the first
> paragraph. Lead with the claim the piece actually makes, not its framing. Highlights should be
> the thesis, named entities, and any cited figure with its unit. Ignore the call-to-action.

**commercial** — 223 records
> This is a product, pricing or competitor page and it is the highest-risk family: the page is
> written to persuade. Select only what the page *states*, never what it implies. Lead with the
> capability as worded. Highlights should be named capabilities, named tiers, stated limits and
> named integrations. A comparative claim about a competitor is only selectable if the page
> makes it in a full sentence.

**evidence** — 237 records
> This is a customer story. Lead with the named customer and what they achieved. Highlights must
> include the customer name, each metric verbatim with its unit and direction, and the products
> used. A metric copied without its unit is a failed span.

**hub** — 149 records
> This is an index or listing page and it is the slop trap: there is little to say, so the
> temptation is to invent. If the page has no prose describing what it collects, return THIN.
> Do not describe the list by reading its links. One span is a correct answer here.

**corporate** — 85 records
> This is a company, trust, careers or partner page. Lead with the stated fact. Highlights
> should be named commitments, certifications, programme terms and dates. Boilerplate company
> description is not a highlight.

---

## Why one prompt and not seven

The rules that produce the guarantee — verbatim, no translation, closed reason list, subject in
span 1 — are identical for every record and must never drift between families. Seven prompts
means seven places for that invariant to rot. The variation is real but it is entirely about
*what to look for*, so it lives in one substituted block and in a JSON file that can be
regenerated from a census.

## Model settings

```
temperature      0
top_p            1
max_tokens       1200
response_format  JSON object
```

Temperature 0 is not about quality, it is about reproducibility: Chapter 4 has to be able to
re-run this and get the same spans.

## What this prompt does NOT do

- It does not decide whether a record is deleted. DEAD goes to a quarantine list for Arijit.
- It does not write `is404`. The loop writes that from the verdict plus the HTTP status.
- It does not fill `product`, `feature` or `industry`. Chapter 1's classifier re-runs on the
  new text afterwards.
- It does not judge its own output. That is the validation layer, and the parts that give the
  guarantee are scripted, not LLM.
