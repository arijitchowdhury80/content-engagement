/**
 * <algolia-chat> — the embeddable custom element.
 *
 * In the two-tier InstantSearch topology this element acts as the MAIN WIDGET
 * and sub-orchestrator:
 *
 *  1. It creates the `chatWidget` (connectChat + React renderer) and bubbles
 *     `algolia-widget-added` up to the parent `<algolia-instant-search>` root,
 *     which registers it with the IS instance via search.addWidgets([widget]).
 *
 *  2. It listens for `algolia-widget-added` / `algolia-widget-removed` events
 *     bubbled from its own children (e.g. <algolia-agent>,
 *     <algolia-chat-confidence>) and forwards those widgets to the
 *     InstantSearch instance captured from the IS lifecycle `init` options.
 *
 *  3. For backward compat: when `judge-*` attributes are present on
 *     `<algolia-chat>` itself (or a `<algolia-confidence-badge slot="judge">`)
 *     it internally creates a `chatConfidenceWidget` and adds it to IS after
 *     init. This means the attribute-based judge path is unified with the
 *     declarative `<algolia-chat-confidence>` child-element path — both end up
 *     in `renderState.chatConfidence` and are read by useJudge via context.
 *
 * ## Attribute reference
 *
 * ## Reconfiguring a mounted widget
 *
 * Every attribute below is observed. Display/branding/copy attributes are applied
 * live — change one and the panel re-renders, no remount needed. Credential
 * attributes (`app-id`, `search-api-key`/`api-key`, `index-name`) are structural:
 * the search client and agent transport are built from them once, so a later
 * change is reported in the console and ignored.
 *
 * ### Credentials (only needed without a parent <algolia-instant-search>)
 *   app-id              Algolia Application ID
 *   search-api-key      Browser-safe SEARCH-ONLY API key (never the admin key).
 *                       `api-key` is accepted as an alias, matching the name the
 *                       root <algolia-instant-search> element uses.
 *   index-name          Algolia index name
 *
 * ### Agents
 *   agents              JSON object declaring the agents inline, as an alternative
 *                       to <algolia-agent> children:
 *                         {"primary":{"id":"…","label":"Assistant"},
 *                          "classifier":{"id":"…"},
 *                          "specialists":[{"key":"code","id":"…","label":"Code expert"}]}
 *
 * ### Branding / copy
 *   brand-name          Company name used in aria-labels
 *   product-title       Header title
 *   subtitle            One-line subtitle below the title
 *   corpus-name         Human name of the corpus (used in empty-state heading)
 *   disclaimer          Short trust disclaimer in the empty state
 *   canonical-base-url  Real production origin (e.g. https://www.algolia.com) that
 *                       source records' relative URLs resolve against — prevents
 *                       source-pill links resolving against a staging/preview host
 *   logo                URL for the header logo
 *   logo-mark           URL for the small brand mark; defaults to `logo`. Can also
 *                       be set via <img slot="logo-mark">.
 *   powered-by-label    Attribution text. Omit it (and powered-by-logo) to show
 *                       no attribution at all.
 *   powered-by-logo     URL for the attribution logo
 *   accent-color        Hex accent color — overrides --algolia-accent + siblings
 *   font-href           Stylesheet URL for a web font, injected into
 *                       document.head. No font is loaded by default; a theme's
 *                       typography.fontHref is used when this is absent.
 *   theme               Named theme preset. Any string registered via
 *                       registerTheme() or window.algoliaChat.registerTheme()
 *                       also works. Omit it for the neutral token defaults; an
 *                       unknown name warns and renders neutral. Supply a JSON
 *                       slot (see below) or theme-src for a fully custom
 *                       design system.
 *   icons               JSON map of icon overrides for the built-in glyphs:
 *                       {"close":"…","minimize":"…","expand":"…","restore":"…",
 *                        "sparkle":"…","fabSpinner":"…"}. Each value is an
 *                       image URL; omitted entries keep the built-in SVG.
 *   record-fields       JSON map naming the attributes that carry a record's
 *                       title, link and body text, for an index that does not
 *                       use the usual spellings:
 *                       {"title":["display_name"],"url":["marketing_url"],
 *                        "text":["overview"]}. Each list is tried ahead of the
 *                       built-in candidates, so name only what is unusual.
 *                       Records that match none of these are not treated as
 *                       citable hits at all, which leaves the judges with no
 *                       sources and floors every grounding score.
 *   theme-src           URL of a JSON file containing a ChatTheme token object.
 *                       Fetched asynchronously; first paint uses the token
 *                       defaults until the fetch resolves. Attribute changes
 *                       trigger a re-fetch and restyle.
 *   user-avatar         URL of the signed-in user's profile image; rendered as a
 *                       circular avatar next to every user prompt bubble. Falls back
 *                       to an anonymous person icon when omitted. Can also be set
 *                       via <img slot="user-avatar"> child.
 *   new-chat-icon       URL of the icon shown on the header "New conversation"
 *                       button. Falls back to the widget's built-in glyph when
 *                       omitted. Can also be set via <img slot="new-chat-icon">
 *                       child.
 *   default-open-mode   "normal" | "docked" | "maximized" — the window size mode
 *                       the panel opens in for first-time visitors (no saved
 *                       localStorage preference). Once the user explicitly changes
 *                       the mode via the header controls their choice is persisted
 *                       and takes priority on all future visits.
 *   show-welcome        "false" hides the empty-state welcome hero (default
 *                       eyebrow/heading/description or the <div slot="welcome">
 *                       projection). Sample-question chips and the disclaimer
 *                       still render. Defaults to shown when omitted.
 *   launcher-icon       URL of the icon shown on the collapsed launcher button.
 *                       Falls back to a neutral chat-bubble glyph, which inherits
 *                       the button's on-accent text colour. Supply a single-colour
 *                       asset. Can also be set via <img slot="launcher-icon">
 *   auto-engage-toggle  Presence enables a header control letting the visitor turn
 *                       proactive auto-opening on or off. Hidden by default, since
 *                       it is meaningless for hosts that never call engage(). The
 *                       visitor's choice persists in localStorage and is enforced
 *                       by the widget whether or not the control is shown.
 *   auto-engage         "false" starts with proactive auto-opening off, for hosts that
 *                       prefer opt-in. Only the initial value — a stored visitor
 *                       choice always wins. Defaults to on.
 *   discovery-enabled   "true" enables commercial discovery behavior. Omit it
 *                       or set "false" to keep the widget in reactive Q&A mode.
 *                       Defaults to off.
 *   analyzing-timeout   Milliseconds before a stuck analyzing indicator clears itself
 *                       (default 30000). Raise it when an upstream decision may take
 *                       longer than the default.
 *
 * ### Custom design system
 *   Three ways to supply a full custom theme (use whichever fits your stack):
 *
 *   1. JSON slot — inline ChatTheme object, no HTTP round-trip:
 *        <algolia-chat>
 *          <script type="application/json" slot="theme">
 *            { "color": { "accent": "#e2361b", "surface": "#ffffff" },
 *              "radius": { "xl": "4px" } }
 *          </script>
 *        </algolia-chat>
 *
 *   2. Remote URL — ChatTheme JSON served from any URL:
 *        <algolia-chat theme-src="/themes/acme.json">
 *
 *   3. JS registration — register a named theme before or after element upgrade:
 *        // In a script tag that runs before the widget bundle:
 *        window.algoliaChat = window.algoliaChat || {};
 *        window.algoliaChat.registerTheme = window.algoliaChat.registerTheme || [];
 *        window.algoliaChat.registerTheme.push(['acme', { color: { accent: '#e2361b' } }]);
 *        // then:
 *        <algolia-chat theme="acme">
 *
 *   4. Raw CSS override (back-compat) — applied after the compiled skin:
 *        <algolia-chat>
 *          <style slot="theme">
 *            :host { --algolia-accent: #e2361b; --algolia-radius-xl: 4px; }
 *          </style>
 *        </algolia-chat>
 *
 *   5. Inline custom properties — highest specificity, no rebuild needed:
 *        <algolia-chat style="--algolia-accent:#e2361b;">
 *   Inline styles beat the injected :host rule and work for any --algolia-* token.
 *
 * ### Judge / confidence (backward-compat; prefer <algolia-chat-confidence> child)
 *   judge-mode          "hosted" | "algolia" | "off" (default "hosted")
 *   judge-url           Hosted judge service base URL
 *   judge-api-key       Auth key for the hosted judge service
 *   judge-agent-id      Agent Studio UUID for in-browser judging (mode=algolia)
 *
 * ### Content
 *   sample-questions    JSON array of { section, questions[] } groups
 *   sample-questions-group-cap
 *                       How many of those groups contribute empty-state chips
 *                       (default 3). The popover always shows every group.
 *   sample-questions-per-group
 *                       How many questions to take from each contributing group
 *                       for the empty-state chips (default 1).
 *   source-facets       JSON array of { value, label } source facet mappings
 *   source-display      JSON object with source-pill display rules:
 *                       {"titleSuffixPattern":"…","releaseNoteUrlPattern":"…",
 *                        "releaseNoteTitleWordPattern":"…"}. Also accepts a
 *                       <script type="application/json" slot="source-display"> child.
 *                       When absent, titles render unchanged and no pills collapse.
 *   strings             JSON object with DeepPartial<WidgetStrings> overrides
 *
 * ### Backward-compat: when <algolia-chat> has no <algolia-instant-search> ancestor
 * it creates its own minimal IS instance using the credential attributes above.
 *
 * Usage (two-tier — preferred):
 *   <algolia-instant-search app-id="X" api-key="Y" index-name="Z">
 *     <algolia-chat accent-color="#003DFF" product-title="Content Assistant">
 *       <algolia-agent role="primary" agent-id="..."></algolia-agent>
 *       <algolia-chat-confidence mode="hosted" url="..." api-key="...">
 *       </algolia-chat-confidence>
 *     </algolia-chat>
 *   </algolia-instant-search>
 *
 * Usage (single-element — backward-compat):
 *   <algolia-chat app-id="X" search-api-key="Y" index-name="Z"
 *                judge-mode="hosted" judge-url="..." judge-api-key="...">
 *     <algolia-agent role="primary" agent-id="..."></algolia-agent>
 *   </algolia-chat>
 */

// Side-effect: registers all custom elements.
import './instantsearch/InstantSearchElement';
import './chat/AgentElement';
import './chat/ConfidenceElement';
import './chat/AlgoliaChatVisitorElement';
import './chat/AlgoliaChatEngageElement';
import './chat/AlgoliaChatFormElement';
import './person/ChatPersonElement';

// ── Widget engine & style helpers (from chat-central) ─────────────────────────
import {
  chatWidget,
  chatConfidenceWidget,
  applyRuntimeConfig,
  applyRootConfig,
  buildWidgetStyles,
  ensureWidgetFont,
  resolveWidgetFontHref,
  proactiveStore,
  visitorContextStore,
  setVisitorDataSource,
  defaultInstance,
  registerTheme,
  registerHostTool,
  setOrchestratorTransport,
  toolUIGate,
  subscribeToRegistry,
  type ChatTheme,
  type VisitorDataSource,
  type VisitorContextProvider,
  type WidgetApi,
  type RuntimeConfig,
  type ChatConfidenceWidgetParams,
  type JudgeMode,
  type JudgeAgentDescriptor,
  type InstanceConfig,
  type InstanceAgentDescriptor,
  type AgentsConfig,
  type SourceFacet,
  type SourceDisplayConfig,
  type DeepPartial,
  type WidgetStrings,
  type WidgetIcons,
  type ChatSizeMode,
} from '@algolia-central/chat-central';
import { ALGOLIA_WIDGET_ADDED, ALGOLIA_WIDGET_REMOVED } from './instantsearch/constants';
import { resolveDiscoveryEnabled } from './chat/discoveryOverride';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function attr(el: Element, name: string): string | undefined {
  const v = el.getAttribute(name);
  return v && v.trim() ? v.trim() : undefined;
}

function tryParseJsonArray<T>(json: string): T[] | undefined {
  try {
    const parsed: unknown = JSON.parse(json);
    if (Array.isArray(parsed)) return parsed as T[];
  } catch {
    /* fall through */
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Config parsing — attributes + declarative child elements (slots).
// ---------------------------------------------------------------------------

function parseSampleQuestions(el: Element): InstanceConfig['sampleQuestions'] | undefined {
  const json = attr(el, 'sample-questions');
  if (json) {
    const parsed = tryParseJsonArray<InstanceConfig['sampleQuestions'][number]>(json);
    if (parsed) return parsed;
  }
  const container = el.querySelector('[slot="sample-questions"]');
  if (!container) return undefined;
  const sections = Array.from(container.querySelectorAll('section'));
  const groups = sections
    .map((section) => ({
      section: section.getAttribute('data-title') ?? '',
      questions: Array.from(section.querySelectorAll('button, li, a'))
        .map((q) => q.textContent?.trim() ?? '')
        .filter(Boolean),
    }))
    .filter((g) => g.questions.length > 0);
  return groups.length ? groups : undefined;
}

function parseSourceFacets(el: Element): SourceFacet[] | undefined {
  const json = attr(el, 'source-facets');
  if (json) {
    const parsed = tryParseJsonArray<SourceFacet>(json);
    if (parsed) return parsed;
  }
  const container = el.querySelector('[slot="source-facets"]');
  if (!container) return undefined;
  const facets = Array.from(container.querySelectorAll('[data-value]'))
    .map((node) => ({
      value: node.getAttribute('data-value') ?? '',
      label: node.textContent?.trim() || node.getAttribute('data-value') || '',
    }))
    .filter((f) => f.value);
  return facets.length ? facets : undefined;
}

function parseLogo(el: Element): string | undefined {
  const fromAttr = attr(el, 'logo');
  if (fromAttr) return fromAttr;
  const img = el.querySelector('img[slot="logo"], [slot="logo"] img');
  const fromSlot = img?.getAttribute('src');
  if (fromSlot) return fromSlot;
  const configuredDefault = (window as typeof window & {
    algoliaChat?: { defaultLogo?: unknown };
  }).algoliaChat?.defaultLogo;
  return typeof configuredDefault === 'string' ? configuredDefault : undefined;
}

/** Read the small brand mark from `logo-mark` or an `<img slot="logo-mark">`
 *  child. Falls back to the header logo, since one asset serving both is the
 *  common case and was the only thing possible before this attribute existed. */
function parseLogoMark(el: Element): string | undefined {
  const fromAttr = attr(el, 'logo-mark');
  if (fromAttr) return fromAttr;
  const img = el.querySelector('img[slot="logo-mark"]');
  return img?.getAttribute('src') ?? parseLogo(el);
}

/** Read the user avatar URL from the `user-avatar` attribute or an
 *  `<img slot="user-avatar">` child element. */
function parseUserAvatar(el: Element): string | undefined {
  const fromAttr = attr(el, 'user-avatar');
  if (fromAttr) return fromAttr;
  const img = el.querySelector('img[slot="user-avatar"]');
  return img?.getAttribute('src') ?? undefined;
}

/** Read the "New conversation" button icon URL from the `new-chat-icon`
 *  attribute or an `<img slot="new-chat-icon">` child element. */
function parseNewChatIcon(el: Element): string | undefined {
  const fromAttr = attr(el, 'new-chat-icon');
  if (fromAttr) return fromAttr;
  const img = el.querySelector('img[slot="new-chat-icon"]');
  return img?.getAttribute('src') ?? undefined;
}

/** Read the collapsed launcher button icon from the `launcher-icon` attribute or
 *  an `<img slot="launcher-icon">` child element. */
function parseLauncherIcon(el: Element): string | undefined {
  const fromAttr = attr(el, 'launcher-icon');
  if (fromAttr) return fromAttr;
  const img = el.querySelector('img[slot="launcher-icon"]');
  return img?.getAttribute('src') ?? undefined;
}

/** Parse a boolean attribute that defaults to true when absent, e.g. `auto-engage`.
 *  Presence with no value means true; only an explicit "false" disables it.
 *  Returning undefined for an absent attribute matters: the config merge then
 *  keeps whatever is already configured instead of forcing a default back on. */
function parseBoolAttr(el: Element, name: string): boolean | undefined {
  if (!el.hasAttribute(name)) return undefined;
  return attr(el, name) !== 'false';
}

/**
 * Read a ChatTheme object from a
 * `<script type="application/json" slot="theme">` child element.
 * Mirrors the `parseStrings` JSON-slot pattern.
 */
function parseThemeObject(el: Element): ChatTheme | undefined {
  const scriptEl = el.querySelector<HTMLScriptElement>(
    'script[type="application/json"][slot="theme"]',
  );
  if (!scriptEl?.textContent) return undefined;
  try {
    return JSON.parse(scriptEl.textContent) as ChatTheme;
  } catch {
    console.warn(
      '[algolia-chat] Could not parse <script type="application/json" slot="theme"> — invalid JSON.',
    );
    return undefined;
  }
}

/**
 * Parse an attribute that must be a positive number (a count, or a duration in
 * ms). Junk values are ignored rather than coerced, so a typo can never disable
 * a safety timeout by turning it into 0.
 */
function parsePositiveNumberAttr(el: Element, name: string): number | undefined {
  const raw = attr(el, name);
  if (!raw) return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    console.warn(`[algolia-chat] Ignoring ${name}="${raw}" — expected a positive number.`);
    return undefined;
  }
  return value;
}

/**
 * Parse an attribute that must be a count (0 or more) — unlike
 * parsePositiveNumberAttr, 0 is a valid, meaningful value here (e.g. "show no
 * empty-state chips"), not a footgun.
 */
function parseNonNegativeNumberAttr(el: Element, name: string): number | undefined {
  const raw = attr(el, name);
  if (!raw) return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    console.warn(`[algolia-chat] Ignoring ${name}="${raw}" — expected a non-negative number.`);
    return undefined;
  }
  return value;
}

/**
 * Parse the `icons` JSON attribute into a WidgetIcons map.
 *
 * Example:
 *   <algolia-chat icons='{"close":"/icons/x.svg","sparkle":"/icons/star.svg"}'>
 */
function parseIconsAttr(el: Element): WidgetIcons | undefined {
  // Every WidgetIcons field is an optional string, so any plain object is a
  // valid partial map; unknown keys are simply never read.
  return parseJsonObjectAttr(el, 'icons');
}

/** Parse a JSON-object-valued attribute, warning on anything that is not one. */
function parseJsonObjectAttr(el: Element, name: string): Record<string, unknown> | undefined {
  const raw = attr(el, name);
  if (!raw) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    console.warn(`[algolia-chat] Ignoring ${name} attribute — expected a JSON object:`, raw);
  } catch {
    console.warn(`[algolia-chat] Ignoring ${name} attribute — not valid JSON:`, raw);
  }
  return undefined;
}

/** Read one record-fields entry as a list of attribute names. A bare string is
 *  the obvious shorthand when the index has only one candidate. */
function parseFieldNameList(key: string, value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  const raw = typeof value === 'string' ? [value] : value;
  const names = Array.isArray(raw) ? raw.filter((f): f is string => typeof f === 'string') : [];
  if (names.length) return names;
  console.warn(
    `[algolia-chat] Ignoring record-fields.${key} — expected a string or array of strings.`,
  );
  return undefined;
}

/**
 * Parse the `record-fields` JSON attribute into a partial field map.
 *
 * Example:
 *   <algolia-chat record-fields='{"title":["display_name"],"url":["marketing_url"]}'>
 */
function parseRecordFieldsAttr(el: Element): RuntimeConfig['recordFields'] {
  const source = parseJsonObjectAttr(el, 'record-fields');
  if (!source) return undefined;

  const map: RuntimeConfig['recordFields'] = {};
  for (const key of ['title', 'url', 'text'] as const) {
    const names = parseFieldNameList(key, source[key]);
    if (names) map[key] = names;
  }
  return Object.keys(map).length ? map : undefined;
}

/**
 * Parse `source-display` from a JSON attribute or an inline JSON slot.
 *
 * Attribute form (compact, useful for small configs):
 *   <algolia-chat source-display='{"titleSuffixPattern":"..."}'>
 *
 * Slot form (readable for larger configs):
 *   <algolia-chat>
 *     <script type="application/json" slot="source-display">
 *       { "titleSuffixPattern": "...", "releaseNoteUrlPattern": "..." }
 *     </script>
 *   </algolia-chat>
 */
function parseSourceDisplay(el: Element): SourceDisplayConfig | undefined {
  // Attribute takes precedence over slot when both are present.
  const fromAttr = parseJsonObjectAttr(el, 'source-display');
  const raw: Record<string, unknown> | undefined =
    fromAttr ??
    (() => {
      const slot = el.querySelector('script[type="application/json"][slot="source-display"]');
      if (!slot?.textContent?.trim()) return undefined;
      try {
        const parsed: unknown = JSON.parse(slot.textContent);
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
          return parsed as Record<string, unknown>;
        }
      } catch {
        console.warn('[algolia-chat] source-display slot contains invalid JSON — ignoring.');
      }
      return undefined;
    })();

  if (!raw) return undefined;

  const cfg: SourceDisplayConfig = {};
  if (typeof raw.titleSuffixPattern === 'string') cfg.titleSuffixPattern = raw.titleSuffixPattern;
  if (typeof raw.releaseNoteUrlPattern === 'string')
    cfg.releaseNoteUrlPattern = raw.releaseNoteUrlPattern;
  if (typeof raw.releaseNoteTitleWordPattern === 'string')
    cfg.releaseNoteTitleWordPattern = raw.releaseNoteTitleWordPattern;
  return Object.keys(cfg).length ? cfg : undefined;
}

/** Read the contents of a `<style slot="theme">` child element to use as a
 *  custom design-system skin injected after the bundled skin in the shadow DOM.
 *  Returns undefined when no such child is present. */
function parseCustomSkinCss(el: Element): string | undefined {
  const styleEl = el.querySelector('style[slot="theme"]');
  const text = styleEl?.textContent?.trim();
  return text || undefined;
}

/**
 * Build the logo + powered-by branding subset from element attributes.
 * The `powered-by-label` attribute sets the attribution footer text;
 * `powered-by-logo` supplies a custom attribution logo URL.
 * Without either the footer renders nothing — implementing sites should
 * supply a label via this attribute or the host template.
 */
function buildBranding(el: Element): RuntimeConfig['branding'] {
  const b: NonNullable<RuntimeConfig['branding']> = {};
  const logo = parseLogo(el);
  const mark = parseLogoMark(el);
  const poweredByLogo = attr(el, 'powered-by-logo');
  const poweredByLabel = attr(el, 'powered-by-label');
  if (logo || mark) b.logo = { header: logo, mark };
  if (poweredByLogo || poweredByLabel) {
    b.poweredBy = {};
    if (poweredByLabel) b.poweredBy.label = poweredByLabel;
    if (poweredByLogo) b.poweredBy.logo = poweredByLogo;
  }
  return Object.keys(b).length ? b : undefined;
}

// ---------------------------------------------------------------------------
// Agents — JSON attribute alternative to <algolia-agent> children
// ---------------------------------------------------------------------------

/** One agent as written in the `agents` attribute: an id, plus optional
 *  presentation. `key` is required for specialists (it is their routing slug). */
interface AgentJson {
  id?: string;
  key?: string;
  label?: string;
  accentToken?: string;
}

interface AgentsJson {
  primary?: AgentJson;
  classifier?: AgentJson;
  specialists?: AgentJson[];
}

/** Per-key specialist accent token — mirrors `AgentElement`'s derivation so a
 *  specialist declared via the `agents` JSON attribute gets the same
 *  distinct-by-key colour as one declared via `<algolia-agent>`, instead of
 *  every specialist sharing one generic token. The render layer falls back
 *  to `--algolia-agent-specialist` for any key a host theme leaves unstyled. */
function specialistAccentToken(key: string): string {
  return `--algolia-agent-specialist-${key}`;
}

/**
 * Normalise one JSON entry into a full descriptor, defaulting the presentation
 * fields from `defaultInstance` so fallback copy stays in one place. Returns
 * null when there is no usable agent id.
 */
function trimmedOr(value: string | undefined, fallback: string): string {
  return value?.trim() || fallback;
}

function toAgentDescriptor(
  src: AgentJson | undefined,
  key: string,
  fallbackLabel: string,
  accentToken: string,
): InstanceAgentDescriptor | null {
  const id = src?.id?.trim();
  if (!id) return null;
  return {
    id,
    key,
    label: trimmedOr(src?.label, fallbackLabel),
    accentToken: trimmedOr(src?.accentToken, accentToken),
  };
}

function toSpecialistDescriptors(list: AgentJson[] | undefined): InstanceAgentDescriptor[] {
  const out: InstanceAgentDescriptor[] = [];
  for (const entry of list ?? []) {
    const key = entry.key?.trim();
    if (!key) {
      console.warn('[algolia-chat] Skipping a specialist in `agents` — it needs a `key`.');
      continue;
    }
    const descriptor = toAgentDescriptor(entry, key, key, specialistAccentToken(key));
    if (descriptor) out.push(descriptor);
    else console.warn(`[algolia-chat] Skipping specialist "${key}" in \`agents\` — no \`id\`.`);
  }
  return out;
}

/**
 * Parse the `agents` attribute — the declarative alternative to
 * `<algolia-agent>` children:
 *
 *   agents='{"primary":{"id":"…","label":"Assistant"},
 *            "classifier":{"id":"…"},
 *            "specialists":[{"key":"code","id":"…","label":"Code expert"}]}'
 *
 * `RuntimeConfig.agents` existed but nothing populated it, so `activeInstance`'s
 * agents — the fallback `useChat` uses when there is no InstantSearch render
 * state — were unreachable from HTML. Child elements remain the richer path
 * (they participate in the IS lifecycle); this covers hosts that would rather
 * configure everything in one place, e.g. from a CMS-rendered attribute.
 */
function parseAgentsJson(raw: string): AgentsJson | null {
  try {
    return JSON.parse(raw) as AgentsJson;
  } catch {
    console.warn('[algolia-chat] Could not parse the `agents` attribute as JSON — ignoring it.');
    return null;
  }
}

function classifierFallbackLabel(): string {
  return defaultInstance.agents.classifier?.label ?? 'Classifier';
}

function parseAgents(el: Element): Partial<AgentsConfig> | undefined {
  const raw = attr(el, 'agents');
  if (!raw) return undefined;

  const parsed = parseAgentsJson(raw);
  if (!parsed) return undefined;

  const out: Partial<AgentsConfig> = {};
  const primary = toAgentDescriptor(
    parsed.primary,
    'primary',
    defaultInstance.agents.primary.label,
    defaultInstance.agents.primary.accentToken,
  );
  if (primary) out.primary = primary;

  const classifier = toAgentDescriptor(
    parsed.classifier,
    'classifier',
    classifierFallbackLabel(),
    defaultInstance.agents.primary.accentToken,
  );
  if (classifier) out.classifier = classifier;

  const specialists = toSpecialistDescriptors(parsed.specialists);
  if (specialists.length) out.specialists = specialists;

  return Object.keys(out).length ? out : undefined;
}

function parseStrings(el: Element): DeepPartial<WidgetStrings> | undefined {
  const fromAttr = attr(el, 'strings');
  if (fromAttr) {
    try {
      return JSON.parse(fromAttr) as DeepPartial<WidgetStrings>;
    } catch {
      /* fall through */
    }
  }
  const scriptEl = el.querySelector('script[type="application/json"][slot="strings"]');
  if (scriptEl?.textContent) {
    try {
      return JSON.parse(scriptEl.textContent) as DeepPartial<WidgetStrings>;
    } catch {
      /* fall through */
    }
  }
  return undefined;
}

function isSizeMode(value: unknown): value is ChatSizeMode {
  return value === 'docked' || value === 'normal' || value === 'maximized';
}

/**
 * Build the display/UX `RuntimeConfig` from element attributes and slots.
 * Credentials (app-id, search-api-key, index-name) are parsed separately and
 * applied via `applyRootConfig`; this object only carries visual configuration.
 */
function readDisplayConfig(el: Element): RuntimeConfig {
  const rawOpenMode = attr(el, 'default-open-mode');
  const defaultOpenMode: InstanceConfig['defaultOpenMode'] | undefined = isSizeMode(rawOpenMode)
    ? rawOpenMode
    : undefined;

  return {
    brandName: attr(el, 'brand-name'),
    productTitle: attr(el, 'product-title'),
    subtitle: attr(el, 'subtitle'),
    corpusName: attr(el, 'corpus-name'),
    disclaimer: attr(el, 'disclaimer'),
    canonicalBaseUrl: attr(el, 'canonical-base-url'),
    // Passed through as written; buildWidgetStyles reports an unknown name.
    theme: attr(el, 'theme'),
    branding: buildBranding(el),
    agents: parseAgents(el),
    sampleQuestions: parseSampleQuestions(el),
    sourceFacets: parseSourceFacets(el),
    strings: parseStrings(el),
    welcome: {
      present: !!el.querySelector('[slot="welcome"]'),
      // Parsed like every other boolean attribute, so leaving it off keeps the
      // current value instead of re-asserting the default on each re-read.
      show: parseBoolAttr(el, 'show-welcome'),
    },
    userAvatar: parseUserAvatar(el),
    newChatIcon: parseNewChatIcon(el),
    launcherIcon: parseLauncherIcon(el),
    defaultOpenMode,
    // Presence-style boolean: `auto-engage-toggle` or `auto-engage-toggle="true"`
    // enables it; omit the attribute (or set "false") to hide the control.
    autoEngageToggle: parseBoolAttr(el, 'auto-engage-toggle'),
    autoEngage: parseBoolAttr(el, 'auto-engage'),
    discoveryEnabled: resolveDiscoveryEnabled(parseBoolAttr(el, 'discovery-enabled')),
    analyzingTimeoutMs: parsePositiveNumberAttr(el, 'analyzing-timeout'),
    sampleQuestionsGroupCap: parseNonNegativeNumberAttr(el, 'sample-questions-group-cap'),
    sampleQuestionsPerGroup: parseNonNegativeNumberAttr(el, 'sample-questions-per-group'),
    icons: parseIconsAttr(el),
    recordFields: parseRecordFieldsAttr(el),
    sourceDisplay: parseSourceDisplay(el),
  };
}

// ---------------------------------------------------------------------------
// Credentials
// ---------------------------------------------------------------------------

interface Credentials {
  appId: string;
  searchKey: string;
  indexName: string;
}

/**
 * Resolve credentials from attributes, then build-time env as a dev-harness
 * fallback.
 *
 * `api-key` is accepted as an alias of `search-api-key`: the root
 * `<algolia-instant-search>` element names the same value `api-key`, and having
 * to remember which element wants which spelling is a needless trap. Both
 * elements now take either.
 *
 * One resolver for every caller — `tryAutoWrapInRoot` used to read the key from
 * the attribute only, so an embed relying on `VITE_ALGOLIA_SEARCH_API_KEY`
 * silently generated a root element with an empty key.
 */
function readCredentials(el: Element): Credentials {
  const env: Record<string, string | undefined> = import.meta.env ?? {};
  return {
    appId: attr(el, 'app-id') ?? env.VITE_ALGOLIA_APP_ID ?? '',
    searchKey:
      attr(el, 'search-api-key') ?? attr(el, 'api-key') ?? env.VITE_ALGOLIA_SEARCH_API_KEY ?? '',
    indexName: attr(el, 'index-name') ?? '',
  };
}

// ---------------------------------------------------------------------------
// Judge / confidence config (backward-compat attribute path)
// ---------------------------------------------------------------------------

function resolveJudgeMode(raw: string | undefined): JudgeMode {
  if (raw === 'algolia' || raw === 'off') return raw;
  return 'hosted';
}

interface JudgeRawAttrs {
  agentId?: string;
  modeRaw?: string;
  url?: string;
  apiKey?: string;
}

/** Read judge-related attributes from an element, falling back to env vars
 *  when `useEnvFallback` is true (i.e. reading from the host element itself,
 *  not from a badge child). */
function readJudgeAttrs(src: Element, useEnvFallback: boolean): JudgeRawAttrs {
  const env: Record<string, string | undefined> = import.meta.env ?? {};
  function orEnv(attrName: string, envKey: string): string | undefined {
    return attr(src, attrName) ?? (useEnvFallback ? env[envKey] : undefined);
  }
  return {
    agentId: orEnv('judge-agent-id', 'VITE_JUDGE_AGENT_ID'),
    modeRaw: orEnv('judge-mode', 'VITE_JUDGE_MODE'),
    url: orEnv('judge-url', 'VITE_JUDGE_URL'),
    apiKey: orEnv('judge-api-key', 'VITE_JUDGE_API_KEY'),
  };
}

/**
 * Parse judge/confidence config from the element's own attributes or from a
 * `<algolia-confidence-badge slot="judge">` child. Returns null when no judge
 * config is present (no `judge-*` attributes and no badge child with attrs).
 *
 * When non-null, the caller uses this to build an internal chatConfidenceWidget
 * so the attribute-based judge path joins the same renderState flow as the
 * declarative `<algolia-chat-confidence>` child element.
 */
function parseConfidenceParams(el: Element): ChatConfidenceWidgetParams | null {
  const chip = el.querySelector('algolia-confidence-badge[slot="judge"]');
  const { agentId, modeRaw, url, apiKey } = readJudgeAttrs(chip ?? el, chip === null);

  if (!agentId && !modeRaw && !url && !apiKey) return null;

  const agents: JudgeAgentDescriptor[] | undefined = agentId ? [{ id: agentId }] : undefined;
  return { mode: resolveJudgeMode(modeRaw), agents, url, apiKey };
}

// ---------------------------------------------------------------------------
// Backward-compat: self-host an IS instance when no root ancestor is present.
// ---------------------------------------------------------------------------

function hasInstantSearchAncestor(el: Element): boolean {
  return !!el.closest('algolia-instant-search');
}

function selfHostInstantSearch(
  el: AlgoliaChatElement,
  appId: string,
  apiKey: string,
  indexName: string,
): void {
  applyRootConfig({ appId, searchKey: apiKey, indexName });
  const root = document.createElement('algolia-instant-search');
  root.setAttribute('app-id', appId);
  root.setAttribute('api-key', apiKey);
  root.setAttribute('index-name', indexName);
  el.parentNode?.insertBefore(root, el);
  root.appendChild(el);
}

// ---------------------------------------------------------------------------
// <algolia-chat> element
// ---------------------------------------------------------------------------

type ISLike = {
  addWidgets: (widgets: unknown[]) => void;
  removeWidgets: (widgets: unknown[]) => void;
};

// ---------------------------------------------------------------------------
// Host-observable events
// ---------------------------------------------------------------------------

/**
 * Dispatched when a proactive greeting is surfaced via `engage()`.
 * `detail: { greeting: string; suggestions: string[] }`
 */
export const ALGOLIA_CHAT_ENGAGED = 'algolia-chat-engaged';

/**
 * Dispatched when the answering agent is switched via `setPersona()`.
 * `detail: { agentId: string | null; label: string | null }`
 */
export const ALGOLIA_CHAT_PERSONA_CHANGE = 'algolia-chat-persona-change';

/**
 * Dispatched on every chat panel open/close transition, whatever caused it
 * (launcher, Escape, backdrop click, or the imperative API).
 * `detail: { open: boolean }`
 */
export const ALGOLIA_CHAT_OPEN_CHANGE = 'algolia-chat-open-change';

/**
 * Dispatched when the visitor turns proactive auto-opening on or off.
 * `detail: { enabled: boolean }`
 */
export const ALGOLIA_CHAT_AUTO_ENGAGE_CHANGE = 'algolia-chat-auto-engage-change';

/**
 * Ref passed to the React renderer, extended with a command buffer.
 *
 * `current` is only populated by a mount effect inside <ChatWidget>, so any
 * imperative call made in the same tick as page load (a very common pattern —
 * inline scripts, module scripts, analytics-driven `engage()`) would otherwise
 * be dropped on the floor. `enqueue` runs the command immediately when the API
 * is live and buffers it otherwise, so callers never have to poll for readiness.
 *
 * The buffer intentionally survives disconnect: `tryAutoWrapInRoot` relocates
 * this element into a generated <algolia-instantsearch> root, which fires
 * disconnectedCallback mid-startup. Clearing on disconnect would silently drop
 * commands issued before that move.
 */
interface BufferedApiRef {
  current: WidgetApi | null;
  /** Run `fn` now if mounted, else replay it as soon as the API is live. */
  enqueue: (fn: (api: WidgetApi) => void) => void;
}

function createBufferedApiRef(): BufferedApiRef {
  let api: WidgetApi | null = null;
  let buffer: Array<(api: WidgetApi) => void> = [];

  return {
    get current(): WidgetApi | null {
      return api;
    },
    set current(next: WidgetApi | null) {
      api = next;
      if (!next) return;
      const pending = buffer;
      buffer = [];
      for (const fn of pending) fn(next);
    },
    enqueue(fn) {
      if (api) fn(api);
      else buffer.push(fn);
    },
  };
}

/**
 * Attributes grouped by what a change to them has to do. Every group is part of
 * `observedAttributes`, so a change is either applied or explained — the element
 * used to declare no observed attributes at all, which meant reconfiguring a
 * mounted widget did nothing and said nothing.
 */

/** Re-read into `RuntimeConfig` and re-applied; React re-renders from the store. */
const DISPLAY_ATTRS = [
  'brand-name',
  'product-title',
  'subtitle',
  'corpus-name',
  'disclaimer',
  'canonical-base-url',
  'theme',
  'theme-src',
  'logo',
  'logo-mark',
  'powered-by-label',
  'powered-by-logo',
  'agents',
  'sample-questions',
  'source-facets',
  'strings',
  'show-welcome',
  'user-avatar',
  'new-chat-icon',
  'launcher-icon',
  'icons',
  'sample-questions-group-cap',
  'sample-questions-per-group',
  'default-open-mode',
  'auto-engage-toggle',
  'auto-engage',
  'discovery-enabled',
  'analyzing-timeout',
  'record-fields',
  'source-display',
] as const;

/** Require rebuilding the injected shadow stylesheet. */
const STYLE_ATTRS = ['accent-color', 'theme', 'theme-src'] as const;

/** Structural: the IS client and transport are built from these once. */
const CREDENTIAL_ATTRS = ['app-id', 'search-api-key', 'api-key', 'index-name'] as const;

/** Rebuild the internal confidence widget (backward-compat judge path). */
const JUDGE_ATTRS = ['judge-mode', 'judge-url', 'judge-api-key', 'judge-agent-id'] as const;

const FONT_ATTR = 'font-href';

let widgetInstanceSequence = 0;

function createWidgetInstanceId(): string {
  widgetInstanceSequence += 1;
  return `algolia-chat:${widgetInstanceSequence}`;
}

class AlgoliaChatElement extends HTMLElement {
  /** Stable identity owned by this mounted custom-element instance. */
  readonly __algoliaWidgetInstanceId = createWidgetInstanceId();
  private apiRef: BufferedApiRef = createBufferedApiRef();
  private widget: ReturnType<typeof chatWidget> | null = null;
  /** The injected shadow stylesheet, kept so `accent-color`/`theme` can be re-applied. */
  private styleEl: HTMLStyleElement | null = null;
  /**
   * True once the initial config has been applied. Attribute changes before that
   * are the parser filling in the markup, not a host reconfiguring anything.
   */
  private configured = false;
  /** Internal confidence widget created from `judge-*` attributes for backward compat. */
  private internalConfidenceWidget: ReturnType<typeof chatConfidenceWidget> | null = null;
  /** Parsed confidence params from `judge-*` attributes (if any). */
  private confidenceParams: ChatConfidenceWidgetParams | null = null;
  private childAddListener: ((e: Event) => void) | null = null;
  private childRemoveListener: ((e: Event) => void) | null = null;
  /** Widgets already forwarded to this chat's InstantSearch instance. */
  private registeredChildWidgets = new Set<unknown>();
  /** IS instance captured from the connector's init() options. */
  private isInstance: ISLike | null = null;
  /** Unsubscribe from the proactive store's auto-engage mirror. */
  private unwatchAutoEngage: (() => void) | null = null;
  /**
   * ChatTheme fetched from `theme-src`. Cached here so `buildStyleText` can use
   * it synchronously after the async fetch resolves.
   */
  private remotetheme: ChatTheme | null = null;
  /**
   * Unsubscribe from registry changes — so a late `registerTheme` call on a
   * named theme this element is using triggers a stylesheet rebuild.
   */
  private unsubscribeRegistry: (() => void) | null = null;

  static get observedAttributes(): string[] {
    return [
      ...new Set<string>([
        ...DISPLAY_ATTRS,
        ...STYLE_ATTRS,
        ...CREDENTIAL_ATTRS,
        ...JUDGE_ATTRS,
        FONT_ATTR,
      ]),
    ];
  }

  /** Seed the runtime env from this element's credential attributes.
   *  Called before tryAutoWrapInRoot so the env is available before IS starts. */
  private applyCredentials(): void {
    const { appId, searchKey, indexName } = readCredentials(this);
    if (appId && searchKey) {
      applyRootConfig({ appId, searchKey, indexName });
    }
  }

  /**
   * Build the full shadow-DOM stylesheet text.
   *
   * Theme resolution priority (highest wins):
   *   1. `<script type="application/json" slot="theme">` — inline ChatTheme object
   *   2. `this.remotetheme` — fetched via `theme-src` attribute (async; populated before restyle)
   *   3. `theme` attribute — registered preset name
   *   4. Neutral token defaults (tokens.css) — no brand applied
   *
   * The resolved theme is passed to `buildWidgetStyles`. Back-compat paths
   * (`accent-color`, `<style slot="theme">`) are still applied on top.
   */
  private buildStyleText(): string {
    const inlineTheme = parseThemeObject(this);
    const themeAttr = attr(this, 'theme');

    const theme: string | ChatTheme | undefined =
      inlineTheme ?? this.remotetheme ?? themeAttr ?? undefined;

    this.applyFontHref(theme);

    return buildWidgetStyles({
      accentColor: attr(this, 'accent-color'),
      theme,
      customSkinCss: parseCustomSkinCss(this),
    });
  }

  /**
   * Load the font stylesheet for the resolved theme, unless the `font-href`
   * attribute overrides it. The explicit attribute always wins (it lets hosts
   * self-host their fonts); the theme's `typography.fontHref` is used as a
   * default when no explicit URL is set.
   */
  private applyFontHref(theme: string | ChatTheme | undefined): void {
    const explicitHref = attr(this, 'font-href');
    if (explicitHref) {
      ensureWidgetFont(explicitHref);
      return;
    }
    const themeFontHref = resolveWidgetFontHref(theme);
    if (themeFontHref) {
      ensureWidgetFont(themeFontHref);
    }
  }

  /**
   * Asynchronously fetch a ChatTheme JSON from `theme-src` and restyle.
   * Silently no-ops if the attribute is absent. Clears `this.remotetheme` when
   * the attribute is removed so the fallback to `theme` / default takes over.
   */
  private async fetchRemoteTheme(): Promise<void> {
    const src = attr(this, 'theme-src');
    if (!src) {
      this.remotetheme = null;
      return;
    }
    try {
      const res = await fetch(src);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as ChatTheme;
      this.remotetheme = json;
      if (this.styleEl) {
        this.styleEl.textContent = this.buildStyleText();
      }
    } catch (err) {
      console.warn(`[algolia-chat] Failed to fetch theme-src="${src}":`, err);
    }
  }

  /** Build the shadow DOM, inject styles, and attach the React mount point. */
  private buildShadowDOM(): HTMLElement {
    const shadow = this.shadowRoot ?? this.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = this.buildStyleText();
    shadow.appendChild(style);
    this.styleEl = style;
    const mount = document.createElement('div');
    mount.className = 'algolia-chat-root';
    shadow.appendChild(mount);
    const slot = document.createElement('slot');
    shadow.appendChild(slot);
    return mount;
  }

  /**
   * Run `fn` once this element's children exist.
   *
   * The parser upgrades a custom element at its **start tag**, so during initial
   * page parse `connectedCallback` runs before any children are available. Config
   * read from child nodes — `<img slot="logo">`, `<script slot="strings">`,
   * `<style slot="theme">`, `<algolia-chat-confidence>` — would silently come back
   * empty. Waiting for DOMContentLoaded is the reliable signal that parsing of
   * these children is complete.
   *
   * Elements created dynamically (readyState no longer "loading") already have
   * their children, so they run synchronously and keep the fast path.
   */
  private whenChildrenAvailable(fn: () => void): void {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn, { once: true });
    } else {
      fn();
    }
  }

  connectedCallback(): void {
    // Seed credentials — the parent IS element or selfHostInstantSearch will
    // also call applyRootConfig; both calls are safe (last one wins, same values).
    this.applyCredentials();

    // Backward-compat: wrap in root IS element when no ancestor exists.
    if (this.tryAutoWrapInRoot()) return;

    // Listen for descendant widgets before they upgrade, so nothing is missed.
    this.setupChildOrchestration();
    this.watchAutoEngage();

    // If this element uses a named theme, rebuild the stylesheet when that
    // theme is later registered or updated (e.g. a late registerTheme call).
    this.unsubscribeRegistry = subscribeToRegistry((name) => {
      const themeAttr = attr(this, 'theme');
      if (themeAttr === name && this.styleEl) {
        this.styleEl.textContent = this.buildStyleText();
      }
    });

    // Start fetching a remote theme early so the first paint is close to styled.
    void this.fetchRemoteTheme();

    // Config, styles, and mount all depend on child nodes, so they wait for the
    // children to exist. Both the shadow skin (theme slot, accent) and the React
    // tree are built from the resolved config, so they must follow it.
    this.whenChildrenAvailable(() => {
      if (!this.isConnected) return;
      applyRuntimeConfig(readDisplayConfig(this));
      this.confidenceParams = parseConfidenceParams(this);
      const mount = this.buildShadowDOM();
      this.widget = this.buildAndBubbleChatWidget(mount);
      // From here on, an attribute change is a host reconfiguring a live widget.
      this.configured = true;
    });
  }

  /**
   * Apply an attribute change to the mounted widget.
   *
   * Display config is re-read wholesale rather than patched per attribute: the
   * parsers already resolve attribute-or-slot for every field, so one re-read is
   * both cheaper to maintain and immune to a field being missed here.
   */
  attributeChangedCallback(name: string, previous: string | null, next: string | null): void {
    if (!this.configured || previous === next) return;
    if (this.handleNonIncrementalAttr(name)) return;
    this.applyPresentationAttr(name);
  }

  /**
   * Handle the attributes that cannot simply be re-applied: credentials are
   * baked into the client at mount, and judge config needs a widget swap.
   * Returns true when the change was fully dealt with.
   */
  private handleNonIncrementalAttr(name: string): boolean {
    if ((CREDENTIAL_ATTRS as readonly string[]).includes(name)) {
      console.warn(
        `[algolia-chat] ${name} changed after mount, but credentials are read once — ` +
          `the search client and agent transport are already built. Remove and re-insert ` +
          `<algolia-chat> (or reload) to switch application.`,
      );
      return true;
    }

    if ((JUDGE_ATTRS as readonly string[]).includes(name)) {
      this.reconfigureConfidence();
      return true;
    }

    return false;
  }

  /** Re-apply styling, font, and display config for an attribute that changed. */
  private applyPresentationAttr(name: string): void {
    if (name === 'theme-src') {
      // Trigger async fetch; stylesheet will restyle when fetch resolves.
      void this.fetchRemoteTheme();
    } else if ((STYLE_ATTRS as readonly string[]).includes(name) && this.styleEl) {
      // buildStyleText calls applyFontHref internally, so font is also refreshed.
      this.styleEl.textContent = this.buildStyleText();
    } else if (name === FONT_ATTR) {
      // Explicit font-href attribute change — re-apply without a full restyle.
      ensureWidgetFont(attr(this, FONT_ATTR));
    }
    if ((DISPLAY_ATTRS as readonly string[]).includes(name)) {
      applyRuntimeConfig(readDisplayConfig(this));
    }
  }

  /**
   * Swap the internal confidence widget for one built from the current `judge-*`
   * attributes. No-op until the IS instance exists, since `init` registers the
   * widget from `confidenceParams` anyway.
   */
  private reconfigureConfidence(): void {
    this.confidenceParams = parseConfidenceParams(this);
    if (!this.isInstance) return;

    if (this.internalConfidenceWidget) {
      try {
        this.isInstance.removeWidgets([this.internalConfidenceWidget]);
      } catch {
        // Already gone (IS disposed mid-flight) — nothing to detach.
      }
      this.internalConfidenceWidget = null;
    }
    if (!this.confidenceParams) return;
    this.internalConfidenceWidget = chatConfidenceWidget(this.confidenceParams);
    this.isInstance.addWidgets([this.internalConfidenceWidget]);
  }

  /** Wrap this element in a root IS element when none is present (backward-compat).
   *  Returns true if wrapping occurred (caller should return early). */
  private tryAutoWrapInRoot(): boolean {
    const { appId, searchKey, indexName } = readCredentials(this);
    if (!appId || hasInstantSearchAncestor(this)) return false;
    selfHostInstantSearch(this, appId, searchKey, indexName);
    return true;
  }

  /**
   * Create the chat IS widget (chatWidget defaults to the built-in ChatWidget),
   * patch its init to capture the IS instance and register the internal
   * confidence widget (if judge-* attrs are present), then bubble to the IS root.
   */
  private buildAndBubbleChatWidget(mount: HTMLElement): ReturnType<typeof chatWidget> {
    // `component` is omitted — chatWidget defaults to the built-in ChatWidget.
    // `hostElement` is this custom element so the React tree can discover
    // light-DOM slot children and templates via HostSlotsContext.
    const widget = chatWidget({
      container: mount,
      apiRef: this.apiRef,
      onOpenChange: (open) => this.emit(ALGOLIA_CHAT_OPEN_CHANGE, { open }),
      hostElement: this,
    });

    const widgetAny = widget as Record<string, unknown>;
    const originalInit = widgetAny.init as ((...args: unknown[]) => void) | undefined;
    widgetAny.init = (...args: unknown[]) => {
      const initOptions = args[0] as { instantSearchInstance: ISLike };
      this.isInstance = initOptions.instantSearchInstance;

      // Existing declarative children may have upgraded before <algolia-chat>
      // itself was defined. Their initial bubbling registration event therefore
      // had no parent listener. Sweep their current widgets exactly once now
      // that the real IS instance exists; dynamically added children continue
      // through the event listeners below.
      this.registerExistingChildWidgets();

      // Register the attribute-derived confidence widget now that we have the
      // IS instance. This ensures it's in renderState before the first render.
      if (this.confidenceParams) {
        this.internalConfidenceWidget = chatConfidenceWidget(this.confidenceParams);
        this.isInstance.addWidgets([this.internalConfidenceWidget]);
      }

      return originalInit?.call(widgetAny, ...args);
    };

    this.dispatchEvent(
      new CustomEvent(ALGOLIA_WIDGET_ADDED, {
        bubbles: true,
        cancelable: true,
        detail: widget,
      }),
    );

    return widget;
  }

  /** Register listeners to forward child widget events to the IS instance. */
  private setupChildOrchestration(): void {
    this.childAddListener = (e: Event) => {
      const ce = e as CustomEvent;
      if (ce.target === this) return;
      if (ce.detail && this.isInstance) {
        this.addChildWidget(ce.detail);
        ce.stopPropagation();
      }
    };

    this.childRemoveListener = (e: Event) => {
      const ce = e as CustomEvent;
      if (ce.target === this) return;
      if (ce.detail && this.isInstance) {
        this.removeChildWidget(ce.detail);
        ce.stopPropagation();
      }
    };

    this.addEventListener(ALGOLIA_WIDGET_ADDED, this.childAddListener);
    this.addEventListener(ALGOLIA_WIDGET_REMOVED, this.childRemoveListener);
  }

  private addChildWidget(widget: unknown): void {
    if (!this.isInstance || !widget || this.registeredChildWidgets.has(widget)) return;
    this.isInstance.addWidgets([widget]);
    this.registeredChildWidgets.add(widget);
  }

  private removeChildWidget(widget: unknown): void {
    if (!this.isInstance || !this.registeredChildWidgets.delete(widget)) return;
    try {
      this.isInstance.removeWidgets([widget]);
    } catch {
      // Widget may already be gone if InstantSearch was disposed mid-lifecycle.
    }
  }

  private registerExistingChildWidgets(): void {
    for (const element of this.querySelectorAll(
      'algolia-agent, algolia-chat-confidence, algolia-chat-person',
    )) {
      const widget = (element as Element & { instantSearchWidget?: unknown }).instantSearchWidget;
      if (widget) this.addChildWidget(widget);
    }
  }

  disconnectedCallback(): void {
    this.dispatchEvent(
      new CustomEvent('algolia-chat-widget-disconnected', {
        bubbles: true,
        composed: true,
        detail: { widgetInstanceId: this.__algoliaWidgetInstanceId },
      }),
    );
    if (this.childAddListener) {
      this.removeEventListener(ALGOLIA_WIDGET_ADDED, this.childAddListener);
      this.childAddListener = null;
    }
    if (this.childRemoveListener) {
      this.removeEventListener(ALGOLIA_WIDGET_REMOVED, this.childRemoveListener);
      this.childRemoveListener = null;
    }

    this.disposeInternalConfidenceWidget();

    if (this.widget) {
      this.dispatchEvent(
        new CustomEvent(ALGOLIA_WIDGET_REMOVED, {
          bubbles: true,
          cancelable: true,
          detail: this.widget,
        }),
      );
      this.widget = null;
    }
    this.isInstance = null;
    this.registeredChildWidgets.clear();
    this.styleEl = null;
    // The element may be relocated rather than discarded (see tryAutoWrapInRoot),
    // in which case connectedCallback rebuilds and re-applies config from scratch.
    this.configured = false;
    this.unwatchAutoEngage?.();
    this.unwatchAutoEngage = null;
    this.unsubscribeRegistry?.();
    this.unsubscribeRegistry = null;
    // Buffered commands are deliberately preserved — this element may be
    // relocated rather than discarded (see BufferedApiRef).
    this.apiRef.current = null;
  }

  /** Removes the internally-created confidence widget from InstantSearch when
   *  both the widget reference and an IS instance are still live. Extracted to
   *  keep disconnectedCallback within the allowed cyclomatic-complexity budget. */
  private disposeInternalConfidenceWidget(): void {
    if (!this.internalConfidenceWidget || !this.isInstance) return;
    try {
      this.isInstance.removeWidgets([this.internalConfidenceWidget]);
    } catch {
      // IS may already be disposed
    }
    this.internalConfidenceWidget = null;
  }

  // ── Imperative API (host-page scripts) ────────────────────────────────────
  //
  // Every method is safe to call before the widget has mounted — commands are
  // buffered and replayed once the React API is live (see createBufferedApiRef).

  /** Emit a host-observable event that escapes the shadow boundary. */
  private emit(type: string, detail: unknown): void {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }

  open(): void {
    this.apiRef.enqueue((api) => api.open());
  }

  ask(text: string): void {
    this.apiRef.enqueue((api) => api.ask(text));
  }

  /**
   * Switch the active persona agent. Pass null to restore the declared primary.
   * Future user messages are answered by the given agent immediately — no
   * remount required. Emits `algolia-chat-persona-change`.
   *
   * @param agentId Agent Studio agent UUID, or null to restore the primary.
   * @param label   Optional display name surfaced in the proactive greeting.
   */
  setPersona(agentId: string | null, label?: string): void {
    // Normalise empty/whitespace ids to null so callers can pass form values
    // or dataset attributes straight through without pre-checking.
    const id = typeof agentId === 'string' && agentId.trim() !== '' ? agentId.trim() : null;
    const name = label?.trim() || null;
    this.apiRef.enqueue((api) => api.setPersona(id, name ?? undefined));
    this.emit(ALGOLIA_CHAT_PERSONA_CHANGE, { agentId: id, label: name });
  }

  /**
   * Open the chat panel and show a proactive assistant-authored greeting with
   * optional suggestion chips. The greeting renders before the user's first turn;
   * clicking a chip sends that message. Emits `algolia-chat-engaged`.
   *
   * Returns false when the greeting is refused — either it was empty (so callers
   * can forward an agent response without validating it first) or the visitor has
   * switched auto-engage off. Both are known synchronously, so the result is
   * reliable even before the widget has mounted.
   */
  engage(opts: { greeting: string; suggestions?: string[]; openMode?: ChatSizeMode }): boolean {
    const greeting = opts?.greeting?.trim();
    if (!greeting) {
      console.warn('[algolia-chat] engage() ignored — greeting is empty.');
      return false;
    }
    if (!proactiveStore.getSnapshot().autoEngage) {
      // Visitor opted out of proactive opening. Drop the greeting rather than
      // queueing something that will never be shown, and clear any indicator.
      this.apiRef.enqueue((api) => api.setAnalyzing(false));
      return false;
    }
    const suggestions = (opts.suggestions ?? []).filter(
      (s): s is string => typeof s === 'string' && s.trim() !== '',
    );
    const openMode = isSizeMode(opts?.openMode) ? opts.openMode : 'docked';
    this.apiRef.enqueue((api) => api.engage({ greeting, suggestions, openMode }));
    this.emit(ALGOLIA_CHAT_ENGAGED, { greeting, suggestions });
    return true;
  }

  /**
   * Toggle a loading indicator on the collapsed chat button, for use while an
   * upstream decision (e.g. a proactive concierge agent) is still pending.
   *
   * Has no visual effect while the panel is open, since the button is hidden in
   * that state. Auto-clears after a timeout so a caller that never resolves
   * cannot leave the button spinning forever.
   */
  setAnalyzing(analyzing: boolean): void {
    this.apiRef.enqueue((api) => api.setAnalyzing(Boolean(analyzing)));
  }

  /**
   * Whether the visitor allows the chat to open itself proactively.
   *
   * Opt-out, so this is true unless the visitor turned it off. Hosts should check
   * it before doing expensive work (e.g. calling a concierge agent) — though the
   * widget refuses proactive greetings on its own regardless, so honouring it is
   * an optimisation rather than a requirement.
   *
   * Backed by the module-level store rather than the React tree, so it is readable
   * and writable before the widget mounts.
   */
  get autoEngage(): boolean {
    return proactiveStore.getSnapshot().autoEngage;
  }

  set autoEngage(enabled: boolean) {
    this.setAutoEngage(enabled);
  }

  /**
   * Set the visitor's auto-engage preference. Persisted to `localStorage` so it
   * survives navigation. Emits `algolia-chat-auto-engage-change`.
   */
  setAutoEngage(enabled: boolean): void {
    proactiveStore.setAutoEngage(Boolean(enabled));
  }

  /**
   * Tell the answering agent what the host page knows about this visitor.
   *
   * `provider` is called before every message the widget sends, and whatever it
   * returns is serialised and sent with the question — so an agent can tailor its
   * answer to the visitor's persona and reading history, and can answer questions
   * about the visitor themselves. Read from your own store (localStorage, a CDP,
   * a cached session object) rather than doing network work, since this runs on
   * every turn. Return null to send nothing.
   *
   * Pass null to stop sending context. Only the wire message carries it: the
   * transcript and the replayed history keep the visitor's own words.
   *
   * Backed by a module-level store, so it can be registered before mount.
   */
  /**
   * @deprecated Use setVisitorDataSource instead. Kept for backward compat.
   */
  setContextProvider(provider: VisitorContextProvider | null): void {
    visitorContextStore.setProvider(provider);
  }

  /**
   * Swap the visitor data source used by the person agent.
   *
   * The default is the localStorage adapter (reads acs_profile, acs_events,
   * acs_session). Pass a custom VisitorDataSource to read from a CDP, a
   * backend session endpoint, or any other store. Pass null to reset to the
   * localStorage default.
   *
   * Backed by a module-level store, so it can be registered before mount.
   */
  setVisitorDataSource(source: VisitorDataSource | null): void {
    setVisitorDataSource(source);
  }

  /**
   * Mirror auto-engage changes out as DOM events.
   *
   * Driven from the store rather than the setter so the event fires no matter how
   * the preference changed — the in-panel toggle writes to the store directly.
   */
  private watchAutoEngage(): void {
    let last = proactiveStore.getSnapshot().autoEngage;
    this.unwatchAutoEngage = proactiveStore.subscribe(() => {
      const next = proactiveStore.getSnapshot().autoEngage;
      if (next === last) return;
      last = next;
      this.emit(ALGOLIA_CHAT_AUTO_ENGAGE_CHANGE, { enabled: next });
    });
  }
}

// ---------------------------------------------------------------------------
// Global window.algoliaChat API
// ---------------------------------------------------------------------------

/**
 * `window.algoliaChat` — a global namespace exposed by the IIFE bundle so
 * implementing sites can call `registerTheme` before the custom element upgrades.
 *
 * Queue a theme before the bundle loads:
 *
 *   window.algoliaChat = window.algoliaChat || {};
 *   window.algoliaChat.registerTheme = window.algoliaChat.registerTheme || [];
 *   window.algoliaChat.registerTheme.push(['my-brand', {
 *     color: { accent: '#e2361b' },
 *     typography: { sans: "'My Font', sans-serif", fontHref: '/fonts/my-font.css' },
 *   }]);
 *
 *   // OR, after the widget bundle has loaded:
 *   algoliaChat.registerTheme('my-brand', {
 *     color: { accent: '#e2361b' },
 *   });
 *
 * Any items queued as an array before the bundle loaded are replayed here.
 */
declare global {
  interface Window {
    algoliaChat?: {
      registerTheme?: typeof registerTheme | Array<Parameters<typeof registerTheme>>;
      registerTool?: typeof registerHostTool | Array<Parameters<typeof registerHostTool>>;
      setOrchestratorTransport?: typeof setOrchestratorTransport;
      /** Exposes the tool UI gate so external form-tool bundles can request,
       *  settle, and dismiss the in-panel interactive form region. */
      toolUI?: {
        request: typeof toolUIGate.request;
        settle: typeof toolUIGate.settle;
        dismiss: typeof toolUIGate.dismiss;
      };
    };
  }
}

(function installAlgoliaChatGlobal() {
  const existing = window.algoliaChat;

  // Replay any theme registrations queued before the bundle loaded (array form).
  // Implementing sites that need a named theme should either queue their
  // registerTheme call before this script tag, or call
  // window.algoliaChat.registerTheme('my-brand', theme) after it loads.
  if (Array.isArray(existing?.registerTheme)) {
    for (const args of existing.registerTheme) {
      registerTheme(...args);
    }
  }

  // Replay any tool registrations queued before the bundle loaded (array form).
  // External bundles (form-tool, custom tools) can queue before this script:
  //   window.algoliaChat.registerTool = window.algoliaChat.registerTool || [];
  //   window.algoliaChat.registerTool.push(['my_tool', async input => ({ ok: true })]);
  if (Array.isArray(existing?.registerTool)) {
    for (const args of existing.registerTool) {
      registerHostTool(...args);
    }
  }

  // Replace (or create) the global with live references.
  window.algoliaChat = {
    ...existing,
    registerTheme,
    registerTool: registerHostTool,
    setOrchestratorTransport,
    toolUI: {
      request: toolUIGate.request.bind(toolUIGate),
      settle: toolUIGate.settle.bind(toolUIGate),
      dismiss: toolUIGate.dismiss.bind(toolUIGate),
    },
  };
})();

// Defining the element upgrades every instance already in the document
// synchronously, and each one resolves its `theme` on upgrade. Host-supplied
// theme registrations must be queued (or called) before this script runs to
// ensure the named theme is in the registry at upgrade time.
if (!customElements.get('algolia-chat')) {
  customElements.define('algolia-chat', AlgoliaChatElement);
}
