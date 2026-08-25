# Product and technical specification

## Objective

Ship Compare and primary token telemetry as two observers of the existing canonical chat
transport, without duplicated fetch wrappers, request mutation, or cross-feature failure.

## Transport contracts

### Prepared turn

Published immediately before the primary request and already implemented:

```text
{ body, turnKey, question }
```

Compare receives the exact serialized body sent to the primary endpoint and sends that same body
to the configured read-only Production endpoint.

### Completed turn

Published after every successful primary Agent Studio SSE response is fully consumed:

```text
{ turnKey, conversationId }
```

The transport owns response completion detection, guardrail detection, and logical-turn
correlation. A user turn can contain several billable completion calls because of tools or
retries, so every successfully consumed response is published. Observers cannot delay or alter
the primary response and deduplicate only identical conversation IDs.

## Telemetry browser behavior

- Subscribe to completed turns; never assign `window.fetch`.
- POST only `conversationId` to the Jahia action. The browser does not choose app or agent.
- Retry missing zero totals with bounded backoff.
- Deduplicate by conversation ID and recompute cumulative input, output, and total tokens.
- Render a supporting pill in the newest confidence-badge surface.
- Reset totals on the existing visitor-state reset event.
- Fail silently in the primary answer path while logging a bounded diagnostic warning.

## Jahia action behavior

- POST only and anonymous only where the Jahia surface requires it.
- App ID and agent ID come from trusted OSGi configuration, not request parameters.
- API key comes from OSGi Configuration Admin or environment only; never a packaged property.
- Validate the conversation ID with an allowlist and length bound.
- Enforce the configured Jahia Origin.
- Enforce a bounded server-side request rate.
- Call the fixed Algolia conversation-detail endpoint with time and response-size limits.
- Return only `{inputTokens, outputTokens, totalTokens}`.
- Map upstream failures to safe errors without returning upstream conversation JSON.

## Compare lock UX

The comparison choice remains fixed after the first turn to preserve full-conversation parity.
When locked, its accessible label and tooltip must say: “Start a new conversation to change
Compare.” Reset restores the selectable state.

## Acceptance criteria

1. No new global fetch patch exists.
2. Compare receives byte-identical prepared primary bodies.
3. Telemetry receives every successful primary model call and looks up each conversation ID once.
4. Primary rendering is unaffected by either observer failing.
5. The proxy cannot be used for another app, agent, or arbitrary upstream response retrieval.
6. Two-turn cumulative totals equal the sum of the two returned usage records.
7. Reset clears both Compare choice and telemetry totals.
8. Deployment readback proves exact reviewed hashes and script order.
