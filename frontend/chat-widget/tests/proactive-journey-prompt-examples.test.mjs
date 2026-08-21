import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const promptsDir = resolve(__dirname, '..', '..', '..', 'agents', 'prompts');

function readPrompt(name) {
  return readFileSync(resolve(promptsDir, name), 'utf8');
}

const flows = [
  ['Product Depth', 'product_research', 'product_page_5s_25_scroll', 'explain_product_fit'],
  ['Product To Documentation', 'implementation_research', 'product_to_documentation', 'connect_product_interest_to_implementation'],
  ['Solution Depth', 'solution_research', 'solution_page_5s_25_scroll', 'explain_solution_fit'],
  ['Solution To Proof', 'customer_proof', 'solution_to_customer_story', 'surface_relevant_customer_proof'],
  ['Product To Pricing', 'commercial_evaluation', 'product_to_pricing', 'explain_cost_drivers'],
  ['Solution To Pricing', 'commercial_evaluation', 'solution_to_pricing', 'explain_solution_value_and_cost'],
  ['Developer Depth', 'implementation_research', 'developer_page_5s_25_scroll', 'reduce_implementation_uncertainty'],
  ['Resource Depth', 'resource_research', 'resource_page_5s_25_scroll', 'connect_resource_insight_to_next_step'],
];

test('aRRIe concierge system prompt covers the four categories and eight flows', () => {
  const prompt = readPrompt('system_algolia_arrie_concierge.md');

  for (const category of ['Technical', 'Business', 'Commercial', 'Specialist']) {
    assert.match(prompt, new RegExp(`### ${category}`));
  }
  for (const [label] of flows) {
    assert.match(prompt, new RegExp(`#### ${label}`));
  }
  assert.match(prompt, /teach judgment, not wording/i);
  assert.match(prompt, /do not copy/i);
});

test('Greetings Agent prompt contains one adaptive packet-output example per flow', () => {
  const prompt = readPrompt('instructions_algolia_proactive_greeting.md');

  for (const [label, moment, trigger, messageGoal] of flows) {
    assert.match(prompt, new RegExp(`### ${label}`));
    assert.match(prompt, new RegExp(`"moment": "${moment}"`));
    assert.match(prompt, new RegExp(`"trigger": "${trigger}"`));
    assert.match(prompt, new RegExp(`"messageGoal": "${messageGoal}"`));
  }
  assert.match(prompt, /demonstrations, not scripts/i);
  assert.match(prompt, /decide dynamically/i);
});

test('Greetings Agent chips discover unknown visitor facts instead of assuming them', () => {
  const instructions = readPrompt('instructions_algolia_proactive_greeting.md');
  const systemPrompt = readPrompt('system_algolia_arrie_concierge.md');

  for (const prompt of [instructions, systemPrompt]) {
    assert.match(prompt, /submitted verbatim as the visitor's next message/i);
    assert.match(prompt, /use case/i);
    assert.match(prompt, /KPIs/i);
  }

  assert.match(instructions, /"Share my use case"/);
  assert.match(instructions, /"Choose the right KPIs"/);
  assert.match(instructions, /"Find similar Grocery proof"/);
  assert.doesNotMatch(instructions, /"Match it to my use case"/);
  assert.doesNotMatch(instructions, /"Show the KPI story"/);
});

test('proactive greeting examples stay within the popup sentence limit', () => {
  const instructions = readPrompt('instructions_algolia_proactive_greeting.md');
  const systemPrompt = readPrompt('system_algolia_arrie_concierge.md');
  const segmenter = new Intl.Segmenter('en', { granularity: 'sentence' });
  const sentenceCount = (value) => [...segmenter.segment(value)].filter(({ segment }) => segment.trim()).length;
  const instructionExamples = [...instructions.matchAll(/^\s*"greeting": "(.+)"[,]?$/gm)]
    .map((match) => match[1])
    .filter((value) => !value.startsWith('<'));
  const systemExamples = [...systemPrompt.matchAll(/^Strong:\n"(.+)"$/gm)].map((match) => match[1]);

  assert.match(instructions, /one or two sentences maximum/i);
  assert.match(systemPrompt, /one or two sentences maximum/i);
  assert.equal(instructionExamples.length, 8);
  assert.equal(systemExamples.length, 8);

  for (const [source, examples] of [
    ['instructions', instructionExamples],
    ['system prompt', systemExamples],
  ]) {
    for (const example of examples) {
      assert.ok(sentenceCount(example) <= 2, `${source} greeting exceeds two sentences: ${example}`);
    }
  }
});

test('Greetings Agent owns one greeting turn and never owns engagement handoff', () => {
  const prompt = readPrompt('instructions_algolia_proactive_greeting.md');

  assert.match(prompt, /one phase/i);
  assert.match(prompt, /browser handoff/i);
  assert.doesNotMatch(prompt, /PROACTIVE_USER_ENGAGEMENT/);
  assert.doesNotMatch(prompt, /call the client-side tool/i);
});

test('v010 orchestrator prompt contains one adaptive handoff example per flow', () => {
  const prompt = readPrompt('instructions_algolia_orchestrator.md');

  for (const [label, , trigger] of flows) {
    assert.match(prompt, new RegExp(`### ${label}`));
    assert.match(prompt, new RegExp(`"trigger": "${trigger}"`));
  }
  assert.match(prompt, /calibration examples, not answer templates/i);
  assert.match(prompt, /must decide dynamically/i);
});
