/** Install the canonical answer state/renderer before the web component upgrades. */
import '../web-component/answer-runtime-bridge.mjs';

globalThis.ALGOLIA_ANSWER_RENDERER_AUTHORITY = true;
