/**
 * <algolia-agent> — unified declarative config-carrier custom element for
 * both chat agents and judge agents.
 *
 * A single element replaces the previous `<algolia-chat-agent>` /
 * `<algolia-judge-agent>` / `<algolia-person-agent>` elements. Context is
 * determined automatically from DOM position:
 *   - inside `<algolia-chat-confidence>` → judge agent
 *   - inside `<algolia-chat-person>`     → person sub-agent (read directly by parent; no IS widget)
 *   - anywhere else                      → chat agent
 *
 * When connected, the element creates an `agentWidget` with the appropriate
 * context and dispatches `algolia-widget-added` (bubbling). The event propagates
 * up through any `<algolia-chat-confidence>` parent (which has no listener) and
 * is caught by `<algolia-chat>`'s sub-orchestrator, which calls
 * `isInstance.addWidgets([widget])`. No additional wiring is required.
 *
 * When disconnected the element dispatches `algolia-widget-removed` so the
 * widget is cleanly removed from the IS instance.
 *
 * ── Chat agent (inside <algolia-chat>):
 *   <algolia-agent role="primary" agent-id="…" label="Assistant">
 *     <algolia-agent role="specialist" key="code" agent-id="…" label="Code expert"
 *                    accent-token="--algolia-agent-specialist"></algolia-agent>
 *   </algolia-agent>
 *
 *   Specialists are written inside the primary because they are only reachable
 *   through its ask_specialist tool. Nesting is convention, not a rule enforced
 *   here: every chat agent publishes into the same flat renderState.chatAgents
 *   map regardless of depth, so a specialist declared as a sibling behaves the
 *   same. What nesting does buy is lifecycle coupling — removing the primary
 *   disconnects its specialists too.
 *
 * ── Judge agent (inside <algolia-chat-confidence>):
 *   <algolia-chat-confidence mode="algolia">
 *     <algolia-agent role="skeptic"  agent-id="…"></algolia-agent>
 *     <algolia-agent role="referee"  agent-id="…"></algolia-agent>
 *     <algolia-agent role="advocate" agent-id="…"></algolia-agent>
 *   </algolia-chat-confidence>
 *
 * ── Person sub-agent (inside <algolia-chat-person>):
 *   <algolia-chat-person agent-id="…">
 *     <algolia-agent role="profile" agent-id="…"></algolia-agent>
 *     <algolia-agent role="events"  agent-id="…"></algolia-agent>
 *     <algolia-agent role="session" agent-id="…"></algolia-agent>
 *   </algolia-chat-person>
 *
 * ── Attributes (all contexts) ────────────────────────────────────────────────
 *   agent-id      Algolia Agent Studio agent UUID  (required)
 *   role          Agent role (context-specific; optional for single judge agents)
 *   label         Human-readable display name (optional)
 *
 * ── Attributes (chat context only) ──────────────────────────────────────────
 *   key           Specialist routing slug (required when role="specialist")
 *   accent-token  CSS custom-property name for accent colour (optional;
 *                 defaults: specialist → --algolia-agent-specialist-{key}
 *                             (e.g. key="product" → --algolia-agent-specialist-product),
 *                           others   → --algolia-agent-primary)
 *
 * All attributes can be changed on a connected element: the widget is detached
 * and re-registered with the new values, so host code can retarget an agent
 * (e.g. swap `agent-id` for an A/B test) without touching the DOM structure.
 */

import {
  agentWidget,
  defaultInstance,
  type AgentContext,
  type AgentWidget,
} from '@algolia-central/chat-central';
import { ALGOLIA_WIDGET_ADDED, ALGOLIA_WIDGET_REMOVED } from '../instantsearch/constants';

export class AlgoliaAgentElement extends HTMLElement {
  private widget: AgentWidget | null = null;

  /** Current InstantSearch leaf widget, exposed for the parent chat's initial
   * child-registration sweep after parser-time upgrades have completed. */
  get instantSearchWidget(): AgentWidget | null {
    return this.widget;
  }

  static get observedAttributes(): string[] {
    return ['role', 'key', 'agent-id', 'label', 'accent-token'];
  }

  // ── Context detection ──────────────────────────────────────────────────────

  /**
   * Detect this element's role from its live DOM position at connection time:
   * a judge agent inside a confidence element, a person sub-agent inside a
   * person element, or a chat agent anywhere else.
   */
  private get agentContext(): AgentContext {
    if (this.closest('algolia-chat-confidence')) return 'judge';
    if (this.closest('algolia-chat-person')) return 'person';
    return 'chat';
  }

  // ── Shared accessors ───────────────────────────────────────────────────────

  get agentId(): string {
    return this.getAttribute('agent-id')?.trim() ?? '';
  }

  get roleAttr(): string | undefined {
    return this.getAttribute('role')?.trim() || undefined;
  }

  get labelAttr(): string | undefined {
    return this.getAttribute('label')?.trim() || undefined;
  }

  // ── Chat-context accessors ─────────────────────────────────────────────────

  /**
   * Resolved label — falls back to role-based defaults sourced from
   * `defaultInstance` in chat-central so the fallback copy is overridable
   * from a single location.
   */
  private chatLabel(agentKey: string): string {
    if (this.labelAttr) return this.labelAttr;
    const role = this.roleAttr;
    if (role === 'primary') return defaultInstance.agents.primary.label;
    if (role === 'classifier') return defaultInstance.agents.classifier?.label ?? 'Classifier';
    return agentKey; // specialist: use the key as display name
  }

  /** Stable key for the chatAgents map. */
  private chatAgentKey(): string {
    const role = this.roleAttr;
    if (role === 'primary') return 'primary';
    if (role === 'classifier') return 'classifier';
    return this.getAttribute('key')?.trim() ?? '';
  }

  /**
   * CSS custom property for this agent's accent colour. A specialist derives
   * a per-key token (`--algolia-agent-specialist-{key}`, e.g. `-product`,
   * `-tech`) rather than sharing one generic token with every other
   * specialist — a host theme that only styles the keys it knows about still
   * gets a coherent look, because the render layer falls back to
   * `--algolia-agent-specialist` for any key it left unstyled (see
   * `ChatMessage.tsx`'s pill `var(a, var(--algolia-agent-specialist))`).
   */
  private accentToken(): string {
    const explicit = this.getAttribute('accent-token')?.trim();
    if (explicit) return explicit;
    if (this.roleAttr !== 'specialist') return '--algolia-agent-primary';
    const key = this.getAttribute('key')?.trim();
    return key ? `--algolia-agent-specialist-${key}` : '--algolia-agent-specialist';
  }

  // ── Judge-context accessors ────────────────────────────────────────────────

  /** Stable key for the judgeAgents map: role name or 'default'. */
  private judgeAgentKey(): string {
    return this.roleAttr ?? 'default';
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  connectedCallback(): void {
    this.style.display = 'none';
    this.register();
  }

  /**
   * Re-register with the new configuration.
   *
   * `observedAttributes` was declared without this callback, so retargeting a
   * live agent — the natural way to point the widget at a different Agent Studio
   * agent from host code — was accepted by the DOM and then ignored. Registration
   * is idempotent (unregister-then-register), so re-running it is the whole fix.
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

  /** Build the agent widget for the current attributes and announce it. */
  private register(): void {
    const id = this.agentId;
    if (!id) return;

    const context = this.agentContext;

    if (context === 'chat') {
      const agentKey = this.chatAgentKey();
      if (!agentKey) return; // role-less or key-less chat agent — skip

      this.widget = agentWidget({
        context: 'chat',
        agentKey,
        id,
        role: this.roleAttr,
        key: agentKey,
        label: this.chatLabel(agentKey),
        accentToken: this.accentToken(),
      });
    } else if (context === 'person') {
      // Person sub-agents are keyed by role — that is what selects which data
      // slice they interpret, so one without a role has nothing to bind to.
      const agentKey = this.roleAttr;
      if (!agentKey) return;

      this.widget = agentWidget({
        context: 'person',
        agentKey,
        id,
        role: agentKey,
        label: this.labelAttr,
      });
    } else {
      const agentKey = this.judgeAgentKey();
      this.widget = agentWidget({
        context: 'judge',
        agentKey,
        id,
        role: this.roleAttr,
        label: this.labelAttr,
      });
    }

    this.dispatchEvent(
      new CustomEvent(ALGOLIA_WIDGET_ADDED, {
        bubbles: true,
        cancelable: true,
        detail: this.widget,
      }),
    );
  }

  /** Detach the current widget, if any. Safe to call when nothing is registered. */
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

if (!customElements.get('algolia-agent')) {
  customElements.define('algolia-agent', AlgoliaAgentElement);
}
