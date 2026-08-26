# Migration answer: development versus production

Date: 2026-08-25
Question: `If I am on a competing platform today, what does migration actually look like?`
Method: Live answer-scoped Compare feature; the finalized development request was replayed to
Production Ask AI. Production remained read-only comparison evidence.

## Retrieval observations

| Observation | Development concierge | Production Ask AI |
|---|---:|---:|
| App | `0EXRPAXB56` | `1QDAWL72TQ` |
| Search index/tool | `Algolia_Prod_Copy_Vanilla` | `algolia_www_prod_v2` |
| Search-tool calls | 1 | 2 |
| Distinct retrieved records observed in SSE | 18 | 36 |
| Answer text characters | 2,613 | 2,038 |

Production inspected its first retrieval, stated that migration guidance was thin, and performed a
second, narrower retrieval. Development stopped after one mixed result set even though its prompt
already says not to accept the first set blindly.

At capture time, the development search tool was configured with `hitsPerPage: 5`, an 80-character
description snippet, and only `objectID`, `title`, `url`, `source`, and `category` as retrieved
attributes. Those synthetic restrictions were removed on 2026-08-26: live readback now reports
`null` for `hitsPerPage`, `attributesToRetrieve`, and `attributesToSnippet` while preserving the
Vanilla index and English production-content filter.

Follow-up readback on 2026-08-26 used the previously supplied Visibility credential rather than the
browser search key and retrieved the live production agent definition. Production has one 6,662-
character `instructions` prompt (SHA-256
`dd7bb54e65e0250f6a73b06d9622968d3bb73db16711cf31911f81396a36476f`), no custom
`systemPrompt`, model `claude-haiku-4-5-20251001`, one search tool on
`ALGOLIA_WWW_PROD_V2`, and `searchParameters: null`.

The production prompt mandates at least one concise 3–8-keyword search before factual answers but
does not instruct the agent to perform two searches or inspect and refine the first result set. The
development prompt does explicitly contain an inspect-and-refine rule. Therefore the observed
two-search production response cannot be attributed to a two-search production prompt. Possible
causes include model behavior, corpus/results, tool descriptions, configuration, or generation
variance.

The capture did not record comparable duration or first-token timing. No production-versus-
development speed conclusion is supported by this run.

## Qualitative result

The user's production sample is more complete across the migration lifecycle: schema mapping,
index/settings translation, frontend integration, analytics/events, validation, phased cutover, and
effort drivers. The development sample is better presented but compresses migration into ETL plus a
clean-slate recommendation and omits several operational phases.

The live repeat did not reproduce the same production prose quality, which proves that one paired
answer is not a stable benchmark. The durable advantage observed in the mechanism was iterative
retrieval, not guaranteed superiority on every generation.

Development also emitted claims with weak or indirect authority, including a generic homepage link
for a named feature. Its three internal judges disagreed sharply on grounding in the live repeat,
which is another signal that answer polish is outrunning evidence discipline.

## Discovery comparison

- Development asks one broad stack question. Cardinality is correct, but the highest-value first
  missing fact should be the current competing platform.
- The user's production sample asks platform, record count, and customization in one question. It is
  richer as intake but violates the one-item discovery protocol.
- Production retrieval depth should be learned from; its bundled discovery question should not be
  copied.

## Two required rectification tracks

1. **Retrieval and answer completeness:** use a migration coverage plan, run a focused second search
   when the first set does not cover the required phases, retrieve richer evidence economically, and
   verify every stage before writing.
2. **Discovery progression and terminal stability:** ask one highest-value missing fact from full
   history, do not offer actions before readiness, and fix the blank specialist completion observed
   in the six-turn run.

Private capture: `/private/tmp/algolia-migration-compare-analysis-20260825.json`.
