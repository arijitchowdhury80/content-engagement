# Orchestrator Prompt Tuning Sprint — Answer Quality Baseline to 10x Candidate

**Date:** 2026-08-10  
**Status:** Execution plan. Not yet executed.  
**Target agent:** `www Chat – Orchestrator`  
**Target app:** `0EXRPAXB56`  
**Target index:** `Algolia_Prod_Copy_Enhanced`  
**Credential source:** `/Users/arijitchowdhury/Dropbox/AI-Development/algolia-com/.env.local`

## Summary

Tune only the orchestrator/gateway agent first. The objective is to beat the current Algolia.com Ask AI answer-quality baseline before adding discovery, white-glove engagement, personality, or specialist choreography.

The sprint starts by converting the existing 4-run Ask AI baseline into a formal benchmark: prompt baseline, scored answers, consistency score, rubric, protected regression cases, and immutable source-of-truth artifacts. Then run an explicit Karpathy `autoresearch`-style experimentation loop: define the task, define the metric, generate one prompt mutation, run the fixed evaluation, score it, keep/discard it, and append the result to a permanent experiment log.

The winning answer-quality prompt becomes the foundation prompt for the next sprint: discovery and white-glove engagement.

## Baseline And Knowledge Capture

Create the canonical experiment folder:

`docs/design/search-experience/discovery-engagement/prompt-experiments/orchestrator-answer-quality/`

Blocking first step:

- Write the pasted Algolia Website Assistant prompt to `prod-prompt-baseline.md`.
- Snapshot `www Chat – Orchestrator` to `target-agent-snapshot.json`.
- Verify and link the existing 4-run baseline at `docs/design/search-experience/discovery-engagement/baselines/ask-ai-2026-08-10/`.

Required files:

- `README.md`: experiment index and "read this first."
- `experiment-decisions.md`: human decisions, assumptions, and rationale.
- `rubric-v1.md`: weighted rubric and scoring bands.
- `baseline-scores.md` and `baseline-scores.json`: per-question, per-dimension, and composite baseline score.
- `protected-regression-cases.md`: high-risk questions and baseline strengths to preserve.
- `experiment-ledger.jsonl`: append-only run log.

Baseline immutability rule:

- Captured baseline files are never edited after creation.
- Corrections or new captures must be written as superseding files with a new timestamp/version.
- `README.md` points to the active baseline version.

## Preflight Gates

No experiment may start until all preflight checks pass:

- Load credentials from `/Users/arijitchowdhury/Dropbox/AI-Development/algolia-com/.env.local` without printing secrets.
- Require `ALGOLIA_APP_ID`, `ALGOLIA_SEARCH_API_KEY`, `ALGOLIA_ADMIN_API_KEY`, `ALGOLIA_AGENT_MODEL`, and `ALGOLIA_PROVIDER_INFERENCE_ID`.
- Confirm app ID is `0EXRPAXB56`.
- Confirm index `Algolia_Prod_Copy_Enhanced` exists and returns relevant hits for the 10 sample questions.
- Confirm agent `www Chat – Orchestrator` exists.
- Confirm the agent search tool points to `Algolia_Prod_Copy_Enhanced`.
- Snapshot the target agent before any patch.
- Test rollback before the first candidate.
- Create an active-run lock before patching.

Run lock:

- Use an experiment lock file such as `.experiment-lock.json` in the experiment folder.
- The lock records run ID, started time, target agent ID, current candidate, and owner process.
- If a lock exists and is active, abort instead of patching.
- Always clear the lock only after rollback/final-state verification succeeds.

## Karpathy Autoresearch Adaptation

This sprint is a prompt-tuning adaptation of Andrej Karpathy's `autoresearch` loop, using the repository pattern from `https://github.com/karpathy/autoresearch` as the operating model.

The core discipline is:

1. Keep the benchmark fixed.
2. Keep the metric fixed.
3. Change one candidate prompt at a time.
4. Run the experiment.
5. Score against the benchmark.
6. Keep the candidate only if it improves the metric without violating gates.
7. Record every attempt, including failures.

Required autoresearch-style artifacts:

- `program.md`: the natural-language task definition for the research loop.
- `metric.md`: the exact optimization target and acceptance gates.
- `rubric-v1.md`: the weighted scoring rubric used by the metric.
- `baseline-scores.json`: the starting score to beat.
- `candidates/`: one folder per generated prompt mutation.
- `experiments.jsonl`: append-only experiment ledger, one row per candidate.
- `best-so-far/`: current winning prompt and score.
- `winner/`: final accepted answer-quality prompt package.

`program.md` must state the research objective plainly:

> Improve the `www Chat – Orchestrator` prompt so its answers to the fixed Algolia.com commercial question suite are deeper, more complete, better sourced, more human-readable, and more commercially useful than the 4-run Ask AI baseline, without reducing grounding, consistency, or safety.

`metric.md` must state the scoring target:

- Optimize composite rubric score.
- Preserve or improve source grounding.
- Preserve answer-before-follow-up behavior.
- Preserve one-question maximum follow-up.
- Reject hallucinated pricing, competitor, plan, timeline, or feature-availability certainty.
- Reject candidates that win by verbosity alone.

Candidate generation rules:

- Each candidate is a hypothesis, not a random rewrite.
- Each candidate gets a short mutation statement: "I expect this prompt change to improve X because Y."
- Each candidate may change only 1-2 mutation families.
- The loop must be able to explain why a candidate won or lost.

Experiment ledger row shape:

```json
{
  "candidate_id": "candidate-001-answer-structure",
  "parent_id": "prompt-v000-prod-baseline",
  "mutation_families": ["answer-structure"],
  "hypothesis": "Answer-first structure will improve directness and completeness without changing grounding.",
  "agent_snapshot": "candidate-001/snapshot-before.json",
  "prompt_path": "candidate-001/prompt.md",
  "answers_path": "candidate-001/answers.raw.json",
  "scores_path": "candidate-001/scores.json",
  "composite_score": 0,
  "baseline_delta": 0,
  "verdict": "accept | reject | needs_human_review",
  "failure_taxonomy": [],
  "runtime_ms": 0,
  "agent_calls": 0,
  "judge_calls": 0,
  "rollback_status": "not_needed | rolled_back | failed",
  "created_at": "ISO-8601"
}
```

The loop is not complete when an answer "looks better." It is complete only when the candidate beats the metric, passes regression gates, is logged, and the target agent state is verified.

## Rubric And Judge Contract

Score every answer on a 100-point rubric:

- Direct answer quality
- Question understanding
- Depth
- Breadth
- Thoroughness
- Completeness
- Technical specificity
- Source grounding
- Source synthesis
- Human explanation quality
- Follow-up question quality
- Consistency
- Safety/grounding discipline

Scoring bands for each dimension:

- `0-2`: missing, incorrect, or actively harmful
- `3-5`: partial, shallow, or unreliable
- `6-8`: good and usable, but not clearly 10x
- `9-10`: excellent, specific, grounded, and commercially useful

Use two scores:

- **Absolute score:** how good is this answer on its own?
- **Comparative score:** is it better than the baseline answer for the same question?

Judge input must include:

- Original user question
- Baseline answer
- Candidate answer
- Visible sources/hits for both
- Rubric
- Protected-case notes for that question
- Retrieval-quality diagnostic for that question

Judge output must be strict JSON:

- `absolute_score`
- `comparative_score`
- `dimension_scores`
- `regressions`
- `hallucination_risks`
- `unsupported_certainty`
- `source_quality_notes`
- `follow_up_quality_notes`
- `retrieval_quality_notes`
- `verdict`: `accept | reject | needs_human_review`
- `rationale`

Every regression must cite concrete evidence from the candidate answer and the baseline answer.

Unsupported certainty means: stating an uncertain pricing, feature-availability, competitor, migration, timeline, or product-capability claim as fact when retrieved sources are absent, weak, ambiguous, or contradictory.

Before scoring 30 candidates, calibrate the judge on 3 manually reviewed examples:

- Strong baseline answer: Q05
- Weak/high-risk answer: Q06 or Q09
- Comparison answer: Q07

## Regression Gates

Protected cases:

- **Q05 ranking-layer interaction:** preserve technical depth, sequence clarity, and debugging usefulness.
- **Q06 pricing/features:** do not invent plan details or AI-feature availability.
- **Q07 competitor comparison:** do not invent Coveo/Constructor claims.
- **Q09 trial/DRR access:** do not overstate self-serve availability.
- **Q10 migration:** do not pretend migration is effortless.

Baseline strengths must be preserved:

- Q01 practical cost-control framing.
- Q02 integration architecture structure.
- Q03 semantic-vs-manual-synonym distinction.
- Q05 layered ranking explanation.
- Q08 marketer-vs-developer operational split.

Automatic reject if:

- Source grounding regresses.
- Answer skips the literal question.
- Answer asks discovery before answering.
- Answer invents pricing, feature availability, competitor claims, or timelines.
- Answer leaks tool/search process.
- Answer is materially less complete than baseline.
- Answer has more than one follow-up question.
- Answer becomes salesy without adding substance.

Candidate can win only if:

- Aggregate score improves by at least 10 points.
- No individual question regresses by more than 5 points.
- All protected cases pass.
- Human review approves top candidate.

## Retrieval Diagnostics

Before blaming or rewarding the prompt, classify retrieval quality for each question:

- `retrieval_good`: sources directly support the question.
- `retrieval_partial`: sources support part of the answer but leave gaps.
- `retrieval_weak`: sources are adjacent but not enough for a strong answer.
- `retrieval_missing`: sources do not support the requested answer.
- `question_ambiguous`: the user question itself needs clarification before a precise answer is possible.

Every low-scoring answer must be tagged with the likely root cause:

- prompt behavior
- retrieval weakness
- missing source content
- ambiguous user question
- tool/index wiring issue
- judge disagreement

If retrieval is weak/missing, candidate prompts may improve uncertainty handling and next-step framing, but must not invent unsupported detail.

## Mutation Strategy

Seed prompt: production Algolia.com prompt baseline.

Do not use the discovery draft as the seed in this sprint.

Candidate mutation families:

- `answer-structure`: answer first, then explain, then decision frame.
- `source-synthesis`: better use of retrieved sources and uncertainty.
- `technical-depth`: more concrete implementation detail.
- `commercial-framing`: buyer-relevant tradeoffs without fluff.
- `follow-up-quality`: sharper one-question endings.
- `uncertainty-handling`: better behavior when retrieval is incomplete.
- `tool-leak-cleanup`: remove "let me search / perfect / great" leakage.
- `protected-case-hardening`: targeted fixes for Q06/Q07/Q09.

Each candidate may use at most 1-2 mutation families.

Candidate IDs:

- `prompt-v000-prod-baseline`
- `candidate-001-answer-structure`
- `candidate-002-source-synthesis`
- `candidate-003-technical-depth`

Every candidate must include:

- Full compiled prompt
- Mutation rationale
- Selected mutation family/families
- Expected improvement
- Parent prompt
- Rollback prompt

## Experiment Loop

Implement separate scripts plus one orchestrating runner:

- `snapshot-agent`
- `patch-agent`
- `run-eval`
- `score-eval`
- `rollback-agent`
- `run-experiment`

First run a 5-candidate pilot to validate:

- Patch/readback
- Answer capture
- Judge scoring
- Rollback
- Artifact writing
- Run lock behavior
- Retrieval diagnostics

If the pilot is healthy, continue to 30 candidates.

For each candidate:

1. Acquire run lock.
2. Snapshot current agent.
3. Patch candidate prompt.
4. Read back agent instructions from Agent Studio.
5. Hard gate: readback must exactly match candidate prompt before evaluation.
6. Run the same 10 questions.
7. Capture answers, visible sources, suggestions, screenshots, and timings.
8. Run retrieval diagnostics.
9. Run deterministic gates.
10. Run LLM judge.
11. Assign verdict.
12. Keep if better than current best; otherwise rollback.
13. Log result to `experiment-ledger.jsonl`.
14. Release run lock only after final state is verified.

Stop early if:

- A candidate beats baseline by 15+ points and passes human review.
- 5 consecutive candidates materially regress.
- Patch/readback mismatch occurs.
- Rollback fails.
- Tool/index wiring changes mid-run.
- Cost/time budget is exceeded.

## Holdout Evaluation

The 10 known sample questions are the primary benchmark, but the winning prompt must also pass a holdout set before acceptance.

Holdout requirements:

- Create 10 unseen questions after the first benchmark winner is found.
- Holdout questions must cover the same commercial areas: pricing, integration, migration, comparison, AI features, search quality, merchandising, non-technical user operation, and scale.
- Do not use holdout questions during candidate generation.
- Run only top candidates and the final winner on holdout.
- A candidate cannot win if it beats the known benchmark but fails holdout on protected dimensions.

## Run Governance

Budget controls:

- Max 30 full candidates.
- Max 5 pilot candidates before continuing.
- Max 4 repeated runs only for baseline and final winner.
- Checkpoint after every candidate.
- Resume from latest completed candidate.

Cost/runtime/call logging per candidate:

- Agent answer calls
- Judge calls
- Retries
- Elapsed runtime
- Approximate token/cost estimate when available
- Failures and rollback events

Final handoff artifact:

- `winner/answer-quality-v1.md`
- `winner/score-delta.md`
- `winner/final-agent-snapshot.json`
- `winner/rollback.md`
- `winner/rejected-candidates-summary.md`
- `winner/known-weaknesses.md`
- `winner/next-sprint-discovery-layer.md`

Final deployment validation:

- Read back `www Chat – Orchestrator`.
- Confirm deployed instructions match winning prompt artifact.
- Run 10-question benchmark once.
- Run final winner 4 times for consistency.
- Run holdout set once.
- Record final composite score, holdout score, and consistency score.

## Assumptions

- This sprint optimizes answer quality only.
- Discovery and white-glove engagement are deferred until answer quality beats baseline.
- `www Chat – Orchestrator` is a safe experiment target in our app, not Algolia.com production.
- The production Algolia.com prompt is the seed because it is tied to measured baseline behavior.
- The existing discovery prompt remains reference material, not the mutation seed.
