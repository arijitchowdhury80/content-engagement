# Judge Final Lock

Status: locked as the approved judge baseline on 2026-08-23.

No judge prompt, model, Agent Studio agent, grounding rule, scoring rule, aggregation rule, transport behavior, lifecycle behavior, or judge presentation may change without Arijit's explicit approval. A newly discovered bug may be investigated, but implementation and deployment require that approval.

## Final Runtime

- Provider: OpenAI (`e14c1f5e-7c24-4451-a342-940e427f769b`)
- Model: `gpt-5.4-mini`
- Skeptic: `2fd41081-a5a1-4532-8049-1fa2f1338037`
- Referee: `f4e7ed7d-96b2-4900-8d21-40a5cfe950d0`
- Advocate: `36a85e07-8415-4d34-8428-53574dc608f2`

The three Agent Studio judges independently score grounding, completeness, depth, and relevance against the same complete evidence packet. Every agent uses the shared `ALGOLIA-JUDGE-V3` system prompt; its instructions contain only the Skeptic, Referee, or Advocate lens. Judges select the smallest exact answer substring for each semantic claim; code verifies that text and computes highlight offsets. Missing proof IDs or invalid claim text fail validation and retry instead of being converted into semantic grounding failures. Code performs consensus, averaging, and published score caps. There is no localhost judge and no arbitrary elapsed-time scoring deadline.

## Enforcement

`config/judge-final-lock.json` records the immutable agent IDs and protected file hashes. `frontend/chat-widget/tests/judge-final-lock.test.mjs` fails when a protected judge file or agent ID changes. The shared chat bundle is protected by behavioral contract tests so unrelated chat presentation work is not blocked by a whole-bundle hash.

The 2026-08-23 adoption changed only the three judge agent references and the source-of-truth prompt lock. It did not change the orchestrator, widget runtime, evidence packet, dimensions, scoring formula, grounding cap, or presentation.

## Final Validation

- 13 prompt deployment and final-lock tests passed.
- 10 Jahia deployment tests passed.
- 298 chat-widget regression tests passed after the cutover.
- Exact Agent Studio readback passed for system prompt, role instructions, model, provider, tools, configuration, and publication state.
- Exact Jahia EDIT, LIVE, public asset, load-order, and agent-ID readback passed.
- The post-cutover smoke used an unchanged frozen question, answer, evidence packet, and manifest from the A/B experiment.
- All three adopted judges returned valid role reports; the panel completed at `6.0/10`.

Prompt comparison evidence: `production_comparison/runs/20260823-judge-prompt-ab-a/experiment-rerun-authoritative/`.

Durable Agent Studio readback evidence: `docs/evidence/agent-studio/judge-v3/2026-08-23-system-prompt-adoption/readback-manifest.json`.

Authoritative Jahia cutover evidence: `docs/evidence/deployments/2026-08-23-judge-system-prompt-adoption-final/`.
