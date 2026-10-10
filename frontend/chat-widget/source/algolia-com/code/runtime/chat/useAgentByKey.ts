/**
 * useAgentByKey — React hook that resolves an agent descriptor by key,
 * checking the live IS render-state first (populated by <algolia-agent>
 * child elements) and falling back to the activeInstance singleton
 * (populated by the `agents` JSON attribute on <algolia-chat>).
 *
 * The IS render-state is the correct source for typical embeds: child
 * elements publish into `renderState.chatAgents` keyed by their `agentKey`
 * attribute, while `activeInstance.agents.specialists` stays empty unless
 * the host also sets the `agents` attribute. Using the IS state first means
 * labels and accent tokens always reflect the live element tree.
 */
import type { AgentDescriptor } from '../config/instance';
import type { ChatAgentDescriptor } from '../connectAgent';
import { activeInstance, getAgentByKey } from '../config/active';
import { useWidgetState } from './widgetContext';

export function useAgentByKey(key: string): AgentDescriptor | ChatAgentDescriptor | undefined {
  const { agents } = useWidgetState();
  // IS render-state: keyed by agentKey (e.g. "primary", "react").
  // Also search by the .key field for specialist entries whose agentKey differs.
  return agents[key] ?? Object.values(agents).find((a) => a.key === key) ?? getAgentByKey(key);
}

/** Like useAgentByKey, but falls back to the primary agent descriptor so
 *  callers never have to guard against undefined. */
export function useAgentByKeyOrPrimary(key: string): AgentDescriptor | ChatAgentDescriptor {
  return useAgentByKey(key) ?? activeInstance.agents.primary;
}
