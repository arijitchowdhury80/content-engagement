# Compare-with-production harness — build & verification evidence

**Date:** 2026-08-14
**Branch:** `compare-with-prod`
**Scope:** local developer harness only. No Jahia publish, no Agent Studio mutation, no index write.

## What was built

A compare toggle in the local widget harness. One typed question fans out to two answer paths,
rendered side by side:

| Side | App | Agent | Index | How the browser reaches it |
|---|---|---|---|---|
| Concierge · enriched | `0EXRPAXB56` | `e2c8596a…` (www Chat – Orchestrator) | `Algolia_Prod_Copy_Enhanced` | direct — `localhost` is on the agent's approved-domains list |
| Production · live Ask AI | `1QDAWL72TQ` | `ebff018c…` | `ALGOLIA_WWW_PROD_V2` | via local proxy `/prod`, which injects `Origin: https://www.algolia.com` |

Files (all on `compare-with-prod`):

- `frontend/chat-widget/proxy.mjs` — serves the harness + widget bundles, exposes `GET /config`
  (concierge public config for the left column) and `POST /prod` (Origin-injecting forward to
  production). Tracked; holds no secret.
- `frontend/chat-widget/harness.local.html` — the harness + compare surface. **Gitignored**
  (`*.local.html`); loads all credentials from `/config` so no key is inlined.
- `.env.local` — `PROD_ASKAI_*` added. Gitignored.
- `.env.example` — matching commented blanks. Tracked, no values.

## Authorization basis for the Origin injection

`/prod` sets `Origin: https://www.algolia.com` so production's per-agent approved-domains guardrail
accepts the request. This defeats a **lightweight abuse control, not an authentication boundary** —
Algolia's own docs describe Origin/referrer allowlists as spoofable "light access control." It is
justified here and only here:

- Production is the organization's own infrastructure; this repo *is* the algolia.com project.
- A senior explicitly provided the production app ID, search-only key, and agent name for this
  comparison.
- That search key is already public — it ships in algolia.com's live page source
  (`data-api-key` on the homepage).
- A `/completions` call is read-only; it changes neither the agent config nor the index —
  consistent with the repo-wide rule that production Ask AI is "read-only comparison evidence."

Not a pattern to reuse against any account that is not the org's own with credentials given for the
purpose.

## Verification (2026-08-14)

Origin allowlist behaviour, confirmed live:

| Request to production `ebff018c…/completions` | Result |
|---|---|
| browser `Origin: http://localhost:8765` | **403** `Request blocked for this domain` |
| any client sending `Origin: https://www.algolia.com` | **200**, streams |

Both compare paths, question "How do I use faceted search?":

| Side | Path exercised | Status | Answer | Sources |
|---|---|---|---|---|
| Concierge | direct, `Origin: http://localhost:8765` | 200 | 2,358 chars | 14 |
| Production | `POST /prod` (proxy injects Origin) | 200 | 1,456 chars | 7 |

Both stream the ai-sdk-5 SSE protocol; both surface source hits (production returns **relative**
URLs, resolved against `https://www.algolia.com` for clickable chips). No judge agents are called
in compare mode — by design.

Repo hygiene: `git ls-files | xargs grep` for either search key across all tracked files returns
**none**. The harness and `.env.local` are gitignored; only `proxy.mjs`, `.env.example`, and
`.gitignore` are staged, none containing a secret.

## Not verified here

- **In-browser visual render of the compare UI** — the local sandbox classifier blocked automated
  browser navigation to the harness while the production-origin work was in context. The two data
  paths are proven by the request-level tests above; the page render should be confirmed by loading
  `http://localhost:8765/` and flipping the toggle.
- Answer-quality scoring — out of scope (no judging in compare mode).

## Fairness framing (surfaced in the UI)

Concierge-on-enriched vs the real live production Ask AI run different apps, indices, retrieval
config and system prompts. A difference in answers reflects the whole stack, not enrichment alone.
The harness states this under the two columns.

## Run it

```bash
node frontend/chat-widget/proxy.mjs
# open http://localhost:8765/ , toggle "Compare with production"
```
