/**
 * WidgetStoreProvider — wraps the chat UI tree with the renderer's external store.
 *
 * Kept separate from `widgetContext.ts` so that module exports only the context
 * and its hook; a file that mixes components with other exports breaks React
 * Fast Refresh.
 */

import type { ReactNode } from 'react';
import { WidgetContext } from './widgetContext';
import type { WidgetStore } from '../chatRenderer';

export function WidgetStoreProvider({
  store,
  children,
}: {
  store: WidgetStore;
  children: ReactNode;
}) {
  return <WidgetContext.Provider value={store}>{children}</WidgetContext.Provider>;
}
