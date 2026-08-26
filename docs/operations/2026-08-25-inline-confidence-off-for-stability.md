# Compare-aware confidence policy for stability

## Decision

The saved Jahia block remains fail-safe with exactly one `<algolia-chat-confidence mode="off">` element. At browser runtime, the Compare companion changes that mode to `algolia` for ordinary single-panel answers.

When Compare is enabled after an existing answer, that answer keeps its completed judge result. When a new dual-panel turn starts while Compare is already enabled, the companion changes confidence mode back to `off` for that turn so the browser does not launch the production request plus three judges beside the primary request.

The three judge agents, judge core, confidence UI, and offline semantic evaluation remain available. This policy changes only when browser judging runs.

## Reason

The earlier live configuration launched three browser-side Agent Studio judge completions after every orchestrator answer. One normal visitor answer therefore generated four same-application completion requests: one orchestrator request and three judge requests. The burst exhausted the observed development application envelope and contributed to 429 responses and stalled follow-up turns.

Compare adds a production completion. The browser must therefore distinguish an ordinary answer, an existing answer being compared after completion, and a new question sent while dual-panel Compare is already active.

## Runtime contract

- Development app: `0EXRPAXB56`.
- Primary agent: `www Chat - Orchestrator`.
- Retrieval index: `Algolia_Prod_Copy_Vanilla` only.
- Saved Jahia confidence mode: `off`.
- Browser confidence mode before an ordinary single-panel turn: `algolia`.
- Ordinary single-panel fan-out: one primary completion followed by the three-role judge panel.
- Dual-panel fan-out: one primary completion plus one production comparison; browser judges are suppressed for a new turn that begins while Compare is active.
- Offline semantic evaluation remains available independently of the browser judge panel.

The static Jahia preflight fails closed if the saved block is not Vanilla or its fail-safe confidence mode is not off. The browser identity preflight requires `algolia` after the Compare companion initializes the normal single-panel runtime.

## Deployment safety

`tools/deployment/deploy_judge_v2_jahia.py` continues to force the saved value to `mode="off"`, so a missing or failed companion script remains fail-safe. The immutable Compare asset owns the browser-time switch. `tools/deployment/deploy_jahia_confidence_mode.py` still changes only the saved confidence value and requires snapshot, dry run, exact EDIT/LIVE/public readback, and rollback evidence.

## Rollback

The private pre-change block is stored outside the repository in the approved evidence directory. Rollback restores the prior immutable Compare asset reference, returning browser judging to the saved `off` state without changing the underlying block contract.
