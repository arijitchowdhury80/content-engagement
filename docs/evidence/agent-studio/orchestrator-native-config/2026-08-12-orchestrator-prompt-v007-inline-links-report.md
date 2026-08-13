# Orchestrator Prompt v007 Inline Links Report

Captured: 2026-08-12

## Target

- App: `0EXRPAXB56`
- Agent: `www Chat - Orchestrator`
- Agent ID: `e2c8596a-4420-41d2-80bb-5cd4aaeffda6`
- Field changed: `instructions`
- System prompt: preserved
- Native suggestions: preserved as disabled
- Guardrails, domains, cost controls, rate limits, memory, MCP, provider/model, and tools: preserved

## User Decision Captured

Inline links are mandatory for authority and trust.

Any time the agent talks about a feature, solution, best practice, recommendation, case study, customer proof point, support path, documentation path, pricing/contact path, or implementation pattern, it should include inline hyperlinks whenever retrieved evidence supports the referenced concept.

The source footer is not enough. The words that carry authority in the answer body should be linked.

## Mutation Record

- Current value before change: v006 mechanical-check prompt, `6539` chars
- Intended value: v007 inline-authority-link prompt, `8159` chars
- Candidate file: `docs/design/search-experience/discovery-engagement/prompt-experiments/orchestrator-answer-quality/candidates/v007-inline-authority-links/prompt.md`
- Rollback snapshot: `docs/research/search-experience/workstream-1-agent-studio-orchestrator-prompt-before-v007-2026-08-12T20-39-23-452Z.json`
- After snapshot: `docs/research/search-experience/workstream-1-agent-studio-orchestrator-prompt-v007-after-2026-08-12T20-40-00-966Z.json`

## Readback

Agent Studio readback after v007:

- Status: `published`
- `systemPrompt` length: `2764`
- `instructions` length: `8159`
- `instructions` contains `Superior Answer Contract v007`: yes
- Native suggestions: `enabled: false`
- Guardrails: enabled
- Provider/model: in-house provider `0c6a0843-caf0-4246-b2a1-7cc08d06a7db`, model `medium`
- Tools: `3`

## Validation

Raw smoke output is gitignored:

- `docs/research/search-experience/workstream-1-orchestrator-prompt-v007-smoke-2026-08-12T20-42-03-879Z.json`

Focused smoke summary:

| Test | HTTP | Hits | Links | Native suggestions | Bad links | Question marks | Feature-link result |
|---|---:|---:|---:|---:|---:|---:|---|
| Feature-heavy answer | `200` | `21` | `7` | `0` | `0` | `1` | Linked all detected named terms: InstantSearch, Dynamic Re-Ranking, synonyms, Rules, Query Suggestions |
| Customer proof | `200` | `7` | `4` | `0` | `0` | `1` | Linked NeuralSearch, Dynamic Re-Ranking, Query Suggestions; missed AI Personalization |
| Pricing/demo route | `200` | `21` | `5` | `0` | `0` | `1` | Linked pricing route and detected AI Personalization mention |
| Prompt reveal | `200` | `0` | `0` | `0` | `0` | `0` | Blocked with `content-filter` |

## Verdict

v007 materially improves inline authority linking and is now live as the current development prompt candidate.

It is not final. The missed `AI Personalization` link in the customer-proof answer shows prompt-only enforcement is still imperfect. The next benchmark pass should keep measuring:

- named feature mentions versus linked feature mentions;
- named solution/best-practice mentions versus linked mentions;
- customer/case-study/metric mentions versus linked evidence;
- no relative links;
- no homepage placeholder links;
- no native prompt suggestions;
- at most one in-answer discovery question.

If this remains inconsistent, runtime answer validation should normalize links and flag unlinked named entities after generation.
