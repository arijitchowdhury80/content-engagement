# Judge Exact-Claim Contract

## Root Cause

The validator silently converted `supported` or `contradicted` judge claims without evidence passage IDs into `unverifiable` findings, while every finding inherited its complete sentence as the visible highlight span. A mechanical judge-output defect could therefore become a false semantic failure and paint unrelated surrounding clauses red.

## Approved Fix

- A supported or contradicted claim without valid evidence passage IDs is an invalid report and enters the existing judge retry path.
- Every semantic claim includes `claimText`, the smallest exact contiguous substring of its deterministic answer sentence.
- Code verifies `claimText`, resolves repeated occurrences from left to right, and computes offsets. The LLM never calculates offsets.
- Panel consensus requires the same exact character span, independent of each judge's claim numbering. Tiny overlaps cannot create a finding, and code never unions different spans into a broader highlight.
- A malformed `claims` field is an invalid report; it cannot silently become a non-factual assessment.
- A judge that fails the contract twice is excluded from aggregation. Invalid output is never converted into a grounding finding.
- Two valid judges produce a provisional panel; fewer than two leave evaluation unavailable.

## Validation

- Unit coverage proves missing proof IDs retry, paraphrased claim text fails, repeated text resolves deterministically, and exact claim offsets round-trip to the original answer.
- The new Agent Studio panel scored the normal sample question `9.7/10` with no grounding findings. One initially imprecise judge report retried and completed successfully.
- A deliberate mixed sentence highlighted only `it guarantees 999% ROI`; all three judges left the supported clause untouched.
- Jahia edit, live, public asset, load order, and three-agent readback passed.

## Deployment Reliability

The first Jahia cutover exposed an eventual-consistency race between immutable file creation and parent-node publication. The deployer now waits for exact EDIT readback after creation, records each asset mutation incrementally, and always reads actual Jahia state through rollback after a mutation-stage exception. The bounded interrupted cutover was recovered through the existing exact-state recovery path. A preserve-live-companions mode prevents unrelated local chat or badge changes from entering a core-only judge release.

## Rollback

Restore the private Agent Studio and Jahia rollback manifests generated for the deployment, then restore the previous IDs and protected hashes in `config/judge-final-lock.json`.

## Prevention Heuristic

Never turn malformed judge output into semantic evidence. Validate, retry, or exclude it; derive all offsets and arithmetic in code from exact verified inputs.
