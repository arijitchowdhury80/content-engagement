# Agents

This directory contains project-owned Agent Studio prompts, admin scripts, and live checks.
The active app is `0EXRPAXB56`; the primary development chat agent is `www Chat - Orchestrator`.

Production Ask Algolia is comparison evidence only. Do not modify production Ask Algolia,
non-algolia.com surfaces, or host HTML from this project.

## Files

- `prompts/` — versioned agent prompts, judge prompts, and shared prompt fragments.
- `admin/algoliaComConfig.mjs` — shared constants and Agent Studio payload builders.
- `admin/build_algolia_com_agents.mjs` — create/list/patch script for configured agents.
- `checks/` — read-only live Agent Studio inspection and smoke-test scripts.

Important prompt files:

- `prompts/system_algolia_arrie_concierge.md` — aRRIe personality for the proactive greeting agent.
- `prompts/system_algolia_orchestrator.md` — aRRIe personality, source authority, and turn flow for the main orchestrator.
- `prompts/instructions_algolia_proactive_greeting.md` — proactive greeting JSON contract and examples.
- `prompts/instructions_algolia_orchestrator.md` — grounded answer contract, retrieval choreography, specialist routing, and proactive handoff handling.

Do not reintroduce the old names `agents/definitions/` or `agents/probes/`. Prompt source belongs
in `agents/prompts/`; diagnostics belong in `agents/checks/`.

## Usage

Credentials come from `.env.local` at the repo root.

```
node agents/admin/build_algolia_com_agents.mjs --list
node agents/admin/build_algolia_com_agents.mjs
```

Dry run against suffixed names instead of live ones:

```
ALGOLIA_COM_AGENT_SUFFIX=-dev node agents/admin/build_algolia_com_agents.mjs
```

Before patching Agent Studio, snapshot the current target, intended value, rollback,
and validation evidence. Get approval for Agent Studio configuration mutations.

## Testing

```
# one query against one agent
node agents/checks/spotcheck-live.mjs <agentId> "your question"

# whole question set, classified SYNTHESIS / LINK-LIST / THIN
node agents/checks/sweep-sample-questions.mjs <agentId> <questionsFile> <outJsonl>

# dump a live agent's full config
node agents/checks/dump-agent.mjs <agentId> <outFile>
```

**Vary the wording when repeat-testing.** Agent Studio caches completions keyed on exact query text — verified 2026-08-05, two identical requests returned byte-identical output. A failure cached against a string replays forever, which has silently broken this project's testing twice before (2026-07-03, 2026-07-09). Corollary: a fix can look like it did nothing if you retest with the exact string that failed pre-fix.

## Live Checks

These scripts inspect or test live Agent Studio agents. They are not prompt source, not frontend
runtime code, and they must not mutate configuration.

- `dump-agent.mjs` — dump a live agent config.
- `spotcheck-live.mjs` — ask one live question.
- `sweep-sample-questions.mjs` — run a question set and classify answers.
