# Orchestrator Prompt v008 Mutation Packet

Date: 2026-08-12

## Target

- App: `0EXRPAXB56`.
- Agent: `www Chat - Orchestrator`.
- Agent ID: `e2c8596a-4420-41d2-80bb-5cd4aaeffda6`.
- Field changed: `instructions` only.
- Production Ask AI: read-only, not touched.

## Current Value

- Snapshot: `docs/research/search-experience/workstream-1-agent-studio-orchestrator-prompt-before-v008-2026-08-12T20-58-56-3NZ.json`.
- `systemPrompt` length: 2,764.
- `instructions` length: 8,159.
- Current prompt contains `## Link Rules`.
- Current prompt contains mechanical URL rewriting language for `](/...)`, homepage placeholders, and allowed-host scanning.
- Native suggestions remain disabled.
- Guardrails remain enabled.

## Intended Value

Replace the current answer-quality prompt with:

- Candidate: `docs/design/search-experience/discovery-engagement/prompt-experiments/orchestrator-answer-quality/candidates/v008-inline-authority-no-url-lipstick/prompt.md`.
- `instructions` length: 7,031.
- Removes the entire `## Link Rules` section.
- Removes final mechanical checks that make the model rewrite relative URLs.
- Keeps inline authority behavior: link retrieved evidence inline, do not citation-launder, do not use placeholder/generic homepage links, and do not attach nearby-but-wrong sources.
- States that public URL normalization belongs to retrieval/runtime, not answer-time guessing.

## Rollback

Restore `instructions` from the before snapshot with:

`PATCH /agent-studio/1/agents/e2c8596a-4420-41d2-80bb-5cd4aaeffda6`

using the same preserved `systemPrompt`, `model`, `providerId`, `tools`, and `config`, but with the previous `instructions`.

## Validation

1. Read back the agent.
2. Assert:
   - `systemPrompt` unchanged.
   - `instructions` contains `Superior Answer Contract v008`.
   - `instructions` does not contain `## Link Rules`.
   - `instructions` does not contain `Mechanical rule`.
   - `instructions` does not contain `If a retrieved URL is relative`.
   - native suggestions remain disabled.
   - guardrails remain enabled.
   - tool count remains 3.
3. Run approved-origin smoke tests:
   - factual feature answer searches first.
   - answer uses inline evidence links where supported.
   - prompt/config reveal remains blocked.
4. Separately track URL normalization as data/tool-layer work; do not treat this prompt patch as the final URL correctness fix.
