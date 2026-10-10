/**
 * <algolia-chat-engage> — declarative config carrier for the engagement bundle.
 *
 * Reads its attributes and publishes them as `window.ALGOLIA_CONTEXT_ENGINE_CONFIG`
 * (the legacy global the engagement bundle reads), or calls `algoliaEngage.configure()`
 * directly when the bundle exposes that method.
 *
 * Attributes:
 *   concierge-agent-id   Agent Studio UUID of the concierge agent (required for engagement)
 *   min-pages            Session pages before the concierge is consulted (default: 2)
 *   delay-ms             Milliseconds to wait after page load (default: 3000)
 *   widget-timeout-ms    Milliseconds to wait for <algolia-chat> to be ready (default: 25000)
 *   greeting-ttl-ms      Cross-page greeting TTL in milliseconds (default: 600000)
 *
 * Config priority (highest first):
 *   1. window.algoliaEngage.configure() — runtime API (after bundle loads)
 *   2. <algolia-chat-engage> attributes — declarative, parsed on connectedCallback
 *   3. window.ALGOLIA_CONTEXT_ENGINE_CONFIG — legacy global, read as last resort
 *
 * Example:
 *   <algolia-chat>
 *     <algolia-chat-engage
 *       concierge-agent-id="abc-123"
 *       min-pages="1"
 *       delay-ms="2000">
 *     </algolia-chat-engage>
 *   </algolia-chat>
 */

interface EngageElementConfig {
  conciergeAgentId?: string;
  minPages?: number;
  analysisDelayMs?: number;
  widgetTimeoutMs?: number;
  greetingTtlMs?: number;
}

function readLegacy(): EngageElementConfig {
  try {
    const g = (window as unknown as Record<string, unknown>).ALGOLIA_CONTEXT_ENGINE_CONFIG;
    return g && typeof g === 'object' ? g : {};
  } catch {
    return {};
  }
}

function applyConfig(config: EngageElementConfig): void {
  const engage = (window as unknown as Record<string, unknown>).algoliaEngage as
    { configure?: (cfg: EngageElementConfig) => void } | undefined;
  if (typeof engage?.configure === 'function') {
    engage.configure(config);
    return;
  }
  const merged = { ...readLegacy(), ...config };
  (window as unknown as Record<string, unknown>).ALGOLIA_CONTEXT_ENGINE_CONFIG = merged;
}

function numAttr(el: Element, name: string): number | undefined {
  const v = el.getAttribute(name);
  if (!v) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export class AlgoliaChatEngageElement extends HTMLElement {
  static get observedAttributes(): string[] {
    return ['concierge-agent-id', 'min-pages', 'delay-ms', 'widget-timeout-ms', 'greeting-ttl-ms'];
  }

  connectedCallback(): void {
    this.style.display = 'none';
    applyConfig(this._readConfig());
  }

  attributeChangedCallback(_name: string, previous: string | null, next: string | null): void {
    if (!this.isConnected || previous === next) return;
    applyConfig(this._readConfig());
  }

  private _readConfig(): EngageElementConfig {
    const cfg: EngageElementConfig = {};
    const id = this.getAttribute('concierge-agent-id');
    if (id) cfg.conciergeAgentId = id;
    const mp = numAttr(this, 'min-pages');
    if (mp !== undefined) cfg.minPages = mp;
    const d = numAttr(this, 'delay-ms');
    if (d !== undefined) cfg.analysisDelayMs = d;
    const wt = numAttr(this, 'widget-timeout-ms');
    if (wt !== undefined) cfg.widgetTimeoutMs = wt;
    const gt = numAttr(this, 'greeting-ttl-ms');
    if (gt !== undefined) cfg.greetingTtlMs = gt;
    return cfg;
  }
}

if (!customElements.get('algolia-chat-engage')) {
  customElements.define('algolia-chat-engage', AlgoliaChatEngageElement);
}
