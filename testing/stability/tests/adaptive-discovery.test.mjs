import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { loadAdaptiveDiscoveryDataset, validateAdaptiveDiscoveryDataset } from '../src/contracts/validate.mjs';
import { createPersonaDriver } from '../src/discovery/persona-driver.mjs';
import { evaluateDiscoveryQuestion, evaluateFinalContinuity, evaluateSubstantiveAnswerShape } from '../src/oracle/discovery.mjs';
import { selectAdaptiveCampaign, visibleDiscoveryQuestions } from '../src/hosted/adaptive-discovery.mjs';

const DATASET = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../datasets/adaptive-discovery.v1.json');

test('adaptive dataset freezes a profile-driven campaign', () => {
  const dataset = loadAdaptiveDiscoveryDataset(DATASET);
  assert.deepEqual(validateAdaptiveDiscoveryDataset(dataset), { campaignCount: 1 });
  assert.equal(Object.isFrozen(dataset.campaigns[0].responses), true);
});

test('persona driver answers the actual discovery slot and records revealed facts', () => {
  const campaign = loadAdaptiveDiscoveryDataset(DATASET).campaigns[0];
  const driver = createPersonaDriver(campaign);
  const result = driver.answer('What frontend framework and SSR setup are you using?');
  assert.equal(result.slot, 'architecture');
  assert.match(result.answer, /Next\.js/);
  assert.equal(result.repeated, false);
  assert.equal(driver.snapshot().confirmed.architecture, 'Next.js SSR plus client-side React InstantSearch');
});

test('persona driver exposes repeated and unclassified discovery', () => {
  const campaign = loadAdaptiveDiscoveryDataset(DATASET).campaigns[0];
  const driver = createPersonaDriver(campaign);
  driver.answer('Will you use middleware for the PIM and ERP?');
  const repeated = driver.answer('Will updates go through middleware or directly from the ERP?');
  assert.equal(repeated.repeated, true);
  const unknown = driver.answer('What color should the demo button be?');
  assert.equal(unknown.slot, null);
  assert.equal(unknown.unclassified, true);
});

test('discovery oracle fails repeated, forbidden, multi-slot, and unclassified questions', () => {
  const campaign = loadAdaptiveDiscoveryDataset(DATASET).campaigns[0];
  assert.equal(evaluateDiscoveryQuestion({ campaign, question: 'What is your catalog scale?', matches: ['scale'], repeated: false }).pass, true);
  assert.match(evaluateDiscoveryQuestion({ campaign, question: 'Middleware again?', matches: ['data_flow'], repeated: true }).failures.join(','), /repeated/);
  assert.match(evaluateDiscoveryQuestion({ campaign, question: 'What is your budget?', matches: [], repeated: false }).failures.join(','), /forbidden/);
  assert.match(evaluateDiscoveryQuestion({ campaign, question: 'What is your scale and timeline?', matches: ['scale', 'delivery_constraints'], repeated: false }).failures.join(','), /multiple/);
  assert.match(evaluateDiscoveryQuestion({ campaign, question: 'What color?', matches: [], repeated: false }).failures.join(','), /unclassified/);
});

test('final continuity requires accumulated facts rather than one isolated answer', () => {
  const campaign = loadAdaptiveDiscoveryDataset(DATASET).campaigns[0];
  const good = evaluateFinalContinuity({
    campaign,
    answerText: 'For your Next.js storefront, keep the PIM and ERP middleware boundary and migrate from Elasticsearch in a four-week evaluation.',
    confirmed: { architecture: 'Next.js', product_source: 'PIM', inventory_source: 'ERP', current_platform: 'Elasticsearch', delivery_constraints: 'four weeks' },
  });
  assert.equal(good.pass, true);
  const bad = evaluateFinalContinuity({ campaign, answerText: 'Build a generic search demo.', confirmed: { architecture: 'Next.js', product_source: 'PIM' } });
  assert.equal(bad.pass, false);
});

test('substantive answer shape rejects a nonblank truncated success', () => {
  assert.deepEqual(evaluateSubstantiveAnswerShape('Since we have the architectural layout—Next.js,'), {
    pass: false,
    failures: ['substantive-answer-too-short', 'substantive-answer-truncated'],
    characterCount: 47,
  });
  assert.equal(evaluateSubstantiveAnswerShape('This complete substantive answer explains the decision, the implementation boundary, and the next practical step.').pass, true);
});

test('adaptive runner selects one campaign and extracts the visible follow-up', () => {
  const dataset = loadAdaptiveDiscoveryDataset(DATASET);
  assert.equal(selectAdaptiveCampaign(dataset, 'U2-AD1').id, 'U2-AD1');
  assert.deepEqual(visibleDiscoveryQuestions({ segments: [{ followUps: ['First?'] }, { followUps: [] }] }), ['First?']);
  assert.throws(() => selectAdaptiveCampaign(dataset, 'missing'), /Unknown adaptive campaign/);
});
