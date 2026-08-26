# Inline Confidence Disabled for Stability Qualification

## Decision

Inline confidence judging is disabled on the Jahia development surface. The live runtime must contain exactly one `<algolia-chat-confidence mode="off">` element.

The three judge agents, judge core, confidence UI, and explicit `mode="algolia"` test fixtures remain available for offline semantic evaluation. This decision changes runtime invocation only; it does not delete the evaluation system.

This note supersedes the runtime portion of `2026-08-24-judge-semantic-classification-release.md`, which required three parallel judge calls after each visitor answer.

## Reason

The previous live configuration launched three browser-side Agent Studio judge completions after every orchestrator answer. One normal visitor answer therefore generated four same-application completion requests: one orchestrator request and three judge requests. The burst exhausted the observed development application envelope and contributed to 429 responses and stalled follow-up turns.

## Runtime contract

- Development app: `0EXRPAXB56`.
- Primary agent: `www Chat - Orchestrator`.
- Retrieval index: `Algolia_Prod_Copy_Vanilla` only.
- Inline confidence mode: `off`.
- Normal browser completion fan-out: one primary completion per logical turn.
- Semantic scoring: offline evaluation lane, never part of the visitor answer lifecycle.

The stability preflight fails closed before sending a question if the index is not Vanilla or inline confidence is not off. Phase 0 also fails any turn that emits a non-primary browser completion.

## Deployment safety

`tools/deployment/deploy_judge_v2_jahia.py` now forces `mode="off"`, so a future judge-asset deployment cannot silently re-enable inline judging. `tools/deployment/deploy_jahia_confidence_mode.py` changes only the confidence mode value and requires snapshot, dry run, exact EDIT/LIVE/public readback, and rollback evidence.

## Rollback

The private pre-change block is stored outside the repository in the approved evidence directory. Re-enabling inline judging requires a separate explicit decision and a new reviewed deployment; it must not be done by restoring a stale block during ordinary stability work.
