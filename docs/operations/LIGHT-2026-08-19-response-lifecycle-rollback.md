# Response Lifecycle Rollback

## Classification

Light-path corrective rollback. This changes the existing chat response lifecycle but introduces no new API, schema, dependency, prompt, Agent Studio configuration, or trigger behavior.

## Authorized Scope

Restore the previously agreed response contract:

1. One orchestrator completion per user turn.
2. Stream the orchestrator answer visibly as it arrives.
3. Keep the completed answer visible.
4. Run confidence judging without blocking, replacing, or regenerating the answer.
5. Preserve sources and exactly one discovery question.

Do not modify prompts, Agent Studio agents, proactive journeys, tracking, compilation, controller, handoff, specialist routing, themes, or unrelated widget UI.

## Root Cause

Commit `52108e8` changed streaming callbacks to write an empty string and added an automatic grounded-rewrite completion after judge rejection. That made the judge part of the blocking render path and allowed judge failure to replace the answer with a generic fallback.

## Implementation

- Restore non-empty streamed text for primary and specialist responses.
- Remove the automatic grounded rewrite from the primary response path.
- Commit the original orchestrator answer regardless of judge availability.
- Retain the judge verdict as metadata only.
- Make late transport errors preserve the streamed answer without a blocking judge call.
- Replace regression tests that require blank streaming or a second completion.

## Rollback

Redeploy the current `main` bundle at commit `52108e8` if this targeted rollback causes a new regression. Do not revert the entire commit because it contains unrelated transition work.

## Verification

- Focused grounding-admission test proves one completion, visible streaming, persistent final answer, and non-destructive judge failure.
- Existing widget tests pass.
- Hosted Jahia readback matches the local artifact.
- Live browser shows progressive painting and no answer disappearance.
