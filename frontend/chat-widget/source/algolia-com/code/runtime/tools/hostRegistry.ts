/**
 * hostRegistry — module-global singleton for host-registered tools.
 *
 * Host tools are merged LAST into the turn registry so they cannot silently
 * shadow a built-in tool (ask_specialist, get_visitor_profile). The registry
 * is populated via `registerHostTool`, which is exposed on `window.algoliaChat`
 * with the same pre-load array-queue replay that `registerTheme` uses:
 *
 *   // Before the widget bundle loads:
 *   window.algoliaChat = window.algoliaChat || {};
 *   window.algoliaChat.registerTool = window.algoliaChat.registerTool || [];
 *   window.algoliaChat.registerTool.push(['my_tool', async input => ({ done: true })]);
 *
 *   // After the widget bundle loads:
 *   window.algoliaChat.registerTool('my_tool', async input => ({ done: true }));
 *
 * The `ToolHandler` and `ToolRegistry` types are already public via
 * `tools/registry.ts`; this module adds the registration path.
 */

import type { ToolHandler, ToolRegistry } from './registry';

/** Tool names the widget reserves. Host registrations that clash are rejected. */
const RESERVED: ReadonlySet<string> = new Set(['ask_specialist', 'get_visitor_profile']);

const _registry: ToolRegistry = {};

/**
 * Register a host-provided tool handler.
 *
 * No-ops (with a console warning) when the name clashes with a reserved
 * built-in so that a mis-configured host page does not break the widget's
 * own tools. Silent de-duplication: registering the same name twice replaces
 * the previous handler, which lets bundles loaded multiple times stay safe.
 */
export function registerHostTool(name: string, handler: ToolHandler): void {
  if (RESERVED.has(name)) {
    console.warn(
      `[algolia-chat] Cannot register host tool '${name}': name is reserved by the widget.`,
    );
    return;
  }
  _registry[name] = handler;
}

/**
 * Return a shallow copy of the current host tool registry.
 *
 * Called from `buildTurnRegistry` where it is merged LAST so host tools
 * cannot shadow built-ins even if the reserved-name guard is bypassed.
 * Returns a copy so the caller cannot mutate the internal registry.
 */
export function getHostRegistry(): ToolRegistry {
  return { ..._registry };
}
