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
- [ ] User approves exact deployment plan.
- [ ] Jahia snapshot, dry-run, apply, readback, and browser validation complete.
- [ ] Aadhar notification sent after user approves the exact text.
