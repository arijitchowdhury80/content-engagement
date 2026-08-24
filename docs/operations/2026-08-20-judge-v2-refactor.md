# Judge v3.2 Refactor

## Root Cause

The old system mixed a mechanical exact-string diagnostic, inconsistent role prompts, a separate synthesizer, truncated evidence, and answer-rendering control into one apparent grounding score. That let non-semantic string misses masquerade as factual errors and allowed judge failures to change a completed answer.

## Authoritative Pipeline

1. The answer streams and is committed independently of judging.
2. Code captures every ordered Agent Studio retrieval tool-output event without deduplication or truncation.
3. Code creates deterministic question, answer, and evidence hashes; sentence IDs; evidence-passage IDs; and a capacity preflight.
4. The same complete packet is sent in parallel to exactly three Agent Studio agents: Skeptic, Referee, and Advocate.
5. Every role uses the same grounding, completeness, depth, and relevance rubric. Only the strictness lens differs.
6. The LLMs make semantic decisions only. They classify factual content, split independently checkable claims in textual order, judge semantic support, score the four dimensions, and return sentence and evidence-passage IDs.
7. Code resolves exact answer text, evidence text, and offsets from those IDs. It assigns the claim index and claim count from array order, validates role identity, complete sentence coverage, evidence references, score ranges, and internal consistency.
8. Code groups findings only when sentence ID, claim index, and claim count match. It requires two-judge consensus for a grounding finding, averages dimension scores, computes the quality base, and applies the rubric's grounding caps. Different claim segmentation is disagreement, never manufactured consensus.
9. Three valid reports produce a final score. Two produce an explicitly provisional score. Fewer than two produce unavailable, never a fabricated score.
10. The UI presents only scoring, unavailable, provisional, or completed semantic-panel states. It never labels the internal exact-match diagnostic as grounded and never hides, rewrites, or replaces the answer.
11. A preserved partial answer that ended in a terminal transport error remains readable but is explicitly excluded from confidence scoring.
12. Retrying a turn creates a new turn and message identity. A conversation-wide run sequence prevents any older answer from publishing over a newer standalone verdict.

## Deployment Contract

- Agent Studio roles are immutable, versioned agents created with no tools and exact readback.
- Agent creation is attempted once because `POST /agents` is not idempotent. If the response is ambiguous, newly discovered candidates are fetched and fingerprinted, then quarantined for explicit review; the script never deletes an agent whose returned ID did not prove ownership by that run.
- Jahia assets are content-addressed and loaded in core, badge, chat order.
- The Drift block is snapshotted before mutation and changed only if EDIT and LIVE match.
- Private and public hashes, role IDs, and load order are read back after publish.
- Any mutation or post-publish validation failure restores the exact prior Drift block.
- Rollback republishes the Drift subtree and polls EDIT/LIVE until they converge. A later apply may resume only an exact, recognizable interrupted judge cutover; any unrelated workspace difference is refused.

## Prevention Heuristic

When a judge result looks wrong, trace the complete question, answer, evidence, role report, validation result, and aggregation decision. Never let string matching claim semantic correctness, never ask an LLM to perform mechanical identity or arithmetic, and never let judge state control answer persistence.

## Verification

- Unit and contract tests cover complete evidence, packet crossing, semantic metadata support, headings, quote/reference validation, score consistency, consensus caps, provisional/unavailable states, deterministic identity, and capacity overflow.
- Transport tests cover domain origins, HTTP errors, empty streams, error-tainted judge streams, timeouts, empty evidence, trusted validation-only retry feedback, invalid concurrency, and one-sided comparison failures.
- Browser integration tests cover persistent streamed answers, pending-score presentation, non-destructive gating, Forrester metadata support, provisional panels, unavailable panels, fresh retry identity, terminal-error partial-answer suppression, the evaluation drawer, and discovery follow-ups.
- Deployment tests cover immutable asset cutover, UUID validation, single-agent removal, private-state permissions, and automatic post-publish rollback.

Independent adversarial reviews additionally tested the design against partial and malformed streams, guardrail terminal events, stale cross-turn results, false consensus across separate same-sentence claims, empty tool outputs, inconsistent score bands, single-judge centrality, duplicate or ambiguous deployment targets, invalid concurrency, delayed Jahia publication, and concurrent rollback. The implementation rejects tainted streams, suppresses scoring for incomplete answers, binds consensus to ordered claim identity, validates grounding scores against finding severity, requires centrality consensus, prevents repeated agent creation, quarantines ambiguous creates, safely resumes only an exact interrupted cutover, and refuses rollback over an unrelated block change.
