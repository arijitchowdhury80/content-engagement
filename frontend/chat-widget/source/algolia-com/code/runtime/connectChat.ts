/**
 * connectChat — custom InstantSearch.js connector for the algolia-chat widget.
 *
 * Follows the official "Create your own widgets" connector pattern:
 * https://www.algolia.com/doc/guides/building-search-ui/widgets/create-your-own-widgets/js
 *
 * The chat does NOT consume Algolia search results. InstantSearch is used
 * purely as the lifecycle/orchestration layer: init mounts the React tree,
 * render updates the reactive store, dispose unmounts.
 *
 * Agent sub-widgets register their config into `renderState.chatAgents` via
 * connectAgent, and confidence sub-widgets register their config into
 * `renderState.chatConfidence` via connectChatConfidence. The chat connector
 * reads both aggregated states in getWidgetRenderState (called during render,
 * after all widget getRenderState passes have completed) and passes them to
 * the renderer's reactive store so React re-renders without remounting.
 */

import type { InstantSearch, InitOptions, RenderOptions } from 'instantsearch.js/es/types';
import type { ChatAgentDescriptor, JudgeAgentDescriptor } from './connectAgent';
import type { ChatConfidenceDescriptor } from './connectChatConfidence';
import type { PersonConfig, PersonAgentRole, PersonSubAgentDescriptor } from './connectChatPerson';

/** Roles a person sub-agent may claim; anything else is ignored on merge. */
const PERSON_ROLES = new Set<PersonAgentRole>(['profile', 'events', 'session']);

// ── Internal IS shape needed to read accumulated renderState ──────────────────

/** Minimal slice of the IS instance used to read back aggregated render state. */
type ISWithRenderState = InstantSearch & {
  renderState?: Record<string, Record<string, unknown>>;
};

/**
 * Extract chatAgents, chatConfidence, and judgeAgents from the IS instance's
 * accumulated renderState for the main index. Called during `render` (phase 2),
 * which fires after all widgets have run `getRenderState` (phase 1), so leaf
 * widget data is always present.
 *
 * When `<algolia-agent>` judge children are registered they publish into
 * `renderState.judgeAgents`. This function merges those into
 * `chatConfidence.agents`, so the child elements are the authoritative source
 * of judge agent config when present. If no judge children exist the
 * static `agents` declared on `<algolia-chat-confidence>` itself are used.
 */
function readChildRenderState(is: ISWithRenderState): {
  agents: Record<string, ChatAgentDescriptor>;
  confidence: ChatConfidenceDescriptor | null;
  person: PersonConfig | null;
} {
  const indexState = (is.renderState ?? {})[is.indexName] ?? {};

  return {
    agents: (indexState.chatAgents ?? {}) as Record<string, ChatAgentDescriptor>,
    confidence: mergeJudgeAgents(
      (indexState.chatConfidence ?? null) as ChatConfidenceDescriptor | null,
      indexState.judgeAgents as Record<string, JudgeAgentDescriptor> | undefined,
    ),
    person: mergePersonAgents(
      (indexState.chatPerson ?? null) as PersonConfig | null,
      indexState.personAgents as Record<string, PersonSubAgentDescriptor> | undefined,
    ),
  };
}

/**
 * Merge child `<algolia-agent>` judge descriptors into `confidence.agents`.
 *
 * The `<algolia-chat-confidence agent-id="CHIEF_UUID">` shorthand sets
 * Child `<algolia-agent role="skeptic/…">` elements publish into
 * judgeAgentsMap. When present, those live leaf widgets are authoritative over
 * the static attribute snapshot.
 */
function mergeJudgeAgents(
  confidence: ChatConfidenceDescriptor | null,
  judgeAgentsMap: Record<string, JudgeAgentDescriptor> | undefined,
): ChatConfidenceDescriptor | null {
  if (!confidence || !judgeAgentsMap) return confidence;

  const childAgents = Object.values(judgeAgentsMap);
  if (childAgents.length === 0) return confidence;

  return {
    ...confidence,
    agents: childAgents,
  };
}

/**
 * Merge child `<algolia-agent role="profile|events|session">` descriptors into
 * `person.agents`.
 *
 * The children publish themselves into renderState.personAgents rather than
 * being read off the DOM, because `<algolia-chat-person>` upgrades before its
 * children are parsed and would otherwise see none of them.
 */
function mergePersonAgents(
  person: PersonConfig | null,
  personAgentsMap: Record<string, PersonSubAgentDescriptor> | undefined,
): PersonConfig | null {
  if (!person || !personAgentsMap) return person;

  const subAgents = Object.values(personAgentsMap).filter(
    (a): a is PersonSubAgentDescriptor => Boolean(a?.id) && PERSON_ROLES.has(a?.role),
  );

  return subAgents.length > 0 ? { ...person, agents: subAgents } : person;
}

// ── Public types ─────────────────────────────────────────────────────────────

export interface ChatWidgetApi {
  open: () => void;
  ask: (text: string) => void;
}

export interface ChatConnectorWidgetParams {
  container: HTMLElement;
}

export interface ChatRenderState {
  api: ChatWidgetApi | null;
  /** Aggregated agent descriptors from all registered chatAgent leaf widgets.
   *  Keyed by agentKey (e.g. 'primary', or a specialist slug). */
  agents: Record<string, ChatAgentDescriptor>;
  /** Confidence/judge descriptor from the registered chatConfidence leaf
   *  widget, or null when none is registered. */
  confidence: ChatConfidenceDescriptor | null;
  /** Person agent config from the registered chatPerson leaf widget, or null. */
  person: PersonConfig | null;
  instantSearchInstance: InstantSearch;
  widgetParams: ChatConnectorWidgetParams;
}

export type ChatRenderer = (renderState: ChatRenderState, isFirstRender: boolean) => void;
export type ChatUnmounter = () => void;

// ── Minimal widget interface (avoids conflicts with IS's built-in chat types) ─

export interface ChatWidget {
  $$type: string;
  $$widgetType?: string;
  init?: (options: InitOptions) => void;
  render?: (options: RenderOptions) => void;
  dispose?: () => void;
  getWidgetRenderState?: (options: InitOptions | RenderOptions) => ChatRenderState;
  getRenderState?: (
    renderState: Record<string, unknown>,
    options: InitOptions | RenderOptions,
  ) => Record<string, unknown>;
}

// ── Connector ─────────────────────────────────────────────────────────────────

const noop = (): void => {};

/**
 * Create a chat connector.
 * @param renderFn  Called on init (isFirstRender=true) and on every IS render
 *                  cycle (isFirstRender=false). The renderState includes the
 *                  aggregated agents and confidence from leaf widgets.
 * @param unmountFn Called when the widget is disposed.
 */
export function connectChat(renderFn: ChatRenderer, unmountFn: ChatUnmounter = noop) {
  return function chat(widgetParams: ChatConnectorWidgetParams): ChatWidget {
    const connectorState: { api: ChatWidgetApi | null } = { api: null };

    const getWidgetRenderState = (options: InitOptions | RenderOptions): ChatRenderState => {
      const is = options.instantSearchInstance as ISWithRenderState;
      const { agents, confidence, person } = readChildRenderState(is);
      return {
        api: connectorState.api,
        agents,
        confidence,
        person,
        instantSearchInstance: options.instantSearchInstance,
        widgetParams,
      };
    };

    return {
      $$type: 'algolia.chat',

      init(initOptions: InitOptions) {
        renderFn(getWidgetRenderState(initOptions), true);
      },

      render(renderOptions: RenderOptions) {
        renderFn(getWidgetRenderState(renderOptions), false);
      },

      dispose() {
        unmountFn();
      },

      getWidgetRenderState,

      getRenderState(renderState, renderOptions) {
        return {
          ...renderState,
          algoliaChat: getWidgetRenderState(renderOptions),
        };
      },
    };
  };
}
