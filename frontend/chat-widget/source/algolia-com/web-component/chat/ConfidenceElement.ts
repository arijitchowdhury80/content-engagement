/**
 * <algolia-chat-confidence> — a declarative config-carrier custom element.
 *
 * In the InstantSearch widget topology this element acts as a leaf widget:
 * when connected it creates a `chatConfidenceWidget` and dispatches
 * `algolia-widget-added` (bubbling) so the parent `<algolia-chat>` element
 * (acting as a sub-orchestrator) can call `search.addWidgets([widget])`.
 * When disconnected it dispatches `algolia-widget-removed` so the parent
 * can remove it from InstantSearch.
 *
 * Judge agents follow the same `agents` pattern used by the chat widget.
 * Supply three distinct agents assigned to skeptic, referee, and advocate.
 * The element renders nothing (display:none) and is
 * purely a config vessel.
 *
 * Usage — multiple agents with explicit roles:
 *   <algolia-chat-confidence mode="algolia"
 *     agents='[{"id":"<uuid-a>","role":"skeptic"},
 *              {"id":"<uuid-b>","role":"referee"},
 *              {"id":"<uuid-c>","role":"advocate"}]'>
 *   </algolia-chat-confidence>
 *
 * Usage — hosted judge service:
 *   <algolia-chat-confidence mode="hosted" url="https://..." api-key="...">
 *   </algolia-chat-confidence>
 *
 * Attributes
 *   mode      "hosted" | "algolia" | "off"    (optional; default "algolia")
 *   agents    JSON array containing the three role-specific judge descriptors
 *   url       Override URL for the hosted judge service (optional)
 *   api-key   Auth key for the hosted judge service (optional)
 *
 * All attributes can be changed on a connected element — the widget is detached
 * and re-registered with the new values, so judging can be turned on or off, or
 * repointed at another service, at runtime.
 */

import {
  chatConfidenceWidget,
  type JudgeMode,
  type JudgeAgentDescriptor,
} from '@algolia-central/chat-central';
import { ALGOLIA_WIDGET_ADDED, ALGOLIA_WIDGET_REMOVED } from '../instantsearch/constants';
// Side-effect: ensures <algolia-agent> / <algolia-agent> CEs are defined so
// any <algolia-agent> children of this element connect and dispatch correctly.
import './AgentElement';

function parseAgentsAttr(el: Element): JudgeAgentDescriptor[] | undefined {
  const raw = el.getAttribute('agents');
  if (!raw?.trim()) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed as JudgeAgentDescriptor[];
  } catch {
    console.warn('[algolia-chat-confidence] Could not parse `agents` attribute as JSON array.');
  }
  return undefined;
}

export class AlgoliaChatConfidenceElement extends HTMLElement {
  private widget: ReturnType<typeof chatConfidenceWidget> | null = null;

  /** Current InstantSearch leaf widget for the parent chat's initial sweep. */
  get instantSearchWidget(): ReturnType<typeof chatConfidenceWidget> | null {
    return this.widget;
  }

  static get observedAttributes(): string[] {
    return ['mode', 'agent-id', 'agents', 'url', 'api-key'];
  }

  // ── Property accessors ─────────────────────────────────────────────────────

  get judgeMode(): JudgeMode {
    const v = this.getAttribute('mode');
    if (v === 'algolia' || v === 'hosted' || v === 'off') return v;
    // Production declares role-specific judge agents as child elements. The
    // parent custom element connects before those children, so deriving the
    // transport from an `agents` attribute incorrectly selects the obsolete
    // hosted localhost service. Agent Studio is the canonical default; child
    // widgets merge their role descriptors into this config during render.
    return 'algolia';
  }

  /**
   * Build the agents array from either the `agents` JSON attribute (takes
   * precedence) or the shorthand `agent-id` attribute.
   */
  get judgeAgents(): JudgeAgentDescriptor[] | undefined {
    const fromJson = parseAgentsAttr(this);
    if (fromJson) return fromJson;
    const id = this.getAttribute('agent-id')?.trim();
    if (id) return [{ id }];
    return undefined;
  }

  get judgeUrl(): string | undefined {
    const v = this.getAttribute('url');
    return v && v.trim() ? v.trim() : undefined;
  }

  get judgeApiKey(): string | undefined {
    const v = this.getAttribute('api-key');
    return v && v.trim() ? v.trim() : undefined;
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  connectedCallback(): void {
    // Hide the element itself. `display:none` does NOT prevent light-DOM
    // children (<algolia-agent>) from connecting and dispatching their
    // `algolia-widget-added` events — custom-element lifecycle fires on DOM
    // insertion, independent of visibility.
    this.style.display = 'none';
    this.register();
  }

  /**
   * Re-register with the new configuration.
   *
   * `observedAttributes` was declared without this callback, so switching a live
   * embed between `mode="off"` and `mode="algolia"`, or repointing it at a
   * different judge service, was silently ignored.
   */
  attributeChangedCallback(_name: string, previous: string | null, next: string | null): void {
    if (!this.isConnected || previous === next) return;
    this.unregister();
    this.register();
  }

  disconnectedCallback(): void {
    this.unregister();
  }

  // ── Registration ───────────────────────────────────────────────────────────

  private register(): void {
    this.widget = chatConfidenceWidget({
      mode: this.judgeMode,
      agents: this.judgeAgents,
      url: this.judgeUrl,
      apiKey: this.judgeApiKey,
    });

    this.dispatchEvent(
      new CustomEvent(ALGOLIA_WIDGET_ADDED, {
        bubbles: true,
        cancelable: true,
        detail: this.widget,
      }),
    );
  }

  private unregister(): void {
    if (!this.widget) return;
    this.dispatchEvent(
      new CustomEvent(ALGOLIA_WIDGET_REMOVED, {
        bubbles: true,
        cancelable: true,
        detail: this.widget,
      }),
    );
    this.widget = null;
  }
}

if (!customElements.get('algolia-chat-confidence')) {
  customElements.define('algolia-chat-confidence', AlgoliaChatConfidenceElement);
}
