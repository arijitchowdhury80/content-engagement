# Current vs. candidate judge experiment

This local harness compares the current three-judge panel with an isolated candidate panel. It captures each of the 10 canonical questions from the Flagship orchestrator exactly once, freezes the complete answer and retrieval evidence, and sends that same verified v3 evaluation package to both panels twice.

It does not call production Ask Algolia, mutate Agent Studio, change the widget, or deploy anything to Jahia.

## Environment

No API key is stored in this directory.

```bash
export FLAGSHIP_SEARCH_KEY=...
export JUDGE_SEARCH_KEY=... # optional; defaults to FLAGSHIP_SEARCH_KEY
```

Worker, aggregate, and one-process modes require the sanitized `after-readback.json` produced by the candidate deployment tool. The harness validates and binds every worker to its app ID, three agent IDs, `gpt-5.4-mini` model, OpenAI provider `e14c1f5e-7c24-4451-a342-940e427f769b`, publication status, zero-tool configuration, prompt hashes, and config hashes. Manifest prompt hashes must also match the actual trimmed files under `agents/prompts/judge/candidate/`; a self-consistent but stale manifest is rejected. Candidate IDs cannot be supplied through environment variables. Current judge IDs come only from `config.json` and cannot be overridden for this experiment.

Optional settings:

```bash
export ANSWER_CAPTURE_CONCURRENCY=4
export EXPERIMENT_TRANSPORT_TIMEOUT_MS=... # disabled when unset
export CANDIDATE_JUDGE_SEARCH_KEY=...      # defaults to JUDGE_SEARCH_KEY
export EXPERIMENT_GLOBAL_LOCK_ROOT=...     # test isolation only; normally leave unset
```

The experiment always uses exactly four shards. A filesystem-backed global semaphore admits at most four worker processes, and every process is separately limited to one three-role panel. This produces a hard global maximum of 12 concurrent judge calls even when commands are launched independently. A fifth process waits without an arbitrary deadline. Locks carry their owner PID, dead-process locks are atomically reclaimed, and slots are released in `finally` on success or failure. The worker count and judge-call ceiling are not configurable.

There is no panel deadline. Slow valid judge work is retained. A transport timeout is used only when `EXPERIMENT_TRANSPORT_TIMEOUT_MS` is explicitly set to a positive value. Existing one-retry behavior still applies to concrete transport, stream, JSON, or schema failures.

## Three-phase workflow

Choose one ignored run directory:

```bash
RUN_DIR="production_comparison/runs/judge-ab-$(date -u +%Y%m%dT%H%M%SZ)"
CANDIDATE_MANIFEST="production_comparison/runs/<candidate-deploy-run>/candidate-deploy/evidence/after-readback.json"
mkdir -p "$RUN_DIR"
```

### 1. Capture once

```bash
node production_comparison/parallel-experiment.mjs \
  --phase capture \
  --output-dir "$RUN_DIR"
```

This writes only `frozen-packets.json`. It captures the 10 Flagship answers with bounded concurrency, builds the existing `algolia-judge-v3` manifest and evidence package, and records hashes for the question, answer, evidence, manifest, and complete evaluation package.

### 2. Run four worker shards

Run each command in a separate Codex worker agent after capture completes:

```bash
node production_comparison/parallel-experiment.mjs --phase worker --candidate-manifest "$CANDIDATE_MANIFEST" --frozen-packets "$RUN_DIR/frozen-packets.json" --output-dir "$RUN_DIR" --shard-index 0 --shard-count 4
node production_comparison/parallel-experiment.mjs --phase worker --candidate-manifest "$CANDIDATE_MANIFEST" --frozen-packets "$RUN_DIR/frozen-packets.json" --output-dir "$RUN_DIR" --shard-index 1 --shard-count 4
node production_comparison/parallel-experiment.mjs --phase worker --candidate-manifest "$CANDIDATE_MANIFEST" --frozen-packets "$RUN_DIR/frozen-packets.json" --output-dir "$RUN_DIR" --shard-index 2 --shard-count 4
node production_comparison/parallel-experiment.mjs --phase worker --candidate-manifest "$CANDIDATE_MANIFEST" --frozen-packets "$RUN_DIR/frozen-packets.json" --output-dir "$RUN_DIR" --shard-index 3 --shard-count 4
```

Each worker reads and verifies the same frozen file, selects questions by `questionIndex % shardCount`, and writes only its own `worker-N.json`. For each owned question it runs, in order:

1. Current panel, round 1
2. Current panel, round 2
3. Candidate panel, round 1
4. Candidate panel, round 2

The three roles inside a panel run in parallel. The next panel does not start until the current panel settles.

### 3. Verify and aggregate

```bash
node production_comparison/parallel-experiment.mjs \
  --phase aggregate \
  --candidate-manifest "$CANDIDATE_MANIFEST" \
  --frozen-packets "$RUN_DIR/frozen-packets.json" \
  --output-dir "$RUN_DIR" \
  --shard-count 4
```

Aggregate mode discovers `worker-*.json` in the run directory. You can instead pass each file explicitly with repeated `--worker-output` arguments.

It refuses to merge unless:

- all 10 frozen packets still pass every hash check;
- every shard has exactly one worker output;
- workers contain only questions owned by their shard;
- each question has exactly four unique panel executions;
- every execution references the original packet hashes;
- every execution contains one report record for each distinct role;
- every question contains exactly `current:1`, `current:2`, `candidate:1`, and `candidate:2`; and
- all workers match the locked current configuration and the exact candidate deployment manifest.

For every called panel, aggregation discards trust in the persisted verdict and regenerates the protected status, dimensions, composite, quality base, cap, gate, claims, disagreements, rationale, and per-role summary from the persisted validated role reports using the deterministic core. Any mismatch rejects the run. A zero-attempt evidence-unavailable or over-capacity panel is accepted only with a strict unavailable/no-score/no-cap/no-claims shape and the correct reason.

Persistent judge failures remain explicit failures with unavailable scores. They are never converted to zero. The headline comparison uses only same-round pairs where both panels returned all three valid judges. Provisional operational fallback scores are reported separately and never influence the headline delta. Every score includes its coverage count, and a one-run result is never labeled as an average of two. Latency excludes panels and roles where no judge call occurred.

### Retry failed roles without creating a new scoring round

If a role remains invalid after its built-in schema retry, repair the worker output instead of rerunning complete panels:

```bash
node production_comparison/parallel-experiment.mjs \
  --phase repair-worker \
  --candidate-manifest "$CANDIDATE_MANIFEST" \
  --frozen-packets "$RUN_DIR/frozen-packets.json" \
  --worker-output "$RUN_DIR/worker-1.json" \
  --output-dir "$REPAIR_DIR"
```

The repair phase preserves successful role reports, retries only failed roles against the identical frozen evaluation hash, and writes `worker-N-repaired.json` without changing the original. Exactly one repair pass is allowed for an execution; repeated sampling until a response validates is prohibited. A panel skipped because its answer has no retrieval evidence is not retried: that answer must be recaptured as a separate experiment attempt because a judge call cannot manufacture missing evidence.

Aggregate the selected four worker files explicitly when originals and repairs live in different directories:

```bash
node production_comparison/parallel-experiment.mjs \
  --phase aggregate \
  --candidate-manifest "$CANDIDATE_MANIFEST" \
  --frozen-packets "$RUN_DIR/frozen-packets.json" \
  --output-dir "$FINAL_DIR" \
  --worker-output "$REPAIR_DIR/worker-1-repaired.json" \
  --worker-output "$REPAIR_DIR/worker-2-repaired.json" \
  --worker-output "$REPAIR_DIR/worker-3-repaired.json" \
  --worker-output "$REPAIR_DIR/worker-4-repaired.json"
```

The aggregate records each selected worker path and hash and verifies every repair source hash. If a directory contains both original and repaired output for the same worker, automatic discovery stops and requires explicit selection.

Outputs:

```text
frozen-packets.json
worker-1.json
worker-2.json
worker-3.json
worker-4.json
merged-results.json
report.html
```

## Optional one-process mode

For local convenience only:

```bash
node production_comparison/parallel-experiment.mjs --phase all --candidate-manifest "$CANDIDATE_MANIFEST" --output-dir "$RUN_DIR"
```

This uses four logical shards in one coordinator, but the process still holds one global worker slot and a three-call limiter. The three-phase workflow is the approved path for four parallel Codex worker agents.

## Legacy Flagship vs. production comparison

The original comparison remains on its own CLI, including `--rejudge`:

```bash
node production_comparison/runner.mjs
node production_comparison/runner.mjs --rejudge production_comparison/runs/<run>/results.json
```

## Tests

```bash
node --test production_comparison/runner.test.mjs
```

Tests use mocked transports only. They do not call Agent Studio or any live endpoint.

Generated run payloads under `production_comparison/runs/` are local evidence and must not be committed. Raw JSON, report files, and experiment directories are written with owner-only permissions (`0600` files and `0700` directories).
