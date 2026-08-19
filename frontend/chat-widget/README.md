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
- `handoff-to-orchestrator.js` — decorates the first engaged response with a compact proactive handoff, persists that origin context, and combines it with freshly compiled page context on later orchestrator turns.
- `algolia-chat-form-tool.js` — lead form client tool.
- `algolia-chat-theme-algolia.js` — Algolia brand theme.
- `algolia-confidence-badge.js` — confidence badge bundle.

## Local Parity Harness

Use localhost as the integration lab before touching Jahia:

```bash
npm run local:chat
```

Open `http://127.0.0.1:5177/products/ai-recommendations?algoliaChatDebug=1&algoliaProactiveDebug=1`.

The local harness hosts representative website routes from
`local-sites/algolia-com-parity/index.html` and loads Scout-captured Algolia.com page content from
`local-sites/algolia-com-parity/scout-captures/routes.json`. The editable chat widget files still
come from this directory through `/chat/<file>.js`.

Refresh the representative local site pages with Scout:

```bash
npm run scout:local-pages
```

This fetches only the selected personalization-test routes: home, product pages, solution pages,
developers/docs, pricing, customers, and one customer story. It does not fetch or mirror the full
website.

The local harness mocks only the Agent Studio Greetings Agent response; tracker storage, context
compilation, proactive controller decisions, and widget rendering use the real project-owned
scripts.

Automated smoke validation:

```bash
npm run test:local-chat-parity
```

This proves the local page writes `algolia_profile`, `algolia_session`, and `algolia_events`,
compiles an `AlgoliaContextPacket.v1`, sends one Greetings Agent completion request, and renders
a proactive greeting without mutating Jahia.

## Debugging Without URL Flags

For manual testing, turn on the full chat/proactive/context/handoff debug pipeline once per browser:

```js
localStorage.setItem("algoliaDebug", "1");
location.reload();
```

To turn it off:

```js
localStorage.removeItem("algoliaDebug");
location.reload();
```

The master `algoliaDebug=1` storage flag enables the same debug behavior as the individual URL
flags. Narrow flags still work when you only want one layer:

- `algoliaChatDebug`
- `algoliaEngagementDebug`
- `algoliaProactiveDebug`
- `algoliaContextDebug`
- `algoliaHandoffDebug`

Example:

```js
localStorage.setItem("algoliaHandoffDebug", "1");
location.reload();
```
