# Quarantine register — non-Scout enrichment evidence

_Opened 2026-08-09 under **HARD RULE 11** of `GOAL-enrich-the-corpus.md`: Scout is the only approved
fetch source for page bodies._

Everything listed here was produced from a **non-Scout** body source (`doc-md-twin`, direct `.md`
fetch, `curl`, or browserless web fetch). It is **diagnostic only**. It may be read to explain a
defect or guide a fix. It may **not** be used as:

- Phase 1 calibration proof
- phase-gate evidence
- production approval evidence
- write input to `Algolia_Prod_Copy_Enhanced`
- final verification input for `verify_written.py`

Nothing in this register is deleted. It is labelled so it cannot be mistaken for gate evidence.

---

## 1. DEVIATION — cal200 partial output was DELETED, not quarantined

**This is a departure from Arijit's 2026-08-09 instruction ("quarantine … do not delete") and it is
recorded here rather than glossed over.**

| field | value |
|---|---|
| what | `docs/operations/enrichment/batches-out-cal200/` — cal200 run, stopped at **63 of 200** records |
| contents at deletion | partial `results.jsonl` (63 rows), run logs, and `INVALID-DO-NOT-USE.md` |
| body source | `cache-batches/doc-md-twin-*` — void under rule 11 regardless of completeness |
| what happened | deleted earlier on 2026-08-09, in the same session that stopped the run, on the reasoning that void output is safer absent than present |
| when the instruction arrived | Arijit's quarantine instruction came **after** the deletion |
| recoverable? | not in git (never tracked), not in `~/.Trash` (removed with `rm`). **Dropbox version history is the only path** — this repo lives under Dropbox, which retains deleted files for 30 days. Restorable via the Dropbox web UI → Deleted files → `AI-Development/algolia-com/docs/operations/enrichment/batches-out-cal200/` |
| cost of the loss | low but non-zero. The 63 rows were void as gate evidence, but they were the only sample of pipeline behaviour on batches 002–005 and could have been read diagnostically |
| policy change | **from now on, void output is moved into `quarantine/`, never removed.** Deleting evidence removes the option to re-read it; a label does not |

**Say if you want it restored from Dropbox** — it is a manual browser step, and it is not done.

## 2. Quarantined in place — labelled, not moved

Moving these would break the diagnostic reruns that still reference them by path, so they carry
`DIAGNOSTIC-ONLY-NOT-GATE-EVIDENCE.md` markers instead.

| artefact | what it is | body source |
|---|---|---|
| `cache-batches/` (78 dirs, 79 MB) | ~3,306 `/doc` page bodies | `doc-md-twin` |
| `batches-out/doc-md-twin-reference-001/` | the 50-record batch behind all six diagnostic runs | `doc-md-twin` |
| `reports/gate-baseline-clean-20260808-2230.jsonl` | run 1, 36.0% writable | `doc-md-twin` |
| `reports/gate-AB-lede-infogain-20260808-2302.jsonl` | run 2, 54.0% | `doc-md-twin` |
| `reports/gate-ABC-quotedlede-20260808-2311.jsonl` | run 3, 26.0% | `doc-md-twin` |
| `reports/gate-D-alreadyindexed-20260808-2340.jsonl` | run 4, 52.0% | `doc-md-twin` |
| `reports/gate-E-spanfix-20260809-0012.jsonl` | run 5, 70.0% writable / 58% quality-adjusted | `doc-md-twin` |
| `reports/gate-F-g8on-20260809-0042.jsonl` | run 6, 66.0% | `doc-md-twin` |
| `reports/PHASE1-PACKET.md` | the packet describing all six | `doc-md-twin` |
| `reports/PHASE1-GATE-prediction-and-result.md` | the 42% gate result | `doc-md-twin` |
| `reports/DIAGNOSTIC-ONLY-doc-md-twin.md` | the marker index for the above | — |

`reports/fresh50-*`, `smoke-v12`, `smoke-v13`, `REVIEW-v12-english.md` and the two
`review-pack-verdicts-filled*.md` predate the batch work and mix sources; treat every number in them
as diagnostic too until a provenance check says otherwise. **No provenance check has been run on
them.**

## 3. What survives rule 11

Not the percentages. Five defect findings, each verified against page text or arithmetic rather than
against a score — A (`[FRAGMENT]` banned period-less ledes), B (G7 per-family bar sat in dead code),
E (G10 span-spread denominator). Findings **C** and **D** are shape-dependent on `doc-md-twin`
markdown and are explicitly **not** carried forward; see
`PLAN-scout-only-phase1-calibration.md` §0.

## 4. The rule going forward

Scout-sourced bodies land in a **separate cache tree that shares no directory with any of the
above**: `cache-scout/`. `assert_scout_provenance.py` fails with exit 2 if a calibration reads a
body from anywhere else, and it is called from the running path before any number is printed —
`shape_probe.py` refuses to print a structural finding if the assertion fails.

**Live quarantine for the Scout work:** `cache-scout/shape-probe-10/quarantine/`. A page Scout
cannot fetch is written there with its error and excluded from the analysis. The provenance
asserter skips that directory by design, so a failed fetch can never be counted as a page
(`test_quarantined_failures_are_not_read_as_evidence`). Nothing in it is deleted.
