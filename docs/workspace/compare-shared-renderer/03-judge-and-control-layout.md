# Compare control and judge availability

## Intake and scope

Classification: Full path. Moving one control is visual, but restoring judges changes live Agent Studio request fan-out and therefore touches an external runtime/capacity boundary.

The verified defect is not a Compare rendering collision. The Jahia block had `algolia-chat-confidence mode="off"` before and after the Compare deployment. That mode causes the native chat renderer to skip `QE`, so no judge request or judge pill can appear even when Compare is off. The mode was introduced on 2026-08-25 to prevent three parallel judge calls from causing 429s and stalled turns.

## Design thinking

- Mental model: Compare, Sources, and Judge are evidence actions attached to an answer, not global application settings.
- Information hierarchy: answer is primary; Sources, Judge, and Compare are supporting evidence controls.
- Happy path: ask normally, receive the concierge answer and judge status, then optionally compare the same finalized request with production.
- Empty/loading/error: before an answer there is no Compare control because there is nothing to compare. After an answer it appears in that answer's evidence footer. Production loading/error remains isolated in the production panel.
- Cognitive load: one Compare control only. It changes location; it is never duplicated.
- Emotional goal: confidence that evidence, evaluation, and comparison remain available together.
- Pre-mortem: a brittle footer selector could strand or duplicate the control; a global judge re-enable could reproduce 429s; changing judge mode after an answer could erase its visible judge result.

## Architecture and policy

1. Keep the application header free of answer actions and telemetry.
2. Show the single Compare button only in the latest answer footer beside Sources and Judge.
3. Show current-response input/output telemetry in that same footer; never show cumulative totals in the header.
4. Default the browser judge mode to `algolia` while Compare is off.
5. Turning Compare on after a completed answer does not remove or cancel that answer's judge.
6. If a later question is sent while Compare is already on, switch judge mode off for that new turn before its answer completes. This avoids adding three judge completions to the simultaneous production comparison.
7. Turning Compare off or resetting restores judge mode to `algolia`.

## Risk and rollback

- No new credentials, endpoints, HTML injection, or storage.
- The known capacity risk is constrained to normal non-Compare turns; Compare turns do not add the three-judge fan-out.
- Rollback: restore the previous immutable Compare asset reference. The Jahia block remains statically fail-safe at `mode="off"`.
