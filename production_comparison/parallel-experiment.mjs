import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { chmod, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  callAgent,
  callRoleJudge,
  createLimiter,
  judgeEvaluation,
  loadLocalEnv,
  mapLimit,
} from './runner.mjs';

const require = createRequire(import.meta.url);
const core = require('../frontend/chat-widget/algolia-judge-core.js');
const here = dirname(fileURLToPath(import.meta.url));

export const EXPERIMENT_VERSION = 'current-vs-candidate-v1';
export const DEFAULT_CAPTURE_CONCURRENCY = 4;
export const DEFAULT_WORKER_COUNT = 4;
export const DEFAULT_JUDGE_CONCURRENCY = 12;
export const MAX_REPAIR_PASSES = 1;
export const REQUIRED_CANDIDATE_MODEL = 'gpt-5.4-mini';
export const REQUIRED_CANDIDATE_PROVIDER_ID = 'e14c1f5e-7c24-4451-a342-940e427f769b';
export const GLOBAL_WORKER_SLOT_COUNT = 4;
const CANDIDATE_PROMPT_DIR = resolve(here, '..', 'agents', 'prompts', 'judge', 'candidate');
const CANDIDATE_PROMPT_FILES = Object.freeze({
  systemPrompt: 'system_prompt_judge_v3.md',
  skeptic: 'instructions_skeptic.md',
  referee: 'instructions_referee.md',
  advocate: 'instructions_advocate.md',
});
export const PANEL_SPECS = Object.freeze([
  Object.freeze({ variant: 'current', round: 1 }),
  Object.freeze({ variant: 'current', round: 2 }),
  Object.freeze({ variant: 'candidate', round: 1 }),
  Object.freeze({ variant: 'candidate', round: 2 }),
]);

function errorText(error) {
  return error instanceof Error ? error.message : String(error);
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function optionalPositiveNumber(value) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function canonical(value) {
  return core.canonicalStringify(value);
}

async function canonicalHash(value) {
  return core.sha256(canonical(value));
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function sameCanonical(left, right) {
  return canonical(left) === canonical(right);
}

const HASH_PATTERN = /^[a-f0-9]{64}$/;

async function ensurePrivateDirectory(path) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  await chmod(path, 0o700);
}

async function writePrivateFile(path, contents) {
  await ensurePrivateDirectory(dirname(path));
  await writeFile(path, contents, { mode: 0o600 });
  await chmod(path, 0o600);
}

async function writePrivateJson(path, value) {
  await writePrivateFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

export async function readCandidatePromptHashes(promptDir = CANDIDATE_PROMPT_DIR) {
  const systemPrompt = (await readFile(resolve(promptDir, CANDIDATE_PROMPT_FILES.systemPrompt), 'utf8')).trim();
  const instructions = Object.fromEntries(await Promise.all(core.ROLES.map(async (role) => [
    role,
    await core.sha256((await readFile(resolve(promptDir, CANDIDATE_PROMPT_FILES[role]), 'utf8')).trim()),
  ])));
  return { systemPrompt: await core.sha256(systemPrompt), instructions };
}

function readCandidatePromptHashesSync(promptDir = CANDIDATE_PROMPT_DIR) {
  const hash = (value) => createHash('sha256').update(String(value)).digest('hex');
  return {
    systemPrompt: hash(readFileSync(resolve(promptDir, CANDIDATE_PROMPT_FILES.systemPrompt), 'utf8').trim()),
    instructions: Object.fromEntries(core.ROLES.map((role) => [
      role,
      hash(readFileSync(resolve(promptDir, CANDIDATE_PROMPT_FILES[role]), 'utf8').trim()),
    ])),
  };
}

function assertLocalCandidatePromptHashes(manifest, localPromptHashes = readCandidatePromptHashesSync()) {
  if (!sameCanonical(manifest.promptHashes, localPromptHashes)) {
    throw new Error('Candidate deployment manifest prompt hashes do not match the local candidate prompt files.');
  }
}

function sleep(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

function pidIsAlive(pid, killImpl = process.kill) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    killImpl(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

async function reclaimStaleSlot(slotPath, options) {
  let owner;
  try {
    owner = JSON.parse(await readFile(resolve(slotPath, 'owner.json'), 'utf8'));
  } catch {
    const details = await stat(slotPath).catch(() => null);
    if (!details || options.now() - details.mtimeMs < options.incompleteOwnerGraceMs) return false;
  }
  if (owner && pidIsAlive(Number(owner.pid), options.killImpl)) return false;
  const quarantine = `${slotPath}.stale-${randomUUID()}`;
  try {
    await rename(slotPath, quarantine);
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
  await rm(quarantine, { recursive: true, force: true });
  return true;
}

async function releaseGlobalSlots(acquired) {
  for (const item of [...acquired].reverse()) {
    let owner;
    try { owner = JSON.parse(await readFile(resolve(item.path, 'owner.json'), 'utf8')); }
    catch { continue; }
    if (owner.token !== item.token) continue;
    const quarantine = `${item.path}.release-${item.token}`;
    try { await rename(item.path, quarantine); }
    catch (error) {
      if (error?.code === 'ENOENT') continue;
      throw error;
    }
    await rm(quarantine, { recursive: true, force: true });
  }
}

export async function acquireGlobalWorkerSlots(options = {}) {
  const lockRoot = resolve(options.lockRoot || resolve(tmpdir(), 'algolia-judge-experiment-worker-slots'));
  const requestedSlots = Number(options.requestedSlots ?? 1);
  if (!Number.isInteger(requestedSlots) || requestedSlots < 1 || requestedSlots > GLOBAL_WORKER_SLOT_COUNT) {
    throw new Error(`requestedSlots must be from 1 through ${GLOBAL_WORKER_SLOT_COUNT}.`);
  }
  const pollIntervalMs = Number(options.pollIntervalMs ?? 100);
  const context = {
    killImpl: options.killImpl || process.kill,
    now: options.now || Date.now,
    incompleteOwnerGraceMs: Number(options.incompleteOwnerGraceMs ?? 30_000),
  };
  const pid = Number(options.pid ?? process.pid);
  const acquired = [];
  await ensurePrivateDirectory(lockRoot);
  try {
    while (acquired.length < requestedSlots) {
      let acquiredThisPass = false;
      for (let index = 1; index <= GLOBAL_WORKER_SLOT_COUNT && acquired.length < requestedSlots; index += 1) {
        const slotPath = resolve(lockRoot, `slot-${index}`);
        if (acquired.some((item) => item.path === slotPath)) continue;
        const token = randomUUID();
        let created = false;
        try {
          await mkdir(slotPath, { mode: 0o700 });
          created = true;
          await writeFile(resolve(slotPath, 'owner.json'), `${JSON.stringify({ pid, token, acquiredAt: new Date(context.now()).toISOString() })}\n`, { mode: 0o600 });
          acquired.push({ path: slotPath, token });
          acquiredThisPass = true;
        } catch (error) {
          if (created) await rm(slotPath, { recursive: true, force: true });
          if (error?.code !== 'EEXIST') throw error;
          if (await reclaimStaleSlot(slotPath, context)) acquiredThisPass = true;
        }
      }
      if (acquired.length < requestedSlots && !acquiredThisPass) await sleep(pollIntervalMs);
    }
  } catch (error) {
    await releaseGlobalSlots(acquired);
    throw error;
  }
  let released = false;
  return async () => {
    if (released) return;
    released = true;
    await releaseGlobalSlots(acquired);
  };
}

function requireHash(value, field) {
  if (!HASH_PATTERN.test(String(value || ''))) throw new Error(`Candidate deployment manifest has an invalid ${field}.`);
}

export function validateCandidateManifest(manifest) {
  if (!manifest || manifest.schemaVersion !== 1) throw new Error('Candidate deployment manifest must use schemaVersion 1.');
  for (const field of ['runId', 'release', 'appId']) {
    if (!String(manifest[field] || '').trim()) throw new Error(`Candidate deployment manifest is missing ${field}.`);
  }
  requireHash(manifest.promptHashes?.systemPrompt, 'promptHashes.systemPrompt');
  for (const role of core.ROLES) requireHash(manifest.promptHashes?.instructions?.[role], `promptHashes.instructions.${role}`);
  const ids = [];
  for (const role of core.ROLES) {
    const agent = manifest.agents?.[role];
    if (!agent) throw new Error(`Candidate deployment manifest is missing ${role}.`);
    if (!String(agent.id || '').trim()) throw new Error(`Candidate deployment manifest ${role} is missing id.`);
    if (agent.model !== REQUIRED_CANDIDATE_MODEL) throw new Error(`Candidate deployment manifest ${role} must use ${REQUIRED_CANDIDATE_MODEL}.`);
    if (agent.providerId !== REQUIRED_CANDIDATE_PROVIDER_ID) {
      throw new Error(`Candidate deployment manifest ${role} must use provider ${REQUIRED_CANDIDATE_PROVIDER_ID}.`);
    }
    if (agent.status !== 'published') throw new Error(`Candidate deployment manifest ${role} is not published.`);
    if (agent.toolCount !== 0) throw new Error(`Candidate deployment manifest ${role} must have zero tools.`);
    for (const field of ['systemPromptHash', 'instructionsHash', 'configHash', 'exactConfigHash']) {
      requireHash(agent[field], `agents.${role}.${field}`);
    }
    if (agent.systemPromptHash !== manifest.promptHashes.systemPrompt) {
      throw new Error(`Candidate deployment manifest ${role} system prompt hash does not match promptHashes.`);
    }
    if (agent.instructionsHash !== manifest.promptHashes.instructions[role]) {
      throw new Error(`Candidate deployment manifest ${role} instructions hash does not match promptHashes.`);
    }
    ids.push(agent.id);
  }
  if (new Set(ids).size !== core.ROLES.length) throw new Error('Candidate deployment manifest must contain three distinct agent IDs.');
  return true;
}

export async function bindCandidateManifest(manifest, options = {}) {
  validateCandidateManifest(manifest);
  const localPromptHashes = options.localPromptHashes || await readCandidatePromptHashes(options.promptDir);
  assertLocalCandidatePromptHashes(manifest, localPromptHashes);
  return deepFreeze({ ...structuredClone(manifest), manifestHash: await canonicalHash(manifest) });
}

export async function loadCandidateManifest(path) {
  if (!path) throw new Error('--candidate-manifest is required for worker, aggregate, and all phases.');
  return bindCandidateManifest(JSON.parse(await readFile(resolve(path), 'utf8')));
}

export async function createFrozenPacket(question, answerResult, questionIndex) {
  const evaluation = await core.createEvaluationPackage({
    question,
    answer: answerResult.answer,
    evidenceEvents: answerResult.evidenceEvents,
  });
  const hashes = {
    question: evaluation.questionHash,
    answer: evaluation.answerHash,
    evidence: evaluation.evidenceHash,
    manifest: await canonicalHash(evaluation.answerManifest),
    evaluation: await canonicalHash(evaluation),
  };
  return deepFreeze({
    questionIndex,
    question,
    answer: answerResult.answer,
    evidenceEvents: answerResult.evidenceEvents,
    evaluation,
    hashes,
  });
}

export async function verifyFrozenPacket(packet) {
  if (!packet || !Number.isInteger(packet.questionIndex) || packet.questionIndex < 0) {
    throw new Error('Frozen packet has an invalid questionIndex.');
  }
  const rebuilt = await createFrozenPacket(packet.question, {
    answer: packet.answer,
    evidenceEvents: packet.evidenceEvents,
  }, packet.questionIndex);
  for (const name of ['question', 'answer', 'evidence', 'manifest', 'evaluation']) {
    if (rebuilt.hashes[name] !== packet.hashes?.[name]) {
      throw new Error(`Frozen packet ${packet.questionIndex} failed ${name} hash verification.`);
    }
  }
  if (!sameCanonical(rebuilt.evaluation, packet.evaluation)) {
    throw new Error(`Frozen packet ${packet.questionIndex} evaluation package changed after capture.`);
  }
  return true;
}

export async function rehydrateFrozenPacket(packet) {
  await verifyFrozenPacket(packet);
  return createFrozenPacket(packet.question, {
    answer: packet.answer,
    evidenceEvents: packet.evidenceEvents,
  }, packet.questionIndex);
}

export async function captureFrozenPackets(questions, flagship, apiKey, options = {}) {
  const call = options.callAgentImpl || callAgent;
  return mapLimit(questions, positiveInteger(options.captureConcurrency, DEFAULT_CAPTURE_CONCURRENCY), async (question, questionIndex) => {
    options.onProgress?.({ phase: 'capture-start', questionIndex, question });
    const answerResult = await call(flagship, apiKey, question, {
      fetchImpl: options.fetchImpl,
      timeoutMs: options.transportTimeoutMs ?? null,
    });
    const packet = await createFrozenPacket(question, answerResult, questionIndex);
    await verifyFrozenPacket(packet);
    options.onProgress?.({ phase: 'capture-complete', questionIndex, hashes: packet.hashes });
    return packet;
  });
}

function validateJudgeSet(name, judgeSet) {
  if (!judgeSet.appId) throw new Error(`${name} judge app ID is missing.`);
  const validation = core.validateJudgeAgents(core.ROLES.map((role) => ({ role, id: judgeSet.agents[role] })));
  if (!validation.ok) throw new Error(`${name} judge configuration is invalid: ${validation.errors.join('; ')}`);
}

export function resolveExperimentSettings(config, env = {}, candidateManifest) {
  validateCandidateManifest(candidateManifest);
  assertLocalCandidatePromptHashes(candidateManifest);
  requireHash(candidateManifest.manifestHash, 'manifestHash');
  const current = {
    appId: String(config.judges?.appId || '').trim(),
    origin: config.judges?.origin || null,
    agents: Object.fromEntries(core.ROLES.map((role) => [role, String(config.judges?.agents?.[role] || '').trim()])),
  };
  const candidate = {
    appId: candidateManifest.appId,
    origin: config.judges?.origin || null,
    agents: Object.fromEntries(core.ROLES.map((role) => [role, candidateManifest.agents[role].id])),
    deployment: structuredClone(candidateManifest),
  };
  validateJudgeSet('Current', current);
  validateJudgeSet('Candidate', candidate);
  const currentIds = new Set(Object.values(current.agents));
  const overlap = Object.values(candidate.agents).filter((id) => currentIds.has(id));
  if (overlap.length) throw new Error('Candidate judge IDs must be isolated from the current judge IDs.');
  return {
    captureConcurrency: positiveInteger(env.ANSWER_CAPTURE_CONCURRENCY, DEFAULT_CAPTURE_CONCURRENCY),
    workerCount: DEFAULT_WORKER_COUNT,
    judgeConcurrency: DEFAULT_JUDGE_CONCURRENCY,
    transportTimeoutMs: optionalPositiveNumber(env.EXPERIMENT_TRANSPORT_TIMEOUT_MS),
    judgeSets: { current, candidate },
  };
}

export function createWorkerShards(packets, workerCount = DEFAULT_WORKER_COUNT) {
  const count = Number(workerCount);
  if (count !== DEFAULT_WORKER_COUNT) throw new Error(`The experiment requires exactly ${DEFAULT_WORKER_COUNT} shards.`);
  const shards = Array.from({ length: count }, (_, index) => ({ workerId: index + 1, shardIndex: index, shardCount: count, packets: [] }));
  packets.forEach((packet, index) => shards[index % count].packets.push(packet));
  return shards;
}

export function selectWorkerShard(packets, shardIndex, shardCount) {
  const count = Number(shardCount);
  if (count !== DEFAULT_WORKER_COUNT) throw new Error(`The experiment requires exactly ${DEFAULT_WORKER_COUNT} shards.`);
  const index = Number(shardIndex);
  if (!Number.isInteger(index) || index < 0 || index >= count) {
    throw new Error(`shard-index must be an integer from 0 through ${count - 1}.`);
  }
  return {
    workerId: index + 1,
    shardIndex: index,
    shardCount: count,
    packets: packets.filter((packet) => packet.questionIndex % count === index),
  };
}

function stripRoleReport(report) {
  const { rawStream: _rawStream, ...kept } = report || {};
  return kept;
}

function failedRoleReports(message, durationMs) {
  return core.ROLES.map((role) => ({ ok: false, role, attempts: 0, durationMs, errors: [message] }));
}

function executionRepairHistory(execution) {
  if (Array.isArray(execution?.repairHistory)) return execution.repairHistory;
  return execution?.repair ? [execution.repair] : [];
}

function repairValidationFeedback(report) {
  if (Array.isArray(report?.validationErrors)) return report.validationErrors.map(String);
  if (report?.failureKind === 'validation') return (report.errors || []).map(String);
  if (report?.failureKind) return [];
  const legacyErrors = (report?.errors || []).map(String);
  const validatorPrefix = /^(?:sentenceAssessments\[|missing sentence assessment:|dimensionScores\.|dimensionRationales\.|summary\b|role\b|unresolved\[)/;
  const parts = legacyErrors.flatMap((error) => error.split('; ')).filter(Boolean);
  return parts.length && parts.every((part) => validatorPrefix.test(part)) ? legacyErrors : [];
}

export async function runPanelExecution(packet, spec, judgeSet, apiKey, options = {}) {
  const hydratedPacket = await rehydrateFrozenPacket(packet);
  const startedAt = (options.now || Date.now)();
  let result;
  try {
    result = await (options.judgeEvaluationImpl || judgeEvaluation)(hydratedPacket.evaluation, judgeSet, apiKey, {
      fetchImpl: options.fetchImpl,
      judgeLimiter: options.judgeLimiter,
      timeoutMs: options.transportTimeoutMs ?? null,
      now: options.now,
      onJudgeProgress: options.onJudgeProgress,
    });
  } catch (error) {
    const durationMs = Math.max(0, (options.now || Date.now)() - startedAt);
    const reports = failedRoleReports(errorText(error), durationMs);
    result = { ...core.aggregateJudgeReports(reports), reports };
  }
  const durationMs = Math.max(0, (options.now || Date.now)() - startedAt);
  const reports = Array.isArray(result.reports)
    ? result.reports.map(stripRoleReport)
    : failedRoleReports(result.error || 'Judge panel returned no role reports.', durationMs);
  const { evaluation: _evaluation, reports: _reports, ...verdict } = result;
  return {
    executionId: `Q${hydratedPacket.questionIndex + 1}:${spec.variant}:R${spec.round}`,
    questionIndex: hydratedPacket.questionIndex,
    variant: spec.variant,
    round: spec.round,
    packetHashes: { ...hydratedPacket.hashes },
    durationMs,
    verdict,
    reports,
  };
}

export async function repairPanelExecution(packet, execution, judgeSet, apiKey, options = {}) {
  const hydratedPacket = await rehydrateFrozenPacket(packet);
  if (!sameCanonical(execution.packetHashes, hydratedPacket.hashes)) {
    throw new Error(`Execution ${execution.executionId} cannot be repaired with a different frozen packet.`);
  }
  const startedAt = (options.now || Date.now)();
  const originalFailures = execution.reports
    .filter((report) => report.ok !== true && Number(report.attempts) > 0)
    .map((report) => ({ role: report.role, attempts: report.attempts, errors: [...(report.errors || [])] }));
  if (!originalFailures.length) return structuredClone(execution);
  const priorHistory = structuredClone(executionRepairHistory(execution));
  if (priorHistory.length >= MAX_REPAIR_PASSES) {
    throw new Error(`Execution ${execution.executionId} already used the single allowed repair pass.`);
  }

  const reports = await Promise.all(execution.reports.map(async (report) => {
    if (report.ok === true || Number(report.attempts) === 0) return structuredClone(report);
    const retried = stripRoleReport(await (options.callRoleJudgeImpl || callRoleJudge)(
      report.role,
      judgeSet.agents[report.role],
      judgeSet.appId,
      apiKey,
      hydratedPacket.evaluation,
      {
        fetchImpl: options.fetchImpl,
        judgeLimiter: options.judgeLimiter,
        timeoutMs: options.transportTimeoutMs ?? null,
        now: options.now,
        onJudgeProgress: options.onJudgeProgress,
        origin: judgeSet.origin,
        initialValidationFeedback: repairValidationFeedback(report),
      },
    ));
    return {
      ...retried,
      attempts: Number(report.attempts) + Number(retried.attempts || 0),
      durationMs: Number(report.durationMs || 0) + Number(retried.durationMs || 0),
    };
  }));
  const repairDurationMs = Math.max(0, (options.now || Date.now)() - startedAt);
  const repairRecord = {
    attemptedAt: new Date().toISOString(),
    durationMs: repairDurationMs,
    originalFailures,
    repairedRoles: reports.filter((report) => report.ok === true && originalFailures.some((failure) => failure.role === report.role)).map((report) => report.role),
    persistentFailures: reports.filter((report) => report.ok !== true && originalFailures.some((failure) => failure.role === report.role)).map((report) => report.role),
  };
  const { repair: _legacyRepair, ...baseExecution } = execution;
  return {
    ...baseExecution,
    durationMs: Number(execution.durationMs || 0) + repairDurationMs,
    verdict: core.aggregateJudgeReports(reports),
    reports,
    repairHistory: [...priorHistory, repairRecord],
  };
}

export async function repairWorkerOutput(workerOutput, packets, context) {
  const packetByQuestion = new Map(packets.map((packet) => [packet.questionIndex, packet]));
  const executions = [];
  for (const execution of workerOutput.executions || []) {
    const packet = packetByQuestion.get(execution.questionIndex);
    if (!packet) throw new Error(`Worker ${workerOutput.workerId} references unknown question ${execution.questionIndex}.`);
    await verifyFrozenPacket(packet);
    assertExecution(execution, packet);
    executions.push(await repairPanelExecution(
      packet,
      execution,
      context.judgeSets[execution.variant],
      context.apiKeys[execution.variant],
      context,
    ));
  }
  return { ...workerOutput, executions };
}

export async function runWorkerShard(shard, context) {
  const executions = [];
  for (const packet of shard.packets) {
    for (const spec of PANEL_SPECS) {
      context.onProgress?.({ phase: 'panel-start', workerId: shard.workerId, questionIndex: packet.questionIndex, ...spec });
      const execution = await runPanelExecution(
        packet,
        spec,
        context.judgeSets[spec.variant],
        context.apiKeys[spec.variant],
        context,
      );
      executions.push(execution);
      context.onProgress?.({ phase: 'panel-complete', workerId: shard.workerId, questionIndex: packet.questionIndex, ...spec, status: execution.verdict.status });
    }
  }
  return {
    workerId: shard.workerId,
    ...(Number.isInteger(shard.shardIndex) ? { shardIndex: shard.shardIndex } : {}),
    ...(Number.isInteger(shard.shardCount) ? { shardCount: shard.shardCount } : {}),
    questionIndexes: shard.packets.map((packet) => packet.questionIndex),
    executions,
  };
}

function finiteMean(values) {
  const finite = values.filter(Number.isFinite);
  if (!finite.length) return null;
  return Math.round((finite.reduce((sum, value) => sum + value, 0) / finite.length) * 100) / 100;
}

function numericDelta(candidate, current) {
  if (!Number.isFinite(candidate) || !Number.isFinite(current)) return null;
  return Math.round((candidate - current) * 100) / 100;
}

function reportMetrics(report) {
  const dimensions = Object.fromEntries(core.DIMENSIONS.map((dimension) => [
    dimension,
    Number.isFinite(report?.value?.dimensionScores?.[dimension]) ? report.value.dimensionScores[dimension] : null,
  ]));
  return {
    ok: report?.ok === true,
    score: finiteMean(Object.values(dimensions)),
    dimensions,
    durationMs: Number(report?.attempts) > 0 && Number.isFinite(report?.durationMs) ? report.durationMs : null,
    attempts: Number.isFinite(report?.attempts) ? report.attempts : 0,
    retries: Number.isFinite(report?.attempts) ? Math.max(0, report.attempts - 1) : 0,
    errors: report?.ok ? [] : (report?.errors || ['Unknown judge failure']),
  };
}

function isCompleteExecution(execution) {
  return execution?.verdict?.validJudgeCount === 3
    && Array.isArray(execution.reports)
    && execution.reports.length === 3
    && execution.reports.every((report) => report.ok === true && Number(report.attempts) > 0);
}

function panelMadeJudgeCall(execution) {
  return Array.isArray(execution?.reports) && execution.reports.some((report) => Number(report.attempts) > 0);
}

export function averageVariantExecutions(executions) {
  const dimensions = Object.fromEntries(core.DIMENSIONS.map((dimension) => [
    dimension,
    finiteMean(executions.map((execution) => execution.verdict?.dims?.[dimension])),
  ]));
  const roles = Object.fromEntries(core.ROLES.map((role) => {
    const reports = executions.map((execution) => execution.reports.find((report) => report.role === role));
    const metrics = reports.map(reportMetrics);
    return [role, {
      score: finiteMean(metrics.map((metric) => metric.score)),
      scoreCount: metrics.filter((metric) => Number.isFinite(metric.score)).length,
      dimensions: Object.fromEntries(core.DIMENSIONS.map((dimension) => [dimension, finiteMean(metrics.map((metric) => metric.dimensions[dimension]))])),
      averageLatencyMs: finiteMean(metrics.map((metric) => metric.durationMs)),
      latencyCount: metrics.filter((metric) => Number.isFinite(metric.durationMs)).length,
      totalRetries: metrics.reduce((sum, metric) => sum + metric.retries, 0),
      successfulRuns: metrics.filter((metric) => metric.ok).length,
      failures: metrics.flatMap((metric, roundIndex) => metric.errors.map((error) => ({ round: executions[roundIndex].round, error }))),
    }];
  }));
  return {
    rounds: executions.map((execution) => execution.round),
    composite: finiteMean(executions.map((execution) => execution.verdict?.composite)),
    scoredPanels: executions.filter((execution) => Number.isFinite(execution.verdict?.composite)).length,
    expectedPanels: executions.length,
    scoreCoverage: {
      scored: executions.filter((execution) => Number.isFinite(execution.verdict?.composite)).length,
      expected: executions.length,
    },
    dimensions,
    dimensionScoreCounts: Object.fromEntries(core.DIMENSIONS.map((dimension) => [
      dimension,
      executions.filter((execution) => Number.isFinite(execution.verdict?.dims?.[dimension])).length,
    ])),
    grounding: {
      score: dimensions.grounding,
      statuses: executions.map((execution) => execution.verdict?.groundingStatus || execution.verdict?.status || 'unavailable'),
    },
    averagePanelLatencyMs: finiteMean(executions.filter(panelMadeJudgeCall).map((execution) => execution.durationMs)),
    panelLatencyCount: executions.filter((execution) => panelMadeJudgeCall(execution) && Number.isFinite(execution.durationMs)).length,
    totalRetries: Object.values(roles).reduce((sum, role) => sum + role.totalRetries, 0),
    completePanels: executions.filter((execution) => execution.verdict?.validJudgeCount === 3).length,
    provisionalPanels: executions.filter((execution) => execution.verdict?.provisional === true).length,
    unavailablePanels: executions.filter((execution) => !Number.isFinite(execution.verdict?.composite)).length,
    repairAttemptedPanels: executions.filter((execution) => executionRepairHistory(execution).length > 0).length,
    recoveredPanels: executions.filter((execution) => executionRepairHistory(execution).length > 0 && isCompleteExecution(execution)).length,
    roles,
  };
}

function variantDelta(candidate, current) {
  return {
    composite: numericDelta(candidate.composite, current.composite),
    dimensions: Object.fromEntries(core.DIMENSIONS.map((dimension) => [dimension, numericDelta(candidate.dimensions[dimension], current.dimensions[dimension])])),
    averagePanelLatencyMs: numericDelta(candidate.averagePanelLatencyMs, current.averagePanelLatencyMs),
    totalRetries: candidate.totalRetries - current.totalRetries,
    roles: Object.fromEntries(core.ROLES.map((role) => [role, {
      score: numericDelta(candidate.roles[role].score, current.roles[role].score),
      dimensions: Object.fromEntries(core.DIMENSIONS.map((dimension) => [dimension, numericDelta(candidate.roles[role].dimensions[dimension], current.roles[role].dimensions[dimension])])),
      averageLatencyMs: numericDelta(candidate.roles[role].averageLatencyMs, current.roles[role].averageLatencyMs),
      totalRetries: candidate.roles[role].totalRetries - current.roles[role].totalRetries,
    }])),
  };
}

const PROTECTED_VERDICT_FIELDS = Object.freeze([
  'contractVersion', 'status', 'groundingStatus', 'validJudgeCount', 'expectedJudgeCount',
  'provisional', 'dims', 'qualityBase', 'composite', 'appliedCap', 'gateTripped',
  'flaggedClaims', 'disagreements', 'perJudge', 'rationale',
]);

function assertRecomputedVerdict(execution) {
  const recomputed = core.aggregateJudgeReports(execution.reports);
  const mismatches = PROTECTED_VERDICT_FIELDS.filter((field) => !sameCanonical(execution.verdict?.[field], recomputed[field]));
  if (mismatches.length) {
    throw new Error(`Execution ${execution.executionId} persisted verdict does not match deterministic role-report aggregation for: ${mismatches.join(', ')}.`);
  }
}

function assertNoCallUnavailable(execution, packet) {
  if (execution.reports.some((report) => report.ok === true || Number(report.attempts) !== 0)) {
    throw new Error(`Execution ${execution.executionId} has an invalid no-call role-report shape.`);
  }
  const verdict = execution.verdict || {};
  const noEvidence = !packet.evaluation?.evidencePacket?.events?.length || !packet.evaluation?.evidencePacket?.passages?.length;
  const overCapacity = packet.evaluation?.capacity?.fits === false;
  if (!noEvidence && !overCapacity) throw new Error(`Execution ${execution.executionId} skipped judge calls despite having usable evidence and capacity.`);
  if (verdict.status !== 'unavailable'
    || ![undefined, 'unavailable'].includes(verdict.groundingStatus)
    || ![undefined, 0].includes(verdict.validJudgeCount)
    || ![undefined, false].includes(verdict.provisional)
    || verdict.composite != null
    || verdict.dims != null
    || verdict.qualityBase != null
    || verdict.appliedCap != null
    || verdict.gateTripped === true
    || (Array.isArray(verdict.flaggedClaims) && verdict.flaggedClaims.length > 0)
    || (Array.isArray(verdict.disagreements) && verdict.disagreements.length > 0)
    || (Array.isArray(verdict.perJudge) && verdict.perJudge.length > 0)) {
    throw new Error(`Execution ${execution.executionId} no-call verdict must be strictly unavailable with no score, dimensions, cap, or claims.`);
  }
  const expectedReason = noEvidence ? /no usable retrieval evidence/i : /exceeds verified judge capacity/i;
  if (typeof verdict.error !== 'string' || !expectedReason.test(verdict.error)) {
    throw new Error(`Execution ${execution.executionId} no-call verdict has the wrong unavailable reason.`);
  }
}

function assertExecution(execution, packet) {
  const expectedSpec = PANEL_SPECS.some((spec) => spec.variant === execution.variant && spec.round === execution.round);
  if (!expectedSpec) throw new Error(`Question ${packet.questionIndex} has an unexpected panel execution.`);
  if (execution.questionIndex !== packet.questionIndex) throw new Error(`Execution ${execution.executionId} has the wrong question index.`);
  if (!sameCanonical(execution.packetHashes, packet.hashes)) throw new Error(`Execution ${execution.executionId} used a different frozen packet.`);
  if (!Array.isArray(execution.reports) || execution.reports.length !== 3) throw new Error(`Execution ${execution.executionId} does not contain three role reports.`);
  const roles = execution.reports.map((report) => report.role).sort();
  if (!sameCanonical(roles, [...core.ROLES].sort())) throw new Error(`Execution ${execution.executionId} does not contain three distinct judge roles.`);
  if (execution.verdict?.validJudgeCount === 3 && execution.reports.some((report) => !report.ok)) {
    throw new Error(`Execution ${execution.executionId} claims a complete panel with a failed role.`);
  }
  if (panelMadeJudgeCall(execution)) assertRecomputedVerdict(execution);
  else assertNoCallUnavailable(execution, packet);
}

function specKey(value) {
  return `${value.variant}:${value.round}`;
}

function withGroundingStatuses(average) {
  const statuses = average.grounding.statuses;
  return {
    ...average,
    groundingStatuses: Object.fromEntries([...new Set(statuses)].sort().map((status) => [
      status,
      statuses.filter((value) => value === status).length,
    ])),
  };
}

function aggregateRows(rows) {
  const operationalCurrent = withGroundingStatuses(averageVariantExecutions(rows.flatMap((row) => row.current.rounds)));
  const operationalCandidate = withGroundingStatuses(averageVariantExecutions(rows.flatMap((row) => row.candidate.rounds)));
  const matchedCurrent = withGroundingStatuses(averageVariantExecutions(rows.flatMap((row) => row.current.matchedRounds)));
  const matchedCandidate = withGroundingStatuses(averageVariantExecutions(rows.flatMap((row) => row.candidate.matchedRounds)));
  const matchedRoundPairs = matchedCurrent.scoredPanels;
  const expectedRoundPairs = rows.length * 2;
  return {
    primary: {
      definition: 'Only same-round pairs where current and candidate each returned all three valid judges.',
      matchedRoundPairs,
      expectedRoundPairs,
      scoreCoverage: { scored: matchedRoundPairs, expected: expectedRoundPairs },
      current: matchedCurrent,
      candidate: matchedCandidate,
      delta: variantDelta(matchedCandidate, matchedCurrent),
    },
    operationalFallback: {
      definition: 'All scored panels, including provisional panels; not used for the headline A/B conclusion.',
      current: operationalCurrent,
      candidate: operationalCandidate,
      delta: variantDelta(operationalCandidate, operationalCurrent),
    },
  };
}

export async function mergeWorkerOutputs(packets, workerOutputs, options = {}) {
  const expectedQuestionCount = options.expectedQuestionCount ?? packets.length;
  if (packets.length !== expectedQuestionCount) throw new Error(`Expected ${expectedQuestionCount} frozen packets, received ${packets.length}.`);
  for (const packet of packets) await verifyFrozenPacket(packet);
  const executions = workerOutputs.flatMap((worker) => worker.executions || []);
  const rows = [];
  const seenExecutionIds = new Set();
  for (const packet of [...packets].sort((left, right) => left.questionIndex - right.questionIndex)) {
    const matching = executions.filter((execution) => execution.questionIndex === packet.questionIndex);
    if (matching.length !== 4) throw new Error(`Question ${packet.questionIndex} must have exactly 4 panel executions; received ${matching.length}.`);
    for (const execution of matching) {
      if (seenExecutionIds.has(execution.executionId)) throw new Error(`Duplicate panel execution ID: ${execution.executionId}.`);
      seenExecutionIds.add(execution.executionId);
      assertExecution(execution, packet);
    }
    const actualSpecs = matching.map(specKey).sort();
    const requiredSpecs = PANEL_SPECS.map(specKey).sort();
    if (!sameCanonical(actualSpecs, requiredSpecs)) {
      throw new Error(`Question ${packet.questionIndex} must contain exactly current:1, current:2, candidate:1, and candidate:2.`);
    }
    const sorted = [...matching].sort((left, right) => PANEL_SPECS.findIndex((spec) => spec.variant === left.variant && spec.round === left.round) - PANEL_SPECS.findIndex((spec) => spec.variant === right.variant && spec.round === right.round));
    const currentExecutions = sorted.filter((execution) => execution.variant === 'current');
    const candidateExecutions = sorted.filter((execution) => execution.variant === 'candidate');
    const matchedRoundNumbers = [1, 2].filter((round) => {
      const currentExecution = currentExecutions.find((execution) => execution.round === round);
      const candidateExecution = candidateExecutions.find((execution) => execution.round === round);
      return isCompleteExecution(currentExecution) && isCompleteExecution(candidateExecution);
    });
    const matchedCurrentExecutions = currentExecutions.filter((execution) => matchedRoundNumbers.includes(execution.round));
    const matchedCandidateExecutions = candidateExecutions.filter((execution) => matchedRoundNumbers.includes(execution.round));
    const currentMatched = averageVariantExecutions(matchedCurrentExecutions);
    const candidateMatched = averageVariantExecutions(matchedCandidateExecutions);
    rows.push({
      questionIndex: packet.questionIndex,
      question: packet.question,
      answer: packet.answer,
      packetHashes: { ...packet.hashes },
      executions: sorted,
      matchedRoundNumbers,
      matchedRoundCount: matchedRoundNumbers.length,
      expectedRoundPairs: 2,
      current: {
        rounds: currentExecutions,
        matchedRounds: matchedCurrentExecutions,
        matched: currentMatched,
        operationalFallback: averageVariantExecutions(currentExecutions),
      },
      candidate: {
        rounds: candidateExecutions,
        matchedRounds: matchedCandidateExecutions,
        matched: candidateMatched,
        operationalFallback: averageVariantExecutions(candidateExecutions),
      },
      primaryDelta: variantDelta(candidateMatched, currentMatched),
    });
  }
  if (executions.length !== expectedQuestionCount * 4) throw new Error(`Expected ${expectedQuestionCount * 4} total panel executions; received ${executions.length}.`);
  return {
    experimentVersion: EXPERIMENT_VERSION,
    contractVersion: core.CONTRACT_VERSION,
    questionCount: rows.length,
    panelExecutionCount: executions.length,
    rows,
    summary: aggregateRows(rows),
  };
}

export function verifyWorkerCoverage(packets, workerOutputs, requiredJudgeSets) {
  const count = DEFAULT_WORKER_COUNT;
  if (!Array.isArray(workerOutputs) || workerOutputs.length !== count) {
    throw new Error(`Expected ${count} worker outputs; received ${workerOutputs?.length ?? 0}.`);
  }
  const indexes = workerOutputs.map((worker) => worker.shardIndex).sort((left, right) => left - right);
  if (!sameCanonical(indexes, Array.from({ length: count }, (_, index) => index))) {
    throw new Error('Worker outputs do not contain one unique output for every shard index.');
  }
  const expectedJudgeSets = workerOutputs[0]?.judgeSets;
  if (!expectedJudgeSets?.current || !expectedJudgeSets?.candidate) throw new Error('Worker output is missing its current and candidate judge-set snapshot.');
  if (!requiredJudgeSets || !sameCanonical(expectedJudgeSets, requiredJudgeSets)) {
    throw new Error('Worker judge sets are not bound to the locked current config and candidate deployment manifest.');
  }
  for (const worker of workerOutputs) {
    if (worker.shardCount !== count) throw new Error(`Worker ${worker.workerId} used shard count ${worker.shardCount}; expected ${count}.`);
    const expected = packets.filter((packet) => packet.questionIndex % count === worker.shardIndex).map((packet) => packet.questionIndex);
    if (!sameCanonical(worker.questionIndexes, expected)) throw new Error(`Worker ${worker.workerId} contains questions outside its deterministic shard.`);
    if ((worker.executions || []).some((execution) => !expected.includes(execution.questionIndex))) {
      throw new Error(`Worker ${worker.workerId} contains an execution owned by another shard.`);
    }
    if (!sameCanonical(worker.judgeSets, expectedJudgeSets)) throw new Error('Worker outputs were produced with different judge sets.');
  }
  return true;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function formatScore(value) {
  return Number.isFinite(value) ? `${value.toFixed(2).replace(/\.00$/, '')}/10` : 'Unavailable';
}

function formatDelta(value) {
  if (!Number.isFinite(value)) return 'Unavailable';
  return `${value > 0 ? '+' : ''}${value.toFixed(2).replace(/\.00$/, '')}`;
}

function scoreCoverageLabel(value, unit = 'matched round') {
  if (value.scoredPanels === 2 && value.expectedPanels === 2) return 'Average of 2 complete matched rounds';
  if (value.scoredPanels === 1) return `1 ${unit} scored`;
  if (value.scoredPanels === 0) return `No ${unit}s scored`;
  return `${value.scoredPanels}/${value.expectedPanels} ${unit}s scored`;
}

function variantCell(variant) {
  const value = variant.matched;
  const operational = variant.operationalFallback;
  const dimensions = core.DIMENSIONS.map((dimension) => `<dt>${escapeHtml(dimension)}</dt><dd>${formatScore(value.dimensions[dimension])}</dd>`).join('');
  const roles = core.ROLES.map((role) => `${escapeHtml(role)} ${formatScore(value.roles[role].score)}`).join(' | ');
  const failures = Object.entries(operational.roles).flatMap(([role, result]) => result.failures.map((failure) => `${role} R${failure.round}: ${failure.error}`));
  return `<div class="score">${formatScore(value.composite)}</div><p>${escapeHtml(scoreCoverageLabel(value))}</p><dl>${dimensions}</dl><p>${escapeHtml(roles)}</p><div class="fallback"><strong>Operational fallback, not headline</strong><br>${formatScore(operational.composite)} from ${operational.scoredPanels}/${operational.expectedPanels} scored panels<br>Panels: ${operational.completePanels} complete, ${operational.provisionalPanels} provisional, ${operational.unavailablePanels} unavailable<br>Repair pass: ${operational.repairAttemptedPanels} panels attempted, ${operational.recoveredPanels} recovered<br>Judge-call latency: ${escapeHtml(operational.averagePanelLatencyMs ?? 'Unavailable')} ms (${operational.panelLatencyCount} panels) | Retries: ${operational.totalRetries}</div>${failures.length ? `<details><summary>Failures</summary><pre>${escapeHtml(failures.join('\n'))}</pre></details>` : ''}`;
}

export function renderExperimentHtml(result) {
  const rows = result.rows.map((row) => `<tr><th scope="row"><span>${row.questionIndex + 1}</span>${escapeHtml(row.question)}<p>${row.matchedRoundCount}/${row.expectedRoundPairs} complete matched round pairs</p><details><summary>Frozen answer</summary><pre>${escapeHtml(row.answer)}</pre></details></th><td>${variantCell(row.current)}</td><td>${variantCell(row.candidate)}</td><td class="delta">${formatDelta(row.primaryDelta.composite)}<br><small>Grounding ${formatDelta(row.primaryDelta.dimensions.grounding)}</small></td></tr>`).join('\n');
  const primary = result.summary.primary;
  const fallback = result.summary.operationalFallback;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Judge experiment</title><style>:root{font-family:Inter,Arial,sans-serif;color:#23263b;background:#f7f7fb}body{margin:0;padding:24px}main{max-width:1500px;margin:auto}h1{font-size:24px;margin:0 0 8px}.meta{color:#62677f}.fallback{font-size:12px;line-height:1.5;color:#555b74;background:#f1f2f8;padding:8px;margin-top:10px}table{width:100%;border-collapse:collapse;background:#fff;table-layout:fixed}th,td{vertical-align:top;text-align:left;border:1px solid #d9dbea;padding:14px}thead th{background:#eef0fa}tbody th{width:28%;font-size:14px;line-height:1.45}tbody th span{display:block;color:#70758d;font-size:12px}.score{font-size:22px;font-weight:700;color:#003dff}dl{display:grid;grid-template-columns:1fr auto;gap:4px 12px;font-size:13px}dt,dd{margin:0;text-transform:capitalize}p,small{font-size:12px;line-height:1.5;color:#555b74}.delta{font-size:20px;font-weight:700}pre{white-space:pre-wrap;font:12px/1.5 Inter,Arial,sans-serif}summary{cursor:pointer;margin-top:8px}@media(max-width:800px){body{padding:8px}table,thead,tbody,tr,th,td{display:block}thead{display:none}tbody th{width:auto;background:#eef0fa}td{border-top:0}}</style></head><body><main><h1>Current vs. candidate judges</h1><p class="meta"><strong>Headline: complete matched round pairs only.</strong> ${primary.matchedRoundPairs}/${primary.expectedRoundPairs} pairs | Current ${formatScore(primary.current.composite)} | Candidate ${formatScore(primary.candidate.composite)} | Delta ${formatDelta(primary.delta.composite)}</p><p class="meta">Operational fallback, not headline: Current ${formatScore(fallback.current.composite)} (${fallback.current.scoredPanels}/${fallback.current.expectedPanels}) | Candidate ${formatScore(fallback.candidate.composite)} (${fallback.candidate.scoredPanels}/${fallback.candidate.expectedPanels})</p><table><thead><tr><th>Question and frozen answer</th><th>Current matched result</th><th>Candidate matched result</th><th>Matched delta</th></tr></thead><tbody>${rows}</tbody></table></main></body></html>`;
}

export async function runExperiment(options) {
  const settings = options.settings;
  if (settings.workerCount !== DEFAULT_WORKER_COUNT || settings.judgeConcurrency !== DEFAULT_JUDGE_CONCURRENCY) {
    throw new Error(`The experiment requires exactly ${DEFAULT_WORKER_COUNT} shards and a maximum of ${DEFAULT_JUDGE_CONCURRENCY} judge calls.`);
  }
  const packets = options.packets || await captureFrozenPackets(options.questions, options.flagship, options.apiKeys.flagship, {
    callAgentImpl: options.callAgentImpl,
    fetchImpl: options.fetchImpl,
    captureConcurrency: settings.captureConcurrency,
    transportTimeoutMs: settings.transportTimeoutMs,
    onProgress: options.onProgress,
  });
  // Every OS process is limited to one three-role panel, while the global
  // four-slot semaphore caps aggregate concurrency at 12 calls.
  const judgeLimiter = options.judgeLimiter || createLimiter(3);
  const shards = createWorkerShards(packets, settings.workerCount);
  const workerOutputs = await Promise.all(shards.map(async (shard) => {
    const output = await runWorkerShard(shard, {
      judgeSets: settings.judgeSets,
      apiKeys: { current: options.apiKeys.judge, candidate: options.apiKeys.candidateJudge || options.apiKeys.judge },
      judgeLimiter,
      transportTimeoutMs: settings.transportTimeoutMs,
      fetchImpl: options.fetchImpl,
      judgeEvaluationImpl: options.judgeEvaluationImpl,
      onJudgeProgress: options.onJudgeProgress,
      onProgress: options.onProgress,
    });
    const boundOutput = { ...output, judgeSets: settings.judgeSets };
    await options.onWorkerComplete?.(boundOutput);
    return boundOutput;
  }));
  verifyWorkerCoverage(packets, workerOutputs, settings.judgeSets);
  const merged = await mergeWorkerOutputs(packets, workerOutputs, { expectedQuestionCount: options.expectedQuestionCount ?? 10 });
  return { packets, workerOutputs, merged };
}

function progressLine(event) {
  if (event.phase === 'capture-start') return `[capture ${event.questionIndex + 1}] starting`;
  if (event.phase === 'capture-complete') return `[capture ${event.questionIndex + 1}] frozen and verified`;
  if (event.phase === 'panel-start') return `[worker ${event.workerId}] Q${event.questionIndex + 1} ${event.variant} R${event.round} starting`;
  if (event.phase === 'panel-complete') return `[worker ${event.workerId}] Q${event.questionIndex + 1} ${event.variant} R${event.round} ${event.status || 'finished'}`;
  return null;
}

export function parseCliArgs(argv = process.argv.slice(2)) {
  const parsed = { phase: 'all', workerOutputs: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) throw new Error(`Unexpected argument: ${token}`);
    const name = token.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`--${name} requires a value.`);
    index += 1;
    if (name === 'worker-output') parsed.workerOutputs.push(value);
    else if (name === 'phase') parsed.phase = value;
    else if (name === 'output-dir') parsed.outputDir = value;
    else if (name === 'frozen-packets') parsed.frozenPackets = value;
    else if (name === 'candidate-manifest') parsed.candidateManifest = value;
    else if (name === 'shard-index') parsed.shardIndex = Number(value);
    else if (name === 'shard-count') parsed.shardCount = Number(value);
    else throw new Error(`Unknown argument: --${name}`);
  }
  if (!['capture', 'worker', 'repair-worker', 'aggregate', 'all'].includes(parsed.phase)) throw new Error(`Unknown phase: ${parsed.phase}`);
  if (parsed.shardCount !== undefined && parsed.shardCount !== DEFAULT_WORKER_COUNT) {
    throw new Error(`--shard-count must be exactly ${DEFAULT_WORKER_COUNT}.`);
  }
  if (['worker', 'repair-worker', 'aggregate', 'all'].includes(parsed.phase) && !parsed.candidateManifest) {
    throw new Error('--candidate-manifest is required for worker, repair-worker, aggregate, and all phases.');
  }
  if (parsed.phase === 'repair-worker' && parsed.workerOutputs.length !== 1) {
    throw new Error('repair-worker requires exactly one --worker-output.');
  }
  return parsed;
}

async function readInputs() {
  const config = JSON.parse(await readFile(resolve(here, 'config.json'), 'utf8'));
  const questions = JSON.parse(await readFile(resolve(here, 'questions.json'), 'utf8'));
  if (!Array.isArray(questions) || questions.length !== 10) throw new Error(`The experiment requires exactly 10 questions; received ${questions?.length ?? 0}.`);
  const env = loadLocalEnv();
  return { config, questions, env };
}

function defaultOutputDir() {
  return resolve(here, 'runs', new Date().toISOString().replace(/[:.]/g, '-'));
}

function globalLockRoot(appId) {
  return resolve(tmpdir(), `algolia-judge-experiment-${appId}`);
}

async function loadFrozenPackets(path) {
  if (!path) throw new Error('--frozen-packets is required for this phase.');
  const document = JSON.parse(await readFile(resolve(path), 'utf8'));
  const packets = Array.isArray(document) ? document : document.packets;
  if (!Array.isArray(packets) || packets.length !== 10) throw new Error(`Expected 10 frozen packets; received ${packets?.length ?? 0}.`);
  return Promise.all(packets.map(rehydrateFrozenPacket));
}

function publicSettings(config, settings, createdAt) {
  return {
    experimentVersion: EXPERIMENT_VERSION,
    contractVersion: core.CONTRACT_VERSION,
    createdAt,
    captureConcurrency: settings.captureConcurrency,
    workerCount: settings.workerCount,
    perWorkerJudgeConcurrency: 3,
    deterministicFourWorkerMaximumJudgeCalls: settings.workerCount * 3,
    transportTimeoutMs: settings.transportTimeoutMs,
    flagship: { appId: config.flagship.appId, agentId: config.flagship.agentId },
    judgeSets: settings.judgeSets,
  };
}

export async function runCapturePhase(args, dependencies = {}) {
  const { config, questions, env } = dependencies.inputs || await readInputs();
  const outputDir = resolve(args.outputDir || defaultOutputDir());
  const apiKey = env[config.flagship.keyEnv];
  if (!apiKey) throw new Error('Missing flagship API key environment variable.');
  const captureConcurrency = positiveInteger(env.ANSWER_CAPTURE_CONCURRENCY, DEFAULT_CAPTURE_CONCURRENCY);
  const transportTimeoutMs = optionalPositiveNumber(env.EXPERIMENT_TRANSPORT_TIMEOUT_MS);
  await ensurePrivateDirectory(outputDir);
  const packets = await captureFrozenPackets(questions, config.flagship, apiKey, {
    callAgentImpl: dependencies.callAgentImpl,
    fetchImpl: dependencies.fetchImpl,
    captureConcurrency,
    transportTimeoutMs,
    onProgress: dependencies.onProgress,
  });
  const document = {
    experimentVersion: EXPERIMENT_VERSION,
    contractVersion: core.CONTRACT_VERSION,
    createdAt: new Date().toISOString(),
    captureConcurrency,
    transportTimeoutMs,
    packets,
  };
  const path = resolve(outputDir, 'frozen-packets.json');
  await writePrivateJson(path, document);
  return { outputDir, frozenPacketsPath: path, packets };
}

export async function runWorkerPhase(args, dependencies = {}) {
  const { config, env } = dependencies.inputs || await readInputs();
  const packets = dependencies.packets || await loadFrozenPackets(args.frozenPackets);
  const candidateManifest = dependencies.candidateManifest || await loadCandidateManifest(args.candidateManifest);
  const settings = resolveExperimentSettings(config, env, candidateManifest);
  const shard = selectWorkerShard(packets, args.shardIndex, DEFAULT_WORKER_COUNT);
  const outputDir = resolve(args.outputDir || dirname(resolve(args.frozenPackets)));
  const judgeKey = env[config.judges.keyEnv] || env[config.flagship.keyEnv];
  const candidateKey = env.CANDIDATE_JUDGE_SEARCH_KEY || judgeKey;
  if (!judgeKey || !candidateKey) throw new Error('Missing judge API key environment variable.');
  await ensurePrivateDirectory(outputDir);
  const acquireSlots = dependencies.acquireGlobalWorkerSlotsImpl || acquireGlobalWorkerSlots;
  const releaseSlot = await acquireSlots({ lockRoot: dependencies.globalLockRoot || globalLockRoot(config.judges.appId), requestedSlots: 1 });
  try {
    const output = await runWorkerShard(shard, {
      judgeSets: settings.judgeSets,
      apiKeys: { current: judgeKey, candidate: candidateKey },
      // One panel runs at a time in this worker; its three roles may run together.
      judgeLimiter: createLimiter(3),
      transportTimeoutMs: settings.transportTimeoutMs,
      fetchImpl: dependencies.fetchImpl,
      judgeEvaluationImpl: dependencies.judgeEvaluationImpl,
      onJudgeProgress: dependencies.onJudgeProgress,
      onProgress: dependencies.onProgress,
    });
    const document = {
      experimentVersion: EXPERIMENT_VERSION,
      contractVersion: core.CONTRACT_VERSION,
      createdAt: new Date().toISOString(),
      shardIndex: shard.shardIndex,
      shardCount: shard.shardCount,
      workerId: output.workerId,
      questionIndexes: output.questionIndexes,
      judgeSets: settings.judgeSets,
      executions: output.executions,
    };
    const path = resolve(outputDir, `worker-${shard.workerId}.json`);
    await writePrivateJson(path, document);
    return { outputDir, workerOutputPath: path, workerOutput: document };
  } finally {
    await releaseSlot();
  }
}

export async function runRepairWorkerPhase(args, dependencies = {}) {
  const { config, env } = dependencies.inputs || await readInputs();
  const packets = dependencies.packets || await loadFrozenPackets(args.frozenPackets);
  const candidateManifest = dependencies.candidateManifest || await loadCandidateManifest(args.candidateManifest);
  const settings = resolveExperimentSettings(config, env, candidateManifest);
  const sourcePath = resolve(args.workerOutputs[0]);
  const source = dependencies.workerOutput || JSON.parse(await readFile(sourcePath, 'utf8'));
  if (!Number.isInteger(source.workerId) || source.workerId < 1 || source.workerId > DEFAULT_WORKER_COUNT) {
    throw new Error('Repair source has an invalid workerId.');
  }
  if (!sameCanonical(source.judgeSets, settings.judgeSets)) {
    throw new Error(`Worker ${source.workerId} judge configuration does not match the bound experiment configuration.`);
  }
  const expectedQuestionIndexes = selectWorkerShard(packets, source.workerId - 1, DEFAULT_WORKER_COUNT).packets.map((packet) => packet.questionIndex);
  if (!sameCanonical(source.questionIndexes, expectedQuestionIndexes)) {
    throw new Error(`Worker ${source.workerId} question ownership does not match its deterministic shard.`);
  }
  if (source.executions?.length !== expectedQuestionIndexes.length * PANEL_SPECS.length) {
    throw new Error(`Worker ${source.workerId} has an incomplete execution set.`);
  }
  const outputDir = resolve(args.outputDir || dirname(sourcePath));
  const judgeKey = env[config.judges.keyEnv] || env[config.flagship.keyEnv];
  const candidateKey = env.CANDIDATE_JUDGE_SEARCH_KEY || judgeKey;
  if (!judgeKey || !candidateKey) throw new Error('Missing judge API key environment variable.');
  await ensurePrivateDirectory(outputDir);
  const acquireSlots = dependencies.acquireGlobalWorkerSlotsImpl || acquireGlobalWorkerSlots;
  const releaseSlot = await acquireSlots({ lockRoot: dependencies.globalLockRoot || globalLockRoot(config.judges.appId), requestedSlots: 1 });
  try {
    const repaired = await repairWorkerOutput(source, packets, {
      judgeSets: settings.judgeSets,
      apiKeys: { current: judgeKey, candidate: candidateKey },
      judgeLimiter: createLimiter(3),
      transportTimeoutMs: settings.transportTimeoutMs,
      fetchImpl: dependencies.fetchImpl,
      callRoleJudgeImpl: dependencies.callRoleJudgeImpl,
      onJudgeProgress: dependencies.onJudgeProgress,
    });
    const document = {
      ...repaired,
      createdAt: new Date().toISOString(),
      repairedFrom: { path: sourcePath, hash: await canonicalHash(source) },
    };
    const path = resolve(outputDir, `worker-${source.workerId}-repaired.json`);
    await writePrivateJson(path, document);
    return { outputDir, workerOutputPath: path, workerOutput: document };
  } finally {
    await releaseSlot();
  }
}

export async function runAggregatePhase(args, dependencies = {}) {
  const packets = dependencies.packets || await loadFrozenPackets(args.frozenPackets);
  const { config, env } = dependencies.inputs || await readInputs();
  const candidateManifest = dependencies.candidateManifest || await loadCandidateManifest(args.candidateManifest);
  const settings = resolveExperimentSettings(config, env, candidateManifest);
  const shardCount = DEFAULT_WORKER_COUNT;
  const outputDir = resolve(args.outputDir || dirname(resolve(args.frozenPackets)));
  let paths = args.workerOutputs || [];
  if (!paths.length) {
    const discovered = (await readdir(outputDir)).filter((name) => /^worker-\d+(?:-repaired)?\.json$/.test(name)).sort();
    const byWorker = new Map();
    for (const name of discovered) {
      const workerId = Number(/^worker-(\d+)/.exec(name)?.[1]);
      if (byWorker.has(workerId)) {
        throw new Error(`Multiple outputs found for worker ${workerId}; pass the intended four files explicitly with --worker-output.`);
      }
      byWorker.set(workerId, resolve(outputDir, name));
    }
    paths = [...byWorker.values()];
  }
  const workerOutputs = dependencies.workerOutputs || await Promise.all(paths.map(async (path) => JSON.parse(await readFile(resolve(path), 'utf8'))));
  verifyWorkerCoverage(packets, workerOutputs, settings.judgeSets);
  const merged = await mergeWorkerOutputs(packets, workerOutputs, { expectedQuestionCount: 10 });
  const workerInputs = await Promise.all(workerOutputs.map(async (worker, index) => {
    const path = paths[index] ? resolve(paths[index]) : null;
    if (worker.repairedFrom && path) {
      const source = JSON.parse(await readFile(resolve(worker.repairedFrom.path), 'utf8'));
      const sourceHash = await canonicalHash(source);
      if (sourceHash !== worker.repairedFrom.hash) {
        throw new Error(`Worker ${worker.workerId} repair source hash does not match its recorded provenance.`);
      }
    }
    return {
      workerId: worker.workerId,
      path,
      hash: await canonicalHash(worker),
      repairedFrom: worker.repairedFrom || null,
    };
  }));
  const document = { ...merged, createdAt: new Date().toISOString(), shardCount, judgeSets: workerOutputs[0].judgeSets, workerInputs };
  await ensurePrivateDirectory(outputDir);
  await writePrivateJson(resolve(outputDir, 'merged-results.json'), document);
  await writePrivateFile(resolve(outputDir, 'report.html'), renderExperimentHtml(document));
  return { outputDir, merged: document };
}

async function runAllPhase(args, dependencies = {}) {
  const { config, questions, env } = dependencies.inputs || await readInputs();
  const candidateManifest = dependencies.candidateManifest || await loadCandidateManifest(args.candidateManifest);
  const settings = resolveExperimentSettings(config, env, candidateManifest);
  const apiKeys = {
    flagship: env[config.flagship.keyEnv],
    judge: env[config.judges.keyEnv] || env[config.flagship.keyEnv],
    candidateJudge: env.CANDIDATE_JUDGE_SEARCH_KEY || env[config.judges.keyEnv] || env[config.flagship.keyEnv],
  };
  for (const [name, key] of Object.entries(apiKeys)) if (!key) throw new Error(`Missing ${name} API key environment variable.`);
  const createdAt = new Date().toISOString();
  const outputDir = resolve(args.outputDir || defaultOutputDir());
  await ensurePrivateDirectory(outputDir);
  const acquireSlots = dependencies.acquireGlobalWorkerSlotsImpl || acquireGlobalWorkerSlots;
  const releaseSlots = await acquireSlots({ lockRoot: dependencies.globalLockRoot || globalLockRoot(config.judges.appId), requestedSlots: 1 });
  try {
    const result = await runExperiment({
      questions, flagship: config.flagship, settings, apiKeys, expectedQuestionCount: 10,
      judgeLimiter: createLimiter(3),
      callAgentImpl: dependencies.callAgentImpl, judgeEvaluationImpl: dependencies.judgeEvaluationImpl,
      fetchImpl: dependencies.fetchImpl, onProgress: dependencies.onProgress,
      onJudgeProgress: dependencies.onJudgeProgress,
      async onWorkerComplete(workerOutput) {
        await writePrivateJson(resolve(outputDir, `worker-${workerOutput.workerId}.json`), workerOutput);
      },
    });
    await writePrivateJson(resolve(outputDir, 'frozen-packets.json'), { experimentVersion: EXPERIMENT_VERSION, contractVersion: core.CONTRACT_VERSION, packets: result.packets });
    const merged = { ...result.merged, createdAt, settings: publicSettings(config, settings, createdAt) };
    await writePrivateJson(resolve(outputDir, 'merged-results.json'), merged);
    await writePrivateFile(resolve(outputDir, 'report.html'), renderExperimentHtml(merged));
    return { outputDir, merged };
  } finally {
    await releaseSlots();
  }
}

export async function runCli(argv = process.argv.slice(2)) {
  const args = parseCliArgs(argv);
  const progress = (event) => {
    const line = progressLine(event);
    if (line) process.stderr.write(`${line}\n`);
  };
  const judgeProgress = (event) => {
    const suffix = event.error ? `: ${event.error.slice(0, 240)}` : '';
    process.stderr.write(`[judge ${event.role}] ${event.phase}${event.attempt ? ` attempt ${event.attempt}` : ''}${suffix}\n`);
  };
  let result;
  if (args.phase === 'capture') result = await runCapturePhase(args, { onProgress: progress });
  else if (args.phase === 'worker') result = await runWorkerPhase(args, { onProgress: progress, onJudgeProgress: judgeProgress });
  else if (args.phase === 'repair-worker') result = await runRepairWorkerPhase(args, { onJudgeProgress: judgeProgress });
  else if (args.phase === 'aggregate') result = await runAggregatePhase(args);
  else result = await runAllPhase(args, { onProgress: progress, onJudgeProgress: judgeProgress });
  process.stdout.write(JSON.stringify({
    phase: args.phase,
    outputDir: result.outputDir,
    ...(result.frozenPacketsPath ? { frozenPacketsPath: result.frozenPacketsPath } : {}),
    ...(result.workerOutputPath ? { workerOutputPath: result.workerOutputPath } : {}),
    ...(result.merged ? { summary: result.merged.summary } : {}),
  }, null, 2) + '\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCli().catch((error) => { console.error(error); process.exitCode = 1; });
}
