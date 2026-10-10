/**
 * connectAgent — unified custom InstantSearch.js connector for chat agents,
 * judge agents, and person sub-agents.
 *
 * A single connector replaces the previous `connectChatAgent` /
 * `connectJudgeAgent` pair. The only structural difference between the three
 * is which `renderState` key they publish into:
 *
 *   context === 'chat'   → renderState.chatAgents[agentKey]
 *   context === 'judge'  → renderState.judgeAgents[agentKey]
 *   context === 'person' → renderState.personAgents[agentKey]
 *
 * All contexts publish into an object keyed by `agentKey` so the central
 * `connectChat` connector can aggregate them during its render phase.
 *
 * Publishing through IS rather than reading the DOM matters for timing: the
 * parser upgrades a custom element at its start tag, so a parent that queries
 * its own children in `connectedCallback` sees none of them. Leaf agents
 * announce themselves instead, and the parent picks them up from renderState.
 *
 * Web-component layer: the single `<algolia-agent>` element uses `closest()`
 * to determine context automatically — no explicit `context` attribute needed
 * in HTML.
 */

import type { JudgeAgentDescriptor } from './judge/types';

export type { JudgeAgentDescriptor };

const noop = (): void => {};

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * Which IS renderState bucket this agent publishes into.
 *   'chat'   → renderState.chatAgents   (read by connectChat → useChat)
 *   'judge'  → renderState.judgeAgents  (merged into chatConfidence.agents → useJudge)
 *   'person' → renderState.personAgents (merged into chatPerson.agents → personAgent)
 */
export type AgentContext = 'chat' | 'judge' | 'person';

/** Chat-agent roles. */
export type AgentRole = 'primary' | 'specialist' | 'classifier';

/**
 * Descriptor published into `renderState.chatAgents`.
 * All fields are required — the widget element supplies defaults for any that
 * are not provided by the consumer.
 */
export interface ChatAgentDescriptor {
  id: string;
  role: string;
  key: string;
  label: string;
  accentToken: string;
}

/**
 * Union of both descriptor shapes. Used as the return type of
 * `getWidgetRenderState` so either context works without casting.
 */
export type AgentDescriptor = ChatAgentDescriptor | JudgeAgentDescriptor;

/**
 * Widget params for a single agent in either context.
 *
 * `agentKey` is the unique slot in the renderState map (e.g. 'primary',
 * 'classifier', a specialist slug, 'skeptic', 'default', …).
 *
 * Chat-specific fields (`key`, `accentToken`) are ignored in judge context.
 */
export interface AgentWidgetParams {
  /** Key used in `renderState.chatAgents` or `renderState.judgeAgents`. */
  agentKey: string;
  /** Agent Studio agent UUID. */
  id: string;
  /** Which renderState bucket to publish into. */
  context: AgentContext;
  /** Agent role. Chat: 'primary'|'specialist'|'classifier'. Judge: 'skeptic'|'referee'|'advocate'. */
  role?: string;
  /** Human-readable display name. */
  label?: string;
  /** Specialist slug (chat context only). */
  key?: string;
  /** CSS custom-property name for accent colour (chat context only). */
  accentToken?: string;
}

export interface AgentWidget {
  $$type: string;
  $$widgetType?: string;
  init?: () => void;
  render?: () => void;
  dispose?: () => void;
  getWidgetRenderState?: () => AgentDescriptor & { widgetParams: AgentWidgetParams };
  getRenderState?: (renderState: Record<string, unknown>) => Record<string, unknown>;
}

// ── Connector ─────────────────────────────────────────────────────────────────

/** renderState bucket each context publishes into. */
const PUBLISH_KEY: Record<AgentContext, string> = {
  chat: 'chatAgents',
  judge: 'judgeAgents',
  person: 'personAgents',
};

export function connectAgent(renderFn: () => void = noop, unmountFn: () => void = noop) {
  return function agent(widgetParams: AgentWidgetParams): AgentWidget {
    const { agentKey, id, role, label, key, accentToken, context } = widgetParams;

    // Chat agents publish a richer descriptor; judge and person agents publish
    // the minimal { id, role, label } shape their consumers expect.
    const descriptor: AgentDescriptor =
      context === 'chat'
        ? {
            id,
            role: role ?? '',
            key: key ?? agentKey,
            label: label ?? '',
            accentToken: accentToken ?? '--algolia-agent-primary',
          }
        : { id, role, label };

    const publishKey = PUBLISH_KEY[context];

    return {
      $$type: `algolia.${context}Agent`,

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
        return { ...descriptor, widgetParams };
      },

      getRenderState(renderState) {
        return {
          ...renderState,
          [publishKey]: {
            ...(renderState[publishKey] as Record<string, unknown>),
            [agentKey]: descriptor,
          },
        };
      },
    };
  };
}
