# Proactive Chip Epistemic Discipline

## Scope

Light-path prompt correction for Solution to Customer Proof greetings. No
runtime, controller, handoff, rendering, Jahia, or orchestrator behavior is in
scope.

## Root Cause

The canonical Greetings Agent instructions still taught the model to emit
action chips that assumed unknown visitor facts. Because a chip is submitted
verbatim as the visitor's next message, those labels both overclaimed context
and produced an ambiguous handoff turn.

## Canonical Fix

- Treat use case, KPIs, stack, scale, goals, and decision criteria as unknown
  unless the proactive packet explicitly confirms them.
- Require every chip to read naturally as a visitor-authored message.
- Use open discovery choices such as `Help me define my use case` and
  `Which KPIs should I measure?`.
- Use observed packet context dynamically for proof choices, for example
  `Show me comparable Grocery proof` when Grocery is present in the packet.
- Remove the stale phrases from prompt context entirely.

## Local Verification

`node --test frontend/chat-widget/tests/proactive-journey-prompt-examples.test.mjs frontend/chat-widget/tests/proactive-journey-contract-consistency.test.mjs`

The focused suites pass seven of seven tests, including a regression assertion
that prevents the stale chip language from returning.

## Release Boundary

Published on 2026-08-21 to Agent Studio agent
`0f290529-629a-48fe-9424-f93e5894d8f3` (`www Chat - Proactive Concierge`)
after explicit approval.

The release followed snapshot, dry-run, approval, apply, readback, and smoke
verification. Private before/after snapshots are stored outside the repository
under `~/.codex/private/algolia-com/agent-studio/proactive-chip-20260821/`.

Readback evidence:

- Agent prompt before SHA-256:
  `1be03560d68adf584314b65469b517915938064f0a8610029bbb59db1bb20120`
- Agent prompt after SHA-256:
  `1c2d92ec46d180e33d06ce604ff7f684cc22ffc14968da3b41d16ad6e72133fc`
- System prompt before SHA-256:
  `433179b3269449fe3162ff35167c39f1a654a63b5fbf83a959f2618a29730b92`
- System prompt after SHA-256:
  `8f7e1d5dc5f682798715db59fead29f3b87a6f956722d31756bc2c4718407fae`
- Agent remained published after save.
- That release preserved the then-current `10s_50_scroll` labels. The active
  runtime contract now uses the canonical 3-second dwell and 30% scroll
  threshold documented in `2026-08-23-proactive-threshold-3s-30.md`.

The published Agent Studio smoke request for Grocery customer proof returned:

- `Share my use case`
- `Choose the right KPIs`
- `Find similar Grocery proof`

The generated greeting connected Grocery and H-E-B context while treating the
visitor's use case and KPIs as unknown.

## Follow-Up Correction

Subsequent review found that `Share my use case` still asks the visitor to
disclose a use case that may not yet be formed. The canonical prompt now uses a
more open discovery posture:

- `Help me define my use case`
- `Which KPIs should I measure?`
- `Show me comparable Grocery proof`

The corresponding greeting invites the visitor to define the use case, decide
which KPIs matter, or inspect comparable proof. This follow-up correction is
local only until a separate Agent Studio snapshot, dry-run, approval, apply,
readback, and smoke verification are completed.

Rollback: restore the private before snapshots through the same Agent Studio
save-and-readback sequence.

## Prevention Heuristic

When a chip is rendered, read it as the visitor's next message. If it assumes
information the packet has not established, rewrite it as a disclosure,
definition, or discovery intent before publishing.
