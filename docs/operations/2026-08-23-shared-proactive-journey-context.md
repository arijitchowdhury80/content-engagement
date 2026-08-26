# Shared Proactive Journey Context

## Classification

Full contract change. This work changes the internal handoff payload shared by
the Proactive Greetings Agent and the Orchestrator, but does not change a public
API, Agent Studio configuration, trigger thresholds, retrieval tools, or the
rendering pipeline.

## Root Cause

The controller produced a rich `ProactiveGreetingRequest.v1`, but the browser
handoff reduced it to `requestSummary` before the Orchestrator received it. The
reduction removed the qualified origin/destination edge, full journey trail,
contextual focus, and other confirmed fields. The Orchestrator therefore had to
infer relationships from incomplete ingredients and could misread a discovery
chip as a request for a substantive sourced answer.

## Contract

- The controller adds one canonical `journeyContext` object to the greeting
  request. It deterministically identifies `origin`, `destination`, the current
  navigation edge, the broader journey, and `journeyNarrativeHint`.
- The Greetings Agent uses that packet for one greeting and optional chips.
- The browser handoff forwards the exact original `requestPacket` unchanged,
  then adds the generated greeting, all offered chips, selected chip or typed
  response, and current turn context.
- The Orchestrator treats the visible response as primary intent, the selected
  chip as the chosen path, the greeting as prior assistant framing, unselected
  chips as unchosen alternatives, and the original request packet as confirmed
  journey context.
- No reconstructed request summary is permitted. A proactive handoff without
  the complete canonical request packet fails before the Orchestrator call.

## Discovery-Only Turns

Requests such as `Help me define my use case` are disclosure or definition
turns. They should receive a concise acknowledgment and exactly one focused
discovery question. They do not need retrieval or source UI unless the answer
introduces factual Algolia, customer, metric, product, or implementation claims.

## Risk And Rollback

Risk is additional handoff payload size and model ambiguity. Mitigations are the
unchanged canonical packet, explicit field precedence in both prompts, and
regression tests. Rollback is the last known-good release of the complete
packet contract; the former lossy summary path must not be restored.

## Prevention Heuristic

When two agents share context, forward one canonical immutable packet and append
interaction fields. Never reconstruct a lossy summary at the handoff boundary.

## Release Boundary

The shared-packet release was approved and deployed on 2026-08-23.

## Deployment

- Agent Studio Greetings and Orchestrator prompts were applied, read back, and
  validated. The sanitized release record is
  `docs/evidence/deployments/2026-08-25-current-jahia-development-release.md`;
  private raw evidence is retained in the owner-only cleanup archive.
- Jahia release `20260823-shared-packet-a` published the scoped proactive
  controller and a content-hashed immutable handoff asset. The chat renderer,
  tracker, compiler, engage runtime, theme, and unrelated subtrees were not
  mutated.
- Jahia required `subtree=True` at the custom block itself for its child
  properties to reach LIVE. The recovery remained scoped to
  `/sites/www/home/drift/custom-code-block`; it did not publish the parent
  drift or files subtrees.
- The sanitized Jahia apply/readback result is recorded in
  `docs/evidence/deployments/2026-08-25-current-jahia-development-release.md`.

## Hosted Validation

- The hosted B2 Solution to Customer Proof journey passed end to end. The
  compact result remains here; private screenshots and traces are retained in
  the owner-only cleanup archive.
- Reset, source greeting, destination transition greeting, handoff, one
  Orchestrator request, one discovery question, source rendering, and
  conversation continuity all passed.
- The Orchestrator request contained exactly one `PROACTIVE_HANDOFF_CONTEXT`
  with the canonical `requestPacket`, greeting, all chips, visitor response,
  journey context, and current navigation edge.
- The automated hosted run used a typed visitor response. The selected-chip
  branch remains a separate manual validation target.
