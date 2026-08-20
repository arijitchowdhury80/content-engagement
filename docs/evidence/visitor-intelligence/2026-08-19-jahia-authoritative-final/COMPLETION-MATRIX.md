# Eight-Journey Hosted Jahia Completion Matrix

## Verdict

The fresh headed-browser validation set passed **8/8 journeys** on the internal Jahia surface:

`https://tmp-content-eng-algolia.cloud.jahia.com`

This verdict is based on the verification artifacts under
[`2026-08-19-jahia-headed-final`](../2026-08-19-jahia-headed-final/). No localhost capture is
used as acceptance evidence.

## Acceptance Contract

Each journey must prove:

- reset isolation before the journey;
- the expected trigger and greeting behavior;
- no Greetings Agent request after the visitor responds;
- one handoff and one logical first-turn orchestrator interaction;
- exactly one visible discovery question;
- conversation continuity;
- no captured request or service errors; and
- specialist routing for the two specialist journeys.

## Results

| ID | Journey | Expected trigger | Reset | Runtime chain | Discovery | Continuity | Specialist | Final |
|---|---|---|---:|---:|---:|---:|---|---:|
| T1 | Individual Product | `product_page_10s_50_scroll` | PASS | PASS | 1 | PASS | Not required | **PASS** |
| T2 | Product to Documentation | `product_to_documentation` | PASS | PASS | 1 | PASS | Not required | **PASS** |
| B1 | Individual Solution | `solution_page_10s_50_scroll` | PASS | PASS | 1 | PASS | Not required | **PASS** |
| B2 | Solution to Customer Proof | `solution_to_customer_story` | PASS | PASS | 1 | PASS | Not required | **PASS** |
| C1 | Product to Pricing | `product_to_pricing` | PASS | PASS | 1 | PASS | Not required | **PASS** |
| C2 | Solution to Pricing | `solution_to_pricing` | PASS | PASS | 1 | PASS | Not required | **PASS** |
| S1 | Developer Depth | `developer_page_10s_50_scroll` | PASS | PASS | 1 | PASS | Developer route accepted; 1 request | **PASS** |
| S2 | Resource Depth | `resource_page_10s_50_scroll` | PASS | PASS | 1 | PASS | Evidence route accepted; 1 request | **PASS** |

Transition journeys correctly record two greeting requests: one source-page opportunity and one
replacement destination-page opportunity. Every journey records zero Greetings Agent requests
after the visitor response.

## Authoritative Evidence

| ID | Screenshots | Trace | Reset verification | First-turn verification | Traffic verification |
|---|---|---|---|---|---|
| T1 | [Greeting](../2026-08-19-jahia-headed-final/T1/01-greeting.png) · [Answer](../2026-08-19-jahia-headed-final/T1/01-answer.png) · [Continuity](../2026-08-19-jahia-headed-final/T1/01-continuity.png) | [Trace](../2026-08-19-jahia-headed-final/T1/01-trace.json) | [Reset](../2026-08-19-jahia-headed-final/T1/01-reset-verification.json) | [First turn](../2026-08-19-jahia-headed-final/T1/01-first-turn-verification.json) | [Traffic](../2026-08-19-jahia-headed-final/T1/01-traffic-verification.json) |
| T2 | [Greeting](../2026-08-19-jahia-headed-final/T2/02-greeting.png) · [Destination](../2026-08-19-jahia-headed-final/T2/02-destination.png) · [Answer](../2026-08-19-jahia-headed-final/T2/02-answer.png) · [Continuity](../2026-08-19-jahia-headed-final/T2/02-continuity.png) | [Trace](../2026-08-19-jahia-headed-final/T2/02-trace.json) | [Reset](../2026-08-19-jahia-headed-final/T2/02-reset-verification.json) | [First turn](../2026-08-19-jahia-headed-final/T2/02-first-turn-verification.json) | [Traffic](../2026-08-19-jahia-headed-final/T2/02-traffic-verification.json) |
| B1 | [Greeting](../2026-08-19-jahia-headed-final/B1/03-greeting.png) · [Answer](../2026-08-19-jahia-headed-final/B1/03-answer.png) · [Continuity](../2026-08-19-jahia-headed-final/B1/03-continuity.png) | [Trace](../2026-08-19-jahia-headed-final/B1/03-trace.json) | [Reset](../2026-08-19-jahia-headed-final/B1/03-reset-verification.json) | [First turn](../2026-08-19-jahia-headed-final/B1/03-first-turn-verification.json) | [Traffic](../2026-08-19-jahia-headed-final/B1/03-traffic-verification.json) |
| B2 | [Greeting](../2026-08-19-jahia-headed-final/B2/04-greeting.png) · [Destination](../2026-08-19-jahia-headed-final/B2/04-destination.png) · [Answer](../2026-08-19-jahia-headed-final/B2/04-answer.png) · [Continuity](../2026-08-19-jahia-headed-final/B2/04-continuity.png) | [Trace](../2026-08-19-jahia-headed-final/B2/04-trace.json) | [Reset](../2026-08-19-jahia-headed-final/B2/04-reset-verification.json) | [First turn](../2026-08-19-jahia-headed-final/B2/04-first-turn-verification.json) | [Traffic](../2026-08-19-jahia-headed-final/B2/04-traffic-verification.json) |
| C1 | [Greeting](../2026-08-19-jahia-headed-final/C1/05-greeting.png) · [Destination](../2026-08-19-jahia-headed-final/C1/05-destination.png) · [Answer](../2026-08-19-jahia-headed-final/C1/05-answer.png) · [Continuity](../2026-08-19-jahia-headed-final/C1/05-continuity.png) | [Trace](../2026-08-19-jahia-headed-final/C1/05-trace.json) | [Reset](../2026-08-19-jahia-headed-final/C1/05-reset-verification.json) | [First turn](../2026-08-19-jahia-headed-final/C1/05-first-turn-verification.json) | [Traffic](../2026-08-19-jahia-headed-final/C1/05-traffic-verification.json) |
| C2 | [Greeting](../2026-08-19-jahia-headed-final/C2/06-greeting.png) · [Destination](../2026-08-19-jahia-headed-final/C2/06-destination.png) · [Answer](../2026-08-19-jahia-headed-final/C2/06-answer.png) · [Continuity](../2026-08-19-jahia-headed-final/C2/06-continuity.png) | [Trace](../2026-08-19-jahia-headed-final/C2/06-trace.json) | [Reset](../2026-08-19-jahia-headed-final/C2/06-reset-verification.json) | [First turn](../2026-08-19-jahia-headed-final/C2/06-first-turn-verification.json) | [Traffic](../2026-08-19-jahia-headed-final/C2/06-traffic-verification.json) |
| S1 | [Greeting](../2026-08-19-jahia-headed-final/S1-retry/07-greeting.png) · [Answer](../2026-08-19-jahia-headed-final/S1-retry/07-answer.png) · [Continuity](../2026-08-19-jahia-headed-final/S1-retry/07-continuity.png) | [Trace](../2026-08-19-jahia-headed-final/S1-retry/07-trace.json) | [Reset](../2026-08-19-jahia-headed-final/S1-retry/07-reset-verification.json) | [First turn](../2026-08-19-jahia-headed-final/S1-retry/07-first-turn-verification.json) | [Traffic](../2026-08-19-jahia-headed-final/S1-retry/07-traffic-verification.json) |
| S2 | [Greeting](../2026-08-19-jahia-headed-final/S2/08-greeting.png) · [Answer](../2026-08-19-jahia-headed-final/S2/08-answer.png) · [Continuity](../2026-08-19-jahia-headed-final/S2/08-continuity.png) | [Trace](../2026-08-19-jahia-headed-final/S2/08-trace.json) | [Reset](../2026-08-19-jahia-headed-final/S2/08-reset-verification.json) | [First turn](../2026-08-19-jahia-headed-final/S2/08-first-turn-verification.json) | [Traffic](../2026-08-19-jahia-headed-final/S2/08-traffic-verification.json) |

## S1 Supersession

[`S1-retry`](../2026-08-19-jahia-headed-final/S1-retry/) is the authoritative S1 acceptance
capture. The earlier [`S1`](../2026-08-19-jahia-headed-final/S1/) directory is retained as
diagnostic evidence of the empty-completion/specialist-resolution defect found before remediation;
it must not be counted in the final matrix.

## Scope Of The Verdict

The 8/8 result proves the hosted interaction contract encoded by the capture harness for this fresh
Jahia run. It does not by itself authorize production promotion or replace human review of tone,
business usefulness, and factual claims.
