---
title: "Agent Studio capability verdict"
description: "Is the agentic layer real, or does it have to be designed and mocked?"
status: complete
date: 2026-08-06
asana: "WU-17.8 — Agent Studio capability verdict [HIDDEN GATE]"
---

# Agent Studio capability verdict

> **VERDICT: REAL, NOT DESIGNED.**
> The agentic layer can be built against live Algolia infrastructure. It does not have to be
> mocked, scripted, or presented as a future state.

This is the hidden gate on riskiest assumption #7. It scopes WU-18 (threat model, latency budget,
governance) and WU-23 (agentic layer). Both were waiting on this answer.

## What was verified

| Check | Result |
|---|---|
| Agents live on the account in Agent Studio | **51** |
| An agent completing a real end-to-end query | **Yes** — `Algolia_Generalist` |
| Its flow | tool call → **15 hits** → synthesized answer + follow-up suggestions |
| Key scope required | a **search-only** key was sufficient |
| Configurable by us | Yes |

The capability is not a roadmap item and not a sales demo. It is enabled on this account today and
we can configure it.

## What this changes downstream

**WU-18 keeps its full scope.** A "designed layer" verdict would have removed prompt injection,
jailbreaks and deliberate LLM cost attacks from the live-risk set — they are not live risks against
a scripted mock. The verdict being *real* keeps all of them in scope, and makes the latency budget
a real constraint rather than a paper one.

**WU-23 builds rather than fakes.** The agentic layer in the demo can call a real agent.

## What this verdict does NOT say

- **It does not say the agent is good.** One agent was observed completing one query correctly.
  Answer quality, routing behaviour, refusal behaviour and grounding are unmeasured. The eval
  harness requirements in WU-18 exist precisely because this was not tested.
- **It does not clear neural search.** Neural is available on the account but **cannot be enabled
  on a fresh index** — Algolia rejects `mode:neuralSearch` with *"an existing index with events is
  required."* It needs click and conversion history. The demo runs standard ranking and says so
  on screen.
- **It does not cost anything out.** No per-query cost, rate limit, or quota was measured.
- **It does not scope the 51 agents.** They belong to several efforts on a shared account. Which
  are ours to use, and which are a colleague's production surface, is not established here.
  `Algolia_Prod_Copy_Vanilla` is already known to be off-limits for writes for exactly this reason.

## How the gate was closed

Directly, by inspecting the live account — not by running WU-17 as a research unit. The question
was binary (real or designed), the evidence was one live query away, and answering it unblocked two
downstream units immediately.

This task was planned as `[43]` in `docs/05-execution-plan.md` and referenced throughout
`docs/briefs/WU-17.md`, but was **never created in Asana** — which is why the global subtask
sequence had a hole at 43. Created and closed 2026-08-06 during the numbering restructure.

## Still open, and owed by WU-17

`WU-17.1`–`WU-17.7`: agent taxonomy, routing logic, content-access matrix, answer formats,
specialist handoff rules, trust guardrails, and the journey→agent-flow map. **The yes/no gate is
closed. The design work is not.**
