# Architecture Adjudication Method

Status: normative for Stage 1
Run: `2026-08-20-001`

## Decision unit

The unit of adjudication is an architectural concern, not a repository. Examples include per-instance configuration, transport ownership, theme validation, proactive eligibility, source projection, storage consent, artifact provenance, and Jahia lifecycle.

Each candidate disposition is one of:

- preserve from Algolia;
- preserve from Sajid upstream;
- preserve from shared integration with its actual provenance;
- synthesize a defined combination;
- redesign all observed approaches;
- retire with compatibility handling.

## Evidence rule

Every scored cell cites a baseline ID, immutable path, content hash or snapshot manifest, symbol/line where available, and evidence class from the characterization specification.

- Scores 0–2 may be based on inspected or inferred deficiencies.
- Score 3 requires a passing test, reproducible runtime observation, or multiple mutually supporting source contracts.
- Score 4 requires direct verification plus an enforceable boundary, schema, or automated guard.
- Score 5 requires automated enforcement across all relevant consumers and a demonstrated failure test.
- Missing or contradictory evidence is not scored optimistically. It lowers confidence and normally caps a score at 2 until investigated.

## Anchored scale

| Score | Required interpretation |
|---|---|
| 0 | Capability absent or the implementation contradicts the criterion |
| 1 | Systemically unsafe; major redesign is required |
| 2 | Partial implementation with substantial remediation or weak evidence |
| 3 | Adequate, verified behavior with bounded and named gaps |
| 4 | Strong, directly verified, and structurally enforced |
| 5 | Automatically enforced and verified across every in-scope consumer |

## Criteria and weights

| Criterion | Weight |
|---|---:|
| Boundary integrity | 25 |
| Testability and diagnosability | 20 |
| Release isolation | 15 |
| Maintainability and developer experience | 15 |
| Performance and bundle impact | 10 |
| Migration risk and cost | 10 |
| Multi-brand and host extensibility | 5 |

For candidate `c`, the normalized score is:

```text
weighted(c) = sum(score(c, criterion) * weight(criterion)) / 5
```

The result is on a 0–100 scale. Raw per-criterion scores are always published; the weighted total is never published alone.

## Confidence

Each scored cell has confidence from 0.0 to 1.0:

- 0.90–1.00: directly executed or automatically enforced evidence;
- 0.70–0.89: clear source/configuration evidence with limited execution;
- 0.50–0.69: reasonable inference with a named evidence gap;
- below 0.50: insufficient for final selection.

Report both:

```text
weighted score = sum(score * weight) / 5
confidence      = sum(confidence * weight) / 100
```

Confidence does not mathematically inflate or deflate the architecture score. A candidate with aggregate confidence below 0.70 cannot win without further investigation or an explicit user-approved uncertainty exception.

## Hard gates

Behavioral correctness, privacy/consent, WCAG 2.2 AA, approved Algolia/Spectrum parity, and rollback safety are non-compensating. For a current implementation, a hard-gate failure prevents selecting it unchanged. A synthesis may remain eligible only if the failing behavior is explicitly removed or remediated in the target contract and tracked as a Gate I obligation.

Current-baseline evidence cannot prove a not-yet-built synthesis. Stage 1 may approve its design; only Gate I may approve its implementation.

## Tie and dispute resolution

Candidates within three weighted points are tied. Resolve ties in this order:

1. passing hard-gate posture;
2. boundary integrity;
3. testability and diagnosability;
4. lower irreversible migration risk;
5. preservation of documented public contracts;
6. smallest reversible implementation step.

If still tied, build a disposable proof of concept that targets the disputed seam and rerun the affected characterization. If the evidence remains tied, the user is the final decision authority.

Every dissent remains in the dispute register with the strongest rebuttal, evidence that would change the result, and resolution owner.

## Coverage denominator

The denominator is the immutable set of entries marked `architecture_included` in `scope-manifest.json`. Coverage is complete only when every entry maps to at least one file/symbol evidence row and an architectural disposition. Excluded paths cannot be added to or removed from the scoring denominator after review begins without a versioned scope amendment that records the reason and recalculates coverage.

Generated artifacts may prove deployed behavior but cannot replace readable source evidence for ownership, maintainability, or boundary enforcement scores.

## Required scorecard columns

Each raw scorecard row contains:

- concern and candidate;
- criterion, score, weight, weighted contribution, and confidence;
- immutable baseline and evidence reference;
- evidence class;
- hard-gate impact;
- remediation assumed by the candidate;
- reviewer and rebuttal status;
- unresolved uncertainty;
- final disposition.
