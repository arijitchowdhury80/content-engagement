# Corpus lifecycle

## Status

`corpus-status` reconciles three independent sources: the live source index, the live target
index, and the run manifests. A number only one of them knows is a claim, not a status. It writes
`docs/70-enrichment/CORPUS-STATE.json` and `CORPUS-STATUS.md`, and it **fails** — not warns — on
an unprofiled live page_type or a slice whose artifact count disagrees with the live count.

No future slice starts while it is red.

## Coverage

Every profile declares `coverage_target_pct`, `max_human_review_open_pct`,
`allowed_terminal_verdicts` and `minimum_review_sample`.

**The denominator is the original `plan-slice` count.** If it were the survivors, a run that
loses half its records would report 100%.

```
outcome_coverage_pct   = outcomes / planned_target_count
writable_coverage_pct  = written  / planned_target_count
human_review_open_pct  = open     / planned_target_count   must be <= max_human_review_open_pct
```

Every planned record has exactly one terminal outcome: written, repaired-then-written, or a row
in `final/human-review-queue.jsonl`. A record that produced no row at all is written into the
queue as `UNATTEMPTED` — counted, never dropped.

Human review is an OUTCOME, not an enriched record. A hub page receiving no abstract is a PASS,
not a gap, and the packet must count it as one.

## Bad records

v0 has no quarantine and no delete. A bad record becomes a queue row with a suggested action —
`retry_enrichment`, `fix_source_then_retry`, `accept_no_enrichment`, `candidate_for_quarantine`,
`exclude_from_slice` — and `review_status: OPEN`. Whether a record leaves the corpus is a
judgement about content, and that is Arijit's call.

Re-entry: `retry_enrichment` rows re-enter at `repair` or `enrich` with an explicit retry
manifest, pass the same gates, and `build-final` gives retry output precedence over the previous
failed output — but only when the retry actually improved the outcome. A failed repair must not
overwrite a base row that passed.

## v0 → v1

v0 ends with enriched records in a parallel index nobody queries. **v0 succeeds when the method
is proven, not when value is delivered**, and the packet must say so.

v1 is a **field-level merge** of the two enriched fields into the production index, keyed on
objectID, plus a separate approval to add them to production `searchableAttributes`, plus a
no-regression proof against a pre-registered query set. It is never an index copy, never a
rename, never a swap: replacing the production index would delete every record and the entire
8-axis taxonomy.
