# Assistant Logo Visitor Reset

## Classification

Light path. This is an opt-in widget behavior and a narrow Jahia markup/asset deployment. It does not change the visitor data contracts, Agent Studio prompts, or journey trigger rules.

## Required behavior

- Clicking the Algolia Assistant logo resets the visible chat conversation.
- The logo visibly rotates once through 360 degrees.
- Only project-owned visitor state is reset: `algolia_profile`, `algolia_session`, `algolia_events`, `algolia_token`, `algolia_proactive_state`, `algolia_pending_greeting`, and `algolia_proactive_debug_log`.
- Unrelated Jahia and website storage remains untouched.
- A fresh profile, session, page view, and events envelope are created immediately.
- The behavior is enabled on local parity and the Jahia test surface.

## Plan

1. Regression-test the tracker reset boundary and logo animation.
2. Regression-test that the Jahia HTML transform adds the opt-in attribute idempotently.
3. Add a narrow deployment mode that updates only the tracker and Jahia block HTML.
4. Run widget tests, local parity validation, and a browser-level reset scenario.
5. Deploy only after local verification, then validate the live DOM and browser storage behavior.

## Rollback

Restore the pre-deployment Jahia block HTML and prior `algolia-engagement-tracker.js` content captured in the deployment evidence directory, then publish those two nodes.
