# Superseded: Compare-aware confidence policy

> Superseded on 2026-08-27. This file records a rejected design and must not be
> used as deployment guidance. Browser judging is mandatory, the confidence
> element has no `mode` attribute, and Compare has no judge authority.

## Decision

The saved Jahia block must contain exactly one `<algolia-chat-confidence>` element with no `mode` attribute.

Compare must never read or mutate the confidence element. Normal Algolia answers are judged independently of Compare; production comparison answers are not sent through the Algolia judge panel.

The prior conditional-mode policy is removed.

## Reason

The earlier policy attributed 429 responses to judge fan-out without isolating the actual request source. It created multiple judge-control authorities and intermittent availability. That diagnosis and mitigation were rejected.

## Runtime contract

- Development app: `0EXRPAXB56`.
- Primary agent: `www Chat - Orchestrator`.
- Retrieval index: `Algolia_Prod_Copy_Vanilla` only.
- Saved Jahia confidence element: no `mode` attribute.
- Browser judge lifecycle: mandatory and owned only by the chat judge runtime.
- Ordinary single-panel fan-out: one primary completion followed by the three-role judge panel.
- Compare has no access to judge state, configuration, or presentation.
- Offline semantic evaluation remains available independently of the browser judge panel.

Jahia and browser preflight fail if any confidence `mode` attribute exists or if any of the three role agents is absent.

## Deployment safety

All Jahia block writers call `judge_release_guard.py`. Candidate chat runtimes must preserve mandatory judging, parallel three-role dispatch, role-specific retry, and no shared panel deadline. The standalone confidence-mode deployer was deleted.

## Rollback

Rollback may restore only a release that passes the current judge release guard. A stale release containing a mode switch is not a permitted rollback target.
