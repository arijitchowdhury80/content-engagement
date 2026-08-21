import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../../../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');

const triggers = [
  'product_page_5s_25_scroll',
  'product_to_documentation',
  'solution_page_5s_25_scroll',
  'solution_to_customer_story',
  'product_to_pricing',
  'solution_to_pricing',
  'developer_page_5s_25_scroll',
  'resource_page_5s_25_scroll',
];

const layers = {
  controller: read('frontend/chat-widget/algolia-proactive-controller.js'),
  contextContract: read('frontend/chat-widget/algolia-context-compiler.js'),
  greetingPrompt: read('agents/prompts/instructions_algolia_proactive_greeting.md'),
  orchestratorPrompt: read('agents/prompts/instructions_algolia_orchestrator.md'),
  documentation: read('testing/team-uat/content-engagement-demo-uat-test-cases.md'),
  deckMetadata: read('testing/team-uat/index.html'),
};

test('the eight canonical journey identifiers remain aligned across runtime and delivery layers', () => {
  for (const [layer, source] of Object.entries(layers)) {
    for (const trigger of triggers) {
      assert.match(source, new RegExp(`\\b${trigger}\\b`), `${layer} is missing ${trigger}`);
    }
  }
});
