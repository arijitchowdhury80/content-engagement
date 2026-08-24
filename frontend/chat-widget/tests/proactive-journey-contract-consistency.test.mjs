import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../../../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');

const triggers = [
  'product_page_3s_30_scroll',
  'product_to_documentation',
  'solution_page_3s_30_scroll',
  'solution_to_customer_story',
  'product_to_pricing',
  'solution_to_pricing',
  'developer_page_3s_30_scroll',
  'resource_page_3s_30_scroll',
];

const layers = {
  tracker: read('frontend/chat-widget/algolia-engagement-tracker.js'),
  controller: read('frontend/chat-widget/algolia-proactive-controller.js'),
  contextContract: read('frontend/chat-widget/algolia-context-compiler.js'),
  localParity: read('local-sites/algolia-com-parity/index.html'),
  greetingPrompt: read('agents/prompts/instructions_algolia_proactive_greeting.md'),
  orchestratorPrompt: read('agents/prompts/instructions_algolia_orchestrator.md'),
  documentation: read('testing/team-uat/content-engagement-demo-uat-test-cases.md'),
  deckMetadata: read('testing/team-uat/index.html'),
};

const currentThresholdSurfaces = {
  tracker: layers.tracker,
  controller: layers.controller,
  contextContract: layers.contextContract,
  greetingInstructions: layers.greetingPrompt,
  greetingSystem: read('agents/prompts/system_algolia_arrie_concierge.md'),
  orchestratorInstructions: layers.orchestratorPrompt,
  orchestratorSystem: read('agents/prompts/system_algolia_orchestrator.md'),
  teamUatCases: layers.documentation,
  teamUatDeck: layers.deckMetadata,
  teamUatStandalone: read('testing/team-uat/content-engagement-team-uat.html'),
  customerDocumentation: read('docs/customer-documentation/proactive-engagement/README.md'),
  thresholdOperationsRecord: read('docs/operations/2026-08-23-proactive-threshold-3s-30.md'),
  deploymentTool: read('tools/deployment/deploy_jahia_engagement_tracker.py'),
};

test('the eight canonical journey identifiers remain aligned across runtime and delivery layers', () => {
  for (const [layer, source] of Object.entries(layers).filter(([layer]) => layer !== 'tracker')) {
    for (const trigger of triggers) {
      assert.match(source, new RegExp(`\\b${trigger}\\b`), `${layer} is missing ${trigger}`);
    }
  }
});

test('the active proactive stack shares the 3 second and 30 percent threshold', () => {
  assert.match(layers.tracker, /DWELL_MILESTONES_MS = \[3000, 10000, 15000\]/);
  assert.match(layers.tracker, /SCROLL_MILESTONES = \[30, 50, 75, 100\]/);
  assert.match(layers.contextContract, /JOURNEY_DWELL_MS = 3000/);
  assert.match(layers.contextContract, /JOURNEY_SCROLL_DEPTH = 30/);

  for (const prefix of [
    'product',
    'solution',
    'documentationJourney',
    'proofJourney',
    'implementation',
    'resource',
  ]) {
    assert.match(layers.controller, new RegExp(`${prefix}DwellMs: 3000`));
    assert.match(layers.controller, new RegExp(`${prefix}ScrollDepth: 30`));
    assert.match(layers.localParity, new RegExp(`${prefix}DwellMs: 3000`));
    assert.match(layers.localParity, new RegExp(`${prefix}ScrollDepth: 30`));
  }
});

test('current release surfaces do not reintroduce a superseded proactive threshold', () => {
  const supersededTrigger = /\b(?:product|solution|developer|resource)_page_(?:5s_25|10s_50)_scroll\b/;
  const supersededGate = /\b(?:5|10)(?:\+)?\s*(?:seconds?|secs?)\b[^\n]{0,100}\b(?:25|50)%/i;

  for (const [surface, source] of Object.entries(currentThresholdSurfaces)) {
    assert.doesNotMatch(source, supersededTrigger, `${surface} contains a superseded trigger identifier`);
    assert.doesNotMatch(source, supersededGate, `${surface} presents a superseded threshold as current`);
  }
});

test('current prompts, UAT, documentation, and deployment metadata declare the 3 second 30 percent contract', () => {
  for (const surface of [
    'greetingInstructions',
    'orchestratorInstructions',
    'teamUatCases',
    'teamUatDeck',
    'teamUatStandalone',
  ]) {
    assert.match(currentThresholdSurfaces[surface], /product_page_3s_30_scroll/, `${surface} is missing the current product trigger`);
    assert.match(currentThresholdSurfaces[surface], /solution_page_3s_30_scroll/, `${surface} is missing the current solution trigger`);
  }

  assert.match(currentThresholdSurfaces.customerDocumentation, /3 seconds and 30% scroll/i);
  assert.match(currentThresholdSurfaces.thresholdOperationsRecord, /3,000 milliseconds/);
  assert.match(currentThresholdSurfaces.deploymentTool, /20260823-threshold-3s-30/);
});
