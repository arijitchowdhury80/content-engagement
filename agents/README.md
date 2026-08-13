# Agents

This directory contains project-owned Agent Studio prompts, admin scripts, and read-only probes.
The active app is `0EXRPAXB56`; the primary development chat agent is `www Chat - Orchestrator`.

Production Ask Algolia is comparison evidence only. Do not modify production Ask Algolia,
Spectrum, or host HTML from this project.

## Files

- `prompts/` — versioned agent prompts, judge prompts, and shared prompt fragments.
- `admin/algoliaComConfig.mjs` — shared constants and Agent Studio payload builders.
- `admin/build_algolia_com_agents.mjs` — create/list/patch script for configured agents.
- `probes/agent-tool-handoff/` — read-only live inspection and smoke-test tools.

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
node agents/probes/agent-tool-handoff/spotcheck-live.mjs <agentId> "your question"

# whole question set, classified SYNTHESIS / LINK-LIST / THIN
node agents/probes/agent-tool-handoff/sweep-sample-questions.mjs <agentId> <questionsFile> <outJsonl>

# dump a live agent's full config
node agents/probes/agent-tool-handoff/dump-agent.mjs <agentId> <outFile>
```

**Vary the wording when repeat-testing.** Agent Studio caches completions keyed on exact query text — verified 2026-08-05, two identical requests returned byte-identical output. A failure cached against a string replays forever, which has silently broken this project's testing twice before (2026-07-03, 2026-07-09). Corollary: a fix can look like it did nothing if you retest with the exact string that failed pre-fix.

## Probes

`probes` means read-only diagnostic scripts. They inspect or test live Agent Studio agents; they
are not prompt source and they should not mutate configuration.

- `dump-agent.mjs` — dump a live agent config.
- `spotcheck-live.mjs` — ask one live question.
- `sweep-sample-questions.mjs` — run a question set and classify answers.
