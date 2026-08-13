# Plan: `algolia-corpus-enrichment` Codex Skill

Status: **v0 implementation scope — reset after Arijit's 2026-08-10 correction.**

This plan is not a general-purpose corpus lifecycle platform yet. The v0 target is
specific and operational:

> Enrich records with `abstract_enriched` and `keyhighlights_enriched`, write them to the
> approved target index, and prove with deterministic validation that every written
> string is grounded in the Scout-fetched page body and useful for enrichment.

Everything that does not directly serve that outcome is either removed from v0 or marked
future. This includes production search-settings experiments, rollback state machines,
and automated quarantine/delete flows.

## Arijit's Scope Correction For v0

### In scope

- fetch full page bodies through Scout
- generate local enrichment artifacts
- repair bad writing when the source body supports a grounded repair
- validate grounding, quality, payload shape, and counts
- write only good records to the approved target index
- produce a human-review queue for bad/unusable records
- create review samples for human inspection
- clean run artifacts so future agents do not inherit residue

### Out of scope for v0

- changing production `searchableAttributes`
- proving search-result lift
- automatic deletion from the main index
- automatic quarantine moves
- rollback state-machine buildout
- turning this into a company-distributed package

### Non-negotiables

- no free-written enrichment text
- no page-body fetcher except Scout
- no provenance junk on main records
- no Algolia write without validation packet
- no PASS if zero records or zero spans were checked
- bad records go to a human-review queue, not automatic quarantine

## What The Target Index Is For — And What Happens After v0

**Read this before building anything.** Without it, v0 finishes and delivers nothing
observable, which is exactly how the Blog slice stalled.

`Algolia_Prod_Copy_Enhanced_Parallel` is created by copying **settings only, no records**.
So after a successful v0 run it contains *only the enriched records of one slice* — e.g.
237 case studies. It is a **proving ground**, not a search index. Nobody queries it. The
demo still queries `Algolia_Prod_Copy_Enhanced`.

That is a legitimate v0. But it means:

**v0 succeeds when the method is proven, not when value is delivered.** Say that out loud
in the packet so nobody reports v0 as a search improvement. It is not one.

### The target index must be searchable, or v0 proves nothing

`prepare-target-index` copies settings from the source index. The source index's
`searchableAttributes` **excludes** `abstract_enriched` and `keyhighlights_enriched`. Copy
that blindly and the target index cannot surface the enrichment either — v0 would produce
a result that cannot be observed even in isolation.

Therefore `prepare-target-index` must, on the **target index only**:

```text
searchableAttributes = <copied from source>
                     + "unordered(abstract_enriched)"
                     + "unordered(keyhighlights_enriched)"
```

One attribute per priority level — never comma-joined into one string. This is safe
because the target index is not production and nothing queries it. It is what makes the
run demonstrable: after `verify-live`, a query for text that exists only in an enriched
field must return > 0 hits on the target index. **That query is v0's proof of life** and
is a required output of `verify-live`.

This does **not** change production settings. Production `searchableAttributes` remains
out of scope, unchanged, and untouched.

### v1 — deferred, but named here so it does not get improvised

v0 ends with enriched records sitting in a parallel index. Getting them to production is
**v1** and needs its own plan and its own approval. Naming it now prevents a future agent
from improvising it:

| step | note |
|---|---|
| Decide the merge direction | Field-level merge of `abstract_enriched` / `keyhighlights_enriched` into `Algolia_Prod_Copy_Enhanced`, keyed on objectID. |
| Add enriched fields to production `searchableAttributes` | Separate approval. Requires the search-eval protocol. |
| Prove no regression | Baseline vs enriched query set, pre-registered thresholds. |

**Hard prohibition, carried from `CLAUDE.md`:** v1 is a **field-level merge into**
`Algolia_Prod_Copy_Enhanced`. It is never an index copy, never a rename, never a swap.
Copying `Algolia_Prod_Copy_Enhanced_Parallel` over `Algolia_Prod_Copy_Enhanced` would
delete 11,928 records and the entire 8-axis taxonomy. No command in this skill may copy or
replace the source index, in v0 or v1.

## v0 Definition of Done

v0 is done when **every** line below is true and evidenced by a named artifact. Not "most."

| # | criterion | evidence artifact |
|---|---|---|
| 1 | `prepare-target-index` created the target with enriched fields searchable | `validation/target-index-settings.json` |
| 2 | One full slice planned with exact objectIDs, count matching live census | `manifest.json` |
| 3 | Every target record has exactly one terminal outcome — written, repaired-then-written, or in the human-review queue. Zero records unaccounted for. | `final/results.jsonl` + `final/human-review-queue.jsonl` |
| 4 | 100% of written spans re-located in their Scout body by offset-free lookup | `validation/artifact-validation.json` |
| 5 | Zero forbidden metadata fields on any written record | `validation/write-dry-run.json` |
| 6 | Live values on the target index byte-match the approved payloads | `validation/live-verification.json` |
| 7 | A query for enriched-only text returns > 0 hits on the target index | `validation/live-verification.json` |
| 8 | Written count ≥ `coverage_target_pct` of the planned target set, measured against the **original** `plan-slice` count | `validation/coverage.json` |
| 9 | Human-review queue reviewed, each row given a decision | `final/human-review-queue.jsonl` |
| 10 | `effective-config.json` matches the profile hash the run claims | `effective-config.json` |
| 11 | Run folder contains no artifact outside `runs/<run-id>/`, and no loose scripts were run | `artifact-manifest.json` |
| 12 | Packet states plainly that v0 changed zero production search results | `reports/packet.md` |

Any failing line means v0 is not done. A partial pass is reported as a number, never as a
completion word.

## First Slice: `Customer Stories/case-study` (237)

The plan previously nominated `Website/press-release` (690). **Start with case-study
instead**, then press-release.

- **237 records vs 690.** First run of brand-new software should have the smaller blast
  radius. At Blog's 77.6% writable rate that is ~55 records into human review rather than
  ~155.
- Its full 19-field profile is already written in this plan; press-release's is too, so
  nothing is lost by ordering.
- `Customer Stories` = 237 = `case-study` = 237 (verified live), so the source and the
  page_type are the same population. No slicing ambiguity on the first run.
- Its dominant risk — information gain, the lede restating the meta description — is the
  risk most worth catching before committing to a 690-record run.

Order: **smoke (10 Blog, write path) → de/fr smoke (10 case studies) → case-study (237)
→ Documentation → the rest.**

### The de/fr smoke is not optional

**154 of the 237 case-study records (65%) are German or French** — de 78, fr 76, en 83
(verified live 2026-08-10). Blog served English on `/de/` and `/fr/`, so **the pipeline has
never processed non-English body text.** Every candidate filter, chrome pattern and quality
gate in the carried code was tuned on English.

One defect in that path was already found by inspection on 2026-08-10 and fixed: `_SENT_END`
in `candidates.py` used an ASCII-only `[A-Z0-9]` lookahead, so any German or French sentence
starting with an accented capital was never split — the two sentences merged into one
over-long span that `MAX_CHARS` then discarded. Finding one defect by reading strongly
suggests siblings that reading will not find.

Run **10 case studies — 4 de, 4 fr, 2 en — end to end through every command** before the
full 237. Compare candidate counts and span-length distributions across the three languages;
a systematic skew is the signature of another monolingual assumption.

## Blog-Proven Baseline To Promote

Do not redesign grounding, repair, or baseline validation from scratch.

Blog already proved the core method at meaningful scale:

- 2,800 planned Blog records were processed end to end
- 2,694 Blog records remained in the main index after bad/unusable records were removed
- 2,694 / 2,694 live Blog records have both `abstract_enriched` and `keyhighlights_enriched`
- 21,790 / 21,790 live Blog spans were located in the cached Scout bodies
- 0 leakage failures
- 0 dead-page records enriched live
- 0 pipeline/audit metadata fields on live Blog records
- 104 dead Blog pages and 2 thin/no-usable records were identified as non-enrichment outcomes

**One of these numbers is not independently verified.** Claude confirmed 2,694 records,
2,694/2,694 with both fields, 0 metadata fields, and 21,790 spans present — all by live
query. The *grounding rate* (21,790 of 21,790 re-located in their Scout bodies) is
self-reported by the validator being promoted into `validate/grounding.py`.

On a project where a verifier already returned empty and reported success, a 100% pass from
the component under promotion is the weakest admissible evidence for promoting it.

**Required before `validate/grounding.py` is trusted:** re-run the grounding check with an
independently written implementation against the existing cache
(`docs/70-enrichment/cache-scout/`, 9,579 bodies, 243 MB, confirmed present 2026-08-10). If
it reproduces 21,790/21,790, the baseline argument is solid. If it does not, the difference
is the most important number in the project.

Therefore the v0 work is **promotion and generalisation**, not invention.

Promote these Blog-proven mechanisms:

| mechanism | Blog evidence | v0 action |
|---|---|---|
| ID-only model output | final strings came from candidate IDs resolved to page spans | keep as mandatory writer contract |
| Offset-free grounding validation | live packet grounded 21,790 / 21,790 spans | promote to `validate/grounding.py` |
| Scout-only body source | Blog validation used cached Scout bodies as grounding source | promote to `scout.py` / `bodysource.py` |
| Canonical matching | live packet found spans by exact + canonical modes | promote to `canonical.py` |
| Repair before discard | repair recovered 310 / 349 affected records | promote to `repair.py` |
| Incomplete-span detection | repair packet reduced residual incomplete spans to 0 | promote to quality gate on live path |
| Chrome/furniture filtering | audio fallback defect was caught and fixed | promote forbidden text to shared `filters.py` |
| Dead-page content gate | 104 Blog dead pages were caught; no dead page was enriched | promote per-profile dead/shell markers |
| Final-artifact validation | historical artifacts caused confusion; final artifact resolved precedence | promote `build-final` before every write |
| Live verification | live values matched expected payloads byte-for-byte | promote `verify-live` |

What must change per source is the **profile**, not the grounding architecture.

The next slices should reuse the Blog path and only adjust source-specific policy:

- language policy
- dead/shell markers
- forbidden boilerplate/chrome
- abstract shape
- highlight count/rules
- quote attribution handling
- duplicate-description policy
- minimum body length
- quality judge rubric emphasis

Grounding remains the same across all sources.

## What Claude changed in v5

Codex had already fixed most of Round 2 in flight — the multi-branch state machine,
`rollback` as a real command, the null-write ban, `canonical.py`, `judge.py`, model
separation, the strategy layer, `max_human_review_open_pct` and the coverage denominator,
`Developers/developer`, and most of the test list. Those are accepted as-is and untouched.

Claude added only what was still open:

| # | change | why |
|---|---|---|
| 1 | `BodySource` section + `bodysource.py` | Pre-ingest is Arijit's stated target. Hardcoding Scout now makes it a rewrite later. Kills DEAD_PAGE and drift at the source. |
| 2 | `Strategy Dispatch` section + `dispatch.py` | Every profile keys on `source/page_type`, and that taxonomy is unvalidated. Sniff the body, treat the label as a hint. Also produces free taxonomy validation. |
| 3 | `Effective Config Echo` | A gate was "fixed" twice on this project in a path the runner never reached. Only the run's own output proves a threshold arrived. |
| 4 | `Run Metrics` | No tokens/record or wall-clock/record means no slice is plannable before launch. |
| 5 | run-id `-aNN` attempt suffix; index names as config | Same-day rerun collided on folder and lock. Config-not-literals is the precondition for promoting the package later. |
| 6 | Live counts corrected: `11930` → **`11928`**, quarantine total **108** | Verified by live query 2026-08-10. The wrong figure had propagated into the `CORPUS-STATE.json` schema example. |
| 7 | Test list: `test_validate_outputs.py` → `test_validate_blog_outputs.py`; 8 new tests | The first filename does not exist on disk. `tests/live_path.py` is imported by two packaged tests. |
| 8 | Probe constrained to qualitative fields only | Noise band is ±2 PASS at n=50. A 25-record probe cannot set a numeric threshold. |
| 9 | `search-eval` thresholds pre-registered and hashed | "Worsen materially" is not a threshold. A number chosen after seeing results is not a threshold. |
| 10 | `searchableAttributes` comma-syntax rule + query-based verification | `"unordered(a),unordered(b)"` stores as one garbage attribute and reads back perfectly. |
| 11 | `cache-scout/` retention rule | Fastest-growing artifact, unmentioned by the cleanup policy. Keep hashes, archive bodies. |
| 12 | Profile filenames → `Source__page-type.yaml` | Profiles key on `source/page_type`; `resource.yaml` cannot express that. |
| 13 | `case-study` and `press-release` written out in full | Two one-line rows against a 19-field schema. Neither slice can start until they exist. |
| 14 | `boilerplate.py` decided, not deferred | "Fold in if still needed" is how residue enters. |

## Rating

| layer | Codex v4 | Claude v5 | reason |
|---|---:|---:|---|
| Slice runner | 8.3/10 | **8.5/10** | State machine, rollback, model separation and canonicalisation all landed. Strong. |
| Corpus lifecycle | 7.4/10 | **7.8/10** | Coverage denominator fixed. Still unimplemented and unforward-tested. |
| Overall plan | 7.9/10 | **8.2/10** | Design is now close to complete. Nothing is built. |

**A rating may not rise while a blocking item is open.** Tie it to the edit ledger, not to
a feeling about the document.

### Confidence assessment (Claude, 2026-08-10) — 7.0/10

Measured against the plan's own contents, not impressions.

| dimension | score | basis |
|---|---:|---|
| Design correctness | 8.5 | Three adversarial rounds. Every Blog failure class named and mapped to a mechanism. Grounding structurally enforced, not policed. |
| Completeness as a build spec | 7.0 | 17/17 commands have contract rows; 8/17 lacked a refusal test (now added); 2/10 profiles were written out (Documentation's three now added). |
| Evidence base | 7.0 | 4 Blog claims independently verified exact. The grounding *rate* is still self-reported by the component being promoted. |
| Ready to run case-study | 6.0 | Three blockers cleared 2026-08-10. 65% of the slice runs a path that has never run. |
| Ready to run Documentation | 3.0 | The `docs_api` strategy has never executed once. |
| Cost / throughput realism | 4.0 | One measured Scout job. No measured concurrency ceiling. |

**The risk that caps this number is not grounding — it is usefulness.** Blog's own record:
the judge requested REVISE on 56% of abstracts, and selection quality was self-rated 5/10
against a grounding guarantee rated 10/10. The writer was not hallucinating; it was choosing
true-but-worse sentences when better ones sat on the same page. The plan answers this with
eleven quality gates, **none of which has ever run as a gate on a live path.** That is the
largest unknown in the project and it decides whether the output is worth having.

Two actions move 7.0 to 8.5, and neither is large:

1. Re-verify Blog grounding with an independently written implementation against
   `cache-scout/` (see the Blog-Proven Baseline section).
2. Run the 10-record de/fr smoke before the 237 (see First Slice).

Why not higher yet:

- nothing has been refactored into the CLI/package shape; this is a plan, not code
- no forward-test has run from a fresh Codex context
- no slice has been processed with the skill
- the three decisions below are unanswered

## Decisions for Arijit

These are not Codex's or Claude's to make. Work can proceed on everything else.

1. **`Support/support-article`** — 1,695 records, 14.2% of the corpus. Stays excluded, or
   gets a profile?

## Core Decision

Do **not** create a skill full of many loose scripts.

Create **one Codex skill** with **one user-facing CLI** and a small internal Python package.

This avoids the Blog-run failure mode where agents grabbed random scripts, historical reports, dead-path helpers, and residue.

The skill has two layers:

1. **Slice runner** — safely enrich one explicit `source/page_type`.
2. **Corpus tracker** — count what is done, pending, failed, and human-review-needed.

The slice runner is the core product. The corpus tracker exists to keep the slice runner
honest, not to become its own platform.

## Skill Location

```text
/Users/arijitchowdhury/.codex/skills/algolia-corpus-enrichment/
```

## Skill Structure

```text
algolia-corpus-enrichment/
  SKILL.md
  agents/
    openai.yaml
  scripts/
    algolia_enrich.py
    algolia_enrichment/
      __init__.py
      api.py
      artifacts.py
      errors.py
      state.py
      lock.py
      ledger.py
      approvals.py
      scout.py
      profiles.py
      batching.py
      bodysource.py
      canonical.py
      candidates.py
      dispatch.py
      filters.py
      gates.py
      repair.py
      model_io.py
      judge.py
      validate/
        __init__.py
        grounding.py
        quality.py
        payload.py
        live.py
        search.py
      write.py
      human_review.py
      corpus.py
      drift.py
      profile_lint.py
      skill_policy.py
      strategies/
        __init__.py
        editorial.py
        case_study.py
        press_release.py
        docs_api.py
        developer_code.py
    profiles/
      base.yaml
      blog-post.yaml
      press-release.yaml
      case-study.yaml
      resource.yaml
      product-page.yaml
      docs.yaml
      developer-code-sample.yaml
      hub-page.yaml
      generic-marketing-page.yaml
  tests/
    selected regression tests
  references/
    validation-gates.md
    source-profiles.md
    corpus-lifecycle.md
    skill-contract.md
    artifact-contract.md
    blog-lessons.md
    collaboration-handoff.md
```

No loose cache folders, run outputs, reports, snapshots, old probes, or one-off packets go inside the skill.

## CLI Contract

Every operation runs through:

```bash
python scripts/algolia_enrich.py <command> [args]
```

Required global args:

```text
--workspace /path/to/project
--run-id YYYYMMDD-source-page_type-aNN
--source-index Algolia_Prod_Copy_Enhanced
--target-index Algolia_Prod_Copy_Enhanced_Parallel
```

`aNN` is the attempt number (`a01` for a first run). Without it, a same-day rerun of the
same slice collides on the run folder and the lock. `rerun-approved.json` must name the
attempt it authorises.

Index names are **config, not literals**. `--source-index` / `--target-index` default
from a config file; no Algolia index name may be hardcoded in package source. This keeps
the package usable against any index and is the precondition for promoting it out of a
per-user skill folder later.

V0 named target index:

```text
Algolia_Prod_Copy_Enhanced_Parallel
```

This target must exist and be verified before `apply-write`. If it does not exist,
`prepare-target-index` creates it by copying source-index settings only; it does not copy
records and it does not write enrichment.

Slice args:

```text
--source Blog
--page-type blog-post
```

All commands must exit non-zero on invariant failure. No command may print PASS after checking zero rows or zero spans.

## Enforcement Primitives

The skill needs enforceable primitives, not just instructions.

### Run Lock

Every command that touches a run folder must acquire:

```text
runs/<run-id>/.lock
```

Rules:

- lock contains PID, command, started_at, source, page_type
- stale lock requires explicit `--recover-lock` and writes a recovery note
- two writers cannot operate on the same run folder

### Run State

Every run has one state file:

```text
runs/<run-id>/state.json
```

Allowed states:

```text
PLANNED
FETCHED
ENRICHED
REPAIRED
FINAL_BUILT
VALIDATED
WRITE_DRY_RUN_PASSED
WRITTEN
LIVE_VERIFIED
CLOSED
FAILED
```

Commands must check legal transitions. Example: `apply-write` cannot run unless state is `WRITE_DRY_RUN_PASSED`.

Legal transitions:

```text
PLANNED -> FETCHED -> ENRICHED -> REPAIRED -> FINAL_BUILT -> VALIDATED
PLANNED -> FETCHED -> ENRICHED -> FINAL_BUILT -> VALIDATED
VALIDATED -> WRITE_DRY_RUN_PASSED -> WRITTEN -> LIVE_VERIFIED
LIVE_VERIFIED -> CLOSED
VALIDATED -> CLOSED when profile permits write-skipped/human-review-only completion
```

Quarantine, rollback, and drift states are out of v0.

### Approval Token

Approval files are data, not prose. Commands must parse and validate them before proceeding.

No destructive command may accept approval from chat text alone.

### Artifact Manifest

Every command writes the files it produced to:

```text
runs/<run-id>/artifact-manifest.json
```

Validation reads this manifest, not directory globs.

### Effective Config Echo

Every command that processes records must, at start, write **and print**:

```text
runs/<run-id>/effective-config.json
```

Contents:

```json
{
  "profile_id": "Customer Stories/case-study",
  "profile_version": "case-study:<hash>",
  "strategy": "case_study",
  "gates_loaded": ["G01", "G02", "..."],
  "thresholds": {"judge_threshold": 0.0, "min_body_chars": 0},
  "writer_model": "glm-5.2",
  "judge_model": "small",
  "prompt_version": "<hash>",
  "canonical_version": "<hash of canonical.py normalisation rules>",
  "body_source": "ScoutRefetch"
}
```

Rules:

- `validate` hard-fails if `effective-config.json` disagrees with the profile it claims
- the gate list must be the gates the runner actually loaded, not the gates in source

Why this exists: on this project a gate was "fixed" twice in a code path the runner never
reached. Reading the source proved nothing. The only evidence that a threshold reached
the runner is the run's own output.

### Run Metrics

Every record-processing command appends to:

```text
runs/<run-id>/metrics.json
```

Required: records processed, wall-clock per record, tokens in/out per record, retries,
Scout fetch failures, total cost estimate.

Measured baseline, one real Scout job on a German case study (2026-08-10):

```text
elapsed_ms        79942     <- includes queue wait
duration_ms       11209     <- the scrape itself
browser_launch_ms  3854
navigation_ms      6357
markdown chars    15892
```

Queue wait dominates, so **the Scout concurrency ceiling matters far more than per-page
speed**. `plan-slice` must project runtime from measured concurrency, not from
`duration_ms`. At one job at a time, 226 case studies is roughly 5 hours of wall clock;
that is a planning input, not an acceptable serial plan.

Without this no slice is plannable before launch. `plan-slice` must print a projected
runtime and cost for the target count using the last comparable run's metrics.

## Body Source

The pipeline must not assume where a page body came from.

```python
class BodySource(Protocol):
    def body_for(self, record) -> Body: ...   # Body carries provenance + content hash

class ScoutRefetch(BodySource):   ...   # backfill: re-fetch an already-indexed record
class IngestPayload(BodySource):  ...   # pre-ingest: body already in hand at index time
```

Two entry points, one core:

```text
enrich-batch  --from-index    ...   # backfill mode   (BodySource = ScoutRefetch)
enrich-stream --from-payload  ...   # pre-ingest mode (BodySource = IngestPayload)
```

Everything downstream of `body_for()` — canonicalisation, candidates, grounding, gates,
write, rollback — is identical in both modes and must not branch on the source.

Why this matters: Arijit's stated target is enriching content **before** it reaches the
index. Pre-ingest eliminates two whole failure classes outright — DEAD_PAGE (104 records
on Blog) and post-write span drift (9 of 163 spans already unfindable on their claimed
pages), because the body that grounds the span is the same body that produced the record.
We do not own the ingest pipeline today, so backfill is the current mode. If the Scout
path is hardcoded now, pre-ingest becomes a rewrite instead of a config change.

`ScoutRefetch` keeps every existing Scout-only rule: Scout is the sole fetcher for
backfill, and served-URL identity is asserted, never just the status code.

## Profile Method Selection

This section was previously called "Strategy Dispatch." In v0, keep it plain:

> Pick the enrichment method from the source profile, then sanity-check that the fetched
> body looks compatible with that method.

This is not a separate product architecture. It exists because Blog, Documentation,
Customer Stories, press releases, and code docs need different enrichment behavior.

Profiles declare a method. The body-shape check must not trust that declaration blindly.

```text
route(record, body) -> EnrichmentMethod
  1. the profile for source/page_type declares its method
  2. the sniffer measures the body: code ratio, sentence density,
     nav-link density, parameter-table presence, body length
  3. sniffer disagrees with the declared strategy
     -> WARN, refuse to WRITE, emit a reclassification report
  4. source/page_type unknown
     -> sniffer picks a strategy, DRY-RUN only,
        explicit profile file required before any write
```

Why: every profile keys off `source/page_type`, and that taxonomy is applied but
unvalidated (`CLAUDE.md`). Label-only dispatch runs the wrong method whenever the
classifier is wrong, and every gate still passes. The reclassification report is also the
cheapest taxonomy validation we will ever get — it is a by-product of work already being
done.

Output: `validation/method-check.json` — declared method, sniffed method, agreement
rate per slice. A disagreement rate above the profile's threshold fails the slice.

## Commands

### V0 mandatory commands

These are the only commands required to complete the next source slice.

| command | writes live Algolia? | purpose |
|---|---:|---|
| `census` | no | Browse the source index and count source/page_type. |
| `prepare-target-index` | yes | Create/verify the named target index by copying source settings only; no records copied. |
| `health-scout` | no | Run a real Scout fetch job; never trust `/health` alone. |
| `plan-slice` | no | Create run manifest with exact target IDs and expected counts. |
| `fetch` | no | Fetch target slice with Scout only. |
| `enrich` | no | Create local enrichment artifacts from cached Scout bodies. |
| `repair` | no | Repair/reselect failures from local artifacts only. |
| `build-final` | no | Build one effective final artifact with explicit precedence. |
| `validate` | no | Validate grounding, leakage, quality, scope, and payload shape. |
| `review-pack` | no | Produce mandatory stratified human-review sample. |
| `dry-run-write` | no | Build intended payload for `--target-index` and assert allowed fields only. |
| `apply-write` | yes | Write good records to `--target-index` after approval token. |
| `verify-live` | no | Browse `--target-index` and compare exact payloads. |
| `corpus-status` | no | Report done/pending/human-review-needed counts. |
| `profile-lint` | no | Refuse incomplete or unknown `source/page_type` profile coverage. |
| `cleanup` | local only | Move stale run artifacts to archive; never delete accepted evidence by default. |
| `handoff` | local only | Write restartable handoff for Codex/Claude. |

### Future commands

Do not build these into the v0 critical path.

| command | reason deferred |
|---|---|
| `search-eval` | Search tuning is out of scope for data enrichment v0. |
| `dry-run-quarantine` | Bad records go to human review first. |
| `quarantine` | No automatic copy/delete in v0. |
| `rollback` | Target-index writes are the v0 rollback boundary. |
| `drift-check` | Useful after slices exist in the target index; not required before next enrichment slice. |
| `new-profile` | Useful helper, but profile files can be created directly during v0 implementation. |

## Command Contracts

Each v0 CLI command must implement this contract exactly. This section is the build spec.

| command | required inputs | required outputs | state transition | hard fail conditions |
|---|---|---|---|---|
| `census` | workspace, source index, optional target index | `census-before.json` | none -> `PLANNED` if run absent | Algolia browse fails; zero records without explicit empty-index flag |
| `prepare-target-index` | source index, target index, `target-index-approved.json` if creation needed | `validation/target-index-ready.json` | no change | target name missing; source index missing; target creation not approved; settings copy mismatch |
| `health-scout` | workspace, one probe URL | `scout-health.json` | no change | Scout job timeout; empty body without terminal verdict; provenance missing |
| `plan-slice` | source, page_type, census | `manifest.json` with target objectIDs | `PLANNED` | target count mismatch; duplicate objectIDs; empty target without `--allow-empty` |
| `fetch` | manifest, Scout key | `cache-scout/`, fetch manifest | `PLANNED` -> `FETCHED` | any non-Scout body; cache outside run folder; unclassified fetch failure |
| `enrich` | fetched cache, profile | `outputs/base/results.jsonl` | `FETCHED` -> `ENRICHED` | model returns text; selected ID missing; zero processed rows |
| `repair` | failed/writable outputs, profile | `outputs/repair/results.jsonl` | `ENRICHED` -> `REPAIRED` | repair adds non-source text; repair lowers grounding; zero target rows without explicit reason |
| `build-final` | manifest, base outputs, repair outputs | `final/results.jsonl`, `final/payloads.jsonl`, `final/human-review-queue.jsonl` | `ENRICHED` or `REPAIRED` -> `FINAL_BUILT` | missing target ID; duplicate target ID; implicit glob; unknown precedence |
| `validate` | final artifacts, cache, profile | `validation/artifact-validation.json`, packet | `FINAL_BUILT` -> `VALIDATED` | grounding failure; genuine leakage; dead-page writable; forbidden metadata; zero spans checked |
| `review-pack` | final artifacts, validation | `reports/review-pack.md` | no change | sample cannot be generated; repaired records omitted |
| `dry-run-write` | validated payloads, source census, target census | `validation/write-dry-run.json` | `VALIDATED` -> `WRITE_DRY_RUN_PASSED` | target index not ready; payload has forbidden fields; source count drift not acknowledged; payload count mismatch |
| `apply-write` | dry-run, target index, `write-approved.json` | `validation/write-applied.json` | `WRITE_DRY_RUN_PASSED` -> `WRITTEN` | missing/stale approval; approval target mismatch; count mismatch; Algolia write partial failure |
| `verify-live` | payloads, target index | `validation/live-verification.json` | `WRITTEN` -> `LIVE_VERIFIED` | target index mismatch; live mismatch; missing payload; extra enriched records; forbidden metadata |
| `corpus-status` | run manifests and source/target census | `CORPUS-STATUS.md`, status JSON | no change | done/pending/human-review-needed counts do not reconcile |
| `profile-lint` | profile YAML directory, live page_type census | `validation/profile-lint.json` | no change | missing required profile field; unknown page_type lacks fallback; invalid inheritance |
| `cleanup` | run folder, cleanup policy | `archive/`, updated manifest | no change or `CLOSED` | tries to delete protected artifact without approval |
| `handoff` | state, manifest, validation | `HANDOFF-current.md` | no change | missing current state or next step |

## Command Test Requirements

Every command needs at least one happy-path test and one refusal test.

Mandatory refusal tests:

- `prepare-target-index` refuses to create the target without `target-index-approved.json`
- `prepare-target-index` refuses if target settings differ after copy
- `apply-write` refuses without `write-approved.json`
- `apply-write` refuses stale `source/page_type/count`
- `apply-write` refuses when approval target index differs from `--target-index`
- `build-final` refuses duplicate objectIDs
- `validate` refuses zero spans checked
- `validate` refuses any string not found in source body
- `fetch` refuses non-Scout provenance
- `cleanup` refuses deletion of final artifacts without approval
- `enrich` refuses free-written model output
- `corpus-status` refuses unprofiled live page_types
- `profile-lint` refuses incomplete profile deltas
- `build-final` writes every bad/unusable unresolved record to `human-review-queue.jsonl`
- `apply-write` refuses if payload contains fields other than `objectID`, `abstract_enriched`, and `keyhighlights_enriched`
- `census` refuses a zero-record result without an explicit empty-index flag
- `health-scout` refuses a job returning empty markdown, and refuses `/health` alone as evidence
- `plan-slice` refuses a target count that disagrees with the live census
- `repair` refuses a repair that adds any text absent from the source body
- `review-pack` refuses a pack that omits repaired records
- `dry-run-write` refuses a payload containing any field outside the three allowed
- `verify-live` refuses to pass when it compared zero records or zero spans
- `handoff` refuses to write without a current state and a named next step

Measured 2026-08-10: 8 of the 17 v0 commands had no named refusal test, which broke this
section's own opening rule. The eight above close that. Every v0 command now has one.

## Approval Gates

Externally visible writes must require an approval file created before execution.

Approval files live in:

```text
runs/<run-id>/approvals/
```

Required approvals:

| command | approval file |
|---|---|
| `prepare-target-index` when creating target | `target-index-approved.json` |
| `apply-write` | `write-approved.json` |
| rerun over an accepted final artifact | `rerun-approved.json` |
| deleting/archive-cleaning accepted evidence | `cleanup-approved.json` |

Each approval file must include:

```json
{
  "approved_by": "Arijit",
  "approved_at": "ISO-8601 timestamp",
  "command": "apply-write",
  "run_id": "20260810-blog-blog-post",
  "source": "Blog",
  "page_type": "blog-post",
  "expected_target_count": 2694,
  "expected_write_count": 2694,
  "source_index": "Algolia_Prod_Copy_Enhanced",
  "target_index": "Algolia_Prod_Copy_Enhanced_Parallel"
}
```

The script must verify the approval file matches the current command, source, page_type, counts, and index names. A stale approval cannot be reused on a different slice or index.

This is how the skill prevents unauthorized reruns/writes instead of relying on agent memory.

## V0 Write Contract

V0 writes only to the approved `--target-index`. The source index is read-only.

Allowed write payload fields:

```text
objectID
abstract_enriched
keyhighlights_enriched
```

Hard failures:

- payload includes provenance/audit metadata
- payload includes `null` field deletes
- payload includes bad/unusable/human-review records
- write target is not the approved `--target-index`
- post-write `verify-live` checks zero records or zero spans

The target index is the v0 safety boundary. Rollback/quarantine/delete workflows are not
part of v0.

## Artifact Contract

All outputs for one slice must live under exactly one run folder:

```text
docs/70-enrichment/runs/<run-id>/
  manifest.json
  census-before.json
  scout-health.json
  cache-scout/
  batches/
  outputs/
    base/
    repair/
  final/
    results.jsonl
    payloads.jsonl
    human-review-queue.jsonl
  validation/
    artifact-validation.json
    quality-judge.json
    live-verification.json
  reports/
    packet.md
    review-pack.md
  approvals/
  logs/
  tmp/
```

Rules:

- no writing reports directly into `docs/70-enrichment/reports/` during new runs
- no validating by globbing historical roots
- no using cache outside the run folder unless explicitly imported into the run manifest
- no overwriting `final/results.jsonl` without `rerun-approved.json`
- no loose partial outputs in the project root

## Cleanup Policy

The skill must include `cleanup`.

Default cleanup mode:

- keep `manifest.json`
- keep `final/`
- keep `validation/`
- keep `reports/packet.md`
- keep approvals
- move `tmp/`, transient logs, and superseded repair attempts to `archive/`

### Cache retention

`cache-scout/` grows faster than anything else in a run folder and the default policy did
not mention it.

- while the run is open: keep in full
- at `CLOSED`: archive the bodies, **retain the content hashes** — `drift-check` needs the
  hashes, not the bodies
- never delete a cached body that a still-open `HUMAN_REVIEW` verdict points at

Never delete:

- accepted final artifacts
- approval files
- live-write snapshots
- quarantine manifests
- validation JSON used for approval

Deletion requires `cleanup-approved.json`.

This directly addresses the 67-file report-folder mess.

## Residue Prevention Rules

Commands may only write under:

```text
runs/<run-id>/
```

Exceptions:

- `handoff` may write `docs/70-enrichment/HANDOFF-current.md`
- final human-facing summaries may be copied to `docs/70-enrichment/reports/` only after run is `CLOSED`

The package must include a test that monkeypatches filesystem writes and fails if a command writes outside the run folder.

No command may create:

```text
PACKET-*.md
blog-*.json
*-codex-*.json
*-claude-*.json
```

at the top level or in the shared reports folder during active runs.

## Sanctioned Probes

Mid-run diagnostics are allowed, but only in one place:

```text
runs/<run-id>/probes/
```

Rules:

- probe scripts/artifacts are disposable
- package code must never import from `probes/`
- probe outputs must not be used as approval evidence unless promoted into `validation/`
- probes are archived or deleted at `CLOSED`

This prevents throwaway diagnostics from becoming permanent root-level scripts.

## Corpus Layer

The slice runner answers: "Did this slice run safely?"

The v0 corpus layer answers: "For this slice, what is written to the parallel index, what
is pending, and what needs human review?"

Required file:

```text
docs/70-enrichment/CORPUS-STATE.json
```

Schema:

```json
{
  "source_index": "Algolia_Prod_Copy_Enhanced",
  "target_index": "Algolia_Prod_Copy_Enhanced_Parallel",
  "updated_at": "ISO-8601 timestamp",
  "total_live_records": 11928,
  "classified_source_records": 11928,
  "slices": {
    "Blog/blog-post": {
      "source": "Blog",
      "page_type": "blog-post",
      "planned_target_count": 2800,
      "target_written": 2694,
      "human_review_open": 0,
      "terminal_unwritable": 106,
      "unattempted": 0,
      "outcome_coverage_pct": 1.0,
      "writable_coverage_pct": 0.9621,
      "human_review_pct": 0.0,
      "coverage_target_pct": 1.0,
      "max_human_review_open_pct": 0.05,
      "last_run_id": "20260810-blog-blog-post",
      "profile_version": "blog-post:<hash>",
      "last_verified_at": "ISO-8601 timestamp"
    }
  },
  "unprofiled_page_types": [],
  "excluded": {
    "Support/support-article": {
      "count": 1695,
      "reason": "explicitly excluded until reopened"
    }
  }
}
```

`corpus-status` must:

- browse source index
- browse target index
- count every `source/page_type`
- reconcile source/target counts with run manifests and `CORPUS-STATE.json`
- list target-written / human-review-open / terminal-unwritable / unattempted per slice
- fail if any live page_type has no profile or explicit exclusion
- fail if a slice falls below its coverage target

No future slice starts if `corpus-status` is red.

## Coverage Definition

"Done" cannot mean "whatever survived."

Every source profile must define:

```text
coverage_target_pct
max_human_review_open_pct
allowed_terminal_verdicts
minimum_review_sample
```

For a slice to reach `CLOSED`:

- every target record must have exactly one outcome
- every writable record must pass validation
- every unusable record must be in human review or explicitly counted terminal
- `outcome_coverage_pct = outcomes_count / original_plan_slice_target_count` must meet the profile target
- `human_review_open_pct = human_review_open_count / original_plan_slice_target_count` must be <= `max_human_review_open_pct`
- human review is an outcome, not an enriched/writable record
- corpus state must be updated

Example:

```text
Blog/blog-post:
  planned_target_count = 2800
  outcome_coverage_pct = 2800 / 2800 = 1.0
  writable_coverage_pct = 2694 / 2800 = 0.9621
  human_review_open_pct = 0 / 2800 = 0.0
  terminal_unwritable_pct = 106 / 2800 = 0.0379
  max_human_review_open_pct = 0.05

Documentation/doc-*:
  coverage_target_pct may be lower if profile allows honest no-abstract outcomes
```

Coverage target is a profile decision, not an accidental run result.

## Future Re-Entry / Drift

Out of v0. V0 writes only `abstract_enriched` and `keyhighlights_enriched` to the
approved target index. Future live-stamp or drift behavior can be reopened only after
v0 proves repeatable enrichment across multiple source profiles.

## Script Promotion Audit

### Measured, not estimated (import graph, 2026-08-10)

Arijit asked three times whether all 40 scripts are needed. They are not. This was settled
by parsing every file's AST and walking the import graph from the real entry points
(`enrich_run`, `run_batches`, `write_enrichment`, `make_batches`, `span_repair`):

```text
reachable from live entry points : 14 modules,  5,328 lines
orphans (nothing imports them)   : 17 modules,  5,047 lines
total on disk                    : 40 modules, 13,321 lines

carry into the skill             : 15 files,    6,042 lines
do not carry                     : 25 files,    7,279 lines
                                   -------------------------
                                   40 files,   13,321 lines  (sum verified)
```

**25 of 40 files, and 7,279 of 13,321 lines, do not go into the skill in any form.**

#### The finding that changes the build

`fetch_router.py` (539 lines) — the Scout-only fetcher, the thing that enforces the
single most important hard rule in the project — **is not reachable from the live
runner.** It is imported only by `shape_probe.py`, `shape_probe_libraries.py`, and
`verify_written.py`. The runner's own source says so:

```text
enrich_run.py:3     "Fetch is already done by fetch_router; this does:"
enrich_run.py:1306  sys.exit("FATAL: run `fetch_router.py --fetch-pilot 30` first")
```

The pipeline is **two disconnected halves joined by a human running them in the correct
order.** Fetch is one program; enrich is another; nothing in code connects them or
verifies that the bodies the runner reads are the bodies the fetcher wrote.

That is the primary thing the skill exists to fix. `bodysource.py` is where the two halves
join, and after the refactor there must be **no way to run `enrich` against a cache that
`fetch` did not produce in the same run folder.**

#### What actually carries forward — 15 files, 6,042 lines

| file | lines | destination | carry |
|---|---:|---|---|
| `span_gate.py` | 1090 | `gates.py` + `canonical.py` | logic — **split**; `canonicalise()` is extracted, it is not a gate |
| `candidates.py` | 640 | `candidates.py` | logic |
| `fetch_router.py` | 539 | `scout.py` + `bodysource.py` | logic — **and must be wired into the live path, which it is not today** |
| `enrich_run.py` | 1376 | `model_io.py` + CLI orchestrator | logic — **split**; contains the known dead gate paths, do not copy whole |
| `run_batches.py` | 324 | `batching.py` | logic |
| `pool_gates.py` | 262 | `gates.py` | logic |
| `write_enrichment.py` | 244 | `write.py` | logic |
| `span_repair.py` | 219 | `repair.py` | logic |
| `verdicts.py` | 215 | `verdicts.py` | logic |
| `make_batches.py` | 204 | `batching.py` | logic |
| `snapshot_enhanced.py` | 197 | `api.py` | logic |
| `boilerplate.py` | 167 | `filters.py` | patterns |
| `pool_filters.py` | 146 | `filters.py` | logic |
| `curl_secret.py` | 56 | `api.py` | logic |
| `assert_scout_provenance.py` | 363 | `scout.py` + `validate/grounding.py` | logic — **served URL == requested URL.** Earned its place on 2026-08-10: 2 of 237 case studies return HTTP 200 while redirecting to a different page. A status-code check passes them; this does not. |

Two of these — `enrich_run.py` and `span_gate.py` — are 2,466 lines, 41% of everything
being carried, and are the two files with the documented dead-path defects. They are
**split**, never copied.

#### What does not carry — 25 files, 7,279 lines

| group | files | lines | why |
|---|---|---:|---|
| Not enrichment at all | `asana_restructure`, `asana_renumber_units`, `apply_taxonomy`, `classify`, `dedupe`, `build_schema` | 2,332 | Asana tooling, taxonomy, dedupe. Different jobs. |
| One-off diagnostics | `shape_probe`, `shape_probe_libraries`, `cal200_report`, `phase1_packet`, `check_artifact_links`, `test_reproducibility`, `enrich_ready`, `build_blog_manifest` | 1,788 | Written to answer one question during one incident. |
| Blog-specific verifiers and packets | `verify_blog_e2e_live`, `verify_blog_packet`, `verify_repair_packet`, `validate_blog_outputs`, `census_blog_quality`, `leakage_audit`, `final_packet`, `make_review_pack`, `verify_written`, `make_quarantine_batches`, `delete_records` | 3,159 | **Rewritten as `validate/*` and CLI subcommands.** The behaviour carries; the files do not. Eleven separate verifier scripts is eleven incidents, not a design. |

`delete_records.py` and `make_quarantine_batches.py` are additionally out of v0 scope —
v0 has no quarantine or delete.

### Promote Into Internal Package

| current file | destination | note |
|---|---|---|
| `snapshot_enhanced.py` | `api.py` | Keep paginated browse and index settings helpers. |
| `curl_secret.py` | `api.py` | Keep secret-safe API calls. No page-body web fetch. |
| `fetch_router.py` | `scout.py` | Scout-only fetch and served URL identity. |
| `make_batches.py` | `batching.py` | Generic source/page_type batches. |
| `run_batches.py` | `algolia_enrich.py` + `batching.py` | One CLI command owns worker orchestration. |
| `enrich_run.py` | `model_io.py` + `algolia_enrich.py` | Keep writer loop; remove dead duplicate gate paths. |
| canonicalization helpers | `canonical.py` | Promote out of `candidates.py`; one source of truth for text matching. |
| `candidates.py` | `candidates.py` | Candidate slicing only; imports `canonical.py` for normalization. |
| `pool_filters.py` | `filters.py` | Shared forbidden/chrome filters. |
| `pool_gates.py` | `gates.py` | Pre-selection bans. |
| `span_gate.py` | `gates.py` | Live-path post-selection gates only. |
| `span_repair.py` | `repair.py` | Contiguous source-span repair. |
| `verdicts.py` | `human_review.py` / `validate/payload.py` | Honest terminal outcomes and human-review queue rows. |
| `boilerplate.py` | `filters.py` | **Fold in. Decided, not deferred** — its chrome/furniture patterns are load-bearing for the `highlights are not chrome/furniture/boilerplate` gate. "If still needed" is how residue enters. |
| `write_enrichment.py` | `write.py` | Dry-run/apply payload writer. |
| `assert_scout_provenance.py` | `scout.py` / `validate/grounding.py` | Provenance check folded into core commands. |
| `verify_written.py` | `validate/live.py` + `drift.py` | Keep live verification and re-fetch logic; no standalone script. |

### Refactor Logic, Do Not Copy Raw

| current file | replacement |
|---|---|
| `validate_blog_outputs.py` | `validate/grounding.py`, `validate/quality.py`, `validate/payload.py` |
| `verify_blog_packet.py` | CLI command `validate --packet` |
| `verify_blog_e2e_live.py` | `verify-live` command |
| `verify_repair_packet.py` | `repair` + `validate` commands |
| `census_blog_quality.py` | `validate/quality.py --quality-census` |
| `make_quarantine_batches.py` | do not promote in v0 |
| `delete_records.py` | do not promote in v0 |
| `final_packet.py` | CLI command `validate --packet` |
| `leakage_audit.py` | `validate/quality.py --leakage` |
| `make_review_pack.py` | `review-pack` command |

### Do Not Copy

```text
apply_taxonomy.py
asana_renumber_units.py
asana_restructure.py
build_schema.py
classify.py
dedupe.py
shape_probe.py
shape_probe_libraries.py
cal200_report.py
phase1_packet.py
check_artifact_links.py
test_reproducibility.py
enrich_ready.py
build_blog_manifest.py
```

These are residue, diagnostics, taxonomy tools, or one-off helpers.

## Grounding Contract

No string written to `abstract_enriched` or `keyhighlights_enriched` may contain any word, phrase, sentence, punctuation repair, or connective text that is not present in the Scout-fetched source body for that exact record.

Grounding is deterministic code, not LLM judgement.

Enforced in:

| layer | module | hard rule |
|---|---|---|
| Scout fetch | `scout.py` | Body must come from Scout and match requested/served identity rules. |
| Canonicalization | `canonical.py` | One normalization implementation shared by selector, repair, artifact validation, and live verification. |
| Candidate slicing | `candidates.py` | Candidate text is sliced from fetched body with offsets. |
| Writer interface | `model_io.py` | Writer returns candidate IDs only. Free text is invalid. |
| Resolution | `candidates.py` | Final strings resolve from source offsets. |
| Repair | `repair.py` | Repair only by contiguous source text. |
| Artifact validation | `validate/grounding.py` | Stored strings must be found in source body without trusting offsets. |
| Live verification | `api.py` + `validate/live.py` | Live values must exactly match final payloads. |

Hard failures:

- model returns free-written text
- selected ID does not exist
- selected string cannot be found in source body
- repair adds text not in body
- Scout served wrong document
- validation checks zero spans
- target index value differs from approved payload

`canonical.py` is a P0 module. Grounding bugs in Blog came from normalization drift; this skill must not bury canonicalization inside candidate splitting.

## Writer And Judge Contract

### Writer

Allowed output:

```json
{
  "abstract": [12, 14, 15],
  "key_highlights": [23, 28, 31, 37, 40]
}
```

Forbidden:

```json
{
  "abstract": "Algolia helps teams..."
}
```

### Judge

The judge checks quality/correctness. It cannot write final text.

Allowed judge outputs:

- `PASS`
- `RESELECT`
- `REPAIR_FROM_SOURCE`
- `DROP_HIGHLIGHT`
- `HUMAN_REVIEW`
- `QUARANTINE`

Forbidden judge behavior:

- paraphrase replacement text
- add bridging phrases
- use training-data facts
- approve text deterministic grounding cannot locate

Judge results live in artifacts only, never on Algolia records.

### Model Separation

Writer and judge must be different model configurations.

Required config:

```yaml
writer_tier:  large                        # alias, for the request
writer_model: glm-5.2                      # SERVED model string, asserted at run start
judge_tier:   small
judge_model:  gemma-4-26b-a4b-nvfp4        # SERVED model string, asserted at run start
judge_enabled: true|false
```

**Assert on the served model string, never the tier alias.** Verified live 2026-08-10 by
`GET {ALGOLIA_INFERENCE_BASE_URL}/models`:

```text
large  -> glm-5.2                 small  -> gemma-4-26b-a4b-nvfp4
xlarge -> glm-5.2                 medium -> gemma-4-31b-it-nvfp4
```

Two traps this closes:

- `large` and `xlarge` both serve glm-5.2, which is the writer. A tier-only check would let
  the writer grade itself.
- `medium` (gemma-4-31b) now exists and looks like a harmless judge upgrade. It is not the
  writer, so a writer≠judge tier check passes — but it is an unvalidated model swap. Pinning
  the served string means any rename or re-point fails loudly instead of silently changing
  what graded the corpus.

At run start the skill must call `/models`, resolve both tiers to their served strings,
compare against the profile, and refuse on mismatch. Both strings go into
`effective-config.json`.

Rules:

- `judge_enabled: true` and `judge_model == writer_model` is a hard failure
- `judge_enabled: false` must be explicit in the source profile or run config
- a disabled judge means deterministic gates and human review carry quality risk; the packet must say that
- the judge may never repair by writing prose, even when it is a different model

This prevents the writer from grading itself.

## Quality And Correctness Gates

The validation package must check:

- abstract is not title/description duplicate
- abstract is not self-referential
- abstract starts and ends cleanly
- abstract has enough substance for its source profile
- span combination does not create broken context
- highlights are independently useful
- highlights are not duplicates
- highlights are not chrome/furniture/boilerplate
- highlights do not end as dangling lead-ins
- no dead/shell/login/fetch-failed record is writable
- quality judge failures are resolved or explicitly carried to human review

### Judge Rubric

The judge is a quality reviewer, not a writer and not a grounding authority.

It must return structured JSON with one verdict per record:

```json
{
  "verdict": "PASS|REPAIR|RESELECT|DROP_HIGHLIGHT|HUMAN_REVIEW",
  "defects": [
    {
      "field": "abstract_enriched|keyhighlights_enriched",
      "type": "duplicate_description|missing_subject|wrong_context|weak_abstract|thin_highlight|chrome|boilerplate|quote_without_attribution|broken_sentence|unsupported_claim|low_coverage",
      "span_index": 0,
      "reason": "short explanation"
    }
  ]
}
```

Hard rubric:

| check | pass condition | failure action |
|---|---|---|
| Grounding | every string is found in the Scout body by deterministic code | hard fail; judge cannot override |
| Abstract usefulness | says what the page is about beyond title/description | repair/reselect, then human review |
| Abstract completeness | covers the main point of the page, not a random isolated fact | repair/reselect, then human review |
| Context correctness | selected spans do not imply a claim the page does not make | repair/reselect, then human review |
| Highlights usefulness | each highlight is independently meaningful | drop or replace |
| Highlight diversity | highlights are not duplicates of each other or the abstract | drop or replace |
| Chrome/furniture | no nav, CTA loops, cookie/audio/browser fallback, related-content rails | hard fail for that span |
| Quotes | quote spans keep speaker/attribution or are excluded by profile | repair/reselect, then human review |
| Source profile fit | output shape matches the profile strategy | human review if ambiguous |

The judge may ask for a repair or reselection. It may not provide replacement prose.

### Mandatory Sampling

Full human review is not required for large slices. Sampling is mandatory.

Every slice packet must include a deterministic stratified review sample:

```text
minimum_review_sample from profile, with at least:
- 20 writable PASS records, or all if fewer
- 10 repaired records, or all if fewer
- 10 judge-reselected records, or all if fewer
- 10 human-review-needed records, or all if fewer
- all records with language mismatch
- all records with shell/dead/login/fetch-failed verdicts over a profile-defined small threshold
```

The sample artifact must show objectID, URL, title, abstract, highlights, source snippets,
and judge/deterministic validation outcomes. Human review is a confidence layer, not a
grounding substitute.

### Bad Record Handling

Bad/unusable records are not automatically quarantined in v0.

V0 writes:

```text
final/human-review-queue.jsonl
```

Each row includes:

- objectID
- source/page_type
- URL
- terminal verdict or unresolved defect
- reason
- suggested action: `fix_source`, `retry_enrichment`, `exclude`, `manual_review`, or `candidate_for_quarantine`
- review_status: `OPEN`
- reviewer_decision: null
- reviewed_by: null
- reviewed_at: null
- reentry_command: null

Only Arijit or a human owner decides whether those records are later moved to a quarantine
index or deleted from a main index.

Reviewer action vocabulary:

| decision | meaning | next step |
|---|---|---|
| `retry_enrichment` | source is fine; writer/selection failed | create a repair/retry manifest for those objectIDs |
| `fix_source_then_retry` | page/index source is broken but fixable | wait for source fix, then fetch/enrich those objectIDs |
| `accept_no_enrichment` | record remains in source index with no enrichment | count as terminal non-writable outcome |
| `candidate_for_quarantine` | record appears bad/unusable and should be considered for quarantine later | out of v0; requires separate human-approved cleanup flow |
| `exclude_from_slice` | profile should not attempt this record class | update profile/exclusion rule, then rebuild final artifact |

Human-review files:

```text
final/human-review-queue.jsonl        # generated by validate/build-final
review/human-decisions.jsonl          # filled by human or reviewer tool
review/retry-manifest.json            # generated from decisions requiring retry
review/review-summary.json            # counts by decision and remaining OPEN items
```

Re-entry rules:

- `retry_enrichment` records re-enter at `repair` or `enrich` with an explicit retry manifest
- repaired/retried records must pass the same grounding/quality/payload gates
- `build-final` must apply final precedence: retry output wins over previous failed output
- `CLOSED` is allowed with open human-review records only if the source profile permits terminal human-review backlog
- otherwise `CLOSED` requires `review_status != OPEN` for every human-review row

For large slices, the skill may finish v0 with good records written to the target index and
bad records in `OPEN` review, but the packet must say:

```text
slice_write_complete = true|false
human_review_open = <count>
closed = false if open review exceeds profile policy
```

## Source Profiles

Profiles are data files, not Python literals.

Location:

```text
scripts/profiles/
```

Required shape:

```text
base.yaml
blog-post.yaml
press-release.yaml
case-study.yaml
resource.yaml
product-page.yaml
docs.yaml
developer-code-sample.yaml
hub-page.yaml
generic-marketing-page.yaml
```

`profiles.py` loads, validates, hashes, and resolves these profiles.

All profiles inherit from `base.yaml`; profile files should contain deltas only.

Unknown `source/page_type` must hard refuse. No silent default.

Profiles choose strategies. They do not encode algorithms.

Strategy examples:

```yaml
strategy: editorial
strategy: press_release
strategy: case_study
strategy: docs_api
strategy: developer_code
strategy: no_abstract
```

Each strategy is implemented in `algolia_enrichment/strategies/`.

This matters because Documentation and code samples cannot be solved by sentence-splitting rules alone.

Executable schema:

```python
@dataclass(frozen=True)
class SourceProfile:
    source: str
    page_type: str
    min_body_chars: int
    language_policy: Literal[
        "must_match_record",
        "allow_known_english_body",
        "ignore",
    ]
    dead_page_markers: tuple[str, ...]
    shell_markers: tuple[str, ...]
    forbidden_patterns: tuple[Pattern[str], ...]
    allowed_code_comments: bool
    abstract_shape: Literal[
        "editorial_summary",
        "announcement_summary",
        "case_study_summary",
        "resource_summary",
        "product_summary",
        "api_facts",
    ]
    strategy: Literal[
        "editorial",
        "press_release",
        "case_study",
        "docs_api",
        "developer_code",
        "no_abstract",
    ]
    abstract_span_count: tuple[int, int]
    highlight_count: tuple[int, int]
    max_span_distance: int | None
    duplicate_description_policy: Literal["ban", "allow_if_additive", "no_abstract"]
    judge_required: bool
    judge_threshold: float
    human_review_after_attempts: int
    coverage_target_pct: float
    allowed_terminal_verdicts: tuple[str, ...]
    minimum_review_sample: int
```

Profiles must be versioned:

```text
profile_version = source/page_type + hash(profile config)
```

The profile version is written to artifacts only, not Algolia records.

Required profile families:

| source/page_type | policy |
|---|---|
| `Blog/blog-post` | Content-rich editorial; `/de` and `/fr` serving English is known Blog behavior and counted, not gated. |
| `Website/press-release` | News. Preserve announcement subject, dates, people/company/product names; remove boilerplate media footer. |
| `Customer Stories/case-study` | Capture customer, industry, problem, solution, outcome metrics; flag unsupported ROI. |
| `Resources/resource` | Detect gated landing pages; avoid form chrome. |
| `Website/product-page` | Buyer/product value; avoid nav and CTA loops. |
| `Documentation/doc-*` | Do not force editorial abstracts; may use API facts/operations/parameters instead. **Partitioned into 3 strategy groups — see below.** |

### Documentation partition — use the existing page_types, do not invent new shapes

Documentation is 4,337 records and **is already classified**. The index carries 12 real
`doc-*` page_types with exact counts (verified live 2026-08-10). Do not build a new
classifier for an already-classified corpus, and do not partition into invented shapes
like "service overview" or "CLI page" — those labels exist nowhere in the data.

Three enrichment profiles, mapped from the real index labels. This is a run-local
strategy map, not a new taxonomy and not a record mutation:

| strategy group | profile | page_types | records | % of Documentation |
|---|---|---|---:|---:|
| reference | `Documentation__reference.yaml` | doc-sdk, doc-api-reference, doc-sdk-unified, doc-rest-api, doc-ui-library | **3,411** | 78.6% |
| guide/prose | `Documentation__guide.yaml` | doc-guide, doc-tool, doc-integration, doc-framework-integration | **923** | 21.3% |
| nav | `_fallback__hub-page.yaml` | doc-hub, doc-changelog, doc-glossary | **3** | 0.1% |

Sum check: 3,411 + 923 + 3 = 4,337. Exhaustive, no overlap.

Facts that must shape the reference profile:

- `doc-sdk` alone is **2,203 records — 50.8% of Documentation and 18% of the whole
  corpus.** 2,189 of them live under `/doc/libraries/`, with 1,886 distinct titles. It is
  genuine per-language SDK reference, not template duplication. Any Documentation plan
  that does not name `doc-sdk` explicitly has not looked at the data.
- `min_body_chars` must be **low**. A terse API reference page is legitimately short. It is
  not a dead page. Reusing Blog's floor here would quarantine correct pages en masse.
- `abstract_shape: api_facts`, never `editorial_summary`.
- Highlights must be independently useful facts — operation, constraint, parameter,
  response behaviour, plan limitation — never transport/protocol filler, never a code
  fragment presented as prose, never a parameter without enough context to be useful.

The Documentation probe's job is to **validate this strategy map and set qualitative
fields**, not to derive a partition. If evidence shows that a real `page_type` needs a
different enrichment profile, change only the run-local `page_type -> profile` mapping,
record the rationale in the run artifact, and re-run profile lint. Never change a
record's `source` or `page_type`, and never create a new index taxonomy label.

### The three Documentation profiles, written out

A named profile cannot run. These are the deltas over `base.yaml`.

#### `Documentation__reference.yaml` — 3,411 records (78.6%)

Routes: `doc-sdk` 2203, `doc-api-reference` 418, `doc-sdk-unified` 398, `doc-rest-api` 333,
`doc-ui-library` 59.

```yaml
strategy: docs_api
abstract_shape: api_facts
language_policy: must_match_record
min_body_chars: 250            # LOW ON PURPOSE. A terse API page is short and correct.
                               # Blog's floor would quarantine correct pages en masse.
abstract_span_count: [1, 3]
highlight_count: [3, 6]
duplicate_description_policy: ban
max_span_distance: 12          # reference prose is interleaved with code blocks
allowed_code_comments: false
judge_required: true
coverage_target_pct: 0.75      # honest no-abstract outcomes are expected here
max_quarantine_pct: 0.05
minimum_review_sample: 25
forbidden_patterns:
  - "^(Parameters|Returns|Response|Example|Usage|Signature)$"   # bare section headings
  - "^(GET|POST|PUT|DELETE|PATCH) /"                            # a route line is not prose
  - "^(import|const|from|require|package|using) "               # code masquerading as a sentence
  - "^See (also )?the .* (guide|reference|documentation)"       # pure cross-reference
  - "^(Was this page helpful|On this page|Edit this page)"
dead_page_markers: ["Page not found", "This page has moved"]
shell_markers: ["Loading documentation", "doc-index"]
```

Highlights must be **independently useful facts** — an operation, a constraint, a parameter
with its meaning, a response behaviour, a plan limitation. Never transport/protocol filler,
never a code fragment presented as prose, never a parameter name without enough context to
be useful on its own.

#### `Documentation__guide.yaml` — 923 records (21.3%)

Routes: `doc-guide` 586, `doc-tool` 175, `doc-integration` 119, `doc-framework-integration` 43.

```yaml
strategy: editorial
abstract_shape: editorial_summary
language_policy: must_match_record
min_body_chars: 600
abstract_span_count: [2, 3]
highlight_count: [3, 5]
duplicate_description_policy: ban
max_span_distance: 8
allowed_code_comments: false
judge_required: true
coverage_target_pct: 0.85
max_quarantine_pct: 0.05
minimum_review_sample: 20
forbidden_patterns:
  - "^(Prerequisites|Before you begin|Next steps|Related)$"
  - "^(import|const|from|require) "
  - "^(Was this page helpful|On this page)"
```

The abstract must say **what the page enables or explains**, not restate its title.
`doc-tool` and `doc-ui-library` are the two routes most likely to be mis-grouped; if the
probe shows otherwise, move the routing entry — never the record's `page_type`.

#### `_fallback__hub-page.yaml` — 3 records (0.1%)

Routes: `doc-hub`, `doc-changelog`, `doc-glossary`.

```yaml
strategy: no_abstract
duplicate_description_policy: no_abstract
coverage_target_pct: 0.0       # the correct outcome is no enrichment, recorded honestly
judge_required: false
```

Nav furniture. A hub page receiving no abstract is a **pass**, not a failure, and the packet
must count it as such rather than as a gap.

**Before committing to 3,411 reference records, run 25 `doc-sdk` records end to end** —
fetch, enrich, validate, write to the target index, verify live. The `docs_api` strategy
has never executed. This is the checkpoint that press-release would otherwise have
provided.
| `Developers/developer-code-sample` | Code-heavy; code comments allowed only if explanatory. |
| `Developers/developer` | Developer hub/reference prose. Use generic developer content strategy; not covered by `developer-code-sample`. |
| `Academy/academy-training` | Login-required unless Scout can fetch full body. |
| `Support/support-article` | Excluded until explicitly reopened. |
| `hub-page` fallback | For blog-hub, product-hub, resource-hub, developer-hub, doc-hub, utility, contact-sales, careers. Usually nav furniture; no forced abstract. |
| `generic-marketing-page` fallback | For small marketing tail: solution-page, industry-page, use-case, comparison, partner, trust, pricing, department-page, program, event, webinar, company, services, landing-page. |

### Profile filenames

Profiles are keyed on `source/page_type`, so the filename must carry both. `resource.yaml`
cannot distinguish `Resources/resource` from any future source sharing that page_type.

```text
base.yaml
Blog__blog-post.yaml
Website__press-release.yaml
Customer-Stories__case-study.yaml
Resources__resource.yaml
Website__product-page.yaml
Documentation__profile-map.yaml       # maps the 12 existing doc-* page_types to profiles
Documentation__reference.yaml
Documentation__guide.yaml
Developers__developer-code-sample.yaml
Developers__developer.yaml
Academy__academy-training.yaml
_fallback__hub-page.yaml
_fallback__generic-marketing-page.yaml
```

### The next two slices, written out

A one-line table row is not a profile. The schema has 19 fields. These two must exist in
full before either slice starts — everything discovered mid-run on Blog was discovered
because the profile was a sentence.

#### `Customer Stories/case-study` — 237 records (verified live)

```yaml
source: "Customer Stories"
page_type: case-study
strategy: case_study
abstract_shape: case_study_summary
language_policy: must_match_record      # the de/fr-serves-English ruling is Blog-ONLY
min_body_chars: 900
abstract_span_count: [2, 3]
highlight_count: [4, 6]
duplicate_description_policy: ban       # see note below — this is the likely failure mode
max_span_distance: 8
judge_required: true
coverage_target_pct: 0.85
max_human_review_open_pct: 0.05
human_review_after_attempts: 2
minimum_review_sample: 20
forbidden_patterns:
  - "^(Read|Download) the (full )?(case study|story)"
  - "^Ready to (get started|see|talk)"
  - "^About Algolia"                    # the boilerplate block, banned as a CANDIDATE
  - "^\\d+%$"                           # a bare stat tile with no sentence around it
dead_page_markers: ["Page not found", "customer story is no longer available"]
shell_markers: ["Loading customer story", "customer-story-skeleton"]
```

Case-study-specific risks the profile must handle:

- **Information gain is the real failure mode here, not grounding.** The lede on a case
  study is almost always a compressed restatement of the meta description. That pattern
  already cost the reference family 49 of 49 pages. Without
  `duplicate_description_policy: ban` you get 237 grounded, faithful, useless abstracts
  and every gate passes.
- **ROI stat tiles** (`+34%`, `2x faster`) are grounded and meaningless as standalone
  highlights. Require the surrounding sentence, never the bare figure.
- **Customer pull-quotes** are the most quotable text on the page and the most likely to
  lose their attribution during canonicalisation. Either capture speaker + attribution as
  one span, or ban quote spans for this profile.
- **Logo walls and "other customers" rails** are chrome. They must be banned at the
  candidate layer.
- Expect ~180 of 237 written at Blog's 77.6% writable rate. `coverage_target_pct: 0.85` is
  a deliberate target, not a prediction — if the run lands under it, the slice fails and
  that is the point.

#### `Website/press-release` — 690 records (count to be confirmed by `plan-slice`, not assumed)

```yaml
source: Website
page_type: press-release
strategy: press_release
abstract_shape: announcement_summary
language_policy: must_match_record
min_body_chars: 700
abstract_span_count: [2, 3]
highlight_count: [3, 5]
duplicate_description_policy: ban
max_span_distance: 6
judge_required: true
coverage_target_pct: 0.85
max_human_review_open_pct: 0.05
human_review_after_attempts: 2
minimum_review_sample: 20
forbidden_patterns:
  - "^About Algolia"                    # the single highest-risk candidate on the page
  - "^(Media|Press) (Contact|Inquiries)"
  - "^Forward[- ]looking statements"
  - "^[A-Z][A-Z .]+, [A-Z][a-z]+ \\d{1,2}, \\d{4}\\s*[—–-]"   # dateline
  - "^SOURCE Algolia"
dead_page_markers: ["Press release not found"]
shell_markers: []
```

Press-release-specific risks:

- **"About Algolia" boilerplate is the highest-scoring editorial-looking prose on the
  page.** It will be selected as the abstract on all 690 unless banned. Ban it **at the
  candidate layer** — ban the candidate, not the record. A record-level gate here would
  kill 690 records the way the gate nearly killed 589 Blog records.
- **The dateline** (`SAN FRANCISCO, Aug 4, 2026 —`) is perfectly grounded and a terrible
  lede.
- **Press releases are roughly half quotes.** Canonicalisation destroys attribution
  structure. Same rule as case-study: capture speaker + attribution together, or ban.
- **Language.** The "de/fr serving English is acceptable" ruling was measured at 100% of
  Blog and 0% of every other source. It must not be generalised here. `must_match_record`
  is deliberate, and the census must prove it before enrichment rather than after.

Before a new source slice, run a bounded 10-25 record profile probe.

**The probe may set qualitative fields only**: `strategy`, `abstract_shape`,
`dead_page_markers`, `shell_markers`, `forbidden_patterns`, `language_policy`,
`duplicate_description_policy`.

**The probe may NOT set numeric thresholds** — `min_body_chars`, `judge_threshold`,
`abstract_span_count`, `highlight_count`, `max_span_distance`, `coverage_target_pct`,
`max_human_review_open_pct`. Those inherit unchanged from `base.yaml` or a sibling profile until
a full-slice census supplies real numbers.

Why: the measured noise band on this corpus is +/-2 PASS at n=50. A 25-record probe cannot
distinguish a real threshold from noise, and a threshold tuned on 25 records is a number
invented to fit a sample. It may not become an open-ended research phase either.

`profile-lint` must:

- resolve inheritance
- verify every required field exists
- verify every live `source/page_type` maps to a named profile, fallback profile, or explicit exclusion
- print uncovered page_types and counts
- fail on unknown page_type
- fail when a profile references an unknown strategy
- fail when a strategy required by a live high-volume slice has no implementation

Current live coverage target from Claude's review:

```text
Named/fallback profile coverage must cover all non-excluded live page_types.
Support/support-article remains explicitly excluded unless reopened.
```

For v0, create profile files directly. A helper command for scaffolding profiles can come
later; it is not required to run the next slice.

## Search Utility Validation

Writing enriched fields is not enough.

For each completed slice:

- run baseline query set against current settings
- run same query set with enriched fields enabled in a temporary/test settings copy
- compare top result changes
- detect source skew
- detect bad promotions
- report newly retrievable records
- recommend enable / hold / low-priority recall only

Do not change production searchable settings without `settings-approved.json`.

Minimum query protocol:

```text
20 source-specific known-item queries
20 generic buyer/developer queries
10 long-tail conversational queries
10 negative-control queries
```

Metrics:

- target record appears in top 10
- top 3 relevance manual/LLM score
- source distribution before/after
- newly matched records from enriched fields
- bad promotions caused by enriched fields

Pass/fail — **thresholds are pre-registered, never chosen after seeing results**:

The query set file must declare its own numeric thresholds before the baseline runs, and
that file's hash goes into `effective-config.json`. A threshold picked after the numbers
are in is not a threshold.

```yaml
# query-set.yaml — committed and hashed BEFORE the baseline run
thresholds:
  max_negative_control_top3_changes: 2      # of 10 negative controls
  max_bad_promotions_pct: 0.10              # of all queries
  min_newly_retrievable_records: 25
  max_source_skew_delta_pct: 0.15           # any single source's share of top-10
```

- fail if any declared threshold is breached
- fail if enriched fields create wrong-source skew beyond `max_source_skew_delta_pct`
- pass only as "recommended to enable" if every threshold holds and gains outweigh bad
  promotions

### Applying settings

`--apply-settings` writes `searchableAttributes`. Two hard rules:

```text
WRONG:  "unordered(abstract_enriched),unordered(keyhighlights_enriched)"
RIGHT:  ["unordered(abstract_enriched)", "unordered(keyhighlights_enriched)"]
```

A comma-joined string is stored by Algolia as **one garbage attribute** and is silently
unsearchable. One attribute per priority level, always.

Verification is a **query that returns > 0 hits** on text that exists only in an enriched
field. Reading the settings back proves nothing — the garbage attribute reads back
perfectly.

This protocol is intentionally separate from enrichment correctness. A slice can be perfectly enriched and still not be worth enabling in searchable settings yet.

## SKILL.md Contract

Claude is right: `SKILL.md` is the actual product surface for future Codex agents.

`SKILL.md` must be short and strict. It must not duplicate all reference docs.

Required frontmatter:

```yaml
---
name: algolia-corpus-enrichment
description: Use when enriching Algolia index records with grounded `abstract_enriched` and `keyhighlights_enriched`, validating corpus slices, writing approved enrichment to a parallel Algolia index, creating human-review queues for bad records, or planning/continuing Algolia corpus enrichment work. Always use the bundled CLI; never run loose historical scripts.
---
```

Required body sections:

1. **Use the CLI only**

```text
Run `python scripts/algolia_enrich.py <command> ...`.
Do not run loose scripts from `docs/70-enrichment/*.py`.
```

2. **Required read order**

```text
1. Read `CORPUS-STATE.json` if it exists.
2. Read the current run's `state.json` and `manifest.json` if continuing a run.
3. Run `corpus-status` before planning a new slice.
4. Read only the reference file needed for the current command.
```

3. **Forbidden actions**

```text
- do not glob historical reports as truth
- do not write outside `runs/<run-id>/`
- do not approve your own writes
- do not run write commands without approval files
- do not use non-Scout page-body fetches
- do not force enrichment for shell/dead/login pages
- do not store provenance metadata on records in v0
```

4. **Grounding invariant**

```text
The LLM selects IDs; final strings come from Scout-fetched source spans.
```

5. **Unknown source/page_type behavior**

```text
Hard refuse and create/update the source profile; never fallback silently.
```

6. **When to load references**

```text
validation-gates.md — when validating or fixing gates
source-profiles.md — when adding/changing profile behavior
corpus-lifecycle.md — when checking status/drift/re-entry
artifact-contract.md — when handling run files/cleanup
blog-lessons.md — when debugging a failure class seen in Blog
collaboration-handoff.md — when crossing Codex/Claude sessions
```

This is the anti-residue behavior future agents will actually read.

## Tests

Package only tests that guard reusable failures:

```text
tests/live_path.py
test_already_indexed.py
test_batching_and_retry.py
test_boilerplate.py
test_broken_span_boundaries.py
test_canonical.py
test_candidates.py
test_candidates_lede.py
test_canonicalise_idempotent.py
test_coverage_denominator.py
test_human_review_queue.py
test_gate_wiring.py
test_judge_model_separation.py
test_offset_free_grounding.py
test_pool_filters.py
test_pool_gates_live_path.py
test_profile_lint.py
test_production_control_gates.py
test_parallel_index_payload.py
test_scout_only_router.py
test_scout_provenance.py
test_span_gate.py
test_span_repair_live_path.py
test_span_spread_scaling.py
test_validate_blog_outputs.py
test_verdicts.py
```

`test_validate_blog_outputs.py` is the real filename on disk. Earlier drafts listed
`test_validate_outputs.py`, which does not exist. Verified:
`ls docs/70-enrichment/tests/` — `test_validate_blog_outputs.py` EXISTS,
`test_validate_outputs.py` does not.

`tests/live_path.py` is a shared helper, not a test. It must be packaged: both
`test_gate_wiring.py:28` and `test_span_spread_scaling.py:114` do
`from live_path import live_path_source`, so omitting it means neither test collects.

Additional tests still to add:

```text
test_effective_config_echo.py     # config echo matches the profile hash
test_bodysource_parity.py         # ScoutRefetch and IngestPayload produce identical downstream results
test_dispatch_sniffer.py          # declared vs sniffed strategy mismatch refuses to write
test_state_illegal_transition.py  # every illegal transition is refused
test_approval_stale.py            # approval mismatched on slice/count/index is refused
test_write_outside_run_folder.py  # monkeypatched FS writes fail outside runs/<run-id>/
test_bad_records_not_auto_quarantined.py
test_searchable_attributes_syntax.py  # one attribute per priority level
```

Do not package probe/packet-only tests unless their failure class is generalized.

## Validation Module Split

Do not create one new god-object called `validate.py`.

Required modules:

```text
validate/grounding.py
validate/quality.py
validate/payload.py
validate/live.py
validate/search.py
validate/__init__.py
```

Responsibilities:

| module | owns |
|---|---|
| `grounding.py` | source-body lookup, visible markdown projection, zero-span refusal, offset-independent grounding |
| `quality.py` | leakage, chrome, duplicate-description, self-reference, incomplete spans, judge result interpretation |
| `payload.py` | allowed fields, forbidden metadata, final artifact shape, duplicate objectIDs |
| `live.py` | paginated live browse, exact payload match, no extra enriched records |
| `search.py` | query-set evaluation and source-skew checks |
| `__init__.py` | gate registry and command composition only |

One registry defines the gates. There must be one live call path.

Tests must prove that a gate added to a helper module is reached by the CLI command.

## Blog Lessons Encoded As Rules

1. Live index can change mid-run; recensus before write/delete.
2. Historical artifacts poison validation; validate one final artifact.
3. A gate fixed in a dead path is no fix.
4. Tests must hit the live path.
5. Empty verification is a failure.
6. A fetched page can still be the wrong document.
7. A shell-only page should not be forced.
8. A page can be dead without a 404.
9. Scout `/health` can be green while jobs cannot execute.
10. Batch size controls parallelism.
11. Repair beats quarantine when source text can fix the issue.
12. Judge is quality control, not grounding.
13. Large verification must browse/paginate.
14. Search settings are separate from write completion.
15. Quarantine is a real index move.
16. Reports are evidence, not runtime dependencies.

## Codex / Claude Collaboration

Rules:

- Codex and Claude are peer reviewers, not boss/worker.
- Either may challenge the other with artifact evidence.
- No agent may proceed based only on the other's claim.
- Before continuing work started by Claude, Codex reads Claude state files if present.
- Before Claude continues Codex work, Claude reads Codex packet/handoff files.

Look for:

```text
SESSION.md
MEMORY.md
memory/*.md
.claude/plans/*
docs/70-enrichment/HANDOFF*.md
docs/70-enrichment/session/*.md
docs/70-enrichment/PACKET*.md
```

## Persist / Handoff / Clear

### Persist

Write:

```text
docs/70-enrichment/session/CURRENT.md
docs/70-enrichment/session/YYYYMMDD-HHMM-persist.md
```

Include objective, live counts, target slice, run folder, commands, writes, validation, blockers, next step, disagreements.

### Handoff

Write:

```text
docs/70-enrichment/HANDOFF-current.md
```

It must be restartable by fresh Codex or Claude.

### Clear

Codex cannot clear context from inside the assistant. Equivalent:

1. write handoff
2. start fresh Codex task
3. ask it to read handoff

## V0 Implementation Plan

### Phase 1: Create Skill Skeleton

Use `skill-creator` initializer. Create only the approved folders/files.

### Phase 2: Refactor Scripts Into CLI Package

Promote/refactor the Blog-proven scripts and gates. Do not copy residue. Do not re-open
grounding architecture unless a new source produces artifact evidence that the Blog
method cannot handle.

Required implementation order:

1. create CLI skeleton and run state/lock/artifact modules
2. implement profile YAML loading, `base.yaml`, named profiles, and fallback profiles
3. implement `profile-lint`, `corpus-status`, and read-only slice count checks
4. implement read-only `census`, `plan-slice`, and split validation modules against existing Blog artifacts
5. implement approval parser and refusal tests before any write command
6. port the Blog-proven fetch/enrich/repair path after artifact contract is stable
7. port the Blog-proven `build-final`, `validate`, `review-pack`, `dry-run-write`, `apply-write`, and `verify-live` behavior
8. keep quarantine, rollback, search-eval, and drift-check out of v0 unless Arijit reopens them

### Phase 3: Run Tests

Run package tests and validate no command can write/delete without approval token.

Minimum passing suite before Claude review:

```text
all command refusal tests pass
all grounding tests pass
canonical.py shared by selector/repair/validation/live tests pass
all artifact path tests pass
all approval-token stale/mismatch tests pass
judge model separation tests pass
profile-lint covers every live non-excluded page_type
corpus-status reconciles done/pending/human-review-needed counts for the current run
read-only Blog forward-test passes
```

### Phase 4: Forward-Test On Completed Blog State

First read-only, as historical baseline only:

- main index count `11928`
- Blog in main `2694`
- Blog enriched in main `2694`
- quarantine Blog `106` (quarantine index total `108`)
- zero quarantined IDs in main
- corpus state reports Blog closed
- profile-lint reports no unprofiled non-excluded page_types

Then run a true v0 write-path smoke test against the named `--target-index`:

```text
target = 5-10 already-validated Blog records
destination = Algolia_Prod_Copy_Enhanced_Parallel
commands = prepare-target-index -> dry-run-write -> apply-write -> verify-live
```

The smoke test must prove:

- payload contains only `objectID`, `abstract_enriched`, and `keyhighlights_enriched`
- no provenance/audit metadata lands on records
- every written value in `--target-index` is byte-identical to the final payload
- every written value grounds in the Scout body
- records outside the smoke manifest are unchanged
- rerunning `verify-live` after the write still checks non-zero records and non-zero spans

If `--target-index` is empty, seed only the smoke-test records required for verification.
Do not use the old Blog main-index write as proof of the v0 write path.

### Phase 5: Claude Reviews Actual Skill

Claude reviews actual skill files and command behavior.

### Phase 6: Rectify

Codex fixes findings and reruns tests.

### Phase 7: Case Studies Is The First Corpus Acceptance Test

The Blog run is evidence for the method but was performed with the historical scripts.
The first proof that the new skill works is a complete `Customer Stories/case-study`
slice. It is not a side activity and it is not allowed to begin before the skill passes
Phases 3–6.

```text
1. smoke          5–10 already-validated Blog records          -> Phase 4
2. skill review    Claude reviews actual code and live behavior -> Phase 5
3. rectify         Codex fixes findings and reruns all tests    -> Phase 6
4. acceptance run  Customer Stories/case-study, live count 237 -> this phase
```

The Case Studies acceptance run executes the complete skill path:

```text
census -> plan-slice -> Scout fetch -> enrich -> repair -> build-final
-> deterministic validation -> structured quality judgement -> review pack
-> dry-run-write -> approved target-index write -> verify-live
```

It must produce one terminal outcome for every planned case-study record and meet every
line of the v0 Definition of Done. Findings from this run become code/profile fixes in
the skill; they are not patched in one-off scripts.

### Phase 8: Documentation Is The Second Corpus Acceptance Test

Only after the Case Studies acceptance packet passes and any findings are fixed in the
skill:

1. run `census` for the existing 12 Documentation `page_type` values;
2. apply `Documentation__profile-map.yaml` without changing any record taxonomy;
3. run the bounded qualitative probes required by the mapped reference, guide, and nav
   profiles;
4. run the 25-record `doc-sdk` end-to-end checkpoint through the skill;
5. only then run the full Documentation profiles through the same skill and validation
   path.

Documentation is the first high-volume, non-editorial test of the ETL pipeline. It does
not get a separate pipeline or special historical scripts.

Counts 237 and 4,337 are verified live (2026-08-10) and must be re-confirmed by
`plan-slice` at run time. No corpus slice starts until Phase 4's smoke test passes against
`--target-index`. No slice is reported done until every line of the v0 Definition of Done
is true.

## Claude Review Prompt

```text
Codex and Claude revised the `algolia-corpus-enrichment` skill plan into v0 implementation scope after Arijit corrected the project boundary.

Plan file:
/Users/arijitchowdhury/Dropbox/AI-Development/algolia-com/docs/70-enrichment/PLAN-skill-algolia-corpus-enrichment.md

Please review it as an operational design.

Key scope:
- one Codex skill
- one user-facing CLI `algolia_enrich.py`
- internal Python package
- slice runner plus lightweight corpus tracker
- strict run folder
- profile-lint
- profiles as YAML with base + deltas
- approval files for writes/reruns/cleanup
- cleanup policy
- source profiles
- deterministic grounding contract
- judge as quality layer only
- write good records to the approved target index
- bad/unusable records go to human review, not automatic quarantine/delete

Context:
Blog is complete:
- main `Algolia_Prod_Copy_Enhanced`: 11,928 records
- main Blog: 2,694
- main Blog enriched: 2,694
- quarantine `Algolia_Prod_Copy_Enhanced_Quarantine`: 108 records total, 106 of them Blog

Review objectives:
1. Rate the plan.
2. Is one CLI/internal package the right operational shape?
3. Are any required runtime scripts still missing?
4. Are any residue scripts still included?
5. Are approval gates enforceable enough?
6. Is cleanup strict enough to prevent report/cache residue?
7. Is the 100% grounding contract enforceable?
8. Is quality/correctness validation strong enough?
9. Is the corpus layer sufficient to track the whole index over time?
10. Are source profiles and fallbacks specific enough to run News next?
11. Is `SKILL.md` specified strongly enough to prevent future agents running loose scripts?
12. What exact edits should Codex make before implementation?

Do not implement. Return ranked critique with concrete fixes.
```
