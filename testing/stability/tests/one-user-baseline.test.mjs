import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';

import { createRunId, isSafeSyntheticId } from '../src/config/run-ids.mjs';
import { oneUserContextId, selectCampaign, selectCampaignSequence, specialistRouteSatisfied } from '../src/hosted/one-user-baseline.mjs';

const dataset = {
  primaryPersonas: [{ id: 'U5', role: 'Junior developer' }],
  campaigns: [
    { id: 'U5-C1', personaId: 'U5', questions: Array(6).fill('q') },
    { id: 'U5-C2', personaId: 'U5', questions: Array(6).fill('q') },
  ],
};

test('one-user baseline selects the exact frozen campaign and persona', () => {
  const selected = selectCampaign(dataset, 'U5-C1');
  assert.equal(selected.campaign.id, 'U5-C1');
  assert.equal(selected.persona.id, 'U5');
});

test('one-user baseline rejects an unknown campaign', () => {
  assert.throws(() => selectCampaign(dataset, 'U1-C1'), /Unknown frozen campaign/);
});

test('one-user baseline derives a safe context ID from a numeric ordinal', () => {
  assert.equal(isSafeSyntheticId(oneUserContextId(createRunId(), randomBytes(32))), true);
});

test('one-user sequence permits C1 followed by C2 for the same persona', () => {
  assert.deepEqual(selectCampaignSequence(dataset, ['U5-C1', 'U5-C2']).map(({ campaign }) => campaign.id), ['U5-C1', 'U5-C2']);
  assert.throws(() => selectCampaignSequence(dataset, ['U5-C2']), /must be C1/);
});

test('specialist route accepts both additive depth and explicit evidence demotion', () => {
  const base = { requested: true, consentActions: ['accept'], backgroundCompletionAttempts: 1 };
  assert.equal(specialistRouteSatisfied({ ...base, turn: { segments: [{}, {}] } }), true);
  assert.equal(specialistRouteSatisfied({
    ...base,
    turn: { segments: [{}], deepDiveSpecialist: 'tech', specialistLimitation: { agent: 'tech' } },
  }), true);
  assert.equal(specialistRouteSatisfied({ ...base, turn: { segments: [{}] } }), false);
});
