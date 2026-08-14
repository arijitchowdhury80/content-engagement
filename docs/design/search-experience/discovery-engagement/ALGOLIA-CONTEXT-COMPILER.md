# Algolia Context Compiler

## Purpose

`algolia-context-compiler.js` turns the browser tracker state into safe, compact context for the Agent Studio agent.

The engagement tracker records what happened. The context compiler explains what that means well enough for the agent to personalize a reactive answer without exposing raw telemetry or pretending an inference is a fact.

## Inputs

- `localStorage.algolia_profile`
  - Long-lived visitor profile.
  - Holds confirmed demo persona when selected.
- `sessionStorage.algolia_session`
  - Current browser-session journey.
  - Holds page visits, dwell, scroll depth, and prior concierge messages.
- `sessionStorage.algolia_events`
  - Bounded event stream.
  - Holds observed events such as page views, navigation clicks, site search, CTA clicks, scroll milestones, dwell milestones, and chat events.

## Outputs

The compiler creates two outputs.

1. Rich internal packet: `AlgoliaContextPacket.v1`
   - Used for local debugging and future browser policy.
   - Includes current page, recent events, observed signals, soft inferences, and prior engagement history.
2. Flat Agent Studio turn context: `AlgoliaTurnContext.v1`
   - Attached to the latest user message as `metadata.turnContext`.
   - String-only, max 32 keys, max 4 KB total, max 1 KB per value.

## State Rules

- `confirmed` means the visitor explicitly selected or provided it.
- `observed` means the browser recorded it directly.
- `inferred` means the compiler guessed from behavior and must be phrased softly by the agent.

The compiler never upgrades `inferred` to `confirmed`.

## Transport

The compiler installs a narrow `fetch` interceptor for Agent Studio completion requests:

`/agent-studio/1/agents/{agentId}/completions?compatibilityMode=ai-sdk-5`

For matching POST bodies, it attaches the compiled `turnContext` to the latest user message:

```json
{
  "messages": [
    {
      "role": "user",
      "parts": [{ "type": "text", "text": "..." }],
      "metadata": {
        "turnContext": {
          "persona": "confirmed:developer",
          "current_topic": "observed:ai_search",
          "intent": "inferred:ai_recommendations_evaluation:0.72"
        }
      }
    }
  ]
}
```

Non-Agent Studio requests are passed through unchanged.

## Debug

In the browser console:

```js
window.algoliaContextCompiler.debug()
```

Returns:

- raw tracker snapshot
- rich compiled packet
- flat `turnContext`

## Files

- Runtime: `frontend/chat-widget/algolia-context-compiler.js`
- Tests: `frontend/chat-widget/tests/algolia-context-compiler.test.mjs`
- Deployment: `tools/deployment/deploy_jahia_engagement_tracker.py`
