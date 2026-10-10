/**
 * chatConfidenceWidget — the public factory for the algolia.chatConfidence
 * InstantSearch leaf widget.
 *
 * Wires `connectChatConfidence` (the connector) into a ready-to-register
 * widget, following the pattern from the Algolia "Create your own widgets"
 * guide. The returned widget object is registered with InstantSearch via
 * `search.addWidgets([chatConfidenceWidget({ ... })])`.
 *
 * UI rendering (optional): when a `container` element is provided, the widget
 * mounts an `<algolia-confidence-badge>` custom element into that container.
 * The badge starts in an idle/empty state and is updated automatically whenever
 * the chat widget scores an answer — the chat dispatches an `algolia-verdict`
 * CustomEvent on `document`, and this renderer subscribes to it.
 *
 * Usage (inside the <algolia-chat-confidence> web component — config only):
 *   import { chatConfidenceWidget } from '@algolia-central/chat-central';
 *   const widget = chatConfidenceWidget({ mode: 'hosted', url: '...', apiKey: '...' });
 *   dispatchEvent(new CustomEvent('algolia-widget-added', { detail: widget, bubbles: true }));
 *
 * Usage (programmatic — with optional UI):
 *   const widget = chatConfidenceWidget({
 *     mode: 'hosted', url: 'https://judge.example.com', apiKey: 'sk-...',
 *     container: document.querySelector('#confidence-badge'),
 *   });
 */

import {
  connectChatConfidence,
  type ChatConfidenceWidgetParams,
  type ChatConfidenceWidget,
} from './connectChatConfidence';

/**
 * Factory params — a superset of `ChatConfidenceWidgetParams` (the connector
 * params). The additional `container` field is consumed by the factory renderer
 * only and is not forwarded to the IS connector.
 */
export interface ChatConfidenceWidgetFactoryParams extends ChatConfidenceWidgetParams {
  /**
   * Optional DOM element to render a live `<algolia-confidence-badge>` into.
   * The badge reflects the verdict for the most recently scored answer, updated
   * via the `algolia-verdict` document event that the chat widget dispatches.
   * When omitted the widget is a pure config carrier (the default for the
   * `<algolia-chat-confidence>` web component).
   */
  container?: HTMLElement;
}

// ── Verdict event ─────────────────────────────────────────────────────────────

/**
 * Name of the CustomEvent dispatched on `document` by the chat widget's judge
 * hook (`useJudge`) whenever a confidence verdict is ready.
 *
 * detail: { verdict: unknown; question: string }
 */
export const ALGOLIA_VERDICT_EVENT = 'algolia-verdict' as const;

// ── Badge element type (opaque — chat-central has no UI dep) ──────────────────

/** Minimal interface for the `<algolia-confidence-badge>` CE. */
interface ConfidenceBadgeElement extends HTMLElement {
  verdict?: unknown;
}

// ── Vanilla DOM renderer ──────────────────────────────────────────────────────

/**
 * Mount an `<algolia-confidence-badge>` element into `container`, subscribe to
 * `algolia-verdict` document events, and return a cleanup function.
 */
function mountConfidenceBadge(container: HTMLElement): () => void {
  const badge = document.createElement('algolia-confidence-badge') as ConfidenceBadgeElement;
  container.appendChild(badge);

  const onVerdict = (evt: Event): void => {
    const { verdict } = (evt as CustomEvent<{ verdict: unknown; question: string }>).detail ?? {};
    if (verdict !== undefined) badge.verdict = verdict;
  };

  document.addEventListener(ALGOLIA_VERDICT_EVENT, onVerdict);

  return () => {
    document.removeEventListener(ALGOLIA_VERDICT_EVENT, onVerdict);
    if (badge.parentNode === container) container.removeChild(badge);
  };
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function chatConfidenceWidget(
  params: ChatConfidenceWidgetFactoryParams,
): ChatConfidenceWidget {
  const { container, ...connectorParams } = params;

  let unmountBadge: (() => void) | null = null;
  let mounted = false;

  const renderFn = (): void => {
    if (mounted || !container) return;
    mounted = true;
    unmountBadge = mountConfidenceBadge(container);
  };

  const unmountFn = (): void => {
    unmountBadge?.();
    unmountBadge = null;
    mounted = false;
  };

  const createWidget = connectChatConfidence(renderFn, unmountFn);

  return {
    ...createWidget(connectorParams),
    $$widgetType: 'algolia.chatConfidence',
  };
}
