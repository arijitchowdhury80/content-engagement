# Strategy and intake

## Decision

Integrate the useful parts of PR #5 into current `main`; do not merge the donor branch as-is.
Enhance `handoff-to-orchestrator.js`, the existing sole transport owner, with a completed-turn
lifecycle subscriber. Keep the existing prepared-turn subscriber for Compare. Neither consumer
may patch `window.fetch`.

## User and job

The internal Content Engagement team needs to compare the concierge with Production Ask AI and
see cumulative token usage without changing, duplicating, or destabilizing the primary answer.

## Scope classification

Full path. The change crosses a public browser/backend boundary, reads privileged Agent Studio
conversation telemetry, and changes secret, CORS, and access-control behavior.

## In scope

- One finalized primary request packet published to Compare.
- One completed primary response event containing trusted agent and conversation identifiers.
- Cumulative token pill rendered after successful primary turns.
- Narrow Jahia proxy returning token totals only.
- Explain the Compare conversation lock instead of presenting an unexplained disabled control.
- Unit, contract, integration, deployment, and browser acceptance tests.

## Out of scope

- Modifying Production Ask AI.
- Counting Production comparison tokens.
- Replacing the chat widget or primary transport.
- Shipping a general conversation-inspection proxy.
- Deploying without a reviewed plan and explicit approval.

## Success metric

In a two-turn live Jahia session, Compare produces two independent Production answers from the
same prepared packets, and telemetry shows the exact cumulative primary input/output/total token
  counts, with no duplicated primary requests and one telemetry lookup per distinct successful
  Agent Studio conversation ID.

## Trade-off

Telemetry waits for the primary SSE stream to complete and may appear a few seconds later. That
is preferred to racing Agent Studio persistence or interfering with answer rendering.
