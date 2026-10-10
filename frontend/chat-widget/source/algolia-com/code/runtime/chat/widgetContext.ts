/**
 * widgetContext — React context that streams IS render state into the chat tree.
 *
 * `WidgetStoreProvider` (in WidgetStoreProvider.tsx) wraps the chat UI tree with
 * the external store created in `chatRenderer.tsx`. Child components call
 * `useWidgetState()` to subscribe via `useSyncExternalStore` so they receive live
 * updates whenever IS fires a new render cycle (e.g. when a child
 * `<algolia-agent>` or `<algolia-chat-confidence>` element connects or
 * disconnects).
 *
 * The provider lives in its own file so this module exports no components, which
 * keeps React Fast Refresh working for both.
 *
 * Fallback: when no store is in context (e.g. tests, Storybook, legacy embed
 * without IS), `useWidgetState()` returns a stable empty state so consumers
 * can still fall back to the activeInstance singleton gracefully.
 */

import { createContext, useContext, useSyncExternalStore } from 'react';
import type { WidgetStore, WidgetState } from '../chatRenderer';

const emptyState: WidgetState = { agents: {}, confidence: null, person: null };

const emptyStore: WidgetStore = {
  getSnapshot: () => emptyState,
  subscribe: () => () => {},
  update: () => {},
};

export const WidgetContext = createContext<WidgetStore>(emptyStore);

/**
 * Subscribe to the current IS render state slice.
 * Returns `{ agents, confidence, person }` from the nearest `WidgetStoreProvider`.
 * Falls back to `{ agents: {}, confidence: null, person: null }` when no
 * provider is present.
 */
export function useWidgetState(): WidgetState {
  const store = useContext(WidgetContext);
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}
