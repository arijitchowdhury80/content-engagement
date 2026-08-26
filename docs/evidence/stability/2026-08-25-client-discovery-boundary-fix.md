# Client Discovery Boundary Fix

Date: 2026-08-25
Target: Jahia development surface
Verdict: LIVE BEHAVIOR FIXED; GENERATOR CLEANUP NOT YET PROMOTED

## Root cause

An experimental browser discovery subsystem duplicated the Agent Studio Orchestrator. The deployed widget created a seven-slot ledger, added `discovery.*` state to completion requests, expected a hidden `DISCOVERY_STATE` marker, and rewrote follow-up presentation. The live Orchestrator did not return that marker, so every turn resent the full unknown-slot list.

## Sweep

The defect class appeared in:

- the deployed chat bundle and Jahia `discovery-enabled` attribute;
- the shared TypeScript widget generator;
- the proactive handoff sanitizer;
- the local parity fixture;
- active operating documentation and obsolete tests.

Historical evidence files were retained as historical records.

## Live fix

- Published immutable asset `algolia-chat-stability-a21b6d039fd7.js`.
- Forced the client discovery path off independently of host configuration.
- Removed the `discovery-enabled` attribute from Jahia EDIT, LIVE, and public HTML.
- Removed obsolete discovery-protocol handling from the handoff source and local parity fixture.
- Preserved ordinary conversation history, deterministic page-context transport, server-returned suggestions, specialist consent, navigation, and storage.

## Verification

- Target app: `0EXRPAXB56`.
- Index: `Algolia_Prod_Copy_Vanilla`.
- Browser attribute: absent.
- First request ledger keys: none.
- Second request ledger keys: none.
- `DISCOVERY CONTROL` in requests: absent.
- `DISCOVERY_STATE` in requests: absent.
- Second request roles: `user → assistant → user`, proving normal history continuity.
- Two live turns completed successfully.
- Complete chat-widget suite: 334/334 passed sequentially.
- Handoff tests: 17/17 passed within that suite.
- Deployment tests: 11/11 passed.
- Client-boundary and server-suggestion regressions: passed.
- Shared generator unit tests after source removal: 274/274 passed.

The rebuilt generator candidate was not promoted because that separate shared-source worktree already contains extensive unrelated uncommitted changes and failed cross-repository parity checks. The currently deployed bundle therefore uses a fail-closed containment at the executable boundary; physical dead-code removal will be promoted only from an isolated clean generator baseline.

## Prevention heuristic

Any conversational policy or readiness state found in browser code is an architecture violation: keep the browser to rendering, transport, navigation, storage, and safe context transport; keep discovery decisions and conversational reasoning in Agent Studio.
