# Compare control and judge availability

## Intake and scope

Classification: Full path. Moving one control is visual, but restoring judges changes live Agent Studio request fan-out and therefore touches an external runtime/capacity boundary.

The verified defect was competing ownership. Jahia could save the judge as off, while Compare changed that global state at runtime based on attachment and turn timing. Separate evidence, capacity, validation, and shared-deadline branches could also make individual evaluations unavailable.

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
4. Compare never reads or mutates judge state.
5. Turning Compare on or off cannot remove, cancel, enable, or disable judging.
6. The Algolia answer follows the normal mandatory judge lifecycle.
7. The production comparison answer remains outside the Algolia judge panel.

## Risk and rollback

- No new credentials, endpoints, HTML injection, or storage.
- Judge capacity and role failures are handled inside the judge runtime, not through Compare.
- Rollback must pass the current release guard and cannot restore a confidence mode switch.
