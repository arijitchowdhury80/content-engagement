# Compare Shared Renderer — Architecture

## Decision

Render Compare natively inside the chat widget. Keep the comparison companion as a transport/controller only.

## Data flow

1. The existing handoff layer publishes the finalized concierge request.
2. The comparison controller sends that exact body to Production Ask Algolia.
3. The controller normalizes the production stream into semantic turn patches.
4. A supported widget API receives those patches.
5. The widget stores production turns separately but renders both turn lists through the same `ChatPanel` and `ChatMessage` components.

## Ownership

- `handoff-to-orchestrator.js`: finalized request publication.
- `algolia-chat-compare.js`: opt-in state, production transport, SSE normalization, cancellation, and failure isolation.
- chat widget source: two-column layout, answer rendering, sources, judges, TL;DR, errors, accessibility, and responsive behavior.

## Removed duplication

The following functions must be deleted from `algolia-chat-compare.js` after the native API is available:

- `md`
- `renderSources`
- `renderTurn`
- DOM construction for production answer/source cards

## Public seam

Use one narrow, versioned comparison API on the mounted widget:

- enable/disable and reset comparison state;
- begin a production turn;
- patch a production turn while streaming;
- settle a production turn as success or error.

The API accepts data, not HTML, React nodes, selectors, or private shadow-DOM access.

## Source prerequisite

The readable widget source must first reproduce the current committed Algolia bundle, including its TL;DR/direct-read behavior. The shared renderer change is then made in source and built deterministically. Direct edits to the generated bundle are prohibited.

## Rollback

Deployment publishes new immutable widget and comparison assets together. Rollback restores the previous two asset references and verifies their hashes. A mixed old/new pair is a release failure.
