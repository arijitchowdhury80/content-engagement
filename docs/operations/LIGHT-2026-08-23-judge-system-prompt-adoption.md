# Judge System Prompt Adoption

Date: 2026-08-23

## Classification

This is a narrow external-configuration release. The three tested, immutable Agent Studio candidate agents replace the previous judge IDs in the Jahia custom-code block. No widget JavaScript, public API, schema, scoring rule, evidence transport, or UI behavior changes.

## Approved Change

- Adopt the tested `ALGOLIA-JUDGE-V3` shared system prompt.
- Keep only the assigned role lens in each agent's instructions.
- Use the already validated OpenAI `gpt-5.4-mini` candidate agents.
- Update the repository comparison configuration and judge lock to the same three IDs.

## Validation

- Re-read every candidate agent and require exact prompt, model, provider, tool, config, and publication-state matches.
- Run candidate deployment and Jahia cutover tests.
- Dry-run the Jahia change against the current EDIT and LIVE block.
- Apply the three ID changes atomically and verify EDIT, LIVE, and rendered-page readback.
- Run one complete live three-role judge smoke evaluation after cutover.

## Rollback

Restore the prior complete Jahia custom-code snapshot using the private rollback manifest created by `tools/deployment/deploy_judge_v2_jahia.py`. The previous immutable Agent Studio judges remain published and untouched.
