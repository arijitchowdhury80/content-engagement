# Design thinking

- Mental model: Compare is a conversation-level mode; token usage is supporting metadata for the
  running conversation.
- Information hierarchy: primary answers and Production comparison are Primary. Token totals and
  Compare lock help are Supporting.
- Happy path: start conversation, enable Compare, ask, receive both answers, then see token totals.
- Common actions: enable Compare, ask a question, start a new conversation.
- States: telemetry has absent/loading/success/unavailable states; Compare has off/on/locked/error.
- Cognitive load: no new panel. One compact token pill and one contextual lock message.
- Emotional goal: remove ambiguity—users should know whether comparison is on, why it is locked,
  and whether telemetry is still loading or unavailable.
- Aesthetic: retain the existing Algolia widget tokens and confidence-badge pattern; do not add a
  second design system.
