/**
 * Theme system barrel — re-exports the public API.
 *
 * The widget ships zero built-in themes. Implementing sites are responsible
 * for supplying a theme and registering it before (or after) the bundle loads.
 *
 * Registration timing options:
 *
 *   // 1. Queue before the bundle loads (plain JS):
 *   window.algoliaChat = window.algoliaChat || {};
 *   window.algoliaChat.registerTheme = window.algoliaChat.registerTheme || [];
 *   window.algoliaChat.registerTheme.push(['my-brand', { color: { accent: '#ff5722' }, ... }]);
 *
 *   // 2. Call registerTheme directly after the bundle loads:
 *   window.algoliaChat.registerTheme('my-brand', { color: { accent: '#ff5722' }, ... });
 *
 *   // 3. Pass a full ChatTheme object via the JSON slot on <algolia-chat>.
 *
 * Without a registered theme the widget renders the neutral greyscale
 * scaffold from tokens.css and logs a warning for named themes that cannot
 * be found in the registry.
 */
export type { ChatTheme } from './types';
export { TOKEN_MAP } from './tokenMap';
export { compileTheme } from './compile';
export {
  registerTheme,
  getTheme,
  getRegisteredThemeNames,
  isRegisteredTheme,
  resolveTheme,
  subscribeToRegistry,
} from './registry';
