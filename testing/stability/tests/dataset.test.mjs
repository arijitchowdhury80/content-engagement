import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { loadFrozenDataset, validateReactiveDataset } from '../src/contracts/validate.mjs';

const DATASET = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../datasets/reactive-conversations.v1.json');

test('reactive dataset freezes five personas, twenty campaigns, and 120 exact turns', () => {
  const dataset = loadFrozenDataset(DATASET);
  assert.deepEqual(validateReactiveDataset(dataset), {
    personaCount: 5,
    campaignCount: 20,
    turnCount: 120,
    breakpointPersonaCount: 15,
  });
  assert.equal(Object.isFrozen(dataset), true);
  assert.equal(Object.isFrozen(dataset.campaigns[0].questions), true);
  assert.throws(() => { dataset.campaigns[0].questions[0] = 'mutated at runtime'; }, TypeError);
});

test('dataset validator rejects wrong campaign cardinality and unknown persona references', () => {
  const dataset = structuredClone(loadFrozenDataset(DATASET));
  dataset.campaigns[0].questions.pop();
  assert.throws(() => validateReactiveDataset(dataset), /six questions and six actions/);
  const other = structuredClone(loadFrozenDataset(DATASET));
  other.campaigns[0].personaId = 'UNKNOWN';
  assert.throws(() => validateReactiveDataset(other), /Unknown personaId/);
});

test('dataset validator rejects draft or runtime-generated corpus state', () => {
  const dataset = structuredClone(loadFrozenDataset(DATASET));
  dataset.status = 'draft-for-intake-approval';
  assert.throws(() => validateReactiveDataset(dataset), /must be frozen-v1/);
});
