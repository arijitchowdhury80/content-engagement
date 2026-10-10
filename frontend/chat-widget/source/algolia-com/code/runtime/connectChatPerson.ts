/**
 * connectChatPerson — InstantSearch.js connector for <algolia-chat-person>.
 *
 * The person element is a config-only carrier that publishes the person-agent
 * configuration into renderState.chatPerson so the central chat widget can
 * build the get_visitor_profile tool registry without reaching into the global
 * env singleton.
 *
 * `<algolia-chat-person agent-id="…" refresh-on="page" ttl-ms="600000">`
 *   `<algolia-agent role="profile" agent-id="…"></algolia-agent>`
 *   `<algolia-agent role="events"  agent-id="…"></algolia-agent>`
 *   `<algolia-agent role="session" agent-id="…"></algolia-agent>`
 * `</algolia-chat-person>`
 */

const noop = (): void => {};

// ── Types ─────────────────────────────────────────────────────────────────────

/** Role of a person sub-agent. */
export type PersonAgentRole = 'profile' | 'events' | 'session';

/** One person sub-agent descriptor, published into PersonConfig.agents[]. */
export interface PersonSubAgentDescriptor {
  /** Agent Studio UUID of the sub-agent. */
  id: string;
  /** Which data slice this agent interprets. */
  role: PersonAgentRole;
  /** Human-readable label (optional). */
  label?: string;
}

/**
 * Full person configuration published into renderState.chatPerson.
 * When null/absent, the get_visitor_profile tool is not registered.
 */
export interface PersonConfig {
  /** Agent Studio UUID of the person orchestrator agent. */
  agentId: string;
  /** Sub-agents for each data slice. Omit a role to skip that sub-agent. */
  agents?: PersonSubAgentDescriptor[];
  /**
   * @deprecated Retained for markup compatibility. V1 always re-reads the
   * source and invalidates on material behavior changes, regardless of value.
   */
  refreshOn?: 'session' | 'page';
  /** Profile cache TTL in ms. Default 10 min (600 000). */
  ttlMs?: number;
}

/** Widget params extend PersonConfig with optional key. */
export interface ChatPersonWidgetParams extends PersonConfig {
  key?: string;
}

export interface ChatPersonWidget {
  $$type: string;
  $$widgetType?: string;
  init?: () => void;
  render?: () => void;
  dispose?: () => void;
  getWidgetRenderState?: () => PersonConfig;
  getRenderState?: (renderState: Record<string, unknown>) => Record<string, unknown>;
}

// ── Connector ─────────────────────────────────────────────────────────────────

export function connectChatPerson(renderFn: () => void = noop, unmountFn: () => void = noop) {
  return function chatPerson(widgetParams: ChatPersonWidgetParams): ChatPersonWidget {
    const { agentId, agents, refreshOn, ttlMs } = widgetParams;
    const descriptor: PersonConfig = { agentId, agents, refreshOn, ttlMs };

    return {
      $$type: 'algolia.chatPerson',

      init() {
        renderFn();
      },

      render() {
        renderFn();
      },

      dispose() {
        unmountFn();
      },

      getWidgetRenderState() {
        return descriptor;
      },

      getRenderState(renderState) {
        return { ...renderState, chatPerson: descriptor };
      },
    };
  };
}
