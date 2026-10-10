/**
 * SlotOutlet — renders a named shadow-DOM slot when the host element contains
 * a child with the matching `slot` attribute, otherwise renders the built-in
 * fallback children.
 *
 * This is the generalised version of the existing `slot="welcome"` pattern
 * in EmptyState.tsx. Every static chrome region in the widget uses this
 * component so customers can project their own elements for any region
 * without forking the widget.
 *
 * Example host HTML:
 *   <algolia-chat>
 *     <header slot="header" class="my-ds-header">
 *       <img src="/logo.svg" /> My Product
 *     </header>
 *   </algolia-chat>
 *
 * The widget renders `<slot name="header" />` at the header location and the
 * browser projects the customer's `<header>` element into it. The customer's
 * element lives in the light DOM so it inherits the page's CSS.
 */

import type { ReactNode } from 'react';
import { useHostElement } from './HostSlotsContext';
import type { StaticSlotName } from './regions';

export interface SlotOutletProps {
  /** The slot region name (matches the `slot` attribute on host children). */
  name: StaticSlotName;
  /** Built-in component rendered when the host has no child for this slot. */
  children: ReactNode;
}

/**
 * Renders `<slot name={name} />` when the host element has a child with a
 * matching `slot` attribute; otherwise renders `children` (the built-in).
 *
 * The check is intentionally done each render — the host's light DOM can be
 * mutated after the first mount. React will not unmount and remount the
 * component, it will just switch between the two render paths.
 */
export function SlotOutlet({ name, children }: SlotOutletProps) {
  const host = useHostElement();

  const hasSlottedChild = host
    ? host.querySelector(`[slot="${CSS.escape(name)}"]`) !== null
    : false;

  if (!hasSlottedChild) {
    return <>{children}</>;
  }

  // Native shadow-DOM slot: the browser projects the host's slotted children.
  // TypeScript infers <slot> as a standard HTML element so no cast is needed.
  return <slot name={name} />;
}
