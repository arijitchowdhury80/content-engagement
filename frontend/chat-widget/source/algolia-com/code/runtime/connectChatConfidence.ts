/**
 * connectChatConfidence — custom InstantSearch.js connector for the
 * algolia.chatConfidence leaf widget (the `<algolia-chat-confidence>` config
 * carrier).
 *
 * Follows the official "Create your own widgets" connector pattern:
 * https://www.algolia.com/doc/guides/building-search-ui/widgets/create-your-own-widgets/js
 *
 * This connector renders nothing and applies no search parameters. It is a
 * config-only carrier that registers confidence/judge configuration into the
 * global InstantSearch render state (`renderState.chatConfidence`) so the
 * parent `<algolia-chat>` widget can read it when IS fires its render cycle.
 *
 * Judge agents are modelled with the same `agents` pattern used by the chat
 * widget — a typed descriptor per agent so multiple judge personalities (e.g.
 * skeptic / referee / advocate) can be wired to distinct Agent Studio agents.
 * The approved Algolia panel uses three distinct role-specific agents.
 *
 * The factory that wires this connector into a ready-to-register widget lives
 * in `chatConfidenceWidget.ts` (mirrors the connectChat.ts / chatWidget.ts
 * split and the connectAgent.ts / agentWidget.ts split).
 */

import type { JudgeAgentDescriptor } from './judge/types';

export type { JudgeAgentDescriptor };

const noop = (): void => {};

// ── Types ─────────────────────────────────────────────────────────────────────

/** Which judge backend the confidence widget uses. */
export type JudgeMode = 'algolia' | 'hosted' | 'off';

/**
 * Descriptor published into `renderState.chatConfidence`. The central chat
 * widget reads this to configure useJudge / judgeAnswer without reaching into
 * the global env singleton.
 */
export interface ChatConfidenceDescriptor {
  /**
   * Judge agents. In `algolia` mode each agent acts as an LLM seam for the
   * @confidence-engine. Exactly one distinct skeptic, referee, and advocate
   * descriptor is required by the v3.3 panel contract.
   */
  agents?: JudgeAgentDescriptor[];
  /** Which judge backend to use. Defaults to `hosted`. */
  mode: JudgeMode;
  /** Override for the hosted judge service URL. */
  url?: string;
  /** Auth key forwarded to the hosted judge service as `x-judge-api-key`. */
  apiKey?: string;
}

/** Widget params — extends the descriptor with an optional widget key. */
export interface ChatConfidenceWidgetParams extends ChatConfidenceDescriptor {
  /** Optional identifier when multiple confidence widgets coexist (advanced). */
  key?: string;
}

export interface ChatConfidenceWidget {
  $$type: string;
  $$widgetType?: string;
  init?: () => void;
  render?: () => void;
  dispose?: () => void;
  getWidgetRenderState?: () => ChatConfidenceDescriptor;
  getRenderState?: (renderState: Record<string, unknown>) => Record<string, unknown>;
}

// ── Connector ─────────────────────────────────────────────────────────────────

export function connectChatConfidence(renderFn: () => void = noop, unmountFn: () => void = noop) {
  return function chatConfidence(widgetParams: ChatConfidenceWidgetParams): ChatConfidenceWidget {
    const { agents, mode, url, apiKey } = widgetParams;
    const descriptor: ChatConfidenceDescriptor = { agents, mode, url, apiKey };

    return {
      $$type: 'algolia.chatConfidence',

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
        return { ...renderState, chatConfidence: descriptor };
      },
    };
  };
}
