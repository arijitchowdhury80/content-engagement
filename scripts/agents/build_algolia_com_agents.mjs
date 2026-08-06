/**
 * build_algolia_com_agents — the Algolia.com agent panel (Generalist / Specialist /
 * Academy / Classifier + 3 judges) over Algolia_Prod_Copy_Vanilla, SAME parent app
 * as ACS (0EXRPAXB56) — see docs/plans/2026-08-04-algolia-com-agent-port.md.
 * Forked from build_acs_agents.mjs, not parameterized — same reasoning as
 * algoliaComConfig.mjs. No new env vars: reuses ALGOLIA_APP_ID/ALGOLIA_ADMIN_API_KEY.
 *
 *   node build_algolia_com_agents.mjs           # create/refresh, print ids
 *   node build_algolia_com_agents.mjs --delete
 *   node build_algolia_com_agents.mjs --list
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PERSONAS, INDEX, CLONE_BASE, RETIRE, MAIN_MODEL, buildAgentName, buildSuggestionsConfig, buildAgentBody, assertSuggestionsEnabled, scopeTools } from './algoliaComConfig.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = [process.env.ACS_ENV, join(process.cwd(), '.env.local'), join(__dirname, '..', '..', '.env.local')].filter(Boolean).find((p) => existsSync(p));
const ENV = {}; for (const l of readFileSync(envPath, 'utf8').split('\n')) { const t = l.trim(); if (!t || t.startsWith('#') || !t.includes('=')) continue; const i = t.indexOf('='); ENV[t.slice(0, i).trim()] = t.slice(i + 1).trim(); }
const APP = ENV.ALGOLIA_APP_ID, KEY = ENV.ALGOLIA_ADMIN_API_KEY;
const BASE = `https://${APP}.algolia.net/agent-studio/1`;
const H = { 'X-Algolia-Application-Id': APP, 'X-Algolia-API-Key': KEY, 'Content-Type': 'application/json', 'User-Agent': 'curl/8.4.0' };
async function call(method, path, body) { const r = await fetch(`${BASE}${path}`, { method, headers: H, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }); const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = { raw: t.slice(0, 400) }; } return { status: r.status, json: j }; }
async function listAgents() { const r = await call('GET', '/agents?limit=100'); const arr = r.json.data ?? r.json.agents ?? r.json.items ?? []; const m = {}; for (const a of arr) { const id = a.id ?? a.objectID; if (a.name && id) m[a.name] = id; } return m; }

// Dry-run mechanism: prefix every live-agent name lookup/create/patch with
// this suffix so a test run never touches the real names. Empty → default (live names).
const SUFFIX = process.env.ALGOLIA_COM_AGENT_SUFFIX ?? '';

function loadPrompt(file) { let s = readFileSync(join(__dirname, file), 'utf8'); if (s.includes('[[SHARED_GROUNDING]]')) s = s.replace('[[SHARED_GROUNDING]]', readFileSync(join(__dirname, '_shared_grounding_algolia.md'), 'utf8').trim()); return s; }

const mode = process.argv[2];
const existing = await listAgents();
const names = PERSONAS.map((p) => buildAgentName(p.name, SUFFIX));
if (mode === '--list') { for (const n of names) console.log(`  ${n} → ${existing[n] ?? '(none)'}`); process.exit(0); }
if (mode === '--delete') { for (const n of names) { const id = existing[n]; if (!id) { console.log(`  ${n} — absent`); continue; } const d = await call('DELETE', `/agents/${id}`); console.log(`  DELETE ${n} → HTTP ${d.status}`); } process.exit(0); }

// retire superseded agents first (none for this panel — RETIRE is empty)
for (const n of RETIRE) { if (existing[n]) { const d = await call('DELETE', `/agents/${existing[n]}`); console.log(`  RETIRE ${n} → HTTP ${d.status}`); } }

// clone tool scaffold/model/provider from an existing published agent (self,
// else any *-neural agent already live on this app — e.g. an ACS agent; this
// is a READ-ONLY GET, never a mutation to whatever we clone from)
const baseId = existing[CLONE_BASE] ?? Object.entries(existing).find(([n]) => /neural$/.test(n))?.[1];
if (!baseId) { console.error('no clone-base agent found'); process.exit(1); }
const base = (await call('GET', `/agents/${baseId}`)).json;

// Same shared inference infra as the rest of Algolia-Central (project_inference_switch_2026_07).
const INFERENCE_PROVIDER_ID = ENV.ALGOLIA_PROVIDER_INFERENCE_ID;
const useInference = !!INFERENCE_PROVIDER_ID;
const providerId = useInference ? INFERENCE_PROVIDER_ID : (base.providerId ?? base.provider_id);
const MODEL = useInference ? (ENV.ALGOLIA_INFERENCE_MODEL || 'medium') : MAIN_MODEL;
console.log(`[build_algolia_com_agents] provider=${useInference ? `acs-inference (${INFERENCE_PROVIDER_ID})` : `cloned-from-base (${providerId})`}  model=${MODEL}`);

// Native suggestions system_prompt per answering persona (Classifier + judges get none).
const SUGGESTIONS_PROMPT = {
  'Algolia_Generalist': loadPrompt('suggestions_algolia_generalist.md'),
  'Algolia_Specialist': loadPrompt('suggestions_algolia_specialist.md'),
  'Algolia_Academy': loadPrompt('suggestions_algolia_academy.md'),
};

for (const { name, prompt, filters, desc, extraTools, noSearchTool, expectSuggestions } of PERSONAS) {
  const agentName = buildAgentName(name, SUFFIX);
  const instructions = loadPrompt(prompt);
  const tools = [...scopeTools(base.tools, filters, desc, { noSearchTool }), ...extraTools];
  const wantSuggestions = expectSuggestions ?? true;
  const suggestionsConfig = buildSuggestionsConfig(SUGGESTIONS_PROMPT[name] ?? '', wantSuggestions, MODEL);
  const existingId = existing[agentName];
  let id;
  if (existingId) {
    // PATCH in place — never delete+recreate a live agent (same rule as ACS's
    // build script: a churned ID would silently 404 anyone pointing at the old one).
    const body = buildAgentBody({ instructions, model: MODEL, providerId, tools, suggestionsConfig });
    const p = await call('PATCH', `/agents/${existingId}`, body);
    if (p.status !== 200) { console.error(`patch ${agentName} → ${p.status}: ${JSON.stringify(p.json).slice(0, 400)}`); process.exit(1); }
    id = existingId;
  } else {
    const body = buildAgentBody({ name: agentName, status: 'published', instructions, model: MODEL, providerId, tools, suggestionsConfig });
    const c = await call('POST', '/agents', body);
    if (![200, 201].includes(c.status)) { console.error(`create ${agentName} → ${c.status}: ${JSON.stringify(c.json).slice(0, 400)}`); process.exit(1); }
    id = c.json.id ?? c.json.objectID;
    await call('POST', `/agents/${id}/publish`, {});
  }
  const v = await call('GET', `/agents/${id}`);
  const enabledOk = assertSuggestionsEnabled(v.json);
  console.log(`  ${agentName} → ${id}${existingId ? ' (patched in place, ID unchanged)' : ' (created)'}`);
  console.log(`      index=${v.json.tools?.[0]?.indices?.[0]?.index ?? '(no search tool)'}  filter=${v.json.tools?.[0]?.indices?.[0]?.searchParameters?.filters ?? '(none)'}  tools=${v.json.tools?.map((t) => t.type).join('+') || '(none)'}  prompt=${instructions.length}ch  model=${v.json.model}  suggestions=${enabledOk ? 'on' : 'off'} (expected ${wantSuggestions ? 'on' : 'off'})`);
  // Two-sided hard gate — a persona is not "done" unless the server's reported
  // suggestions.enabled state matches what THIS persona expects, either direction.
  if (wantSuggestions && !enabledOk) { console.error(`  ${agentName}: config.suggestions did not round-trip enabled — hard gate failed.`); process.exit(1); }
  if (!wantSuggestions && enabledOk) { console.error(`  ${agentName}: expected suggestions OFF but server reports ON — hard gate failed.`); process.exit(1); }
}
console.log('[build_algolia_com_agents] done.');
