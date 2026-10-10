/**
 * compile — converts a resolved ChatTheme object into CSS text ready to be
 * injected into the shadow root.
 *
 * Output structure (in order, last-declaration wins per CSS spec):
 *   1. `:host { color-scheme: ...; --algolia-*: ...; }` — all mapped tokens
 *   2. Derived accent companions (hover, down, tint, rgb, focus, agent-primary)
 *      when `color.accent` is present but the companion is not explicitly set
 *   3. `@media (prefers-color-scheme: dark) { :host { ... } }` from `modes.dark`
 *   4. `theme.css` verbatim (raw escape hatch), after rewriting :root / body → :host
 */

import type { ChatTheme } from './types';
import { TOKEN_MAP } from './tokenMap';
import { hexToRgbTriplet } from '../styles';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Walk an object with a dot-separated key path and return the leaf value. */
function getPath(obj: Record<string, unknown>, path: string): string | undefined {
  const parts = path.split('.');
  let cursor: unknown = obj;
  for (const part of parts) {
    if (cursor == null || typeof cursor !== 'object') return undefined;
    cursor = (cursor as Record<string, unknown>)[part];
  }
  if (cursor == null) return undefined;
  if (typeof cursor === 'string') return cursor;
  if (typeof cursor === 'number' || typeof cursor === 'boolean') return String(cursor);
  return undefined;
}

/** Rewrite :root / body selectors to :host so the CSS scopes to the shadow root. */
function scopeToHost(css: string): string {
  return css
    .replace(/:root\b(?=[^{;}]*\{)/g, ':host')
    .replace(/\bbody\b(?=[^{;}]*\{)/g, ':host');
}

/**
 * Emit all mapped tokens from a ChatTheme as a flat list of CSS declarations.
 * Skips keys where the theme provides no value.
 */
function compileTokenDeclarations(theme: Omit<ChatTheme, 'extends' | 'modes' | 'css'>): string[] {
  const obj = theme as Record<string, unknown>;
  const decls: string[] = [];

  for (const [path, varName] of Object.entries(TOKEN_MAP)) {
    const value = getPath(obj, path);
    if (value !== undefined) {
      decls.push(`  ${varName}: ${value};`);
    }
  }

  return decls;
}

// ---------------------------------------------------------------------------
// Derived accent companion table
// ---------------------------------------------------------------------------

interface CompanionEntry {
  key: keyof NonNullable<ChatTheme['color']>;
  varName: string;
  value: (accent: string) => string;
}

/** Tokens that are auto-derived from `color.accent` when not explicitly set. */
const ACCENT_COMPANIONS: CompanionEntry[] = [
  {
    key: 'accentHover',
    varName: '--algolia-accent-hover',
    value: (a) => `color-mix(in srgb, ${a} 85%, #000)`,
  },
  {
    key: 'accentDown',
    varName: '--algolia-accent-down',
    value: (a) => `color-mix(in srgb, ${a} 70%, #000)`,
  },
  {
    key: 'accentTint',
    varName: '--algolia-accent-tint',
    value: (a) => `color-mix(in srgb, ${a} 12%, #fff)`,
  },
  { key: 'link', varName: '--algolia-link', value: (a) => a },
  { key: 'focus', varName: '--algolia-focus', value: (a) => a },
  { key: 'agentPrimary', varName: '--algolia-agent-primary', value: (a) => a },
];

/**
 * Contrast-pick `--algolia-text-on-accent`: returns `['  --algolia-text-on-accent: #000000;']`
 * when the accent's perceived luminance exceeds 0.6 (very light colors), otherwise `[]`.
 */
function computeTextOnAccent(triplet: string | null): string[] {
  if (!triplet) return [];
  const parts = triplet.split(', ').map(Number);
  if (parts.length !== 3) return [];
  const [r, g, b] = parts;
  // Perceived luminance (WCAG formula)
  const L = 0.2126 * (r / 255) + 0.7152 * (g / 255) + 0.0722 * (b / 255);
  return L > 0.6 ? ['  --algolia-text-on-accent: #000000;'] : [];
}

/**
 * When the theme supplies `color.accent` but not the derived companions, fill
 * them in using color-mix() — the same logic as the existing `buildAccentOverride`.
 * This means a customer only needs to declare one colour to get a coherent look.
 */
function compileDerivedAccent(theme: Omit<ChatTheme, 'extends' | 'modes' | 'css'>): string[] {
  const accent = theme.color?.accent;
  if (!accent) return [];

  const color = theme.color ?? {};
  const decls: string[] = [];

  for (const { key, varName, value } of ACCENT_COMPANIONS) {
    if (!color[key]) decls.push(`  ${varName}: ${value(accent)};`);
  }

  const triplet = hexToRgbTriplet(accent);
  if (triplet) decls.push(`  --algolia-accent-rgb: ${triplet};`);
  if (!color.textOnAccent) decls.push(...computeTextOnAccent(triplet));

  return decls;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compile a resolved ChatTheme (all `extends` already merged) into CSS text.
 *
 * The caller is responsible for resolving the `extends` chain before calling
 * this function (see registry.ts).
 */
export function compileTheme(theme: Omit<ChatTheme, 'extends'>): string {
  const { modes, css, colorScheme, ...base } = theme;
  const parts: string[] = [];

  // ── Light / base :host block ──────────────────────────────────────────────
  const lightDecls: string[] = [];

  if (colorScheme) {
    lightDecls.push(`  color-scheme: ${colorScheme};`);
  }

  lightDecls.push(...compileTokenDeclarations(base));
  lightDecls.push(...compileDerivedAccent(base));

  if (lightDecls.length > 0) {
    parts.push(`:host {\n${lightDecls.join('\n')}\n}`);
  }

  // ── Dark-mode override block ───────────────────────────────────────────────
  if (modes?.dark) {
    const { css: darkCss, ...darkBase } = modes.dark;
    const darkDecls: string[] = [];

    darkDecls.push(...compileTokenDeclarations(darkBase));
    darkDecls.push(...compileDerivedAccent(darkBase));

    if (darkDecls.length > 0) {
      parts.push(
        `@media (prefers-color-scheme: dark) {\n  :host {\n${darkDecls.map((d) => '  ' + d).join('\n')}\n  }\n}`,
      );
    }

    // Dark raw CSS escape hatch
    if (darkCss) {
      parts.push(`@media (prefers-color-scheme: dark) {\n${scopeToHost(darkCss)}\n}`);
    }
  }

  // ── Raw CSS escape hatch ───────────────────────────────────────────────────
  if (css) {
    parts.push(scopeToHost(css));
  }

  return parts.join('\n');
}
