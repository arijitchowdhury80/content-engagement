#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { applyPatchWithRecovery } from './safe_agent_patch.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ENV_FILE = path.join(ROOT, '.env.local');
const INSTRUCTIONS_FILE = path.join(ROOT, 'agents/prompts/instructions_algolia_orchestrator.md');
const SYSTEM_FILE = path.join(ROOT, 'agents/prompts/system_algolia_orchestrator.md');
const APP_ID = '0EXRPAXB56';
const AGENT_ID = 'e2c8596a-4420-41d2-80bb-5cd4aaeffda6';
const AGENT_NAME = 'www Chat - Orchestrator';

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

function writePrivate(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
}

function safeOutputDir(raw) {
  if (!raw) throw new Error('--out is required');
  const resolved = path.resolve(raw);
  if (!(resolved === '/private/tmp' || resolved.startsWith('/private/tmp/'))) {
    throw new Error('--out must be an absolute private path under /private/tmp');
  }
  return resolved;
}

export function validateDiscoveryPrompts(instructions, systemPrompt) {
  const normalizedInstructions = instructions.replace(/\s+/g, ' ');
  const normalizedSystemPrompt = systemPrompt.replace(/\s+/g, ' ');
  const requiredInstructions = [
    '## Conversation-Led Discovery',
    'do not claim a separate conversational profile exists',
    'Technical evaluation: intent + problem/use case + architecture',
    'scale + success criteria',
    'While a lane minimum is incomplete, ask exactly one highest-value missing item per turn.',
    'problem/use case → architecture/stack/integrations → scale → success criteria.',
    'do not refine the incumbent vendor, hosting model, or another subdetail',
    'A missing-item explanation is not a discovery question.',
    'If the visitor asks for "the single missing fact," ask that fact directly',
    'it must not be a topic menu, optional next step, or action question.',
    'Do not refine, qualify, or ask "why" about that completed item until every other required item is complete.',
    'At readiness, ask no further discovery question.',
  ];
  const requiredSystem = [
    'Use the supplied conversation history for discovery.',
    'ask exactly one highest-value missing question',
    'Merely explaining a missing item is not a question',
    'At readiness, stop discovery',
  ];
  const forbidden = [
    'Every substantive answer ends with one thoughtful',
    'Ask exactly one thoughtful discovery question at the end of every substantive answer',
  ];
  const missing = [
    ...requiredInstructions.filter((item) => !normalizedInstructions.includes(item)).map((item) => `instructions:${item}`),
    ...requiredSystem.filter((item) => !normalizedSystemPrompt.includes(item)).map((item) => `systemPrompt:${item}`),
  ];
  const conflicts = forbidden.filter((item) => instructions.includes(item) || systemPrompt.includes(item));
  if (missing.length || conflicts.length) throw new Error(`Discovery prompt contract failed: missing=${missing.join('|')} conflicts=${conflicts.join('|')}`);
  return { pass: true, missing, conflicts };
}

export function validateAnswerQualityPrompts(instructions, systemPrompt) {
  const combined = `${systemPrompt}\n${instructions}`;
  const normalized = combined.replace(/\s+/g, ' ');
  const required = [
    '## Priority Order',
    'A complete, direct answer to the literal question.',
    '## Answer-Coverage Check',
    'material dimensions implied by the visitor\'s literal question',
    'Do not repeat an equivalent query',
    'do not search merely to reach a fixed count',
    'KPI, metric, measurement, optimization, analytics, revenue, conversion, or performance questions are substantive',
    'complete standalone grounded response',
    'Specialist routing never excuses an incomplete orchestrator answer.',
    'Migration: current-state inventory; data and schema mapping;',
  ];
  const forbidden = [
    'after giving the concise answer you can already support',
    'after giving the concise grounded answer you can already support',
    'Inspect whether the retrieved evidence type matches the answer need.',
  ];
  const missing = required.filter((item) => !normalized.includes(item.replace(/\s+/g, ' ')));
  const conflicts = forbidden.filter((item) => normalized.includes(item.replace(/\s+/g, ' ')));
  const headingCounts = Object.fromEntries(
    ['## Answer-Coverage Check', '## Conversation-Led Discovery', '## Specialist Routing']
      .map((heading) => [heading, instructions.split(heading).length - 1]),
  );
  const duplicateHeadings = Object.entries(headingCounts)
    .filter(([, count]) => count !== 1)
    .map(([heading, count]) => `${heading}:${count}`);
  if (missing.length || conflicts.length || duplicateHeadings.length) {
    throw new Error(
      `Answer-quality prompt contract failed: missing=${missing.join('|')} ` +
      `conflicts=${conflicts.join('|')} duplicateHeadings=${duplicateHeadings.join('|')}`,
    );
  }
  return { pass: true, missing, conflicts, duplicateHeadings };
}

function promptFiles() {
  const instructions = fs.readFileSync(INSTRUCTIONS_FILE, 'utf8');
  const systemPrompt = fs.readFileSync(SYSTEM_FILE, 'utf8');
  validateDiscoveryPrompts(instructions, systemPrompt);
  validateAnswerQualityPrompts(instructions, systemPrompt);
  return { instructions, systemPrompt };
}

function agentSummary(agent) {
  return {
    id: agent.id,
    name: agent.name,
    providerId: agent.providerId,
    model: agent.model,
    status: agent.status,
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
      'user-agent': 'algolia-discovery-policy-refinement/1',
    },
    body: payload ? JSON.stringify(payload) : undefined,
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} orchestrator failed: HTTP ${response.status} ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

function assertTarget(agent) {
  const name = String(agent.name ?? '').replace(/[\u2012-\u2015]/g, '-').replace(/\s+/g, ' ').trim();
  if (agent.id !== AGENT_ID || name !== AGENT_NAME) throw new Error(`Target identity mismatch: ${agent.id ?? 'missing'} / ${agent.name ?? 'missing'}`);
}

function unchanged(before, after) {
  return {
    toolsUnchanged: digest(after.tools ?? []) === digest(before.tools ?? []),
    configUnchanged: digest(after.config ?? {}) === digest(before.config ?? {}),
    providerUnchanged: after.providerId === before.providerId,
    modelUnchanged: after.model === before.model,
    statusUnchanged: after.status === before.status,
  };
}

function classifyPromptState(before, intended, observed) {
  const protectedChecks = unchanged(before, observed);
  const protectedStable = Object.values(protectedChecks).every(Boolean);
  const targetBefore = digest(observed.instructions ?? '') === digest(before.instructions ?? '') &&
    digest(observed.systemPrompt ?? '') === digest(before.systemPrompt ?? '');
  const targetIntended = digest(observed.instructions ?? '') === digest(intended.instructions) &&
    digest(observed.systemPrompt ?? '') === digest(intended.systemPrompt);
  return {
    state: protectedStable && targetBefore && targetIntended
      ? 'equivalent'
      : protectedStable && targetBefore
        ? 'before'
        : protectedStable && targetIntended
          ? 'intended'
          : 'drift',
    details: { targetBefore, targetIntended, ...protectedChecks },
  };
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
    const intended = promptFiles();
    const packet = {
      schema: 'OrchestratorAnswerQuality.v1',
      target: { appId: APP_ID, agentId: AGENT_ID, name: AGENT_NAME },
      beforeSummary: agentSummary(before),
      intendedInstructionsHash: digest(intended.instructions),
      intendedSystemPromptHash: digest(intended.systemPrompt),
      payloadKeys: ['instructions', 'systemPrompt'],
      preserves: ['tools', 'config', 'providerId', 'model', 'status'],
      recovery: 'Fail closed with readback evidence; use before-snapshot.json only during an exclusive manual recovery window.',
    };
    writePrivate(beforePath, before);
    writePrivate(packetPath, packet);
    return { pass: true, dryRun: true, out: outputDir, packet };
  }

  const before = JSON.parse(fs.readFileSync(beforePath, 'utf8'));
  const packet = JSON.parse(fs.readFileSync(packetPath, 'utf8'));
  const current = await requestAgent({ apiKey: env.ALGOLIA_ADMIN_API_KEY });
  assertTarget(current);
  if (digest(current.instructions ?? '') !== packet.beforeSummary.instructionsHash ||
      digest(current.systemPrompt ?? '') !== packet.beforeSummary.systemPromptHash ||
      !Object.values(unchanged(before, current)).every(Boolean)) {
    throw new Error('Live orchestrator drifted after dry-run; refusing mutation');
  }
  const intended = promptFiles();
  if (digest(intended.instructions) !== packet.intendedInstructionsHash || digest(intended.systemPrompt) !== packet.intendedSystemPromptHash) {
    throw new Error('Local prompts drifted after dry-run; refusing mutation');
  }

  const readCurrent = async () => {
    const observed = await requestAgent({ apiKey: env.ALGOLIA_ADMIN_API_KEY });
    assertTarget(observed);
    return observed;
  };
  const after = await applyPatchWithRecovery({
    read: readCurrent,
    patch: (payload) => requestAgent({ method: 'PATCH', apiKey: env.ALGOLIA_ADMIN_API_KEY, payload }),
    classify: (observed) => classifyPromptState(before, intended, observed),
    intendedPayload: intended,
    recordRecovery: (entry) => writePrivate(path.join(outputDir, 'recovery-evidence.json'), entry),
  });
  const checks = {
    instructionsExact: digest(after.instructions ?? '') === packet.intendedInstructionsHash,
    systemPromptExact: digest(after.systemPrompt ?? '') === packet.intendedSystemPromptHash,
    ...unchanged(before, after),
  };
  const result = { pass: Object.values(checks).every(Boolean), checks, beforeSummary: agentSummary(before), afterSummary: agentSummary(after) };
  writePrivate(path.join(outputDir, 'after-readback.json'), after);
  writePrivate(path.join(outputDir, 'validation.json'), result);
  if (!result.pass) throw new Error('Discovery prompt readback validation failed');
  return { ...result, out: outputDir };
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
