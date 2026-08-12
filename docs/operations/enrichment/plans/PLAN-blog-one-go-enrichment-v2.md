# Blog One-Go Enrichment Plan — v2

Date: 2026-08-09
Supersedes: `PLAN-blog-one-go-enrichment.md` (Codex v1)
Review that produced this: `REVIEW-claude-blog-one-go-plan-20260809.md`

v1's phase structure and write-safety posture are kept. v2 corrects the ground truth, adds four
gates the blog corpus needs, names a human authoriser per phase, and adds the searchability phase
without which the whole run has zero effect on search.

## Goal

Every `source == "Blog"` record in `Algolia_Prod_Copy_Enhanced` reaches a verified outcome:
either a grounded `abstract_enriched` (+ optional `keyhighlights_enriched`), or a counted honest
verdict (`DEAD`, `THIN`, `LANGUAGE_MISMATCH`, `FETCH_FAILED`).

No `enrichment_*` metadata on Algolia records. Verdicts stay in external artifacts.

## Ground Truth — measured 2026-08-09, all re-derivable

| fact | value | how |
|---|---|---|
| Live index total | **12,035** | `filters=""`, `hitsPerPage=0` |
| Live blog records | 2,800 | `filters="source:Blog"` |
| Blog in `work-queue.jsonl` | 2,800, all `page_type=blog-post`, `family=editorial` | queue census |
| Blog by language | 936 en / 932 de / 932 fr | queue census |
| Blog with ≥1 **ok** Scout cache copy | **2,504** | best-of resolution across `cache-scout/**` |
| Blog with only **error** copies | **296** | all `Hosted API rate limit exceeded` |
| Blog objectIDs with **both** ok and error copies | **2,139** | ⚠ see Gate B4 |
| Cached-ok blog bodies that are dead `# Page not found` stubs | **95** (en 34 / de 31 / fr 30) | body-text match |
| …of those returning HTTP **404** | 34 | `http_status` |
| …of those returning HTTP **301** onto a dead page | **61** | ⚠ see Gate B2 |
| Blog bodies returning HTTP 301 in total | 1,655, of which **~1,600 are alive** | ⚠ status is NOT a liveness signal |
| **Genuinely alive** cached blog bodies | **2,409** | after removing the 95 stubs |
| Alive body length p10 / median / p90 | **8,620 / 13,386 / 21,900** chars | none under 1,200 |
| Non-English blog pages serving **English** bodies | **all of them** | see "The de/fr finding" below |
| Blog rows enriched so far (local artifacts) | 91 rows: 72 PASS, 13 JUDGE_REVISE, 6 quarantined | `batches-out-scout/*/results.jsonl` |
| Measured enrichment speed | **~21 s/record**, serial within a batch | 8 completed batches |
| Scout hosted concurrency cap | **5** | `fetch_router.py:184` |

**`abstract_enriched` and `keyhighlights_enriched` are NOT in `searchableAttributes`.** Live
setting today: `['title','unordered(abstract)','unordered(description)','unordered(tags)',
'unordered(keywords)','unordered(category)','unordered(url)']`.

### The de/fr finding, and why it is not a defect to gate on

`https://www.algolia.com/de/blog/product/dynamic-facets` returns `<html lang="de">` and serves the
**English article**. Probed live 2026-08-09 with and without `Accept-Language: de-DE,de;q=0.9`:
224,657 vs 224,729 bytes, identical body text. This is an algolia.com fact, not a Scout artifact,
and there is no German or French version to fetch.

An earlier pass of this review reported "31 de pages returned German bodies". **That was wrong** —
all 31 are 205-char `# Page not found` stubs that a function-word detector misread as German
because a 404 stub contains almost no English function words. Real non-English blog bodies: **zero**.

**Ruling (Arijit, 2026-08-09): enrich all 2,800.** The de/fr records receive the English abstract,
because English is what the page serves. An English abstract is a true description of an English
page; a German one would be the lie. Translation is not an option and is not wanted — the writer
selects sentence **indices** from the page and cannot generate text, which is the zero-invention
guarantee. The language split is **counted and reported**, never silently absorbed.

### Correction to an earlier gate proposal in this plan

An earlier draft proposed `http_status != 200 → DEAD`. **That gate is wrong and must not be built.**
1,655 blog bodies return 301 and ~1,600 of them are alive; the rule would have destroyed them.
Dead-page detection is **content-based** — the `# Page not found` stub — not status-based.

## Non-Negotiables

Codex's seven stand. Four added:

8. **Liveness is decided by body content, never by HTTP status.** A `# Page not found` stub →
   `DEAD`, whatever the status says. A 301 is not evidence of anything.
9. **`language_observed != language_code` is recorded and counted on every row**, and reported in
   the final packet. It does not block a write (see the de/fr ruling) but it is never invisible.
10. **Every count is compared to the 2,800 queue, never to the manifest that produced it.**
11. **Every phase transition names a human authoriser.** Absent from v1; its absence is what let
    Phase 2 start on a red gate on 2026-08-08.

## Decisions — ANSWERED by Arijit, 2026-08-09

| # | question | ruling |
|---|---|---|
| D1 | The de/fr records whose pages serve English | **Enrich all 2,800.** English abstract on de/fr records, counted and reported. Not a language gate. |
| D2 | The 86 blog records already enriched and span-verified live | **Skip them.** Preserve verified work; `partialUpdateObjectNoCreate` would overwrite silently. |
| D3 | Phase 6 searchability settings change | **Yes, after Phase 5 verifies.** Confirm `Algolia_Prod_Copy_Vanilla` is untouched before the change. |

## Target arithmetic

```
2,800  blog records in queue and in the live index
  -86  already enriched and span-verified  (D2: skip)
2,714  to process this run
         of which ~95 resolve to DEAD  (dead-page stub, no abstract possible)
         of which ~296 need a Scout re-fetch first
      => ~2,619 expected to reach the writer, on bodies with a 13,386-char median
```

"Blogs complete" means all 2,714 have an outcome: an abstract, or a counted `DEAD` / `THIN` /
`FETCH_FAILED`. It does **not** mean 2,714 abstracts.

---

## Phase 0 — Stop competing writers and Scout consumers

Owner: Claude · Authoriser: none needed (read/stop only)

- Stop `fetch_router.py` pid on `batches-legacy-fix` — it holds Scout slots (5 total).
- Stop any `enrich_ready.py --watch`.
- `verify_written.py --artifacts batches-out-scout` may finish; it is read-only.
- Print the process table and assert no two writers share a `batches-out-*` path.

**Gate:** no duplicate writer target paths; ≥4 free Scout slots.

## Phase 0.5 — Code changes (NEW; v1 assumed these existed)

Owner: Claude · Authoriser: Arijit signs off the diff before Phase 2

Four changes, each with a test:

1. `make_batches.py`: add `--only-source` / `--only-page-type`. `--only scout/editorial` yields
   4,363 records, not 2,800 — v1's Phase 1 as written enriches 1,563 non-blog records.
2. `enrich_run.py`: hard `DEAD` verdict on a **dead-page body**, detected by content:
   markdown begins `# Page not found`, or body length < 1,200 chars.
   **NOT by `http_status`** — 1,655 blog bodies are 301 and ~1,600 of them are alive.
   Expected to fire on 95 blog records (34 with status 404, 61 with status 301).
   Regression test must assert an alive 301 body survives the gate.
3. `enrich_run.py`: record `language_mismatch = (language_observed != language_code)` on every
   row. **Counted and reported, not blocking** — per the D1 ruling. Final packet must print the
   count and the per-language split.
4. `enrich_run.py`: refuse to run on a manifest whose non-error row count is 0. The current
   silent `fetch_error` drop at line 1056 lets a mis-pointed batch emit 0 rows and exit clean.
5. `write_enrichment.py`: skip objectIDs already carrying a verified `abstract_enriched`
   (the 86, per D2). Print the skip list; a silent skip and a silent overwrite fail the same way.

**Gate:** `pytest` green (223 currently pass, 1 xfail), plus one 25-record proof run showing each
new verdict firing at least once — printed from the run's own output, not from the source.
The proof batch must contain **at least one alive-301 body and one dead-301 body** so change 2 is
shown discriminating, not merely running.
*(A gate fix has landed in an unused code path in this project before.)*

## Phase 1 — Blog-only workspace with a canonical manifest

Owner: Claude · Authoriser: Arijit (D1/D2 answered)

- **Merge step first:** one canonical blog manifest, one row per objectID, ok copy wins,
  newest ok wins on tie. Write `reports/blog-manifest-provenance.json` recording which cache file
  each objectID resolved to. This is the fix for the 2,139 dual-copy records.
- Batches of 25 into `batches-blog-scout/`, outputs to `batches-out-blog-scout/`,
  cache in `cache-scout/blog/`, reports as `reports/blog-*`.

**Gate:** manifest rows == **2,800** (queue count, not manifest count); every row
`source == Blog` and `page_type == blog-post`; 112 manifests; zero objectID appears twice.

## Phase 2 — Repair the 296 Scout failures

Owner: Claude · Authoriser: Arijit

- Scout only. No fallback fetch. Retry only the 296.
- **Measure before committing:** 25 records at 3 workers, record wall time and failure rate.
  Scale to 5 only if failure rate does not climb. Scout throughput collapsed from 50 rec/450 s to
  12 rec/3,482 s with crashes during the corpus run — treat 5 as a ceiling, not a target.
- Rate-limit failures are retried, never counted as final.

**Gate:** `ok + honest_fetch_failed == 2,800`. Fetch failures listed by objectID with their error.

## Phase 3 — Parallel enrichment

Owner: Claude · Authoriser: Arijit

- `run_batches.py --workers N` is the parallelism. 4 is the highest observed stable; start at 6,
  cap at 8, drop on any `curl exit -9`, Gemini 429, duplicate objectID, or malformed JSON.
- No Algolia writes.
- Failed batch → quarantine that output dir, rerun that batch alone.
- **Budget note:** ~21 s/record measured. 2,714 records = 15.8 worker-hours = **1h59m at 8 workers,
  2h38m at 6**. The one-hour target is not reachable at any safe worker count. Say so up front
  rather than discovering it at minute 60.

**Gate, per batch:** rows == distinct objectIDs; no duplicates; JSON parses;
**and** the union of all batch rows == 2,714 (the 2,800 queue minus the 86 skipped).

## Phase 4 — Verification

Owner: Codex · Authoriser: Arijit

- Aggregate every blog result row.
- **Grounding against the live page**, via `verify_written.py` re-fetch — not against the cache.
  A cache-locate is a tautology for an index-picking writer.
- Leakage check: no nav / boilerplate / "Page not found" / code-comment text in writable rows.
  The 95 dead-page records are the specific thing this must catch if Phase 0.5 change 2 leaked.
- Scope: every row `source == Blog`, `page_type == blog-post`.
- **Language report:** print writable rows by `(language_code, language_observed)`. Expect
  roughly two thirds `de/en` and `fr/en`. This is the D1 ruling working as intended, and it is
  stated in the packet so nobody later reads it as a defect that slipped through.
- Payload: only `objectID`, `abstract_enriched`, `keyhighlights_enriched`.
- **State explicitly that `JUDGE_REVISE` is written** (`write_enrichment.py:49`). 15% of blog
  writables are `JUDGE_REVISE`; `GOAL-for-claude-short.md` requires policy and reports to match.
- **Hand-sample 30 multi-span abstracts** for join-implicature — two true sentences joined can
  assert something neither asserts, and no automated check covers it. Report the number checked
  and the number bad. Do not claim coverage.

**Gate:** zero grounding failures; zero duplicate IDs; zero non-blog rows;
**zero dead-page-sourced rows**; none of the 86 skipped IDs present in the payload;
writer dry-run passes. Language mismatch is **reported, not gated** (D1).

## Phase 5 — Live write

Owner: Codex · Authoriser: **Arijit, explicit yes, this phase only**

- Fresh snapshot first — there is no snapshot of the pre-dedupe index and none will exist for this.
- `write_enrichment.py --results batches-out-blog-scout/* --apply --yes`
- Writer re-reads the live index and compares field by field.
- Independent live census after.

**Gate:** live exact-match count == payload count; **live index total remains 12,035** (v1 said
12,036 — that gate fails a correct run); live blog enriched count == expected union.

## Phase 6 — Make it searchable (NEW; absent from v1)

Owner: Claude · Authoriser: **Arijit, explicit yes — settings change on a shared live index**

Without this, 2,800 enrichments change **zero search results** and Definition-of-Done item 4 is
unmet.

- Add `abstract_enriched` to `searchableAttributes` in an approved position.
  Decide `keyhighlights_enriched` separately.
- `Algolia_Prod_Copy_Vanilla` is untouched; a colleague's `www Chat` / `Algolia_*` agents query
  that index, not this one — but confirm before the change, do not assume.
- Prove it: one live query whose top result changes because of enriched text. Record the query,
  the before, and the after.

**Gate:** live settings read back showing the attribute; one live query result pasted into the
final report.

---

## Realistic timing

| step | time |
|---|---|
| Phase 0 + 0.5 (code + tests + 25-record proof) | 30–45 min |
| Phase 1 merge + manifests | 5 min |
| Phase 2 Scout repair of 296 | 20–50 min, Scout-dependent |
| Phase 3 enrichment, 2,714 @ 8 workers | 1h 59m |
| Phase 4 verification | 20 min |
| Phase 5 write | 10 min |
| Phase 6 settings + proof | 10 min |
| **Total** | **~3h 30m** |

Phases 0–2 (~1h) are the only part that can start before Arijit is back at the keyboard; Phase 3
onward each need their named yes.

## On the multi-agent ask

The bottleneck is 2,714 serial writer+judge round-trips at ~21 s. Parallelism is
`run_batches.py --workers N`, already implemented as concurrent subprocesses. Claude subagents do
not shorten that path. Two are worth spawning:

- **T1 `haiku` monitor** — tail logs for `curl exit -9`, 429, zero-row batches, duplicate IDs.
- **T2 `sonnet` validator** — read each batch validation pack as it lands, flag anomalies.

Everything else is `--workers`.
