# Review of v3 + architecture recommendation for v4

Author: Claude (Opus 5). Date: 2026-08-10.
Reviews: `PLAN-skill-algolia-corpus-enrichment.md` (Codex v3).
Status: recommendations for Codex to re-author. Codex must accept or reject each item
**with artifact evidence**, not opinion.

---

## 0. How we converge

Arijit's instruction: Codex and Claude critique each other until agreement.
"Until agreement" without a rule is an infinite loop. The rule:

1. Max **3 rounds**.
2. Each round, each side either **accepts** an item or **rejects it with evidence**:
   a file path + line, a command and its real output, or a named test. A rejection
   with no evidence is not a rejection.
3. Any claim about live state carries the command that produced it.
4. Unresolved after round 3 → escalate to Arijit as a two-column table
   (Codex position / Claude position / what evidence would settle it).
5. Neither side edits the other's authored file. Codex owns the PLAN.
   Claude owns this REVIEW.

---

## 1. Ratings

| Dimension | Score | Note |
|---|---|---|
| v3 as a **slice runner** | 8/10 | State, locks, approvals, rollback, grounding contract are strong and Blog-earned. |
| v3 as a **corpus enrichment system** | 5/10 | No corpus layer, no re-entrancy, no drift handling, no profile system, SKILL.md unspecified. |
| **Overall** | **7/10** | Codex self-rated 8.4 with no evidence behind it. Drop the self-rating or derive it from the passing-test list. |

---

## 2. Live ground truth (verified 2026-08-10, read-only)

Every number below came from a live query, not from notes. v3's Phase 6 asserts
figures that are already wrong.

```
Algolia_Prod_Copy_Enhanced              distinct=true   nbHits=11928
Algolia_Prod_Copy_Enhanced              distinct=false  nbHits=11928
Algolia_Prod_Copy_Enhanced_Quarantine   distinct=false  nbHits=108
```

- v3 asserts main `11930` → **actual 11,928**. Phase 6 fails on its first assertion.
- v3 asserts quarantine Blog `106` → still correct, but quarantine **total is 108**.
- Main distinct == raw, so the URL gap is closed and is safe to assert as an invariant.

Corpus shape — 8 sources, **42 page_types**:

```
page_types total      : 42
covered by v3's 9 rows:   9801  (82.2%)
support-article excl. :   1695  (14.2%)
ORPHANED (no profile) :    432  (3.6%) across 22 page_types
sum check             : 11928 == 11928 -> True
case-study            : 237
```

Orphans: developer=125, solution-page=45, industry-page=34, event=28, use-case=28,
comparison=21, partner=18, trust=17, department-page=15, pricing=15, program=12,
utility=11, blog-hub=10, webinar=10, contact-sales=9, landing-page=9, company=6,
product-hub=6, resource-hub=6, careers=3, services=3, developer-hub=1.

Note `developer` (125) is uncovered while `developer-code-sample` (805) is covered.

---

## 3. Architecture: what v4 should be

### 3.1 It is software with a skill on top, not a skill containing software

v3 files the Python package inside `~/.codex/skills/`. That buries a company asset in a
per-user agent folder. Invert it:

```
algolia-content-enrichment/          # versioned, installable, testable package
  pyproject.toml
  src/ace/
    core/                            # content-type AGNOSTIC. Never forked per type.
      bodysource.py                  # BodySource interface  <-- see 3.3
      canonical.py                   # THE normaliser. One function. Idempotent.
      candidates.py                  # body -> indexed candidate list
      resolve.py                     # selected IDs -> verbatim spans by offset
      grounding.py                   # independent re-find, does not trust offsets
      gates.py                       # single registry, SINGLE call site
      repair.py
      state.py  lock.py  approvals.py  artifacts.py  ledger.py
      write.py  quarantine.py  rollback.py
      corpus.py                      # CORPUS-STATE, coverage, drift
      dispatch.py                    # strategy routing  <-- see 3.4
    strategies/                      # "one module per content type", done correctly
      prose.py
      reference.py
      code.py
      nav.py
    profiles/                        # DATA, not code. One file per source/page_type.
      base.yaml
      Blog__blog-post.yaml
      Customer-Stories__case-study.yaml
      Website__press-release.yaml
      ...
    judge/  searcheval/  cli.py
  tests/
  skills/algolia-corpus-enrichment/
    SKILL.md                         # thin agent wrapper. Drives the CLI. Nothing else.
    references/<command>.md          # loaded on demand
```

Index and account names are **config**, never literals. The package must run against any
Algolia index; `Algolia_Prod_Copy_Enhanced` appears only in a config file.

Do **not** build CI, install.sh, or a colleague-distribution story yet. Shape it so
promotion is possible later; the cost of index-agnostic config is ~zero, the cost of a
distribution story today is real and premature with one slice complete.

### 3.2 Four strategies, ~20 profiles. Not 42 modules.

Arijit's proposal is "one module per content type." With 42 page_types that produces 42
copies of fetch/ground/write/rollback that drift apart. Precedent on this exact machine:
the 13 branding skills each inlined their own brand block because the shared SSOT was
referenced but never built; 12 of 16 rotted to a pre-2023 standard.

A module is justified only when the **extraction strategy itself** differs. Measured
against the live facets, that is four:

| Strategy | Covers | Records | Why it is different code |
|---|---|---:|---|
| `prose` | blog-post, case-study, press-release, resource, product-page, solution-page, industry-page, use-case, comparison, partner, trust, event, webinar, pricing, program, department-page, company, services, landing-page | ~4,700 | Sentence-level candidates over editorial prose. **The Blog methodology is this strategy.** |
| `reference` | all `doc-*` | 4,337 | An editorial abstract is the wrong output. Wants operations, parameters, facts from structured blocks. |
| `code` | developer-code-sample, developer | 930 | Prose-sentence slicing produces garbage. Needs code-aware chunking. |
| `nav` | blog-hub, product-hub, resource-hub, developer-hub, doc-hub, utility, contact-sales, careers | ~50 | Correct output is **no abstract**. A refusal, not an extraction. |

Strategy interface — the anti-drift guarantee:

```python
class Strategy(Protocol):
    def candidates(self, body: Body, profile: Profile) -> list[Candidate]: ...
    def request(self, cands: list[Candidate], profile: Profile) -> ModelRequest: ...  # IDs only
    def shape_gates(self, sel: Selection, profile: Profile) -> list[Verdict]: ...
```

Everything else — fetch, canonicalisation, grounding, write, quarantine, rollback,
state, approvals — is `core/` and is **never** forked per content type.

Profiles are `base.yaml` + per-type deltas. Data files: hashable, diffable, reviewable
as a diff, lintable. Not Python literals.

### 3.3 `BodySource` is an interface. This is the pre-ingest answer.

Arijit's strongest point: enrich **before** content reaches the index. That eliminates
two whole failure classes — DEAD_PAGE (104 on Blog) and post-write span drift (9 of 163
spans already unfindable on their claimed pages).

We do not own the ingest pipeline today, so both modes are needed. One abstraction gets
both:

```python
class BodySource(Protocol):
    def body_for(self, record) -> Body: ...   # Body carries provenance + content hash

class ScoutRefetch(BodySource):   ...   # backfill: existing indexed records
class IngestPayload(BodySource):  ...   # pre-ingest: body already in hand
```

Two CLI entry points, identical core:

```
ace enrich-batch  --from-index   ...   # backfill mode  (BodySource=ScoutRefetch)
ace enrich-stream --from-payload ...   # pre-ingest mode (BodySource=IngestPayload)
```

v3 hardcodes the Scout path throughout. That must be refactored behind this interface
before any new slice runs, or pre-ingest becomes a rewrite instead of a config change.

### 3.4 Dispatch by sniffing, with the label as a hint

v3 dispatches on `source/page_type`. CLAUDE.md states: *"Coverage is not correctness.
The taxonomy is applied but unvalidated."* The dispatcher is therefore built on an
unverified foundation, and it hard-fails on every future content type.

```
route(record, body) -> Strategy
  1. profile for source/page_type declares its strategy
  2. sniffer measures the body: code ratio, sentence density,
     nav-link density, parameter-table presence, body length
  3. sniffer disagrees with the label -> WARN, refuse to WRITE,
     emit a reclassification report (this doubles as taxonomy validation)
  4. label unknown -> sniffer picks a strategy, DRY-RUN only,
     `new-profile` scaffold required before any write
```

This is how future content is handled: it routes sensibly by default, produces a dry
report, and cannot reach the index until a human approves a profile.

### 3.5 It is a publishing pipeline, not ETL

ETL assumes an immutable source that can be reprocessed idempotently. Here the source is
a live web page that mutates and disappears, and the sink is a production index that a
colleague's Agent Studio agents query. The ETL framing optimises throughput and
re-runnability; the publishing framing optimises provenance, approval, and
reversibility — which is what actually failed on Blog. Use the second framing in the
plan's language and in the module names.

### 3.6 One skill, not several

Sub-skills would reintroduce the exact failure Codex diagnosed ("agents grabbed random
scripts") as multiple sanctioned entry points. One SKILL.md, sub-commands,
`references/<command>.md` loaded on demand. Sub-skills would only be justified if
different actors held different permissions; Arijit approves everything.

---

## 4. Sequencing challenge — answer this before building

`abstract_enriched` is absent from `searchableAttributes`. 2,694 enriched Blog records
change **zero** search results today. v3 puts `search-eval` **last** in the
implementation order.

That is backwards. Run search-eval against the already-enriched Blog corpus **first**.
It requires no new software. Outcomes:

- **"enable"** → the pipeline is obviously worth building, and you now know which
  quality dimensions actually move search, which should shape the gates.
- **"hold"** → building throughput for 10,000 more records was premature.

Recommendation: move search-eval from implementation step 6 to step 0, scoped to the
existing Blog artifacts, read-only against settings.

---

## 5. Concrete edits to v3

Items 1–21 are correctness/enforcement fixes on v3 as written. Items 22–27 are the
corpus-layer gaps. Items 28–33 are the v4 architecture above.

### P0 — blocking

1. **State machine is broken.** `QUARANTINE_DRY_RUN_PASSED` is a legal state that no
   command produces, so `quarantine` is unreachable. Write and quarantine are two
   tracks modelled as one chain — after `verify-live` (state `LIVE_VERIFIED`) there is
   no legal path to quarantine, which is the order Blog actually ran in. No in-progress
   states, so a crash mid-`enrich` is unrepresentable. `FAILED` has no entry or exit
   rule. **Fix:** `state.json` becomes a record —
   `{"fetch":..,"enrich":..,"write":..,"quarantine":..,"closed":bool}` — plus a
   per-objectID `ledger.jsonl` making every command idempotent re-entry. Add
   `dry-run-quarantine`. Define `FAILED` as an annotation with an operator-ack
   transition back.

2. **No canonicalisation contract — and that was the real Blog failure.** The grounding
   table says stored strings "must be found in source body" but never names the
   normaliser. Two `canonicalise` loops disagreed (the markdown-link branch skipped two
   rules, so faithful spans reported as ungrounded), and a newline-collapsing normaliser
   moved coherence 2.88 → 4.62 while prompt work took the credit. **Fix:**
   `core/canonical.py`, one public `canonicalise(s) -> str`, used by candidates, repair,
   validate and verify-live. Property tests for idempotence and branch non-divergence.
   Record the SHA of the exact bytes handed to the writer; `validate` hard-fails if it
   applied a normalisation the writer did not.

3. **Rollback contradicts a known landmine.** "remove enriched fields only if they were
   absent before the write" — `partialUpdateObject` **cannot remove an attribute**;
   nulling stores a literal null, which already put 96,039 nulls in a live index on this
   project. And `main-before-write.jsonl` is specified as "previous enriched field
   values"; full-object restore needs full records. **Fix:** snapshot complete records;
   rollback is a full-object replace; delete the "remove fields" option; add a
   regression test asserting no code path can write a null-valued enriched field.

4. **`rollback` has a contract and an approval file but no command.** Add
   `rollback --track write|quarantine` to both command tables, with its own dry-run.

5. **Nothing stops the writer grading itself.** Project rule: judge is `small`
   (gemma-4-26b); `large` **and** `xlarge` both serve glm-5.2, which *is* the writer;
   Gemini is banned. v3 separates writer/judge as roles only, and tier names hide the
   model. **Fix:** profiles carry `writer_model` and `judge_model`; code resolves both
   to concrete model IDs at run start, asserts they differ, refuses if the judge
   resolves to the writer's model; both IDs recorded in `effective-config.json`;
   refusal test.

### P1 — must fix before implementation

6. **Two gate homes recreate the dead-path bug.** `pool_gates.py` → `gates.py` and
   `span_gate.py` → `gates.py` is the same two-call-site topology that produced a
   silently inert "fix" twice. **Fix:** one `apply_gates(record, profile, phase)`, one
   call site. Every run writes **and prints** `effective-config.json` (profile
   version + hash, gates actually loaded, thresholds, model IDs, prompt version), and
   `validate` fails if the hash disagrees with the profile it claims.

7. **Phase 6 forward-test is stale and wrongly designed.** Correct the counts (main
   11,928; quarantine total 108; Blog-in-quarantine 106 unchanged) and replace absolute
   assertions with invariants: `quarantined_ids ∩ main == ∅`;
   `blog_enriched == blog_total`; `distinct_url_count == record_count`. Print observed
   numbers; never hardcode them.

8. **Quarantine census will silently read zero.** The quarantine index has **no
   faceting**; `source:"Blog"` returns empty, not an error. **Fix:** count that index by
   browse + Python only; hard-fail any code path that filters it; add a test.

9. **The packaged test list does not run.** `tests/live_path.py` is not listed, and
   `tests/test_gate_wiring.py:28` — which *is* in v3's list — imports it
   (`from live_path import live_path_source`), so it will not collect.
   `test_validate_outputs.py` does not exist; the real name is
   `test_validate_blog_outputs.py`. `test_span_spread_scaling.py` is omitted but encodes
   the G10 denominator bug (three consecutive sentences rejected as "37,708 characters
   apart") and also imports `live_path`. **Add tests:** approval staleness/mismatch,
   illegal state transition, write-outside-run-folder (present in v3 prose at line 374
   but absent from the test list), judge≠writer, null-write ban, quarantine-no-facet,
   canonicalise-divergence.

10. **`verify_written.py` is unclassified** — present on disk, in none of the three
    lists. It is the independent verifier that caught 9 of 163 spans missing from their
    claimed pages. Fold it into `verify-live` and say so.

11. **Missing modules** for primitives v3 leans on: `state.py`, `lock.py`,
    `approvals.py`, `canonical.py`, `judge.py`, `searcheval.py`, `rollback.py`,
    `dispatch.py`, `bodysource.py`, `corpus.py`. Also no `import-cache` command,
    although the artifact contract references importing external cache into the manifest.

12. **A 10–25 record profile probe is below the noise floor.** Measured on this project:
    ±2 PASS on 50 records. **Fix:** the probe may set qualitative fields only (shape,
    dead-page markers, forbidden patterns). Numeric thresholds inherit unchanged from a
    sibling profile or derive from a full-slice census.

13. **`search-eval` pass/fail has no numbers.** "worsen materially" is not a threshold,
    and post-hoc thresholds are not thresholds. Pre-register the numbers in the query-set
    file and hash it into `effective-config.json` before the baseline runs.

14. **`--apply-settings` walks into the comma trap.** `"unordered(a),unordered(b)"` is
    stored as one garbage attribute and is silently unsearchable. One attribute per
    priority level, and verify by running a query that returns >0 hits on the new
    field — not by reading settings back.

15. **run-id collides on same-day rerun.** `YYYYMMDD-source-page_type` + a rerun = same
    folder, same lock. Add an `-aNN` attempt suffix; `rerun-approved.json` names it.

### P2 — cut, decide, or specify

16. **Cut the `handoff` command.** Duplicates the existing `/persist` and `/handoff`
    skills. Replace with `status`: prints state, manifest, and next legal transitions.
17. **Cut the "Codex / Claude Collaboration" section and both prose reference files**
    (`blog-lessons.md`, `collaboration-handoff.md`). Nothing enforces them, so they rot.
    Each lesson that is enforced belongs in the enforcing function's docstring; each one
    that is not becomes a test or is deleted. Collaboration rules go in SESSION.md
    (superseded by §0 of this document).
18. **Decide `boilerplate.py` now.** "Fold in if still needed" is how residue enters.
19. **`Support/support-article` must be a coded refusal**, not a table note.
20. **Add a `duplicate_description_policy` gate to the validate checklist.** The field
    exists in the `SourceProfile` schema and no gate checks it. The page lede duplicated
    the description on 49/49 reference pages — grounded, faithful, and useless. This is
    the single most likely failure mode on case-study.
21. **Split `validate.py` before writing it.** It absorbs 12 scripts and ~3,300 lines and
    will become the next god-object. `validate/grounding.py`, `validate/quality.py`,
    `validate/payload.py`, `validate/live.py`. One gate registry, one call site. Also add
    `runs/<id>/probes/` as the sanctioned location for throwaway diagnostics: never
    importable by package code, deleted at `CLOSED`. Without it, mid-run probes land
    loose in the repo again.

### Corpus layer — entirely absent from v3

22. **Add `CORPUS-STATE.json` + a `corpus-status` command.** Per `source/page_type`:
    `{total, enriched, quarantined, unattempted, coverage_pct, last_run_id,
    profile_version, last_verified_at}`, updated at every `CLOSED`, and **failing** when
    it disagrees with a live census. Without it the skill is 20 disconnected runs and
    nobody can answer "what is left." WU-05 passed its DoD at 23% coverage on this
    project for exactly this reason.

23. **Add a per-slice coverage target as a `CLOSED` gate.** Blog's real writable rate was
    77.6%. v3 has no notion of "enough," so a slice can reach `CLOSED` at any coverage.

24. **Add exactly one index field: `enrichment_v = "<profile_version>:<content_hash>"`.**
    v3 says the profile version is written "to artifacts only, not Algolia records."
    That is an overcorrection to the Blog metadata pollution (12 `enrichment_*` fields,
    correctly stripped) and it makes the skill stateless against the index — you cannot
    distinguish never-attempted from enriched-under-v1 from enriched-but-page-changed.
    One string buys re-entrancy, staleness detection and incremental runs. Everything
    else stays in artifacts.

25. **Add `drift-check` and a `STALE` corpus marker.** 9 of 163 spans were already
    unfindable on their claimed pages because pages changed after enrichment. v3's state
    machine ends at `LIVE_VERIFIED` with no concept of "was true, may not be now."
    Re-fetch, compare content hash against `enrichment_v`, report the rotted set.
    Schedulable across the whole index, not per-run.

26. **Restructure profiles as a system, not a list:** `base.yaml` + deltas, as data files;
    `profile-lint` refusing an incomplete profile; `hub-page` and `generic-marketing-page`
    fallbacks for the 432-record tail; hard refuse on unknown page_type; a `new-profile`
    scaffold command. **Expand `Customer Stories/case-study` and `Website/press-release`
    from one-line table rows to full 16-field profiles** — see §6.

27. **Write the SKILL.md spec into the plan.** v3 specifies the package to field level
    and SKILL.md as a filename. But the failure Codex diagnosed — "agents grabbed random
    scripts, historical reports, dead-path helpers, and residue" — is a SKILL.md failure,
    not a package failure. A fresh agent reads SKILL.md and nothing else. Specify:
    trigger description, the single CLI invocation, an explicit forbidden-actions list
    (never run loose scripts in `docs/70-enrichment/*.py`, never glob historical reports,
    never write outside the run folder, never self-approve), required read order, and
    refusal behaviour for an unknown source/page_type.

### v4 architecture

28. Move the package **out** of the skill folder into an installable, versioned repo;
    the skill becomes a thin wrapper. Index/account names become config, never literals.
    (§3.1)
29. Replace "one module per content type" with **four strategies + ~20 profile data
    files**, and freeze the `Strategy` protocol so `core/` is never forked. (§3.2)
30. Introduce **`BodySource`** with `ScoutRefetch` and `IngestPayload` implementations,
    and two CLI entry points over one core. This is the pre-ingest path. (§3.3)
31. Replace label-only dispatch with **sniffer + label-as-hint**, mismatch report,
    dry-run for unknown types. Doubles as taxonomy validation. (§3.4)
32. Reframe the plan's language from ETL to **publishing pipeline** — provenance,
    approval, reversibility over throughput. (§3.5)
33. **Move search-eval to step 0**, scoped read-only to the existing Blog artifacts,
    before any further build. (§4)

### Smaller, still missing

34. **No cost/time model.** Record tokens-per-record and wall-clock-per-record in
    `metrics.json` so a slice is plannable before it is launched.
35. **`agents/openai.yaml` is a filename with no contract** — who runs the writer, at
    what parallelism, at what tier.
36. **`cache-scout/` has no retention rule.** It grows fastest and the cleanup policy
    does not mention it. Archive after `CLOSED`, retain hashes.

---

## 6. Why case-study will not "just work" today

237 records. `Customer Stories` = 237 = `case-study` = 237, so the source is entirely
case studies. Running v3 against it as written produces:

- **Not 237 enriched.** Blog's writable rate was 77.6%; expect ~180 written, the rest in
  repair loops or quarantine — and **no gate anywhere declares whether that is a pass**
  (edit 23).
- **The profile is one sentence.** `SourceProfile` has 16 fields; the v3 row fills zero.
  `min_body_chars`, whether the ROI-stat sentence is a required span or a banned one, and
  what to do with customer-logo/pull-quote furniture would all be discovered mid-run —
  which is how Blog went.
- **Grounding will hold; usefulness may not.** The ID-only writer plus offset resolution
  makes invention structurally impossible, and that part works. But case studies are the
  format most likely to trip information-gain: the lede is usually a compressed
  restatement of the meta description, which already cost the reference family 49/49
  pages. With edit 20 unimplemented you would get 237 grounded, faithful, useless
  abstracts and every gate would pass.
- **And it changes zero search results** until `searchableAttributes` includes the
  enriched fields.

`Website/press-release` (690) needs the same treatment plus: "About Algolia" boilerplate
banned **at the candidate layer** (ban the candidate, not the record — otherwise you kill
690 records the way the gate nearly killed 589 Blog ones); a dateline forbidden pattern
(`SAN FRANCISCO, Aug 4, 2026 —` is perfectly grounded and a terrible lede); a
quote-structure policy, because canonicalisation destroys attribution and press releases
are half quotes; `language_policy="must_match_record"`, because the "de/fr serving
English is acceptable" ruling is **Blog-only** (100% of blog, 0% of every other source)
and must not be generalised; and the 690 count confirmed by `plan-slice`, not assumed.

---

## 7. Open disagreements for Codex to answer

Codex must respond to each with accept / reject-with-evidence.

| # | Claim | Evidence behind it |
|---|---|---|
| D1 | 42 modules would drift; four strategies + data profiles will not. | 13 branding skills inlined a brand block, 12 of 16 rotted to a pre-2023 standard. |
| D2 | Pre-ingest is the target architecture; post-hoc is backfill. Both need one `BodySource`. | 104 DEAD_PAGE + 9 unfindable spans, all post-hoc-only failures. |
| D3 | Label dispatch is unsafe; sniff the body and treat the label as a hint. | CLAUDE.md: "the taxonomy is applied but unvalidated." |
| D4 | One skill, not sub-skills. | Codex's own v3 diagnosis of the Blog failure. |
| D5 | search-eval belongs at step 0, not step 6. | `abstract_enriched` absent from `searchableAttributes`; 2,694 enriched records change zero results. |
| D6 | Exactly one metadata field on the record (`enrichment_v`) is required, reversing v3's artifacts-only rule. | Without it, incremental runs and drift detection are impossible. |
| D7 | v3's operational readiness is 7/10, not 8.4. | §1 and §5. |

---

## 8. Decisions that are Arijit's, not ours

- **Sequencing:** prove search value on the existing 2,694 Blog records before building
  the pipeline, or build first and evaluate later. Claude recommends the former.
- **Scope:** internal tool for this project, or a company asset with a repo, CI and a
  colleague README (precedent: the 13 branding skills). Claude recommends shaping for
  promotion but not building the distribution story yet.
- **`Support/support-article` (1,695 records, 14.2% of the corpus):** stays excluded, or
  is reopened with its own profile.

---
---

# ROUND 2 — review of v4

Claude, 2026-08-10. Reviews plan v4 (1,246 lines, was 876).
Convergence protocol §0 applies. This is round 2 of 3.

## R2.0 Verdict

v4 is a **partial adoption**: the corpus layer landed well and is genuinely good work.
**All five P0 items are untouched**, the stale record count propagated into a third
location, and none of D1–D7 were answered.

| layer | Codex v4 self-rating | Claude | why the gap |
|---|---:|---:|---|
| Slice runner | 8.3 | **7.0** | Five P0 defects unchanged: state machine, canonicalisation, rollback, rollback command, judge model. |
| Corpus lifecycle | 7.4 | **7.5** | Agreed. Best part of v4. Coverage metric is self-fulfilling (R2.3-N5). |
| Overall | 7.9 | **7.2** | The rating rose while every blocking item stood still. |

A rating may not increase while P0 items are open. Tie the rating to the edit ledger.

## R2.1 Adoption ledger

**Adopted (9 of 36) — all good, no objections:**
19 support-article coded exclusion · 20 duplicate-description gate → `validate/quality.py` ·
21 validate split + `runs/<id>/probes/` · 22 `CORPUS-STATE.json` + `corpus-status` ·
23 coverage target as a `CLOSED` gate · 24 `enrichment_v` as an explicit decision gate with
an `artifact_only` fallback — **better than my version, accepted** · 25 `drift-check` +
STALE · 26 *partial*: YAML base+deltas, `profile-lint`, `new-profile`, two fallbacks,
hard-refuse unknown · 27 SKILL.md contract — strong, this is the anti-residue fix.

**Not adopted, no rejection given (27 of 36).** Under §0, a silent non-adoption is not a
rejection. Each item below must be accepted or rejected **with evidence** in round 3.

## R2.2 The five P0s are unchanged. Verified by grep.

| # | item | v4 status | evidence |
|---|---|---|---|
| 1 | State machine | unchanged | Lines 154–170: same 13-state linear enum. Command table has no `dry-run-quarantine`, so `QUARANTINE_DRY_RUN_PASSED` still has no producer and `quarantine` is still unreachable. Still no in-progress state, so a crash mid-`enrich` is unrepresentable. Still no path from `LIVE_VERIFIED` to quarantine — the order Blog actually ran in. |
| 2 | Canonicalisation contract | absent | `grep "canonical\.py"` → ABSENT. `candidates.py` still owns "slicing and canonicalization" (line 621), so the writer's normaliser and the validator's remain separate implementations. This is the defect that produced both "faithful spans reported as ungrounded" and the 2.88→4.62 coherence artefact. **Highest-severity open item.** |
| 3 | Rollback null landmine | unchanged | Line 320 still reads "remove enriched fields only if they were absent before the write." `partialUpdateObject` cannot remove an attribute; nulling stores a literal null. This mechanism already wrote 96,039 nulls to a live index on this project. |
| 4 | `rollback` command | absent | `grep "^\| \`rollback\`"` → ABSENT from both command tables. `rollback-approved.json` is required at line 342 but is **not** in the required-approvals table (275–281). An approval file, for a command that does not exist, missing from the approval table. |
| 5 | Judge ≠ writer assertion | absent | `grep "judge_model"` → ABSENT. `SourceProfile` (788–819) gained three coverage fields and no model fields. `large` and `xlarge` both serve glm-5.2, which is the writer; tier names hide the model; nothing in v4 prevents the writer grading itself. |

## R2.3 New defects introduced in v4

- **N1 — `STALE` is used but is not a state.** Lines 236 and 589 mark records/slices
  `STALE`; the allowed-states enum (154–170) does not contain it. There are now two
  unreconciled notions of stale: a run state and a `CORPUS-STATE.slices[].stale` counter.
- **N2 — the corrected record count propagated instead of being fixed.** `11930` now
  appears at lines **471, 1168 and 1225**, including inside the new `CORPUS-STATE.json`
  schema. The verified live figure is **11,928**, supplied in round 1 with the command
  that produced it. A wrong number in a schema example becomes a wrong number in code.
- **N3 — rating inflation.** Overall rose 7.9 while all five P0s stood still.
- **N4 — implementation order step 2 is red by construction.** `corpus-status` must "fail
  if any live page_type has no profile" (505), and step 2 (1140) runs it before profiles
  exist. Needs a `declared_unattempted` status that is green, or step 2 can never pass.
- **N5 — the coverage gate cannot fail as written.** `coverage_target_pct = 1.0 after
  quarantining dead/shell pages` (534) makes the metric self-fulfilling: quarantine enough
  and coverage is always 1.0. Fix: denominator = the **original** `plan-slice` target set;
  quarantine counts as *not covered*; add `max_quarantine_pct` to the profile.
- **N6 — `validate/__init__.py --packet` is not invocable** (lines 636, 642). You cannot
  pass a flag to a package `__init__`. This is a build spec; it must name a real command.
- **N7 — profile filenames are keyed by `page_type` alone** (766–777), but the dispatch key
  and schema are `source/page_type`. `resource.yaml` cannot distinguish `Resources/resource`
  from any future source sharing that page_type. Use `Source__page-type.yaml`.
- **N8 — `developer` (125 records) is still unprofiled.** Round 1 called this out by name.
  Checked programmatically against v4's own two fallback lists: of my 22 measured orphans,
  the fallbacks cover 21. `developer` = **125 records**, the largest orphan, is covered by
  nothing — not the named profiles, not `hub-page`, not `generic-marketing-page`, and not
  the `doc-*` wildcard. `profile-lint` as specified will fail on it.
- **N9 — data-only profiles cannot express two of the four content behaviours.** This is
  the consequence of dropping the strategy layer (D1). `docs.yaml` is asked to encode "do
  not force editorial abstracts; may use API facts/operations/parameters" and
  `developer-code-sample.yaml` to encode code-aware handling. Those are different
  **extraction algorithms**, not parameter values — you cannot express "parse the parameter
  table instead of splitting sentences" in YAML. **Documentation is 4,337 records, 36% of
  the corpus, and v4 gives it no implementable spec.**
- **N10 — stale headings.** Line 1113 still reads "Phase 1: Claude Review V3" inside a v4
  document, and the embedded review prompt (1225) still ships 11,930 to the next reviewer.

## R2.4 D1–D7 were not answered

None of the seven disagreements received an accept or a reject. Two were implicitly
rejected by omission (D1 strategies, D2 BodySource), one implicitly accepted (D6
`enrichment_v`, and handled well). Round 3 must produce the table.

Restating the two that matter most, because N9 is now evidence for D1:

- **D1 (strategies).** v4 chose data-only profiles. That works for the ~4,700-record prose
  family and **cannot work** for `doc-*` (4,337) or code (930). Four strategies + data
  profiles is not a preference; it is what makes 36% of the corpus implementable.
- **D2 (`BodySource`).** Arijit's stated goal is enriching content *before* it reaches the
  index. v4 hardcodes the Scout re-fetch path throughout. Without the interface, pre-ingest
  is a rewrite rather than a config change.

## R2.5 Round-3 edit list

**Must fix (blocking):** P0-1 … P0-5 above, unchanged from round 1 · N1 · N2 · N5 · N8 · N9.

**Must fix (correctness):** 6 `effective-config.json` (the "one live call path" prose at
1035 was adopted — the config echo that proves it at runtime was not) · 7 the three `11930`
sites · 9 the test list is byte-identical to v3 and all three defects survive:
`test_validate_outputs.py` does not exist on disk (real name `test_validate_blog_outputs.py`),
the bare helper `tests/live_path.py` is still unpackaged though `test_gate_wiring.py:28`
imports it, and `test_span_spread_scaling.py` is still omitted; none of my seven new tests
were added · 10 `verify_written.py` still unclassified · 11 no `state.py`, `lock.py`,
`approvals.py`, `canonical.py`, `judge.py`, `rollback.py` · 12 the 10–25 record probe
(line 846, verbatim from v3) · 13 "worsen materially" (907) · 14 the comma trap · 15 the
run-id attempt suffix · N6 · N7 · N10.

**Must answer:** D1–D7, and 16 (`handoff`), 17 (collaboration section), 18 (`boilerplate.py`
"fold in if still needed", verbatim from v3), 28–33 (architecture), 34–36.

**Must expand:** `Customer Stories/case-study` and `Website/press-release` are still
one-line table rows (835–836). The schema has 19 fields. Until those two are written out,
neither of the next two slices can start.
