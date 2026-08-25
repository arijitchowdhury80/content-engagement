# Test plan and validation risk surface

## Scenario inventory

### Transport unit and contract

- Successful SSE completion publishes one completed turn with the response conversation ID.
- HTTP failure, missing header, abort, stream failure, and guardrail publish none.
- Multiple successful tool/retry calls for one logical turn are all published with correlation.
- An identical conversation ID is looked up once by telemetry.
- Observer failure never rejects or changes the primary response.
- Prepared-turn body remains byte-identical to the primary request body.

### Telemetry browser unit

- Does not patch or replace `window.fetch`.
- One lookup per completed conversation; duplicate event is ignored.
- Zero/missing totals retry with bounded backoff.
- Two distinct conversations produce correct cumulative totals.
- Reset clears state and pill.
- Proxy failure leaves the answer intact and exposes an unavailable supporting state.

### Jahia action unit and contract

- POST with a valid conversation ID calls the fixed configured app and agent.
- Missing, malformed, and oversized IDs return 400 without upstream access.
- GET is rejected.
- Missing secret returns 503.
- Wrong Origin is rejected.
- Requests above the server-side window are rate limited.
- One client exhausting its bounded per-client window does not consume another client's window;
  a separate global ceiling remains in place and tracked-client memory is bounded.
- Upstream 403/404/429/5xx, timeout, malformed JSON, and oversized JSON return safe errors.
- Successful upstream JSON returns only numeric input/output/total values.
- Upstream messages, tool calls, questions, and answers never enter the response.

### Deployment and browser

- Dry run adds one hashed telemetry script after the canonical transport and changes nothing else.
- Apply refuses every frontend mutation until the installed backend, runtime secret, and upstream
  lookup pass a live token-only smoke request.
- Drift between plan and apply aborts.
- Live two-turn Compare and telemetry succeed; collapse/reopen and reset succeed.
- Production and telemetry failures remain isolated from the concierge.
- Script inventory contains one context compiler, one transport, one Compare observer, and one
  telemetry observer.

## Validation risk surface

| Layer | Proves | Does not prove |
|---|---|---|
| Static/source checks | No duplicate global fetch patch; syntax and contracts | Live Agent Studio behavior |
| Unit tests | Correlation, dedupe, retry, redaction, errors | Jahia routing and real SSE |
| Contract/integration tests | Browser/proxy schema and fixed target | Final deployed script order |
| Headed Jahia E2E | Streaming, rendering, totals, isolation, reset | Future upstream API changes |

Remaining risk: Agent Studio may change conversation-detail persistence timing or response fields;
the bounded unavailable state must therefore remain non-fatal.
