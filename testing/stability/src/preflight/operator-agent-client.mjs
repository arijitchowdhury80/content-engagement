import fs from 'node:fs';
import path from 'node:path';

import { REPOSITORY_ROOT, TARGET } from '../config/constants.mjs';

function loadEnvironment(envFile = path.join(REPOSITORY_ROOT, '.env.local')) {
  const values = { ...process.env };
  if (fs.existsSync(envFile)) {
    for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
      const index = trimmed.indexOf('=');
      const key = trimmed.slice(0, index).trim();
      let value = trimmed.slice(index + 1).trim();
      if (value.length >= 2 && value[0] === value.at(-1) && ['"', "'"].includes(value[0])) value = value.slice(1, -1);
      if (!(key in values)) values[key] = value;
    }
  }
  return values;
}

export function createOperatorAgentFetcher({ fetchImpl = fetch, env = loadEnvironment() } = {}) {
  const appId = env.ALGOLIA_APP_ID;
  const apiKey = env.ALGOLIA_ADMIN_API_KEY;
  if (appId !== TARGET.appId) throw new Error(`Operator app must be ${TARGET.appId}; received ${appId ?? 'missing'}`);
  if (!apiKey) throw new Error('ALGOLIA_ADMIN_API_KEY is required for read-only Agent Studio identity');
  return async (agentId) => {
    const response = await fetchImpl(`https://${appId}.algolia.net/agent-studio/1/agents/${agentId}`, {
      headers: {
        'x-algolia-application-id': appId,
        'x-algolia-api-key': apiKey,
        'user-agent': 'algolia-stability-preflight/1',
      },
    });
    if (!response.ok) throw new Error(`Agent Studio identity read failed for ${agentId}: HTTP ${response.status}`);
    return response.json();
  };
}
