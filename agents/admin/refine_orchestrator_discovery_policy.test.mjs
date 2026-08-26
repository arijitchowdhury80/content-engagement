import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  validateAnswerQualityPrompts,
  validateDiscoveryPrompts,
} from './refine_orchestrator_discovery_policy.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('local orchestrator prompts satisfy the conversation-led discovery contract', () => {
  const instructions = fs.readFileSync(path.join(ROOT, 'agents/prompts/instructions_algolia_orchestrator.md'), 'utf8');
  const systemPrompt = fs.readFileSync(path.join(ROOT, 'agents/prompts/system_algolia_orchestrator.md'), 'utf8');
  assert.deepEqual(validateDiscoveryPrompts(instructions, systemPrompt), { pass: true, missing: [], conflicts: [] });
});

test('contract rejects the former unconditional discovery rule', () => {
  assert.throws(
    () => validateDiscoveryPrompts('Every substantive answer ends with one thoughtful', 'Ask exactly one thoughtful discovery question at the end of every substantive answer'),
    /Discovery prompt contract failed/,
  );
});

test('discovery contract requires ordered slots and a literal final question', () => {
  const instructions = fs.readFileSync(path.join(ROOT, 'agents/prompts/instructions_algolia_orchestrator.md'), 'utf8');
  const systemPrompt = fs.readFileSync(path.join(ROOT, 'agents/prompts/system_algolia_orchestrator.md'), 'utf8');
  assert.throws(
    () => validateDiscoveryPrompts(
      instructions.replace('A missing-item explanation is not a discovery question.', 'Describe the missing item.'),
      systemPrompt,
    ),
    /Discovery prompt contract failed/,
  );
  assert.throws(
    () => validateDiscoveryPrompts(
      instructions,
      systemPrompt.replace(/Merely explaining a missing item is not a\s+question/, 'Explain a missing item'),
    ),
    /Discovery prompt contract failed/,
  );
});

test('local orchestrator prompts satisfy coverage and complete-answer contracts', () => {
  const instructions = fs.readFileSync(path.join(ROOT, 'agents/prompts/instructions_algolia_orchestrator.md'), 'utf8');
  const systemPrompt = fs.readFileSync(path.join(ROOT, 'agents/prompts/system_algolia_orchestrator.md'), 'utf8');
  assert.deepEqual(validateAnswerQualityPrompts(instructions, systemPrompt), {
    pass: true,
    missing: [],
    conflicts: [],
    duplicateHeadings: [],
  });
});

test('KPI measurement is not allowed as a no-retrieval discovery-only answer path', () => {
  const instructions = fs.readFileSync(path.join(ROOT, 'agents/prompts/instructions_algolia_orchestrator.md'), 'utf8');
  const systemPrompt = fs.readFileSync(path.join(ROOT, 'agents/prompts/system_algolia_orchestrator.md'), 'utf8');

  assert.doesNotMatch(
    instructions,
    /Which KPIs should I measure\?` when the visitor\s+has not supplied a use case or business outcome yet/,
  );
  assert.deepEqual(validateAnswerQualityPrompts(instructions, systemPrompt), {
    pass: true,
    missing: [],
    conflicts: [],
    duplicateHeadings: [],
  });
  assert.throws(
    () => validateAnswerQualityPrompts(
      instructions.replace(
        'KPI, metric, measurement, optimization, analytics, revenue, conversion, or\n' +
          '   performance questions are substantive once you provide even a short\n' +
          '   framework or recommendation. Search first and cite the retrieved evidence\n' +
          '   normally.',
        'KPI chips can collect context without retrieval.',
      ),
      systemPrompt,
    ),
    /Answer-quality prompt contract failed/,
  );
});

test('coverage contract rejects incomplete baseline and fixed evidence-type adequacy', () => {
  assert.throws(
    () => validateAnswerQualityPrompts(
      '## Answer-Coverage Check\n## Conversation-Led Discovery\n## Specialist Routing\n' +
      'Inspect whether the retrieved evidence type matches the answer need. ' +
      'after giving the concise answer you can already support',
      '## Priority Order',
    ),
    /Answer-quality prompt contract failed/,
  );
});
