# SESSION — Search-First Algolia.com

_Last updated: 2026-08-08 06:40 UTC_

## Resume here

**Next session: `read SESSION.md and proceed`.**

Chapter 3 content enrichment is **built, tested, and writing to the live index**. 35 records are
enriched and independently verified. The next action is **Arijit reading the validation pack** —
that is his gate and it has not happened.

Full detail, every decision and every bug:
**`docs/80-documentation/enrichment/chapter-3-build-log.md`** (470 lines). Read that before
touching the pipeline; it will save you rediscovering twelve bugs.

---

## What Chapter 3 does, in one paragraph

**REDESIGNED 2026-08-08.** A script splits the page into NUMBERED sentences. The model returns
**only integers** — `{"abstract":[12,15],"highlights":[18,22]}`. The script looks those numbers up
in its own list. The model emits no text at all, so invention is **unrepresentable**, not merely
caught. A second LLM from a different vendor then judges whether the *selection* is any good.
Fields: `abstract_enriched` (an ARRAY of sentences), `keyhighlights_enriched`.

The previous design had the model *copy* text and string-matched it. Arijit rejected it: copying is
transcription, models are bad at transcription, and each near-miss cost a whole record —
*"I need every single record to be enriched."* He was right; the fix was to stop asking for text.

**The guarantee is the script, not the judge.** Drop the judge and zero-invention survives. Drop
the script and there is no guarantee, only reassurance.

## Confidence, 2026-08-08 — scored on evidence

```
zero invention (structural)   10/10   415/415 sentences, two runs, 0 out-of-range
correctness of stored text    10/10   sliced by offset from the source
verifiability                  9/10   independent re-fetch + re-locate, 151/151
write-path safety              9/10   snapshot-gated, add-only, read-back
documentation                  9/10   chapter 346 lines, build log 753
robustness (43 shapes)         8/10   0 crashes on 50 fresh records
coverage / yield               7/10   34/50 = 68%, was ~47%
freshness handling             6/10   hash detects staleness; no re-check cadence
slop resistance                6/10   G7/G8/G11 floors, then opinion
SELECTION QUALITY              5/10   judge REVISE on 19 of 34 (56%)
REPRODUCIBILITY                3/10   19/50 identical -- see below
HUMAN VALIDATION               2/10   zero records reviewed by Arijit
```

"Can it write something false into the index" — **10/10**.
"Is what it writes any good" — **5/10, unproven**.

## ⚠ A claim I retracted — read this before trusting any measurement here

I reported "writer is REPRODUCIBLE, 8/8 identical". **That measured the retired copy-text prompt.**
On the numbered design: **19/50 identical**. The menu offers ~26 choices and temperature 0 does not
make a reasoning model deterministic.

Truth is unaffected — every variant is a valid selection of real sentences. Quality varies.
**Chapter 4 must not assume byte-identical re-runs.** Determinism is available via majority-vote
across three runs or deterministic re-ordering of the picks, at some cost to selection quality.

The lesson: a claim is only true of the thing it was measured on. I carried this one across a design
change without re-measuring.

## State — verified live 2026-08-08

| | |
|---|---|
| `Algolia_Prod_Copy_Enhanced` | **12,035 records** (was 12,114; 79 Greenhouse job adverts deleted 2026-08-07, verified) |
| Enriched so far | **35** — written by the SUPERSEDED copy-text design. Verified safe (151/151 spans) but a different provenance from the current method. **Re-run them first.** |
| Snapshot | `docs/70-enrichment/snapshots/Algolia_Prod_Copy_Enhanced-20260808-030323.jsonl` — 12,035 recs, 17.8 MB, sha256 `5fdfccbb…`. **First snapshots of this index ever taken.** |
| Writer | **glm-5.2** via `ALGOLIA_INFERENCE_BASE_URL` (Algolia's own inference server, already in `.env.local`). Free, 1.6s/record, temperature 0. |
| Judge | **gemini-2.5-pro**, `GEMINI_API_KEY` in the shell env. Cross-vendor on purpose. |
| Support | **1,695 records excluded** by Arijit. Not enriched, not fetched, untouched. |
| Tests | `python3 -m pytest docs/70-enrichment/tests/test_span_gate.py -q` → **58 passed** |

## The pipeline

```
snapshot_enhanced.py     full census snapshot + manifest + sha256
delete_records.py        host-scoped delete, snapshot-gated, expected-count assert
fetch_router.py          4 paths -> ONE record shape; --build-queue --fetch-pilot --verify-families
span_gate.py             G1-G10. THE GUARANTEE. 58 tests.
enrich_run.py            writer -> gates -> judge.  --pilot  --replay  --manifest  --out
write_enrichment.py      the ONLY script that writes. --dry-run default, --apply --yes
verify_written.py        re-fetches every page, re-locates every span, shares no state
```

```bash
python3 -m pytest docs/70-enrichment/tests/test_span_gate.py -q     # 58 passed
python3 docs/70-enrichment/fetch_router.py --verify-families        # 42 types, sums to 12,035
python3 docs/70-enrichment/enrich_run.py --pilot --replay           # re-gate, FREE, no writer calls
python3 docs/70-enrichment/verify_written.py                        # 0 spans not on page
```

## NEXT ACTIONS, in order

0. **Fix selection quality — the top issue.** 56% of abstracts draw a judge REVISE. The model picks
   true sentences that are not the best sentences. Prompt work, not safety work. Look at the
   `missed_substance` scores and the judge's `better_span_available` suggestions in
   `reports/fresh50-run1/results.jsonl` — they name the sentence it would have preferred.
1. **Arijit reads `docs/70-enrichment/reports/REVIEW-english.md`** — 30 records, each with
   11 English records. Every sentence shown INSIDE its page text wrapped in `>>>` markers, no
   offsets, no German or French. **His gate. Zero hallucinations across 415 sentences.** The real
   question is whether the *selection* is good enough — the judge says no on 56%.
2. **Resolve `enterprise_ledger` freshness.** It holds real bodies for **4,462 records**
   (median 1,346 chars) — free, no fetching. But it carries retired product names (App Search,
   Enterprise Search) and stale `/old-docs/`. Needs a freshness rule and a preference order:
   `AC2_WWW_MULTI_NEURAL_body` → `ledger` → fetch. **Do this before the full run** — it removes a
   quarter of the fetching.
3. **Create `WU-11.4`** under WU-11 in Asana + `docs/briefs/WU-11.4.md`. Chapter 3 has no work
   subtask; Chapters 1 and 2 have `WU-11.1`/`WU-11.2`.
4. **Re-run the 35 records already in the index** under the numbered design, so the whole index has
   one provenance.
5. **Then the full run.** ~10,340 enrichable records, expect ~7,000 enriched at 68%. Free on GLM.
   Fetch is the bottleneck.
5. **Sweep 12,114 → 12,035** through `CLAUDE.md` and the chapter docs. Single pass with a callback —
   sequential replaces double-apply.
6. Rewrite `chapter-3-content-enrichment.md` from `status: not-started` to the real chapter.

## Decisions locked (Arijit, 2026-08-07/08)

- Field names: **`abstract_enriched`** / **`keyhighlights_enriched`**. Permanent.
- **Verbatim spans only.** No generated prose. Zero invention is structural, not checked.
- **Exactly two LLM steps**; the guarantee is in neither.
- Alive/dead decided by **reading page content**, never by status code or byte size.
- **Support excluded** — support engineers authored those answers; we do not reword them.
- **Greenhouse deleted** — 79 job adverts.
- **Writer = glm-5.2**, judge = Gemini. Cross-vendor.
- **Nothing auto-deleted.** DEAD goes to a list for Arijit.

## Constraints that will bite you

- **`.gitignore` rules for `docs/70-enrichment/` are duplicated inside that directory on purpose.**
  The root rules pointed at `docs/60-enrichment/` after the rename and matched nothing for months —
  23 MB of payload was committed to this **public** repo against the rule one line above it.
- **Python's `certifi` cannot reach the Algolia API from this machine** —
  `CERTIFICATE_VERIFY_FAILED: self-signed certificate in certificate chain` (corporate TLS
  interception). Every script uses curl via subprocess. A script using plain `urllib`/`requests`
  dies at record 1.
- **A filter on a non-faceted attribute returns an EMPTY result, not an error.** The verifier
  filtered `enrichment_verdict:REAL`, got 0 records, and reported success. Browse and filter
  client-side. *(Also: add the new fields to `attributesForFaceting` if the demo needs to filter.)*
- **glm-5.2 charges reasoning tokens against `max_tokens`.** At 120 it returns EMPTY content with
  `reasoning_tokens: 121`. Keep it ≥4000. Same trap on gemini-2.5-pro (`thinkingBudget: 0` is
  unsupported there).
- **`claude -p` inherits the global CLAUDE.md and hooks.** `ledger-gate.sh` blocks the subprocess's
  turn end and forces a second message; `--output-format json` keeps only the LAST message, so
  every record read as unparseable. `--settings '{"hooks":{}}'` does NOT help — the CLI merges
  settings. Use `stream-json` and scan all messages. *(Moot while the writer is GLM.)*
- **`abstract_enriched` is several spans joined by a space** — deliberately NOT one contiguous
  substring of the page. Verify it via `enrichment_span_offsets`, never by locating the joined
  string. Getting this wrong made the verifier print "THE GUARANTEE IS BROKEN" over 9 perfectly
  good records.
- **A page that has changed since enrichment is STALE, not failed.** 12 of 23 verified pages had
  already been edited upstream.
- **No sampling.** Full census.
- **Do not tick an Asana checkbox.** Arijit's gate.
- Repo is **PUBLIC**.

## Open — need Arijit

| # | Item |
|---|---|
| 1 | **Read the validation pack** — the gate |
| 2 | **Agent Studio → glm-5.2 `large`.** He asked; NOT done. 51 agents on the account, some are a colleague's live `www Chat`; his 7 run `medium`. Needs scope: his 7 or all 51? Different repo (`RAG/Algolia-Central2`). |
| 3 | `HOSTED_JOB_QUEUE_WORKERS=2` on the Scout container caps the fetch near 7h. Shared container restart. |
| 4 | **Rotate credentials**: Resend SMTP password (I printed it to a transcript with a careless env grep), plus both Scout keys, which passed through chat. |
| 5 | Two payload files untracked via `git rm --cached`; still in git history. Rewrite or leave? |
| 6 | `attributesForFaceting` for the new fields — yes or no? |
| 7 | Yield is ~40%, so realistic outcome is **4,500–5,000 enriched records, not 12,035**. Acceptable? |

## What is NOT done

- The full run. 35 of ~10,340.
- `enterprise_ledger` / `AC2_body` as a body source — measured (4,462 records) but not wired in.
- G5 language check and G8 corpus-wide template collision are specified but not in the runner.
- Chapter 3's own doc still says `status: not-started`.
- WU-11.4 does not exist in Asana.
- Chapter 1's classifier has NOT been re-run on the new text — that is the actual payoff and it is
  untouched.

## The failure pattern — read before claiming anything is done

Twelve bugs today. The instructive ones:

1. **31 fixture tests passed while a live bug was active.** Tests written from the same wrong
   assumptions as the code cannot catch it. Only a real page did.
2. **A verifier that finds nothing to verify reports success.** Empty result ≠ pass.
3. **A verifier that cries wolf is as dangerous as one that stays silent** — 9 false alarms with
   "THE GUARANTEE IS BROKEN" in capitals.
4. **I claimed hallucinations were caught when they were my own false rejections** — twice. Both
   times, checking before repeating it was the only thing that stopped a wrong fact entering the
   record.

Name the surface, query that surface, quote the output. A self-report is not evidence.

## Files written this session (2026-08-07 → 08)

**Pipeline** — `docs/70-enrichment/`
```
snapshot_enhanced.py      delete_records.py       fetch_router.py
span_gate.py              enrich_run.py           write_enrichment.py
verify_written.py         tests/test_span_gate.py (58 tests)
prompts/abstract_enrichment_v1.md   prompts/validation_v1.md   prompts/shape-families.json
```

**Data / reports** (gitignored)
```
snapshots/Algolia_Prod_Copy_Enhanced-20260807-175722.jsonl   12,114 recs (pre-deletion)
snapshots/Algolia_Prod_Copy_Enhanced-20260808-030323.jsonl   12,035 recs, sha256 5fdfccbb…
work-queue.jsonl                                             12,035 routed records
cache/pilot-manifest.json  cache2/pilot-manifest.json         60 fetched pages
reports/pilot-30/  pilot-30b/  glm-30a/  glm-30b/             4 runs + validation packs
reports/deleted-job-boards_greenhouse_io-20260807-180222.json
reports/written-20260808-030355.json                          the 35 objectIDs written
```

**Documentation**
```
docs/80-documentation/enrichment/chapter-3-build-log.md   470 lines, 17 decisions, 12 bugs
SESSION.md                                               this file
.gitignore + docs/70-enrichment/.gitignore               orphaned-rule fix
```

**Vault** — `Projects/Search-First-Algolia-com/`
```
index.md      compiled truth + timeline entry; retired the unprovable 75% overlay claim
log.md        dated session entry
tasks.md      Chapter 3 task block
wiki/content-enrichment.md   the durable technique, written to outlive the project
```
Plus `wiki/log.md`, `wiki/hot.md`, `Projects/AI-OS/My-Projects.md`.

**Memory** — 6 new files + index + pointer
```
verbatim-span-extraction-beats-generation      verbatim-does-not-mean-truthful
the-guarantee-is-the-script-not-the-judge      verifier-failure-modes-empty-and-crying-wolf
algolia-inference-server-glm-5-2               claude-p-subprocess-inherits-hooks-and-claudemd
gitignore-orphaned-by-directory-rename         MEMORY.md · session_pointer.md · project-tracker-status.md
```

**Live index changes** — `Algolia_Prod_Copy_Enhanced`
```
79 Greenhouse job-advert records DELETED      12,114 → 12,035, verified
35 records ENRICHED                           fields added only, nothing overwritten
```
