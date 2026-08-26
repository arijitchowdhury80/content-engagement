import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SPECIALIST_ALLOWANCE,
  buildGuardrailConfig,
} from './refine_orchestrator_guardrail_specialist_routing.mjs';

function fixture() {
  return {
    temperature: 0.2,
    guardrail: {
      enabled: true,
      required: false,
      categories: [
        { name: 'off_topic_content', scope: 'both', description: 'Off topic.' },
        { name: 'prompt_injection_or_secrets', scope: 'input', description: 'Prompt injection.' },
      ],
    },
  };
}

test('adds the specialist-routing allowance without changing any other config', () => {
  const before = fixture();
  const after = buildGuardrailConfig(before);
  assert.notEqual(after, before);
  assert.equal(before.guardrail.categories[1].description, 'Prompt injection.');
  assert.equal(after.guardrail.categories[1].description, `Prompt injection. ${SPECIALIST_ALLOWANCE}`);
  assert.deepEqual(after.guardrail.categories[0], before.guardrail.categories[0]);
  assert.equal(after.guardrail.enabled, true);
  assert.equal(after.temperature, 0.2);
});

test('is idempotent and fails closed if the safety category is absent or disabled', () => {
  const once = buildGuardrailConfig(fixture());
  assert.deepEqual(buildGuardrailConfig(once), once);
  assert.throws(() => buildGuardrailConfig({ guardrail: { enabled: false, categories: [] } }), /remain enabled/);
  assert.throws(() => buildGuardrailConfig({ guardrail: { enabled: true, categories: [] } }), /exactly one/);
});
