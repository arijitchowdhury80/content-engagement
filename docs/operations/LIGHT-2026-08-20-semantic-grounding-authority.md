# Semantic Grounding Authority

## Classification

Light-path judge correctness fix. This changes no external API, dependency, Agent Studio prompt, or answer lifecycle. It corrects how the browser's exact-match diagnostic is combined with the existing Agent Studio panel verdict.

## Root Cause

The deterministic pre-check searched only retrieved body text and was incorrectly allowed to override the completed semantic panel: one verbatim miss could create a 100%-certainty flagged claim, trip the grounding gate, cap the score at 3.0, and drive red answer markup even when all three Agent Studio judges found the answer grounded.

## Authorized Scope

- Search retrieved title and URL metadata alongside body text during the preliminary exact-match check.
- Keep the exact-match result as nested diagnostic evidence after panel completion.
- Preserve the Agent Studio panel's score, gate, and claims as the final authority.
- Remove preliminary exact-match highlighting after the semantic verdict arrives.
- Render the final numeric panel score instead of retaining the preliminary grounding badge.
- Add regressions for source-title evidence, exact-match disagreement, and a true semantic gate.

## Verification

- A Forrester study title present in retrieved metadata passes the exact-match screen.
- A remaining exact-match miss cannot cap or mutate a high semantic verdict.
- A material issue found by the semantic panel still trips its own gate.
- The answer contains no final red exact-match markup once semantic judging completes.
- Focused browser tests, the complete widget suite, deployment tests, and live readback must pass.

## Rollback

Restore the immediately preceding Jahia chat and confidence-badge snapshots and their prior cache-query marker.

## Prevention Heuristic

High panel score displayed as 3.0 -> inspect verdict merge authority -> deterministic checks may advise but never synthesize semantic certainty or override the completed Agent Studio panel.
