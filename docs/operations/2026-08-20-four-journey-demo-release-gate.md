# Four-Journey Demo Release Gate

## Scope

Today's demo prioritizes three representative use cases:

1. On-page intent recognition: a Product page or Solution page after 5 seconds dwell and 25% scroll.
2. Business proof progression: Grocery solution to the H-E-B customer case study.
3. Commercial evaluation progression: Enterprise Search solution to Pricing.

Product-only and Solution-only are two examples of the same on-page capability. Grocery to H-E-B is the canonical proof demo, and Enterprise Search to Pricing is the canonical commercial demo. Product to Pricing remains supported but is not the primary live commercial story.

These are showcase paths through a broader category-driven journey graph, not hard-coded limits. Other real Product, Solution, Customer Story, and Pricing paths may qualify when their page categories and immediate navigation edges match the trigger grammar.

Fashion to TAG Heuer is not a canonical demo path because the Fashion page does not expose that direct customer-story link.

## Reset Contract

Clicking the Algolia Assistant logo creates one new demo journey. It clears Algolia-owned state on the current origin, creates one fresh visitor/session/page trail, clears the previous conversation and handoff context, cancels any greeting request started before reset, and emits one `AlgoliaVisitorResetReceipt.v1` receipt.

Unrelated website storage, cookies, browser cache, and data belonging to other origins are outside this reset contract.

## Root Cause

One logo click could previously reach two tracker reset paths: the tracker capture handler and the chat widget reset request. The second reset could replace the fresh session created by the first. The proactive controller also retained in-memory conversation state and could render a greeting response that began before reset.

## Acceptance

- Singleton identifiers are `product_page_5s_25_scroll` and `solution_page_5s_25_scroll`.
- One logo click produces one reset receipt and one fresh visitor/session identity.
- Previous conversation, proactive state, pending greeting, and handoff context are absent.
- A pre-reset greeting response cannot render after reset.
- Each showcase journey passes from a fresh reset without relying on an earlier test.
- No Agent Studio mutation, handoff change, judge change, or chat rendering change is part of this gate.

## Deployed Release

- Jahia release marker: `20260820-navigation-edge-a`
- Scope: engagement tracker, context compiler, proactive controller, and the custom-block references for those three files only.
- EDIT and LIVE readback match the local source byte-for-byte.
- Focused validation passed: 105 runtime tests and 24 deployment tests.

## Rollback

Restore the previous tracker, compiler, and controller revisions and redeploy only those runtime files. No Jahia deployment occurs without explicit approval after local validation.
