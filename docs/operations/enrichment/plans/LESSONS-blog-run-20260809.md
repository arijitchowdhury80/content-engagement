# What the blog run taught us — carry-forward for the other 7 sources

Date: 2026-08-09
Source of every claim below: the blog run itself. Nothing here is a hypothesis.

Remaining sources: Documentation 4,337 · Support 1,695 (excluded) · Website 1,123 ·
Developers 865 · Resources 835 · Customer Stories 237 · Academy 142 (login-required).

---

## L1. The de/fr English-body finding is BLOG-ONLY. Do not carry it forward.

Measured across every non-English record with a body, all sources:

| source | non-EN records | body actually English |
|---|---|---|
| **Blog** | 1,798 | **1,798 (100%)** |
| Website | 660 | 1 (0%) |
| Resources | 538 | 0 (0%) |
| Customer Stories | 42 | 0 (0%) |
| Developers | 3 | 0 (0%) |

**Blog is the only source that serves the English article at `/de/` and `/fr/`.** Every other
source is properly translated.

So the D1 ruling — "language mismatch is counted, not gated" — is **correct for blog and wrong
for everything else.** On Website or Resources, a `language_observed != language_code` row would
be a genuine defect: a German page that came back English means we fetched the wrong document.

**Action:** keep `language_mismatch` as a counter, and add a per-source policy. For every source
after blog, run the 5-minute language census FIRST and let the number decide whether it gates.
Default to gating; blog is the exception, not the rule.

This is the sharpest instance of a rule this project keeps relearning: *a claim is only true of
what it measured.* One more run and it would have been "the corpus serves English on /de/".

## L2. The 1,200-char dead-page floor is calibrated on blog and will be wrong for Documentation.

Blog bodies: p10 **8,620**, median **13,386**. The 95 dead stubs are 205 chars. Two populations
separated by 40×, so the floor placement was easy and safe.

Documentation is the opposite shape. `shape-families.json` sets `reference.min_prose_chars = 80`
because API pages are legitimately terse — signatures and parameter tables. A global 1,200-char
floor would mark thousands of healthy `/doc` pages as `DEAD_PAGE`.

**Action:** make `DEAD_BODY_MIN_CHARS` per-family before the Documentation run, and place each
family's floor from its own measured distribution — plot the two populations first, as was done
for blog. The not-found *marker* check is source-independent and can stay global.

## L3. Status codes are not liveness. Measure the discriminator on real data before wiring it.

I proposed `http_status != 200 -> DEAD`. On real blog data:

```
blog bodies returning 301 : 1,655   of which 1,538 ALIVE, 61 dead
dead stubs                :    95   of which 61 return 301, only 34 return 404
```

The rule would have destroyed ~1,600 healthy articles while catching a third of the dead ones, and
would have read in a report as a safety improvement.

**Action:** for every new gate, print the confusion on real records before it goes live — how many
does it kill, how many does it catch, and does it discriminate *within* the ambiguous bucket. The
test that mattered was `test_alive_301_survives_the_dead_page_gate`.

## L4. Build the canonical manifest first, with provenance. Always.

2,254 of 2,800 blog objectIDs had more than one cache copy (a rate-limited failure and a successful
retry). Resolution order alone decided the answer:

```
first glob match ->   365 ok, 2,435 errors
best-of          -> 2,504 ok,   296 errors
```

Both are "the cache". Any source with a retry history has this shape.

**Action:** `build_blog_manifest.py` generalises to `build_source_manifest.py --source X`. Run it
before batching, every time, and keep the provenance file. Never let `enrich_run` resolve a body
by globbing.

## L5. Predict the number before you measure it.

Predicted before the run, from the cached corpus:

| | predicted | actual |
|---|---|---|
| `DEAD_PAGE` | 104 (95 + 9) | **104** |
| language mismatch | 66.6% | **66.9%** |
| writable | ≥60% | **79.1%** |

This turns a census into a test. When the prediction and the measurement agree, the pipeline did
what the model of it said. When they disagree, something is wrong *and you find out immediately*
rather than three sessions later.

**Action:** make a written prediction for every source before its run. Put it in the plan.

## L6. Gates passing is not quality. Budget human read time.

Five automated gates passed on all 2,715 rows. Then reading four random abstracts found a real
defect the gates do not cover:

**64 of 2,065 writable rows (3.1%)** contain a span with no terminal punctuation, which joins into
a run-on and implies a link neither span makes. Colon lead-ins (`"several benefits:"`) with no list
following, and mid-sentence cuts.

I read roughly 10 of 2,065 abstracts. At that sample, defects below ~10% are invisible.

**Action:** every run budgets a fixed human/agent read of N abstracts, N stated in the packet, and
the packet reports what fraction was read. "All gates pass" must never be the last line.

## L7. Scale workers empirically. The plan under-provisioned by 4×.

| workers | rows/min |
|---|---|
| 6 | 13.0 |
| 9 | 20.0 |
| 21 | 27.3 |
| 33 | ~34 (sub-linear — knee) |

Linear to ~21, flat by 33. Local load 4.86, zero 429s, zero malformed JSON across 2,715 records —
so the limit is writer+judge round-trip latency, not throttling and not the machine.

The v2 plan said 2h02m at 8 workers. Actual: **86 minutes**. The per-record cost (~27s, two
sequential LLM calls) was right; the worker count was too timid.

**Action:** start at 21 for the next source. Ramp only if a measured knee moves.

## L8. A "healthy" service can be completely dead.

Scout returned `{"status":"ok"}`, showed `Up 11 days (healthy)`, and accepted every job with
`202 Accepted` — while completing **zero** for 2h45m. `pids.current 9482 / pids.max 9483`;
`RuntimeError: can't start new thread`.

Worse, the client-visible error was `Hosted API rate limit exceeded`, which sent three separate
attempts into tuning concurrency *down* against a service that could not run one job at any
concurrency.

**Action:** if jobs are being *accepted* and none *complete*, that is not a rate limit. Check
`pids.current` and the container log before touching worker counts. Set an explicit `--pids-limit`
so exhaustion fails loudly. Recorded in memory as `scout-healthy-but-pid-exhausted`.

## L9. Cooperation is being reported as failure.

`batches-out-blog/run-summary.json` says `ok 29, failed 53`. All 53 are `LOCKED_ELSEWHERE` — the
per-output-dir lock correctly declining a batch another process already had. Coverage
(2,715/2,715) is what proved the work was done; the summary alone reads as a catastrophe.

**Action:** give `LOCKED_ELSEWHERE` its own bucket in `run_batches.py`. A status that means
"working as designed" must never be counted in `failed`.

## L10. `.gitignore` patterns, not instances — fourth occurrence.

`batches-blog/` (36MB of scraped page bodies) would have been committed to this PUBLIC repo. The
rule listed `batches/`, `batches-out/`, `cache-batches/` by name, under a comment that claimed
"Directory patterns, not names". Fixed to `batches*/`.

**Action:** `git check-ignore -v <path>` on every new artifact directory, before it fills up.
Reading the rule is not verification.

---

## The generalised runbook for the next source

1. **Census the source** — count, page_types, families, language split, body-length distribution.
2. **Language probe** — does `/de/` serve translated content? Decide gate vs counter from the
   number, not from blog's answer (L1).
3. **Place the dead-page floor** from this source's own body-length distribution (L2).
4. **Print the confusion** for every gate on real records before wiring it (L3).
5. **Build the canonical manifest** with provenance (L4).
6. **Write the predictions** into the plan (L5).
7. **Run at 21 workers** (L7).
8. **Verify**: coverage vs the queue, scope, dead-page leakage, payload shape, grounding.
9. **Read N abstracts by hand**, state N in the packet (L6).
10. **Packet, then gate, then write.**
