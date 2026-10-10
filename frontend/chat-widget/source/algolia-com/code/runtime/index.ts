/**
 * @algolia-central/chat-central
 *
 * The complete chat widget engine: IS plumbing (connectors + factories),
 * React UI (ChatWidget + components), configuration system, judge engine,
 * shared transports, and style helpers.
 *
 * The `<algolia-chat>` custom element (algolia-chat package) is the thin
 * attribute-parsing layer on top; everything else lives here.
 *
 *   import {
 *     chatWidget, connectChat,
 *     agentWidget, connectAgent,
 *     chatConfidenceWidget, connectChatConfidence,
 *     buildWidgetStyles, ensureWidgetFont,
 *     applyRuntimeConfig, applyRootConfig,
 *   } from '@algolia-central/chat-central';
 */

// ── Chat connector (lifecycle/orchestration) ───────────────────────────────────
export { connectChat } from './connectChat';
export type {
  ChatWidgetApi,
  ChatConnectorWidgetParams,
  ChatRenderState,
  /** IS widget object shape returned by connectChat. Aliased to avoid conflict
   *  with the React ChatWidget component exported below. */
  ChatWidget as ChatISWidget,
  ChatRenderer,
  ChatUnmounter,
} from './connectChat';

// ── Agent connector + factory ─────────────────────────────────────────────────
export { connectAgent } from './connectAgent';
export type {
  AgentContext,
  AgentRole,
  AgentDescriptor,
  ChatAgentDescriptor,
  JudgeAgentDescriptor,
  AgentWidgetParams,
  AgentWidget,
} from './connectAgent';

export { agentWidget } from './agentWidget';
export type { AgentWidgetFactoryParams } from './agentWidget';

// ── Confidence connector + factory ────────────────────────────────────────────
export { connectChatConfidence } from './connectChatConfidence';
export type {
  JudgeMode,
  ChatConfidenceDescriptor,
  ChatConfidenceWidgetParams,
  ChatConfidenceWidget,
} from './connectChatConfidence';

export { chatConfidenceWidget, ALGOLIA_VERDICT_EVENT } from './chatConfidenceWidget';
export type { ChatConfidenceWidgetFactoryParams } from './chatConfidenceWidget';

// ── Chat widget factory + React renderer harness ───────────────────────────────
export { chatWidget } from './chatWidget';
export type { ChatWidgetParams } from './chatWidget';
export { createChatRenderer } from './chatRenderer';
export type {
  WidgetApi,
  WidgetState,
  WidgetStore,
  ChatComponentProps,
  ChatRendererParams,
} from './chatRenderer';

// ── Built-in chat UI component ─────────────────────────────────────────────────
export { ChatWidget } from './chat/ChatWidget';
export type { ChatWidgetProps } from './chat/ChatWidget';

// ── Configuration system ───────────────────────────────────────────────────────
export { defaultInstance } from './config/defaults';
export {
  activeInstance,
  getAgentByKey,
  setActiveInstance,
  subscribeToConfig,
  getConfigVersion,
  useActiveConfig,
} from './config/active';
export { applyRootConfig, applyRuntimeConfig, getRuntimeEnv } from './config/runtime';
export type { RuntimeConfig, RuntimeEnv, InstanceBranding } from './config/runtime';
export type {
  InstanceConfig,
  InstanceTheme,
  WidgetIcons,
  ChatSizeMode,
  AgentsConfig,
  SourceFacet,
  SourceDisplayConfig,
} from './config/instance';
// AgentDescriptor is also exported from connectAgent; re-exporting from
// instance keeps the InstanceConfig-level type shape accessible from one import.
export type { AgentDescriptor as InstanceAgentDescriptor } from './config/instance';
export { defaultStrings, interpolate, mergeStrings } from './config/strings';
export type { WidgetStrings, DeepPartial, JudgeBadgeErrors } from './config/strings';

// ── Proactive engagement (persona override, greeting, auto-engage preference) ──
export { proactiveStore, useProactive } from './config/proactive';
export type { ProactiveState } from './config/proactive';

// ── Visitor context (legacy setContextProvider path — superseded by setVisitorDataSource) ─
export { visitorContextStore } from './config/visitorContext';
export type { VisitorContextProvider } from './config/visitorContext';

// ── Primary orchestrator transport (explicit host integration boundary) ────────
export {
  getOrchestratorTransport,
  setOrchestratorTransport,
} from './config/orchestratorTransport';
export type { OrchestratorTransport } from './config/orchestratorTransport';

// ── Person agent / visitor data source ────────────────────────────────────────
export { setVisitorDataSource, getVisitorDataSource } from './person/visitorDataSource';
export type {
  VisitorDataSource,
  VisitorProfile,
  VisitorEvent,
  SessionPage,
  VisitorData,
} from './person/visitorDataSource';

// ── Host tool registry ─────────────────────────────────────────────────────────
export { registerHostTool, getHostRegistry } from './tools/hostRegistry';

// ── Tool UI gate ───────────────────────────────────────────────────────────────
export { toolUIGate, useToolUI } from './tools/toolUIGate';
export type { ToolUISchema, ToolUIField, ToolUIState } from './tools/toolUIGate';

// ── Person connector + factory ────────────────────────────────────────────────
export { connectChatPerson } from './connectChatPerson';
export type {
  PersonAgentRole,
  PersonSubAgentDescriptor,
  PersonConfig,
  ChatPersonWidgetParams,
  ChatPersonWidget,
} from './connectChatPerson';

export { chatPersonWidget } from './chatPersonWidget';
export type { ChatPersonWidgetFactoryParams } from './chatPersonWidget';

// ── Agent config helpers ───────────────────────────────────────────────────────
export { getAgentConfig, getEnvConfig } from './shared/agents';

// ── Style helpers ──────────────────────────────────────────────────────────────
export {
  buildWidgetStyles,
  ensureWidgetFont,
  resolveWidgetFontHref,
  hexToRgbTriplet,
  isWidgetTheme,
  WIDGET_THEMES,
} from '../../presentation/widget/styles';
export type { BuildWidgetStylesOptions } from '../../presentation/widget/styles';

// ── Theme system ───────────────────────────────────────────────────────────────
export type { ChatTheme } from '../../presentation/widget/theme/types';
export {
  registerTheme,
  getTheme,
  getRegisteredThemeNames,
  isRegisteredTheme,
  resolveTheme,
  subscribeToRegistry,
} from '../../presentation/widget/theme/registry';
export { compileTheme } from '../../presentation/widget/theme/compile';
export { TOKEN_MAP } from '../../presentation/widget/theme/tokenMap';

// ── Judge types (shared with algolia-chat's ConfidenceBadgeElement) ────────────
export type {
  JudgeVerdict,
  JudgeErrorKind,
  JudgeRole,
  JudgeDims,
  JudgeDimension,
  JudgeFlaggedClaim,
  JudgePerJudge,
  JudgeSourceInput,
  JudgeAnswerInput,
} from './judge/types';
