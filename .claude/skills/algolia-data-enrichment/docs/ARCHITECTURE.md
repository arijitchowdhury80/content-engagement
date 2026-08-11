# Architecture

One CLI over an internal Python package. ~9,000 lines, replacing 40 loose scripts totalling
13,321 — of which 7,279 lines were deliberately dropped rather than carried.

The shape is not an aesthetic preference. The predecessor was a folder of scripts that agents
grabbed at random, and the three worst defects in its history were all shape defects: two
implementations of one function, a gate in a code path nothing called, and two programs joined
by a human running them in the right order.

---

## Layers

```mermaid
flowchart TB
    CLI["algolia_enrich.py<br/><i>17 commands, one registry, one lock</i>"]

    subgraph ENF["Enforcement — refuses before it acts"]
        direction LR
        state["state.py<br/>legal transitions"]
        lock["lock.py<br/>one writer"]
        appr["approvals.py<br/>parsed tokens"]
        art["artifacts.py<br/>no writes outside run/"]
        led["ledger.py<br/>config echo + metrics"]
    end

    subgraph POLICY["Policy — data, not code"]
        prof["profiles.py + 13 YAML"]
        lint["profile_lint.py"]
        disp["dispatch.py<br/>sniff the body"]
        strat["strategies/"]
    end

    subgraph CORE["Grounding core — the guarantee"]
        direction TB
        canon["canonical.py<br/><b>ONE canonicalisation</b>"]
        cand["candidates.py<br/>page → numbered menu"]
        filt["filters.py<br/>chrome + boilerplate"]
        gate["gates.py<br/>pool + selection gates"]
        rep["repair.py<br/>extend, never add"]
        pipe["pipeline.py<br/><b>THE live path</b>"]
    end

    subgraph IO["I/O — the only ways in and out"]
        scout["scout.py<br/>the only fetcher"]
        bs["bodysource.py<br/>fetch ⟷ enrich join"]
        mio["model_io.py<br/>writer + judge"]
        api["api.py<br/>Algolia REST"]
    end

    subgraph VAL["validate/ — five files, never one god-object"]
        g["grounding.py"]
        q["quality.py"]
        p["payload.py"]
        l["live.py"]
        s["search.py"]
    end

    CLI --> ENF
    CLI --> POLICY
    CLI --> pipe
    CLI --> VAL
    pipe --> canon & cand & filt & gate & rep
    pipe --> mio
    CLI --> bs --> scout
    VAL --> api
    CLI --> write["write.py<br/>the only writer"] --> api

    style CORE fill:#f0fdf4,stroke:#16a34a
    style IO fill:#eff6ff,stroke:#2563eb
    style ENF fill:#fef2f2,stroke:#dc2626
    style VAL fill:#faf5ff,stroke:#9333ea
```

---

## One record, end to end

`pipeline.process_record()` is the only implementation of this. There is no second copy.

```mermaid
flowchart TD
    A["record + Scout body"] --> B{"terminal verdict?<br/><i>verdicts.py</i>"}
    B -->|"dead / shell / login /<br/>redirect / fetch-failed"| Z1["outcome recorded<br/><b>no model call</b>"]
    B -->|no| C{"body matches<br/>declared method?<br/><i>dispatch.py</i>"}
    C -->|no| Z2["METHOD_DISAGREEMENT<br/>warn, refuse to write"]
    C -->|yes| D["split into numbered candidates<br/><i>candidates.py</i>"]
    D --> E["pool FILTER<br/>chrome, duplicates, profile bans"]
    E --> F["pool GATES<br/>sections, reversals, speech"]
    F --> G["writer: menu → integers<br/><i>model_io.py</i>"]
    G --> H{"integers?"}
    H -->|"prose"| Z3["WRITER_FREE_TEXT<br/><b>hard failure</b>"]
    H -->|yes| I["resolve IDs to OUR candidates"]
    I --> J["repair incomplete spans<br/>over the page's own words"]
    J --> K["selection gates<br/>integrity, context, subject,<br/>chrome, information gain"]
    K -->|fail| L{"ban hint?"}
    L -->|yes| M["ban those candidates,<br/>re-ask — up to 3 attempts"] --> G
    L -->|no| Z4["human-review queue"]
    K -->|pass| N["judge: quality only,<br/>may not write prose"]
    N --> O["PASS → payload"]

    style Z3 fill:#fee2e2,stroke:#dc2626
    style O fill:#dcfce7,stroke:#16a34a
    style G fill:#fff7ed,stroke:#ea580c
```

**Why pool gates run before selection.** A pool gate is a property of one *candidate* — its
section, the text after it, the text itself. Running those after selection quarantined 589 of
2,800 records in the predecessor, almost all of them pages holding forty other usable sentences.
If a verdict depends only on the page, ban the candidate; never the record.

**Why the retry ladder exists.** A gate failure names *which* sentence was wrong. That is enough
to narrow the menu and ask again, which is what a person would do. Asking once and quarantining
throws a page away to punish one sentence.

---

## The grounding chain

Every link is deterministic. The model appears once, and it appears as an integer.

```mermaid
flowchart LR
    P["page body"] -->|"canonicalise()"| C["canonical text<br/>+ origin[] offset map"]
    C -->|"slice"| S["candidate spans"]
    S --> M["numbered menu"]
    M -.->|"LLM sees"| LLM(("LLM"))
    LLM -.->|"returns [12,14]"| R["resolve by index"]
    S --> R
    R --> ST["stored string"]
    ST -->|"validate: offset slice"| V1["✓ offsets still address it"]
    ST -->|"validate: offset-FREE lookup"| V2["✓ words are on the page"]
    ST -->|"verify-live: byte compare"| V3["✓ index says what we approved"]

    style LLM fill:#fff7ed,stroke:#ea580c
    style C fill:#f0fdf4,stroke:#16a34a
```

`canonicalise()` is **purely subtractive**. It deletes formatting characters, collapses
whitespace, and folds typographic variants strictly 1:1 so the offset map stays exact. It cannot
introduce a word. That is what lets a canonical match still prove every word came off the page.

Both checks always run. The offset-free one is what matters — a stale offset is common and
harmless, a missing string is a fabrication — but offset-only would silently pass a span whose
offsets happen to land on different text after a re-fetch.

---

## Module map

### Grounding core

| Module | Lines | Owns |
|---|---:|---|
| `canonical.py` | 407 | `Canon`, `canonicalise()`, the offset map, `is_speech`, `detect_language`, `prose_chars`. **The coordinate system four stages share.** |
| `candidates.py` | 534 | Block → sentence → piece splitting, candidate classification, the menu, integer resolution |
| `filters.py` | 211 | Chrome/breadcrumb/cookie/code-comment patterns, duplicate-description detection, corpus-frequency boilerplate |
| `gates.py` | 633 | `locate`, pool gates (static bans, reversal repair), selection gates (integrity, context, subject, information gain), the retry ladder |
| `repair.py` | 216 | Incomplete-span detection and extension over contiguous source text |
| `pipeline.py` | 395 | **The live path.** Composes all of the above. |

### I/O

| Module | Lines | Owns |
|---|---:|---|
| `scout.py` | 233 | The only page fetcher. Served-URL identity, rate-limit backoff, real-job health check |
| `bodysource.py` | 210 | `BodySource` protocol, `ScoutRefetch`, `IngestPayload`, and `RunCache` — the fetch/enrich join |
| `model_io.py` | 330 | Writer prompt, judge prompt, retry/backoff, served-model pinning |
| `api.py` | 204 | Algolia REST, cursor pagination, credential-safe curl |

### Policy

| Module | Lines | Owns |
|---|---:|---|
| `profiles.py` | 246 | YAML loading, inheritance, validation, versioning by content hash |
| `profile_lint.py` | 89 | Coverage of every **live** page_type against the profile set |
| `dispatch.py` | 98 | Body-shape sniffer; declared method vs measured shape |
| `verdicts.py` | 184 | Dead / shell / login / redirect classification, decided by body not status |
| `strategies/` | 67 | Five enrichment methods; deliberately thin |

### Enforcement

`state.py` (legal transitions) · `lock.py` (one writer per run) · `approvals.py` (parsed tokens) ·
`artifacts.py` (no writes outside the run folder) · `ledger.py` (per-record outcomes, metrics,
effective-config echo) · `errors.py` (typed failures, all non-zero exit) · `config.py` (index
names as config) · `human_review.py` · `corpus.py` · `write.py` · `batching.py`

### Validation

Five modules, one registry of 17 named gates. The split is deliberate: the predecessor had
eleven separate verifier scripts, which is eleven incidents rather than a design.

---

## Run folder

One slice, one directory, nothing loose anywhere else.

```
runs/<YYYYMMDD-source-page_type-aNN>/
├── .lock                    PID, command, started_at
├── state.json               multi-track: fetch/enrich/repair/final/validate/write
├── manifest.json            exact objectIDs + the runtime projection
├── census-before.json       what the index looked like at planning time
├── effective-config.json    what the runner ACTUALLY loaded — printed, not inferred
├── fetch-manifest.json      seals the cache to this run id
├── ledger.jsonl             one row per record per stage
├── metrics.json             wall clock, per-record cost
├── cache-scout/             bodies this run's own fetch produced
├── outputs/base|repair/     results.jsonl
├── final/                   results · payloads · human-review-queue
├── validation/              coverage · grounding · payload · live · method-check
├── reports/                 packet.md · review-pack.md
├── approvals/  probes/  logs/  tmp/  archive/
```

The `aNN` attempt suffix is load-bearing: without it a same-day rerun of the same slice collides
on the folder and the lock.

---

## Three shapes worth understanding

### `canonical.py` is separate from `gates.py`

It is not a gate. It is the projection that candidate slicing, repair, artifact validation and
live verification all work in — four consumers, one normalisation. Both grounding failures in the
predecessor were two code paths normalising the same characters differently, and both times the
spans were faithful and the verifier was wrong.

Separation alone does not prevent that (the divergence was *within* one function), so
`test_canonical.py` asserts idempotence and branch parity directly.

### `run_gates()` is not ported

The predecessor had a record-level gate function that the runner never called, plus an inline
copy that it did. A gate was fixed inside the dead one twice — every unit test passed, the
pipeline behaved exactly as before.

Carrying it would carry the defect. `pipeline.evaluate_selection` is the single live path, and
`test_gate_wiring.py` proves a gate is *reached by the CLI* by driving the command and reading the
run's own output, not by importing the gate and calling it.

### `bodysource.py` joins two halves that were joined by a human

Measured by walking the import graph: the Scout-only fetcher — the thing enforcing the single most
important rule in the project — was not reachable from the live runner. Fetch was one program,
enrich another, and nothing verified that the bodies the runner read were the bodies the fetcher
wrote.

`enrich` now takes a run folder and refuses unless that run's own `fetch` sealed the cache. Every
body is checked against the source the **manifest** declares — not against the body's own claim
about itself, because a body that lies about its fetcher would otherwise skip the very check that
exists to catch it.
