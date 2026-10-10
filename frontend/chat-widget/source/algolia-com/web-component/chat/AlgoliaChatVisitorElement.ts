/**
 * <algolia-chat-visitor> — declarative config carrier for the visitor tracker.
 *
 * Reads its attributes and publishes them to `window.algoliaTracker` (when
 * the tracker bundle is present) or applies them as `window.ALGOLIA_VISITOR_CONFIG`
 * for the legacy visitor-data script.
 *
 * Attributes:
 *   consent-group     OneTrust / consent-manager category (e.g. "C0003")
 *   cookie-name       Cookie whose value is used as the user identity (default: "_ALGOLIA")
 *   region            Algolia data-centre region for personalization ("us" | "eu")
 *   proxy-url         Backend proxy for Advanced Personalization API calls
 *
 * Config priority (highest first):
 *   1. window.algoliaTracker.configure() — runtime API (after bundle loads)
 *   2. <algolia-chat-visitor> attributes — declarative, parsed on connectedCallback
 *   3. window.ALGOLIA_VISITOR_CONFIG — legacy global, read as last resort
 *
 * Example:
 *   <algolia-chat>
 *     <algolia-chat-visitor consent-group="C0003" cookie-name="_MY_SITE"></algolia-chat-visitor>
 *   </algolia-chat>
 */

interface VisitorElementConfig {
  consentGroup?: string;
  cookieName?: string;
  region?: string;
  proxyUrl?: string;
}

function readLegacy(): VisitorElementConfig {
  try {
    const g = (window as unknown as Record<string, unknown>).ALGOLIA_VISITOR_CONFIG;
    return g && typeof g === 'object' ? g : {};
  } catch {
    return {};
  }
}

function applyConfig(config: VisitorElementConfig): void {
  const tracker = (window as unknown as Record<string, unknown>).algoliaTracker as
    { configure?: (cfg: VisitorElementConfig) => void } | undefined;
  if (typeof tracker?.configure === 'function') {
    tracker.configure(config);
    return;
  }
  // Fall back to the legacy global that algolia-chat-visitor-data.js reads.
  const merged = { ...readLegacy(), ...config };
  (window as unknown as Record<string, unknown>).ALGOLIA_VISITOR_CONFIG = merged;
}

export class AlgoliaChatVisitorElement extends HTMLElement {
  static get observedAttributes(): string[] {
    return ['consent-group', 'cookie-name', 'region', 'proxy-url'];
  }

  connectedCallback(): void {
    this.style.display = 'none';
    applyConfig(this._readConfig());
  }

  attributeChangedCallback(_name: string, previous: string | null, next: string | null): void {
    if (!this.isConnected || previous === next) return;
    applyConfig(this._readConfig());
  }

  private _readConfig(): VisitorElementConfig {
    const cfg: VisitorElementConfig = {};
    const g = this.getAttribute('consent-group');
    if (g) cfg.consentGroup = g;
    const c = this.getAttribute('cookie-name');
    if (c) cfg.cookieName = c;
    const r = this.getAttribute('region');
    if (r) cfg.region = r;
    const p = this.getAttribute('proxy-url');
    if (p) cfg.proxyUrl = p;
    return cfg;
  }
}

if (!customElements.get('algolia-chat-visitor')) {
  customElements.define('algolia-chat-visitor', AlgoliaChatVisitorElement);
}
