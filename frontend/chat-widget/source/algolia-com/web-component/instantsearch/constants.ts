/**
 * Shared constants for the InstantSearch web-component layer.
 *
 * The AEM-style widget assembly uses a bubbling custom event on DOM:
 *   - Leaf (child) elements CREATE an InstantSearch widget and dispatch
 *     ALGOLIA_WIDGET_ADDED so an ancestor (root or sub-orchestrator) can call
 *     search.addWidgets([event.detail]).
 *   - When a leaf disconnects it dispatches ALGOLIA_WIDGET_REMOVED so the
 *     ancestor can call search.removeWidgets([event.detail]).
 *
 * Root element attribute names follow the AEM pattern (kebab-case).
 */

/** Fired (bubbles=true) when a leaf element creates a widget. detail = widget. */
export const ALGOLIA_WIDGET_ADDED = 'algolia-widget-added' as const;

/** Fired (bubbles=true) when a leaf element disconnects. detail = widget. */
export const ALGOLIA_WIDGET_REMOVED = 'algolia-widget-removed' as const;

// ── Root element attribute names ──────────────────────────────────────────────

export const ATTR_APP_ID = 'app-id' as const;
export const ATTR_API_KEY = 'api-key' as const;
export const ATTR_INDEX_NAME = 'index-name' as const;

/** `<algolia-chat>` names the same value `search-api-key`. Both elements accept
 *  either spelling so hosts don't have to remember which wants which. */
export const ATTR_SEARCH_API_KEY = 'search-api-key' as const;
