# Post-client-removal discovery conversation

Date: 2026-08-25
Target: Jahia development surface, `Algolia_Prod_Copy_Vanilla`
Campaign: `U2-AD1` — senior ecommerce developer evaluating React InstantSearch as an Elasticsearch replacement
Verdict: **DIAGNOSTIC FAIL; PREFLIGHT CONTRACT CORRECTED**

## Conversation result

The six-turn browser journey completed against the live system. Five primary turns reached visible
answers; the final specialist turn exceeded the 60-second boundary and left a blank answer.

Observed question progression:

1. Re-asked whether the PoC was a technical evaluation or business-outcome exercise instead of
   accepting the explicit PoC intent and collecting the problem/use case.
2. Asked about the data model and architecture.
3. Offered a technical specialist before the required discovery minimum was complete.
4. Combined catalog scale with ERP update frequency in one question.
5. Offered migration guidance rather than collecting success criteria.
6. Accepted Developer Specialist consent, then exceeded the deadline with no answer.

Accumulated facts: architecture, PIM, ERP, Elasticsearch, middleware data flow, five-million-record
scale, and three locales. Missing required facts: problem/use case and success criteria.

Mechanical observations:

- Turns 1–5: one primary completion request, HTTP 200, no primary retry.
- Turn 6: one primary completion request, HTTP 200, specialist consent accepted, blank/unbounded.
- No client `discovery.*` ledger was involved.

## Harness correction

The first run's transcript reader initially missed a visible question when a supporting-evidence
paragraph followed it. The reader now searches visible answer paragraphs from the end and has a
regression test for that response shape. This correction changes only the external test harness.

## Preflight-contract correction

The static Jahia block correctly declares confidence mode `off` as its fail-safe starting state. The
Compare feature intentionally changes settled single-panel runtime mode to `algolia`, then changes it
to `off` for a dual development/production request so that comparison does not launch production plus
three judges together. The preflight incorrectly expected the static value after the browser runtime
had settled. The browser contract now expects `algolia`; the static HTML contract remains `off`.

The Compare feature remains intact. The diagnostic conversation proves that server-owned discovery
is not yet following the frozen technical-evaluation lane; a clean rerun can proceed under the
corrected preflight contract.

Private raw evidence:

- `/private/tmp/algolia-adaptive-discovery-post-client-fix-20260825-01/adaptive-discovery/summary.json`
- `/private/tmp/algolia-adaptive-preflight-post-client-fix-20260825-02/preflight/runtime-identity.json`
