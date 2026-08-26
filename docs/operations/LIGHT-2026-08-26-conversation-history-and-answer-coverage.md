# Light change: complete conversation history and answer coverage

Date: 2026-08-26

## Classification

Light path. The change does not add a dependency or alter the Agent Studio API schema. It changes
the content sent through the existing conversation request and refactors the existing orchestrator
prompts. Primary risks are prompt regression, increased request size, and accidental changes to
discovery, specialist, judge, or grounding contracts.

## Root causes

1. The shared browser history builder truncates every successful assistant message to 240
   characters before the next completion request.
2. Retrieval adequacy is defined mainly as matching the evidence *type*, so a result set can be
   topically relevant while omitting material parts of the requested answer.
3. Grounding, discovery, specialist routing, response choreography, and privacy rules are repeated
   across the system prompt and instructions. Some repetitions use different wording, including
   `complete answer` versus `concise answer before specialist`, which weakens priority.

## Plan

1. Add a browser regression proving that turn two receives the complete successful turn-one answer.
2. Remove the history clipping function from the shared history generator.
3. Make the system prompt the short authority/priority contract and keep detailed execution policy
   in instructions.
4. Add a bounded answer-coverage check: identify the material dimensions implied by the literal
   question, search again only for a material unsupported dimension, and state any remaining gap.
5. Preserve judge prompts and runtime unchanged; validate their contracts explicitly.
6. Run focused browser, routing, discovery, grounding, prompt, deployment, and full widget tests.
7. Snapshot and dry-run the Agent Studio prompt mutation. Apply only the reviewed packet, read it
   back exactly, then run a live multi-turn smoke.

## Rollback

- Browser: restore the previous `algolia-chat.js` artifact and Jahia asset snapshot.
- Agent Studio: restore `instructions` and `systemPrompt` from the private before-snapshot through
  the same apply-and-readback path.
- Do not change the `Algolia_Prod_Copy_Vanilla` index, tools, model, provider, guardrail, judges, or
  specialist configuration in this operation.

## Acceptance

- The exact complete prior assistant answer is present in the next completion request.
- No synthetic fixed character limit remains in the conversation-history generator.
- Coverage rules do not require a fixed number of searches and never permit unsupported invention.
- Discovery cardinality/readiness, specialist additivity, grounding, and judge observation remain
  unchanged.
- Local test suites and exact live readbacks pass.

## Implementation result

- Removed the shared 240-character assistant-history clipping function. Every successful prior
  assistant answer is now sent losslessly on the next turn.
- Added a browser regression that fails on the old 240-character behavior and proves byte-for-byte
  prior-answer continuity on turn two.
- Consolidated the orchestrator prompt into a short system-level priority/invariant contract and one
  detailed instructions owner. Combined prompt size changed from 41,391 to 33,850 characters
  (7,541 fewer; 18.2% reduction).
- Replaced evidence-type-only adequacy with a bounded answer-coverage check. It maps the material
  dimensions implied by the literal question, searches again only for a distinct unsupported gap,
  and states any gap that retrieval cannot close.
- Did not change judge prompts, judge agents, scoring, grounding, specialist keys, tools, model,
  provider, search index, or Agent Studio configuration.
- Corrected the stability harness so the three designed judge calls are classified as judge fan-out
  rather than unknown background work. Primary, judge, specialist, and unknown completions are now
  reported separately.
- Corrected adaptive-persona matching so a strong scale cue such as "how many products" outranks
  incidental context words such as "PIM" and "ERP."

## Deployment and readback

- Agent Studio target: app `0EXRPAXB56`, agent `e2c8596a-4420-41d2-80bb-5cd4aaeffda6`,
  `www Chat – Orchestrator`.
- Final instructions hash: `f56aca6274942701fda566d00140f9c68dbeb11192ba0f80a66315724152cbb7`.
- Final system-prompt hash: `e10861b4917da3e72434b7005376c9ed948d46edd40d284376cd1fe2cfad588f`.
- Exact readback passed; tools, config, provider, model, and published status remained unchanged.
- Jahia immutable chat asset: `algolia-chat-stability-a69c5d823a3d.js`, SHA-256
  `a69c5d823a3def1dd75c8974efa670604034737cecef05ce478b0a561880977b`.
- EDIT, LIVE, public page reference, and public asset bytes all passed exact readback.
- Runtime preflight passed with `Algolia_Prod_Copy_Vanilla` in Jahia and the browser.

## Verification

- Chat widget: 335/335 passed.
- Stability harness: 72/72 passed.
- Judge/refactor: 75/75 passed.
- Comparison integration: 12/12 passed.
- Deployment Python suites: 46/46 passed.
- Team UAT contracts: 25/25 passed.
- Root-cause sweep found no remaining 240-character assistant-history truncation and no former
  concise-answer/evidence-type-only prompt conflicts.

## Live qualification outcome

- Mechanical execution survived the final six-turn adaptive run: 6/6 turns terminated, one primary
  completion per turn, zero retries, zero unknown fan-out, and the requested specialist handoff
  completed through consent.
- Full prior-answer continuity is proven by the browser regression and the deployed artifact
  readback. The live responses were well beyond 240 characters on consecutive turns.
- Discovery is **not certified**. Across fresh runs, the prompt sometimes followed
  problem → architecture → scale, but another run repeated the already-confirmed problem/use-case
  slot. Prompt-only reconstruction from free-form history remains nondeterministic.
- One earlier run produced a truncated successful response; the next two complete runs did not.
  Treat this as an open intermittent stability defect, not as disproven.

## Remaining risks

- Lossless history increases request size with conversation length. L30/L50 and soak testing must
  measure latency and context growth; any future compaction must be explicit, server-owned, and
  tested rather than silent character clipping.
- Prompt consolidation reduces conflict and context overhead but cannot provide deterministic slot
  state. Without a server-side/native structured state mechanism, discovery remains probabilistic.
- The larger custom prompt is still about 5.1× Production's custom instructions because it owns
  additional discovery, proactive handoff, grounding, coverage, specialist, and formatting policy.
  Cached prefixes reduce repeated input cost, but prompt edits invalidate cache and larger uncached
  contexts can increase latency and instruction dilution.
