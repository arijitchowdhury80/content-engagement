import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(here, '..', '..');
export const EXPECTED_APP_ID = '0EXRPAXB56';
export const EXPECTED_MODEL = 'gpt-5.4-mini';
export const EXPECTED_PROVIDER_ID = 'e14c1f5e-7c24-4451-a342-940e427f769b';
export const SOURCE_JUDGE_IDS = Object.freeze({
  skeptic: '573fb67f-72f0-4baa-8b14-33fd32dc9718',
  referee: '2ec4490f-67df-479f-8c7a-5d58440e2e10',
  advocate: '1b14aea2-6b0b-497a-9dff-be0dee3bb956',
});
export const DEFAULT_RELEASE = 'v3.4-system-prompt-ab-a';
export const CANDIDATE_PROMPT_DIR = resolve(ROOT, 'agents/prompts/judge/candidate');
export const DEFAULT_OUTPUT_ROOT = resolve(ROOT, 'production_comparison/runs');
export const SYSTEM_PROMPT_PATH = resolve(CANDIDATE_PROMPT_DIR, 'system_prompt_judge_v3.md');
export const ROLE_SPECS = Object.freeze({
  skeptic: { label: 'Skeptic', instructionsFile: 'instructions_skeptic.md' },
  referee: { label: 'Referee', instructionsFile: 'instructions_referee.md' },
  advocate: { label: 'Advocate', instructionsFile: 'instructions_advocate.md' },
});

export const hash = (value) => createHash('sha256').update(String(value ?? '')).digest('hex');
export const canonicalize = (value) => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
};
export const canonical = (value) => JSON.stringify(canonicalize(value));
export const idOf = (agent) => agent?.id || agent?.objectID;

export function assertSafeLabel(value, label) {
  if (!value || !/^[a-zA-Z0-9._-]+$/.test(value)) {
    throw new Error(`${label} may contain only letters, numbers, dot, underscore, and hyphen.`);
  }
  return value;
}

export function configOf(agent) {
  return {
    name: agent?.name,
    status: agent?.status,
    systemPrompt: agent?.systemPrompt ?? null,
    instructions: agent?.instructions,
    model: agent?.model,
    providerId: agent?.providerId,
    tools: agent?.tools || [],
    config: agent?.config || {},
  };
}

export function immutableIdentityOf(agent) {
  const { status: _status, ...identity } = configOf(agent);
  return identity;
}

export function candidateName(role, release = DEFAULT_RELEASE) {
  const spec = ROLE_SPECS[role];
  if (!spec) throw new Error(`Unknown judge role: ${role}`);
  assertSafeLabel(release, 'Candidate release');
  return `www Chat - Confidence ${spec.label} Candidate ${release}`;
}

export function loadCandidatePrompts() {
  const systemPrompt = readFileSync(SYSTEM_PROMPT_PATH, 'utf8').trim();
  const instructions = Object.fromEntries(Object.entries(ROLE_SPECS).map(([role, spec]) => [
    role,
    readFileSync(resolve(CANDIDATE_PROMPT_DIR, spec.instructionsFile), 'utf8').trim(),
  ]));
  return { systemPrompt, instructions };
}

function assertNoSensitiveConfigKeys(value, trail = 'config') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoSensitiveConfigKeys(item, `${trail}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (/(api.?key|secret|password|credential|access.?token|private.?key)/i.test(key)) {
      throw new Error(`Refusing to clone sensitive-looking source field ${trail}.${key}.`);
    }
    assertNoSensitiveConfigKeys(child, `${trail}.${key}`);
  }
}

export function buildCandidateConfig(source) {
  assertNoSensitiveConfigKeys(source?.config || {});
  const config = structuredClone(source?.config || {});
  config.enableAlgoliaMcp = false;
  config.suggestions = {
    ...(config.suggestions || {}),
    enabled: false,
    model: EXPECTED_MODEL,
    system_prompt: '',
    generation: { ...(config.suggestions?.generation || {}), max_count: 1 },
    context: { ...(config.suggestions?.context || {}), include_tool_outputs: true },
  };
  return config;
}

export function buildExpectedCandidate({ role, release, source, prompts = loadCandidatePrompts() }) {
  if (!idOf(source) || !source.model || !source.providerId) {
    throw new Error(`${role} source readback is missing id, model, or providerId.`);
  }
  if (idOf(source) !== SOURCE_JUDGE_IDS[role]) {
    throw new Error(`${role} source readback ID does not match the locked current judge ID.`);
  }
  if (source.status !== 'published') {
    throw new Error(`${role} source judge is not published; refusing to clone an unstable source.`);
  }
  if (source.model !== EXPECTED_MODEL) {
    throw new Error(`${role} source judge model drifted: expected ${EXPECTED_MODEL}, received ${source.model}.`);
  }
  if (source.providerId !== EXPECTED_PROVIDER_ID) {
    throw new Error(`${role} source judge provider drifted: expected ${EXPECTED_PROVIDER_ID}, received ${source.providerId}.`);
  }
  return {
    name: candidateName(role, release),
    status: 'published',
    systemPrompt: prompts.systemPrompt,
    instructions: prompts.instructions[role],
    model: EXPECTED_MODEL,
    providerId: EXPECTED_PROVIDER_ID,
    tools: [],
    config: buildCandidateConfig(source),
  };
}

export function assertExactReadback(agent, expected, role) {
  const actual = configOf(agent);
  const fields = ['systemPrompt', 'instructions', 'model', 'providerId', 'tools', 'config'];
  const mismatches = fields.filter((field) => canonical(actual[field]) !== canonical(expected[field]));
  if (actual.name !== expected.name) mismatches.unshift('name');
  if (actual.status !== expected.status) mismatches.unshift('status');
  if (mismatches.length) {
    throw new Error(`${role} failed immutable readback validation for: ${mismatches.join(', ')}.`);
  }
  return true;
}

export function assertMutationRequest(method, path, mutableAgentIds = new Set()) {
  const verb = method.toUpperCase();
  if (verb === 'GET' || verb === 'HEAD') return true;
  for (const sourceId of Object.values(SOURCE_JUDGE_IDS)) {
    if (path.split('/').includes(sourceId)) {
      throw new Error(`Mutation of current judge ${sourceId} is permanently prohibited.`);
    }
  }
  if (verb === 'POST' && path === '/agents') return true;
  const match = path.match(/^\/agents\/([^/]+)(?:\/(publish))?$/);
  if (!match || !mutableAgentIds.has(match[1])) {
    throw new Error(`Mutation is not restricted to an agent created by this run: ${verb} ${path}`);
  }
  if (verb === 'POST' && match[2] === 'publish') return true;
  if (verb === 'DELETE' && !match[2]) return true;
  throw new Error(`Unsupported candidate mutation: ${verb} ${path}`);
}

function readEnv() {
  const env = { ...process.env };
  const candidates = [process.env.ACS_ENV, resolve(ROOT, '.env.local')].filter(Boolean);
  const envPath = candidates.find(existsSync);
  if (!envPath) return env;
  for (const raw of readFileSync(envPath, 'utf8').split('\n')) {
    const line = raw.trim().replace(/^export\s+/, '');
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const index = line.indexOf('=');
    const key = line.slice(0, index).trim();
    if (!(key in env)) env[key] = line.slice(index + 1).trim().replace(/^['"]|['"]$/g, '');
  }
  return env;
}

export function ensurePrivateDirectory(path) {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  chmodSync(path, 0o700);
}

export function ensureDeploymentDirectories(paths) {
  for (const path of [paths.base, paths.evidence, paths.private]) ensurePrivateDirectory(path);
}

export function writeJson(path, value) {
  ensurePrivateDirectory(dirname(path));
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
}

export function summarizeAgent(agent) {
  const config = configOf(agent);
  return {
    id: idOf(agent),
    name: config.name,
    status: config.status,
    model: config.model,
    providerId: config.providerId,
    toolCount: config.tools.length,
    systemPromptHash: hash(config.systemPrompt),
    instructionsHash: hash(config.instructions),
    configHash: hash(canonical(config.config)),
    exactConfigHash: hash(canonical(config)),
  };
}

export function buildAfterReadbackManifest({ runId, release, appId, promptHashes, agents }) {
  assertSafeLabel(runId, 'Run ID');
  assertSafeLabel(release, 'Candidate release');
  if (appId !== EXPECTED_APP_ID) {
    throw new Error(`After-readback manifest is locked to ${EXPECTED_APP_ID}; refusing ${appId}.`);
  }
  const roles = Object.keys(ROLE_SPECS);
  if (!agents || roles.some((role) => !agents[role])) {
    throw new Error('After-readback manifest requires all three candidate agents.');
  }
  return {
    schemaVersion: 1,
    runId,
    release,
    appId,
    promptHashes: structuredClone(promptHashes),
    agents: Object.fromEntries(roles.map((role) => [role, summarizeAgent(agents[role])])),
  };
}

function parseArguments(argv) {
  const valueAfter = (flag) => {
    const index = argv.indexOf(flag);
    if (index < 0) return null;
    if (!argv[index + 1] || argv[index + 1].startsWith('--')) throw new Error(`${flag} requires a value.`);
    return argv[index + 1];
  };
  const apply = argv.includes('--apply');
  const rollback = valueAfter('--rollback');
  const plan = valueAfter('--plan');
  const release = valueAfter('--release') || process.env.JUDGE_PROMPT_AB_RELEASE || DEFAULT_RELEASE;
  const runId = valueAfter('--run-id') || process.env.JUDGE_PROMPT_AB_RUN_ID || new Date().toISOString().replace(/[:.]/g, '-');
  if (apply && rollback) throw new Error('--apply and --rollback are mutually exclusive.');
  if (apply && !plan) throw new Error('--apply requires the sanitized dry-run --plan path.');
  if (!apply && plan) throw new Error('--plan is valid only with --apply.');
  return { apply, rollback, plan, release, runId, help: argv.includes('--help') };
}

export function outputPaths(runId) {
  assertSafeLabel(runId, 'Run ID');
  const base = resolve(DEFAULT_OUTPUT_ROOT, runId, 'candidate-deploy');
  return { base, evidence: resolve(base, 'evidence'), private: resolve(base, 'private') };
}

function verifyPlan(plan) {
  const { planHash, ...core } = plan;
  if (!planHash || hash(canonical(core)) !== planHash) throw new Error('Dry-run plan hash is invalid.');
  if (plan.schemaVersion !== 1 || plan.appId !== EXPECTED_APP_ID || plan.mode !== 'dry-run') {
    throw new Error('Dry-run plan does not match the candidate deployment contract.');
  }
  assertSafeLabel(plan.runId, 'Run ID');
  assertSafeLabel(plan.release, 'Candidate release');
  return core;
}

async function execute(argv = process.argv.slice(2)) {
  const args = parseArguments(argv);
  if (args.help) {
    process.stdout.write([
      'Judge prompt A/B candidate deployment (no current-agent mutations).',
      '',
      'Dry run:',
      '  node agents/admin/deploy_judge_prompt_ab_candidates.mjs --run-id <id> [--release <label>]',
      'Apply the exact dry-run plan:',
      '  node agents/admin/deploy_judge_prompt_ab_candidates.mjs --apply --plan <deployment-plan.json>',
      'Rollback agents created by one apply:',
      '  node agents/admin/deploy_judge_prompt_ab_candidates.mjs --rollback <rollback-manifest.json>',
      '',
    ].join('\n'));
    return;
  }

  const env = readEnv();
  const appId = env.ALGOLIA_APP_ID || EXPECTED_APP_ID;
  if (appId !== EXPECTED_APP_ID) throw new Error(`Deployment is locked to ${EXPECTED_APP_ID}; refusing ${appId}.`);
  const adminKey = env.ALGOLIA_ADMIN_API_KEY;
  if (!adminKey) throw new Error('Missing ALGOLIA_ADMIN_API_KEY; no Agent Studio request was made.');
  const base = `https://${appId}.algolia.net/agent-studio/1`;
  const headers = {
    'content-type': 'application/json',
    'x-algolia-application-id': appId,
    'x-algolia-api-key': adminKey,
  };
  const mutableAgentIds = new Set();
  const request = async (method, path, body, { allow404 = false } = {}) => {
    assertMutationRequest(method, path, mutableAgentIds);
    let lastError;
    const maxAttempts = method === 'POST' && path === '/agents' ? 1 : 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const response = await fetch(`${base}${path}`, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const text = await response.text();
      let json;
      try { json = text ? JSON.parse(text) : {}; } catch { json = { unparsedResponse: true }; }
      if (allow404 && response.status === 404) return null;
      if (response.ok) return json;
      lastError = new Error(`${method} ${path} failed with HTTP ${response.status}.`);
      if (!(response.status === 429 || response.status >= 500) || attempt === maxAttempts) break;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 500 * (2 ** (attempt - 1))));
    }
    throw lastError;
  };
  const listAllAgents = async () => {
    const all = [];
    for (let offset = 0; offset < 10000; offset += 100) {
      const page = await request('GET', `/agents?limit=100&offset=${offset}`);
      const items = page.data || page.agents || page.items || [];
      all.push(...items);
      if (items.length < 100) return all;
    }
    throw new Error('Agent pagination exceeded the safety limit.');
  };
  const deleteAndVerify = async (item, { createdByThisProcess = false } = {}) => {
    if (Object.values(SOURCE_JUDGE_IDS).includes(item.id)) throw new Error('Rollback manifest contains a protected source judge ID.');
    const current = await request('GET', `/agents/${item.id}`, undefined, { allow404: true });
    if (!current) return { ...item, alreadyAbsent: true };
    const immutableIdentityMatches = hash(canonical(immutableIdentityOf(current))) === item.immutableIdentityHash;
    if (current.name !== item.name || (!createdByThisProcess && !immutableIdentityMatches)) {
      throw new Error(`Rollback ownership validation failed for ${item.id}.`);
    }
    mutableAgentIds.add(item.id);
    await request('DELETE', `/agents/${item.id}`, undefined, { allow404: true });
    if (await request('GET', `/agents/${item.id}`, undefined, { allow404: true })) {
      throw new Error(`Rollback failed: ${item.id} still exists.`);
    }
    return { ...item, deleted: true, readbackAbsent: true };
  };

  if (args.rollback) {
    const manifest = JSON.parse(readFileSync(resolve(args.rollback), 'utf8'));
    if (manifest.schemaVersion !== 1 || manifest.appId !== EXPECTED_APP_ID || !Array.isArray(manifest.createdThisRun)) {
      throw new Error('Invalid candidate rollback manifest.');
    }
    const paths = outputPaths(manifest.runId);
    ensureDeploymentDirectories(paths);
    const results = [];
    for (const item of [...manifest.createdThisRun].reverse()) results.push(await deleteAndVerify(item));
    writeJson(resolve(paths.evidence, 'rollback-readback.json'), { pass: true, runId: manifest.runId, results });
    process.stdout.write(`${JSON.stringify({ pass: true, rolledBack: results }, null, 2)}\n`);
    return;
  }

  const suppliedPlan = args.apply ? JSON.parse(readFileSync(resolve(args.plan), 'utf8')) : null;
  const planCore = suppliedPlan ? verifyPlan(suppliedPlan) : null;
  const runId = planCore?.runId || args.runId;
  const release = planCore?.release || args.release;
  const paths = outputPaths(runId);
  ensureDeploymentDirectories(paths);
  const prompts = loadCandidatePrompts();
  const promptHashes = {
    systemPrompt: hash(prompts.systemPrompt),
    instructions: Object.fromEntries(Object.entries(prompts.instructions).map(([role, text]) => [role, hash(text)])),
  };
  if (planCore && canonical(planCore.promptHashes) !== canonical(promptHashes)) {
    throw new Error('Candidate prompt files changed after dry-run; create a new dry-run plan.');
  }

  const listed = await listAllAgents();
  const byName = new Map();
  for (const agent of listed) {
    if (!byName.has(agent.name)) byName.set(agent.name, []);
    byName.get(agent.name).push(agent);
  }
  const sources = {};
  const expected = {};
  const roles = {};
  const existingTargets = {};
  for (const role of Object.keys(ROLE_SPECS)) {
    const source = await request('GET', `/agents/${SOURCE_JUDGE_IDS[role]}`);
    sources[role] = source;
    expected[role] = buildExpectedCandidate({ role, release, source, prompts });
    const matches = byName.get(expected[role].name) || [];
    if (matches.length > 1) throw new Error(`Found multiple candidates named ${expected[role].name}.`);
    const existing = matches[0] ? await request('GET', `/agents/${idOf(matches[0])}`) : null;
    existingTargets[role] = existing;
    roles[role] = {
      source: summarizeAgent(source),
      candidateName: expected[role].name,
      candidateExactConfigHash: hash(canonical(expected[role])),
      existingCandidate: existing ? summarizeAgent(existing) : null,
    };
  }

  const privateSnapshot = {
    schemaVersion: 1,
    runId,
    capturedAt: new Date().toISOString(),
    sources,
    expected,
    existingTargets,
  };
  writeJson(resolve(paths.private, args.apply ? 'apply-before-snapshot.json' : 'dry-run-before-snapshot.json'), privateSnapshot);

  if (!args.apply) {
    const core = {
      schemaVersion: 1,
      mode: 'dry-run',
      runId,
      release,
      appId,
      immutableCreateOnly: true,
      generatedAt: new Date().toISOString(),
      promptHashes,
      roles,
    };
    const plan = { ...core, planHash: hash(canonical(core)) };
    const planPath = resolve(paths.evidence, 'deployment-plan.json');
    writeJson(planPath, plan);
    process.stdout.write(`${JSON.stringify({ pass: true, dryRun: true, planPath, outputRoot: paths.base }, null, 2)}\n`);
    return;
  }

  for (const role of Object.keys(ROLE_SPECS)) {
    if (roles[role].source.exactConfigHash !== planCore.roles[role].source.exactConfigHash
      || roles[role].candidateExactConfigHash !== planCore.roles[role].candidateExactConfigHash) {
      throw new Error(`${role} source or expected candidate changed after dry-run; no mutation was made.`);
    }
  }

  const createdThisRun = [];
  const mutationJournal = [];
  const manifestPath = resolve(paths.private, 'rollback-manifest.json');
  const persistManifest = () => writeJson(manifestPath, {
    schemaVersion: 1,
    runId,
    appId,
    createdThisRun,
    mutationJournal,
  });
  const resolvedAgents = {};
  try {
    for (const role of Object.keys(ROLE_SPECS)) {
      const matches = byName.get(expected[role].name) || [];
      let target;
      if (matches.length === 1) {
        target = await request('GET', `/agents/${idOf(matches[0])}`);
        assertExactReadback(target, expected[role], role);
        mutationJournal.push({ role, operation: 'reuse-exact', id: idOf(target), at: new Date().toISOString() });
      } else {
        const created = await request('POST', '/agents', expected[role]);
        const id = idOf(created);
        if (!id) throw new Error(`${role} candidate creation returned no agent ID.`);
        mutableAgentIds.add(id);
        const owned = {
          role,
          id,
          name: expected[role].name,
          exactConfigHash: hash(canonical(expected[role])),
          immutableIdentityHash: hash(canonical(immutableIdentityOf(expected[role]))),
        };
        createdThisRun.push(owned);
        mutationJournal.push({ role, operation: 'create', id, at: new Date().toISOString() });
        persistManifest();
        await request('POST', `/agents/${id}/publish`, {});
        mutationJournal.push({ role, operation: 'publish', id, at: new Date().toISOString() });
        target = await request('GET', `/agents/${id}`);
        writeJson(resolve(paths.private, `readback-${role}.json`), {
          expected: expected[role],
          actual: configOf(target),
        });
        assertExactReadback(target, expected[role], role);
      }
      resolvedAgents[role] = target;
      persistManifest();
    }
  } catch (error) {
    const cleanup = [];
    const ambiguousDiscoveries = [];
    const beforeIds = new Set(listed.map(idOf));
    const knownCreatedIds = new Set(createdThisRun.map((item) => item.id));
    try {
      for (const agent of await listAllAgents()) {
        const role = Object.keys(ROLE_SPECS).find((candidateRole) => expected[candidateRole].name === agent.name);
        if (!role || beforeIds.has(idOf(agent)) || knownCreatedIds.has(idOf(agent))) continue;
        const candidate = await request('GET', `/agents/${idOf(agent)}`);
        ambiguousDiscoveries.push({
          ...summarizeAgent(candidate),
          role,
          exactImmutableConfigMatch: hash(canonical(configOf(candidate))) === hash(canonical(expected[role])),
          disposition: 'quarantined: an ambiguous create response cannot prove ownership',
        });
        writeJson(resolve(paths.private, `ambiguous-readback-${role}-${idOf(candidate)}.json`), candidate);
      }
    } catch (discoveryError) {
      ambiguousDiscoveries.push({ discoveryFailed: true, error: discoveryError.message });
    }
    for (const item of [...createdThisRun].reverse()) {
      try { cleanup.push(await deleteAndVerify(item, { createdByThisProcess: true })); }
      catch (cleanupError) { cleanup.push({ ...item, deleted: false, error: cleanupError.message }); }
    }
    writeJson(resolve(paths.evidence, 'failed-apply.json'), {
      pass: false,
      error: error.message,
      cleanup,
      ambiguousDiscoveries,
    });
    throw error;
  }

  const afterReadback = buildAfterReadbackManifest({
    runId,
    release,
    appId,
    promptHashes,
    agents: resolvedAgents,
  });
  const summaries = afterReadback.agents;
  const ids = Object.values(summaries).map((agent) => agent.id);
  const validation = {
    pass: false,
    exactReadbackFields: ['systemPrompt', 'instructions', 'model', 'providerId', 'tools', 'config'],
    threeRoles: Object.keys(summaries).length === 3,
    distinctCandidateIds: new Set(ids).size === 3,
    excludesSourceJudgeIds: ids.every((id) => !Object.values(SOURCE_JUDGE_IDS).includes(id)),
    allPublished: Object.values(summaries).every((agent) => agent.status === 'published'),
  };
  validation.pass = validation.threeRoles && validation.distinctCandidateIds
    && validation.excludesSourceJudgeIds && validation.allPublished;
  writeJson(resolve(paths.evidence, 'after-readback.json'), afterReadback);
  writeJson(resolve(paths.evidence, 'validation.json'), validation);
  writeJson(resolve(paths.evidence, 'rollback.json'), {
    manifestPath,
    command: `node agents/admin/deploy_judge_prompt_ab_candidates.mjs --rollback ${manifestPath}`,
  });
  if (!validation.pass) throw new Error('Candidate deployment validation failed.');
  process.stdout.write(`${JSON.stringify({
    pass: true,
    outputRoot: paths.base,
    candidateIds: Object.fromEntries(Object.entries(summaries).map(([role, agent]) => [role, agent.id])),
  }, null, 2)}\n`);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) execute().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
