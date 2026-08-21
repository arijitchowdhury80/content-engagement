# Judge Final Lock

Status: locked as the approved judge baseline on 2026-08-21.

No judge prompt, model, Agent Studio agent, grounding rule, scoring rule, aggregation rule, transport behavior, lifecycle behavior, or judge presentation may change without Arijit's explicit approval. A newly discovered bug may be investigated, but implementation and deployment require that approval.

## Final Runtime

- Provider: `google_genai`
- Model: `gemini-2.5-flash`
- Thinking budget: `0`
- Skeptic: `abd89d65-21f5-4909-a7cc-dfeb1428198c`
- Referee: `fa9b6f74-cdfb-40f0-ac86-f34e76721331`
- Advocate: `2216fdec-d9f7-4112-a9df-4f0ca341b15a`

The three Agent Studio judges independently score grounding, completeness, depth, and relevance against the same complete evidence packet. Code performs mechanical validation, conservative proof-state normalization, consensus, averaging, and published score caps. There is no localhost judge and no arbitrary elapsed-time scoring deadline.

## Enforcement

`config/judge-final-lock.json` records the immutable agent IDs and protected file hashes. `frontend/chat-widget/tests/judge-final-lock.test.mjs` fails when a protected judge file or agent ID changes. The shared chat bundle is protected by behavioral contract tests so unrelated chat presentation work is not blocked by a whole-bundle hash.

## Final Validation

- 265 JavaScript tests passed.
- 8 Jahia deployment tests passed.
- Exact Jahia edit, live, public asset, load-order, and agent-ID readback passed.
- The former live failure query completed with all three judges in a headed browser.
- Final observed panel: Skeptic `9.3`, Referee `9.7`, Advocate `9.3`; composite `9.4/10`.

Authoritative deployment evidence: `docs/evidence/deployments/2026-08-21-judge-v3-3-gemini-final-recovery/`.
