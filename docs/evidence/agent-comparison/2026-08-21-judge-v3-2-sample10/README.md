# Judge v3.2 Sample-10 Comparison

## Run

- Local run: `production_comparison/runs/2026-08-21T04-18-17-310Z`
- Flagship: 10/10 scored, 6.8 average
- Production: 9/10 scored, 5.9 average
- Panels: 15 complete, 4 provisional, 1 unavailable
- Integrity audit: 10 questions, 20 non-empty answers, and 74 retained answer/judge streams re-parsed with zero malformed or terminal-failure frames
- Side-by-side report: `report.html`

The 13 MB raw `results.json` remains in the ignored local run directory. It was not promoted because it contains generated run payloads and complete raw streams. The HTML report contains the questions, answers, dimension scores, role scores, status, and composite results needed for review.

## Scores

| # | Flagship | Status | Production | Status |
|---:|---:|---|---:|---|
| 1 | 9.9 | complete | 9.8 | complete |
| 2 | 9.7 | complete | 3.0 | provisional |
| 3 | 3.0 | complete | 3.0 | complete |
| 4 | 9.8 | complete | 3.0 | complete |
| 5 | 3.0 | complete | 6.0 | provisional |
| 6 | 3.0 | complete | 9.0 | complete |
| 7 | 7.3 | provisional | 3.0 | complete |
| 8 | 9.7 | complete | 10.0 | complete |
| 9 | 3.0 | complete | unavailable | unavailable |
| 10 | 9.7 | complete | 6.0 | provisional |

## Deployment Evidence

- Agent Studio immutable v3.2 release: `docs/evidence/agent-studio/judge-v2/2026-08-21-judge-v3-2-final`
- Jahia immutable asset deployment: `docs/evidence/deployments/2026-08-21-judge-v3-2-final`
- Headed live validation: `docs/evidence/deployments/2026-08-21-judge-v3-2-headed`
- Final race-fix deployment and headed validation: `docs/evidence/deployments/2026-08-21-judge-v3-2-final-review-fixes-recovery`
- Strict stream re-audit: `strict-stream-reaudit.json`

All three Agent Studio roles passed exact configuration readback. Jahia passed edit/live block equality, public asset hashes, core-before-chat load order, exact role IDs, and Chief absence. The headed run observed a real pending state, a stable answer with four source groups, and a final 9.9 score without a blank or retry state.

After the final adversarial-review fixes, the live chat asset was cut over immutably and revalidated in a headed browser. A fresh NeuralSearch turn rendered five source groups and resolved to 9.6/10 with no blank or retry state. The original ten-question results remain valid because the stricter parser found no malformed, guardrail, abort, or error frames in any retained stream.
