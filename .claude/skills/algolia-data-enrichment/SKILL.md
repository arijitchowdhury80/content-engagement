---
name: algolia-corpus-enrichment
description: Use when enriching Algolia index records with grounded `abstract_enriched` and `keyhighlights_enriched`, validating corpus slices, writing approved enrichment to a parallel Algolia index, creating human-review queues for bad records, or planning/continuing Algolia corpus enrichment work. Always use the bundled CLI; never run loose historical scripts.
---

# Algolia corpus enrichment

Enrich records with `abstract_enriched` and `keyhighlights_enriched`, write them to the approved
target index, and prove with deterministic validation that every written string is grounded in
the Scout-fetched page body.

## Use the CLI only

```bash
python3 scripts/algolia_enrich.py <command> --workspace <repo root> --run-id <id> ...
```

Do not run loose scripts from `docs/70-enrichment/*.py` (the historical scripts). Measured by walking the import graph on
2026-08-10: 25 of those 40 files do not belong in this pipeline at all, and two of the ones that
do — `enrich_run.py` and `span_gate.py` — contain gate code paths the runner never reached. A
gate was "fixed" in one of them twice, with every unit test green and the pipeline unchanged.
Their logic is split into this package; `run_gates()` is deliberately not carried.

## Required read order

1. Read `CORPUS-STATE.json` if it exists.
2. Read the current run's `state.json` and `manifest.json` if continuing a run.
3. Run `corpus-status` before planning a new slice. **No slice starts on red.**
4. Read only the reference file needed for the current command (see the table at the end).

## The grounding invariant

**The LLM selects IDs. Final strings are sliced from the Scout-fetched page by the script.**

The writer sees a numbered menu the script built from the page and returns integers. It emits no
content, so an invented word has no route to the output — fabrication is not detected, it is
unrepresentable. A writer that returns prose is a hard failure (`WRITER_FREE_TEXT`), never
something to parse around.

Repair extends a span over the page's own following words. It never adds punctuation, a
connector or a bridging word. Adding a full stop the page does not have is writing text.

## The command sequence

```
census → profile-lint → health-scout → plan-slice → fetch → enrich → repair
       → build-final → validate → review-pack
       → prepare-target-index → dry-run-write → apply-write → verify-live
       → corpus-status → cleanup → handoff
```

`repair` is optional; every other step is ordered and the state machine enforces it.
`prepare-target-index` can run at any point before `dry-run-write`.

## Forbidden actions

- do not glob historical reports as truth
- do not write outside `runs/<run-id>/`
- do not approve your own writes
- do not run write commands without approval files
- do not use non-Scout page-body fetches — no curl, no WebFetch, no `.md` twin, no fallback
- do not force enrichment for shell, dead or login pages
- do not store provenance metadata on records
- **never write to the source index**, and never copy, rename, swap or merge an index

Exactly three fields may be written: `objectID`, `abstract_enriched`, `keyhighlights_enriched`.

## Unknown `source/page_type`

Hard refuse. Create or update the profile; never fall back silently. A silent fallback runs the
wrong strategy on the page and every gate still passes, because the spans are perfectly grounded
— they are just the wrong shape for the page.

## Approvals

Approval is a file, parsed and matched — never chat text and never memory.

| command | file in `runs/<run-id>/approvals/` |
|---|---|
| `prepare-target-index`, when creating the target | `target-index-approved.json` |
| `apply-write` | `write-approved.json` |
| rerunning over an accepted final artifact | `rerun-approved.json` |
| deleting accepted evidence | `cleanup-approved.json` |

Every field is compared: command, run id, source, page type, both index names, and both counts.
The failure this prevents is not a forged approval, it is a stale one — yesterday's file
silently authorising today's much larger write.

## Things that will bite you

- **Zero work is a failure.** No command prints PASS after checking zero records or zero spans.
  A verifier on this project once filtered on a non-faceted attribute, matched nothing, and
  reported success.
- **A status code is not evidence about a document.** 2 of 237 case studies return HTTP 200 while
  serving a different page. Served-URL identity is asserted, never the status.
- **A page can be dead without a 404, and alive with a 301.** Liveness is decided by the body.
- **`min_body_chars` is per profile.** A terse API reference page is short and correct; Blog's
  floor would quarantine thousands of them.
- **The de/fr-serves-English ruling is Blog-only.** It was measured at 100% of Blog and 0% of
  every other source. Every other profile uses `must_match_record`.
- **65% of the case-study slice is de/fr and that path is new.** Compare candidate counts and
  span-length distributions across languages; a systematic skew is a defect, not a curiosity.
- **Coverage is measured against the original `plan-slice` count**, never against what survived.
- **Reading settings back does not prove searchability.** `"unordered(a),unordered(b)"` is stored
  as one garbage attribute and reads back perfectly. Only a query that returns hits is evidence.
- **Grounding is a guarantee; selection quality is a judgement.** A passing gate is not a good
  abstract.

## v0 scope, stated plainly

v0 writes to a parallel proving-ground index that nothing queries. **It changes zero production
search results.** Say that in the packet. Getting enrichment into production is v1, needs its own
plan and its own approval, and is a field-level merge — never an index copy.

Out of v0: quarantine, delete, rollback, search-eval, drift-check, and any change to production
`searchableAttributes`.

## When to load a reference

| file | read it when |
|---|---|
| `references/validation-gates.md` | validating, or changing a gate |
| `references/source-profiles.md` | adding or changing profile behaviour |
| `references/artifact-contract.md` | handling run files, cleanup, or residue |
| `references/blog-lessons.md` | debugging a failure class seen in the Blog run |
| `references/corpus-lifecycle.md` | checking status, coverage, or re-entry |
