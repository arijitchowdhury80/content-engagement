# Assistant Second-Turn Reliability Forensic

Date: 2026-08-21

Status: **NO-GO for an external demo until the release gates below pass.**

## Incident

A first visitor question completed successfully. The visitor then clicked the displayed discovery
question. The widget submitted that discovery question as a new user message and displayed:

> Couldn't reach the Assistant agent. This is a service error, not an answer.

The first answer remaining visible proves that initial rendering and the first orchestrator turn
worked. The failure is in the subsequent-turn path or one of its upstream dependencies.

## Executive Finding

This is not one isolated answer-quality defect. The current system has no single, reproducible
release identity and does not preserve enough failure information to diagnose an intermittent
completion error from the UI. Retries and tests can also conceal duplicate upstream work.

The screenshot proves the visitor-facing failure. It does **not** reveal its HTTP status, request
ID, stream error, timeout, guardrail outcome, or retry history because the widget collapses all of
those conditions into one generic message. Claiming one exact upstream cause from that screenshot
would be speculation.

## Confirmed Findings

### P0: Jahia, local `main`, and GitHub `main` are different runtimes

- Jahia live `algolia-chat.js` hash: `cb4a6027...`
- Local worktree hash: `c4e7b6b...`
- Local `HEAD`: `2a1f9cc`
- `origin/main`: `76f3a0b`
- The Jahia bundle matches commit `20e22aa`, which belongs to
  `codex/chat-architecture-reconciliation-2026-08-20-001`.

The tracker, compiler, controller, engage, and handoff files matched the inspected local copies;
the main chat bundle did not. Therefore a local or GitHub test does not currently prove the code
that a visitor receives from Jahia.

### P0: The failure UI destroys diagnostic evidence

`frontend/chat-widget/algolia-chat.js` renders the same generic error for distinct failure classes.
The visitor and operator cannot distinguish:

- network or CORS failure;
- HTTP 4xx, 429, or 5xx;
- a missing response body;
- an SSE error or malformed stream;
- an empty completion;
- a guardrail rejection;
- a retry failure.

No visitor-turn ID, attempt ID, HTTP status, Algolia request ID, elapsed time, stream finish reason,
or retry reason is surfaced in the debug record.

### P0: Main Agent Studio requests have no completion deadline

The primary completion transport calls `fetch` without an `AbortController` or a bounded request
deadline. Tool calls have a timeout and judge requests have cancellation support, but the main
orchestrator completion does not. A stalled connection can therefore leave the experience waiting
without a deterministic terminal state.

### P0: Retry policy is broad and can multiply one visitor turn

`__arrieRetryableCompletionError` treats every error with no parsed HTTP status as retryable. That
includes fetch, CORS, stream, and decode failures. `__arrieCompletionStep` also retries an empty
completion. The orchestrator can execute up to four completion steps, so one visitor turn can
produce as many as eight upstream completion POSTs.

There is no proof that a failed attempt produced no stream bytes or tool side effects before the
retry. This makes the retry non-idempotent.

### P1: Tests normalize duplicate upstream requests

- `specialist-followup-cardinality.test.mjs` explicitly requires transient/empty retries.
- `hosted-journey-capture.test.mjs` accepts two orchestrator requests as one logical visitor turn.

The test suite can therefore report a logical pass while the service received duplicate work.
The current evidence does not include a repeated, live, clicked-discovery soak gate.

### P1: The primary runtime is maintained as a monolithic bundle

`frontend/chat-widget/algolia-chat.js` is a roughly 514 KB bundled file, and the directory README
identifies that bundle itself as the editable chat custom element. There is no corresponding
project-owned source tree and deterministic build step in this repository for the main widget.
Transport, orchestration, rendering, discovery, specialist, grounding, and judge behavior are
therefore patched and tested through one generated artifact. This dramatically increases change
collision, regression, review, and rollback risk.

### P1: Discovery-card click semantics are inverted

The assistant asks, “Would you like to go deeper...?” and clicking it sends that same assistant
question back as the user's message. That is not a user intent; it is the assistant's own question
echoed back to it. A controlled live run returned HTTP 200 for this follow-up but included an Agent
Studio `data-guardrail-violation` event. This does not prove that guardrails caused the reported red
error, but it proves that the current click contract can enter a guardrail path.

The card should display consultant language while submitting a clear user intent, such as
“Go deeper on implementation,” with a stable intent identifier.

### P1: Successful operation is already slow and fans out

In one controlled live reproduction:

- first orchestrator turn: HTTP 200, about 23.1 seconds;
- clicked follow-up turn: HTTP 200, about 2.5 seconds, with a guardrail-violation event;
- three judge requests were then launched concurrently after each answer.

This run proves that the flow can succeed. It does not disprove the user's intermittent failure.
The 23-second successful first turn is itself too close to a poor demo experience.

### P1: Another live fetch boundary is failing independently

The live console also produced `TypeError: Failed to fetch` from the context compiler/current-user
path. That error is not proven to be the cause of this second-turn incident, but it confirms that
more than one browser-to-service boundary is brittle.

### P1: Fresh-browser startup is not deterministic in the current harness

An isolated fresh browser check loaded the chat element and composer. Repeated fresh-context runs
immediately afterward did not make the composer ready within 30 seconds. This requires targeted
startup instrumentation before it can be attributed to the page, environment, or harness.

## What Is Not Yet Proven

- The exact upstream cause of the screenshot's failed second turn.
- That payload size caused this incident; the controlled follow-up payload was small.
- That judge availability caused this incident.
- That Agent Studio is generally unavailable; the same flow succeeded in a controlled run.
- That navigation or proactive-trigger logic caused this incident; the failure occurred after a
  conversation was already active.

## Root-Cause Remediation Order

1. **Establish one release identity.** Select one approved commit, build or preserve its exact
   artifact, and require Jahia readback hashes to match it before testing.
2. **Add turn-level observability.** Record a visitor-safe turn ID and per-attempt ID, endpoint/agent,
   status, request ID, elapsed time, bytes received, SSE terminal event, guardrail result, retry
   decision, and normalized failure category.
3. **Make completion transport bounded.** Add cancellation and a defined timeout. Preserve the prior
   successful answer and allow retry of the same logical turn.
4. **Constrain retries.** Never interpret an unknown error as retryable. Permit at most one retry,
   only for explicit pre-stream 408/429/5xx conditions, and honor `Retry-After`. Never retry after
   bytes or tool side effects.
5. **Correct discovery actions.** Separate display copy from submitted user intent. Keep one action
   per answer and use stable intent metadata.
6. **Replace permissive tests with release gates.** Duplicate requests must fail cardinality tests
   unless they satisfy the explicit safe-retry contract.
7. **Restore a maintainable source boundary.** Move owned widget logic into reviewable source
   modules and generate the deployable bundle reproducibly. Do this after the incident is stabilized,
   not as part of the emergency repair.

## Required Release Gates

- Jahia bundle hash equals the approved commit artifact.
- Twenty fresh-browser runs of: first question -> answer -> click discovery -> second answer.
- Zero generic service errors.
- Exactly one orchestrator request per logical turn, except a deliberately injected, proven-safe
  retry case.
- Every injected 403, 408, 429, 5xx, network failure, empty 200, SSE error, partial stream, timeout,
  and guardrail event lands in the correct diagnostic category.
- Prior successful content remains visible after a failed follow-up.
- Retry succeeds without duplicating messages, tool calls, or conversation history.
- Agreed p95 latency targets pass for first and subsequent turns.

Until these gates pass against the exact Jahia artifact, the system should be treated as a prototype
and not presented as a reliable end-to-end experience.
