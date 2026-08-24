import test from 'node:test';
import assert from 'node:assert/strict';
import { applyJudgeAgentOverrides, callAgent, callRoleJudge, compareQuestion, createLimiter, judgeAnswer, mapLimit, parseAgentStream, renderHtml, strictJson, summarize } from './runner.mjs';

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
