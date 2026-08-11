# Validation gates

One registry, one live call path. `algolia_enrichment/validate/__init__.py:GATE_REGISTRY` is the
list; `algolia_enrichment/pipeline.py:GATES_LOADED` is what the runner loads. Both are echoed
into `effective-config.json` on every record-processing command, because reading the source has
twice failed to prove which gates a run actually reached.

## Pool gates — asked BEFORE the model picks

A pool gate is a property of one CANDIDATE: its section, the text after it, the text itself.
Asking these after selection quarantined 589 of 2,800 Blog records, almost all of them pages
holding forty other usable sentences. **If a verdict depends only on the page, ban the candidate;
never the record.**

| gate | refuses |
|---|---|
| `G-pool-filter` | chrome, breadcrumbs, cookie banners, code comments, the record's own description, and the profile's `forbidden_patterns` |
| `G-pool-static-ban` | a span from an excluded section, a dominant CTA, a self-reference, real speech |
| `G-pool-reversal` | a span the page contradicts immediately afterwards — **repaired first** by extending over the contradiction, banned only if that fails |

## Selection gates — need the chosen SET

| gate | refuses |
|---|---|
| `G-id-only-selection` | a non-integer pick (`WRITER_FREE_TEXT`), an out-of-range index, the wrong span count |
| `G-repair-incomplete` | a colon lead-in, a cut sentence or a broken markdown link that the page cannot complete |
| `G-integrity` | duplicate spans, nested spans, a trailing colon, an abstract span that does not end a sentence (shape-dependent) |
| `G-context-*` | quotation-as-own-claim, reversal, excluded section, too many sections, mixed languages, spans stitched from unrelated parts |
| `G-subject-present` | an abstract opening that names no subject |
| `G-information-gain` | an abstract that restates title + description |
| `G-method-agreement` | a body whose shape disagrees with the profile's declared strategy |

## Validation gates — after the artifact is built

`V-grounding-*`, `V-quality-*`, `V-payload-*`, `V-live-*`, `V-source-index-unchanged`. See the
registry for the one-line statement of each.

## Two rules that override everything here

1. **Zero spans checked is a failure, not a pass.** Every validator raises `ZeroWorkError` rather
   than returning a clean report over an empty set.
2. **A gate whose verdict does not change writability is not a gate.** Across 3,069 Blog rows the
   historical judge changed the outcome for zero records, because both of its verdicts were
   writable. Here only `PASS` is writable.

## Thresholds, and why they are what they are

| threshold | value | evidence |
|---|---|---|
| information gain | 8 tokens, **3** for `api_facts` | the 16 reference-family failures scored 0,0,0,1,1,2,3,3,3,4,4,6,6,6,7,7 — a bar of 3 recovers 10 and still rejects 0/1/2 |
| span spread | 20,000 chars | 8,000 rejected a long-form article whose spans were title + thesis + conclusion, 13,545 apart |
| distinct sections | 4 | legitimate cases used 3 and 4; 5+ still blocks |
| highlight length | 300 chars | a display limit; German runs ~30% longer, so it drops the span, never the record |
| dead-page floor | per profile | 1,200 for Blog (p10 of alive bodies is 8,620, dead stubs are 205); 250 for reference, where a terse page is correct |
| boilerplate share | 0.5 of a page's prose | an awards page lost 87% of its prose to a corpus-frequency rule and went THIN |
