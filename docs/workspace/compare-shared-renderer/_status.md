# Compare Shared Renderer — Status

- [x] Root cause verified in current committed files.
- [x] Target rendering boundary selected.
- [x] Existing production transport retained.
- [x] Post-answer Compare retains and replays the latest finalized request byte-for-byte.
- [x] Post-answer Compare unit, full-chain browser, and deployment tests pass.
- [x] Judge disappearance root cause traced to the pre-existing global `mode="off"` stability cutover, not Compare.
- [x] Compare appears only in the latest answer evidence footer; the header stays free of answer actions.
- [x] Current-response input/output telemetry appears in the same footer and cumulative totals are not presented as one response.
- [x] Judges run when Compare is off and remain visible when an existing answer is compared.
- [x] Future turns sent while Compare is already on suppress judge fan-out to protect the request budget.
- [ ] Current compiled Algolia presentation reconciled into readable source.
- [ ] Native comparison turn API implemented.
- [ ] Duplicate companion renderers removed.
- [x] Relevant unit, integration, full-chain browser, responsive, and accessibility-contract tests pass.
- [x] User approved deployment and the answer-footer control placement.
- [x] Jahia snapshot, dry-run, apply, exact readback, and live Compare/telemetry browser validation complete.
- [ ] Live Judge service acceptance: the pill now renders and the three-role run starts, but the 2026-08-26 check ended unavailable because fewer than two judges returned valid reports after an initial primary 429.
- [ ] Aadhar notification sent after user approves the exact text.

## 2026-08-26 microcopy light path

- Classification: light path; visible copy only, with no API, schema, dependency, credential, or data-flow change.
- Approved labels: `Compare with Prod` and `In {input} / {output} Out`.
- Primary risk: stale tests or a clipped pill. Covered by unit and full-chain browser tests using the existing responsive pill styles.
- Rollback: restore the prior immutable Compare and telemetry asset references through the generated deployment plan.
