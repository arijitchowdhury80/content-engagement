import test from 'node:test';
import assert from 'node:assert/strict';

import { classifyCompletionFanout, classifyTerminalError, completionAgentId, completionTraffic, prohibitedRequest, turnObservation } from '../src/hosted/phase0-smoke.mjs';
import { evaluateMechanicalTurn } from '../src/oracle/mechanical.mjs';

function request(url, appId) {
  return { url: () => url, headers: () => appId ? { 'x-algolia-application-id': appId } : {} };
}

test('production guard blocks only the Production Ask app, not ordinary Algolia site assets', () => {
  assert.equal(prohibitedRequest(request('https://algolia.com/assets/logo.svg')), false);
  assert.equal(prohibitedRequest(request('https://dashboard.algolia.com/static/current_user')), false);
  assert.equal(prohibitedRequest(request('https://1qdawl72tq.algolia.net/agent-studio/1/agents/id/completions')), true);
  assert.equal(prohibitedRequest(request('https://example.algolia.net/agent-studio/1/agents/id/completions', '1QDAWL72TQ')), true);
  assert.equal(prohibitedRequest(request('https://0exrpaxb56.algolia.net/agent-studio/1/agents/id/completions', '0EXRPAXB56')), false);
});

test('completion traffic separates client-tool continuation steps from retries', () => {
  const traffic = completionTraffic([
    { bodyHash: 'step-1', responseStatus: 200 },
    { bodyHash: 'step-2', responseStatus: 200 },
  ]);
  assert.deepEqual(traffic, {
    physicalCompletionRequests: 2,
    completionSteps: 2,
    responseStatuses: [200, 200],
    retryAttempts: 0,
    permittedRetryAttempts: 0,
    unsafeRetry: false,
  });
});

test('completion fan-out classifies judges separately from specialists and unknown work', () => {
  const completionUrl = (agentId) => `https://app.algolia.net/agent-studio/1/agents/${agentId}/completions?compatibilityMode=ai-sdk-5`;
  assert.equal(completionAgentId(completionUrl('primary')), 'primary');
  assert.equal(completionAgentId('https://example.com/not-a-completion'), null);
  assert.deepEqual(classifyCompletionFanout([
    { url: completionUrl('primary') },
    { url: completionUrl('judge-a') },
    { url: completionUrl('judge-b') },
    { url: completionUrl('specialist-a') },
    { url: completionUrl('unrecognized') },
  ], {
    primaryAgentId: 'primary',
    judgeAgentIds: ['judge-a', 'judge-b'],
    specialistAgentIds: ['specialist-a'],
  }), { primary: 1, judge: 2, specialist: 1, unknown: 1 });
});

test('completion traffic exposes duplicate unsafe requests as retries', () => {
  const traffic = completionTraffic([
    { bodyHash: 'same-step', responseStatus: 200 },
    { bodyHash: 'same-step', responseStatus: 200 },
  ]);
  assert.equal(traffic.completionSteps, 1);
  assert.equal(traffic.retryAttempts, 1);
  assert.equal(traffic.permittedRetryAttempts, 0);
  assert.equal(traffic.unsafeRetry, true);
});

test('completion traffic permits one retry only after an explicit retryable pre-stream status', () => {
  const traffic = completionTraffic([
    { bodyHash: 'same-step', responseStatus: 429 },
    { bodyHash: 'same-step', responseStatus: 200 },
  ]);
  assert.equal(traffic.retryAttempts, 1);
  assert.equal(traffic.permittedRetryAttempts, 1);
  assert.equal(traffic.unsafeRetry, false);
});

test('terminal errors preserve a bounded diagnostic category and status', () => {
  assert.deepEqual(
    classifyTerminalError('Agent Studio error 429: rate limit exceeded', [429]),
    { category: 'rate-limited', status: 429 },
  );
  assert.deepEqual(
    classifyTerminalError('Guardrail violation', [200]),
    { category: 'guardrail', status: null },
  );
  assert.deepEqual(
    classifyTerminalError(null, [200]),
    { category: null, status: null },
  );
});

test('turn observations retain the classified terminal failure without raw response data', () => {
  const observation = turnObservation({
    turn: { query: 'q', segments: [{ status: 'error', text: '', error: 'Agent Studio error 429: TOO_MANY_REQUESTS' }] },
    query: 'q',
    traffic: completionTraffic([{ bodyHash: 'step-1', responseStatus: 429 }]),
    pageCrashed: false,
  });
  assert.equal(observation.errorCategory, 'rate-limited');
  assert.equal(observation.responseStatus, 429);
  assert.equal('error' in observation, false);
});

test('phase 0 turn observation admits one bounded nonblank completion step', () => {
  const observation = turnObservation({
    turn: { query: 'question', segments: [{ status: 'success', text: 'answer' }] },
    query: 'question',
    traffic: completionTraffic([{ bodyHash: 'step-1', responseStatus: 200 }]),
    backgroundCompletionAttempts: 0,
    pageCrashed: false,
  });
  assert.equal(observation.userMessageCount, 1);
  assert.equal(observation.unsafeRetry, false);
  assert.equal(observation.completionSteps, 1);
  assert.equal(observation.physicalCompletionRequests, 1);
  assert.equal(observation.backgroundCompletionAttempts, 0);
});

test('phase 0 turn observation exposes unexpected inline completion fan-out', () => {
  const observation = turnObservation({
    turn: { query: 'question', segments: [{ status: 'success', text: 'answer' }] },
    query: 'question',
    traffic: completionTraffic([{ bodyHash: 'step-1', responseStatus: 200 }]),
    backgroundCompletionAttempts: 3,
    pageCrashed: false,
  });
  assert.equal(observation.backgroundCompletionAttempts, 3);
});

test('phase 0 turn observation exposes duplicate attempts and blank success', () => {
  const observation = turnObservation({
    turn: { query: 'question', segments: [{ status: 'success', text: '' }] },
    query: 'question',
    traffic: completionTraffic([
      { bodyHash: 'same-step', responseStatus: 200 },
      { bodyHash: 'same-step', responseStatus: 200 },
    ]),
    pageCrashed: false,
  });
  assert.equal(observation.unsafeRetry, true);
  assert.equal(observation.physicalCompletionRequests, 2);
  assert.equal(observation.completionSteps, 1);
  assert.equal(observation.retryAttempts, 1);
  assert.equal(observation.answerText, '');
});

test('phase 0 turn observation classifies a still-streaming deadline as unbounded', () => {
  const observation = turnObservation({
    turn: { query: 'question', segments: [{ status: 'streaming', text: '' }] },
    query: 'question',
    traffic: completionTraffic([{ bodyHash: 'step-1', responseStatus: 200 }]),
    backgroundCompletionAttempts: 0,
    pageCrashed: false,
  });
  assert.equal(observation.terminalState, 'streaming');
  assert.equal(observation.answerText, '');
  assert.deepEqual(evaluateMechanicalTurn(observation).failures, ['unbounded']);
});
