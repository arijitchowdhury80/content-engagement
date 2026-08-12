# Orchestrator Native Suggestions Disable Report

Captured: 2026-08-12

## Target

- App: `0EXRPAXB56`
- Agent: `www Chat - Orchestrator`
- Agent ID: `e2c8596a-4420-41d2-80bb-5cd4aaeffda6`
- Production `[Prod] Algolia.com Website Search/Chatbot`: read-only reference, not modified

## Root Cause

The earlier config pass copied the production-style native follow-up prompt-suggestion pattern into the dev orchestrator and then treated native suggestion-chip output as a validation success.

That was the wrong product behavior. The Workstream 1 concierge is a discovery agent. It should answer, engage, and ask at most one useful in-answer discovery question when needed. Native prompt-suggestion chips ask the visitor to choose the agent's next question, which works against the consultant-style discovery flow.

## Mutation Record

- Target: dev `www Chat - Orchestrator`
- Current value before change: `config.suggestions.enabled: true`
- Intended value: `config.suggestions.enabled: false`
- API mutation: `PATCH /agent-studio/1/agents/e2c8596a-4420-41d2-80bb-5cd4aaeffda6`
- Result: HTTP `200`
- Rollback snapshot: `docs/research/search-experience/workstream-1-agent-studio-orchestrator-suggestions-before-disable-2026-08-12T20-04-02-744Z.json`
- After snapshot: `docs/research/search-experience/workstream-1-agent-studio-orchestrator-after-disable-suggestions-2026-08-12T20-06-59-872Z.json`

Only `config.suggestions` was changed. The mutation preserved provider/model, tools, guardrails, cost controls, rate limits, memory, MCP, approved domains, `systemPrompt`, and `instructions`.

## Readback Summary

- Status: `published`
- Provider: `0c6a0843-caf0-4246-b2a1-7cc08d06a7db`
- Model: `medium`
- Native suggestions: `enabled: false`
- Guardrails: enabled with five categories
- Max tokens: `3000`
- Max iterations: `20`
- Thread depth: `100`
- Agent rate limit: `1000` requests per `60` seconds
- IP rate limit: `200` requests per `60` seconds
- Memory: enabled
- Approved domains:
  - `*.algolia.com`
  - `*.cloud.jahia.com`
  - `temp-production-algolia.cloud.jahia.com`

## Validation

Allowed-origin ecommerce discovery smoke:

- Origin: `https://www.algolia.com`
- HTTP: `200`
- Retrieved hits: `25`
- Native suggestions: `0`
- Answer length: `4292`
- In-answer question marks: `1`
- Finish reason: `stop`

Prompt-reveal attack smoke:

- Origin: `https://www.algolia.com`
- HTTP: `200`
- Finish reason: `content-filter`
- Native suggestions: `0`

## Updated Success Rule

Native follow-up prompt suggestions are not a success metric for Workstream 1. They are disabled for the orchestrator.

The correct success metric is:

- no native suggestion chips from Agent Studio;
- the agent answers directly first;
- the agent asks at most one grounded, non-repeating discovery question inside the answer only when it advances the user's evaluation.
