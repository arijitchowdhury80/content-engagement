# In-widget compare-with-production — build & verification evidence

**Date:** 2026-08-18
**Branch:** `compare-with-prod`
**Supersedes:** the harness-only record in `2026-08-14-compare-harness.md` (still accurate
for the proxy rationale; the surface and the production route have since changed).

## What changed since 2026-08-14

The comparison moved from a page-level surface in the harness into the **widget itself**, and
production is now reachable two ways rather than one.

| | 2026-08-14 | now |
|---|---|---|
| Surface | two columns on the harness page | toggle in the widget header, column inside the widget |
| Production route | `/prod` proxy only | direct when the origin is approved, else `/prod` |
| Conversation | single answer, replaced each turn | running log, full history sent each turn |

## Production is reachable directly from Jahia — no proxy needed there

Verified live from `https://tmp-content-eng-algolia.cloud.jahia.com` (the real page origin, no
spoofing): a POST to the production agent returned **200 and streamed**. The Jahia dev host is on
production's approved-domains list, so on Jahia the companion calls production directly — no
proxy, no Origin injection, no mixed content.

`localhost` is *not* on that list (403 `Request blocked for this domain`), so the local harness
still needs `proxy.mjs`, which injects `Origin: https://www.algolia.com`. The authorization basis
for that injection is unchanged and is recorded in the 2026-08-14 file.

Selection is automatic: set `window.ACS_COMPARE = { prod: { appId, apiKey, agentId } }` before the
companion loads and it calls production directly; with no config it POSTs to `/prod`.

## How the widget is loaded on Jahia (verified 2026-08-18)

Five scripts from `/files/live/sites/www/files/`, injected by the custom-code block:
`algolia-chat-theme-algolia-modal-greeting-width-20260815a.js`, `algolia-confidence-badge.js`,
`algolia-chat.js?chat=20260818-runtime-x`, `algolia-chat-engage.js`, `algolia-chat-form-tool.js`.

Credentials sit on the **`<algolia-instant-search>` wrapper** (`app-id`, `api-key`, `index-name`),
not on `<algolia-chat>`. The concierge agent is declared as
`<algolia-agent role="primary" agent-id="e2c8596a-…">`, with the four judges under
`<algolia-chat-confidence>`.

The live Jahia bundles are **newer than this repo's snapshots** — only `algolia-chat-form-tool.js`
matches by hash. `frontend/chat-widget/` remains "recovered artifacts"; the widget's source of
truth is `smomin/algolia-central-chat-widget`. The companion does not depend on the match: it
attaches through the stable public `part=` contract, and those hooks were confirmed present in the
live `20260818` build.

## Three defects found and fixed while testing against the current build

1. **`reconcile()` starved itself.** It called `cancelAnimationFrame` then rescheduled, so under
   the widget's continuous mutations every call cancelled the previous and the callback never ran —
   the toggle never appeared on expand. Now coalesced with a pending flag.
2. **The toggle's click listener was lost.** React re-renders the header and clones the button:
   markup survives, listeners do not, and the lookup then reused the dead clone forever. Clicks are
   handled by one delegated listener on the shadow root.
3. **The button rendered as a 28×28 icon.** The widget ships
   `[part="header"] > div button { width/min-width/height: 28px !important }`. No inline style beats
   `!important`, so the toggle is mounted as a *direct header child* — where that selector cannot
   match — and styled from a scoped stylesheet.

## Layout

The column is mounted inside `[part="chat-content"]` and positioned absolutely from header-bottom
to composer-top, so it sits within the widget's rounded container. Only the messages scroller is
inset; padding `chat-content` itself would shrink the header and composer, which is what made the
panel look bolted on.

Measured with the widget expanded: chat-content 1035px, production 518px, conversation 518px —
an even **50/50** split, with header 999px and composer 971px still spanning full width.

## Verification (local harness, 2026-08-18)

- Toggle hidden while docked, appears on expand, flips state, hides again on collapse.
- One question fans out to both agents: concierge left (sources + judge badge), live production
  right with its own source chips.
- Multi-turn memory confirmed at the protocol level: with a stable conversation id and the full
  history, turn 2 *"How do I install it?"* correctly answered about `react-instantsearch` —
  resolvable only if turn 1 was remembered.
- Fresh-clone path: with the gitignored override absent, `node proxy.mjs` serves the committed
  `harness.html` (HTTP 200).
- Repo hygiene: no search key in any tracked file; `.env.local` and `*.local.html` stay ignored.

## Not verified here

- Full in-browser two-turn compare on Jahia. The toggle was injected into the live Jahia widget and
  rendered correctly in the header (Level 0 console injection, reverted by reload); the question
  fan-out there was not exercised.
- Answer-quality scoring. No judging runs in compare mode, by design.
