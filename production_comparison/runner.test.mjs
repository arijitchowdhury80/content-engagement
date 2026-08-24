import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyJudgeAgentOverrides, callAgent, callRoleJudge, compareQuestion, createLimiter, judgeAnswer, judgeEvaluation, mapLimit, parseAgentStream, renderHtml, runCli as runLegacyCli, strictJson, summarize } from './runner.mjs';
import {
  PANEL_SPECS,
  REQUIRED_CANDIDATE_PROVIDER_ID,
  acquireGlobalWorkerSlots,
  averageVariantExecutions,
  bindCandidateManifest,
  captureFrozenPackets,
  createFrozenPacket,
  createWorkerShards,
  mergeWorkerOutputs,
  parseCliArgs,
  readCandidatePromptHashes,
  repairPanelExecution,
  repairWorkerOutput,
  renderExperimentHtml,
  resolveExperimentSettings,
  runAggregatePhase,
  runCapturePhase,
  runRepairWorkerPhase,
  runWorkerPhase,
  runWorkerShard,
  selectWorkerShard,
  verifyFrozenPacket,
  verifyWorkerCoverage,
} from './parallel-experiment.mjs';

const require = createRequire(import.meta.url);
const core = require('../frontend/chat-widget/algolia-judge-core.js');
const LOCAL_CANDIDATE_PROMPT_HASHES = await readCandidatePromptHashes();

test('judge limiter never exceeds its configured concurrency', async () => {
  const limiter = createLimiter(2);
  let active = 0;
  let maximum = 0;
  await Promise.all(Array.from({ length: 6 }, async () => {
    const release = await limiter.acquire();
    active += 1;
    maximum = Math.max(maximum, active);
    await new Promise((resolve) => setTimeout(resolve, 2));
    active -= 1;
    release();
  }));
  assert.equal(maximum, 2);
});

test('global semaphore admits four worker processes and blocks a fifth until release', async () => {
  const lockRoot = await mkdtemp(join(tmpdir(), 'judge-global-slots-'));
  const releases = [];
  try {
    for (let index = 0; index < 4; index += 1) {
      releases.push(await acquireGlobalWorkerSlots({ lockRoot, pollIntervalMs: 5 }));
    }
    let fifthAcquired = false;
    const fifthPromise = acquireGlobalWorkerSlots({ lockRoot, pollIntervalMs: 5 }).then((release) => {
      fifthAcquired = true;
      return release;
    });
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(fifthAcquired, false);
    await releases.shift()();
    const fifthRelease = await fifthPromise;
    assert.equal(fifthAcquired, true);
    await fifthRelease();
  } finally {
    await Promise.all(releases.map((release) => release()));
    await rm(lockRoot, { recursive: true, force: true });
  }
});

test('global semaphore atomically reclaims a stale dead-PID slot', async () => {
  const lockRoot = await mkdtemp(join(tmpdir(), 'judge-stale-slot-'));
  try {
    const staleSlot = join(lockRoot, 'slot-1');
    await mkdir(staleSlot, { mode: 0o700 });
    await writeFile(join(staleSlot, 'owner.json'), `${JSON.stringify({ pid: 999_999_999, token: 'stale' })}\n`);
    const release = await acquireGlobalWorkerSlots({
      lockRoot,
      pollIntervalMs: 5,
      killImpl(pid) {
        if (pid === 999_999_999) throw Object.assign(new Error('dead'), { code: 'ESRCH' });
        return process.kill(pid, 0);
      },
    });
    const activeSlot = (await readdir(lockRoot)).find((name) => /^slot-[1-4]$/.test(name));
    assert.notEqual(activeSlot, undefined);
    const owner = JSON.parse(await readFile(join(lockRoot, activeSlot, 'owner.json'), 'utf8'));
    assert.equal(owner.pid, process.pid);
    assert.notEqual(owner.token, 'stale');
    await release();
    assert.deepEqual(await readdir(lockRoot), []);
  } finally {
    await rm(lockRoot, { recursive: true, force: true });
  }
});

test('strict judge JSON accepts one exact code fence but rejects surrounding prose', () => {
  assert.deepEqual(strictJson('{"score":1}'), { score: 1 });
  assert.deepEqual(strictJson('```json\n{"score":1}\n```'), { score: 1 });
  assert.throws(() => strictJson('Here is the result:\n```json\n{"score":1}\n```'), /Unexpected token|not valid JSON/);
});

test('judge agent environment overrides replace all three immutable role IDs', () => {
  const config = { judges: { appId: 'APP', agents: { skeptic: 'old-s', referee: 'old-r', advocate: 'old-a' } } };
  const actual = applyJudgeAgentOverrides(config, {
    JUDGE_SKEPTIC_AGENT_ID: 'new-s', JUDGE_REFEREE_AGENT_ID: 'new-r', JUDGE_ADVOCATE_AGENT_ID: 'new-a',
  });
  assert.deepEqual(actual.judges.agents, { skeptic: 'new-s', referee: 'new-r', advocate: 'new-a' });
  assert.deepEqual(config.judges.agents, { skeptic: 'old-s', referee: 'old-r', advocate: 'old-a' });
});

test('parses ai-sdk-5 text and preserves ordered duplicate tool outputs', () => {
  const raw = [
    `data: ${JSON.stringify({ type: 'tool-output-available', toolCallId: 'a', output: { hits: [{ objectID: 'same', text: 'first' }] } })}`,
    `data: ${JSON.stringify({ type: 'tool-output-available', toolCallId: 'b', output: { hits: [{ objectID: 'same', text: 'second' }] } })}`,
    `data: ${JSON.stringify({ type: 'text-delta', delta: 'Hello ' })}`,
    `data: ${JSON.stringify({ type: 'text-delta', delta: 'world.' })}`,
  ].join('\n\n');
  const parsed = parseAgentStream(raw);
  assert.equal(parsed.answer, 'Hello world.');
  assert.equal(parsed.evidenceEvents.length, 2);
  assert.equal(parsed.evidenceEvents[0].output.hits[0].text, 'first');
  assert.equal(parsed.evidenceEvents[1].output.hits[0].text, 'second');
});

test('summary averages only scored rows and HTML escapes answer content', () => {
  const rows = [{ question: '<q>', flagship: { answer: '<script>x</script>', verdict: { composite: 8 } }, production: { answer: 'ok', verdict: { composite: 6 } } }, { question: 'q2', flagship: { answer: 'none', verdict: { status: 'unavailable' } }, production: { answer: 'ok', verdict: { composite: 8 } } }];
  const summary = summarize(rows);
  assert.deepEqual(summary.flagship, { scored: 1, total: 2, average: 8 });
  assert.deepEqual(summary.production, { scored: 2, total: 2, average: 7 });
  const html = renderHtml({ createdAt: 'now', rows, summary });
  assert.doesNotMatch(html, /<script>x<\/script>/);
  assert.match(html, /&lt;script&gt;x&lt;\/script&gt;/);
  assert.match(html, /Flagship 8\/10/);
});

test('production agent transport sends its configured origin and preserves complete evidence', async () => {
  let observed;
  const fetchImpl = async (url, init) => {
    observed = { url, init };
    return new Response([
      `data: ${JSON.stringify({ type: 'tool-input-available', toolCallId: 'search', toolName: 'algolia_search_index', input: { query: 'q' } })}`,
      `data: ${JSON.stringify({ type: 'tool-output-available', toolCallId: 'search', output: { hits: [{ text: 'complete source text' }] } })}`,
      `data: ${JSON.stringify({ type: 'text-delta', delta: 'Grounded answer.' })}`,
    ].join('\n\n'), { status: 200 });
  };
  const result = await callAgent({ appId: 'APP', agentId: 'AGENT', label: 'Production', origin: 'https://www.algolia.com' }, 'key', 'q', { fetchImpl });
  assert.equal(observed.init.headers.origin, 'https://www.algolia.com');
  assert.equal(observed.init.headers.referer, 'https://www.algolia.com/');
  assert.equal(result.evidenceEvents[0].input.query, 'q');
  assert.equal(result.evidenceEvents[0].output.hits[0].text, 'complete source text');
});

test('agent transport rejects HTTP failures and empty answer streams', async () => {
  const agent = { appId: 'APP', agentId: 'AGENT', label: 'Test' };
  await assert.rejects(
    callAgent(agent, 'key', 'q', { fetchImpl: async () => new Response('service unavailable', { status: 503 }) }),
    /HTTP 503/,
  );
  await assert.rejects(
    callAgent(agent, 'key', 'q', { fetchImpl: async () => new Response(`data: ${JSON.stringify({ type: 'finish' })}`, { status: 200 }) }),
    /returned no answer/,
  );
});

test('agent transport rejects partial text followed by a stream error', async () => {
  const raw = [
    `data: ${JSON.stringify({ type: 'text-delta', delta: 'Partial answer' })}`,
    `data: ${JSON.stringify({ type: 'error', message: 'upstream failed' })}`,
  ].join('\n\n');
  await assert.rejects(
    callAgent({ appId: 'APP', agentId: 'AGENT', label: 'Test' }, 'key', 'q', {
      fetchImpl: async () => new Response(raw, { status: 200 }),
    }),
    /partial answer before failing: error: upstream failed/,
  );
});

test('judge transport retries valid JSON followed by a stream error instead of accepting it', async () => {
  let calls = 0;
  const evaluation = {
    evaluationId: 'evaluation-stream-error',
    question: 'Question?',
    answer: 'Answer.',
    answerManifest: [{ sentenceId: 'S1', text: 'Answer.', start: 0, end: 7 }],
    evidenceHash: 'evidence-hash',
    evidencePacket: { passages: [{ evidencePassageId: 'P1', eventId: 'E1', fieldPath: '/text', text: 'Answer.' }] },
  };
  const report = {
    dimensionScores: { grounding: 10, completeness: 10, depth: 10, relevance: 10 },
    dimensionRationales: { grounding: 'Supported.', completeness: 'Complete.', depth: 'Deep.', relevance: 'Relevant.' },
    sentenceAssessments: [{ sentenceId: 'S1', classification: 'factual', claims: [{ claimText: 'Answer.', verdict: 'supported', materiality: 'minor', centralToAnswer: false, evidencePassageIds: ['P1'], reason: 'Supported.' }] }],
    summary: 'Valid.',
  };
  const fetchImpl = async () => {
    calls += 1;
    return new Response([
      `data: ${JSON.stringify({ type: 'text-delta', delta: JSON.stringify(report) })}`,
      `data: ${JSON.stringify({ type: 'error', message: 'late failure' })}`,
    ].join('\n\n'), { status: 200 });
  };
  const result = await callRoleJudge('skeptic', 'agent', 'APP', 'key', evaluation, { fetchImpl });
  assert.equal(calls, 2);
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /error-tainted stream.*late failure/);
});

test('judge transport retries valid JSON followed by a malformed SSE frame', async () => {
  let calls = 0;
  const evaluation = {
    evaluationId: 'evaluation-malformed-stream', question: 'Question?', answer: 'Answer.',
    answerManifest: [{ sentenceId: 'S1', text: 'Answer.', start: 0, end: 7 }],
    evidenceHash: 'evidence-hash',
    evidencePacket: { passages: [{ evidencePassageId: 'P1', eventId: 'E1', fieldPath: '/text', text: 'Answer.' }] },
  };
  const report = {
    dimensionScores: { grounding: 10, completeness: 10, depth: 10, relevance: 10 },
    dimensionRationales: { grounding: 'Supported.', completeness: 'Complete.', depth: 'Deep.', relevance: 'Relevant.' },
    sentenceAssessments: [{ sentenceId: 'S1', classification: 'factual', claims: [{ claimText: 'Answer.', verdict: 'supported', materiality: 'minor', centralToAnswer: false, evidencePassageIds: ['P1'], reason: 'Supported.' }] }],
    summary: 'Valid.',
  };
  const fetchImpl = async () => {
    calls += 1;
    return new Response(`data: ${JSON.stringify({ type: 'text-delta', delta: JSON.stringify(report) })}\n\ndata: {not-json}\n\n`, { status: 200 });
  };
  const result = await callRoleJudge('skeptic', 'agent', 'APP', 'key', evaluation, { fetchImpl });
  assert.equal(calls, 2);
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /error-tainted stream.*Malformed SSE data frame/);
});

test('judge transport retries valid JSON followed by a guardrail terminal frame', async () => {
  let calls = 0;
  const evaluation = {
    evaluationId: 'evaluation-guardrail-stream', question: 'Question?', answer: 'Answer.',
    answerManifest: [{ sentenceId: 'S1', text: 'Answer.', start: 0, end: 7 }],
    evidenceHash: 'evidence-hash',
    evidencePacket: { passages: [{ evidencePassageId: 'P1', eventId: 'E1', fieldPath: '/text', text: 'Answer.' }] },
  };
  const report = {
    dimensionScores: { grounding: 10, completeness: 10, depth: 10, relevance: 10 },
    dimensionRationales: { grounding: 'Supported.', completeness: 'Complete.', depth: 'Deep.', relevance: 'Relevant.' },
    sentenceAssessments: [{ sentenceId: 'S1', classification: 'factual', claims: [{ claimText: 'Answer.', verdict: 'supported', materiality: 'minor', centralToAnswer: false, evidencePassageIds: ['P1'], reason: 'Supported.' }] }],
    summary: 'Valid.',
  };
  const fetchImpl = async () => {
    calls += 1;
    return new Response([
      `data: ${JSON.stringify({ type: 'text-delta', delta: JSON.stringify(report) })}`,
      `data: ${JSON.stringify({ type: 'data-guardrail-violation', data: { category: 'policy' } })}`,
    ].join('\n\n'), { status: 200 });
  };
  const result = await callRoleJudge('skeptic', 'agent', 'APP', 'key', evaluation, { fetchImpl });
  assert.equal(calls, 2);
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /error-tainted stream.*data-guardrail-violation/);
});

test('mapLimit normalizes zero and non-numeric concurrency to one worker', async () => {
  assert.deepEqual(await mapLimit([1, 2, 3], 0, async (value) => value * 2), [2, 4, 6]);
  assert.deepEqual(await mapLimit([1, 2], Number.NaN, async (value) => value + 1), [2, 3]);
});

test('agent transport enforces its timeout', async () => {
  const fetchImpl = (_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
  });
  await assert.rejects(
    callAgent({ appId: 'APP', agentId: 'AGENT', label: 'Test' }, 'key', 'q', { fetchImpl, timeoutMs: 5 }),
    /timed out after 5ms/,
  );
});

test('semantic judging is unavailable when retrieval evidence is empty', async () => {
  const verdict = await judgeAnswer('q', { answer: 'An answer.', evidenceEvents: [] }, {
    appId: 'APP', agents: { skeptic: 's', referee: 'r', advocate: 'a' },
  }, 'key');
  assert.equal(verdict.status, 'unavailable');
  assert.match(verdict.error, /no usable retrieval evidence/);
  const emptyOutput = await judgeAnswer('q', { answer: 'An answer.', evidenceEvents: [{ output: null }] }, {
    appId: 'APP', agents: { skeptic: 's', referee: 'r', advocate: 'a' },
  }, 'key');
  assert.equal(emptyOutput.status, 'unavailable');
  assert.match(emptyOutput.error, /no usable retrieval evidence/);
});

test('every judge retry sends the configured allowed origin', async () => {
  const requests = [];
  const fetchImpl = async (url, init) => {
    requests.push({ url, init });
    return new Response(`data: ${JSON.stringify({ type: 'text-delta', delta: '{}' })}`, { status: 200 });
  };
  await judgeAnswer('q', { answer: 'An answer.', evidenceEvents: [{ output: { text: 'Evidence.' } }] }, {
    appId: 'APP', origin: 'https://judge.example', agents: { skeptic: 's', referee: 'r', advocate: 'a' },
  }, 'key', { fetchImpl });
  assert.equal(requests.length, 6);
  for (const request of requests) {
    assert.equal(request.init.headers.origin, 'https://judge.example');
    assert.equal(request.init.headers.referer, 'https://judge.example/');
  }
});

test('a judge retry receives the deterministic validation errors from its prior attempt', async () => {
  const requests = [];
  const evaluation = {
    evaluationId: 'evaluation-1',
    question: 'Question?',
    answer: 'The answer makes a central unsupported claim.',
    answerManifest: [{ sentenceId: 'S1', text: 'The answer makes a central unsupported claim.', start: 0, end: 45 }],
    evidenceHash: 'evidence-hash',
    evidencePacket: { passages: [{ evidencePassageId: 'P1', eventId: 'E1', fieldPath: '/text', text: 'Different evidence.' }] },
  };
  const fetchImpl = async (_url, init) => {
    const body = JSON.parse(init.body);
    const input = JSON.parse(body.messages[0].parts[0].text);
    requests.push(input);
    const report = {
      dimensionScores: { grounding: 4, completeness: 8, depth: 8, relevance: 9 },
      dimensionRationales: { grounding: 'Central claim is unsupported.', completeness: 'Complete.', depth: 'Detailed.', relevance: 'Relevant.' },
      sentenceAssessments: [{
        sentenceId: requests.length === 1 ? 'UNKNOWN' : 'S1', classification: 'factual', claims: [{
          claimText: 'The answer makes a central unsupported claim.',
          verdict: 'unverifiable', materiality: 'critical', centralToAnswer: true,
          evidencePassageIds: [], reason: 'The evidence does not establish the claim.',
        }],
      }],
      summary: 'Review complete.',
    };
    return new Response(`data: ${JSON.stringify({ type: 'text-delta', delta: JSON.stringify(report) })}`, { status: 200 });
  };

  const result = await callRoleJudge('referee', 'agent', 'APP', 'key', evaluation, { fetchImpl });
  assert.equal(result.ok, true);
  assert.equal(result.attempts, 2);
  assert.equal(requests[0].validationFeedback, undefined);
  assert.deepEqual(requests[1].validationFeedback, [
    'sentenceAssessments[0] has an unknown sentenceId',
    'missing sentence assessment: S1',
  ]);
});

test('a post-run repair can seed its first call with prior deterministic validation errors', async () => {
  const requests = [];
  const evaluation = {
    evaluationId: 'evaluation-repair-feedback', question: 'Question?', answer: 'Supported answer.',
    answerManifest: [{ sentenceId: 'S1', text: 'Supported answer.', start: 0, end: 17 }],
    evidenceHash: 'evidence-hash',
    evidencePacket: { passages: [{ evidencePassageId: 'P1', eventId: 'E1', fieldPath: '/text', text: 'Supported answer.' }] },
  };
  const fetchImpl = async (_url, init) => {
    requests.push(JSON.parse(JSON.parse(init.body).messages[0].parts[0].text));
    const report = {
      dimensionScores: { grounding: 10, completeness: 10, depth: 9, relevance: 10 },
      dimensionRationales: { grounding: 'Supported.', completeness: 'Complete.', depth: 'Detailed.', relevance: 'Relevant.' },
      sentenceAssessments: [{ sentenceId: 'S1', classification: 'factual', claims: [{ claimText: 'Supported answer.', verdict: 'supported', materiality: 'material', centralToAnswer: true, evidencePassageIds: ['P1'], reason: 'Supported.' }] }],
      summary: 'Review complete.',
    };
    return new Response(`data: ${JSON.stringify({ type: 'text-delta', delta: JSON.stringify(report) })}`, { status: 200 });
  };
  const result = await callRoleJudge('skeptic', 'agent', 'APP', 'key', evaluation, {
    fetchImpl,
    initialValidationFeedback: ['missing sentence assessment: S1'],
  });
  assert.equal(result.ok, true);
  assert.deepEqual(requests[0].validationFeedback, ['missing sentence assessment: S1']);
});

test('a supported claim without evidence IDs is retried and never converted into an unverifiable finding', async () => {
  const requests = [];
  const evaluation = {
    evaluationId: 'evaluation-proof-contract', question: 'Question?', answer: 'Supported answer.',
    answerManifest: [{ sentenceId: 'S1', text: 'Supported answer.', start: 0, end: 17 }],
    evidenceHash: 'evidence-hash',
    evidencePacket: { passages: [{ evidencePassageId: 'P1', eventId: 'E1', fieldPath: '/text', text: 'Supported answer.' }] },
  };
  const fetchImpl = async (_url, init) => {
    const input = JSON.parse(JSON.parse(init.body).messages[0].parts[0].text);
    requests.push(input);
    const report = {
      dimensionScores: { grounding: 10, completeness: 10, depth: 9, relevance: 10 },
      dimensionRationales: { grounding: 'Supported.', completeness: 'Complete.', depth: 'Detailed.', relevance: 'Relevant.' },
      sentenceAssessments: [{ sentenceId: 'S1', classification: 'factual', claims: [{
        claimText: 'Supported answer.', verdict: 'supported', materiality: 'material', centralToAnswer: true,
        evidencePassageIds: requests.length === 1 ? [] : ['P1'], reason: 'The evidence supports the answer.',
      }] }],
      summary: 'Review complete.',
    };
    return new Response(`data: ${JSON.stringify({ type: 'text-delta', delta: JSON.stringify(report) })}`, { status: 200 });
  };

  const result = await callRoleJudge('referee', 'agent', 'APP', 'key', evaluation, { fetchImpl });
  assert.equal(result.ok, true);
  assert.equal(result.attempts, 2);
  assert.match(requests[1].validationFeedback.join('; '), /supported claim requires evidencePassageIds/);
  assert.equal(result.value.unresolved.length, 0);
});

test('transport failures are never copied into trusted judge validation feedback', async () => {
  const requests = [];
  const evaluation = {
    evaluationId: 'evaluation-transport', question: 'Question?', answer: 'Supported answer.',
    answerManifest: [{ sentenceId: 'S1', text: 'Supported answer.', start: 0, end: 17 }],
    evidenceHash: 'evidence-hash',
    evidencePacket: { passages: [{ evidencePassageId: 'P1', eventId: 'E1', fieldPath: '/text', text: 'Supported answer.' }] },
  };
  const fetchImpl = async (_url, init) => {
    const body = JSON.parse(init.body);
    requests.push(JSON.parse(body.messages[0].parts[0].text));
    if (requests.length === 1) return new Response('upstream failed', { status: 503 });
    const report = {
      dimensionScores: { grounding: 10, completeness: 8, depth: 8, relevance: 9 },
      dimensionRationales: { grounding: 'Supported.', completeness: 'Complete.', depth: 'Detailed.', relevance: 'Relevant.' },
      sentenceAssessments: [{ sentenceId: 'S1', classification: 'factual', claims: [{
        claimText: 'Supported answer.',
        verdict: 'supported', materiality: 'material', centralToAnswer: true,
        evidencePassageIds: ['P1'], reason: 'The passage supports the claim.',
      }] }],
      summary: 'Review complete.',
    };
    return new Response(`data: ${JSON.stringify({ type: 'text-delta', delta: JSON.stringify(report) })}`, { status: 200 });
  };

  const result = await callRoleJudge('referee', 'agent', 'APP', 'key', evaluation, { fetchImpl });
  assert.equal(result.ok, true);
  assert.equal(result.attempts, 2);
  assert.equal(requests[1].validationFeedback, undefined);
});

test('comparison preserves one successful side when the other agent fails', async () => {
  const config = {
    flagship: { label: 'Flagship' }, production: { label: 'Production' },
    judges: { appId: 'APP', agents: { skeptic: 's', referee: 'r', advocate: 'a' } },
  };
  const callAgentImpl = async (agent) => {
    if (agent.label === 'Flagship') throw new Error('flagship transport failed');
    return { answer: 'Production answer', evidenceEvents: [{ output: { text: 'evidence' } }] };
  };
  const judgeAnswerImpl = async () => ({ status: 'final', composite: 8 });
  const result = await compareQuestion('q', config, { flagship: 'f', production: 'p', judge: 'j' }, { callAgentImpl, judgeAnswerImpl });
  assert.equal(result.flagship.verdict.status, 'unavailable');
  assert.match(result.flagship.verdict.error, /flagship transport failed/);
  assert.equal(result.production.answer, 'Production answer');
  assert.equal(result.production.verdict.composite, 8);
});

test('comparison preserves an answer when its judge panel fails', async () => {
  const config = {
    flagship: { label: 'Flagship' }, production: { label: 'Production' },
    judges: { appId: 'APP', agents: { skeptic: 's', referee: 'r', advocate: 'a' } },
  };
  const callAgentImpl = async (agent) => ({ answer: `${agent.label} answer`, evidenceEvents: [{ output: { text: 'evidence' } }] });
  const judgeAnswerImpl = async (_question, answer) => {
    if (answer.answer.startsWith('Production')) throw new Error('judge timeout');
    return { status: 'final', composite: 7 };
  };
  const result = await compareQuestion('q', config, { flagship: 'f', production: 'p', judge: 'j' }, { callAgentImpl, judgeAnswerImpl });
  assert.equal(result.flagship.verdict.composite, 7);
  assert.equal(result.production.answer, 'Production answer');
  assert.equal(result.production.verdict.status, 'unavailable');
  assert.match(result.production.verdict.error, /judge timeout/);
});

function judgeSet(prefix) {
  return { appId: 'APP', origin: 'https://example.test', agents: { skeptic: `${prefix}-s`, referee: `${prefix}-r`, advocate: `${prefix}-a` } };
}

function candidateManifestFixture(overrides = {}) {
  const systemPromptHash = LOCAL_CANDIDATE_PROMPT_HASHES.systemPrompt;
  const instructionHashes = { ...LOCAL_CANDIDATE_PROMPT_HASHES.instructions };
  const manifest = {
    schemaVersion: 1,
    runId: 'candidate-run',
    release: 'candidate-release',
    appId: 'APP',
    promptHashes: { systemPrompt: systemPromptHash, instructions: instructionHashes },
    agents: Object.fromEntries(['skeptic', 'referee', 'advocate'].map((role, index) => [role, {
      id: `candidate-${role}`,
      name: `Candidate ${role}`,
      status: 'published',
      model: 'gpt-5.4-mini',
      providerId: REQUIRED_CANDIDATE_PROVIDER_ID,
      toolCount: 0,
      systemPromptHash,
      instructionsHash: instructionHashes[role],
      configHash: String(index + 1).repeat(64),
      exactConfigHash: String(index + 4).repeat(64),
    }])),
  };
  return { ...manifest, ...overrides };
}

function successfulPanel(score, durationMs = 25) {
  const reports = ['skeptic', 'referee', 'advocate'].map((role) => ({
    ok: true,
    role,
    attempts: 1,
    durationMs,
    value: { role, dimensionScores: { grounding: score, completeness: score, depth: score, relevance: score }, unresolved: [], summary: `${role} summary` },
  }));
  return { ...core.aggregateJudgeReports(reports), reports };
}

function panelExecution(packet, variant, round, score, overrides = {}) {
  const panel = successfulPanel(score, overrides.roleDurationMs || 25);
  const { reports: _reports, ...verdict } = panel;
  return {
    executionId: `Q${packet.questionIndex + 1}:${variant}:R${round}`,
    questionIndex: packet.questionIndex,
    variant,
    round,
    packetHashes: { ...packet.hashes },
    durationMs: overrides.durationMs || 100,
    verdict: { ...verdict, ...(overrides.verdict || {}) },
    reports: overrides.reports || panel.reports,
  };
}

async function packetFixture(index = 0, question = `Question ${index}?`) {
  return createFrozenPacket(question, {
    answer: `Answer ${index}.`,
    evidenceEvents: [{ eventId: 'E1', toolCallId: 'search', toolName: 'search', callIndex: 0, input: { query: question }, output: { text: `Answer ${index}.` } }],
  }, index);
}

test('experiment defaults are four captures, four shards, twelve calls, and no timeout', async () => {
  const candidateManifest = await bindCandidateManifest(candidateManifestFixture());
  const settings = resolveExperimentSettings(
    { judges: { appId: 'APP', origin: 'https://example.test', agents: judgeSet('current').agents } },
    {},
    candidateManifest,
  );
  assert.equal(settings.captureConcurrency, 4);
  assert.equal(settings.workerCount, 4);
  assert.equal(settings.judgeConcurrency, 12);
  assert.equal(settings.transportTimeoutMs, null);
});

test('candidate manifest is mandatory and current IDs cannot be overridden by environment variables', async () => {
  const config = { judges: { appId: 'APP', agents: judgeSet('current').agents } };
  assert.throws(() => resolveExperimentSettings(config, {}), /schemaVersion 1/);
  const overlap = candidateManifestFixture();
  overlap.agents.skeptic.id = 'current-s';
  assert.throws(() => resolveExperimentSettings(config, {}, { ...overlap, manifestHash: 'f'.repeat(64) }), /isolated/);
  const candidateManifest = await bindCandidateManifest(candidateManifestFixture());
  const actual = resolveExperimentSettings(config, {
    ANSWER_CAPTURE_CONCURRENCY: '2', EXPERIMENT_WORKER_SHARDS: '5', JUDGE_CONCURRENCY: '99', EXPERIMENT_TRANSPORT_TIMEOUT_MS: '1234',
    CURRENT_JUDGE_SKEPTIC_AGENT_ID: 'wrong-current', CANDIDATE_JUDGE_SKEPTIC_AGENT_ID: 'wrong-candidate',
  }, candidateManifest);
  assert.equal(actual.captureConcurrency, 2);
  assert.equal(actual.workerCount, 4);
  assert.equal(actual.judgeConcurrency, 12);
  assert.equal(actual.transportTimeoutMs, 1234);
  assert.equal(actual.judgeSets.current.agents.skeptic, 'current-s');
  assert.equal(actual.judgeSets.candidate.agents.skeptic, 'candidate-skeptic');
  assert.equal(actual.judgeSets.candidate.deployment.agents.skeptic.model, 'gpt-5.4-mini');
});

test('candidate manifest rejects model, prompt, tool, and publication drift', async () => {
  const config = { judges: { appId: 'APP', agents: judgeSet('current').agents } };
  const wrongModel = candidateManifestFixture();
  wrongModel.agents.referee.model = 'gemini-flash';
  assert.throws(() => resolveExperimentSettings(config, {}, wrongModel), /gpt-5\.4-mini/);
  const wrongPrompt = candidateManifestFixture();
  wrongPrompt.agents.advocate.instructionsHash = 'e'.repeat(64);
  assert.throws(() => resolveExperimentSettings(config, {}, wrongPrompt), /instructions hash/);
  const withTool = candidateManifestFixture();
  withTool.agents.skeptic.toolCount = 1;
  assert.throws(() => resolveExperimentSettings(config, {}, withTool), /zero tools/);
  const draft = candidateManifestFixture();
  draft.agents.skeptic.status = 'draft';
  assert.throws(() => resolveExperimentSettings(config, {}, draft), /not published/);
  const wrongProvider = candidateManifestFixture();
  wrongProvider.agents.referee.providerId = 'different-provider';
  assert.throws(() => resolveExperimentSettings(config, {}, wrongProvider), new RegExp(REQUIRED_CANDIDATE_PROVIDER_ID));
  const locallyDrifted = candidateManifestFixture();
  locallyDrifted.promptHashes.systemPrompt = 'e'.repeat(64);
  for (const role of ['skeptic', 'referee', 'advocate']) locallyDrifted.agents[role].systemPromptHash = 'e'.repeat(64);
  await assert.rejects(bindCandidateManifest(locallyDrifted), /do not match the local candidate prompt files/);
  assert.throws(() => resolveExperimentSettings(config, {}, candidateManifestFixture()), /manifestHash/);
});

test('CLI parser requires the candidate manifest and enforces exactly four shards', () => {
  assert.deepEqual(parseCliArgs(['--phase', 'capture', '--output-dir', '/tmp/run']), { phase: 'capture', workerOutputs: [], outputDir: '/tmp/run' });
  assert.deepEqual(parseCliArgs(['--phase', 'worker', '--frozen-packets', '/tmp/frozen.json', '--candidate-manifest', '/tmp/candidate.json', '--shard-index', '2', '--shard-count', '4']), {
    phase: 'worker', workerOutputs: [], frozenPackets: '/tmp/frozen.json', candidateManifest: '/tmp/candidate.json', shardIndex: 2, shardCount: 4,
  });
  assert.deepEqual(parseCliArgs(['--phase', 'aggregate', '--candidate-manifest', '/tmp/candidate.json', '--worker-output', 'one.json', '--worker-output', 'two.json']), {
    phase: 'aggregate', workerOutputs: ['one.json', 'two.json'], candidateManifest: '/tmp/candidate.json',
  });
  assert.deepEqual(parseCliArgs(['--phase', 'repair-worker', '--candidate-manifest', '/tmp/candidate.json', '--worker-output', 'one.json']), {
    phase: 'repair-worker', workerOutputs: ['one.json'], candidateManifest: '/tmp/candidate.json',
  });
  assert.throws(() => parseCliArgs(['--phase', 'repair-worker', '--candidate-manifest', '/tmp/candidate.json']), /exactly one/);
  assert.throws(() => parseCliArgs(['--phase', 'worker', '--shard-index', '0']), /candidate-manifest/);
  assert.throws(() => parseCliArgs(['--phase', 'worker', '--candidate-manifest', '/tmp/candidate.json', '--shard-count', '5']), /exactly 4/);
  assert.throws(() => parseCliArgs(['--phase', 'unknown']), /Unknown phase/);
});

test('repair retries only failed judge roles and preserves the frozen panel identity', async () => {
  const packet = await packetFixture();
  const execution = panelExecution(packet, 'current', 1, 7);
  execution.reports[0] = { ok: false, role: 'skeptic', attempts: 2, durationMs: 10, errors: ['sentenceAssessments[0] has an unknown sentenceId'] };
  execution.verdict = core.aggregateJudgeReports(execution.reports);
  const calls = [];
  const repaired = await repairPanelExecution(packet, execution, judgeSet('current'), 'key', {
    callRoleJudgeImpl: async (role, agentId, appId, apiKey, evaluation, options) => {
      calls.push({ role, agentId, appId, apiKey, evaluationId: evaluation.evaluationId, feedback: options.initialValidationFeedback });
      const report = successfulPanel(8).reports.find((item) => item.role === role);
      return { ...report, attempts: 1, durationMs: 5 };
    },
  });
  assert.deepEqual(calls.map((call) => call.role), ['skeptic']);
  assert.deepEqual(calls[0].feedback, ['sentenceAssessments[0] has an unknown sentenceId']);
  assert.deepEqual(repaired.packetHashes, execution.packetHashes);
  assert.equal(repaired.reports.find((report) => report.role === 'skeptic').attempts, 3);
  assert.equal(repaired.verdict.validJudgeCount, 3);
  assert.deepEqual(repaired.repairHistory[0].repairedRoles, ['skeptic']);
  assert.deepEqual(repaired.repairHistory[0].persistentFailures, []);
  await assert.rejects(
    repairPanelExecution(packet, { ...repaired, reports: [{ ok: false, role: 'skeptic', attempts: 3, errors: ['again'] }, ...repaired.reports.slice(1)], verdict: core.aggregateJudgeReports([{ ok: false, role: 'skeptic', attempts: 3, errors: ['again'] }, ...repaired.reports.slice(1)]) }, judgeSet('current'), 'key'),
    /single allowed repair pass/,
  );
});

test('legacy parsing and transport failures are not treated as validator feedback during repair', async () => {
  const packet = await packetFixture();
  const execution = panelExecution(packet, 'current', 1, 7);
  execution.reports[0] = { ok: false, role: 'skeptic', attempts: 2, durationMs: 10, errors: ["Expected ',' or '}' after property value in JSON"] };
  execution.verdict = core.aggregateJudgeReports(execution.reports);
  let feedback;
  await repairPanelExecution(packet, execution, judgeSet('current'), 'key', {
    callRoleJudgeImpl: async (role, _agentId, _appId, _apiKey, _evaluation, options) => {
      feedback = options.initialValidationFeedback;
      const report = successfulPanel(8).reports.find((item) => item.role === role);
      return { ...report, attempts: 1, durationMs: 5 };
    },
  });
  assert.deepEqual(feedback, []);
});

test('repair does not call judges for a no-evidence unavailable panel', async () => {
  const packet = await createFrozenPacket('Question?', { answer: 'Answer.', evidenceEvents: [] }, 0);
  const message = 'The answer returned no usable retrieval evidence; semantic grounding cannot be evaluated.';
  const reports = ['skeptic', 'referee', 'advocate'].map((role) => ({ ok: false, role, attempts: 0, durationMs: 0, errors: [message] }));
  const execution = {
    executionId: 'Q1:current:R1', questionIndex: 0, variant: 'current', round: 1,
    packetHashes: { ...packet.hashes }, durationMs: 0,
    verdict: { status: 'unavailable', error: message }, reports,
  };
  let calls = 0;
  const repaired = await repairPanelExecution(packet, execution, judgeSet('current'), 'key', {
    callRoleJudgeImpl: async () => { calls += 1; },
  });
  assert.equal(calls, 0);
  assert.deepEqual(repaired, execution);
});

test('repair worker writes a separate audited output and leaves its source unchanged', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'judge-worker-repair-'));
  try {
    const packets = await Promise.all(Array.from({ length: 10 }, (_, index) => packetFixture(index)));
    const candidateManifest = await bindCandidateManifest(candidateManifestFixture());
    const config = { flagship: { keyEnv: 'FLAGSHIP_SEARCH_KEY' }, judges: { appId: 'APP', keyEnv: 'JUDGE_SEARCH_KEY', agents: judgeSet('current').agents } };
    const judgeSets = resolveExperimentSettings(config, {}, candidateManifest).judgeSets;
    const owned = packets.filter((packet) => packet.questionIndex % 4 === 0);
    const source = {
      workerId: 1, shardIndex: 0, shardCount: 4, judgeSets,
      questionIndexes: owned.map((packet) => packet.questionIndex),
      executions: owned.flatMap((packet) => PANEL_SPECS.map((spec) => panelExecution(packet, spec.variant, spec.round, 8))),
    };
    source.executions[0].reports[0] = { ok: false, role: 'skeptic', attempts: 2, durationMs: 10, errors: ['schema error'] };
    source.executions[0].verdict = core.aggregateJudgeReports(source.executions[0].reports);
    const original = structuredClone(source);
    let calls = 0;
    const result = await runRepairWorkerPhase({ outputDir: directory, frozenPackets: '/unused/frozen.json', candidateManifest: '/unused/candidate.json', workerOutputs: ['/unused/worker-1.json'] }, {
      packets, candidateManifest, workerOutput: source,
      inputs: { config, questions: Array(10).fill('q'), env: { FLAGSHIP_SEARCH_KEY: 'key', JUDGE_SEARCH_KEY: 'key' } },
      callRoleJudgeImpl: async (role) => {
        calls += 1;
        const report = successfulPanel(9).reports.find((item) => item.role === role);
        return { ...report, attempts: 1, durationMs: 5 };
      },
      acquireGlobalWorkerSlotsImpl: async () => async () => {},
    });
    assert.equal(calls, 1);
    assert.deepEqual(source, original);
    assert.equal(result.workerOutput.executions[0].verdict.validJudgeCount, 3);
    assert.match(result.workerOutput.repairedFrom.path, /worker-1\.json$/);
    assert.match(result.workerOutput.repairedFrom.hash, /^[a-f0-9]{64}$/);
    assert.deepEqual(await readdir(directory), ['worker-1-repaired.json']);
    assert.equal((await stat(join(directory, 'worker-1-repaired.json'))).mode & 0o777, 0o600);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('legacy runner remains a separate CLI and retains --rejudge validation', async () => {
  await assert.rejects(runLegacyCli(['--rejudge']), /requires a results\.json path/);
  await assert.rejects(runLegacyCli(['--phase']), /Unknown argument: --phase/);
});

test('answer capture runs at concurrency four and freezes each answer exactly once', async () => {
  let active = 0;
  let maximum = 0;
  let calls = 0;
  const questions = Array.from({ length: 10 }, (_, index) => `Question ${index}?`);
  const packets = await captureFrozenPackets(questions, { label: 'Flagship' }, 'key', {
    captureConcurrency: 4,
    callAgentImpl: async (_agent, _key, question) => {
      calls += 1;
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 3));
      active -= 1;
      return { answer: `${question} answer`, evidenceEvents: [{ output: { text: `${question} evidence` } }] };
    },
  });
  assert.equal(calls, 10);
  assert.equal(maximum, 4);
  assert.equal(packets.length, 10);
  await Promise.all(packets.map(verifyFrozenPacket));
  assert.equal(new Set(packets.map((packet) => packet.hashes.evaluation)).size, 10);
});

test('frozen packet verification rejects answer, evidence, manifest, and hash tampering', async () => {
  const packet = await packetFixture();
  const answerTamper = JSON.parse(JSON.stringify(packet));
  answerTamper.answer = 'Changed answer.';
  await assert.rejects(verifyFrozenPacket(answerTamper), /answer hash verification/);
  const evidenceTamper = JSON.parse(JSON.stringify(packet));
  evidenceTamper.evidenceEvents[0].output.text = 'Changed evidence.';
  await assert.rejects(verifyFrozenPacket(evidenceTamper), /evidence hash verification/);
  const manifestTamper = JSON.parse(JSON.stringify(packet));
  manifestTamper.evaluation.answerManifest[0].text = 'Changed manifest.';
  await assert.rejects(verifyFrozenPacket(manifestTamper), /evaluation package changed/);
  const hashTamper = JSON.parse(JSON.stringify(packet));
  hashTamper.hashes.evaluation = 'wrong';
  await assert.rejects(verifyFrozenPacket(hashTamper), /evaluation hash verification/);
});

test('four deterministic shards own 3, 3, 2, and 2 of ten packets', async () => {
  const packets = await Promise.all(Array.from({ length: 10 }, (_, index) => packetFixture(index)));
  const shards = createWorkerShards(packets, 4);
  assert.deepEqual(shards.map((shard) => shard.packets.map((packet) => packet.questionIndex)), [[0, 4, 8], [1, 5, 9], [2, 6], [3, 7]]);
  assert.deepEqual(selectWorkerShard(packets, 1, 4).packets.map((packet) => packet.questionIndex), [1, 5, 9]);
  assert.throws(() => selectWorkerShard(packets, 4, 4), /0 through 3/);
  assert.throws(() => createWorkerShards(packets, 5), /exactly 4 shards/);
  assert.throws(() => selectWorkerShard(packets, 0, 5), /exactly 4 shards/);
});

test('a worker runs four panels sequentially in the approved order', async () => {
  const packet = await packetFixture();
  let activePanels = 0;
  let maximumPanels = 0;
  const calls = [];
  const output = await runWorkerShard({ workerId: 1, shardIndex: 0, shardCount: 4, packets: [packet] }, {
    judgeSets: { current: judgeSet('current'), candidate: judgeSet('candidate') },
    apiKeys: { current: 'key', candidate: 'key' },
    judgeLimiter: createLimiter(3),
    judgeEvaluationImpl: async (_evaluation, judges) => {
      activePanels += 1;
      maximumPanels = Math.max(maximumPanels, activePanels);
      calls.push(judges.agents.skeptic.startsWith('current') ? 'current' : 'candidate');
      await new Promise((resolve) => setTimeout(resolve, 2));
      activePanels -= 1;
      return successfulPanel(8);
    },
  });
  assert.equal(maximumPanels, 1);
  assert.deepEqual(output.executions.map((execution) => `${execution.variant}:${execution.round}`), ['current:1', 'current:2', 'candidate:1', 'candidate:2']);
  assert.deepEqual(calls, ['current', 'current', 'candidate', 'candidate']);
});

test('the three roles in one panel are dispatched in parallel under a limit of three', async () => {
  const packet = await packetFixture();
  let active = 0;
  let maximum = 0;
  const sentenceId = packet.evaluation.answerManifest[0].sentenceId;
  const passageId = packet.evaluation.evidencePacket.passages[0].evidencePassageId;
  const fetchImpl = async () => {
    active += 1;
    maximum = Math.max(maximum, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
    const report = {
      dimensionScores: { grounding: 10, completeness: 10, depth: 10, relevance: 10 },
      dimensionRationales: { grounding: 'Supported.', completeness: 'Complete.', depth: 'Deep.', relevance: 'Relevant.' },
      sentenceAssessments: [{ sentenceId, classification: 'factual', claims: [{ claimText: packet.answer, verdict: 'supported', materiality: 'material', centralToAnswer: true, evidencePassageIds: [passageId], reason: 'Supported.' }] }],
      summary: 'Complete.',
    };
    return new Response(`data: ${JSON.stringify({ type: 'text-delta', delta: JSON.stringify(report) })}`, { status: 200 });
  };
  const verdict = await judgeEvaluation(packet.evaluation, judgeSet('current'), 'key', { fetchImpl, judgeLimiter: createLimiter(3), timeoutMs: null });
  assert.equal(maximum, 3);
  assert.equal(verdict.reports.length, 3);
  assert.equal(verdict.validJudgeCount, 3);
});

test('disabled transport timeout supplies no abort signal while explicit timeout remains covered', async () => {
  let signal;
  const result = await callAgent({ appId: 'APP', agentId: 'AGENT', label: 'Test' }, 'key', 'q', {
    timeoutMs: null,
    fetchImpl: async (_url, init) => {
      signal = init.signal;
      return new Response(`data: ${JSON.stringify({ type: 'text-delta', delta: 'Answer.' })}`, { status: 200 });
    },
  });
  assert.equal(signal, undefined);
  assert.equal(result.answer, 'Answer.');
});

test('merge verifies four panels per question and computes averages and deltas mechanically', async () => {
  const packets = await Promise.all([packetFixture(0), packetFixture(1)]);
  const executions = packets.flatMap((packet) => [
    panelExecution(packet, 'current', 1, 6), panelExecution(packet, 'current', 2, 8),
    panelExecution(packet, 'candidate', 1, 8), panelExecution(packet, 'candidate', 2, 10),
  ]);
  const merged = await mergeWorkerOutputs(packets, [{ executions }], { expectedQuestionCount: 2 });
  assert.equal(merged.panelExecutionCount, 8);
  assert.equal(merged.rows[0].current.matched.composite, 7);
  assert.equal(merged.rows[0].candidate.matched.composite, 9);
  assert.equal(merged.rows[0].primaryDelta.composite, 2);
  assert.equal(merged.summary.primary.current.composite, 7);
  assert.equal(merged.summary.primary.delta.dimensions.grounding, 2);
  assert.deepEqual(merged.summary.primary.current.groundingStatuses, { grounded: 4 });
  assert.deepEqual(merged.summary.primary.scoreCoverage, { scored: 4, expected: 4 });
});

test('headline comparison uses only complete same-round pairs and separates provisional fallback scores', async () => {
  const packet = await packetFixture();
  const currentRound2 = panelExecution(packet, 'current', 2, 1);
  currentRound2.verdict.validJudgeCount = 2;
  currentRound2.verdict.provisional = true;
  currentRound2.verdict.status = 'provisional';
  currentRound2.reports[0] = { ok: false, role: 'skeptic', attempts: 2, durationMs: 50, errors: ['invalid report'] };
  currentRound2.verdict = core.aggregateJudgeReports(currentRound2.reports);
  const executions = [
    panelExecution(packet, 'current', 1, 6), currentRound2,
    panelExecution(packet, 'candidate', 1, 8), panelExecution(packet, 'candidate', 2, 10),
  ];
  const merged = await mergeWorkerOutputs([packet], [{ executions }], { expectedQuestionCount: 1 });
  assert.deepEqual(merged.rows[0].matchedRoundNumbers, [1]);
  assert.equal(merged.rows[0].primaryDelta.composite, 2);
  assert.equal(merged.summary.primary.current.composite, 6);
  assert.equal(merged.summary.primary.candidate.composite, 8);
  assert.deepEqual(merged.summary.primary.scoreCoverage, { scored: 1, expected: 2 });
  assert.equal(merged.summary.operationalFallback.current.composite, 3.5);
  assert.equal(merged.summary.operationalFallback.candidate.composite, 9);
  const html = renderExperimentHtml(merged);
  assert.match(html, /1 matched round scored/);
  assert.doesNotMatch(html, /Average of 2 complete matched rounds/);
  assert.match(html, /Operational fallback, not headline/);
});

test('persistent role failures remain failures and are never converted to zero scores', async () => {
  const failedReports = ['skeptic', 'referee', 'advocate'].map((role) => ({ ok: false, role, attempts: 2, durationMs: 50, errors: ['transport failed'] }));
  const executions = [1, 2].map((round) => ({
    executionId: `Q1:current:R${round}`, questionIndex: 0, variant: 'current', round, packetHashes: {}, durationMs: 50,
    verdict: { status: 'unavailable', composite: null, dims: null, validJudgeCount: 0, groundingStatus: 'unavailable' }, reports: failedReports,
  }));
  const average = averageVariantExecutions(executions);
  assert.equal(average.composite, null);
  assert.equal(average.scoredPanels, 0);
  assert.equal(average.expectedPanels, 2);
  assert.equal(average.roles.skeptic.score, null);
  assert.equal(average.unavailablePanels, 2);
  assert.equal(average.totalRetries, 6);
  assert.equal(average.roles.skeptic.failures.length, 2);
});

test('latency metrics exclude panels and roles where no judge call occurred', async () => {
  const packet = await packetFixture();
  const called = panelExecution(packet, 'current', 1, 8, { durationMs: 120, roleDurationMs: 80 });
  const noCall = {
    executionId: 'Q1:current:R2', questionIndex: 0, variant: 'current', round: 2,
    packetHashes: { ...packet.hashes }, durationMs: 0,
    verdict: { status: 'unavailable', composite: null, validJudgeCount: 0, provisional: false },
    reports: ['skeptic', 'referee', 'advocate'].map((role) => ({ ok: false, role, attempts: 0, durationMs: 0, errors: ['No retrieval evidence'] })),
  };
  const average = averageVariantExecutions([called, noCall]);
  assert.equal(average.averagePanelLatencyMs, 120);
  assert.equal(average.panelLatencyCount, 1);
  assert.equal(average.roles.skeptic.averageLatencyMs, 80);
  assert.equal(average.roles.skeptic.latencyCount, 1);
});

test('merge rejects missing, duplicate, cross-packet, and incomplete role executions', async () => {
  const packet = await packetFixture();
  const complete = PANEL_SPECS.map((spec) => panelExecution(packet, spec.variant, spec.round, 8));
  await assert.rejects(mergeWorkerOutputs([packet], [{ executions: complete.slice(0, 3) }], { expectedQuestionCount: 1 }), /exactly 4/);
  await assert.rejects(mergeWorkerOutputs([packet], [{ executions: [complete[0], complete[0], complete[2], complete[3]] }], { expectedQuestionCount: 1 }), /Duplicate panel execution ID/);
  const duplicateSpec = structuredClone(complete);
  duplicateSpec[1].variant = 'current';
  duplicateSpec[1].round = 1;
  duplicateSpec[1].executionId = 'Q1:current:R1:duplicate';
  await assert.rejects(mergeWorkerOutputs([packet], [{ executions: duplicateSpec }], { expectedQuestionCount: 1 }), /must contain exactly current:1/);
  const wrongHash = structuredClone(complete);
  wrongHash[0].packetHashes.answer = 'wrong';
  await assert.rejects(mergeWorkerOutputs([packet], [{ executions: wrongHash }], { expectedQuestionCount: 1 }), /different frozen packet/);
  const missingRole = structuredClone(complete);
  missingRole[0].reports.pop();
  await assert.rejects(mergeWorkerOutputs([packet], [{ executions: missingRole }], { expectedQuestionCount: 1 }), /three role reports/);
});

test('aggregation rejects persisted verdict score, status, dimension, cap, and claim tampering', async () => {
  const packet = await packetFixture();
  const baseline = PANEL_SPECS.map((spec) => panelExecution(packet, spec.variant, spec.round, 8));
  const mutations = [
    ['composite', (execution) => { execution.verdict.composite = 2; }],
    ['status', (execution) => { execution.verdict.status = 'provisional'; }],
    ['dims', (execution) => { execution.verdict.dims.grounding = 1; }],
    ['appliedCap', (execution) => { execution.verdict.appliedCap = 3; }],
    ['flaggedClaims', (execution) => { execution.verdict.flaggedClaims = [{ claim: 'tampered', cap: 3 }]; }],
  ];
  for (const [field, mutate] of mutations) {
    const executions = structuredClone(baseline);
    mutate(executions[0]);
    await assert.rejects(
      mergeWorkerOutputs([packet], [{ executions }], { expectedQuestionCount: 1 }),
      new RegExp(`deterministic role-report aggregation.*${field}`),
    );
  }
});

test('no-call evidence-unavailable panels require strict unavailable and no-score verdicts', async () => {
  const packet = await createFrozenPacket('Question?', { answer: 'Answer.', evidenceEvents: [] }, 0);
  const noCallExecution = (spec) => ({
    executionId: `Q1:${spec.variant}:R${spec.round}`,
    questionIndex: 0,
    variant: spec.variant,
    round: spec.round,
    packetHashes: { ...packet.hashes },
    durationMs: 0,
    verdict: { status: 'unavailable', error: 'The answer returned no usable retrieval evidence; semantic grounding cannot be evaluated.' },
    reports: ['skeptic', 'referee', 'advocate'].map((role) => ({ ok: false, role, attempts: 0, durationMs: 0, errors: ['No retrieval evidence'] })),
  });
  const valid = PANEL_SPECS.map(noCallExecution);
  const merged = await mergeWorkerOutputs([packet], [{ executions: valid }], { expectedQuestionCount: 1 });
  assert.equal(merged.summary.primary.matchedRoundPairs, 0);
  const scored = structuredClone(valid);
  scored[0].verdict.composite = 3;
  await assert.rejects(mergeWorkerOutputs([packet], [{ executions: scored }], { expectedQuestionCount: 1 }), /strictly unavailable with no score/);
  const wrongReason = structuredClone(valid);
  wrongReason[0].verdict.error = 'Unavailable for an unspecified reason.';
  await assert.rejects(mergeWorkerOutputs([packet], [{ executions: wrongReason }], { expectedQuestionCount: 1 }), /wrong unavailable reason/);
});

test('worker coverage rejects missing shards and cross-owned questions', async () => {
  const packets = await Promise.all(Array.from({ length: 4 }, (_, index) => packetFixture(index)));
  const judgeSets = { current: judgeSet('current'), candidate: judgeSet('candidate') };
  const outputs = Array.from({ length: 4 }, (_, shardIndex) => ({ workerId: shardIndex + 1, shardIndex, shardCount: 4, questionIndexes: [shardIndex], judgeSets, executions: [] }));
  assert.equal(verifyWorkerCoverage(packets, outputs, judgeSets), true);
  assert.throws(() => verifyWorkerCoverage(packets, outputs.slice(0, 3), judgeSets), /Expected 4/);
  const crossed = structuredClone(outputs);
  crossed[0].questionIndexes = [1];
  assert.throws(() => verifyWorkerCoverage(packets, crossed, judgeSets), /outside its deterministic shard/);
  const mixedJudges = structuredClone(outputs);
  mixedJudges[3].judgeSets = structuredClone(mixedJudges[3].judgeSets);
  mixedJudges[3].judgeSets.candidate.agents.advocate = 'different-agent';
  assert.throws(() => verifyWorkerCoverage(packets, mixedJudges, judgeSets), /different judge sets/);
  const wrongManifestBinding = structuredClone(judgeSets);
  wrongManifestBinding.candidate.agents.skeptic = 'other-candidate';
  assert.throws(() => verifyWorkerCoverage(packets, outputs, wrongManifestBinding), /not bound/);
});

test('worker phase writes only its own worker output', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'judge-worker-'));
  try {
    const packets = await Promise.all(Array.from({ length: 10 }, (_, index) => packetFixture(index)));
    const config = { flagship: { keyEnv: 'FLAGSHIP_SEARCH_KEY' }, judges: { appId: 'APP', keyEnv: 'JUDGE_SEARCH_KEY', agents: judgeSet('current').agents } };
    const env = { FLAGSHIP_SEARCH_KEY: 'key', JUDGE_SEARCH_KEY: 'key' };
    const candidateManifest = await bindCandidateManifest(candidateManifestFixture());
    let semaphoreReleased = false;
    await runWorkerPhase({ outputDir: directory, shardIndex: 2, shardCount: 4 }, {
      inputs: { config, questions: Array(10).fill('q'), env }, packets, candidateManifest,
      judgeEvaluationImpl: async () => successfulPanel(8),
      acquireGlobalWorkerSlotsImpl: async () => async () => { semaphoreReleased = true; },
    });
    assert.deepEqual(await readdir(directory), ['worker-3.json']);
    assert.equal((await stat(directory)).mode & 0o777, 0o700);
    assert.equal((await stat(join(directory, 'worker-3.json'))).mode & 0o777, 0o600);
    const worker = JSON.parse(await readFile(join(directory, 'worker-3.json'), 'utf8'));
    assert.equal(worker.judgeSets.candidate.deployment.manifestHash, candidateManifest.manifestHash);
    assert.equal(semaphoreReleased, true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('worker phase releases its global semaphore slot when execution fails', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'judge-worker-failure-'));
  try {
    const packets = await Promise.all(Array.from({ length: 10 }, (_, index) => packetFixture(index)));
    const config = { flagship: { keyEnv: 'FLAGSHIP_SEARCH_KEY' }, judges: { appId: 'APP', keyEnv: 'JUDGE_SEARCH_KEY', agents: judgeSet('current').agents } };
    const candidateManifest = await bindCandidateManifest(candidateManifestFixture());
    let released = false;
    await assert.rejects(runWorkerPhase({ outputDir: directory, shardIndex: 0, shardCount: 4 }, {
      inputs: { config, questions: Array(10).fill('q'), env: { FLAGSHIP_SEARCH_KEY: 'key', JUDGE_SEARCH_KEY: 'key' } },
      packets,
      candidateManifest,
      acquireGlobalWorkerSlotsImpl: async () => async () => { released = true; },
      onProgress: () => { throw new Error('forced worker failure'); },
    }), /forced worker failure/);
    assert.equal(released, true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('capture phase writes frozen raw evidence with private directory and file modes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'judge-capture-'));
  try {
    const questions = Array.from({ length: 10 }, (_, index) => `Question ${index}?`);
    const config = { flagship: { keyEnv: 'FLAGSHIP_SEARCH_KEY', label: 'Flagship' } };
    await runCapturePhase({ outputDir: directory }, {
      inputs: { config, questions, env: { FLAGSHIP_SEARCH_KEY: 'key' } },
      callAgentImpl: async (_agent, _key, question) => ({ answer: `${question} answer`, evidenceEvents: [{ output: { text: `${question} evidence` } }] }),
    });
    assert.equal((await stat(directory)).mode & 0o777, 0o700);
    assert.equal((await stat(join(directory, 'frozen-packets.json'))).mode & 0o777, 0o600);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('experiment HTML escapes frozen answer text and labels a real two-run matched average', async () => {
  const packet = await packetFixture(0, '<Question>');
  const executions = [
    panelExecution(packet, 'current', 1, 6), panelExecution(packet, 'current', 2, 8),
    panelExecution(packet, 'candidate', 1, 8), panelExecution(packet, 'candidate', 2, 10),
  ];
  const merged = await mergeWorkerOutputs([packet], [{ executions }], { expectedQuestionCount: 1 });
  merged.rows[0].answer = '<script>alert(1)</script>';
  const html = renderExperimentHtml(merged);
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;script&gt;alert/);
  assert.equal((html.match(/Average of 2 complete matched rounds/g) || []).length, 2);
  assert.match(html, /2\/2 complete matched round pairs/);
});

test('aggregate phase writes deterministic merged JSON and HTML only after four-shard verification', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'judge-aggregate-'));
  try {
    const packets = await Promise.all(Array.from({ length: 10 }, (_, index) => packetFixture(index)));
    const config = { judges: { appId: 'APP', origin: 'https://example.test', agents: judgeSet('current').agents } };
    const candidateManifest = await bindCandidateManifest(candidateManifestFixture());
    const judgeSets = resolveExperimentSettings(config, {}, candidateManifest).judgeSets;
    const workerOutputs = Array.from({ length: 4 }, (_, shardIndex) => {
      const owned = packets.filter((packet) => packet.questionIndex % 4 === shardIndex);
      return {
        workerId: shardIndex + 1, shardIndex, shardCount: 4, judgeSets,
        questionIndexes: owned.map((packet) => packet.questionIndex),
        executions: owned.flatMap((packet) => PANEL_SPECS.map((spec) => panelExecution(packet, spec.variant, spec.round, spec.variant === 'current' ? 7 : 8))),
      };
    });
    const result = await runAggregatePhase({ outputDir: directory, shardCount: 4 }, {
      packets, workerOutputs, candidateManifest, inputs: { config, questions: Array(10).fill('q'), env: {} },
    });
    assert.equal(result.merged.questionCount, 10);
    assert.equal(result.merged.panelExecutionCount, 40);
    assert.deepEqual(result.merged.judgeSets, judgeSets);
    assert.equal(result.merged.workerInputs.length, 4);
    assert.equal(result.merged.workerInputs.every((input) => /^[a-f0-9]{64}$/.test(input.hash)), true);
    assert.deepEqual((await readdir(directory)).sort(), ['merged-results.json', 'report.html']);
    assert.equal((await stat(directory)).mode & 0o777, 0o700);
    assert.equal((await stat(join(directory, 'merged-results.json'))).mode & 0o777, 0o600);
    assert.equal((await stat(join(directory, 'report.html'))).mode & 0o777, 0o600);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('aggregate discovery rejects ambiguous original and repaired worker files', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'judge-aggregate-ambiguous-'));
  try {
    await writeFile(join(directory, 'worker-1.json'), '{}\n');
    await writeFile(join(directory, 'worker-1-repaired.json'), '{}\n');
    const packets = await Promise.all(Array.from({ length: 10 }, (_, index) => packetFixture(index)));
    const config = { judges: { appId: 'APP', origin: 'https://example.test', agents: judgeSet('current').agents } };
    const candidateManifest = await bindCandidateManifest(candidateManifestFixture());
    await assert.rejects(runAggregatePhase({ outputDir: directory }, {
      packets, candidateManifest, inputs: { config, questions: Array(10).fill('q'), env: {} },
    }), /Multiple outputs found for worker 1/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
