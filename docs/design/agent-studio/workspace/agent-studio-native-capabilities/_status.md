# Agent Studio Native Capabilities Workspace

Status: strategy drafted

Last updated: 2026-08-12

## Artifacts

- `docs/design/agent-studio/workspace/agent-studio-native-capabilities/01-strategy.md`
- `docs/evidence/agent-studio/safety-controls/workstream-1-agent-studio-capability-audit.md`
- `docs/evidence/agent-studio/customization/production-conversation-features.png`
- `docs/evidence/agent-studio/customization/production-user-interface.png`
- `docs/evidence/agent-studio/customization/production-advanced-settings.png`
- `docs/evidence/agent-studio/customization/production-follow-up-suggestions-modal.png`

## Decisions

- Use Agent Studio native controls before prompt expansion.
- Treat guardrails as category classifiers and blockers, not grounding guarantees.
- Treat approved domains as the highest-priority native security gap.
- Keep grounding as a combined tool, runtime, prompt, and eval contract.
- Apply the control pattern to the agent family, not only `www Chat – Orchestrator`.

## Next Gated Action

Prepare approval packets for Agent Studio mutations, starting with approved domains and guardrails. No mutation should occur until Arijit approves the packet with target, current value, intended value, rollback, validation, and blast radius.
