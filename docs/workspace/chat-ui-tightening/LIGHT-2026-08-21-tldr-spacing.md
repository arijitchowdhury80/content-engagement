# TL;DR Details Spacing

## Classification

Light path. This is a frontend presentation-only adjustment to spacing between the TL;DR tile and Details label in the existing chat answer rendering. It does not change prompts, streaming, progress logic, source rendering, follow-up extraction, APIs, schema, or dependencies.

## Plan

- Increase only the TL;DR-to-Details vertical spacing.
- Limit the TL;DR/Details treatment to the first primary answer in a conversation; later turns render as flat answers.
- Preserve the analogy canvas treatment inside the TL;DR tile by styling only the first TL;DR paragraph as the analogy block.
- Strengthen the focused regression test so the spacing is explicit.
- Add a multi-turn regression test so only one TL;DR tile appears in a two-turn conversation.
- Add an analogy regression assertion so the first TL;DR paragraph remains italic/editorial while the next TL;DR paragraph remains normal prose.
- Run widget syntax and targeted chat tests.
- Deploy through the existing Jahia immutable asset flow only after tests pass.

## Rollback

Redeploy the previously active Jahia bundle `algolia-chat-judge-v2-c4e7b6b8b0cf.js`, or revert the two class changes in `frontend/chat-widget/algolia-chat.js` and redeploy.
