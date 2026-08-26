# Compare Shared Renderer — Intake

Classification: Full path. This changes the widget's rendering boundary and public integration seam, while preserving the existing visual design and production request transport.

## Problem

`algolia-chat-compare.js` independently implements Markdown, answer, source, loading, and error rendering. The main widget renders the concierge through React `ChatMessage` and `SourcePills`. The duplication causes presentation drift: Compare answers do not reliably receive the same TL;DR, source, judge, error, or future answer treatments.

## Verified constraints

- The already-finalized concierge request body remains the production comparison request body.
- Production failures remain isolated from the concierge turn.
- Production Ask Algolia remains read-only.
- Single-panel mode and both Compare panels must use the same answer component.
- Existing unrelated changes in the primary checkout are out of scope.
- The current Algolia TL;DR treatment is present in the compiled bundle but not yet represented in the readable source tree. A source-built replacement cannot ship until this behavior is reconciled and proven equivalent.

## Acceptance criteria

1. The Compare companion contains no Markdown, source, answer, loading, or error renderer.
2. The widget owns both conversation columns and invokes the same `ChatPanel`/`ChatMessage` path for each.
3. The production column accepts semantic turn state only: question, status, text, normalized sources, raw hits, and error.
4. The main and production panels preserve TL;DR, sources, judge presentation, streaming, and errors through one component path.
5. The production request body is byte-for-byte the prepared concierge body except for the already-approved destination/authentication differences.
6. Reset, collapse/reopen, resize, retries, late responses, and production failure isolation pass automated and headed-browser checks.
7. Source commit, artifact hash, deployment manifest, Jahia snapshot/dry-run/readback, and rollback evidence are recorded before release.

