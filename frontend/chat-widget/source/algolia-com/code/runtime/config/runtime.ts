/**
 * Runtime configuration — merges HTML attribute values into `activeInstance`.
 *
 * The `<algolia-chat>` custom element parses its attributes and slots, builds
 * a `RuntimeConfig`, and calls `applyRuntimeConfig`. The connector layer
 * (`<algolia-instant-search>`) calls `applyRootConfig` with the IS credentials.
 *
 * The env singleton (`RuntimeEnv`) carries credentials needed by agentStudio
 * transport and the judge clients; all UI components read configuration from
 * `activeInstance` instead.
 */
import type {
  InstanceConfig,
  SourceFacet,
  SourceDisplayConfig,
  AgentsConfig,
  ChatSizeMode,
  WidgetIcons,
} from './instance';
import { mergeStrings, type DeepPartial, type WidgetStrings } from './strings';
import { activeInstance, setActiveInstance } from './active';
import { defaultInstance } from './defaults';
import { configureRecordFields, type RecordFieldMap } from '../shared/recordFields';

// JudgeMode is the canonical definition in connectChatConfidence (already in
// chat-central). Re-exporting it here so callers that import from config/runtime
// keep working without knowing the internal module layout.
export type { JudgeMode } from '../connectChatConfidence';

// ---------------------------------------------------------------------------
// RuntimeEnv — credentials / low-level config from the root element
// ---------------------------------------------------------------------------

/** Credentials and low-level overrides supplied via the outermost element's
 *  attributes. Components NEVER read from this — they use activeInstance. */
export interface RuntimeEnv {
  appId: string;
  searchKey: string;
  indexName?: string;
  judgeUrl?: string;
  judgeApiKey?: string;
  judgeMode?: string;
  judgeAgentId?: string;
}

let _env: RuntimeEnv | null = null;

/** Apply credentials from `<algolia-chat>` (or `<algolia-instant-search>`) to
 *  the module-global env singleton. Called once per element connection. */
export function applyRootConfig(env: RuntimeEnv): void {
  _env = env;
}

/** Read the current runtime env (credentials). Returns null before the first
 *  `applyRootConfig` call. UI components should use `activeInstance` instead. */
export function getRuntimeEnv(): RuntimeEnv | null {
  return _env;
}

// ---------------------------------------------------------------------------
// InstanceBranding — the logo + label subset of InstanceConfig
// ---------------------------------------------------------------------------

export interface InstanceBranding {
  logo?: { header?: string; mark?: string };
  poweredBy?: { label?: string; logo?: string };
}

// ---------------------------------------------------------------------------
// RuntimeConfig — attribute-parsed display config for one embed
// ---------------------------------------------------------------------------

/**
 * All display-related configuration read from `<algolia-chat>` attributes/slots.
 * Only fields that are present (non-undefined) overwrite their counterpart in
 * activeInstance. The attribute-parsing functions in algolia-chat/chat-embed.tsx
 * produce this shape.
 *
 * Credentials (appId, searchKey, indexName) are handled separately via
 * `applyRootConfig`; this object carries only visual/UX configuration.
 */
export interface RuntimeConfig {
  /** Company/brand name shown in aria-labels and fallback UI. */
  brandName?: string;
  productTitle?: string;
  subtitle?: string;
  corpusName?: string;
  disclaimer?: string;
  /**
   * The real production origin source records' relative URLs resolve against.
   * Set via `canonical-base-url` on `<algolia-chat>`.
   */
  canonicalBaseUrl?: string;
  theme?: InstanceConfig['theme'];
  agents?: Partial<AgentsConfig>;
  sampleQuestions?: InstanceConfig['sampleQuestions'];
  /** Max groups shown as chips in the empty state. */
  sampleQuestionsGroupCap?: number;
  /** Questions taken from each group for the empty-state chips. */
  sampleQuestionsPerGroup?: number;
  sourceFacets?: SourceFacet[];
  /** Logo and powered-by attribution overrides. */
  branding?: InstanceBranding;
  strings?: DeepPartial<WidgetStrings>;
  /** Welcome hero overrides. Only provided keys are applied; omitted keys keep
   *  their current value. `show` is the master on/off toggle for the hero. */
  welcome?: { present?: boolean; show?: boolean };
  /**
   * URL of the signed-in user's profile image shown next to user prompt
   * bubbles. Pass an empty string (or omit) to render the anonymous fallback.
   */
  userAvatar?: string;
  /**
   * URL of the "New conversation" header button icon. Supplied by the embedding
   * site (attribute `new-chat-icon` or `<img slot="new-chat-icon">`); when
   * omitted the widget uses its built-in fallback glyph.
   */
  newChatIcon?: string;
  /**
   * The window size mode the panel opens in by default.
   * `'normal'` (full centered modal) | `'docked'` (compact corner panel) | `'maximized'`
   *
   * This is the admin-configured default. Once the user explicitly changes the
   * mode via the header controls, their choice overrides this setting and is
   * persisted in `localStorage` for all subsequent visits.
   *
   * Set via `default-open-mode` on `<algolia-chat>`.
   */
  defaultOpenMode?: ChatSizeMode;
  /** Icon URL for the collapsed launcher button. Set via `launcher-icon`. */
  launcherIcon?: string;
  /** Show the visitor-facing auto-engage toggle. Set via `auto-engage-toggle`. */
  autoEngageToggle?: boolean;
  /** Default auto-engage state before the visitor chooses. Set via `auto-engage`. */
  autoEngage?: boolean;
  /** Enable commercial discovery behavior. Set via `discovery-enabled`. */
  discoveryEnabled?: boolean;
  /** Analyzing-indicator safety timeout in ms. Set via `analyzing-timeout`. */
  analyzingTimeoutMs?: number;
  /**
   * Override map for built-in SVG glyphs. Supply a URL for each glyph to
   * replace. Set via the `icons` JSON attribute on `<algolia-chat>`.
   */
  icons?: WidgetIcons;
  /**
   * Which record attributes carry a source's title, link and body text, for
   * an index that does not use the default spellings. Set via the
   * `record-fields` JSON attribute on `<algolia-chat>`.
   */
  recordFields?: Partial<RecordFieldMap>;
  /**
   * Source-pill display rules. When provided, replaces the entire current
   * value (no deep-merge). Set via the `source-display` JSON attribute or
   * `<script type="application/json" slot="source-display">`.
   */
  sourceDisplay?: SourceDisplayConfig;
}

function mergeLogo(
  next: InstanceBranding['logo'],
  current: InstanceConfig['logo'],
): InstanceConfig['logo'] {
  if (!next) return current;
  return { header: next.header ?? current.header, mark: next.mark ?? current.mark };
}

function mergePoweredBy(
  next: InstanceBranding['poweredBy'],
  current: InstanceConfig['poweredBy'],
): InstanceConfig['poweredBy'] {
  if (!next) return current;
  return { label: next.label ?? current.label, logo: next.logo ?? current.logo };
}

function mergeWelcome(
  next: RuntimeConfig['welcome'],
  current: InstanceConfig['welcome'],
): InstanceConfig['welcome'] {
  if (!next) return current;
  return { present: next.present ?? current.present, show: next.show ?? current.show };
}

type ScalarFields = Pick<
  InstanceConfig,
  | 'brandName'
  | 'productTitle'
  | 'subtitle'
  | 'corpusName'
  | 'disclaimer'
  | 'canonicalBaseUrl'
  | 'theme'
  | 'userAvatar'
  | 'newChatIcon'
  | 'defaultOpenMode'
  | 'launcherIcon'
  | 'autoEngageToggle'
  | 'autoEngage'
  | 'discoveryEnabled'
  | 'analyzingTimeoutMs'
  | 'sampleQuestionsGroupCap'
  | 'sampleQuestionsPerGroup'
>;

const SCALAR_KEYS: ReadonlyArray<keyof ScalarFields> = [
  'brandName',
  'productTitle',
  'subtitle',
  'corpusName',
  'disclaimer',
  'canonicalBaseUrl',
  'theme',
  'userAvatar',
  'newChatIcon',
  'defaultOpenMode',
  'launcherIcon',
  'autoEngageToggle',
  'autoEngage',
  'discoveryEnabled',
  'analyzingTimeoutMs',
  'sampleQuestionsGroupCap',
  'sampleQuestionsPerGroup',
];

function mergeScalars(config: RuntimeConfig, cur: InstanceConfig): ScalarFields {
  const out = {} as ScalarFields;
  for (const key of SCALAR_KEYS) {
    // TypeScript cannot verify the value type when assigning via a union key;
    // widening `out` to a plain record for the write is the standard workaround.
    (out as Record<string, unknown>)[key] = config[key] ?? cur[key];
  }
  return out;
}

/** Merge the collection/object-typed fields that cannot be handled by the
 *  scalar-copy loop, keeping the logic for each field co-located. Extracted so
 *  `applyRuntimeConfig` stays under the cyclomatic-complexity limit. */
function mergeCollections(
  config: RuntimeConfig,
  cur: InstanceConfig,
  base: InstanceConfig,
): Pick<
  InstanceConfig,
  'agents' | 'sampleQuestions' | 'sourceFacets' | 'sourceDisplay' | 'strings' | 'icons'
> {
  return {
    agents: config.agents ? { ...cur.agents, ...config.agents } : cur.agents,
    sampleQuestions: config.sampleQuestions ?? cur.sampleQuestions,
    sourceFacets: config.sourceFacets ?? cur.sourceFacets,
    sourceDisplay: config.sourceDisplay ?? cur.sourceDisplay,
    strings: config.strings ? mergeStrings(base.strings, config.strings) : cur.strings,
    icons: config.icons ? { ...cur.icons, ...config.icons } : cur.icons,
  };
}

/**
 * Merge a RuntimeConfig patch into the active instance. Only provided keys are
 * applied; everything else keeps its current value (defaultInstance fallback or
 * a prior `applyRuntimeConfig` call).
 */
export function applyRuntimeConfig(config: RuntimeConfig): void {
  const base: InstanceConfig = structuredClone(defaultInstance);
  const cur = activeInstance;

  // Not part of InstanceConfig: the SSE parser and the judge clients read it
  // outside React, so it lives in its own module singleton.
  configureRecordFields(config.recordFields);

  setActiveInstance({
    ...base,
    ...cur,
    ...mergeScalars(config, cur),
    ...mergeCollections(config, cur, base),
    logo: mergeLogo(config.branding?.logo, cur.logo),
    poweredBy: mergePoweredBy(config.branding?.poweredBy, cur.poweredBy),
    welcome: mergeWelcome(config.welcome, cur.welcome),
  });
}
