#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { applyPatchWithRecovery } from './safe_agent_patch.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const APP_ID = '0EXRPAXB56';
const LOCK_PATH = path.join(ROOT, 'config/judge-final-lock.json');
const SYSTEM_PROMPT_PATH = path.join(ROOT, 'agents/prompts/judge/candidate/system_prompt_judge_v3.md');
const ROLE_INSTRUCTION_PATHS = Object.freeze({
  skeptic: path.join(ROOT, 'agents/prompts/judge/candidate/instructions_skeptic.md'),
  referee: path.join(ROOT, 'agents/prompts/judge/candidate/instructions_referee.md'),
  advocate: path.join(ROOT, 'agents/prompts/judge/candidate/instructions_advocate.md'),
});
const ROLES = Object.freeze(Object.keys(ROLE_INSTRUCTION_PATHS));

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function hash(value) {
  return createHash('sha256').update(typeof value === 'string' ? value : canonical(value)).digest('hex');
}

function readEnvironment() {
  const env = { ...process.env };
  const candidates = [env.ACS_ENV, path.join(ROOT, '.env.local')].filter(Boolean);
  const envPath = candidates.find(fs.existsSync);
  if (!envPath) return env;
  for (const raw of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const line = raw.trim().replace(/^export\s+/, '');
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const index = line.indexOf('=');
    const key = line.slice(0, index).trim();
    if (!(key in env)) env[key] = line.slice(index + 1).trim().replace(/^['"]|['"]$/g, '');
  }
  return env;
}

function safeOutputDir(raw) {
  if (!raw) throw new Error('--out is required');
  const resolved = path.resolve(raw);
  if (!resolved.startsWith('/private/tmp/')) throw new Error('--out must be under /private/tmp');
  return resolved;
}

function writePrivate(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
}

function loadContract() {
  const lock = JSON.parse(fs.readFileSync(LOCK_PATH, 'utf8'));
  const systemPrompt = fs.readFileSync(SYSTEM_PROMPT_PATH, 'utf8').trim();
  const instructions = Object.fromEntries(ROLES.map((role) => [
    role,
    fs.readFileSync(ROLE_INSTRUCTION_PATHS[role], 'utf8').trim(),
  ]));
  const required = [
    'DIMENSION INDEPENDENCE',
    'MUST NOT automatically lower Completeness, Depth, or Relevance',
    'do not lower Depth merely because no public fixed price exists',
  ];
  const missing = required.filter((text) => !systemPrompt.includes(text));
  if (missing.length) throw new Error(`System prompt is missing approved rules: ${missing.join(', ')}`);
  if (lock.provider?.name !== 'OpenAI' || lock.provider?.model !== 'gpt-5.4-mini') {
    throw new Error('Judge provider lock is not the approved OpenAI gpt-5.4-mini contract');
  }
  if (canonical(Object.keys(lock.agents || {}).sort()) !== canonical([...ROLES].sort())) {
    throw new Error('Judge lock must contain exactly skeptic, referee, and advocate');
  }
  return { lock, systemPrompt, instructions };
}

function protectedState(agent) {
  return {
    id: agent.id || agent.objectID,
    name: agent.name,
    status: agent.status,
    model: agent.model,
    providerId: agent.providerId,
    instructions: agent.instructions,
    tools: agent.tools || [],
    config: agent.config || {},
  };
}

function summary(agent) {
  const protectedFields = protectedState(agent);
  return {
    id: protectedFields.id,
    name: protectedFields.name,
    status: protectedFields.status,
    model: protectedFields.model,
    providerId: protectedFields.providerId,
    toolCount: protectedFields.tools.length,
    systemPromptHash: hash(agent.systemPrompt || ''),
    instructionsHash: hash(protectedFields.instructions || ''),
    protectedStateHash: hash(protectedFields),
    exactAgentHash: hash(agent),
  };
}

export function assertTarget(role, agent, contract) {
  if (!ROLES.includes(role)) throw new Error(`Unknown role: ${role}`);
  const expectedId = contract.lock.agents[role];
  const state = protectedState(agent);
  if (state.id !== expectedId) throw new Error(`${role} identity mismatch: ${state.id || 'missing'}`);
  if (state.status !== 'published') throw new Error(`${role} is not published`);
  if (state.model !== contract.lock.provider.model || state.providerId !== contract.lock.provider.id) {
    throw new Error(`${role} provider or model drifted`);
  }
  if (state.tools.length !== 0) throw new Error(`${role} unexpectedly has tools`);
  if ((state.instructions || '').trim() !== contract.instructions[role]) {
    throw new Error(`${role} role instructions drifted`);
  }
  return true;
}

export function assertRequest(method, requestPath, body, targetIds) {
  const verb = method.toUpperCase();
  if (verb === 'GET') {
    if (requestPath === '/agents?limit=100' || /^\/agents\/[^/]+$/.test(requestPath)) return true;
    throw new Error(`Unsupported read path: ${requestPath}`);
  }
  const match = requestPath.match(/^\/agents\/([^/]+)$/);
  if (verb !== 'PATCH' || !match || !targetIds.has(match[1])) {
    throw new Error(`Mutation is not an approved in-place judge PATCH: ${verb} ${requestPath}`);
  }
  if (!body || canonical(Object.keys(body)) !== canonical(['systemPrompt'])) {
    throw new Error('Judge PATCH may contain only systemPrompt');
  }
  if (typeof body.systemPrompt !== 'string' || !body.systemPrompt.trim()) {
    throw new Error('Judge PATCH systemPrompt must be non-empty');
  }
  return true;
}

export function classifyPromptState(before, intendedSystemPrompt, observed) {
  const protectedStable = hash(protectedState(observed)) === hash(protectedState(before));
  const promptHash = hash(observed.systemPrompt || '');
  const beforeHash = hash(before.systemPrompt || '');
  const intendedHash = hash(intendedSystemPrompt);
  const promptBefore = promptHash === beforeHash;
  const promptIntended = promptHash === intendedHash;
  return {
    state: protectedStable && promptBefore && promptIntended
      ? 'equivalent'
      : protectedStable && promptBefore
        ? 'before'
        : protectedStable && promptIntended
          ? 'intended'
          : 'drift',
    details: { protectedStable, promptBefore, promptIntended },
  };
}

function inventorySummary(agents) {
  return {
    count: agents.length,
    idsHash: hash(agents.map((agent) => agent.id || agent.objectID).sort()),
  };
}

function parseArgs(argv) {
  const outIndex = argv.indexOf('--out');
  return {
    out: outIndex >= 0 ? argv[outIndex + 1] : null,
    apply: argv.includes('--apply'),
    rollback: argv.includes('--rollback'),
  };
}

export async function run({ out, apply = false, rollback = false, env = readEnvironment() }) {
  if (apply && rollback) throw new Error('--apply and --rollback are mutually exclusive');
  const outputDir = safeOutputDir(out);
  if ((env.ALGOLIA_APP_ID || APP_ID) !== APP_ID) throw new Error(`ALGOLIA_APP_ID must be ${APP_ID}`);
  if (!env.ALGOLIA_ADMIN_API_KEY) throw new Error('ALGOLIA_ADMIN_API_KEY is required');
  const contract = loadContract();
  const targetIds = new Set(Object.values(contract.lock.agents));
  const base = `https://${APP_ID}.algolia.net/agent-studio/1`;
  const headers = {
    'content-type': 'application/json',
    'x-algolia-application-id': APP_ID,
    'x-algolia-api-key': env.ALGOLIA_ADMIN_API_KEY,
    'user-agent': 'algolia-judge-system-prompt-update/1',
  };
  const request = async (method, requestPath, body) => {
    assertRequest(method, requestPath, body, targetIds);
    const response = await fetch(`${base}${requestPath}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`${method} ${requestPath} failed with HTTP ${response.status}: ${text.slice(0, 200)}`);
    return text ? JSON.parse(text) : {};
  };
  const readAgent = (role) => request('GET', `/agents/${contract.lock.agents[role]}`);
  const readInventory = async () => {
    const response = await request('GET', '/agents?limit=100');
    return response.data || response.agents || response.items || [];
  };
  const beforePath = path.join(outputDir, 'before-snapshot.json');
  const planPath = path.join(outputDir, 'mutation-plan.json');

  if (!apply && !rollback) {
    const agents = Object.fromEntries(await Promise.all(ROLES.map(async (role) => {
      const agent = await readAgent(role);
      assertTarget(role, agent, contract);
      return [role, agent];
    })));
    const inventory = inventorySummary(await readInventory());
    const snapshot = { capturedAt: new Date().toISOString(), appId: APP_ID, inventory, agents };
    const plan = {
      schema: 'JudgeSystemPromptUpdate.v1',
      appId: APP_ID,
      targetIds: contract.lock.agents,
      before: Object.fromEntries(ROLES.map((role) => [role, summary(agents[role])])),
      beforeInventory: inventory,
      intendedSystemPromptHash: hash(contract.systemPrompt),
      payloadKeys: ['systemPrompt'],
      preserves: ['id', 'name', 'status', 'model', 'providerId', 'instructions', 'tools', 'config'],
      createsAgents: false,
    };
    writePrivate(beforePath, snapshot);
    writePrivate(planPath, plan);
    return { pass: true, dryRun: true, out: outputDir, plan };
  }

  const snapshot = JSON.parse(fs.readFileSync(beforePath, 'utf8'));
  const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
  if (plan.schema !== 'JudgeSystemPromptUpdate.v1' || plan.appId !== APP_ID) throw new Error('Invalid mutation plan');
  if (plan.intendedSystemPromptHash !== hash(contract.systemPrompt)) throw new Error('System prompt changed after dry-run');
  if (canonical(plan.targetIds) !== canonical(contract.lock.agents)) throw new Error('Locked judge IDs changed after dry-run');
  const intendedSystemPrompt = rollback ? snapshot.agents.skeptic.systemPrompt : contract.systemPrompt;

  const beforeCurrent = {};
  for (const role of ROLES) {
    const current = await readAgent(role);
    assertTarget(role, current, contract);
    const expectedState = rollback
      ? classifyPromptState(snapshot.agents[role], contract.systemPrompt, current).state === 'intended'
      : summary(current).exactAgentHash === plan.before[role].exactAgentHash;
    if (!expectedState) throw new Error(`${role} drifted after dry-run; refusing mutation`);
    beforeCurrent[role] = current;
  }
  const inventoryBeforeApply = inventorySummary(await readInventory());
  if (canonical(inventoryBeforeApply) !== canonical(plan.beforeInventory)) {
    throw new Error('Agent inventory changed after dry-run; refusing mutation');
  }

  const after = {};
  for (const role of ROLES) {
    const targetPrompt = rollback ? snapshot.agents[role].systemPrompt : intendedSystemPrompt;
    const readCurrent = async () => {
      const agent = await readAgent(role);
      assertTarget(role, agent, contract);
      return agent;
    };
    after[role] = await applyPatchWithRecovery({
      read: readCurrent,
      patch: (payload) => request('PATCH', `/agents/${contract.lock.agents[role]}`, payload),
      classify: (observed) => classifyPromptState(beforeCurrent[role], targetPrompt, observed),
      intendedPayload: { systemPrompt: targetPrompt },
      recordRecovery: (entry) => writePrivate(path.join(outputDir, `recovery-${role}.json`), entry),
    });
  }

  const inventoryAfter = inventorySummary(await readInventory());
  const checks = {
    inventoryUnchanged: canonical(inventoryAfter) === canonical(plan.beforeInventory),
    identicalSystemPrompt: new Set(ROLES.map((role) => hash(after[role].systemPrompt || ''))).size === 1,
    intendedPromptApplied: ROLES.every((role) => hash(after[role].systemPrompt || '') === hash(intendedSystemPrompt)),
    protectedFieldsUnchanged: ROLES.every((role) => hash(protectedState(after[role])) === hash(protectedState(snapshot.agents[role]))),
  };
  const validation = {
    pass: Object.values(checks).every(Boolean),
    operation: rollback ? 'rollback' : 'apply',
    checks,
    inventoryBefore: plan.beforeInventory,
    inventoryAfter,
    agents: Object.fromEntries(ROLES.map((role) => [role, summary(after[role])])),
  };
  writePrivate(path.join(outputDir, rollback ? 'rollback-readback.json' : 'after-readback.json'), after);
  writePrivate(path.join(outputDir, rollback ? 'rollback-validation.json' : 'validation.json'), validation);
  if (!validation.pass) throw new Error('Judge system-prompt readback validation failed');
  return { ...validation, out: outputDir };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run(parseArgs(process.argv.slice(2)))
    .then((result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`))
    .catch((error) => {
      process.stderr.write(`${JSON.stringify({ pass: false, error: error.message })}\n`);
      process.exitCode = 1;
    });
}
