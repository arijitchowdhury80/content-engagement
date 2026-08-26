import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../../', import.meta.url);
const manifest = JSON.parse(
  await readFile(new URL('config/deployments/algolia-chat-stack.json', root), 'utf8'),
);
const systemPrompt = await readFile(
  new URL('agents/prompts/system_algolia_orchestrator.md', root),
  'utf8',
);
const instructions = await readFile(
  new URL('agents/prompts/instructions_algolia_orchestrator.md', root),
  'utf8',
);
const developerInstructions = await readFile(
  new URL('agents/prompts/instructions_algolia_developer_specialist.md', root),
  'utf8',
).catch(() => '');
const developerSystemPrompt = await readFile(
  new URL('agents/prompts/system_algolia_developer_specialist.md', root),
  'utf8',
).catch(() => '');

const expected = {
  evidence: 'c735a57d-d64e-4c4f-bea2-857a608d5a52',
  product: '24b23e23-26a6-4f98-9019-44746e1eb7f0',
  tech: 'cdac8765-5626-451a-87a0-f5a95aad7235',
  sales: '6e388624-2b08-4c70-8175-525612b7670a',
};

test('deployment manifest owns the four exact specialist key and agent ID mappings', () => {
  const actual = Object.fromEntries(
    manifest.agentStudio.orchestrator.specialists.map(({ key, agentId }) => [key, agentId]),
  );
  assert.deepEqual(actual, expected);
});

test('deployment manifest owns the Developer Specialist prompts as a deployable target', () => {
  assert.equal(manifest.agentStudio.developerSpecialist.agentId, expected.tech);
  assert.equal(
    manifest.agentStudio.developerSpecialist.instructionsPath,
    'agents/prompts/instructions_algolia_developer_specialist.md',
  );
  assert.equal(
    manifest.agentStudio.developerSpecialist.systemPromptPath,
    'agents/prompts/system_algolia_developer_specialist.md',
  );
});

test('Developer Specialist treats Vanilla snippets as bounded evidence with no model-knowledge escape hatch', () => {
  for (const prompt of [developerInstructions, developerSystemPrompt]) {
    assert.match(prompt, /Algolia_Prod_Copy_Vanilla/);
    assert.match(prompt, /retrieved (?:text|evidence)/i);
    assert.match(prompt, /do not invent/i);
    assert.match(prompt, /state the evidence limit/i);
    assert.match(prompt, /title-only/i);
    assert.match(prompt, /page titled .* exists/i);
    assert.match(prompt, /exact retrieved phrase/i);
    assert.match(prompt, /cannot provide a comprehensive blueprint/i);
  }
  assert.doesNotMatch(developerInstructions, /runnable code syntax is the one exception/i);
  assert.doesNotMatch(developerInstructions, /Algolia_Prod_Copy_Enhanced/);
});

test('detailed instructions own every legal specialist key without duplicating the routing table', () => {
  for (const key of Object.keys(expected)) {
    assert.match(instructions, new RegExp(`\\b${key}\\b`));
  }
  assert.match(systemPrompt, /detailed instructions define.*specialist keys/is);
  assert.doesNotMatch(systemPrompt, /specialist_key:/);
});

test('an explicit visitor request for a configured specialist is mandatory routing', () => {
  assert.match(instructions, /explicitly asks to bring in a configured specialist/i);
  assert.match(instructions, /must\s+call `ask_specialist`/i);
  assert.match(instructions, /unless the request is unsafe\s+or off-topic/i);
  assert.match(systemPrompt, /specialist depth as an additive continuation/i);
});

test('multi-part developer-depth architecture questions deterministically route to tech', () => {
  assert.match(instructions, /developer_page_3s_30_scroll/);
  assert.match(instructions, /multi-part implementation\s+or architecture question/i);
  assert.match(instructions, /at least two/i);
  assert.match(instructions, /must call\s+`ask_specialist` with `specialist_key: "tech"`/i);
  assert.match(instructions, /do not route solely because.*developer page or.*developer persona/is);
  assert.doesNotMatch(systemPrompt, /developer_page_3s_30_scroll/);
});

test('thin snippet evidence cannot be expanded into invented business or technical detail', () => {
  assert.match(instructions, /abstract(?:s)? or snippets?/i);
  assert.match(instructions, /named frameworks?/i);
  assert.match(instructions, /effort estimates?/i);
  assert.match(instructions, /architecture patterns?/i);
  assert.match(instructions, /product behavior/i);
  assert.match(instructions, /state the evidence limit/i);
  assert.match(systemPrompt, /retrieved Algolia-owned evidence as the only authority/i);
  assert.match(systemPrompt, /If evidence cannot support a material dimension, state the gap/i);
});

test('orchestrator must search before streaming substantive factual answers', () => {
  assert.match(instructions, /first assistant action must be\s+a call to `algolia_search_index`/i);
  assert.match(instructions, /Do not stream answer prose, an analogy canvas,\s+links, recommendations, or a discovery question before the search result/i);
  assert.match(instructions, /Migration, implementation, comparison, pricing,\s+customer proof, product, API, analytics, personalization, support, and best\s+practice questions are substantive factual turns/i);
});
