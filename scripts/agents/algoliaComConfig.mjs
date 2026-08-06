/**
 * algoliaComConfig — pure, static configuration for the Algolia.com agent panel
 * (Generalist / Specialist / Academy / Classifier + 3 judges), against
 * Algolia_Prod_Copy_Vanilla in the SAME parent app as ACS (0EXRPAXB56).
 * Forked from agentConfig.mjs rather than parameterizing it — ACS and this
 * panel are permanently separate agent sets with no shared runtime, so
 * sharing the module-level INDEX constant across both would be a real risk
 * for zero benefit. No network, no top-level await: safe to import from
 * tests without touching the live Agent Studio API.
 */

export const INDEX = 'Algolia_Prod_Copy_Vanilla';
export const CLONE_BASE = 'Algolia_Generalist'; // self-hosting; falls back to any *-neural agent on this app (e.g. an ACS agent) if the panel isn't built yet — used only to bootstrap tool scaffold/model/provider

// Same shared inference infra as the rest of Algolia-Central (see
// project_inference_switch_2026_07 memory) — 'medium' via the enablers
// inference server, not cloned from whatever the base agent's own model is.
export const MAIN_MODEL = 'medium';

// Filters confirmed live 2026-08-05: current-prod environment snapshot, English-only.
// AND'd onto each answering agent's source scope.
//
// `is404:false` REMOVED 2026-08-05 (was here from 2026-08-04). It was a mistake:
//   - `is404` is written by 5 of the 6 ingestion pipelines. The `algolia-com-doc`
//     pipeline never writes it, so all 4,337 Documentation records have NO such
//     field. Algolia treats a missing attribute as non-matching, so `is404:false`
//     silently excluded every Documentation record (Specialist retrieved 0 of them).
//   - It protected against nothing: `is404:true AND environment:"prod20260722"`
//     returns 0 records — all 24 flagged records live in the nonprod snapshot the
//     environment clause already excludes.
//   - The flag is also stale/wrong where present: all 4 sampled `is404:true` URLs
//     return live HTTP 200.
// Do NOT reintroduce it, not even as `NOT is404:true`. There is no usable signal here.
const BASE_FILTER = 'environment:"prod20260722" AND language_code:"en"';

// Candidate count per search call. Was 3 (inherited from the clone base, which is
// this panel's own Generalist — so it self-perpetuated). 3 hits starved the answer:
// the content-rich sources (Website, Support) never made it into the model's context.
// Sajid's `www Chat` agents on this same index use 7 (orchestrator) and 10 (specialist).
const HITS_PER_PAGE = 15;

// Architecture (confirmed with Arijit, 2026-08-05): Generalist is the ONE front
// door. Classifier is a 3-way internal decision (SPECIALIST: / ACADEMY: / plain)
// reached only after Generalist answers — Academy is NOT a standalone front door,
// same handoff mechanism as Specialist. Judges score independently, no search tool.
export const PERSONAS = [
  { name: 'Algolia_Generalist', prompt: 'instructions_algolia_generalist.md', filters: BASE_FILTER, desc: 'Algolia_Prod_Copy_Vanilla — full Algolia.com corpus (all 8 sources), current prod snapshot, English only.', extraTools: [] },
  { name: 'Algolia_Specialist', prompt: 'instructions_algolia_specialist.md', filters: `(source:"Documentation" OR source:"Developers") AND ${BASE_FILTER}`, desc: 'Algolia_Prod_Copy_Vanilla scoped to Documentation + Developers (product/technical slice).', extraTools: [] },
  { name: 'Algolia_Academy', prompt: 'instructions_algolia_academy.md', filters: `source:"Academy" AND ${BASE_FILTER}`, desc: 'Algolia_Prod_Copy_Vanilla scoped to Academy training content.', extraTools: [] },
  {
    name: 'Algolia_Classifier',
    prompt: 'instructions_algolia_classifier.md',
    filters: null,
    desc: 'Algolia_Prod_Copy_Vanilla classifier — no independent search, classifies from supplied context only.',
    extraTools: [],
    noSearchTool: true,
    expectSuggestions: false,
  },
  { name: 'Algolia_Judge_Advocate', prompt: 'judge/instructions_judge_advocate.md', filters: null, desc: 'Blind-panel judge (advocate lens) — no search tool, scores from supplied QUESTION/ANSWER/SOURCES only.', extraTools: [], noSearchTool: true, expectSuggestions: false },
  { name: 'Algolia_Judge_Referee', prompt: 'judge/instructions_judge_referee.md', filters: null, desc: 'Blind-panel judge (referee lens) — no search tool, scores from supplied QUESTION/ANSWER/SOURCES only.', extraTools: [], noSearchTool: true, expectSuggestions: false },
  { name: 'Algolia_Judge_Skeptic', prompt: 'judge/instructions_judge_skeptic.md', filters: null, desc: 'Blind-panel judge (skeptic lens) — no search tool, scores from supplied QUESTION/ANSWER/SOURCES only.', extraTools: [], noSearchTool: true, expectSuggestions: false },
];

// Nothing superseded — this is a brand new panel, no legacy names to retire.
export const RETIRE = [];

// Dry-run mechanism: agents are looked up/created/patched under a suffixed
// name so a test run (ALGOLIA_COM_AGENT_SUFFIX=-dev) never touches the live
// names this panel will eventually be consumed by. Empty suffix → real live names.
export function buildAgentName(baseName, suffix) {
  return `${baseName}${suffix}`;
}

export function buildSuggestionsConfig(systemPrompt, enabled = true, model = MAIN_MODEL) {
  return {
    enabled,
    model,
    system_prompt: systemPrompt,
    generation: { max_count: 1 },
    context: { include_tool_outputs: true },
  };
}

// Only scopes algolia_search_index tools (indices/searchParameters) — other
// tool types pass through untouched via extraTools instead. noSearchTool:true
// is the escape hatch for personas that must carry NO search tool at all
// (classifier + all 3 judges — they classify/score only from supplied context).
export function scopeTools(tools, filters, desc, { noSearchTool = false } = {}) {
  if (noSearchTool) return [];
  const searchTools = tools.filter((t) => t.type === 'algolia_search_index');
  const t = JSON.parse(JSON.stringify(searchTools));
  for (const tool of t) { tool.description = desc; if (Array.isArray(tool.indices)) for (const ix of tool.indices) { ix.index = INDEX; ix.description = desc; ix.searchParameters = ix.searchParameters ?? {}; ix.searchParameters.hitsPerPage = HITS_PER_PAGE; if (filters) ix.searchParameters.filters = filters; else delete ix.searchParameters.filters; } }
  return t;
}

// Single source of truth for the agent request body — called at BOTH the PATCH
// (existing agent) and POST (new agent) sites so config.suggestions can never
// be set on one path and silently missed on the other.
export function buildAgentBody({ name, status, instructions, model, providerId, tools, suggestionsConfig }) {
  return {
    instructions,
    model,
    providerId,
    tools,
    config: { suggestions: suggestionsConfig },
    ...(name ? { name } : {}),
    ...(status ? { status } : {}),
  };
}

// Hard gate: a persona is not "done" unless the server round-trips
// config.suggestions.enabled === true (or false, for personas that expect it off).
export function assertSuggestionsEnabled(agentJson) {
  return agentJson?.config?.suggestions?.enabled === true;
}
