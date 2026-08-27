import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assertRequest,
  assertTarget,
  classifyPromptState,
} from './update_judge_shared_system_prompt.mjs';

const ids = new Set(['skeptic-id', 'referee-id', 'advocate-id']);
const contract = {
  lock: {
    provider: { id: 'openai-provider', model: 'gpt-5.4-mini' },
    agents: { skeptic: 'skeptic-id', referee: 'referee-id', advocate: 'advocate-id' },
  },
  instructions: { skeptic: 'skeptic lens', referee: 'referee lens', advocate: 'advocate lens' },
};

function agent(role = 'skeptic', overrides = {}) {
  return {
    id: `${role}-id`,
    name: `${role} judge`,
    status: 'published',
    model: 'gpt-5.4-mini',
    providerId: 'openai-provider',
    instructions: `${role} lens`,
    systemPrompt: 'before prompt',
    tools: [],
    config: { enableAlgoliaMcp: false },
    ...overrides,
  };
}

test('the updater accepts only systemPrompt PATCHes to the three locked IDs', () => {
  assert.equal(assertRequest('GET', '/agents?limit=100', undefined, ids), true);
  assert.equal(assertRequest('GET', '/agents/skeptic-id', undefined, ids), true);
  assert.equal(assertRequest('PATCH', '/agents/skeptic-id', { systemPrompt: 'approved prompt' }, ids), true);
  assert.throws(() => assertRequest('POST', '/agents', {}, ids), /not an approved in-place judge PATCH/);
  assert.throws(() => assertRequest('DELETE', '/agents/skeptic-id', undefined, ids), /not an approved/);
  assert.throws(() => assertRequest('PATCH', '/agents/unknown', { systemPrompt: 'x' }, ids), /not an approved/);
  assert.throws(() => assertRequest('PATCH', '/agents/skeptic-id', { systemPrompt: 'x', instructions: 'changed' }, ids), /only systemPrompt/);
});

test('target validation locks identity, provider, model, tools, and role instructions', () => {
  assert.equal(assertTarget('skeptic', agent(), contract), true);
  assert.throws(() => assertTarget('skeptic', agent('skeptic', { id: 'other' }), contract), /identity mismatch/);
  assert.throws(() => assertTarget('skeptic', agent('skeptic', { instructions: 'changed' }), contract), /instructions drifted/);
  assert.throws(() => assertTarget('skeptic', agent('skeptic', { tools: [{}] }), contract), /has tools/);
  assert.throws(() => assertTarget('skeptic', agent('skeptic', { model: 'other' }), contract), /provider or model drifted/);
});

test('prompt classification accepts only before or intended prompt with protected fields unchanged', () => {
  const before = agent();
  assert.equal(classifyPromptState(before, 'after prompt', before).state, 'before');
  assert.equal(classifyPromptState(before, 'after prompt', { ...before, systemPrompt: 'after prompt' }).state, 'intended');
  assert.equal(classifyPromptState(before, 'after prompt', { ...before, instructions: 'changed', systemPrompt: 'after prompt' }).state, 'drift');
});
