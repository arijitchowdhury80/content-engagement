import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const core = require('../frontend/chat-widget/algolia-judge-core.js');
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const DEFAULT_TIMEOUT_MS = 60_000;

export function createLimiter(limit) {
  const maximum = Math.max(1, Number(limit) || 1);
  let active = 0;
  const queue = [];
  const releaseNext = () => {
    active -= 1;
    const next = queue.shift();
    if (next) next();
  };
  return {
    async acquire() {
      if (active >= maximum) await new Promise((resolve) => queue.push(resolve));
      active += 1;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        releaseNext();
      };
    },
  };
}

export function loadLocalEnv(path = resolve(root, '.env.local')) {
  const values = { ...process.env };
  if (!existsSync(path)) return values;
  for (const raw of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = raw.trim().replace(/^export\s+/, '');
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const split = line.indexOf('=');
    const key = line.slice(0, split).trim();
    if (key in values) continue;
    values[key] = line.slice(split + 1).trim().replace(/^['"]|['"]$/g, '');
  }
  return values;
}

export function applyJudgeAgentOverrides(config, env) {
  const overrideNames = {
    skeptic: 'JUDGE_SKEPTIC_AGENT_ID',
    referee: 'JUDGE_REFEREE_AGENT_ID',
    advocate: 'JUDGE_ADVOCATE_AGENT_ID',
  };
  return {
    ...config,
    judges: {
      ...config.judges,
      agents: Object.fromEntries(Object.entries(overrideNames).map(([role, name]) => [
        role,
        String(env[name] || config.judges?.agents?.[role] || '').trim(),
      ])),
    },
  };
}

const TERMINAL_FAILURE_EVENT_TYPES = new Set([
  'error',
  'abort',
  'data-error',
  'data-agent-error',
  'data-guardrail-violation',
]);

function ssePayload(line, state) {
  const value = line.trim();
  if (!value.startsWith('data:')) return null;
  const data = value.slice(5).trim();
  if (!data || data === '[DONE]') return null;
  try { return JSON.parse(data); }
  catch (error) {
    state.errors.push(`Malformed SSE data frame: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

function collectEvent(event, state) {
  if (!event || typeof event !== 'object') return;
  if (event.type === 'text-delta') {
    const delta = typeof event.delta === 'string' ? event.delta : event.textDelta;
    if (typeof delta === 'string') state.answer += delta;
    return;
  }
  if (event.type === 'tool-input-available') {
    state.toolInputs.set(event.toolCallId || '', {
      toolCallId: event.toolCallId || '',
      toolName: event.toolName || '',
      input: event.input ?? null,
    });
    return;
  }
  if (event.type === 'tool-output-available') {
    const input = state.toolInputs.get(event.toolCallId || '');
    state.evidenceEvents.push({
      eventId: `E${state.evidenceEvents.length + 1}`,
      toolCallId: event.toolCallId || '',
      toolName: event.toolName || input?.toolName || '',
      callIndex: state.evidenceEvents.length,
      input: input?.input ?? null,
      output: event.output ?? null,
    });
    return;
  }
  if (TERMINAL_FAILURE_EVENT_TYPES.has(event.type)) {
    const detail = event.message ?? event.error ?? event.data ?? event.reason ?? event;
    const rendered = typeof detail === 'string' ? detail : JSON.stringify(detail);
    state.errors.push(`${event.type}: ${rendered}`);
  }
}

export function parseAgentStream(raw) {
  const state = { answer: '', evidenceEvents: [], errors: [], toolInputs: new Map() };
  const normalized = String(raw || '').replace(/\r\n/g, '\n');
  for (const block of normalized.split(/\n\n+/)) {
    const dataLines = block.split('\n').filter((line) => line.trim().startsWith('data:'));
    for (const line of dataLines) collectEvent(ssePayload(line, state), state);
  }
  return { answer: state.answer, evidenceEvents: state.evidenceEvents, errors: state.errors };
}

function completionUrl(appId, agentId) {
  return `https://${appId}.algolia.net/agent-studio/1/agents/${agentId}/completions?compatibilityMode=ai-sdk-5`;
}

async function fetchTextWithTimeout(url, options, timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl = fetch) {
  if (timeoutMs === null || Number(timeoutMs) <= 0) {
    const response = await fetchImpl(url, options);
    const text = await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 500)}`);
    return text;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error(`Request timed out after ${timeoutMs}ms`)), timeoutMs);
  try {
    const response = await fetchImpl(url, { ...options, signal: controller.signal });
    const text = await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 500)}`);
    return text;
  } finally {
    clearTimeout(timeout);
  }
}

export async function callAgent(agent, apiKey, question, options = {}) {
  const body = {
    messages: [{ role: 'user', parts: [{ type: 'text', text: question }] }],
  };
  if (agent.origin) body.messages[0].metadata = { turnContext: { current_url: agent.origin } };
  const headers = {
    'content-type': 'application/json',
    'x-algolia-application-id': agent.appId,
    'x-algolia-api-key': apiKey,
  };
  if (agent.origin) {
    headers.origin = agent.origin;
    headers.referer = `${agent.origin.replace(/\/$/, '')}/`;
  }
  const raw = await fetchTextWithTimeout(completionUrl(agent.appId, agent.agentId), {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  }, options.timeoutMs, options.fetchImpl);
  const parsed = parseAgentStream(raw);
  if (!parsed.answer.trim()) throw new Error(`Agent ${agent.label || agent.agentId} returned no answer${parsed.errors.length ? `: ${parsed.errors.join('; ')}` : ''}`);
  if (parsed.errors.length) throw new Error(`Agent ${agent.label || agent.agentId} returned a partial answer before failing: ${parsed.errors.join('; ')}`);
  return { ...parsed, rawStream: raw };
}

export function strictJson(value) {
  const text = String(value || '').trim();
  if (!text) throw new Error('Judge returned an empty response');
  const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n```$/i.exec(text);
  return JSON.parse(fenced ? fenced[1].trim() : text);
}

export async function callRoleJudge(role, agentId, appId, apiKey, evaluation, options = {}) {
  const startedAt = (options.now || Date.now)();
  let lastError;
  let failureKind = null;
  let validationFeedback = Array.isArray(options.initialValidationFeedback)
    ? options.initialValidationFeedback.map(String)
    : [];
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const attemptId = `${evaluation.evaluationId}:${role}:${Date.now()}:${attempt}`;
    options.onJudgeProgress?.({ phase: 'start', role, attempt, evaluationId: evaluation.evaluationId });
    const release = options.judgeLimiter ? await options.judgeLimiter.acquire() : () => {};
    try {
      const headers = {
        'content-type': 'application/json',
        'x-algolia-application-id': appId,
        'x-algolia-api-key': apiKey,
      };
      if (options.origin) {
        headers.origin = options.origin;
        headers.referer = `${options.origin.replace(/\/$/, '')}/`;
      }
      const raw = await fetchTextWithTimeout(completionUrl(appId, agentId), {
        method: 'POST',
        headers,
        body: JSON.stringify({ messages: [{ role: 'user', parts: [{ type: 'text', text: JSON.stringify(core.buildJudgeInput(evaluation, role, attemptId, validationFeedback)) }] }] }),
      }, options.timeoutMs, options.fetchImpl);
      const parsed = parseAgentStream(raw);
      if (parsed.errors.length) throw new Error(`Judge ${role} returned an error-tainted stream: ${parsed.errors.join('; ')}`);
      const validated = core.validateJudgeReport(role, strictJson(parsed.answer), evaluation);
      if (validated.ok) {
        options.onJudgeProgress?.({ phase: 'complete', role, attempt, evaluationId: evaluation.evaluationId });
        return { ...validated, attempts: attempt, durationMs: Math.max(0, (options.now || Date.now)() - startedAt), rawStream: raw };
      }
      lastError = new Error(validated.errors.join('; '));
      failureKind = 'validation';
      validationFeedback = validated.errors;
      options.onJudgeProgress?.({ phase: 'retry', role, attempt, evaluationId: evaluation.evaluationId, error: lastError.message });
    } catch (error) {
      lastError = error;
      failureKind = 'transport';
      validationFeedback = [];
      options.onJudgeProgress?.({ phase: 'retry', role, attempt, evaluationId: evaluation.evaluationId, error: error instanceof Error ? error.message : String(error) });
    } finally {
      release();
    }
  }
  options.onJudgeProgress?.({ phase: 'failed', role, evaluationId: evaluation.evaluationId, error: lastError instanceof Error ? lastError.message : String(lastError) });
  return {
    ok: false,
    role,
    attempts: 2,
    durationMs: Math.max(0, (options.now || Date.now)() - startedAt),
    errors: [lastError instanceof Error ? lastError.message : String(lastError)],
    failureKind,
    ...(failureKind === 'validation' ? { validationErrors: [...validationFeedback] } : {}),
  };
}

export async function judgeEvaluation(evaluation, judges, apiKey, options = {}) {
  if (!evaluation.evidencePacket.events.length || !evaluation.evidencePacket.passages.length) {
    return { status: 'unavailable', error: 'The answer returned no usable retrieval evidence; semantic grounding cannot be evaluated.', evaluation };
  }
  if (!evaluation.capacity.fits) {
    return { status: 'unavailable', error: `Complete evidence packet exceeds verified judge capacity (${evaluation.capacity.estimatedInputTokens} input tokens).`, evaluation };
  }
  const agentConfig = core.ROLES.map((role) => ({ role, id: judges.agents[role] }));
  const validation = core.validateJudgeAgents(agentConfig);
  if (!validation.ok) throw new Error(validation.errors.join('; '));
  const reports = await Promise.all(core.ROLES.map((role) => callRoleJudge(
    role,
    judges.agents[role],
    judges.appId,
    apiKey,
    evaluation,
    { ...options, origin: judges.origin || options.origin },
  )));
  return { ...core.aggregateJudgeReports(reports), evaluation, reports };
}

export async function judgeAnswer(question, answerResult, judges, apiKey, options = {}) {
  const evaluation = await core.createEvaluationPackage({
    question,
    answer: answerResult.answer,
    evidenceEvents: answerResult.evidenceEvents,
  });
  return judgeEvaluation(evaluation, judges, apiKey, options);
}

export async function compareQuestion(question, config, keys, options = {}) {
  const call = options.callAgentImpl || callAgent;
  const judge = options.judgeAnswerImpl || judgeAnswer;
  const answerResults = await Promise.allSettled([
    call(config.flagship, keys.flagship, question, options),
    call(config.production, keys.production, question, options),
  ]);
  const sides = ['flagship', 'production'];
  const output = { question };
  await Promise.all(answerResults.map(async (result, index) => {
    const side = sides[index];
    if (result.status === 'rejected') {
      output[side] = {
        answer: '',
        verdict: { status: 'unavailable', error: result.reason instanceof Error ? result.reason.message : String(result.reason) },
      };
      return;
    }
    try {
      output[side] = { ...result.value, verdict: await judge(question, result.value, config.judges, keys.judge, options) };
    } catch (error) {
      output[side] = {
        ...result.value,
        verdict: { status: 'unavailable', error: error instanceof Error ? error.message : String(error) },
      };
    }
  }));
  return {
    question: output.question,
    flagship: output.flagship,
    production: output.production,
  };
}

export async function rejudgeRow(row, config, keys, options = {}) {
  const output = { question: row.question };
  await Promise.all(['flagship', 'production'].map(async (side) => {
    const answer = row[side];
    if (!answer?.answer || !Array.isArray(answer.evidenceEvents)) {
      output[side] = { ...answer, verdict: { status: 'unavailable', error: 'Saved row has no complete answer/evidence payload.' } };
      return;
    }
    try {
      output[side] = { ...answer, verdict: await judgeAnswer(row.question, answer, config.judges, keys.judge, options) };
    } catch (error) {
      output[side] = { ...answer, verdict: { status: 'unavailable', error: error instanceof Error ? error.message : String(error) } };
    }
  }));
  return output;
}

function scored(verdict) {
  return Number.isFinite(verdict?.composite);
}

export function summarize(rows) {
  const result = {};
  for (const side of ['flagship', 'production']) {
    const values = rows.map((row) => row[side]?.verdict?.composite).filter(Number.isFinite);
    result[side] = {
      scored: values.length,
      total: rows.length,
      average: values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length * 10) / 10 : null,
    };
  }
  return result;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function score(value) {
  if (!Number.isFinite(value)) return 'Unavailable';
  return `${Number.isInteger(value) ? value : value.toFixed(1)}/10`;
}

function verdictCell(result) {
  const verdict = result?.verdict || {};
  const dims = verdict.dims || {};
  const judges = Array.isArray(verdict.perJudge) ? verdict.perJudge : [];
  const error = verdict.error ? `<p class="error">${escapeHtml(verdict.error)}</p>` : '';
  return `<div class="score">${score(verdict.composite)}</div>
    <div class="status">${escapeHtml(verdict.groundingStatus || verdict.status || 'unavailable')}</div>
    <dl><dt>Grounding</dt><dd>${score(dims.grounding)}</dd><dt>Completeness</dt><dd>${score(dims.completeness ?? dims.coverage)}</dd><dt>Depth</dt><dd>${score(dims.depth)}</dd><dt>Relevance</dt><dd>${score(dims.relevance)}</dd></dl>
    <p class="judges">${judges.map((judge) => `${escapeHtml(judge.role)} ${score(Number.isFinite(judge.score) ? judge.score : (judge.scores ? (judge.scores.completeness + judge.scores.depth + judge.scores.relevance) / 3 : null))}`).join(' | ')}</p>
    ${error}<details><summary>Answer</summary><div class="answer">${escapeHtml(result?.answer || '')}</div></details>`;
}

export function renderHtml(run) {
  const rows = run.rows.map((row, index) => `<tr><th scope="row"><span>${index + 1}</span>${escapeHtml(row.question)}</th><td>${verdictCell(row.flagship)}</td><td>${verdictCell(row.production)}</td></tr>`).join('\n');
  const flagshipAverage = run.summary.flagship.average;
  const productionAverage = run.summary.production.average;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Agent comparison</title><style>
  :root{font-family:Inter,Arial,sans-serif;color:#23263b;background:#f7f7fb}body{margin:0;padding:24px}main{max-width:1440px;margin:auto}h1{font-size:24px;margin:0 0 6px}.meta{color:#62677f;margin:0 0 20px}table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #d9dbea;table-layout:fixed}th,td{vertical-align:top;text-align:left;border:1px solid #d9dbea;padding:16px}thead th{background:#eef0fa;font-size:14px}tbody th{width:28%;font-size:14px;line-height:1.45}tbody th span{display:block;color:#70758d;font-size:12px;margin-bottom:5px}.score{font-size:24px;font-weight:700;color:#003dff}.status{text-transform:capitalize;color:#555b74;font-size:12px;margin:2px 0 12px}dl{display:grid;grid-template-columns:1fr auto;gap:5px 14px;margin:0;font-size:13px}dt,dd{margin:0}.judges{font-size:12px;color:#555b74;line-height:1.5}.error{color:#b42318;font-size:12px}.answer{white-space:pre-wrap;font-size:13px;line-height:1.5;margin-top:10px}summary{cursor:pointer;font-weight:600;font-size:13px}@media(max-width:760px){body{padding:10px}table,thead,tbody,tr,th,td{display:block}thead{display:none}tbody th{width:auto;background:#eef0fa}td{border-top:0}}
  </style></head><body><main><h1>Flagship vs. production</h1><p class="meta">${escapeHtml(run.createdAt)} | Flagship ${score(flagshipAverage)} (${run.summary.flagship.scored}/${run.summary.flagship.total}) | Production ${score(productionAverage)} (${run.summary.production.scored}/${run.summary.production.total})</p><table><thead><tr><th>Question</th><th>Flagship</th><th>Production</th></tr></thead><tbody>${rows}</tbody></table></main></body></html>`;
}

export async function mapLimit(values, limit, mapper) {
  const results = new Array(values.length);
  const workerCount = Math.min(Math.max(1, Number(limit) || 1), values.length);
  let cursor = 0;
  async function worker() {
    while (cursor < values.length) {
      const index = cursor++;
      results[index] = await mapper(values[index], index);
    }
  }
  await Promise.all(Array.from({ length: workerCount }, worker));
  return results;
}

export async function runCli(argv = process.argv.slice(2)) {
  const rawConfig = JSON.parse(await readFile(resolve(here, 'config.json'), 'utf8'));
  const rejudgeIndex = argv.indexOf('--rejudge');
  const rejudgePath = rejudgeIndex >= 0 ? argv[rejudgeIndex + 1] : null;
  if (rejudgeIndex >= 0 && !rejudgePath) throw new Error('--rejudge requires a results.json path.');
  const unknown = rejudgeIndex < 0
    ? argv
    : argv.filter((_value, index) => index !== rejudgeIndex && index !== rejudgeIndex + 1);
  if (unknown.length) throw new Error(`Unknown argument: ${unknown[0]}`);
  const priorRun = rejudgePath ? JSON.parse(await readFile(resolve(rejudgePath), 'utf8')) : null;
  const questions = priorRun
    ? priorRun.rows.map((row) => row.question)
    : JSON.parse(await readFile(resolve(here, 'questions.json'), 'utf8'));
  const env = loadLocalEnv();
  const config = applyJudgeAgentOverrides(rawConfig, env);
  const keys = {
    flagship: env[config.flagship.keyEnv],
    production: env[config.production.keyEnv],
    judge: env[config.judges.keyEnv] || env[config.flagship.keyEnv],
  };
  for (const [name, value] of Object.entries(keys)) {
    if (!value) throw new Error(`Missing ${name} API key environment variable.`);
  }
  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const outputDir = resolve(here, 'runs', runId);
  await mkdir(outputDir, { recursive: true });
  const timeoutMs = Number(env.COMPARISON_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
  const judgeLimiter = createLimiter(Number(env.JUDGE_CONCURRENCY || 3));
  const checkpointRows = new Array(questions.length);
  let checkpointWrite = Promise.resolve();
  const persistCheckpoint = (index, row) => {
    checkpointRows[index] = row;
    checkpointWrite = checkpointWrite.then(() => writeFile(resolve(outputDir, 'checkpoint.json'), JSON.stringify({
      contractVersion: core.CONTRACT_VERSION,
      updatedAt: new Date().toISOString(),
      ...(rejudgePath ? { rejudgedFrom: resolve(rejudgePath) } : {}),
      completed: checkpointRows.filter(Boolean).length,
      total: questions.length,
      rows: checkpointRows.filter(Boolean),
    }, null, 2) + '\n'));
    return checkpointWrite;
  };
  const rows = await mapLimit(questions, Number(env.COMPARISON_CONCURRENCY || 1), async (question, index) => {
    process.stderr.write(`[${index + 1}/${questions.length}] ${question}\n`);
    const judgeOptions = {
      timeoutMs,
      judgeLimiter,
      onJudgeProgress(event) {
        const suffix = event.error ? `: ${event.error.slice(0, 240)}` : '';
        process.stderr.write(`[${index + 1}/${questions.length}] judge ${event.role} ${event.phase}${event.attempt ? ` attempt ${event.attempt}` : ''}${suffix}\n`);
      },
    };
    try {
      const row = priorRun
        ? await rejudgeRow(priorRun.rows[index], config, keys, judgeOptions)
        : await compareQuestion(question, config, keys, judgeOptions);
      await persistCheckpoint(index, row);
      process.stderr.write(`[${index + 1}/${questions.length}] checkpoint saved\n`);
      return row;
    } catch (error) {
      const failure = {
        verdict: { status: 'unavailable', error: error instanceof Error ? error.message : String(error) },
        answer: '',
      };
      const row = { question, flagship: failure, production: failure };
      await persistCheckpoint(index, row);
      return row;
    }
  });
  await checkpointWrite;
  const result = {
    contractVersion: core.CONTRACT_VERSION,
    createdAt: new Date().toISOString(),
    ...(rejudgePath ? { rejudgedFrom: resolve(rejudgePath) } : {}),
    config,
    rows,
    summary: summarize(rows),
  };
  await writeFile(resolve(outputDir, 'results.json'), JSON.stringify(result, null, 2) + '\n');
  await writeFile(resolve(outputDir, 'report.html'), renderHtml(result));
  process.stdout.write(JSON.stringify({ outputDir, summary: result.summary }, null, 2) + '\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCli().catch((error) => { console.error(error); process.exitCode = 1; });
}
