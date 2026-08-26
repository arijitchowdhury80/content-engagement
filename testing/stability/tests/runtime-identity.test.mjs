import assert from 'node:assert/strict';
import test from 'node:test';

import { extractChatIndex, extractConfidenceMode, inspectJahiaHtml } from '../src/preflight/jahia-identity.mjs';
import { inspectAgent } from '../src/preflight/agent-studio-identity.mjs';
import { validateBrowserIdentity } from '../src/preflight/browser-identity.mjs';
import { createOperatorAgentFetcher } from '../src/preflight/operator-agent-client.mjs';

const ORCHESTRATOR = {
  agentId: 'agent-orchestrator',
  name: 'www Chat - Orchestrator',
  searchToolPatch: { toolName: 'algolia_search_index', indexName: 'Algolia_Prod_Copy_Vanilla' },
};

test('Jahia identity requires exactly one active chat and one index attribute', () => {
  const valid = '<main><algolia-chat-theme></algolia-chat-theme><algolia-instant-search app-id="0EXRPAXB56" index-name="Algolia_Prod_Copy_Vanilla"><algolia-chat-confidence mode="off"></algolia-chat-confidence><algolia-chat-visitor></algolia-chat-visitor><algolia-chat></algolia-chat></algolia-instant-search></main>';
  assert.equal(extractChatIndex(valid), 'Algolia_Prod_Copy_Vanilla');
  assert.equal(extractConfidenceMode(valid), 'off');
  assert.equal(inspectJahiaHtml(valid, 'fixture').vanillaOnly, true);
  assert.equal(inspectJahiaHtml(valid, 'fixture').inlineConfidenceOff, true);
  assert.throws(() => extractChatIndex('<main><algolia-chat></algolia-chat></main>'), /found 0/);
  assert.throws(() => extractChatIndex(`${valid}${valid}`), /found 2/);
  assert.throws(() => extractChatIndex('<algolia-instant-search index-name="one"><algolia-chat index-name="two">'), /found 2/);
});

test('Jahia identity rejects stale Enhanced even when Vanilla appears elsewhere', () => {
  const html = '<!-- Algolia_Prod_Copy_Vanilla --><algolia-instant-search index-name="Algolia_Prod_Copy_Enhanced"><algolia-chat-confidence mode="off"></algolia-chat-confidence><algolia-chat></algolia-chat></algolia-instant-search>';
  const result = inspectJahiaHtml(html, 'fixture');
  assert.equal(result.indexName, 'Algolia_Prod_Copy_Enhanced');
  assert.equal(result.vanillaOnly, false);
});

test('Jahia identity rejects inline confidence judging', () => {
  const html = '<algolia-instant-search index-name="Algolia_Prod_Copy_Vanilla"><algolia-chat-confidence mode="algolia"></algolia-chat-confidence><algolia-chat></algolia-chat></algolia-instant-search>';
  const result = inspectJahiaHtml(html, 'fixture');
  assert.equal(result.confidenceMode, 'algolia');
  assert.equal(result.inlineConfidenceOff, false);
});

test('orchestrator identity requires exactly one named Vanilla search index', () => {
  const valid = inspectAgent({
    id: ORCHESTRATOR.agentId,
    name: ORCHESTRATOR.name,
    tools: [{ name: 'algolia_search_index', indices: [{ index: 'Algolia_Prod_Copy_Vanilla' }] }],
  }, ORCHESTRATOR, { requireNamedSearchTool: true });
  assert.equal(valid.pass, true);

  const stale = inspectAgent({
    id: ORCHESTRATOR.agentId,
    name: ORCHESTRATOR.name,
    tools: [{ name: 'algolia_search_index', indices: [{ index: 'Algolia_Prod_Copy_Enhanced' }] }],
  }, ORCHESTRATOR, { requireNamedSearchTool: true });
  assert.equal(stale.pass, false);
  assert.match(stale.errors.join('\n'), /non-Vanilla/);
});

test('display-name typography drift warns but IDs and retrieval identity decide the gate', () => {
  const result = inspectAgent({
    id: ORCHESTRATOR.agentId,
    name: 'www Chat – Orchestrator',
    tools: [{ name: 'algolia_search_index', indices: [{ index: 'Algolia_Prod_Copy_Vanilla' }] }],
  }, ORCHESTRATOR, { requireNamedSearchTool: true });
  assert.equal(result.pass, true);
  assert.equal(result.warnings.length, 1);
});

test('browser identity validates app, index, and widget cardinality independently', () => {
  assert.equal(validateBrowserIdentity({ count: 1, appId: '0EXRPAXB56', indexName: 'Algolia_Prod_Copy_Vanilla', confidenceCount: 1, confidenceMode: 'off' }).pass, true);
  const invalid = validateBrowserIdentity({ count: 2, appId: 'wrong', indexName: 'Algolia_Prod_Copy_Enhanced', confidenceCount: 2, confidenceMode: 'algolia' });
  assert.equal(invalid.pass, false);
  assert.equal(invalid.errors.length, 5);
});

test('operator Agent Studio client keeps credentials in the operator request only', async () => {
  const calls = [];
  const fetchAgent = createOperatorAgentFetcher({
    env: { ALGOLIA_APP_ID: '0EXRPAXB56', ALGOLIA_ADMIN_API_KEY: 'operator-secret' },
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, json: async () => ({ name: 'fixture', tools: [] }) };
    },
  });
  const result = await fetchAgent('agent-id');
  assert.deepEqual(result, { name: 'fixture', tools: [] });
  assert.equal(calls[0].options.headers['x-algolia-api-key'], 'operator-secret');
  assert.doesNotMatch(JSON.stringify(result), /operator-secret/);
  assert.throws(() => createOperatorAgentFetcher({ env: { ALGOLIA_APP_ID: 'WRONG', ALGOLIA_ADMIN_API_KEY: 'secret' } }), /Operator app must be/);
});
