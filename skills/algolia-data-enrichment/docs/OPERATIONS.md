# Operations runbook

Running a real slice, and what to do when something goes wrong.

---

## Before the first slice on a new corpus

```bash
cd scripts
WS=/path/to/project

python3 algolia_enrich.py census       --workspace $WS   # what is in there
python3 algolia_enrich.py profile-lint --workspace $WS   # is every page_type covered
python3 algolia_enrich.py health-scout --workspace $WS --probe-url /some/real/page
```

`profile-lint` failing is the normal first outcome. It prints each uncovered `source/page_type`
with its record count. For each one: write a profile, or route it in
`profiles/_profile-map.yaml`, or add it to `excluded` with a reason. An exclusion is a recorded
decision; an omission is a slice that hard-refuses mid-run.

**Order slices small-blast-radius first.** A smoke of 10 before a slice of 237 before a slice of
3,411. First run of new software should not be the biggest one.

---

## Run ids

```
YYYYMMDD-source-page_type-aNN
20260810-customer-stories-case-study-a01
```

`aNN` is the attempt number. Without it a same-day rerun of the same slice collides on the run
folder and the lock. Increment it for a fresh attempt; never reuse a folder.

---

## A full slice

```bash
RUN=20260811-customer-stories-case-study-a01
SLICE=(--source "Customer Stories" --page-type case-study)

python3 algolia_enrich.py plan-slice   --workspace $WS --run-id $RUN "${SLICE[@]}"
```

Read the projection it prints before continuing. It is derived from measured queue-inclusive
elapsed time, so it is honest about wall clock. At one job at a time, 226 pages is roughly five
hours — that is a planning input, not an acceptable serial plan.

```bash
python3 algolia_enrich.py fetch        --workspace $WS --run-id $RUN "${SLICE[@]}" --concurrency 4
python3 algolia_enrich.py enrich       --workspace $WS --run-id $RUN "${SLICE[@]}" --concurrency 6
python3 algolia_enrich.py repair       --workspace $WS --run-id $RUN "${SLICE[@]}"
python3 algolia_enrich.py build-final  --workspace $WS --run-id $RUN "${SLICE[@]}"
python3 algolia_enrich.py validate     --workspace $WS --run-id $RUN "${SLICE[@]}"
python3 algolia_enrich.py review-pack  --workspace $WS --run-id $RUN "${SLICE[@]}"
```

**Keep Scout concurrency at or below 4.** The hosted plan allows 5 concurrent runs, and a sixth
call from *any* source — another tool, a verification pass, a retry storm — gets rate-limited. On
the predecessor's run that turned into 4,123 of 4,779 pages failing.

### Then stop and read

`build-final` prints the coverage line. `validate` prints the per-language census. Both are
decisions, not progress bars.

```
planned 237 | writable 198 | human-review 21 | terminal 18 | unattempted 0
coverage: writable 0.835 against target 0.85 → meets_coverage FALSE
```

Under target means the slice failed, and that is the point of having a target. Look at the
human-review queue before re-running anything.

Then read `reports/review-pack.md` — a stratified sample with the source snippets. This is the
only place the question "are these abstracts worth having" gets answered, and no gate answers it.

---

## Writing

```bash
python3 algolia_enrich.py prepare-target-index --workspace $WS --run-id $RUN
python3 algolia_enrich.py dry-run-write        --workspace $WS --run-id $RUN "${SLICE[@]}"
```

Now write the approval by hand. Take the counts from `dry-run-write`'s own output — not from
memory, not from the plan.

```bash
cat > runs/$RUN/approvals/write-approved.json <<'JSON'
{
  "approved_by": "Arijit",
  "approved_at": "2026-08-11T09:00:00Z",
  "command": "apply-write",
  "run_id": "20260811-customer-stories-case-study-a01",
  "source": "Customer Stories",
  "page_type": "case-study",
  "expected_target_count": 237,
  "expected_write_count": 198,
  "source_index": "Algolia_Prod_Copy_Enhanced",
  "target_index": "Algolia_Prod_Copy_Enhanced_Parallel"
}
JSON

python3 algolia_enrich.py apply-write --workspace $WS --run-id $RUN "${SLICE[@]}"
python3 algolia_enrich.py verify-live --workspace $WS --run-id $RUN "${SLICE[@]}"
```

`verify-live` is the only command whose output is evidence that anything happened. Everything
before it is intent.

```bash
python3 algolia_enrich.py corpus-status --workspace $WS
python3 algolia_enrich.py cleanup       --workspace $WS --run-id $RUN
python3 algolia_enrich.py handoff       --workspace $WS --run-id $RUN
```

---

## When it fails

Everything exits 2 with a typed error naming what it refused and why. The common ones:

### `LockError: .lock held`
Another command is running, or one died. Check the PID in the lock file. If it is genuinely
stale, `--recover-lock` takes it and writes a recovery note.

### `EnrichmentError: no fetch-manifest.json in ...`
`enrich` was run before `fetch`, or against the wrong run id. There is no flag for this by design:
the two are joined in code precisely because they used to be joined by a human.

### `EnrichmentError: cached body hash does not match the fetch manifest`
The body on disk is not the body that was fetched. Something edited the cache. Re-fetch into a new
attempt (`-a02`) rather than repairing the cache.

### `EnrichmentError: model pinning failed`
A tier is serving a different model than the config pins, or judge and writer resolved to the same
model. Check `GET {ALGOLIA_INFERENCE_BASE_URL}/models`, then either update
`enrichment-config.yaml` deliberately or fix the tier. Do not work around it — the pin exists
because `large` and `xlarge` are both the writer.

### `ZeroWorkError`
Something checked nothing and refused to call it a pass. Usually an empty slice, an empty cache,
or a filter that took everything. Read the count it prints; a filter that removed every candidate
is either an honest "this page is furniture" or over-filtering, and `NO_CANDIDATES_AFTER_FILTER`
is counted separately from `NO_CANDIDATES` so you can tell.

### `ApprovalError: does not authorise this operation`
It prints each mismatched field with both values. A stale approval cannot be reused on a different
slice, count or index. Write a new one.

### `StateError: illegal transition`
A command ran out of order. `state.json` shows the current tracks. Run the missing step; do not
edit the state file.

### `validate` fails on `effective-config.json`
The profile changed after the run. A gate "fixed" after a run does not apply to that run — re-run
the slice rather than re-validating it.

---

## Per-record statuses

Not every failure is an exit code. `enrich` records these per record and the run continues:

| Status | Meaning | Where it goes |
|---|---|---|
| `PASS` | writable | payloads |
| `WRITER_FREE_TEXT` | the model returned prose instead of IDs | human review, retry |
| `QUARANTINED_BY_GATE` | selection failed every attempt on the ladder | human review, retry |
| `METHOD_DISAGREEMENT` | body shape contradicts the profile's declared strategy | human review, exclude |
| `LANGUAGE_MISMATCH` | body language ≠ record language, under `must_match_record` | human review, fix source |
| `NO_ABSTRACT_THIN` / `_DEAD` | the page genuinely has nothing | terminal, counted, **not a failure** |
| `DEAD_PAGE` / `SHELL_PAGE` | not a content page | terminal, quarantine candidate |
| `REDIRECT_CANONICAL` | served a page another record owns | terminal, exclude |
| `UNATTEMPTED` | planned but no row produced | human review — counted, never dropped |

A hub page receiving no abstract is a **pass**, not a gap, and the packet counts it as one.

---

## The human-review queue

`final/human-review-queue.jsonl`, one row per unresolved record, each with a suggested action and
`review_status: OPEN`.

v0 has **no quarantine and no delete**. Whether a record leaves the corpus is a judgement about
content and it is a human's call. Fill in `reviewer_decision`:

| Decision | Next step |
|---|---|
| `retry_enrichment` | source is fine, selection failed — retry manifest for those objectIDs |
| `fix_source_then_retry` | the page is broken but fixable — wait, then re-fetch |
| `accept_no_enrichment` | terminal non-writable outcome, counted |
| `candidate_for_quarantine` | out of v0; needs a separate human-approved flow |
| `exclude_from_slice` | update the profile or exclusion rule, rebuild the final artifact |

---

## Cost and throughput

Measured, one real Scout job:

```
elapsed_ms        79942   ← includes queue wait
duration_ms       11209   ← the scrape itself
browser_launch_ms  3854
navigation_ms      6357
```

**Queue wait dominates.** The concurrency ceiling matters far more than per-page speed, and
projecting from `duration_ms` would promise roughly 7× faster than reality.

Observed on the smoke runs: ~4s/record fetch at concurrency 4, ~3-5s/record enrich at concurrency
6 including the judge. Writer and judge run on Algolia's own inference server.

`metrics.json` accumulates per command. Use the last comparable run to project the next one.

---

## Safety summary

| | |
|---|---|
| Source index | read-only, structurally. Record count asserted before and after every write |
| Target index | the only writable surface. Never a copy, rename or swap of anything |
| Fields written | exactly three. Nulls refused |
| Approvals | files, matched field by field |
| Run output | one folder per slice. Nothing loose |
| Production search | **unchanged.** v0 writes to a proving-ground index nobody queries |
