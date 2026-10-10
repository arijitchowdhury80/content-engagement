/**
 * Slot region contract — the public API surface for component-level overrides.
 *
 * Each region has a name that maps directly to the `slot` attribute on child
 * elements supplied by the embedding page:
 *
 *   <algolia-chat>
 *     <header slot="header">…</header>
 *     <template slot="message">…</template>
 *   </algolia-chat>
 *
 * Static regions are projected in full (the customer's element replaces the
 * default). Dynamic/repeating regions use <template> elements with data-algolia-*
 * binding attributes (see bind.ts).
 */

// ---------------------------------------------------------------------------
// Static (singleton) slot regions
// ---------------------------------------------------------------------------

/**
 * Slot names for singleton chrome regions. When the host element contains a
 * child with `slot="<name>"` the widget renders `<slot name="<name>" />` at
 * that location instead of the built-in component.
 *
 * Customers can use any framework's elements or plain HTML — they are
 * projected into the shadow root via the native slot mechanism.
 */
export type StaticSlotName =
  | 'launcher' // Floating action button (collapsed state)
  | 'panel' // The chat panel shell (the whole window when open)
  | 'header' // Top bar: logo, title, controls
  | 'welcome' // Empty-state hero area (already supported, kept for completeness)
  | 'composer' // Text input + send button
  | 'sample-questions' // Sample question popover/chips above the composer
  | 'footer' // Attribution / powered-by footer row
  | 'judge-drawer' // Confidence / grounding judge slide-over panel
  | 'tool-ui'; // Tool-driven interactive UI (forms, choices) — rendered while
// a host-registered tool is suspended waiting on the user.

// ---------------------------------------------------------------------------
// Template (dynamic/repeating) slot regions
// ---------------------------------------------------------------------------

/**
 * Slot names for dynamic regions rendered per-item. Customers supply a
 * `<template slot="<name>">` child and the widget clones + data-binds it for
 * each item using the binding directives in bind.ts.
 */
export type TemplateSlotName =
  | 'message' // One full conversation turn (user + assistant)
  | 'message-user' // User bubble only
  | 'message-assistant' // Assistant response card only
  | 'source-pill' // One source link badge
  | 'suggestion' // Discovery card / follow-up suggestion chip
  | 'thinking' // Streaming "thinking" indicator
  | 'error-card' // Agent error state card
  | 'deep-dive' // Specialist deep-dive consent card
  | 'discovery'; // Discovery suggestion card (alias kept for clarity)

export type SlotName = StaticSlotName | TemplateSlotName;

// ---------------------------------------------------------------------------
// Per-region data contracts for template binding
// ---------------------------------------------------------------------------

/** Data available inside a `slot="message"` template. */
export interface MessageSlotData {
  /** The user's query text. */
  query: string;
  /** ISO-8601 timestamp of the turn. */
  timestamp: string;
  /** Role: always 'user' for the question, 'assistant' for the response. */
  role: 'user' | 'assistant';
}

/** Data available inside a `slot="message-user"` template. */
export interface MessageUserSlotData {
  query: string;
  avatarUrl: string;
}

/** Data available inside a `slot="message-assistant"` template. */
export interface MessageAssistantSlotData {
  /** The rendered answer HTML (sanitised). */
  answerHtml: string;
  /** Plain-text answer (for aria-label or custom renderers). */
  answerText: string;
  /** Agent label, e.g. "Specialist · Code". */
  agentLabel: string;
  /** Whether the turn is still streaming. */
  streaming: boolean;
}

/** Data available inside a `slot="source-pill"` template. */
export interface SourcePillSlotData {
  url: string;
  title: string;
  label: string;
  favicon: string;
}

/** Data available inside a `slot="suggestion"` / `slot="discovery"` template. */
export interface SuggestionSlotData {
  question: string;
  disabled: boolean;
}

/** Data available inside a `slot="error-card"` template. */
export interface ErrorCardSlotData {
  agentLabel: string;
  message: string;
}

/** Data available inside a `slot="thinking"` template. */
export interface ThinkingSlotData {
  phase: 'searching' | 'reading' | 'writing' | 'thinking';
  label: string;
}

/** Data available inside a `slot="deep-dive"` template. */
export interface DeepDiveSlotData {
  specialistLabel: string;
}

/** Union of all template data types, keyed by slot name. */
export type TemplateSlotDataMap = {
  message: MessageSlotData;
  'message-user': MessageUserSlotData;
  'message-assistant': MessageAssistantSlotData;
  'source-pill': SourcePillSlotData;
  suggestion: SuggestionSlotData;
  thinking: ThinkingSlotData;
  'error-card': ErrorCardSlotData;
  'deep-dive': DeepDiveSlotData;
  discovery: SuggestionSlotData;
};
