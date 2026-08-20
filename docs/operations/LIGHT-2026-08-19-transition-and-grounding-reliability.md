# Transition And Grounding Reliability

## Scope

- Prevent a grounded streamed answer from being replaced after completion.
- Make every proactive journey qualify at 5 seconds dwell and 25% scroll.
- Require transition validation to prove the destination greeting is visibly rendered.

## Confirmed Root Causes

1. The grounding admission step can reject a complete answer after it has already streamed, replacing useful content with a generic fallback.
2. A 25% controller threshold cannot fire reliably unless the tracker emits a signal at 25%.
3. The hosted runner previously treated a stored `shown` opportunity as equivalent to a visible greeting, which can hide widget integration failures.
4. The hosted runner closed the source greeting before navigation, while manual UAT correctly leaves it unanswered for destination replacement.
5. The context compiler still enforced 10 seconds and 50% after the tracker and controller moved to 5 seconds and 25%, so collection could animate without producing an eligible transition.
6. The continuity verifier counted one follow-up request plus its response as two expected requests, falsely failing healthy 4-request/4-response traffic.

## Verification

- Focused runtime tests: 95/95 pass.
- Full chat-widget suite: 193/193 pass.
- Local natural-navigation transition suite: 4/4 pass.
- Headed Jahia transition acceptance: T2, B2, C1, and C2 all pass.
- Team UAT deck: 25/25 tests pass; live Jahia artifact hash matches the local standalone artifact.
- Agent Studio prompts and agent configuration were not changed.

## Prevention Heuristic

When a transition appears tracked but does not engage, verify the full contract in order: tracker emits the boundary event, compiler preserves a qualified source, controller selects the transition, the destination greeting is visibly rendered, and only then the opportunity is accepted as shown. Never accept storage state or request counts as a substitute for the visible user outcome.

## Safety

- Do not modify Agent Studio prompts or agent configuration.
- Preserve existing trigger identifiers and handoff contracts during the threshold change.
- Deploy only after unit, integration, and hosted Jahia validation pass.
- Roll back the runtime files to their pre-change snapshot if any single-page journey regresses.
