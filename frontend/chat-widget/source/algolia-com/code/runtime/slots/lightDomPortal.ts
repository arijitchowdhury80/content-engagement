/**
 * lightDomPortal — manages a "portal" container in the host element's light
 * DOM so that cloned template content lives outside the shadow root and
 * inherits the embedding page's CSS.
 *
 * ## Why this is necessary
 *
 * A customer's design system components are styled by the page's stylesheets.
 * If those elements were mounted inside the shadow root they would lose access
 * to the page's CSS. By hosting them in the light DOM as named slots, the
 * browser handles style inheritance automatically — the shadow root just
 * projects the slot content via `<slot name="…" />`.
 *
 * ## How it works
 *
 * 1. `createPortal(host, slotName)` appends a `<div slot="<slotName>">` to
 *    the host element. A matching `<slot name="<slotName>">` in the shadow
 *    DOM projects it into position.
 *
 * 2. `TemplateOutlet` uses this to place each cloned/bound template instance
 *    in the light DOM with a unique slot name, then renders the corresponding
 *    `<slot>` in the shadow tree at the correct list position.
 *
 * 3. Calling `destroy()` removes the container from the light DOM.
 */

export interface LightDomPortal {
  /** The light-DOM container whose children are visible in the shadow slot. */
  container: HTMLElement;
  /** The slot name — use as the `name` prop of `<slot name={…} />` in shadow. */
  slotName: string;
  /** Remove the container from the host element. */
  destroy: () => void;
}

let _portalCounter = 0;

/**
 * Create a named light-DOM portal container attached to `host`.
 *
 * @param host      The custom element (light DOM parent).
 * @param keyPrefix A human-readable prefix for the generated slot name —
 *                  helps with debugging in the element inspector.
 */
export function createLightDomPortal(host: Element, keyPrefix: string): LightDomPortal {
  const slotName = `algolia-portal-${keyPrefix}-${++_portalCounter}`;
  const container = document.createElement('div');
  container.setAttribute('slot', slotName);
  // Hide from the slot's layout — we size/position in the shadow tree.
  container.style.display = 'contents';
  host.appendChild(container);

  return {
    container,
    slotName,
    destroy() {
      if (container.parentElement === host) {
        host.removeChild(container);
      }
    },
  };
}
