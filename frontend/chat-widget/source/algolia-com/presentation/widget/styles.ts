/**
 * Widget style helpers — the seam between algolia-chat (custom element) and
 * chat-central (widget engine) for CSS injection.
 *
 * `buildWidgetStyles` assembles the full stylesheet to inject into the shadow
 * DOM: tokens.css + the compiled theme skin + the Tailwind utilities stylesheet.
 * `ensureWidgetFont` loads a font stylesheet once per page.
 *
 * algolia-chat calls:
 *   shadowStyle.textContent = buildWidgetStyles({ theme, accentColor, customSkinCss });
 *   ensureWidgetFont(fontHref);
 *
 * ## Theme resolution order (last wins)
 *   1. tokens.css    — neutral gray scaffold (frozen --algolia-* defaults)
 *   2. compiled skin — resolved from `theme` (preset name, ChatTheme object)
 *   3. Tailwind CSS  — utility classes scoped to the shadow root
 *   4. customSkinCss — developer-supplied raw CSS override (back-compat)
 *   5. accentColor   — runtime hex override for accent + companion tokens (back-compat)
 *
 * ## Zero-rebuild token overrides
 *   A developer can override any token without providing customSkinCss by
 *   setting inline CSS custom properties on the <algolia-chat> element:
 *     <algolia-chat style="--algolia-accent:#e2361b; --algolia-radius-xl:4px;">
 *   Inline styles beat the injected :host rule, so this works for any token.
 */

import './theme/index';

import type { ChatTheme } from './theme/types';
import { resolveTheme, isRegisteredTheme, getRegisteredThemeNames } from './theme/registry';
import { compileTheme } from './theme/compile';

import tokensCss from './styles/tokens.css?inline';
import tailwindCss from './styles/index.css?inline';

// ---------------------------------------------------------------------------
// Public re-exports (back-compat — algolia-chat imports these)
// ---------------------------------------------------------------------------

export type { ChatTheme };
export { isRegisteredTheme as isWidgetTheme } from './theme/registry';
export { getRegisteredThemeNames as WIDGET_THEMES } from './theme/registry';

// ---------------------------------------------------------------------------
// Shadow DOM scoping helpers
// ---------------------------------------------------------------------------

/**
 * Rewrite selectors so CSS that normally targets `:root` / `body`-level
 * targets the shadow host instead.
 */
function scopeToHost(css: string): string {
  return css
    .replace(/:root\b(?=[^{;}]*\{)/g, ':host')
    .replace(/\bbody\b(?=[^{;}]*\{)/g, ':host');
}

// ---------------------------------------------------------------------------
// Utility helpers (kept for consumers that import them)
// ---------------------------------------------------------------------------

/**
 * Convert a 3- or 6-digit hex color string to an `r, g, b` triplet string
 * suitable for CSS custom properties. Returns null when the input is not a
 * valid hex color.
 */
export function hexToRgbTriplet(hex: string): string | null {
  const raw = hex.replace('#', '');
  let r: number, g: number, b: number;
  if (raw.length === 3) {
    r = parseInt(raw[0] + raw[0], 16);
    g = parseInt(raw[1] + raw[1], 16);
    b = parseInt(raw[2] + raw[2], 16);
  } else if (raw.length === 6) {
    r = parseInt(raw.slice(0, 2), 16);
    g = parseInt(raw.slice(2, 4), 16);
    b = parseInt(raw.slice(4, 6), 16);
  } else {
    return null;
  }
  if (isNaN(r) || isNaN(g) || isNaN(b)) return null;
  return `${r}, ${g}, ${b}`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface BuildWidgetStylesOptions {
  /**
   * The theme to apply. Accepts:
   *   - A registered theme name (e.g. `'my-brand'` — must be registered via
   *     `registerTheme` before calling this function).
   *   - An inline `ChatTheme` token object.
   *   - `undefined` — no skin is applied and the neutral tokens.css scaffold
   *     shows through unchanged.
   *
   * Themes are registered at runtime via `registerTheme(name, theme)`.
   * Inline objects support an `extends` field to inherit from a registered theme.
   */
  theme?: string | ChatTheme;
  /**
   * Optional hex accent color to override `--algolia-accent` and its variants.
   * @deprecated Prefer supplying `theme: { color: { accent: '#hex' } }` instead.
   *   This remains for back-compat and is applied after the theme skin so it
   *   always wins.
   */
  accentColor?: string;
  /**
   * Developer-supplied CSS to inject after the compiled theme skin.
   * @deprecated Prefer using `theme.css` inside a ChatTheme object instead.
   *   Kept for back-compat with the `<style slot="theme">` path.
   */
  customSkinCss?: string;
}

/**
 * Build the `:host` CSS block that overrides the accent colour and its
 * derived companion tokens. Used for the `accentColor` back-compat path.
 */
function buildAccentOverride(accent: string): string {
  const triplet = hexToRgbTriplet(accent);
  return `:host {
  --algolia-accent: ${accent};
  --algolia-accent-hover: color-mix(in srgb, ${accent} 85%, #000);
  --algolia-accent-tint: color-mix(in srgb, ${accent} 12%, #fff);
  --algolia-focus: ${accent};
  --algolia-agent-primary: ${accent};
  ${triplet ? `--algolia-accent-rgb: ${triplet};` : ''}
}`;
}

/**
 * Names already reported as unknown. A single embed resolves its theme more
 * than once (the font stylesheet and the CSS string are built separately, and
 * every attribute change rebuilds the sheet), so without this the same typo
 * would be logged repeatedly.
 */
const warnedUnknownThemes = new Set<string>();

function warnUnknownTheme(name: string): void {
  if (warnedUnknownThemes.has(name)) return;
  warnedUnknownThemes.add(name);
  console.warn(
    `[algolia-chat] Unknown theme "${name}". ` +
      `Registered: ${getRegisteredThemeNames().join(', ') || '(none)'}. ` +
      `Rendering with neutral token defaults. Register it with registerTheme("${name}", {...}) ` +
      `or supply a <script type="application/json" slot="theme"> child instead of theme="${name}".`,
  );
}

/**
 * Resolve a theme input (preset name, inline object, or undefined) to a
 * concrete ChatTheme. When no theme is supplied the neutral token scaffold
 * (tokens.css) is used as-is — no brand preset is applied by default.
 * When an unregistered name is supplied a warning is emitted and the neutral
 * defaults are used so the widget still renders legibly.
 */
function resolveWidgetTheme(theme: string | ChatTheme | undefined): Omit<ChatTheme, 'extends'> {
  if (theme === undefined) return {};
  if (typeof theme === 'string' && !isRegisteredTheme(theme)) {
    warnUnknownTheme(theme);
    return {};
  }
  return resolveTheme(theme);
}

/**
 * Extract the `typography.fontHref` from a theme so the caller can load the
 * font stylesheet independently of building the CSS string. Accepts the same
 * theme input as `buildWidgetStyles`. Returns `undefined` when the resolved
 * theme specifies no font URL.
 */
export function resolveWidgetFontHref(theme?: string | ChatTheme): string | string[] | undefined {
  return resolveWidgetTheme(theme).typography?.fontHref;
}

/**
 * Build the full stylesheet string to inject into the `<algolia-chat>` shadow
 * DOM. Combines the token defaults, the resolved theme skin, any developer-
 * supplied custom CSS, and the Tailwind utilities — all scoped to `:host`.
 */
export function buildWidgetStyles(opts?: BuildWidgetStylesOptions): string {
  const resolvedTheme = resolveWidgetTheme(opts?.theme);
  const compiledSkin = compileTheme(resolvedTheme);
  const parts: string[] = [scopeToHost(tokensCss), compiledSkin, tailwindCss];
  if (opts?.customSkinCss) parts.push(scopeToHost(opts.customSkinCss));
  if (opts?.accentColor) parts.push(buildAccentOverride(opts.accentColor));
  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// Font loading
// ---------------------------------------------------------------------------

/**
 * Inject a font stylesheet `<link>` into `document.head` exactly once.
 * Subsequent calls with the same href are no-ops.
 *
 * When called with no argument (or an empty array) this function does nothing —
 * the widget never loads fonts automatically. The font URL is taken from the
 * resolved ChatTheme's `typography.fontHref` (surfaced via `resolveWidgetFontHref`)
 * or from the explicit `font-href` HTML attribute. Hosts that want Sora +
 * JetBrains Mono can pass `DEFAULT_FONT_HREF` explicitly.
 *
 * Accepts multiple URLs (as an array) to load several font families at once.
 */
export function ensureWidgetFont(fontHref?: string | string[]): void {
  if (!fontHref) return;
  const hrefs = Array.isArray(fontHref) ? fontHref : [fontHref];
  for (const href of hrefs) {
    if (!href) continue;
    if (document.head.querySelector(`link[href="${CSS.escape(href)}"]`)) continue;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    document.head.appendChild(link);
  }
}
