/**
 * The only production source entry for the Algolia Content Engagement widget.
 *
 * Every module that enters the customer artifact must be reachable from this
 * file. Build tooling must never discover customer modules by scanning folders.
 */
// Theme registration must precede custom-element registration so the first
// render uses the approved Algolia presentation without a neutral flash.
import './presentation/theme-algolia.js';

// Install the reconciled answer contracts and single-renderer authority before
// the custom element upgrades existing hosts.
import './code/install-answer-runtime.mjs';

// Judge primitives and the badge register before the widget begins emitting
// answer lifecycle events.
import './code/judge-core.js';
import './presentation/confidence-badge.js';

// Readable web-component and shared engine recovered from the approved source
// donors. This is the only component registration in the customer artifact.
import './web-component/chat-embed';

// Algolia-owned Content Engagement capabilities. Import order preserves the
// characterized browser stack while producing one distributable file.
import './code/engagement-tracker.js';
import './code/context-compiler.js';
import './code/proactive-controller.js';
import './code/handoff-to-orchestrator.js';
import './code/chat-engage.js';
import './code/chat-form-tool.js';
import './code/chat-compare.js';
import './code/token-telemetry.js';
