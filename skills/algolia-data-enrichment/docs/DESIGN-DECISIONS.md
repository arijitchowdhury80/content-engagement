# Design decisions

Every entry here is a defect that happened, not a preference. Where a number appears, it was
measured. Read this when something looks arbitrary — it usually is not, and the cheap-looking
alternative is usually the one that was tried first.

---

## 1. The model returns integers, not text

**Tried first:** ask the model to copy the sentence verbatim, then check the copy against the page.

**Why it failed:** that is a transcription task, and LLMs are bad at transcription. The writer
produced `10. August 2026` where the page said `August 2026`, reworded a customer sentence, and
reformatted a CLI list. Each near-miss cost the span. The response — drop the span — was a
workaround, not a fix.

**Now:** the script splits the page into numbered candidates and the model returns
`{"abstract": [12, 15]}`. The script takes candidate 12 from its own list.

This also killed an entire class of false rejections at once: curly apostrophes, a space before a
comma, link labels wrapped across newlines, missing spaces in the source HTML, invisible Unicode
marks. None of it can matter, because nothing is being matched.

**A model that returns prose is a hard failure**, recorded as `WRITER_FREE_TEXT`. Parsing around
it would be the moment the guarantee stops being structural.

---

## 2. One canonicalisation, and idempotence is asserted

Both grounding failures in the predecessor were the same defect: two code paths inside one
function normalising the same characters differently. The markdown-link branch skipped the
typographic fold and the space-before-punctuation rule that the main loop applied, so a span
sliced verbatim out of a page reported as ungrounded. Three records in one repair run, all
faithful.

Moving `canonicalise()` into its own module does not prevent that — the divergence was *within*
one function. So `test_canonical.py` asserts the property directly:

```
canonicalise(canonicalise(x).text).text == canonicalise(x).text
canon_text("[label](url)") == canon_text("label")
```

Canonicalisation is **purely subtractive** and every fold is strictly 1:1, so the offset map stays
exact. `…` is deliberately not folded to `...` — one character to three would break it.

---

## 3. `run_gates()` is not ported

The predecessor had a record-level gate function the runner never called, and an inline copy that
it did. A gate was "fixed" inside the dead one **twice**. Every unit test passed. The pipeline
behaved exactly as before, for weeks.

Reading source proved nothing. So:

- the dead function is not carried — a flag left in the wrong position is how it returns;
- `pipeline.evaluate_selection` is the only live path;
- `test_gate_wiring.py` drives the CLI and asserts the refusal appears in the **run's own
  output**, rather than importing a gate and calling it;
- every record-processing command writes and prints `effective-config.json`, and `validate`
  hard-fails when it disagrees with the profile it claims.

The only evidence a threshold reached the runner is the run's own output.

---

## 4. Ban the candidate, never the record

589 of 2,800 records were quarantined by post-selection gates. Almost every one was a page holding
forty other usable sentences; a single bad pick killed the record.

The distinction that fixes it: a **pool** gate is a property of one candidate (its section, the
text after it, the text itself) and can be asked *before* the model picks. A **selection** gate is
a property of the chosen set (span count, spread, mixed languages, information gain) and can only
be asked after.

If a verdict depends only on the page, the candidate never reaches the menu. And when a selection
gate does fire, the failure names *which* sentence was wrong — enough to ban it and re-ask, up to
three attempts. That is what a person would do.

---

## 5. Repair extends; it never writes

A colon lead-in is a bad **cut**, not a bad page. The words that finish the thought are usually
the next few on the page.

A repaired span is `canon.text[a:b]` — one contiguous slice. Never a concatenation of two distant
sentences, never a paraphrase, and never a full stop appended. Adding a period would read
perfectly and would be a fabrication: live verification re-slices from the page and would not find
it.

Repair recovered 310 of 349 affected records in the predecessor's run.

One exception, and it is signposted by the page itself: a colon lead-in **may** cross a block
boundary, because `There are several benefits:` followed by a bullet list puts the list in a
different block by construction. A mid-sentence cut gets no such licence — there the page gave no
signal, and joining across a block is exactly the false adjacency that spans are stored as arrays
to avoid.

---

## 6. Status codes are not evidence about a document

**Proposed:** `http_status != 200 → DEAD`.

**Measured on the real corpus:**

| | count |
|---|---:|
| bodies returning HTTP 301 | 1,655 — of which ~1,600 are **alive** articles |
| dead "Page not found" stubs | 95 — of which 61 return **301** and only 34 return 404 |

The rule would have discarded ~1,600 healthy articles, caught a third of the dead ones, and read
in a report as a safety improvement.

Liveness is decided by the **body**: a not-found marker in the first 200 characters, or a length
under the profile's floor.

The same principle covers redirects. 2 of 237 case studies return HTTP 200 while serving a
different document. A status check passes them, and every span cut from those bodies is perfectly
verbatim — from a page the record does not point at. So served-URL identity is asserted, from two
independent sources: Scout's own `final_url`, and the page's skip-link anchor, which is written by
whichever document actually rendered.

---

## 7. Thresholds are per profile

A single `min_body_chars` is wrong for any corpus with more than one kind of page.

| Profile | floor | why |
|---|---:|---|
| Blog | 1,200 | p10 of alive bodies is 8,620; dead stubs are 205. The floor sits between two well-separated populations |
| Documentation reference | **250** | a terse API page is short and correct. Blog's floor would quarantine thousands |

Same for information gain: 8 new content tokens generally, **3** for `api_facts`. On an API page
the title *is* the endpoint name and the description *is* what it does, so a faithful abstract
necessarily repeats them. Measured on 16 such failures the gains were
`0,0,0,1,1,2,3,3,3,4,4,6,6,6,7,7` — a bar of 3 recovers 10 and still rejects 0/1/2, which is the
case the gate exists for. A bar of 1 would gut it.

**A bounded probe may set qualitative fields only.** The measured noise band on this corpus is ±2
PASS at n=50, so a threshold tuned on 25 records is a number invented to fit a sample.

---

## 8. A source-specific ruling must not be generalised

`/de/blog/` and `/fr/blog/` serve the English article — probed live, byte-identical with and
without an `Accept-Language` header. There is no German body to prefer, so an English abstract is
the true description of an English page and a German one would be the invention.

That was measured at **100% of Blog and 0% of every other source.** So `allow_known_english_body`
appears on the Blog profile and nowhere else. Everything else is `must_match_record`, and the
census must prove it before enrichment rather than after.

---

## 9. Test the class, not the word

`_SENT_END` required the next sentence to start with `[A-Z0-9]` — ASCII only. Any German or French
sentence beginning with an accented capital was never recognised as a sentence start, so two
sentences stayed one over-long span, which `MAX_CHARS` then discarded.

154 of 237 case-study records are de/fr, and that path had never run.

Fixing the one lookahead would have fixed one symptom. The class is "the splitter only speaks
English", so:

- the sentence-start class is built from `unicodedata`, not hand-listed — hand-listing is how the
  abbreviation set got it wrong the first time;
- the abbreviation set covers en/de/fr/es/it/pt plus single-letter initials (`Mio.`, `Mrd.`,
  `M. Dupont`, German dates);
- chrome detection is **structural, never a word list** — few words plus no sentence punctuation
  catches a CTA, a nav label, an all-caps banner and a countdown timer in five languages with no
  vocabulary at all. A word list is the monolingual trap wearing a different hat.

---

## 10. Zero work is a failure

A verifier on this project filtered on a non-faceted attribute, matched nothing, and reported
success. An empty pass is the most expensive kind of green: it looks identical to a real one and
nobody looks again.

Every validator raises `ZeroWorkError` rather than returning a clean report over an empty set. No
command prints PASS after checking zero records or zero spans.

The sibling of this: **a fallback can make an assertion vacuous.** The model pin originally ended
`served or alias`. Had the API field been renamed, every tier would have resolved to its own alias
and the check would have compared `"large" == "large"` — passing, while proving nothing about
which model graded the corpus. The fallback is gone; a missing served model is a named refusal.

---

## 11. The judge may not write, and must be a different model

`large` and `xlarge` on the inference endpoint **both serve glm-5.2**, which is the writer. A
tier-only `writer != judge` check passes and lets the writer grade its own output. So the pin is
on the **served model string**, read from `/models` at run start.

`medium` is a different family and looks like a harmless judge upgrade. It is still an unvalidated
model swap, and pinning the served string makes it fail loudly instead of silently changing what
graded the corpus.

**A judge whose verdict does not change writability is not a gate.** In the predecessor, both of
the judge's verdicts were writable, so across 3,069 rows its verdict changed the outcome for zero
records while costing one LLM call each. Here only `PASS` is writable.

The judge can request a reselection. It may never supply replacement prose.

---

## 12. Approval is data, and the target is structurally not the source

`assert_write_target` raises when target equals source, and every write path calls it before a
payload is built. There is no argument combination that writes to the source index.

The source index holds 11,928 records and an entire 8-axis taxonomy, and there is no snapshot of
it. A copy, rename, swap or merge destroys both.

Approvals compare every field — command, run id, source, page_type, both index names, both
counts. The realistic failure is not a forged approval, it is a stale one authorising a much
larger write than the human agreed to.

**Only three fields may be written.** No provenance, no offsets, no verdicts, no model ids — five
records once carried 12 `enrichment_*` bookkeeping fields and had to be cleaned off a live index
afterwards. A null is refused outright: `partialUpdateObject` stores a literal null instead of
removing an attribute, and 96,039 nulls reached a live index that way.

---

## 13. Verification happens on the surface the change was made to

A 200 response is not evidence. Reading settings back is not evidence either — a comma-joined
`"unordered(a),unordered(b)"` is stored as **one garbage attribute**, is silently unsearchable,
and reads back perfectly.

So `verify-live` reads the target index back, compares byte for byte, and then runs a query for
text that exists only in an enriched field. More than zero hits is the proof. Indexing is
asynchronous, so the write task is awaited first — reading immediately after a 200 measures the
old state and calls it a mismatch.

---

## 14. Grounding is a guarantee; quality is a judgement

This is the honest limit of the whole design.

The predecessor's own record: the judge requested a revision on **56%** of abstracts, and selection
quality was self-rated 5/10 against a grounding guarantee rated 10/10. The writer was not
hallucinating — it was choosing true-but-worse sentences while better ones sat on the same page.

Every gate in this skill answers "is this on the page, and is it shaped correctly". None answers
"is this the sentence a reader needed". The review pack is the artifact for that question and a
human has to answer it.

**A passing gate is not a good abstract.** Do not let one be reported as the other.
