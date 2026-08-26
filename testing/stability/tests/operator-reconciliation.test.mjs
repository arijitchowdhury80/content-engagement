import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createOperatorConversationFetcher,
  LogsAccessError,
} from '../src/reconcile/operator-conversation-client.mjs';
import { reconcileConversation } from '../src/reconcile/reconcile.mjs';

test('conversation client requires an ordinary key with logs ACL', () => {
  assert.throws(
    () => createOperatorConversationFetcher({ env: { ALGOLIA_APP_ID: '0EXRPAXB56' } }),
    (error) => error instanceof LogsAccessError && error.code === 'LOGS_ACL_REQUIRED',
  );
});

test('conversation client may use the already configured admin key for operator-only reads', async () => {
  const calls = [];
  const fetchConversation = createOperatorConversationFetcher({
    env: { ALGOLIA_APP_ID: '0EXRPAXB56', ALGOLIA_ADMIN_API_KEY: 'redacted-admin-key' },
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ id: 'alg_cnv_test', messages: [] }), { status: 200 });
    },
  });
  await fetchConversation({ agentId: 'agent_123', conversationId: 'alg_cnv_test' });
  assert.equal(calls[0].init.headers['x-algolia-api-key'], 'redacted-admin-key');
});

test('conversation client uses the exact GET contract and never sends the key in the body', async () => {
  const calls = [];
  const fetchConversation = createOperatorConversationFetcher({
    env: { ALGOLIA_APP_ID: '0EXRPAXB56', ALGOLIA_LOGS_API_KEY: 'redacted-test-key' },
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ id: 'alg_cnv_test', messages: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });
  await fetchConversation({ agentId: 'agent_123', conversationId: 'alg_cnv_test' });
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/agents\/agent_123\/conversations\/alg_cnv_test$/);
  assert.equal(calls[0].init.method, 'GET');
  assert.equal(calls[0].init.body, undefined);
});

test('401 and 403 fail closed as missing logs access', async () => {
  for (const status of [401, 403]) {
    const fetchConversation = createOperatorConversationFetcher({
      env: { ALGOLIA_APP_ID: '0EXRPAXB56', ALGOLIA_LOGS_API_KEY: 'redacted-test-key' },
      fetchImpl: async () => new Response('', { status }),
    });
    await assert.rejects(
      fetchConversation({ agentId: 'agent_123', conversationId: 'alg_cnv_test' }),
      (error) => error instanceof LogsAccessError && error.status === status,
    );
  }
});

test('reconciliation joins only exact deterministic message IDs', () => {
  const result = reconcileConversation({
    browserAttempts: [{
      turnId: 'turn_1',
      attemptId: 'attempt_1',
      conversationId: 'alg_cnv_test',
      requestMessages: [{ id: 'alg_msg_user_1' }],
      responseMessageId: 'alg_msg_assistant_1',
    }],
    exportedConversation: {
      messages: [
        { id: 'alg_msg_user_1', role: 'user', parts: [{ type: 'text' }] },
        { id: 'alg_msg_assistant_1', role: 'assistant', parts: [{ type: 'tool-output-available' }, { type: 'text' }] },
      ],
    },
  });
  assert.equal(result.status, 'PASS');
  assert.equal(result.exactJoinRate, 1);
  assert.equal(result.exportedToolPartCount, 1);
});

test('reconciliation reports missing IDs as ambiguous and never guesses by timestamp', () => {
  const result = reconcileConversation({
    browserAttempts: [{
      turnId: 'turn_1',
      attemptId: 'attempt_1',
      conversationId: 'alg_cnv_test',
      requestMessages: [{ id: 'alg_msg_user_missing' }],
      responseMessageId: 'alg_msg_assistant_missing',
    }],
    exportedConversation: { messages: [{ id: 'some_other_message' }] },
  });
  assert.equal(result.status, 'AMBIGUOUS');
  assert.equal(result.exactJoinRate, 0);
  assert.deepEqual(result.ambiguous[0].missingRequestIds, ['alg_msg_user_missing']);
  assert.equal(result.ambiguous[0].responseMatched, false);
});
