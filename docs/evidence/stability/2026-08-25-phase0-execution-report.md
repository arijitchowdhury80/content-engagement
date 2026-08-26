# Reactive Stability Phase 0 — Execution Report

Date: 2026-08-25
Target: `https://tmp-content-eng-algolia.cloud.jahia.com/`
Verdict: **PASS — 20/20 fresh-browser journeys and 40/40 turns**

## Claim boundary

This run establishes repeated two-turn mechanical stability on the Jahia development surface and
reconciles every journey to its persisted Agent Studio conversation. It does not establish semantic
quality, accumulated-state stability, proactive-flow readiness, concurrent-user capacity, soak
stability, or production capacity. Production Ask Algolia was not mutated or exercised.

## Frozen identity

- App: `0EXRPAXB56`.
- Agent: `www Chat - Orchestrator`.
- Index: `Algolia_Prod_Copy_Vanilla`.
- Inline confidence: `off` in EDIT, LIVE, public HTML, and browser DOM.
- Chat asset: `algolia-chat-stability-78bacc881254.js`.
- Asset SHA-256: `78bacc881254148f45a2966a622fffe7ef3a1f3a3eb2a50637c8d46ac5a529db`.
- Production endpoint deny rule: active.

## Corrected diagnosis of the earlier stopped run

The earlier run was not an Agent Studio stall. The second turn had rendered a complete answer and a
visible specialist-consent choice. Agent Studio correctly paused on the client-side
`ask_specialist` tool while waiting for the visitor to select **Yes, go deeper** or **No thanks**.

The original runner watched only persisted terminal session state. The widget intentionally does not
persist incomplete streamed answer text while consent is pending, so the runner mislabeled a live,
interactive state as a blank unbounded response.

Root cause: **the Phase 0 oracle treated terminal session storage as the only valid completion state
and did not model the client-side specialist-consent branch.**

The correction:

1. Detects visible specialist consent.
2. Records the selected branch.
3. Deterministically declines specialist depth in this repeated reactive smoke campaign.
4. Waits for the orchestrator continuation to reach a real terminal state.
5. Separates distinct completion steps from retries by hashing request bodies.
6. Counts every physical completion POST without calling a client-tool continuation a retry.

## Authoritative Phase 0 result

| Measure | Result |
|---|---:|
| Fresh browser contexts | 20 |
| Two-turn journeys passed | 20/20 |
| Mechanical turns passed | 40/40 |
| Physical orchestrator completion POSTs | 46 |
| Distinct completion steps | 46 |
| Actual retries | 0 |
| Background completion POSTs | 0 |
| Specialist-consent branches | 6, all deterministically declined |
| Maximum completion steps in one turn | 2 |
| Blank successes | 0 |
| Terminal errors | 0 |
| Page crashes | 0 |
| Duplicate submissions | 0 |
| Unsafe retries | 0 |
| Answer length | 1,954–5,139 characters; mean 2,638 |

The six extra POSTs were continuation steps after the browser returned a client-side specialist
decision. They were not retries: each continuation had a distinct request body and the run recorded
zero duplicated request bodies.

## Agent Studio reconciliation

The existing operator-side `ALGOLIA_ADMIN_API_KEY` successfully retrieved all 20 synthetic
conversations. No separate credential type called an “Algolia Logs API key” was required.

| Reconciliation measure | Result |
|---|---:|
| Conversations retrieved | 20/20 |
| Exact final assistant-message joins | 20/20 |
| Exact assistant join rate | 100% |
| Exported message range | 4–5 per conversation |
| Tool-call range | 1–5 per conversation |
| Unresolved tool calls | 0 |

This is Agent Studio conversation evidence, not infrastructure exception logs. It proves that the
browser results match persisted messages and that every recorded tool call resolved; it does not
expose internal service stack traces.

## Verification

- Stability harness: 55/55 tests passed.
- Focused consent, retry, and reconciliation tests: 16/16 passed.
- Live correction probe: 1/1 journey and 2/2 turns passed.
- Full Phase 0 campaign: 20/20 journeys and 40/40 turns passed.
- Operator reconciliation: 20/20 conversations passed with no unresolved tool calls.

## Private evidence

Raw browser and Agent Studio records remain outside the repository with owner-only permissions:

- Corrected live probe: `/private/tmp/algolia-stability-phase0-reconcile-cVmbvM/`
- Passing Phase 0 campaign: `/private/tmp/algolia-stability-phase0-authoritative-FEB71N/`
- Operator reconciliation: `/private/tmp/algolia-stability-phase0-authoritative-FEB71N/operator/reconciliation-summary.json`
- Original false-negative run retained for comparison: `/private/tmp/algolia-stability-run-20260825-EhvTD0/phase0-post-stream-deadline-v2/`

## Next gate

Phase 0 is cleared. The next authorized stage is the one-user accumulated-state baseline: one clean
six-turn conversation followed by the 24-turn navigation/reset sequence. L30 and L50 remain gated
until the 24-turn sequence passes. Concurrent-user pressure remains blocked until this accumulated-
state gate passes.
