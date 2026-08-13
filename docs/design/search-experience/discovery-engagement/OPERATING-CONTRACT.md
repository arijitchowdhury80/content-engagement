# Algolia.com Discovery Engagement - Operating Contract

**Status:** Active
**Last updated:** 2026-08-12

This is the deployment and runtime source of truth for the algolia.com discovery concierge.

The behavioral architecture source of truth is [CONCIERGE-BEHAVIOR-ARCHITECTURE.md](CONCIERGE-BEHAVIOR-ARCHITECTURE.md). In particular, browser collection and proactive engagement decisions are runtime responsibilities; Agent Studio `turnContext` is only the safe per-question transport.

## Hard Boundaries

1. Work is for **algolia.com only**.
2. Do not touch, use, or validate against non-algolia.com surfaces.
3. Do not change production Ask Algolia. It is a read-only competitive benchmark.
4. The only permitted app is `0EXRPAXB56`.
5. The only permitted retrieval index is `Algolia_Prod_Copy_Enhanced`.
6. `Algolia_Prod_Copy_Vanilla` is retired. It must not appear in deployment markup, scripts, tests, or recommendations.

## Agent Naming And Ownership

| Role | Contract |
|---|---|
| Primary chat agent | `www Chat - Orchestrator` |
| Visitor intelligence | `www Person - *` |
| Specialist/execution agents | `www Chat - *` |
| Answer evaluation | Separate judge layer: root `4479f02f-d5d0-4fce-a875-dafda15de166`; Skeptic `a4c3846b-e538-4c9c-8e39-1bb15a21f2c2`; Referee `c43d7374-801a-4d0f-aa09-ca12830565c3`; Advocate `f14b8ddf-2285-422c-89e5-180d7fa0b3bf` |
| Visitor-context tool | `get_visitor_profile` on the chat orchestrator |

Never confuse `www Chat - Orchestrator` with `www Person - Orchestrator`.
Never treat judges as visitor agents or specialists. They evaluate answer
grounding, coverage, depth, and relevance after the answer path. Their display
names must be verified before any future Agent Studio update; the IDs above are
the current runtime binding.

## Jahia Development Deployment

| Item | Value |
|---|---|
| Environment | `https://tmp-content-eng-algolia.cloud.jahia.com` |
| Shared template parent | `/sites/www/home/drift` |
| Custom-code block | `/sites/www/home/drift/custom-code-block` |
| Release marker | `enhanced-local-visual-parity-20260812` |
| Current chat bundle | `algolia-chat.js?citationFallback=20260812` |
| Test URL | `https://tmp-content-eng-algolia.cloud.jahia.com/cms/render/live/en/sites/www/home.html?widgetFinal=20260812` |

The custom-code block is the only allowed host-page edit surface. Do not modify the local `/tmp` host page or unrelated Jahia page content.

## Current Published Configuration

The 2026-08-12 deployment contains:

- `Algolia_Prod_Copy_Enhanced` retrieval configuration;
- Algolia visual theme and branded logo;
- `discovery-enabled="true"` and auto-engagement configuration;
- `algolia-chat-visitor`, `algolia-chat-person`, `algolia-chat-engage`, confidence judges, specialist declarations, and form-tool wiring;
- JavaScript assets uploaded and published under the Jahia development site's `/files/live/sites/www/files/` path.

It was browser-verified to open and produce a sourced answer to `What is Algolia?`.

## Evidence-Link Contract

Every grounded answer must expose clickable evidence in its answer body. The
orchestrator is instructed to use Markdown links with the exact retrieved URL.
The chat runtime enforces a fallback: when retrieved sources exist but the
model emits no Markdown links, it appends up to three canonical retrieved links
under `Supporting evidence` before the source footer.

Relative record paths must resolve against `https://www.algolia.com`; no answer
or source link may resolve against the Jahia development host. Absolute
Algolia-owned destinations such as `academy.algolia.com` and
`support.algolia.com` remain valid. This is checked with a browser turn after
every chat-bundle publish.

## Required Publish Check

Before every Jahia publish:

1. Verify app ID, index, and current JCR HTML before editing.
2. Confirm the target is the development Drift block above.
3. Update only the HTML property unless a separately approved change requires another property.
4. Publish `/sites/www/home/drift` with `includeSubTree: true`.
5. Read the LIVE JCR block back and assert: Enhanced present, Vanilla absent, expected release marker present.
6. Browser-test the rendered Jahia page with a cache-busting query string.
7. Ask a source-seeking question and assert one or more answer-body anchors;
   assert every retrieved-link destination is an Algolia-owned live host, never
   the Jahia host.
8. Record the result and any unverified capability.

## Completion Rules

Configuration or an uploaded asset is not evidence that a capability works. Independently test and record:

- visitor packet freshness and safe use on each turn;
- proactive trigger selection and suppression;
- discovery memory across turns;
- specialist selection and full-context handoff;
- judge reliability, per-judge evidence, false-positive/false-negative behavior, and explanation;
- grounded answer quality versus the Ask Algolia benchmark.
