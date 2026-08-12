# Blog Phase 3 — enrichment complete. Packet for Codex.

Date: 2026-08-09
Author: Claude (Opus)
Predecessor: `PACKET-blog-phase0-2-20260809.md`
Machine-generated gates: `reports/blog-verification-packet.md` (regenerate with `verify_blog_packet.py`)

**Nothing has been written to `Algolia_Prod_Copy_Enhanced`.** All 2,715 rows are local artifacts.
The approval gate is the live write, and it has not been approached.

---

## Result

```
blog records in queue                 2800
  skipped, already verified             85   (array-format, left untouched)
  expected rows                       2715
  rows produced                       2715   distinct 2715, duplicates 0, missing 0
```

| status | n | |
|---|---|---|
| `PASS` | 1828 | writable |
| `JUDGE_REVISE` | 237 | writable (`write_enrichment.py:49`) |
| `QUARANTINED_BY_GATE` | 544 | held back by a script gate |
| `DEAD_PAGE` | 104 | deleted article, no model call made |
| `NO_ABSTRACT_THIN` | 2 | model declined, honestly |

**Writable: 2,065 — 79.1% of the 2,611 records that reached the writer.** The 60% Phase 1 bar is
cleared with margin, and the rate was stable from the first 100 rows (77.4%) to the last
(79.1%), so it is not an artifact of where the run stopped.

`DEAD_PAGE` came out at **104**, exactly the 95 predicted from the cached corpus plus the 9 found
in the Phase 2 refetch. The prediction was made before the run and matched.

Wall clock **86 minutes**. Writer cost **$0.00** (Algolia inference server, glm-5.2).

## Automated gates — all pass

| gate | result | |
|---|---|---|
| A Coverage | **PASS** | 2,715/2,715, 0 duplicates, 0 missing, 0 unexpected — measured against the 2,800 queue, not the manifest |
| B Scope | **PASS** | 0 non-`blog-post` rows |
| D Dead-page leakage | **PASS** | 0 writable rows sourced from a not-found stub |
| E Payload shape | **PASS** | 0 writable rows missing `abstract_spans_stored` |
| G Grounding | **PASS** | **16,671 spans checked, 16,671 located, 0 not found** |

### What Gate G proves, and what it does not

It proves the model invented nothing: every stored span is byte-present in the page text it was
selecting from. It does **not** prove the live page still says it — the cached body could be stale.
That is a re-fetch question, `verify_written.py --artifacts` answers it, and **no live-grounding
claim is made in this packet.** A cache-locate is close to a tautology for a writer that returns
indices into that same cache; the guarantee that matters is structural (the model returns integers,
never text), and Gate G confirms nothing corrupted it between selection and storage.

## Language — the expected two-thirds

| record | body | writable rows |
|---|---|---|
| `fr` | `en` | 696 |
| `de` | `en` | 686 |
| `en` | `en` | 683 |

**1,382 of 2,065 (66.9%)** writable rows carry an English abstract on a `de` or `fr` record.
Predicted at ~66.6% before the run; measured 66.9%. This is the D1 ruling working, not a leak.
`/de/blog/…` and `/fr/blog/…` serve the English article — probed live, byte-identical with and
without `Accept-Language: de-DE,de;q=0.9`.

---

## NEW DEFECT FOUND — spans with no terminal punctuation, 3.1%

Not caught by any gate, found by reading output.

**64 of 2,065 writable rows (3.1%)** contain at least one span that does not end in terminal
punctuation. Joined into an abstract, they read as run-ons. A real example,
`/de/blog/ecommerce/benefits-of-data-driven-decision-making…`:

```
span 2: "...most of them (84%) believe it's imperative to be able to do real-time course correcting"
span 3: "Algolia, for example, is a search provider that offers near real-time analytics..."
```

Joined: `…real-time course correcting Algolia, for example, is a search provider…` — which reads as
a single broken sentence and implies a relationship neither span makes. This is precisely the
join-implicature class Gate H flags as uncovered, now with a measured rate.

Two sub-classes in the 64:

1. **Colon lead-ins** — spans ending `:` (`"several additional benefits:"`, `"some notable
   changes:"`) whose list never follows. An incomplete thought presented as a fact.
2. **Mid-sentence cuts** — the span 2 case above.

**Proposed fix**, cheap and mechanical: reject a candidate span that does not end in
`. ! ? " ” )`, and reject any ending in `:`. Expected cost is 64 rows moving from writable to
quarantined — 3.1%, taking writable from 79.1% to ~76%. Still far above the 60% bar.

**Recommendation: fix and re-run the affected batches before the live write, not after.** These are
local artifacts and re-running 64 records is minutes. Once written, they are in the index.

## Quarantine reasons — the 544

| n | reason |
|---|---|
| 72 | abstract span 1 names no subject |
| 43 | self-reference `in this article` |
| 15 | chrome phrase `cookie` |
| 13 | self-reference `in this post` |
| 13 | G10 highlight span from excluded section `Next steps` |
| 7 | chrome phrase `newsletter` |
| 7 | G10 abstract span from excluded section `Next steps` |
| 6 | G10 abstract span followed by a reversal |

These look like the gates doing their job rather than misfiring. Worth Codex's eye on the top
bucket — "names no subject" at 72 is the largest single cause and may be over-strict on editorial
prose, where a lede legitimately opens with a pronoun.

## Output shape

```
spans per abstract   2: 662   3: 1331   4: 72        (editorial family expects 2-4)
abstract chars       p10 284  median 413  p90 583
highlights/record    4: 284   5: 791   6: 802   7: 135
```

## A reporting defect worth fixing

`batches-out-blog/run-summary.json` reads `batches 82, ok 29, failed 53`. All 53 "failures" are
`LOCKED_ELSEWHERE` — the per-output-directory lock correctly refusing to double-run a batch another
process had already taken. **Cooperation is being counted and printed as failure.** Coverage
(2,715/2,715) is what proves the work was done; the summary alone would have read as a catastrophe.
`LOCKED_ELSEWHERE` should be its own bucket, not folded into `failed`.

## Throughput — measured, since the plan's estimate was wrong

| workers | rows/min | note |
|---|---|---|
| 6 | 13.0 | linear |
| 9 | 20.0 | linear |
| 21 | 27.3 | linear |
| 33 | ~34 | **sub-linear — knee** |

Scaling was linear to ~21 workers and flattened by 33. Local load average was 4.86, so the limit is
the writer/judge round-trip, not the machine. **Zero 429s and zero malformed JSON across all 2,715
records**, so this is latency flattening rather than throttling. For the remaining sources, ~21
workers is the efficient point; 33 buys little.

The v2 plan estimated 2h02m at 8 workers. Actual was 86 minutes at 6→33. The per-record figure
(~27s, two sequential LLM calls) was right; the plan simply under-provisioned workers.

---

## What Codex is asked to decide

1. **The 3.1% punctuation defect** — fix and re-run 64 records before the write, or accept?
   My recommendation is fix first.
2. **"Abstract span 1 names no subject"**, 72 records — is that gate too strict for editorial?
3. **Live re-fetch verification.** Gate G verified against the cache. A full live re-fetch of 2,065
   records is ~2,065 Scout jobs; Scout just recovered from PID exhaustion. Full pass, or a sampled
   staleness check with the sample size stated?
4. **The one legacy record** `fr_c24c5190-…` was re-enriched into array format as planned; confirm
   that overwrite is acceptable.
5. Anything in gates A/B/D/E/G that is self-referential.

## Still open from the Phase 0–2 packet

- The 1,200-char dead-page floor is global, placed on blog data only.
- `abstract_enriched` is **still absent from `searchableAttributes`** — until Phase 6, writing 2,065
  enrichments changes zero search results.

## Files

| path | what |
|---|---|
| `batches-out-blog/*/results.jsonl` | 2,419 rows |
| `batches-out-blog-r2/*/results.jsonl` | 296 rows |
| `reports/blog-verification-packet.md` | machine-generated gates + 30-row join sample |
| `verify_blog_packet.py` | new — the Phase 4 gate script |
| `build_blog_manifest.py` | manifest + batch splitter |
| `reports/blog-skip-ids.json` | 85 not touched |
