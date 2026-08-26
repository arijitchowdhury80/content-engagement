#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ENV_FILE = path.join(ROOT, '.env.local');
const APP_ID = '0EXRPAXB56';
const AGENT_ID = 'e2c8596a-4420-41d2-80bb-5cd4aaeffda6';
const AGENT_NAME = 'www Chat - Orchestrator';
const CATEGORY = 'prompt_injection_or_secrets';
export const SPECIALIST_ALLOWANCE = 'Requests to use, consult, bring in, or route to a configured Algolia specialist agent are allowed and must not be classified as prompt injection or secret requests.';

function loadEnvironment() {
  const env = { ...process.env };
  if (fs.existsSync(ENV_FILE)) {
    for (const line of fs.readFileSync(ENV_FILE, 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
      const at = trimmed.indexOf('=');
      const key = trimmed.slice(0, at).trim();
      let value = trimmed.slice(at + 1).trim();
      if (value.length >= 2 && value[0] === value.at(-1) && ['"', "'"].includes(value[0])) value = value.slice(1, -1);
      if (!(key in env)) env[key] = value;
    }
  }
  return env;
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function writePrivate(file, value, { replace = false } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
    flag: replace ? 'w' : 'wx',
  });
}

function safeOutputDir(raw) {
  if (!raw) throw new Error('--out is required');
  const resolved = path.resolve(raw);
  if (!(resolved === '/private/tmp' || resolved.startsWith('/private/tmp/'))) {
    throw new Error('--out must be an absolute private path under /private/tmp');
  }
  return resolved;
}

export function buildGuardrailConfig(config) {
  if (!config?.guardrail?.enabled) throw new Error('Orchestrator guardrail must remain enabled');
  const categories = config.guardrail.categories ?? [];
  const matches = categories.filter((category) => category?.name === CATEGORY);
  if (matches.length !== 1) throw new Error(`Expected exactly one ${CATEGORY} category; found ${matches.length}`);
  const next = structuredClone(config);
  const category = next.guardrail.categories.find((candidate) => candidate.name === CATEGORY);
  if (!category.description.includes(SPECIALIST_ALLOWANCE)) {
    category.description = `${category.description.trim()} ${SPECIALIST_ALLOWANCE}`;
  }
  return next;
}

function agentSummary(agent) {
  return {
    id: agent.id,
    name: agent.name,
    providerId: agent.providerId,
    model: agent.model,
    instructionsHash: digest(agent.instructions ?? ''),
    systemPromptHash: digest(agent.systemPrompt ?? ''),
    toolsHash: digest(agent.tools ?? []),
    configHash: digest(agent.config ?? {}),
  };
}

async function requestAgent({ method = 'GET', apiKey, payload }) {
  const response = await fetch(`https://${APP_ID}.algolia.net/agent-studio/1/agents/${AGENT_ID}`, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-algolia-application-id': APP_ID,
      'x-algolia-api-key': apiKey,
      'user-agent': 'algolia-guardrail-refinement/1',
    },
    body: payload ? JSON.stringify(payload) : undefined,
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} orchestrator failed: HTTP ${response.status} ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

function assertTarget(agent) {
  const normalizedName = String(agent.name ?? '').replace(/[\u2012-\u2015]/g, '-').replace(/\s+/g, ' ').trim();
  if (agent.id !== AGENT_ID || normalizedName !== AGENT_NAME) {
    throw new Error(`Target identity mismatch: ${agent.id ?? 'missing'} / ${agent.name ?? 'missing'}`);
  }
}

export async function run({ out, apply = false, env = loadEnvironment() }) {
  const outputDir = safeOutputDir(out);
  if (env.ALGOLIA_APP_ID !== APP_ID) throw new Error(`ALGOLIA_APP_ID must be ${APP_ID}`);
  if (!env.ALGOLIA_ADMIN_API_KEY) throw new Error('ALGOLIA_ADMIN_API_KEY is required');
  const beforePath = path.join(outputDir, 'before-snapshot.json');
  const packetPath = path.join(outputDir, 'mutation-packet.json');

  if (!apply) {
    const before = await requestAgent({ apiKey: env.ALGOLIA_ADMIN_API_KEY });
    assertTarget(before);
    const nextConfig = buildGuardrailConfig(before.config);
    const packet = {
      schema: 'OrchestratorGuardrailSpecialistAllowance.v1',
      target: { appId: APP_ID, agentId: AGENT_ID, name: AGENT_NAME },
      category: CATEGORY,
      beforeSummary: agentSummary(before),
      intendedConfigHash: digest(nextConfig),
      allowance: SPECIALIST_ALLOWANCE,
      payloadKeys: ['config'],
      preserves: ['instructions', 'systemPrompt', 'tools', 'providerId', 'model', 'all other config'],
      rollback: 'before-snapshot.json config',
    };
    writePrivate(beforePath, before);
    writePrivate(packetPath, packet);
    return { pass: true, dryRun: true, out: outputDir, packet };
  }

  const before = JSON.parse(fs.readFileSync(beforePath, 'utf8'));
  const packet = JSON.parse(fs.readFileSync(packetPath, 'utf8'));
  const current = await requestAgent({ apiKey: env.ALGOLIA_ADMIN_API_KEY });
  assertTarget(current);
  if (agentSummary(current).configHash !== packet.beforeSummary.configHash) {
    throw new Error('Live orchestrator config drifted after dry-run; refusing mutation');
  }
  const nextConfig = buildGuardrailConfig(current.config);
  if (digest(nextConfig) !== packet.intendedConfigHash) throw new Error('Intended config drifted after dry-run');

  await requestAgent({ method: 'PATCH', apiKey: env.ALGOLIA_ADMIN_API_KEY, payload: { config: nextConfig } });
  let after;
  try {
    after = await requestAgent({ apiKey: env.ALGOLIA_ADMIN_API_KEY });
    assertTarget(after);
    const beforeSummary = agentSummary(before);
    const afterSummary = agentSummary(after);
    const checks = {
      configExact: afterSummary.configHash === packet.intendedConfigHash,
      guardrailEnabled: after.config?.guardrail?.enabled === true,
      allowancePresent: after.config?.guardrail?.categories?.find((category) => category.name === CATEGORY)?.description?.includes(SPECIALIST_ALLOWANCE) === true,
      instructionsUnchanged: afterSummary.instructionsHash === beforeSummary.instructionsHash,
      systemPromptUnchanged: afterSummary.systemPromptHash === beforeSummary.systemPromptHash,
      toolsUnchanged: afterSummary.toolsHash === beforeSummary.toolsHash,
      providerUnchanged: afterSummary.providerId === beforeSummary.providerId,
      modelUnchanged: afterSummary.model === beforeSummary.model,
    };
    const result = { pass: Object.values(checks).every(Boolean), checks, beforeSummary, afterSummary };
    writePrivate(path.join(outputDir, 'after-readback.json'), after);
    writePrivate(path.join(outputDir, 'validation.json'), result);
    if (!result.pass) throw new Error('Guardrail refinement readback validation failed');
    return { ...result, out: outputDir };
  } catch (error) {
    await requestAgent({ method: 'PATCH', apiKey: env.ALGOLIA_ADMIN_API_KEY, payload: { config: before.config } });
    const rollback = await requestAgent({ apiKey: env.ALGOLIA_ADMIN_API_KEY });
    const rollbackResult = { pass: digest(rollback.config) === digest(before.config), error: String(error) };
    writePrivate(path.join(outputDir, 'rollback-validation.json'), rollbackResult);
    throw error;
  }
}

function parseArgs(argv) {
  const outAt = argv.indexOf('--out');
  return { out: outAt >= 0 ? argv[outAt + 1] : null, apply: argv.includes('--apply') };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run(parseArgs(process.argv.slice(2)))
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => {
      console.error(JSON.stringify({ pass: false, error: error.message }));
      process.exitCode = 1;
    });
}
