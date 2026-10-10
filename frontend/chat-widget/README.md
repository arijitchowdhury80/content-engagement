# Content Engagement chat widget

This directory owns the readable source, compatibility tests, and generated local release for `<algolia-chat>`.

## Ownership

- `source/shared/core/` owns immutable answer/evidence identity and lifecycle contracts.
- `source/shared/widget/` owns normalized presentation state and renderer-owned DOM placement.
- `source/algolia-com/code/runtime/` is the recovered readable Agent Studio runtime and semantic widget implementation. It is Algolia-owned because it includes transport, judging, visitor intelligence, and proactive policy.
- `source/algolia-com/code/` owns Algolia journeys, context, transport policy, judges, telemetry, Compare, persistence, forms, and handoff behavior.
- `source/algolia-com/presentation/` owns the theme compiler, token CSS, Algolia visual rules, and assets only.
- `source/algolia-com/web-component/` owns the Algolia web-component facade, compatibility surface, and Algolia-specific semantic view adapters. Shared renderers still own region placement; these adapters may render visual descendants but cannot perform transport, storage, judging, tracking, or conversation mutation.
- `source/algolia-com/entry.ts` is the complete and explicit customer bundle entry.
- `tests/` is a development safety harness and is never loaded by customers.
- `dist/` is generated, ignored, and never edited as source.

Shared code cannot import Algolia-owned code. Presentation cannot perform transport, storage, judging, telemetry retrieval, routing, consent decisions, or conversation mutation.

The current flat JavaScript files remain temporary compatibility and rollback inputs until every host has migrated to the verified source-built artifact. They are not canonical editable 2.0 source.

## Compatibility files

The flat files remain rollback-compatible outputs while their readable canonical homes are:

| Current compatibility file | Canonical editable source |
|---|---|
| `algolia-chat.js` | `source/algolia-com/code/runtime/` plus `source/algolia-com/web-component/` |
| `algolia-chat-engage.js` | `source/algolia-com/code/chat-engage.js` |
| `algolia-engagement-tracker.js` | `source/algolia-com/code/engagement-tracker.js` |
| `algolia-context-compiler.js` | `source/algolia-com/code/context-compiler.js` |
| `algolia-proactive-controller.js` | `source/algolia-com/code/proactive-controller.js` |
| `handoff-to-orchestrator.js` | `source/algolia-com/code/handoff-to-orchestrator.js` |
| `algolia-chat-form-tool.js` | `source/algolia-com/code/chat-form-tool.js` |
| `algolia-judge-core.js` | `source/algolia-com/code/judge-core.js` and `source/algolia-com/code/runtime/judge/` |
| `token-telemetry.js` | `source/algolia-com/code/token-telemetry.js` |
| `algolia-chat-compare.js` | `source/algolia-com/code/chat-compare.js` |
| `algolia-chat-theme-algolia.js` | `source/algolia-com/presentation/theme-algolia.js` and `source/algolia-com/presentation/widget/` |
| `algolia-confidence-badge.js` | `source/algolia-com/presentation/confidence-badge.js` |
| `answer-harness-runtime.mjs` | compatibility loader for `source/algolia-com/web-component/answer-runtime-bridge.mjs` |

New behavior is changed in canonical source first. Compatibility outputs are retained only until every host consumes the source-built release.

## Local verification

```bash
npm run typecheck
npm run test:source
npm run build:verify
```

The canonical browser tests create their own approved host fixture and exercise the generated one-file bundle. They do not use a parallel widget implementation or require Jahia.
