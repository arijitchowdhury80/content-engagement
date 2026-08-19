# Compare-with-production — revisions after PR review

**Date:** 2026-08-19
**Branch:** `compare-with-prod`
**Supersedes deployment details in:** `2026-08-14-compare-harness.md` and
`2026-08-18-in-widget-compare.md`. Those two describe a standalone harness
(`frontend/chat-widget/harness.html`) and a standalone proxy
(`frontend/chat-widget/proxy.mjs`). **Both files are deleted.** Compare now runs in the
existing parity environment and the existing parity server.

## What changed

| | before review | now |
|---|---|---|
| Local surface | separate `harness.html` | `local-sites/algolia-com-parity/index.html` |
| Local production route | separate `proxy.mjs` server | `POST /__compare/production` in `tools/local_chat_parity_server.py` |
| Left-side runtime | hardcoded `Algolia_Prod_Copy_Enhanced` in the proxy | whatever the host page configured on `<algolia-chat>`; Compare owns only the production side |
| Jahia | not wired | manifest marker, deploy script upload/publish/validate/rollback, custom-code block tags |
| Lifecycle | replayed bubbles, no abort, no ordering guarantee | selected before turn one and fixed, no replay, sequential turns, abort + stale rejection on reset |
| Source links | URL interpolated into `innerHTML` | parsed, `http:`/`https:` only, built with DOM properties |

## Two review premises corrected against the code

The review asked for two named APIs that do not exist in this repository. The intent was
implemented against the real mechanisms:

1. **"Do not register another `setOrchestratorTransport`."** No such function exists
   anywhere in the tree. `handoff-to-orchestrator.js` owns the orchestrator path through a
   **fetch interceptor** (`installFetchInterceptor`), which decorates a request only when
   `agentIdFromUrl(input) === primaryAgentId()`. Compare targets a different agent on a
   different application, so its requests fall through `originalFetch.apply` untouched.
   Compare also never assigns `window.fetch`; a regression test asserts both.

2. **"Use the existing `algolia-visitor-reset-requested` event."** The event dispatched by
   `algolia-engagement-tracker.js` is **`algolia-visitor-state-reset`**
   (`detail: { source, at }`). Compare listens for that name, with the DOM signal (all user
   bubbles gone) as the documented fallback.

## Test coverage

`frontend/chat-widget/tests/algolia-chat-compare.test.mjs` — 18 tests, all passing under the
repo's existing runner (`npm run test:chat-widget`):

- Compare off never calls production; enabling never replays existing bubbles.
- Two turns run in order; turn two carries turn one's user + assistant messages, under a
  stable conversation id.
- The choice is fixed once a question is asked, and selectable again after reset.
- Reset clears history, mints a new conversation id, advances the generation counter, and a
  response that lands after the reset is discarded.
- A production failure is contained and never rejects.
- `window.fetch` is not patched (proactive-handoff compatibility).
- `javascript:` and `data:` source URLs are dropped; relative URLs resolve to algolia.com;
  markdown escapes HTML and refuses unsafe link protocols.
- Narrow widths stack (padding-bottom) instead of splitting (padding-right).
- Jahia: the block transform adds the config and module exactly once and is idempotent;
  config precedes module; the deploy script snapshots, uploads, publishes, hashes, validates
  EDIT/LIVE and documents rollback; the production key is never a literal in source.

Parity-server guards verified separately: namespaced route, 256 KB body cap, loopback bind,
POST + `application/json` only, key resolved from env/`.env.local`, no key literal in source.

## Two bugs the tests caught

1. **The toggle never repainted when it locked.** `reconcile()` paints the toggle *before*
   `scanForNewQuestions()` sets `locked`, so the disabled state only appeared on some later
   mutation-driven pass. Now repainted at the moment of locking.
2. **A no-op `MutationObserver` in the first harness hid a missing turn.** Made faithful —
   DOM mutations notify observers as the browser does — which is what surfaced bug 1.

## Known, not caused by this branch

`algolia-chat-theme.test.mjs` → "Algolia theme keeps the chat panel compact and
source-grounded in the header chrome" fails on `origin/main` as well. Verified by running
that test in a clean worktree at `origin/main`. Left untouched.

## Still not verified

The full two-turn compare driven in a browser on Jahia. The toggle was injected into the
live Jahia widget and rendered correctly in the header (console injection, reverted by
reload), and the production agent returns 200 from the Jahia origin, but the end-to-end
fan-out there has not been exercised.
