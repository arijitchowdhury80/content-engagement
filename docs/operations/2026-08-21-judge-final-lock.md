# Judge Final Lock

Status: locked as the approved judge baseline on 2026-08-21.

No judge prompt, model, Agent Studio agent, grounding rule, scoring rule, aggregation rule, transport behavior, lifecycle behavior, or judge presentation may change without Arijit's explicit approval. A newly discovered bug may be investigated, but implementation and deployment require that approval.

## Final Runtime

- Provider: `google_genai`
- Model: `gemini-2.5-flash`
- Thinking budget: `0`
- Skeptic: `573fb67f-72f0-4baa-8b14-33fd32dc9718`
- Referee: `2ec4490f-67df-479f-8c7a-5d58440e2e10`
- Advocate: `1b14aea2-6b0b-497a-9dff-be0dee3bb956`

The three Agent Studio judges independently score grounding, completeness, depth, and relevance against the same complete evidence packet. Judges select the smallest exact answer substring for each semantic claim; code verifies that text and computes highlight offsets. Missing proof IDs or invalid claim text fail validation and retry instead of being converted into semantic grounding failures. Code performs consensus, averaging, and published score caps. There is no localhost judge and no arbitrary elapsed-time scoring deadline.

## Enforcement

`config/judge-final-lock.json` records the immutable agent IDs and protected file hashes. `frontend/chat-widget/tests/judge-final-lock.test.mjs` fails when a protected judge file or agent ID changes. The shared chat bundle is protected by behavioral contract tests so unrelated chat presentation work is not blocked by a whole-bundle hash.

## Final Validation

- 273 JavaScript tests passed across the chat widget and comparison runner.
- 10 Jahia deployment tests passed.
- Exact Jahia edit, live, public asset, load-order, and agent-ID readback passed.
- The former live failure query completed with all three judges in a headed browser.
- Final observed panel: Skeptic `9.3`, Referee `9.7`, Advocate `9.3`; composite `9.4/10`.
- Exact-claim live smoke panel: Skeptic `9.7`, Referee `10.0`, Advocate `10.0`; one precise sentence selected for review while the answer remained visible.

Authoritative deployment evidence: `docs/evidence/deployments/2026-08-21-judge-v3-4-exact-claim-reviewed/`.
