# Chat Widget

This directory is the project home for Algolia.com chat widget JavaScript.

## Current State

These are the project-owned JavaScript files for the current Jahia chat widget work. Keep the
editable files directly in this folder so they are easy to find and review.

Use `dist/` only for generated packages, zips, or dated release bundles. Do not put the editable
source under a dated `dist/<date>/local-reference/` tree again.

## Current Files

- `algolia-chat.js` — chat custom element bundle.
- `algolia-chat-engage.js` — proactive engagement script.
- `algolia-engagement-tracker.js` — engagement tracker for profile, session, and event signals.
- `algolia-context-compiler.js` — compiles tracker state into Agent Studio per-turn context.
- `algolia-proactive-controller.js` — evaluates journey triggers, stores opportunity packets, calls the Agent Studio Greetings Agent, and asks the chat widget to render the returned greeting.
- `handoff-to-orchestrator.js` — registers the Greetings Agent's `handoff_to_orchestrator` client-side tool and attaches proactive handoff context to the next primary orchestrator turn.
- `algolia-chat-form-tool.js` — lead form client tool.
- `algolia-chat-theme-algolia.js` — Algolia brand theme.
- `algolia-confidence-badge.js` — confidence badge bundle.

## Local Parity Harness

Use localhost as the integration lab before touching Jahia:

```bash
npm run local:chat
```

Open `http://127.0.0.1:5177/products/ai-recommendations?algoliaChatDebug=1&algoliaProactiveDebug=1`.

The local harness serves `local-parity/index.html` for website routes and loads the editable
widget files from this directory through `/chat/<file>.js`. It mocks only the Agent Studio
Greetings Agent response; tracker storage, context compilation, proactive controller decisions,
and widget rendering use the real project-owned scripts.

Automated smoke validation:

```bash
npm run test:local-chat-parity
```

This proves the local page writes `algolia_profile`, `algolia_session`, and `algolia_events`,
compiles an `AlgoliaContextPacket.v1`, sends one Greetings Agent completion request, and renders
a proactive greeting without mutating Jahia.
