/**
 * TemplateOutlet — renders a customer-supplied `<template slot="…">` for
 * dynamic/repeating regions (messages, source pills, suggestion chips, etc.).
 *
 * When no matching template is present it falls back to `children` (the
 * built-in component). When a template is present it:
 *
 *   1. Clones the template's content via `bindTemplate`.
 *   2. Mounts the clone into a light-DOM portal container on the host element
 *      so it inherits the page's CSS rather than being isolated in the shadow.
 *   3. Renders a matching `<slot name="…">` in the shadow tree at the
 *      position where the built-in would have appeared.
 *
 * ## Keying and diffing
 *
 * Each rendered item is tracked by a `key` string (e.g. turn ID + segment
 * index). On subsequent renders the outlet:
 *   - Creates new portal containers for new keys.
 *   - Patches text/html in-place for existing keys (streaming-safe).
 *   - Removes portal containers for removed keys.
 *
 * The shadow tree renders a `<slot name="…">` for every live key, in order.
 * React keeps them stable because the key list drives the slot list.
 *
 * ## Usage
 *
 *   <TemplateOutlet
 *     name="source-pill"
 *     itemKey={`${turnId}-${source.url}`}
 *     data={{ url: source.url, title: source.title, label: source.label }}
 *     actions={{ ask: sendMessage }}
 *   >
 *     <SourcePill source={source} />
 *   </TemplateOutlet>
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useHostElement } from './HostSlotsContext';
import { createLightDomPortal, type LightDomPortal } from './lightDomPortal';
import { bindTemplate, type BindingData, type BindingActions } from './bind';
import type { TemplateSlotName } from './regions';

// ---------------------------------------------------------------------------
// Internal portal registry (per TemplateOutlet instance, via ref)
// ---------------------------------------------------------------------------

interface PortalEntry {
  portal: LightDomPortal;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface TemplateOutletProps {
  /** Region name — must match the `slot` attribute on the host's `<template>`. */
  name: TemplateSlotName;
  /** A unique, stable key for this item (e.g. turn ID + source URL). */
  itemKey: string;
  /** Data to bind into the template via `data-algolia-*` directives. */
  data: BindingData;
  /** Action handlers wired to `data-algolia-action` elements. */
  actions?: BindingActions;
  /** Built-in fallback rendered when no template is present. */
  children: ReactNode;
}

/**
 * Renders a `<template slot="name">` from the host element's light DOM,
 * bound with `data` and placed in a light-DOM portal. Falls back to
 * `children` when no template exists.
 */
export function TemplateOutlet({
  name,
  itemKey,
  data,
  actions = {},
  children,
}: TemplateOutletProps) {
  const host = useHostElement();

  // Look for <template slot="name"> in the host's light DOM.
  const template = host
    ? host.querySelector<HTMLTemplateElement>(`template[slot="${CSS.escape(name)}"]`)
    : null;

  // slotName drives whether we render the shadow <slot> or the built-in.
  // It lives in state (not the ref) so reading it during render is safe.
  const [slotName, setSlotName] = useState<string | null>(null);
  // portalRef stores the portal object between renders without causing re-renders.
  const portalRef = useRef<PortalEntry | null>(null);

  useEffect(() => {
    if (!template || !host) return;

    // Create the portal container once per item key.
    if (!portalRef.current) {
      const portal = createLightDomPortal(host, `${name}-${itemKey}`);
      portalRef.current = { portal };
      setSlotName(portal.slotName);
    }

    const { portal } = portalRef.current;

    // Clone + bind the template into the portal container.
    // Replace previous content entirely (safe — keyed at parent level).
    portal.container.innerHTML = '';
    const bound = bindTemplate(template, data, actions);
    portal.container.appendChild(bound);

    return () => {
      // Cleanup runs when the key changes or the component unmounts.
      if (portalRef.current) {
        portalRef.current.portal.destroy();
        portalRef.current = null;
        setSlotName(null);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template, host, itemKey, JSON.stringify(data)]);

  // No template, or portal not yet mounted — render the built-in fallback.
  if (!template || !slotName) {
    return <>{children}</>;
  }

  return <slot name={slotName} />;
}

// ---------------------------------------------------------------------------
// TemplateOutletList — renders a list of template-bound items
// ---------------------------------------------------------------------------

export interface TemplateOutletListProps<T extends BindingData> {
  name: TemplateSlotName;
  items: { key: string; data: T }[];
  actions?: BindingActions;
  renderItem: (item: T, key: string) => ReactNode;
}

/**
 * Convenience wrapper for rendering a list of template-bound items (e.g.
 * source pills). Each item gets its own `TemplateOutlet` keyed by `key`.
 */
export function TemplateOutletList<T extends BindingData>({
  name,
  items,
  actions,
  renderItem,
}: TemplateOutletListProps<T>) {
  return (
    <>
      {items.map(({ key, data }) => (
        <TemplateOutlet key={key} name={name} itemKey={key} data={data} actions={actions}>
          {renderItem(data, key)}
        </TemplateOutlet>
      ))}
    </>
  );
}
