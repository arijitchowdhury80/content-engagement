# Judge Final Lock

Status: locked as the approved judge baseline on 2026-08-23.

No judge prompt, model, Agent Studio agent, grounding rule, scoring rule, aggregation rule, transport behavior, lifecycle behavior, or judge presentation may change without Arijit's explicit approval. A newly discovered bug may be investigated, but implementation and deployment require that approval.

## Final Runtime

- Provider: OpenAI (`e14c1f5e-7c24-4451-a342-940e427f769b`)
- Model: `gpt-5.4-mini`
- Skeptic: `d6783522-e8fb-4622-b139-205d9c238c0d`
- Referee: `320a52d9-4217-406b-8902-15688fdb4d1f`
- Advocate: `50843dd4-eab8-473b-ab44-7dda69d7557d`

The three Agent Studio judges independently score grounding, completeness, depth, and relevance against the same complete evidence packet. Every agent uses the shared `ALGOLIA-JUDGE-V3.3` system prompt; its instructions contain only the Skeptic, Referee, or Advocate lens. Judges partition exact non-factual spans from factual claims. Code verifies exact text, discards claims that overlap an explicit non-factual span, derives the final unit classification mechanically, and computes highlight offsets. Missing proof IDs or invalid claim text fail validation and retry instead of being converted into semantic grounding failures. Code performs consensus, averaging, and published score caps. There is no localhost judge and no arbitrary elapsed-time scoring deadline.

## Enforcement

`config/judge-final-lock.json` records the immutable agent IDs and protected file hashes. `frontend/chat-widget/tests/judge-final-lock.test.mjs` fails when a protected judge file or agent ID changes. The shared chat bundle is protected by behavioral contract tests so unrelated chat presentation work is not blocked by a whole-bundle hash.

The 2026-08-23 semantic repair changed the three judge agent references, the source-of-truth prompt, semantic partition validation, and sentence handling. It did not change the orchestrator, evidence packet, dimensions, scoring formula, grounding cap, or presentation.

## Final Validation

- Prompt, judge-core, browser integration, comparison, and deployment suites passed.
- 10 Jahia deployment tests passed.
- 298 chat-widget regression tests passed after the cutover.
- Exact Agent Studio readback passed for system prompt, role instructions, model, provider, tools, configuration, and publication state.
- Exact Jahia EDIT, LIVE, public asset, load-order, and agent-ID readback passed.
- The post-cutover smoke invoked the live orchestrator and all three adopted judges with `Show me analytics in action`.
- All three adopted judges returned valid role reports. No rhetorical claim remained unresolved; the only consensus highlight was a concrete unsupported 15% conversion-increase claim.

Prompt comparison evidence: `production_comparison/runs/20260823-judge-prompt-ab-a/experiment-rerun-authoritative/`.

Durable Agent Studio readback evidence: `docs/evidence/agent-studio/judge-v3/2026-08-23-system-prompt-adoption/readback-manifest.json`.

Authoritative Jahia cutover evidence: `docs/evidence/deployments/2026-08-23-judge-system-prompt-adoption-final/`.
