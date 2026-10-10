/**
 * <algolia-chat-person> — declarative config-carrier for the person orchestrator.
 *
 * When connected it creates a `chatPersonWidget` publishing into
 * renderState.chatPerson. The chat widget reads this to register the
 * `get_visitor_profile` tool.
 *
 * Sub-agents are NOT read from the DOM here. The parser upgrades this element
 * at its start tag, so its <algolia-agent> children do not exist yet when
 * connectedCallback runs. Instead each child registers itself into
 * renderState.personAgents (see connectAgent), and connectChat merges those
 * into this descriptor during the render phase — the same pattern judge agents
 * use under <algolia-chat-confidence>.
 *
 * Attributes:
 *   agent-id      Agent Studio UUID of the person orchestrator  (required)
 *   refresh-on    'session' | 'page'  (default 'session')
 *   ttl-ms        Cache TTL in ms     (default 600000 = 10 min)
 *
 * Child elements (use <algolia-agent> with a role attribute):
 *   <algolia-agent role="profile" agent-id="…">
 *   <algolia-agent role="events"  agent-id="…">
 *   <algolia-agent role="session" agent-id="…">
 *
 * Example:
 *   <algolia-chat-person agent-id="…" refresh-on="page" ttl-ms="600000">
 *     <algolia-agent role="profile" agent-id="…"></algolia-agent>
 *     <algolia-agent role="events"  agent-id="…"></algolia-agent>
 *     <algolia-agent role="session" agent-id="…"></algolia-agent>
 *   </algolia-chat-person>
 */

import { chatPersonWidget } from '@algolia-central/chat-central';
import { ALGOLIA_WIDGET_ADDED, ALGOLIA_WIDGET_REMOVED } from '../instantsearch/constants';
// Side-effect: ensures <algolia-agent> is defined so person sub-agent children
// connect and publish themselves into renderState.personAgents.
import '../chat/AgentElement';

export class AlgoliaChatPersonElement extends HTMLElement {
  private widget: ReturnType<typeof chatPersonWidget> | null = null;

  /** Current InstantSearch leaf widget for the parent chat's initial sweep. */
  get instantSearchWidget(): ReturnType<typeof chatPersonWidget> | null {
    return this.widget;
  }

  static get observedAttributes(): string[] {
    return ['agent-id', 'refresh-on', 'ttl-ms'];
  }

  get personAgentId(): string {
    return this.getAttribute('agent-id')?.trim() ?? '';
  }

  get refreshOn(): 'session' | 'page' {
    return this.getAttribute('refresh-on') === 'page' ? 'page' : 'session';
  }

  get ttlMs(): number {
    const v = this.getAttribute('ttl-ms');
    if (!v) return 10 * 60 * 1000;
    const n = parseInt(v, 10);
    return isNaN(n) ? 10 * 60 * 1000 : n;
  }

  connectedCallback(): void {
    this.style.display = 'none';
    this.register();
  }

  attributeChangedCallback(_name: string, previous: string | null, next: string | null): void {
    if (!this.isConnected || previous === next) return;
    this.unregister();
    this.register();
  }

  disconnectedCallback(): void {
    this.unregister();
  }

  private register(): void {
    const agentId = this.personAgentId;
    if (!agentId) return;

    this.widget = chatPersonWidget({
      agentId,
      refreshOn: this.refreshOn,
      ttlMs: this.ttlMs,
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

if (!customElements.get('algolia-chat-person')) {
  customElements.define('algolia-chat-person', AlgoliaChatPersonElement);
}
