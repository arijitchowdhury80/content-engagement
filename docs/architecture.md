# Content Engagement 2.0 architecture

Content Engagement is delivered to a customer as one self-contained JavaScript file. The file registers `<algolia-chat>` and contains the shared widget engine plus the selected Algolia implementation. Customers do not assemble internal modules.

```text
source/shared/core         immutable answer/evidence identity and lifecycle
source/shared/widget       normalized view model + renderer placement
            │
            ▼
source/algolia-com/code/runtime
                          readable Agent Studio runtime + semantic widget
source/algolia-com/code    context, proactive, handoff, judges, telemetry,
                          Compare, persistence, forms, transport policy
source/algolia-com/presentation
                          theme compiler, token CSS, Algolia assets, labels and visual treatment
            │
            ▼
source/algolia-com/web-component
                          <algolia-chat> compatibility facade
            │
            ▼
source/algolia-com/entry.ts
            │ deterministic Vite IIFE build
            ▼
dist/content-engagement.<hash>.js
```

## Boundary rules

- Shared source contains only brand-neutral answer contracts and placement primitives; it cannot import `algolia-com` source.
- Presentation contains visual treatment only; it cannot create semantic regions, fetch, read/write storage, execute judges, retrieve telemetry, route conversations, decide consent, or mutate conversation state.
- Algolia behavior may consume shared contracts but cannot make shared code Algolia-specific.
- Contributors emit immutable answer state. They do not append, move, or replace answer-footer DOM.
- The shared renderer owns semantic region placement. The web-component view adapter renders Algolia-specific semantic descendants without behavior; the presentation layer owns how they look.
- One four-part identity—widget, conversation, answer segment, network attempt—guards every asynchronous update.
- Visible sources and judge evidence derive from one canonical evidence lineage.

The flat JavaScript files in `frontend/chat-widget/` remain temporary compatibility and rollback inputs during migration. The target source is under `frontend/chat-widget/source/`; `dist/` is generated and never edited.
