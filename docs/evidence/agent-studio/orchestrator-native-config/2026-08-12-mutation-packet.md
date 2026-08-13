# Orchestrator Native Config Mutation Packet

Captured: 2026-08-12

## Correction

Superseded on 2026-08-12: the intended value below incorrectly included native follow-up prompt suggestions. That is wrong for this discovery concierge.

Correct behavior: `config.suggestions.enabled: false`. The agent should ask at most one thoughtful, grounded discovery question inside its answer when useful; Agent Studio should not emit native prompt-suggestion chips.

## Approval

Arijit explicitly approved implementation in-thread with: "PLEASE IMPLEMENT THIS PLAN".

## Target

- App: `0EXRPAXB56`
- Agent: `www Chat – Orchestrator`
- Agent ID: `e2c8596a-4420-41d2-80bb-5cd4aaeffda6`
- Environment: development `www` Agent Studio agent used on the parallel algolia.com/Jahia test surface
- Production `[Prod] Algolia.com Website Search/Chatbot`: read-only reference, not modified

## Current Value

Raw rollback snapshot is gitignored:

- `docs/research/search-experience/workstream-1-agent-studio-orchestrator-before-2026-08-12T19-30-52-355Z.json`

Public-safe summary:

- Status: `published`
- Provider: `0c6a0843-caf0-4246-b2a1-7cc08d06a7db`
- Model: `medium`
- Instructions length: `10353`
- Config keys: `memory`, `suggestions`, `enableAlgoliaMcp`
- Guardrail: absent
- Approved domains: empty list

## Intended Value

- Preserve provider `0c6a0843-caf0-4246-b2a1-7cc08d06a7db` and model `medium`.
- Replace the long orchestrator prompt with the approved concise system prompt.
- Preserve `config.enableAlgoliaMcp: true`.
- Preserve `config.memory.enabled: true`.
- Add `config.max_tokens: 3000`.
- Add `config.max_iterations: 20`.
- Add `config.thread_depth.max_messages: 100`.
- Add per-agent rate limit `1000` requests per `60` seconds.
- Add per-IP rate limit `200` requests per `60` seconds.
- Configure native follow-up prompt suggestions: superseded. Corrected value is disabled because this concierge should lead discovery inside the answer instead of asking the visitor to pick suggested prompts.
- Enable guardrails with provider `0c6a0843-caf0-4246-b2a1-7cc08d06a7db`, model `medium`, `required:false`, concierge-broad scope, and five categories:
  - `off_topic_content`
  - `silly_requests`
  - `prompt_injection_or_secrets`
  - `unsafe_or_adult_content`
  - `unsupported_business_claims`
- Add approved domains:
  - `*.algolia.com`
  - `*.cloud.jahia.com`
  - `temp-production-algolia.cloud.jahia.com`

## Rollback

- Restore the full agent body from the raw rollback snapshot via `PATCH /agent-studio/1/agents/{agentId}`.
- Delete all approved-domain IDs added in this change via the allowed-domains delete endpoint.
- Read back the agent and allowed domains to confirm instructions length, config keys, guardrail absence, and empty domains match the before-state summary.

## Validation

- Read back agent config and allowed domains after mutation.
- Confirm provider/model remain in-house.
- Confirm new prompt length is shorter and source-authority/personality language is present.
- Confirm guardrail categories round-trip.
- Confirm native suggestions are disabled, and cost controls, rate limits, memory, and MCP round-trip.
- Confirm approved domains round-trip.
- Run completion smoke tests for:
  - allowed Algolia overview
  - implementation guidance
  - pricing/demo routing
  - prompt-reveal refusal
  - unrelated product search refusal
- Because Agent Studio completions cache exact query text, use fresh wording in validation prompts.

## Notes

The repo-local Agent Studio README says patching existing published agents is effectively live and `POST /publish` on an already-published agent may return HTTP `409`. This implementation treats `PATCH` as the live dev mutation and verifies by readback and smoke tests.
