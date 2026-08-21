# Production comparison

This local, read-only harness sends each canonical question to Flagship and production in parallel. It records each answer and every retrieval tool-output event, then sends each complete answer/evidence packet to the same Skeptic, Referee, and Advocate Agent Studio judges used by the widget. The shared deterministic core validates reports, averages the four dimensions, resolves consensus, and applies grounding caps.

No API key is stored in this directory. Set:

```bash
export FLAGSHIP_SEARCH_KEY=...
export PRODUCTION_SEARCH_KEY=...
export JUDGE_SEARCH_KEY=... # optional; defaults to FLAGSHIP_SEARCH_KEY
export JUDGE_SKEPTIC_AGENT_ID=...
export JUDGE_REFEREE_AGENT_ID=...
export JUDGE_ADVOCATE_AGENT_ID=...
export COMPARISON_TIMEOUT_MS=300000
export JUDGE_CONCURRENCY=3
node production_comparison/runner.mjs
```

To rerun only the judges against a previously captured set of answers and complete evidence packets:

```bash
node production_comparison/runner.mjs --rejudge production_comparison/runs/<timestamp>/results.json
```

Each run writes `results.json` and `report.html` under `production_comparison/runs/<timestamp>/`. Generated runs are evidence and must not be committed unless intentionally promoted into `docs/evidence/`.

Rules:

- The two answer calls fan out in parallel.
- The three judges run independently and in parallel for each answer.
- A judge gets one retry only after deterministic schema validation fails. Transport and stream errors are never copied into the trusted retry packet.
- LLMs only make semantic judgments.
- Code owns IDs, hashes, exact text, offsets, ordered claim identity, schema validation, arithmetic, consensus, caps, concurrency normalization, and report rendering.
- Judge output followed by a stream error, abort, guardrail violation, or malformed SSE data frame is rejected even if the preceding JSON was valid.
- Evidence is never deduplicated or truncated. If the complete packet is missing or exceeds verified capacity, the score is unavailable/incomplete.
