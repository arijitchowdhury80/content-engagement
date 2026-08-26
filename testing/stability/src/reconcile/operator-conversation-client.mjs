import fs from 'node:fs';
import path from 'node:path';

import { REPOSITORY_ROOT, TARGET } from '../config/constants.mjs';

function loadEnvironment(envFile = path.join(REPOSITORY_ROOT, '.env.local')) {
  const values = { ...process.env };
  if (!fs.existsSync(envFile)) return values;
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const index = trimmed.indexOf('=');
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if (value.length >= 2 && value[0] === value.at(-1) && ['"', "'"].includes(value[0])) value = value.slice(1, -1);
    if (!(key in values)) values[key] = value;
  }
  return values;
}

export class LogsAccessError extends Error {
  constructor(message, { status = null, code = 'LOGS_ACL_REQUIRED' } = {}) {
    super(message);
    this.name = 'LogsAccessError';
    this.code = code;
    this.status = status;
  }
}

function validateIdentifier(value, label) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error(`${label} must contain only letters, numbers, underscore, or hyphen`);
  }
  return value;
}

export function createOperatorConversationFetcher({ fetchImpl = fetch, env = loadEnvironment() } = {}) {
  const appId = env.ALGOLIA_APP_ID;
  const apiKey = env.ALGOLIA_LOGS_API_KEY || env.ALGOLIA_ADMIN_API_KEY;
  if (appId !== TARGET.appId) throw new Error(`Operator app must be ${TARGET.appId}; received ${appId ?? 'missing'}`);
  if (!apiKey) throw new LogsAccessError('An Algolia API key with logs ACL is required for operator-only conversation reads');

  return async ({ agentId, conversationId }) => {
    const safeAgentId = validateIdentifier(agentId, 'agentId');
    const safeConversationId = validateIdentifier(conversationId, 'conversationId');
    const response = await fetchImpl(
      `https://${appId}.algolia.net/agent-studio/1/agents/${safeAgentId}/conversations/${safeConversationId}`,
      {
        method: 'GET',
        headers: {
          'x-algolia-application-id': appId,
          'x-algolia-api-key': apiKey,
          'user-agent': 'algolia-stability-reconciler/1',
        },
      },
    );
    if (response.status === 401 || response.status === 403) {
      throw new LogsAccessError(`Conversation read requires logs ACL: HTTP ${response.status}`, { status: response.status });
    }
    if (response.status === 404) {
      throw new LogsAccessError('Conversation was not found; verify retention is enabled and the exact persisted ID was submitted', {
        status: 404,
        code: 'CONVERSATION_NOT_FOUND',
      });
    }
    if (!response.ok) throw new Error(`Conversation read failed: HTTP ${response.status}`);
    return response.json();
  };
}
