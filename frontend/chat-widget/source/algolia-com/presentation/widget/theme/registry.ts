/**
 * Theme registry — the runtime store of named ChatTheme objects.
 *
 * Implementing sites call `registerTheme(name, theme)` to register a named
 * theme. The widget resolves a theme by name via `resolveTheme`, which walks
 * the `extends` chain and deep-merges results so a site can build a variant
 * on top of its own base theme:
 *
 *   registerTheme('my-brand', {
 *     color: { accent: '#e2361b', text: '#111111' },
 *   });
 *   registerTheme('my-brand-dark', {
 *     extends: 'my-brand',
 *     color: { bg: '#121212', surface: '#1e1e1e' },
 *   });
 *
 * Re-registration is allowed (last write wins), which also notifies any
 * registered listeners so mounted widget instances restyle themselves.
 */

import type { ChatTheme } from './types';

// ---------------------------------------------------------------------------
// Registry store
// ---------------------------------------------------------------------------

const registry = new Map<string, ChatTheme>();
const listeners = new Set<(name: string) => void>();

// ---------------------------------------------------------------------------
// Deep merge
// ---------------------------------------------------------------------------

type PlainObject = Record<string, unknown>;

function isPlainObject(v: unknown): v is PlainObject {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Recursively merge `source` onto `target`, returning a new object.
 * Arrays and primitives in `source` replace those in `target`.
 */
function deepMerge(target: PlainObject, source: PlainObject): PlainObject {
  const result: PlainObject = { ...target };
  for (const key of Object.keys(source)) {
    const sv = source[key];
    const tv = target[key];
    if (isPlainObject(sv) && isPlainObject(tv)) {
      result[key] = deepMerge(tv, sv);
    } else {
      result[key] = sv;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Register (or replace) a named theme preset in the global registry.
 * Fires `name`-keyed change notifications so mounted widget instances can
 * restyle when the preset they are using is updated.
 */
export function registerTheme(name: string, theme: ChatTheme): void {
  registry.set(name, theme);
  listeners.forEach((fn) => fn(name));
}

/** Retrieve a registered preset by name. Returns `undefined` when not found. */
export function getTheme(name: string): ChatTheme | undefined {
  return registry.get(name);
}

/** All currently registered theme names. */
export function getRegisteredThemeNames(): string[] {
  return Array.from(registry.keys());
}

/**
 * Whether `value` is a registered theme name. Used as a runtime type guard
 * to replace the old `isWidgetTheme` check, which only knew two hardcoded names.
 */
export function isRegisteredTheme(value: string | undefined): boolean {
  return value !== undefined && registry.has(value);
}

/**
 * Subscribe to registry changes. The callback receives the name of the theme
 * that was added or replaced. Returns an unsubscribe function.
 */
export function subscribeToRegistry(fn: (name: string) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/**
 * Resolve a theme name or inline ChatTheme object into a fully-merged ChatTheme,
 * walking the `extends` chain.
 *
 * - String: looked up in the registry; if unknown, a warning is emitted and the
 *   empty object (neutral defaults) is returned.
 * - Object: used as-is but still walks its `extends` chain if present.
 * - Cycle detection: throws when a cycle of more than `MAX_DEPTH` extends
 *   redirects is detected.
 *
 * The returned object has `extends` removed — it is a fully materialised theme
 * ready for `compileTheme()`.
 */
export function resolveTheme(theme: string | ChatTheme): Omit<ChatTheme, 'extends'> {
  const MAX_DEPTH = 20;
  return _resolveTheme(theme, new Set<string>(), MAX_DEPTH);
}

function _resolveTheme(
  theme: string | ChatTheme,
  seen: Set<string>,
  depth: number,
): Omit<ChatTheme, 'extends'> {
  if (depth <= 0) {
    throw new Error(
      '[algolia-chat] Theme extends chain is too deep (possible cycle). ' +
        `Seen: ${Array.from(seen).join(' → ')}`,
    );
  }

  // Resolve string references to registered themes
  let resolved: ChatTheme;
  if (typeof theme === 'string') {
    const found = registry.get(theme);
    if (!found) {
      console.warn(
        `[algolia-chat] Unknown theme "${theme}". ` +
          `Registered themes: ${getRegisteredThemeNames().join(', ') || '(none)'}. ` +
          `Register it with registerTheme("${theme}", { ... }) or supply a ` +
          `<script type="application/json" slot="theme"> child.`,
      );
      return {};
    }
    if (seen.has(theme)) {
      throw new Error(
        `[algolia-chat] Circular theme extends detected: ${Array.from(seen).join(' → ')} → ${theme}`,
      );
    }
    seen.add(theme);
    resolved = found;
  } else {
    resolved = theme;
  }

  const { extends: parentName, ...ownTheme } = resolved;

  // No parent — return own values
  if (!parentName) {
    return ownTheme;
  }

  // Resolve parent first, then deep-merge own values on top
  const parentResolved = _resolveTheme(parentName, new Set(seen), depth - 1);
  return deepMerge(parentResolved, ownTheme);
}
