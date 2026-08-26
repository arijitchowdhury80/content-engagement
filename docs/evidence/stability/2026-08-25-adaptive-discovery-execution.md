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
