# Current Jahia Development Release

Date recorded: 2026-08-25
Target: `/sites/www/home/drift/custom-code-block` on the Jahia development surface
Scope: readback and repository-preservation record; no production claim

## Current verified state

The current development chat artifact is released and recoverable:

- Asset: `algolia-chat-stability-bdde7a55d6ff.js`.
- SHA-256: `bdde7a55d6ff788e8af1df789de21f382379cb6b1bd784dfd6eb8afa23cc30fc`.
- The hash matches `frontend/chat-widget/algolia-chat.js` in this cleanup branch.
- EDIT, LIVE, public-reference, and public-asset readback passed for this artifact.
- Inline confidence is intentionally off for stability qualification.

The current Algolia theme is also source-identical in EDIT and LIVE:

- Release query: `theme=20260824-resizable-stable-154e7454be7f`.
- SHA-256: `154e7454be7f3aaa0f44f386863faf332ac497eaa9d50c824b9122951ee8eca3`.
- Theme content, block markup, non-theme script URLs, and the existing chat hash were preserved.

The shared proactive runtime remains the scoped release `20260823-shared-packet-a`:

- Controller and immutable handoff assets matched source in EDIT and LIVE.
- The custom-code block and release markers matched the approved expected state.
- The deployment did not mutate the chat renderer, tracker, compiler, engage runtime, theme, or unrelated Jahia subtrees.

## Verification status

- Reactive Phase 0: 20/20 fresh-browser journeys and 40/40 mechanical turns passed.
- Final one-user accumulated-state run: 12/12 logical turns completed mechanically.
- Current widget suite at the time of release: 318/318 passed.
- Chat-stack deployment safety tests: 8/8 passed.
- Guardrail mutation contract tests: 2/2 passed.
- Current readiness remains `NO-GO_FOR_CONCURRENCY`: p95 latency was 46.936 seconds and semantic quality was not independently certified.
- Adaptive discovery remains failed because the conversation repeated already-confirmed slots and did not complete the required profile.

The precise claim is therefore limited to preservation of the released Jahia development state and
one-user mechanical survival. It is not a production-capacity, semantic-quality, concurrent-user,
or proactive/reactive-race certification.

## Evidence retention

The durable, sanitized reports retained in Git are:

- `docs/evidence/stability/2026-08-25-phase0-execution-report.md`
- `docs/evidence/stability/2026-08-25-one-user-adversarial-execution.md`
- `docs/evidence/stability/2026-08-25-adaptive-discovery-execution.md`
- `docs/operations/2026-08-23-shared-proactive-journey-context.md`
- `docs/operations/2026-08-25-inline-confidence-off-for-stability.md`

Raw browser captures, screenshots, Agent Studio packets, before-snapshots, mutation payloads, and
readback JSON are intentionally excluded from Git. They are retained in the owner-only cleanup
archive documented by the repository-cleanup ledger. This keeps restoration evidence available
without publishing credentials, internal prompts, browser identifiers, or bulk generated output.

Production Ask Algolia was not mutated or load tested. This cleanup performed no Jahia, Agent
Studio, index, or production mutation.
