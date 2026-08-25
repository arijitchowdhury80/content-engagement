# Assumptions and experiments

| Assumption | Confidence | Impact if wrong | Action |
|---|---:|---|---|
| The primary completion exposes `X-Conversation-Id` to the browser | Medium | Telemetry cannot identify the completed turn | Contract test and headed live test before deployment |
| Conversation totals persist shortly after SSE completion | Medium | Pill is missing or stale | Bounded retry test; live two-turn verification |
| The current request body is the canonical packet for Compare | High | Comparison is not apples-to-apples | Existing prepared-turn tests plus body-equality regression |
| Jahia can hold a logs-scoped API key outside Git | Medium | Proxy cannot safely call conversation detail | Configuration readback before deployment |
| A disabled Compare control without explanation is confusing | High | Users conclude the feature is broken | Replace its label/title with a recovery instruction |

## Highest-risk experiments

1. Verify the completed-turn event emits once with the real response header after successful SSE
   completion and never on guardrail, abort, retry duplication, or failed HTTP response.
2. Verify the Jahia action returns only numeric totals for the configured app and agent.
3. Verify current script order produces exactly one primary request, one optional Production
   request, and one telemetry lookup per successful logical turn.
