/**
 * agentWidget — the unified public factory for both chat-agent and judge-agent
 * InstantSearch leaf widgets.
 *
 * `context: 'chat'` publishes into `renderState.chatAgents` (read by useChat).
 * `context: 'judge'` publishes into `renderState.judgeAgents` (merged into
 * chatConfidence.agents by connectChat and read by useJudge).
 *
 * The `<algolia-agent>` web component sets context automatically from DOM
 * position — explicit `context` is only needed for the programmatic JS API.
 *
 * Optional UI: when `container` is provided, a lightweight vanilla-DOM chip
 * (role • label with accent colour) is mounted on the first IS `init` call
 * and removed on `dispose`. No framework dependency.
 *
 * Usage (programmatic — chat agent with optional chip):
 *   agentWidget({
 *     context: 'chat',
 *     agentKey: 'primary', role: 'primary', key: 'primary',
 *     id: 'UUID', label: 'Assistant', accentToken: '--algolia-agent-primary',
 *     container: document.querySelector('#agent-status'), // optional
 *   });
 *
 * Usage (programmatic — judge agent):
 *   agentWidget({ context: 'judge', agentKey: 'skeptic', id: 'UUID', role: 'skeptic' });
 */

import { connectAgent, type AgentWidgetParams, type AgentWidget } from './connectAgent';

export interface AgentWidgetFactoryParams extends AgentWidgetParams {
  /**
   * Optional DOM element to render an agent indicator chip into.
   * The chip shows the agent's label with a coloured dot using the `accentToken`
   * CSS custom property. Only meaningful for `context: 'chat'` (judge agents
   * have no accent token). The chip is mounted once on IS `init` and removed
   * on `dispose`.
   */
  container?: HTMLElement;
}

// ── Vanilla DOM chip renderer ─────────────────────────────────────────────────

function mountAgentChip(
  container: HTMLElement,
  params: Pick<AgentWidgetParams, 'label' | 'accentToken' | 'role'>,
): () => void {
  const { label = '', accentToken = '--algolia-agent-primary', role = '' } = params;

  const chip = document.createElement('div');
  chip.setAttribute('data-algolia-agent-chip', role);
  chip.style.cssText = [
    'display:inline-flex',
    'align-items:center',
    'gap:6px',
    'padding:3px 10px 3px 6px',
    'border-radius:9999px',
    `border:1px solid var(${accentToken},var(--algolia-accent,currentColor))`,
    'font-family:inherit',
    'font-size:12px',
    'font-weight:500',
    `color:var(${accentToken},var(--algolia-accent,currentColor))`,
    'white-space:nowrap',
    'box-sizing:border-box',
  ].join(';');

  const dot = document.createElement('span');
  dot.style.cssText = [
    'display:block',
    'width:7px',
    'height:7px',
    'border-radius:50%',
    'flex-shrink:0',
    `background:var(${accentToken},var(--algolia-accent,currentColor))`,
  ].join(';');

  const text = document.createElement('span');
  text.textContent = label;

  chip.appendChild(dot);
  chip.appendChild(text);
  container.appendChild(chip);

  return () => {
    if (chip.parentNode === container) container.removeChild(chip);
  };
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function agentWidget(params: AgentWidgetFactoryParams): AgentWidget {
  const { container, ...connectorParams } = params;

  let unmountChip: (() => void) | null = null;
  let mounted = false;

  const renderFn = (): void => {
    if (mounted || !container) return;
    mounted = true;
    unmountChip = mountAgentChip(container, connectorParams);
  };

  const unmountFn = (): void => {
    unmountChip?.();
    unmountChip = null;
    mounted = false;
  };

  const createWidget = connectAgent(renderFn, unmountFn);

  return {
    ...createWidget(connectorParams),
    $$widgetType: `algolia.${params.context}Agent`,
  };
}
