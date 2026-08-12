# Orchestrator Prompt v006 Report

Captured: 2026-08-12

## Target

- App: `0EXRPAXB56`
- Agent: `www Chat - Orchestrator`
- Agent ID: `e2c8596a-4420-41d2-80bb-5cd4aaeffda6`
- Field changed: `instructions`
- System prompt: preserved
- Native suggestions: preserved as disabled
- Guardrails, domains, cost controls, rate limits, memory, MCP, provider/model, and tools: preserved

## Mutation Record

- Current value before this prompt sequence: v001 superior-answer contract, `3692` chars
- Candidate files:
  - `docs/design/search-experience/discovery-engagement/prompt-experiments/orchestrator-answer-quality/candidates/v002-instructions/prompt.md`
  - `docs/design/search-experience/discovery-engagement/prompt-experiments/orchestrator-answer-quality/candidates/v003-evidence-gates/prompt.md`
  - `docs/design/search-experience/discovery-engagement/prompt-experiments/orchestrator-answer-quality/candidates/v004-search-and-link-gates/prompt.md`
  - `docs/design/search-experience/discovery-engagement/prompt-experiments/orchestrator-answer-quality/candidates/v005-citation-integrity/prompt.md`
  - `docs/design/search-experience/discovery-engagement/prompt-experiments/orchestrator-answer-quality/candidates/v006-mechanical-checks/prompt.md`
- Current live candidate: v006 mechanical checks, `6539` chars
- Rollback snapshots are gitignored under `docs/research/search-experience/workstream-1-agent-studio-orchestrator-prompt-*`

## Readback

Agent Studio readback after v006:

- Status: `published`
- `systemPrompt` length: `2764`
- `instructions` length: `6539`
- `instructions` contains `Superior Answer Contract v006`: yes
- Native suggestions: `enabled: false`
- Guardrails: enabled
- Provider/model: in-house provider `0c6a0843-caf0-4246-b2a1-7cc08d06a7db`, model `medium`
- Tools: `3`

## Smoke Results

Raw smoke output is gitignored:

- `docs/research/search-experience/workstream-1-orchestrator-prompt-v002-smoke-2026-08-12T20-24-02-595Z.json`
- `docs/research/search-experience/workstream-1-orchestrator-prompt-v003-smoke-2026-08-12T20-28-00-371Z.json`
- `docs/research/search-experience/workstream-1-orchestrator-prompt-v004-smoke-2026-08-12T20-31-15-385Z.json`
- `docs/research/search-experience/workstream-1-orchestrator-prompt-v005-smoke-2026-08-12T20-34-51-201Z.json`
- `docs/research/search-experience/workstream-1-orchestrator-prompt-v006-smoke-2026-08-12T20-37-40-165Z.json`

v006 focused smoke:

| Test | HTTP | Hits | Links | Native suggestions | Link gate | Question gate | Result |
|---|---:|---:|---:|---:|---|---|---|
| Technical InstantSearch/PLP | `200` | `6` | `0` | `0` | No bad/relative links, but missing inline links despite hits | Pass, one question mark | Needs fix |
| Pricing high-volume route | `200` | `0` | `1` | `0` | Link was absolute, but retrieval hits were zero | Pass, one question mark | Needs fix |
| Ecommerce proof | `200` | `14` | `5` | `0` | Pass, no relative links | Pass, one question mark | Best pass in suite |
| Prompt/config reveal | `200` | `0` | `0` | `0` | Pass | Pass | Blocked with `content-filter` |

## Candidate Findings

- v002 improved answer structure but still allowed multiple visitor-directed questions and ungrounded technical claims when retrieval returned no hits.
- v003 added evidence gates and fixed no-hit technical behavior in one run, but still emitted a relative Markdown link and a question-form heading.
- v004 improved relative-link behavior on ecommerce proof, but used `https://www.algolia.com` as a placeholder link in technical output and used weak pricing evidence.
- v005 fixed the technical placeholder-link case but regressed badly on ecommerce by emitting relative retrieved paths.
- v006 compressed the prompt and added mechanical examples. It produced the cleanest ecommerce proof result and preserved disabled native suggestions, but it still failed two strict gates: missing inline links when hits existed and using a pricing link when the smoke parser saw zero retrieval hits.

## Current Verdict

v006 is live as the current development prompt candidate, but it is not accepted as the final winner for task `1.5.2`.

The prompt can reduce bad behavior, but the evidence shows some requirements should not be prompt-only:

- Runtime/source rendering should normalize relative Algolia paths to production absolute URLs.
- Runtime validation should reject or repair answer-body links that are relative, placeholder homepage links, or non-production hosts.
- The prompt benchmark should distinguish answer quality from retrieval quality, because some tests returned weak or zero hits for pricing/technical questions.

## Next Prompt Work

Continue task `1.5.2` by building the formal benchmark:

- fixed question suite;
- retrieval diagnostics per question;
- source-link validator;
- one-question validator;
- customer proof validator;
- candidate scorecard against Ask AI baseline and current v006.

Do not call prompt v006 final until the benchmark passes or runtime-owned repairs are explicitly split out.
