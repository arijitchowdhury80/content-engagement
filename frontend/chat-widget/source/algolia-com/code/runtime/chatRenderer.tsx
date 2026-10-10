/**
 * chatRenderer — React renderer harness for the algolia.chat InstantSearch widget.
 *
 * `createChatRenderer` returns the `render` and `dispose` pair required by
 * `connectChat`. On the first render call it mounts the supplied React
 * component into the provided container element. On every subsequent render
 * it updates a tiny external store with the latest agents and confidence
 * descriptors read from the IS render state, so React re-renders reactively
 * via `useSyncExternalStore` without remounting the tree.
 *
 * This module is intentionally UI-agnostic: the concrete chat component is
 * injected by the consumer (the `<algolia-chat>` web component) via the
 * `component` parameter. That keeps this custom-widget package free of any
 * dependency on the chat UI, judge, or config layers.
 *
 * The `apiRef` is owned by the caller and passed to the component so React
 * can populate it with `open` / `ask`. This lets the host element forward
 * those calls after mount without needing an additional callback mechanism.
 */

import { createRoot, type Root } from 'react-dom/client';
import { createElement, type ComponentType } from 'react';
import type { ChatRenderState } from './connectChat';
import type { ChatAgentDescriptor } from './connectAgent';
import type { ChatConfidenceDescriptor } from './connectChatConfidence';
import type { PersonConfig } from './connectChatPerson';
import type { ChatSizeMode } from './config/instance';
import { HostSlotsContext } from './slots/HostSlotsContext';

// ── Reactive external store ───────────────────────────────────────────────────

/** The slice of IS render state that React components subscribe to. */
export interface WidgetState {
  /** Aggregated agent descriptors keyed by agentKey (e.g. 'primary', specialist slug). */
  agents: Record<string, ChatAgentDescriptor>;
  /** Confidence/judge descriptor, or null when no chatConfidence widget is registered. */
  confidence: ChatConfidenceDescriptor | null;
  /** Person agent config, or null when no chatPerson widget is registered. */
  person: PersonConfig | null;
}

/**
 * Minimal external store compatible with React's `useSyncExternalStore`.
 * The store is created once per renderer and passed to the injected component
 * so it can subscribe to agent/confidence changes without remounting.
 */
export interface WidgetStore {
  /** Returns the current snapshot. Must be stable (same ref) when unchanged. */
  getSnapshot: () => WidgetState;
  /** Subscribe to state changes. Returns an unsubscribe function. */
  subscribe: (callback: () => void) => () => void;
  /** Called by the renderer on every IS render pass to push new state. */
  update: (next: WidgetState) => void;
}

function createWidgetStore(initial: WidgetState): WidgetStore {
  let state = initial;
  const subscribers = new Set<() => void>();

  return {
    getSnapshot: () => state,
    subscribe(cb) {
      subscribers.add(cb);
      return () => {
        subscribers.delete(cb);
      };
    },
    update(next) {
      // Shallow-compare to avoid unnecessary React re-renders
      if (
        next.agents === state.agents &&
        next.confidence === state.confidence &&
        next.person === state.person
      )
        return;
      state = next;
      subscribers.forEach((cb) => cb());
    },
  };
}

// ── Public types ─────────────────────────────────────────────────────────────

/** Imperative API a mounted chat component exposes to host-page scripts. */
export interface WidgetApi {
  open: () => void;
  ask: (text: string) => void;
  /** Override the primary agent by persona agent ID. Null restores the declared primary. */
  setPersona: (agentId: string | null, label?: string) => void;
  /**
   * Open the panel and display a proactive assistant greeting with optional
   * suggestion chips. Returns false when the visitor has switched auto-engage
   * off, in which case nothing is shown and the panel stays closed.
   */
  engage: (opts: {
    greeting: string;
    suggestions?: string[];
    /** Proactive greetings default to docked; callers may request another valid mode. */
    openMode?: ChatSizeMode;
  }) => boolean;
  /**
   * Show/hide a loading indicator on the closed-state FAB while the concierge
   * agent decides whether to engage. No-op visually while the panel is open.
   */
  setAnalyzing: (analyzing: boolean) => void;
  /** Read the visitor's auto-engage preference. */
  getAutoEngage: () => boolean;
  /** Set the visitor's auto-engage preference (persisted). */
  setAutoEngage: (enabled: boolean) => void;
}

/** Props the injected chat component receives from the renderer. */
export interface ChatComponentProps {
  /** Ref owned by the host element; React populates it with open/ask on mount. */
  apiRef?: { current: WidgetApi | null };
  /**
   * External store that streams agents + confidence from the IS render cycle.
   * The component should subscribe via `useSyncExternalStore(store.subscribe, store.getSnapshot)`.
   */
  widgetStore?: WidgetStore;
  /**
   * Notified whenever the panel opens or closes, however it was triggered
   * (launcher, Escape, backdrop, or the imperative API). Lets the host element
   * surface the change as a DOM event.
   */
  onOpenChange?: (open: boolean) => void;
}

export interface ChatRendererParams {
  container: HTMLElement;
  /** Ref owned by the caller; React populates it on mount. */
  apiRef: { current: WidgetApi | null };
  /** The React component that renders the chat UI. Supplied by the consumer so
   *  this package stays independent of any concrete UI. */
  component: ComponentType<ChatComponentProps>;
  /** Notified when the panel opens or closes. */
  onOpenChange?: (open: boolean) => void;
  /**
   * The host element (e.g. `<algolia-chat>`) that wraps the shadow root.
   * When provided, the React tree is wrapped in a `HostSlotsContext.Provider`
   * so `SlotOutlet` and `TemplateOutlet` can project customer-supplied
   * light-DOM children into the shadow tree.
   */
  hostElement?: Element;
}

// ── Renderer factory ──────────────────────────────────────────────────────────

export function createChatRenderer({
  container,
  apiRef,
  component: Component,
  onOpenChange,
  hostElement,
}: ChatRendererParams): {
  render: (renderState: ChatRenderState, isFirstRender: boolean) => void;
  dispose: () => void;
} {
  let root: Root | null = null;
  const store = createWidgetStore({ agents: {}, confidence: null, person: null });

  return {
    render(renderState, isFirstRender) {
      store.update({
        agents: renderState.agents,
        confidence: renderState.confidence,
        person: renderState.person,
      });

      if (isFirstRender) {
        root = createRoot(container);

        const ui = createElement(Component, {
          apiRef,
          widgetStore: store,
          onOpenChange,
        });

        const tree = hostElement
          ? createElement(HostSlotsContext.Provider, { value: hostElement }, ui)
          : ui;

        root.render(tree);
      }
    },

    dispose() {
      root?.unmount();
      root = null;
      apiRef.current = null;
    },
  };
}
