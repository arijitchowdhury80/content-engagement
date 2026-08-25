# Risk and pre-mortem

## Launch-blocking risks

| Failure | Mitigation | Proof |
|---|---|---|
| A second fetch wrapper changes call order or drains the stream twice | Remove PR #5 wrapper; publish lifecycle events from the existing transport | Static assertion and request-count test |
| The public proxy exposes complete conversations | Parse upstream JSON and return only three numeric totals | Contract and redaction tests |
| Caller selects another app or agent | Remove both request fields; use trusted configuration | Invalid-parameter and fixed-target tests |
| API key leaks through Git, browser, jar, logs, or evidence | OSGi/env secret only; secret scan and evidence redaction | Secret scan and configuration review |
| Telemetry fires before totals persist | Emit after stream completion and use bounded retry | Fake-clock retry tests and live verification |
| Compare appears broken because it is disabled | Explain the lock and recovery in the control itself | Accessibility and browser test |
| A deployment overwrites unrelated Jahia work | Hashed assets plus snapshot/dry-run/drift check/readback/rollback | Deployment tests and mutation evidence |

## STRIDE summary

- Spoofing: exact allowed Origin is necessary but not an authentication boundary; fixed app/agent,
  unguessable conversation IDs, and the server-side rate limit reduce scope.
- Tampering: strict allowlist validation and a fixed upstream URL prevent host/path injection.
- Repudiation: log safe request correlation and status, never question or answer content.
- Information disclosure: token-only response and safe errors; no raw upstream body returned.
- Denial of service: connect/read timeouts, response-size cap, bounded retries, and rate limiting.
- Elevation of privilege: logs-scoped key only; no administrative key and no caller-selected target.

## Fast follow

- Replace origin-only anonymous access with a signed, short-lived browser capability if Jahia can
  issue one without weakening the public chat flow.
