import { chmodSync, existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const envPath = [process.env.ACS_ENV, join(root, '.env.local')].filter(Boolean).find(existsSync);
const env = { ...process.env };
if (envPath) for (const raw of readFileSync(envPath, 'utf8').split('\n')) {
  const line = raw.trim().replace(/^export\s+/, '');
  if (!line || line.startsWith('#') || !line.includes('=')) continue;
  const index = line.indexOf('=');
  if (!(line.slice(0, index).trim() in env)) env[line.slice(0, index).trim()] = line.slice(index + 1).trim().replace(/^['"]|['"]$/g, '');
}

const EXPECTED_APP_ID = '0EXRPAXB56';
const appId = env.ALGOLIA_APP_ID || EXPECTED_APP_ID;
if (appId !== EXPECTED_APP_ID) throw new Error(`Judge v2 deploy is locked to development app ${EXPECTED_APP_ID}; refusing ${appId}.`);
const adminKey = env.ALGOLIA_ADMIN_API_KEY;
if (!adminKey) throw new Error('Missing ALGOLIA_ADMIN_API_KEY; no Agent Studio request was made.');

const apply = process.argv.includes('--apply');
const rollbackIndex = process.argv.indexOf('--rollback');
const rollbackManifest = rollbackIndex >= 0 ? process.argv[rollbackIndex + 1] : null;
if (rollbackIndex >= 0 && !rollbackManifest) throw new Error('--rollback requires a private rollback manifest path.');
if (apply && rollbackManifest) throw new Error('--apply and --rollback are mutually exclusive.');

const runId = process.env.JUDGE_V2_RUN_ID || new Date().toISOString().replace(/[:.]/g, '-');
const agentRelease = process.env.JUDGE_V2_AGENT_RELEASE || 'v2.1';
const providerOverride = String(env.JUDGE_V2_PROVIDER_ID || '').trim();
const modelOverride = String(env.JUDGE_V2_MODEL || '').trim();
const thinkingBudgetOverride = String(env.JUDGE_V2_THINKING_BUDGET || '').trim();
if ((providerOverride && !modelOverride) || (!providerOverride && modelOverride)) {
  throw new Error('JUDGE_V2_PROVIDER_ID and JUDGE_V2_MODEL must be supplied together.');
}
if (thinkingBudgetOverride && !modelOverride) {
  throw new Error('JUDGE_V2_THINKING_BUDGET requires an explicit provider and model override.');
}
const thinkingBudget = thinkingBudgetOverride ? Number(thinkingBudgetOverride) : null;
if (thinkingBudgetOverride && !Number.isInteger(thinkingBudget)) {
  throw new Error('JUDGE_V2_THINKING_BUDGET must be an integer.');
}
const evidenceDir = resolve(root, 'docs/evidence/agent-studio/judge-v2', runId);
const privateDir = resolve(root, '.local/deployment-state/judge-v2', runId);
const roles = {
  skeptic: { sourceId: 'a4c3846b-e538-4c9c-8e39-1bb15a21f2c2', name: `www Chat - Confidence Skeptic ${agentRelease}`, prompt: 'instructions_judge_skeptic.md' },
  referee: { sourceId: 'c43d7374-801a-4d0f-aa09-ca12830565c3', name: `www Chat - Confidence Referee ${agentRelease}`, prompt: 'instructions_judge_referee.md' },
  advocate: { sourceId: 'f14b8ddf-2285-422c-89e5-180d7fa0b3bf', name: `www Chat - Confidence Advocate ${agentRelease}`, prompt: 'instructions_judge_advocate.md' },
};

const headers = { 'content-type': 'application/json', 'x-algolia-application-id': appId, 'x-algolia-api-key': adminKey };
const base = `https://${appId}.algolia.net/agent-studio/1`;
async function request(method, path, body, { allow404 = false } = {}) {
  let lastError;
  const maxAttempts = method === 'POST' && path === '/agents' ? 1 : 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await fetch(`${base}${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const text = await response.text();
    let json; try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text.slice(0, 300) }; }
    if (allow404 && response.status === 404) return null;
    if (response.ok) return json;
    lastError = new Error(`${method} ${path} failed ${response.status}: ${JSON.stringify(json).slice(0, 400)}`);
    if (!(response.status === 429 || response.status >= 500) || attempt === maxAttempts) break;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 500 * (2 ** (attempt - 1))));
  }
  throw lastError;
}

const hash = (value) => createHash('sha256').update(value || '').digest('hex');
const canonicalize = (value) => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  return value;
};
const canonical = (value) => JSON.stringify(canonicalize(value));
const idOf = (agent) => agent?.id || agent?.objectID;
const configOf = (agent) => ({
  name: agent.name, status: agent.status, instructions: agent.instructions, model: agent.model,
  providerId: agent.providerId, tools: agent.tools || [], config: agent.config || {},
});
const summary = (agent) => ({
  id: idOf(agent), name: agent.name, status: agent.status, model: agent.model, providerId: agent.providerId,
  toolCount: agent.tools?.length || 0, instructionsHash: hash(agent.instructions), configHash: hash(canonical(agent.config || {})),
});
function expandedPrompt(filename) {
  const shared = readFileSync(resolve(root, 'agents/prompts/judge/_shared_judge_rubric_v2.md'), 'utf8').trim();
  return readFileSync(resolve(root, 'agents/prompts/judge', filename), 'utf8').replace('[[SHARED_JUDGE_RUBRIC_V2]]', shared);
}
function writeJson(dir, name, value, mode) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(resolve(dir, name), JSON.stringify(value, null, 2) + '\n', mode ? { mode } : undefined);
  if (mode) chmodSync(resolve(dir, name), mode);
}
async function listAllAgents() {
  const all = [];
  for (let offset = 0; offset < 10000; offset += 100) {
    const page = await request('GET', `/agents?limit=100&offset=${offset}`);
    const items = page.data || page.agents || page.items || [];
    all.push(...items);
    if (items.length < 100) return all;
  }
  throw new Error('Agent pagination exceeded the safety limit.');
}
function expectedBody(spec, source) {
  const model = modelOverride || source.model;
  const providerId = providerOverride || source.providerId;
  return {
    name: spec.name, status: 'published', instructions: expandedPrompt(spec.prompt), model,
    providerId, tools: [],
    config: {
      enableAlgoliaMcp: false,
      ...(thinkingBudget === null ? {} : { thinking_budget: thinkingBudget }),
      suggestions: { enabled: false, model, system_prompt: '', generation: { max_count: 1 }, context: { include_tool_outputs: true } },
    },
  };
}
function assertExact(agent, expected, role) {
  if (canonical(configOf(agent)) !== canonical(expected)) throw new Error(`${role} failed exact immutable readback validation.`);
}
async function deleteAndVerify(id) {
  await request('DELETE', `/agents/${id}`);
  if (await request('GET', `/agents/${id}`, undefined, { allow404: true })) throw new Error(`Rollback failed: agent ${id} still exists.`);
}

if (rollbackManifest) {
  const manifest = JSON.parse(readFileSync(resolve(rollbackManifest), 'utf8'));
  if (manifest.appId !== EXPECTED_APP_ID || !Array.isArray(manifest.createdThisRun)) throw new Error('Invalid judge-v2 rollback manifest.');
  const results = [];
  for (const item of [...manifest.createdThisRun].reverse()) {
    await deleteAndVerify(item.id);
    results.push({ role: item.role, id: item.id, deleted: true, readbackAbsent: true });
  }
  writeJson(evidenceDir, 'rollback-readback.json', { pass: true, appId, results });
  process.stdout.write(JSON.stringify({ pass: true, rolledBack: results }, null, 2) + '\n');
  process.exit(0);
}

const listed = await listAllAgents();
const byName = new Map();
for (const agent of listed) {
  if (!byName.has(agent.name)) byName.set(agent.name, []);
  byName.get(agent.name).push(agent);
}
const plans = {};
const expectedByRole = {};
const privateBefore = { runId, appId, capturedAt: new Date().toISOString(), targets: {} };
for (const [role, spec] of Object.entries(roles)) {
  const source = await request('GET', `/agents/${spec.sourceId}`);
  const expected = expectedBody(spec, source);
  expectedByRole[role] = expected;
  const matches = byName.get(spec.name) || [];
  if (matches.length > 1) throw new Error(`Expected at most one immutable target named ${spec.name}; found ${matches.length}.`);
  const existing = matches[0] ? await request('GET', `/agents/${idOf(matches[0])}`) : null;
  privateBefore.targets[role] = existing;
  plans[role] = {
    source: summary(source), targetName: spec.name, instructionsPath: `agents/prompts/judge/${spec.prompt}`,
    payloadHash: hash(canonical(expected)), existingTarget: existing ? summary(existing) : null,
  };
}
writeJson(privateDir, 'before-snapshot.json', privateBefore, 0o600);
writeJson(evidenceDir, 'deployment-plan.json', {
  runId,
  agentRelease,
  apply,
  appId,
  immutableCreateOnly: true,
  providerOverride: providerOverride || null,
  modelOverride: modelOverride || null,
  thinkingBudget,
  roles: plans,
  privateSnapshotHash: hash(JSON.stringify(privateBefore)),
});
if (!apply) {
  process.stdout.write(JSON.stringify({ pass: true, dryRun: true, evidenceDir, privateStateDir: privateDir, roles: Object.keys(plans) }, null, 2) + '\n');
  process.exit(0);
}

const resolved = {};
const createdThisRun = [];
const mutationJournal = [];
const persistJournal = () => writeJson(privateDir, 'rollback-manifest.json', { runId, appId, createdThisRun, mutationJournal }, 0o600);
try {
  for (const [role, spec] of Object.entries(roles)) {
    const expected = expectedByRole[role];
    const matches = byName.get(spec.name) || [];
    let target;
    if (matches.length === 1) {
      target = await request('GET', `/agents/${idOf(matches[0])}`);
      assertExact(target, expected, role);
      mutationJournal.push({ role, operation: 'reuse', id: idOf(target), at: new Date().toISOString() });
    } else {
      const created = await request('POST', '/agents', expected);
      const id = idOf(created);
      if (!id) throw new Error(`${role} creation returned no agent ID.`);
      createdThisRun.push({ role, id });
      mutationJournal.push({ role, operation: 'create', id, at: new Date().toISOString() });
      persistJournal();
      await request('POST', `/agents/${id}/publish`, {});
      mutationJournal.push({ role, operation: 'publish', id, at: new Date().toISOString() });
      target = await request('GET', `/agents/${id}`);
      writeJson(privateDir, `readback-${role}.json`, {
        expected,
        actual: configOf(target),
        expectedHash: hash(canonical(expected)),
        actualHash: hash(canonical(configOf(target))),
      }, 0o600);
      assertExact(target, expected, role);
    }
    resolved[role] = summary(target);
    persistJournal();
  }
} catch (error) {
  const cleanup = [];
  const beforeIds = new Set(listed.map(idOf));
  const ambiguousDiscoveries = [];
  try {
    for (const agent of await listAllAgents()) {
      const role = Object.entries(roles).find(([, spec]) => spec.name === agent.name)?.[0];
      if (!role || beforeIds.has(idOf(agent))) continue;
      const candidate = await request('GET', `/agents/${idOf(agent)}`);
      const expectedHash = hash(canonical(expectedByRole[role]));
      const actualHash = hash(canonical(configOf(candidate)));
      ambiguousDiscoveries.push({
        role,
        id: idOf(agent),
        discoveredAfterAmbiguousCreate: true,
        exactImmutableConfigMatch: actualHash === expectedHash,
        expectedHash,
        actualHash,
        deleted: false,
        disposition: 'quarantined because an ambiguous create response cannot prove ownership',
      });
    }
  } catch (discoveryError) {
    cleanup.push({ discoveredAfterAmbiguousCreate: true, deleted: false, error: `Cleanup discovery failed: ${discoveryError.message}` });
  }
  const cleanupTargets = createdThisRun.filter((item, index, items) => item.id && items.findIndex((candidate) => candidate.id === item.id) === index);
  for (const item of cleanupTargets.reverse()) {
    try { await deleteAndVerify(item.id); cleanup.push({ ...item, deleted: true }); }
    catch (cleanupError) { cleanup.push({ ...item, deleted: false, error: cleanupError.message }); }
  }
  writeJson(evidenceDir, 'failed-apply.json', { pass: false, error: error.message, cleanup, ambiguousDiscoveries });
  throw error;
}

const ids = Object.values(resolved).map((agent) => agent.id);
const validation = {
  exactRoles: Object.keys(resolved), distinctIds: new Set(ids).size === 3,
  allPublished: Object.values(resolved).every((agent) => agent.status === 'published'),
};
validation.pass = validation.exactRoles.length === 3 && validation.distinctIds && validation.allPublished;
writeJson(evidenceDir, 'after-readback.json', { runId, agents: resolved });
writeJson(evidenceDir, 'rollback.json', {
  operation: 'run the executable rollback command only after restoring the prior Jahia block',
  manifest: `${privateDir}/rollback-manifest.json`, createdAgentIds: createdThisRun.map(({ role, id }) => ({ role, id })),
});
writeJson(evidenceDir, 'validation.json', validation);
if (!validation.pass) throw new Error('Judge v2 deployment validation failed.');
process.stdout.write(JSON.stringify({
  pass: true, evidenceDir, privateStateDir: privateDir,
  agentIds: Object.fromEntries(Object.entries(resolved).map(([role, agent]) => [role, agent.id])),
}, null, 2) + '\n');
