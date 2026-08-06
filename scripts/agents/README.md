# Algolia.com Agent Studio panel

Build and maintenance scripts for the 7 `Algolia_*` agents that answer questions about Algolia.com's own content.

Moved here from `RAG/Algolia-Central-Spectrum` on 2026-08-05. That repo is the **Adobe Spectrum** project and no longer owns any Algolia.com work. The `ACS-*` agents and `ACS_SPECTRUM_MULTI` index stay there; nothing in this directory touches them.

## The panel

| Agent | ID | Role | Source filter |
|---|---|---|---|
| `Algolia_Generalist` | `40bdd425-1929-46e5-91ff-c95f0d8c85f1` | Front door. Takes every question. | none (all 8 sources) |
| `Algolia_Specialist` | `7ec82dc4-b67a-4f54-b321-a131e1d92464` | API-surface mapper. Handoff target. | `Documentation` OR `Developers` |
| `Algolia_Academy` | `4cfbd31a-9571-4409-ad32-d0b295e2244a` | Training/learning paths. Handoff target. | `Academy` |
| `Algolia_Classifier` | `bf323931-43fc-4799-a0ed-0e3564ce54e9` | Internal 3-way router. No search tool. | n/a |
| `Algolia_Judge_Advocate` | `ea166058-0809-41d5-ae0d-ea88915b2d24` | Blind-panel scorer. | n/a |
| `Algolia_Judge_Referee` | `30f60755-adb6-41fc-899d-b5418f41867b` | Blind-panel scorer. | n/a |
| `Algolia_Judge_Skeptic` | `6dfd4a1e-8549-4771-998c-5a8ac233c3ae` | Blind-panel scorer. | n/a |

All 7 live in Agent Studio app `0EXRPAXB56` — the same app that hosts Adobe Spectrum's `ACS-*` agents and Sajid's `www Chat` panel. Shared app, disjoint `Algolia_*` name prefix. Answering agents query index `Algolia_Prod_Copy_Vanilla`, environment `prod20260722`, language `en`, `hitsPerPage: 15`.

**Sajid's `www Chat` agents also query `Algolia_Prod_Copy_Vanilla`.** Index-level settings changes there hit his live agents too. Config fixes went to `Algolia_Prod_Copy_Enhanced` instead; `Vanilla` settings are unchanged pending coordination with him.

## Files

- `algoliaComConfig.mjs` — personas, index, filters, model, agent-body builders. No dependencies.
- `build_algolia_com_agents.mjs` — creates or patches all 7 agents. Imports only the config plus node builtins.
- `_shared_grounding_algolia.md` — **the SSOT for measured per-source content depth.** Injected into every prompt via the `[[SHARED_GROUNDING]]` token. Do not re-derive those numbers anywhere else.
- `instructions_algolia_{generalist,specialist,academy,classifier}.md` — system prompts.
- `suggestions_algolia_{generalist,specialist,academy}.md` — follow-up suggestion prompts.
- `judge/instructions_judge_{advocate,referee,skeptic}.md` — judge rubrics, grounding-agnostic, shared verbatim with Spectrum's panel.

## Usage

Credentials come from `.env.local` at the repo root (a symlink to `commons/rendered/algolia_central_spectrum.env` — same Algolia app, so the same rendered env file serves both projects).

```
node scripts/agents/build_algolia_com_agents.mjs --list     # show live agents + IDs
node scripts/agents/build_algolia_com_agents.mjs            # create/patch all 7
node scripts/agents/build_algolia_com_agents.mjs --delete    # delete all 7
```

Dry run against suffixed names instead of live ones:

```
ALGOLIA_COM_AGENT_SUFFIX=-dev node scripts/agents/build_algolia_com_agents.mjs
```

Patching is in place — agent IDs survive. The API has no draft/published split; `POST /publish` on an existing agent returns HTTP 409 "already published", so a patch is live immediately.

## Testing

```
# one query against one agent
node scripts/spikes/agent-tool-handoff/spotcheck-live.mjs <agentId> "your question"

# whole question set, classified SYNTHESIS / LINK-LIST / THIN
node scripts/spikes/agent-tool-handoff/sweep-sample-questions.mjs <agentId> <questionsFile> <outJsonl>

# dump a live agent's full config
node scripts/spikes/agent-tool-handoff/dump-agent.mjs <agentId> <outFile>
```

**Vary the wording when repeat-testing.** Agent Studio caches completions keyed on exact query text — verified 2026-08-05, two identical requests returned byte-identical output. A failure cached against a string replays forever, which has silently broken this project's testing twice before (2026-07-03, 2026-07-09). Corollary: a fix can look like it did nothing if you retest with the exact string that failed pre-fix.

## Known open issues

1. **No orchestration layer.** Nothing calls the Classifier, parses its `SPECIALIST:`/`ACADEMY:` output, routes between agents, or invokes the judges. The panel works agent-by-agent over the API only. This is the largest remaining gap.
2. **No UI is wired to these agents.** Every client in Spectrum's `web/` and `vendor/` calls the `ACS-*` agents on `ACS_SPECTRUM_MULTI`.
3. **The pricing/competitive refusal rule skips search.** Both competitive refusals return 0 hits — the agent answers from memory, which contradicts the `SEARCH FIRST — NO EXCEPTIONS` rule in the shared grounding. Those two categories are also #1 and #2 most-asked in the Gong data. See `docs/agents/2026-08-05-sweep40-generalist-results.md`.
4. **`neuralSearchPreset` has no public REST surface** — 14 endpoint variations tried. Dashboard-only.

## Reference

- `docs/agents/2026-08-04-algolia-com-agent-port.md` — full port spec and locked decisions
- `docs/agents/algolia-com-index-audit.md` — index config comparison and content-depth findings (Section 0's original conclusion was wrong; the correction is at the top)
- `docs/agents/2026-08-05-sweep40-generalist-results.md` — 40-question sweep results
- `docs/sample_questions.md` — the question set, canonical copy
