/**
 * Env + agent-config plumbing for chat and judge transport.
 *
 * Lives under `src/shared/` (not `chat/lib`) because both the chat feature and
 * the judge feature build a CompletionsConfig from runtime credentials — this
 * is neutral transport plumbing, not chat-specific logic.
 *
 * Credentials come from the <algolia-chat> element's attributes
 * (via config/runtime.ts), not build-time env.
 */
import type { CompletionsConfig } from './agentStudio';
import { getRuntimeEnv } from '../config/runtime';

interface EnvConfig {
  appId: string;
  searchKey: string;
}

export function getEnvConfig(): EnvConfig {
  const rt = getRuntimeEnv();
  if (rt?.appId && rt?.searchKey) {
    return { appId: rt.appId, searchKey: rt.searchKey };
  }
  throw new Error(
    'Missing Algolia config: set `app-id` and `search-api-key` on <algolia-chat> ' +
      '(use a browser-safe SEARCH-ONLY key, never the admin key).',
  );
}

/** Build a CompletionsConfig for a given agent ID (sourced from runtime config). */
export function getAgentConfig(agentId: string): CompletionsConfig {
  const { appId, searchKey } = getEnvConfig();
  return { appId, searchKey, agentId };
}
