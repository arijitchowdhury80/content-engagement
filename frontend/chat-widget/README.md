# Chat Widget

This directory is the project home for Algolia.com chat widget JavaScript.

## Current State

These are the project-owned JavaScript files for the current Jahia chat widget work. Keep the
editable files directly in this folder so they are easy to find and review.

Use `dist/` only for generated packages, zips, or dated release bundles. Do not put the editable
source under a dated `dist/<date>/local-reference/` tree again.

## Recovered Artifacts

- `algolia-chat.js` — chat custom element bundle.
- `algolia-chat-engage.js` — proactive engagement script.
- `algolia-engagement-tracker.js` — engagement tracker for profile, session, and event signals.
- `algolia-context-compiler.js` — compiles tracker state into Agent Studio per-turn context.
- `algolia-proactive-controller.js` — evaluates journey triggers and emits proactive opportunity packets.
- `algolia-chat-form-tool.js` — lead form client tool.
- `algolia-chat-theme-algolia.js` — Algolia brand theme.
- `algolia-confidence-badge.js` — confidence badge bundle.
- `algolia-chat-jahia-20260812-wip.js` — combined Jahia WIP bundle retained for comparison.
