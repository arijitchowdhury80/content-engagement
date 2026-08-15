---
name: algolia-chat-deploy
description: Deploy the Algolia.com chat stack with manifest-driven Jahia and Agent Studio validation.
---

# Algolia Chat Deploy

Use this skill before touching Jahia or Agent Studio for the Algolia.com chat stack.

## Rule

Do not rediscover deployment wiring from scratch. Read the manifest first:

```bash
config/deployments/algolia-chat-stack.json
```

Use the stack deployer:

```bash
python3 tools/deployment/deploy_algolia_chat_stack.py --target all
python3 tools/deployment/deploy_algolia_chat_stack.py --target all --apply
```

Targets:

- `--target jahia`: Jahia custom-code block and widget assets.
- `--target orchestrator`: Agent Studio orchestrator instructions and system prompt.
- `--target all`: both surfaces.

## Required Sequence

1. Run `git status --short --branch`.
2. Run the relevant tests before deploy, at minimum:

```bash
node --test frontend/chat-widget/tests/*.test.mjs
```

3. Run dry-run:

```bash
python3 tools/deployment/deploy_algolia_chat_stack.py --target all
```

4. Inspect the generated mutation packet. It must include target, current value, intended value, rollback, and validation.
5. Apply only after the mutation packet is sane:

```bash
python3 tools/deployment/deploy_algolia_chat_stack.py --target all --apply
```

6. Read validation output. Do not claim done unless every validation reports `pass: true`.
7. Verify live assets or Agent Studio readback directly when the change affects user-visible behavior.
8. Commit and push to `main`.

## Guardrails

- Production `[Prod] Algolia.com Website Search/Chatbot` is read-only comparison evidence.
- Do not edit host HTML manually unless the manifest/deployer cannot express the change and the failure is recorded.
- Do not create one-off deploy scripts for normal chat stack deploys.
- If a new asset enters the stack, update both `config/deployments/algolia-chat-stack.json` and the deployer.
- If validation fails, stop and debug the failing gate. Do not patch around it blindly.

## Evidence

The deployers write evidence under:

```bash
docs/evidence/visitor-intelligence/
docs/evidence/agent-studio/
```

Keep evidence scoped to the deployment. Do not commit `.DS_Store`, `__pycache__`, `.pytest_cache`, or local session files.
