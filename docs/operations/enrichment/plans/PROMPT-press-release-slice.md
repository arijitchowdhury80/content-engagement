# Goal prompt: enrich `Website/press-release` (690) with the algolia-data-enrichment skill

Paste everything below the line as a single goal. It is self-contained — do not summarise it.

---

## Goal

Run the `Website/press-release` slice — **690 records, en 231 / de 230 / fr 229** — end to end
through the `algolia-data-enrichment` skill, and report the result with real command output.

This is the first slice run by the skill from a cold start, with no smoke test in front of it and
no code changes expected. If code changes turn out to be needed, that is the finding.

## Read first. Do not re-derive any of it.

1. `skills/algolia-data-enrichment/SKILL.md` — the contract. Use the CLI only.
2. `skills/algolia-data-enrichment/docs/OPERATIONS.md` — the runbook, including the
   failure table and what each per-record status means.
3. `skills/algolia-data-enrichment/docs/COMMANDS.md` — the 17 commands, their refusals.
4. `skills/algolia-data-enrichment/scripts/profiles/Website__press-release.yaml` — the
   profile. Read the `forbidden_patterns`; four of the five exist because of a specific defect.
5. `skills/algolia-data-enrichment/docs/DESIGN-DECISIONS.md` — read when something looks
   arbitrary. It usually is not, and the cheap-looking alternative was usually tried first.

## Already true. Do not redo, do not re-verify from scratch.

```text
skill            skills/algolia-data-enrichment/   166 tests passing
                 run every command as:
                   python3 skills/algolia-data-enrichment/scripts/algolia_enrich.py \
                     <command> --workspace <repo root> ...
source index     Algolia_Prod_Copy_Enhanced            11,928 records, READ-ONLY
target index     Algolia_Prod_Copy_Enhanced_Parallel   both enriched fields searchable
slice            Website/press-release  690   en 231, de 230, fr 229   (live census 2026-08-11)
profile          Website__press-release.yaml, complete, 19 fields, never executed
strategy         press_release + announcement_summary — NEVER RUN before this slice
Scout            https://scout.chowmes.com   key SCOUT_HOSTED_API_KEY in .env.local
inference        large -> glm-5.2 (WRITER)   small -> gemma-4-26b-a4b-nvfp4 (JUDGE)
                 asserted on the SERVED string at run start; the runner refuses on mismatch
throughput       ~4s/record fetch at concurrency 4, ~4s/record enrich at concurrency 6.
                 690 records is roughly 45 min fetch + 45 min enrich. Plan for it.
```

## Step 0 — clear the board first, and it is not optional

Two runs are parked at the approval gate. **`corpus-status` is RED until they are resolved, and
the skill's own rule is that no new slice starts on red.** Do not start step 1 while it is red.

```text
20260811-customer-stories-case-study-a03   237/237 accounted, validate PASSED, 225 payloads,
                                           write: NONE   (repair recovered 13 of 14)
20260810-blog-blog-post-a02                 50 planned,     validate PASSED, write: NONE
```

For each: run `review-pack`, read `reports/review-pack.md`, and put the decision to Arijit —
write the approval and ship it, or close the run out. **Do not write an approval file on your own
authority.** Then re-run `corpus-status` and show it green before proceeding.

If Arijit defers the decision, say so and stop. A press-release run on top of two unreconciled
slices makes every number in the corpus report meaningless.

## The three things this slice is actually testing

Report on each explicitly, with numbers. These are the reason the slice was chosen.

**1. Does `/de/` and `/fr/` press-release serve German and French, or English?**

Blog served English on both, measured at 100% of Blog and 0% of every other source. Nobody knows
what press releases do. The profile says `must_match_record` deliberately, so:

- if the localised pages serve their own language → ~690 enrichable, and the multilingual path is
  confirmed on a second, independent content shape;
- if they serve English → ~459 records take `LANGUAGE_MISMATCH` and the slice writes ~231.

**Both outcomes are a result, not a failure.** Do not change `language_policy` to make the number
larger. If the answer is "English everywhere", that is a finding about algolia.com to report to
Arijit, and the ruling is his — it was his ruling for Blog.

**2. Does the candidate-layer ban on "About Algolia" hold?**

It is the highest-scoring editorial-looking prose on a press release and would be selected as the
abstract on all 690 unless banned. Report `pool_dropped["PROFILE_FORBIDDEN"]` summed across the
slice, and confirm no stored abstract opens with it. A record-level gate here would have killed
the whole slice — the ban is at the candidate layer on purpose.

**3. Does the dateline stay out, and do quotes stay out?**

The dateline (`SAN FRANCISCO, Aug 4, 2026 —`) is perfectly grounded and a terrible lede.
Press releases are roughly half quotes and `allow_quotes: false`. Report how many candidates each
rule removed, and spot-check that no stored abstract is someone speaking.

## Run it

```text
census → profile-lint → health-scout → plan-slice → fetch → enrich → repair
       → build-final → validate → review-pack
       → dry-run-write → [Arijit approves] → apply-write → verify-live
       → corpus-status → cleanup → handoff
```

Run id: `20260811-website-press-release-a01`.

Rules that do not bend:

1. **Scout is the only body source.** No curl, no WebFetch, no fallback.
2. **`enrich` reads only this run folder's own cache.** There is no argument for anything else.
3. **Never write to `Algolia_Prod_Copy_Enhanced`.** Assert its record count is 11,928 before and
   after. It is read-only and there is no snapshot of it.
4. **Exactly three fields:** `objectID`, `abstract_enriched`, `keyhighlights_enriched`.
5. **`apply-write` needs an approval file Arijit authorises.** Not chat text, not your own note.
6. **No command prints PASS after checking zero records or zero spans.**
7. **Do not weaken a gate, a threshold or a profile to improve a number.** If a gate is wrong,
   say so with evidence and stop.

## Definition of done

| # | criterion | evidence |
|---|---|---|
| 1 | every one of the 690 planned records has exactly one terminal outcome | `final/results.jsonl` + `final/human-review-queue.jsonl` |
| 2 | 100% of written spans re-locate in their Scout body, offset-free | `validation/artifact-validation.json` |
| 3 | zero forbidden fields, zero nulls | `validation/write-dry-run.json` |
| 4 | live values on the target byte-match the approved payloads | `validation/live-verification.json` |
| 5 | a query for enriched-only text returns > 0 hits on the target | `validation/live-verification.json` |
| 6 | written count vs `coverage_target_pct` 0.85, measured against 690 | `validation/coverage.json` |
| 7 | `Algolia_Prod_Copy_Enhanced` still 11,928, settings unchanged | `validation/source-index-unchanged.json` |
| 8 | the three questions above answered with numbers | `reports/packet.md` |
| 9 | per-language census reported: candidate counts and span-length distributions across en/de/fr | `validation/artifact-validation.json` |

Coverage under 0.85 means the slice failed. That is the point of having a target — do not move it.

## Stop immediately and report, do not iterate, if any of these occur

- a write is attempted against `Algolia_Prod_Copy_Enhanced`, or its count is not 11,928
- `corpus-status` is red at step 1 and Arijit has not resolved the two parked runs
- Scout returns empty bodies on 3 consecutive jobs — the service is degraded, not the code
- the writer returns prose (`WRITER_FREE_TEXT`) on more than 5% of records — the ID contract is
  not holding on this content shape and that is a design finding, not a retry problem
- `LANGUAGE_MISMATCH` exceeds 400 records — answer question 1 and take it to Arijit before
  writing anything
- you are about to change a profile, a threshold or a gate to make a number look better

## Report format

```
STEP 0     parked runs resolved? <case-study a03: shipped/closed/deferred> <blog a02: ...>
           corpus-status: <green/red>

SLICE      690 planned | <n> written | <n> human-review | <n> terminal | <n> unattempted
COVERAGE   writable <pct> against target 0.85 — <MET / NOT MET>
GROUNDING  <n>/<n> spans located, modes {exact, canonical}

Q1 LANGUAGE   de <n> enriched / <n> mismatch | fr <n> / <n> | en <n> / <n>
              verdict: /de/ and /fr/ serve <their own language | English>
Q2 ABOUT-ALGOLIA  <n> candidates banned by PROFILE_FORBIDDEN; <n> abstracts opening with it
Q3 DATELINE+QUOTES  <n> dateline candidates banned, <n> speech candidates banned

PER-LANGUAGE  lang | records | cand p50 | abstract spans | abstract chars p50 | highlights p50
LIVE       <n> byte-match of <n>, <n> enriched-only queries returning hits
SOURCE     Algolia_Prod_Copy_Enhanced: <count> records, settings <unchanged/CHANGED>
COST       <wall clock>, <s/record fetch>, <s/record enrich>

what I could not do : <explicit, or "nothing">
```

Report failures as failures. A partial pass is a number, never a completion word.
