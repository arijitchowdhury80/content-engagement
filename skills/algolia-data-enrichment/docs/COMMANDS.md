# Command reference

```bash
python3 scripts/algolia_enrich.py <command> --workspace <path> [--run-id <id>] [args]
```

Every command: acquires the run lock, records what it produced in `artifact-manifest.json`,
writes only under `runs/<run-id>/`, and **exits non-zero on any invariant failure**. No command
prints PASS after checking zero records or zero spans.

## Global arguments

| Argument | Required | Notes |
|---|---|---|
| `--workspace` | always | project root; `.env.local` is read from here |
| `--run-id` | all but the four read-only commands | `YYYYMMDD-source-page_type-aNN` |
| `--source-index` | no | defaults from `enrichment-config.yaml`. Read-only, always |
| `--target-index` | no | defaults from config. The only index anything writes to |
| `--source` / `--page-type` | slice commands | together they select the profile |
| `--limit` | `plan-slice` | bound the slice; the manifest records that it is a subset |
| `--languages` | `plan-slice` | stratified subset, e.g. `de:4,fr:4,en:2` |
| `--concurrency` | `fetch`/`enrich`/`repair` | defaults 4 (Scout) / 6 (model) |
| `--recover-lock` | any | takes a stale lock and writes a recovery note |
| `--allow-empty` / `--allow-empty-index` | `plan-slice` / `census` | make an empty result explicit rather than silent |

---

## Read-only

### `census`
Browse the source index, count every `source/page_type`, reconcile the scan against the index's
own record count. Writes `census-before.json` when a run id is given.

Refuses: a zero-record index without `--allow-empty-index`; a scan that does not reconcile with
the reported count.

### `profile-lint`
Resolve every profile, then check the profile set against a **live** census. An uncovered
page_type is a failure, an explicitly excluded one is a pass.

Refuses: any live page_type with no profile and no exclusion; an unknown strategy; a strategy no
module implements; a missing required field.

> Linting against the files instead of the index is how you ship a profile set that covers 40 of
> 44 page_types and find out mid-run.

### `health-scout`
Run a **real** fetch job and require a non-empty body.

Refuses: empty markdown; a timeout; `/health` as evidence.

> Scout has reported healthy for three hours while unable to start a worker thread. It accepted
> jobs and returned nothing, which looks exactly like a rate limit.

### `corpus-status`
Reconcile three independent sources — live source index, live target index, run manifests — and
write `CORPUS-STATE.json` + `CORPUS-STATUS.md`.

Refuses: an unprofiled live page_type; a slice whose artifact count disagrees with the live count.
**No future slice starts while this is red.**

---

## Planning

### `plan-slice`
Freeze the exact objectIDs for one slice, with a runtime projection from measured concurrency.

State: → `PLANNED`. Writes `manifest.json`.

Refuses: a count that disagrees with the live census; duplicate objectIDs; an empty target set
without `--allow-empty`.

```bash
# full slice
plan-slice --source "Customer Stories" --page-type case-study

# stratified smoke — the language split is recorded in the manifest
plan-slice --source "Customer Stories" --page-type case-study --limit 10 --languages de:4,fr:4,en:2
```

> The projection uses queue-inclusive elapsed time, not scrape duration. On the measured job the
> scrape was 11.2s inside 79.9s elapsed — projecting from the scrape would promise 7× faster than
> reality.

---

## The pipeline

### `fetch`
Scout only. Stores each body in the run's own `cache-scout/` and seals it with a manifest.

State: `fetch → DONE | PARTIAL`.

Refuses: any non-Scout body; zero bodies fetched.

### `enrich`
Split → filter → pool gates → writer → resolve → repair → selection gates → judge.

State: requires `fetch DONE|PARTIAL`; sets `enrich`.

Refuses: a cache this run's `fetch` did not produce; a body whose hash no longer matches; a judge
serving the same model as the writer; a tier whose served model is not the pinned one.

Per-record refusals appear as a status rather than an exit code — `WRITER_FREE_TEXT`,
`METHOD_DISAGREEMENT`, `LANGUAGE_MISMATCH`, `QUARANTINED_BY_GATE`, `NO_CANDIDATES_AFTER_FILTER`.

### `repair`
Re-runs the same live path over rows a gate refused, with failing candidates banned.

Refuses: zero repairable rows without `--allow-empty`.

> Repair means selecting **more page text**. It never means writing text. A repaired span is one
> contiguous slice of the page. Adding a full stop the page does not have would read perfectly and
> would be a fabrication.

### `build-final`
Merge base and repair outputs with **explicit precedence**, reconcile against the manifest, split
into writable / human-review / terminal, and compute coverage.

State: → `final BUILT`. Writes `final/results.jsonl`, `final/payloads.jsonl`,
`final/human-review-queue.jsonl`, `validation/coverage.json`.

Refuses: duplicate objectIDs; an objectID the manifest never planned; any planned record with no
terminal outcome.

> A repair only wins if it improved the outcome. A failed repair must not overwrite a base row
> that passed.

### `validate`
Grounding, quality, payload shape, per-language census, method agreement.

State: requires `final BUILT`; sets `validate PASSED|FAILED`.

Refuses: zero spans checked; a string not found in its source body; leakage/chrome/incomplete
spans; a method-disagreement rate over the profile threshold; **an `effective-config.json` that
disagrees with the profile it claims**; canonicalisation rules that changed since the run.

### `review-pack`
Deterministic stratified sample: writable passes, repaired records, human-review rows, every
language mismatch.

Refuses: a pack that omits repaired records; zero rows to sample.

---

## Write path

### `prepare-target-index`
Create or verify the target by copying source **settings only**. No records are copied. Adds both
enriched fields to the target's `searchableAttributes`, one attribute per priority level.

Refuses: target == source; creating without `target-index-approved.json`; settings that do not
match after the copy; a comma-joined attribute.

> `"unordered(a),unordered(b)"` is stored by Algolia as **one garbage attribute**, is silently
> unsearchable, and reads back perfectly. Which is why `verify-live` proves searchability with a
> query instead.

### `dry-run-write`
Build the intended payload and assert its shape without sending anything.

State: requires `validate PASSED`; sets `write DRY_RUN_PASSED`.

Refuses: target not ready; a field outside the three allowed; a null field; an objectID outside
the manifest; source-index drift since the census.

### `apply-write`
Write to the target index. **Requires `approvals/write-approved.json`.**

State: requires `write DRY_RUN_PASSED`; sets `write APPLIED`.

Refuses: missing approval; an approval whose command / run id / source / page_type / index names /
counts do not match this run; target == source; a source index that changed during the write.

The write count compared against the approval is the one **this run built**, not the one the
approval claims — comparing the approval to itself would be a tautology.

### `verify-live`
Read the target back and compare every value to the approved payload, byte for byte. Then prove
the enrichment is reachable.

State: requires `write APPLIED`; sets `write LIVE_VERIFIED`.

Refuses: zero records or zero spans compared; any mismatch or missing record; pipeline metadata on
a live record; a record in the target that **no run** planned; a probe query returning zero hits;
a changed source index.

---

## Housekeeping

### `cleanup`
Move `tmp/`, `logs/`, `probes/` to `archive/`. Never deletes accepted evidence by default.

Refuses: `--delete` without `cleanup-approved.json`.

### `handoff`
Write a restartable `HANDOFF-current.md` naming current state and the next command.

Refuses: no planned run; no named next step.

---

## Approval files

Approval is data, parsed and matched — never chat text, never memory.

```json
{
  "approved_by": "Arijit",
  "approved_at": "2026-08-10T20:00:00Z",
  "command": "apply-write",
  "run_id": "20260810-blog-blog-post-a01",
  "source": "Blog",
  "page_type": "blog-post",
  "expected_target_count": 10,
  "expected_write_count": 10,
  "source_index": "Algolia_Prod_Copy_Enhanced",
  "target_index": "Algolia_Prod_Copy_Enhanced_Parallel"
}
```

Every field is compared. The failure this prevents is not a forged approval — it is a **stale**
one: yesterday's file sitting in the run folder, silently authorising today's much larger write.

| Command | File |
|---|---|
| `prepare-target-index` (creating) | `target-index-approved.json` |
| `apply-write` | `write-approved.json` |
| rerun over an accepted final artifact | `rerun-approved.json` |
| `cleanup --delete` | `cleanup-approved.json` |

---

## Exit codes

| Code | Meaning |
|---|---|
| 0 | the command did its work and every invariant held |
| 2 | a typed failure — approval, state, lock, profile, zero-work, or any invariant |

There is no exit code for "mostly worked". A partial result is reported as a number in the
artifacts, never as a completion word.
