# Judge Semantic Classification Release

## Scope

Repair false red grounding highlights caused by rhetorical text being returned as an unverifiable factual claim. The approved change is limited to the shared judge prompt, judge report validation, sentence-boundary handling, immutable judge agents, and the atomic Jahia judge runtime release.

## Root Cause

The judges could explain that a sentence was rhetorical while still placing it in the `claims` array. The runtime then inferred factuality only from `claims.length`, so two internally contradictory reports could create a false consensus highlight. `Intl.Segmenter` also split some abbreviations such as `vs.` into separate answer units.

## Change

- Require every answer unit to be classified as `factual`, `mixed`, or `non_factual`.
- Require exact non-factual spans and permit claims only for factual portions.
- Treat exact non-factual spans as authoritative, discard overlapping claims, and derive the final unit label mechanically.
- Recover an omitted span array from an explicit whole-unit `non_factual` decision without guessing meaning.
- Merge sentence segments split after common non-terminal abbreviations.
- Keep all three judge calls parallel; add no model call and no retrieval call.

## Validation

- Focused unit and prompt-contract tests.
- Complete judge refactor tests.
- Agent Studio dry-run, immutable creation, publication, and exact readback.
- Jahia dry-run, atomic asset/agent-ID switch, public hash readback, and live browser reproduction.

The final live reproduction returned all three role reports. No rhetorical claim reached any role's unresolved findings, and the only consensus highlight was a concrete unsupported 15% conversion-increase claim.

## Rollback

Use the Agent Studio rollback manifest to remove only agents created by this release. Use the Jahia rollback manifest to restore the prior complete block and runtime asset set.
