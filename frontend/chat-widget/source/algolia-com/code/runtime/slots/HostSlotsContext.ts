/**
 * HostSlotsContext — React context carrying the host element so that
 * SlotOutlet and TemplateOutlet can discover light-DOM children (slot
 * projections and templates) without prop-drilling.
 *
 * The context value is the embedding element (typically the `<algolia-chat>`
 * custom element) or null when the widget is used standalone without a host.
 */
import { createContext, useContext } from 'react';

export const HostSlotsContext = createContext<Element | null>(null);

/** Returns the host element, or null when running outside a custom element. */
export function useHostElement(): Element | null {
  return useContext(HostSlotsContext);
}
