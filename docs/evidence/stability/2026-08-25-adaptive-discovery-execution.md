# Adaptive Discovery Execution

Date: 2026-08-25
Campaign: `U2-AD1`
Target: Jahia development surface, `Algolia_Prod_Copy_Vanilla`
Verdict: **FAIL — discovery did not progress**

## Result

- Six of six turns reached a terminal state.
- Turns 1–2 asked usable discovery questions.
- Turn 3 repeated the already-confirmed data-flow slot.
- Turn 4 repeated confirmed architecture/data-flow slots and combined multiple slots.
- Turn 5 returned a truncated apparent success: `Since we have the architectural layout—Next.js,`
- The final Developer Specialist route and consent completed and used confirmed architecture facts.
- The profile never collected evaluation goal, scale, success criteria, or delivery constraints.

## Correct interpretation

The fixed corpus remains valid for mechanical pressure only. This adaptive campaign is the first
causal conversation test: each persona response answered the assistant's actual discovery question.
It proved the current system retains some facts but does not yet conduct progressive discovery.

## Harness correction

- Added `AdaptiveDiscoveryDataset.v1`.
- Added hidden persona state and dynamic follow-up responses.
- Added repeated-slot, multi-slot, forbidden-slot, profile-completeness, final-fact-use, specialist,
  and truncated-success oracles.
- Stability harness passes 70/70 tests.

Raw evidence remains private at
`/private/tmp/algolia-adaptive-discovery-u2ad1-20260825/adaptive-discovery/summary.json`.

## Prompt-only rectification result

The orchestrator was updated with a conversation-led discovery policy using full supplied history
and no custom profile code. Protected live readback passed, but four hosted qualification runs did
not pass:

- one immediate natural 429;
- two truncated apparent-success answers;
- repeated refinement of the already-known problem/use case;
- incomplete architecture, scale, and success-criteria collection;
- a final turn at 59.6 seconds.
- a final verification that stopped on Turn 2 after HTTP 200 produced an empty terminal-error response.

That Turn-2 failure was subsequently traced to an Agent Studio input-guardrail false positive, not
an empty transport response. The guardrail description was narrowed without disabling protection.
Readback passed; the same business input then completed normally, and a live prompt-injection
negative remained blocked. The post-fix six-turn run was mechanically clean but still failed
discovery progression because architecture and success criteria were not collected.

The latest deployed prompt remains **unqualified**. Full execution evidence is recorded in
`.development-loop/run-2026-08-24-001-reactive-stability-breakpoint/13-discovery-prompt-execution.md`.
