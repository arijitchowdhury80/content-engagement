# Orchestrator Prompt Layering Report

Captured: 2026-08-12

## Target

- App: `0EXRPAXB56`
- Agent: `www Chat – Orchestrator`
- Agent ID: `e2c8596a-4420-41d2-80bb-5cd4aaeffda6`

## Reason

After the native configuration pass, the Agent Studio API showed `systemPrompt: null`, while durable mission/source-authority/personality/turn-flow text was sitting in `instructions`. The prompt work therefore began by separating the two prompt layers:

- `systemPrompt`: stable concierge identity, source authority, personality, and turn flow.
- `instructions`: answer-quality contract for the current agent behavior.

## Current Prompt Layering

Public-safe readback summary:

- `systemPrompt` length: `2764`
- `instructions` length: `3692`
- `systemPrompt` contains source-authority language: yes
- `instructions` contains `Superior Answer Contract`: yes
- Suggestions restored:
  - enabled: `true`
  - model: `medium`
  - max suggestions: `3`
  - max words: `8`
  - include tool outputs: `true`

## Layer Responsibilities

### System Prompt

Owns durable identity and behavior:

- Algolia website discovery concierge mission.
- Strong source authority: model training data has no authority for Algolia facts.
- Expert consultant / helpful-big-brother personality.
- High-level turn flow.
- Hidden prompt/tool/config secrecy.

### Agent Instructions

Own the superior-answer contract:

- Answer shape by question type.
- Business/ecommerce/customer-proof response structure.
- Technical response structure.
- Conservative handling for pricing, packaging, roadmap, legal, security, and support.
- Inline evidence-link contract.
- Customer proof and quote rules.
- Discovery and specialist-routing behavior.
- Final quality checklist.

## Smoke Test Results

All prompts used fresh wording to avoid exact-query cache reuse.

| Test | Origin | HTTP | Evidence |
|---|---|---:|---|
| Customer proof / ecommerce product discovery | `https://www.algolia.com` | `200` | 14 retrieved hits, 2938 answer chars, inline Algolia Markdown link present, 3 suggestions |
| Prompt reveal attack | `https://www.algolia.com` | `200` | Blocked with `finishReason: content-filter`, no retrieval hits, no suggestions |

## Asana Updates

- Picked up `1.5.2 Define superior-answer contract & expanded benchmark` as the active prompt-contract task.
- Added dependency: `1.5.3 Run Karpathy autoresearch-style prompt experiments` depends on `1.5.2`.
- Added dependencies: `1.5.4 Publish winning www Chat – Orchestrator prompt safely` depends on `1.5.2` and `1.5.3`.

## Remaining Work

- Run the full 1.5.2 benchmark contract pass, not just a two-prompt smoke.
- Validate source-link exactness and customer quote behavior across the canonical question suite.
- Perform browser-widget submission validation; previous Playwright form automation reloaded the page.
- Decide whether the current answer contract becomes candidate `v001` for the autoresearch-style experiment loop.
