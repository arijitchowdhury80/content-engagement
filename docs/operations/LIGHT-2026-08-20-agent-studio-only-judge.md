# Agent Studio-Only Judge Transport (Superseded)

This light-path correction is superseded by `docs/operations/2026-08-20-judge-v2-refactor.md`. Judge v2 removes the Chief/single-agent path and invokes exactly three Agent Studio role judges directly.

## Classification

Light-path corrective removal. This narrows the existing judge transport to its intended Agent Studio architecture and introduces no new external service, dependency, schema, or prompt.

## Root Cause

The chat bundle retained a legacy hosted HTTP judge transport and silently selected it whenever the Agent Studio mode configuration was missing or malformed, allowing a widget regression to route deployed traffic to a localhost default.

## Authorized Scope

- Remove the hosted HTTP judge client and localhost default.
- Remove `judge-url`, `judge-api-key`, `VITE_JUDGE_URL`, and `VITE_JUDGE_API_KEY` support.
- Make Agent Studio the only enabled judge transport; retain explicit `off` mode.
- Forward exactly three configured role-agent IDs.
- Remove UI copy that suggests running or configuring a local judge.
- Add regression coverage that rejects every removed transport marker.

## Verification

- The active widget and confidence badge contain no localhost, `/api/judge`, hosted-judge, or removed configuration markers.
- The v2 judge configuration reaches all three Agent Studio role judges directly and asynchronously.
- Focused judge tests and the complete chat-widget suite pass.
- Before deployment, create a fresh snapshot and use a new immutable chat version.
- After deployment, verify the published SHA and observe skeptic, referee, and advocate Agent Studio requests in a browser trace.

## Rollback

Restore the immediately preceding Jahia file snapshot. Do not restore the removed hosted transport; if Agent Studio judging fails, surface an Agent Studio configuration or transport error while preserving the answer.

## Prevention Heuristic

Judge shows offline -> inspect transport selection first -> prohibit implicit transport fallback -> test the actual Agent Studio request route and published hash, not only asset existence.
