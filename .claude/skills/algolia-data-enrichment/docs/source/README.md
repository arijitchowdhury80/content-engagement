# Source materials

The skill was built by an autonomous agent from a written spec, against four evaluation gates.
These are the inputs and the build record, versioned alongside the output so the result is
auditable rather than merely asserted.

| File | Size | What it is |
|---|---|---|
| `PLAN-skill-algolia-corpus-enrichment.md` | 2,281 lines | **The spec.** Command contracts, enforcement primitives, grounding contract, writer/judge contract, all 13 source profiles written out, the v0 definition of done, and the script-promotion audit that decided which 15 of 40 predecessor files were carried |
| `PROMPT-build-and-eval-skill.md` | 190 lines | **The goal prompt.** Hard constraints, the build order, the four gates, the autonomous loop, and the stop conditions — including "never make a test pass by lowering the bar" |
| `EVAL-LOG.md` | — | **The build record.** Every iteration including the four that failed, each with a root cause and an argument for why the fix was not a weakening |
| `independent_grounding.py` | 230 lines | **The Gate 2 checker.** Written to share no code with the validator it audits |

---

## Why these are versioned

Three reasons, in order of how much they matter.

**The spec is the reason the code looks like this.** Nearly every non-obvious choice —
`min_body_chars` being per profile, the judge running on a different model family, ID-only writer
output, banning a candidate rather than a record — traces to a measured incident recorded in the
plan. Reading the code without it, the choices look arbitrary. `docs/DESIGN-DECISIONS.md`
summarises them; the plan is the primary source.

**The gates only mean something if you can see what they were.** "Four gates passed" is a claim.
The prompt states the thresholds and stop conditions *before* the run, and the eval log records
what happened against them, including the failures. A gate defined after the results are in is
not a gate.

**The eval log records four failures, and the failures are the useful part.** Three were defects
in code written during the build; one was a gate whose assertion was wrong. The log argues each
fix rather than asserting it — particularly the one debatable change, where a check was scoped to
a single run's manifest and reported a previous slice as contamination.

---

## Gate 2 is the one worth understanding

The number being promoted — 21,790 of 21,790 spans located in their source bodies — was
**self-reported by the component being promoted**. On a project where a verifier had already
returned empty and reported success, a 100% pass from the thing under test is the weakest
admissible evidence for it.

So `independent_grounding.py` re-derives it by a different route: word-token contiguous
subsequence matching, versus the package's character-level canonical projection with an offset
map. It imports nothing from `algolia_enrichment`.

It reproduced `21,790 / 21,790` — and reproduced the **mode partition** too (9,597 exact / 12,193
canonical, matching the historical packet exactly).

It also failed twice first, and both failures were in the checker rather than the corpus:

1. it tokenised raw markdown, so link *target* URLs contributed words and broke span contiguity;
2. it treated `*` as a word separator, but the page says `serving**from 900K…**`, which markdown
   renders as one word — so the stored span was faithful and the checker was disagreeing with
   markdown itself.

Both are recorded in the eval log rather than quietly fixed. A false alarm reported as a corpus
finding costs more than no check at all.

---

## Naming

The source documents call the project `algolia-corpus-enrichment`. The distributed skill is
`algolia-data-enrichment` and the internal Python package is `algolia_enrichment`. Same thing.
The source files are left exactly as they were written — rewriting a build record to match a later
rename would defeat the point of keeping it.
