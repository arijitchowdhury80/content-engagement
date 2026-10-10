/**
 * proactive — module-global store for persona override + proactive greeting state.
 *
 * A tiny external store compatible with React's `useSyncExternalStore`.
 * Lives at module scope so both the custom element imperative API (chat-embed.tsx)
 * and React components (useChat, ChatWidget) can read/write without prop-drilling.
 *
 * Persona override: when `personaAgentId` is set, useChat uses it as the primary
 * agent instead of whatever `<algolia-agent role="primary">` declares. This lets
 * the host page switch personas without re-mounting the widget.
 *
 * Proactive greeting: when `greeting` is set, ChatWidget opens the panel and
 * renders the greeting as an assistant-authored message before the user's first turn.
 *
 * Analyzing: when `isAnalyzing` is true the concierge agent is deciding whether to
 * engage. The closed-state FAB renders a spinner so the visitor gets feedback that
 * something is coming. Ignored while the panel is open (the FAB is hidden then).
 *
 * Auto-engage: a user-owned preference. When the visitor switches it off, the
 * widget refuses proactive greetings outright — enforcement lives here rather
 * than in host code so the preference is honoured for every integration.
 */
import { useSyncExternalStore } from 'react';
import { activeInstance } from './active';

export interface ProactiveState {
  /** Agent Studio UUID to use as the primary agent. Null = use declared primary. */
  personaAgentId: string | null;
  /** Display label for the active persona (e.g. "Designer"). */
  personaLabel: string | null;
  /** Proactive greeting text from the concierge agent. Null = no proactive greeting. */
  greeting: string | null;
  /** Suggestion chips accompanying the greeting. */
  suggestions: string[];
  /** True while the concierge agent is analyzing context. Drives the FAB spinner. */
  isAnalyzing: boolean;
  /**
   * Whether the visitor allows the chat to open itself proactively.
   * Opt-out, so the default is true. Persisted across page loads.
   */
  autoEngage: boolean;
}

/**
 * Persisted so the choice survives navigation — a preference the visitor has to
 * re-set on every page would be worse than not offering it. Namespaced to avoid
 * collisions with host-page keys.
 */
const AUTO_ENGAGE_KEY = 'algolia-chat:auto-engage';

/**
 * The visitor's stored choice, or null when they have never expressed one.
 *
 * Distinguishing "no choice" from "chose on" matters: a host can configure the
 * default via `auto-engage`, and that default must only apply while the visitor
 * has not decided for themselves.
 *
 * localStorage throws in private mode and sandboxed iframes; never fatal here.
 */
function readAutoEngagePref(): boolean | null {
  try {
    const raw = localStorage.getItem(AUTO_ENGAGE_KEY);
    return raw === null ? null : raw !== 'off';
  } catch {
    return null;
  }
}

function writeAutoEngagePref(enabled: boolean): void {
  try {
    localStorage.setItem(AUTO_ENGAGE_KEY, enabled ? 'on' : 'off');
  } catch {
    // Preference simply won't persist — in-memory state still applies.
  }
}

const INITIAL: ProactiveState = {
  personaAgentId: null,
  personaLabel: null,
  greeting: null,
  suggestions: [],
  isAnalyzing: false,
  // Opt-out by default; a host default is applied later via applyAutoEngageDefault,
  // since config is not resolved until the element parses its attributes.
  autoEngage: readAutoEngagePref() ?? true,
};

let state: ProactiveState = { ...INITIAL };
const subscribers = new Set<() => void>();

function notify(): void {
  subscribers.forEach((cb) => cb());
}

/**
 * Safety net for the analyzing indicator. The caller that sets `isAnalyzing`
 * is responsible for clearing it, but a rejected network request or an early
 * `return` in host code would otherwise leave the launcher spinning forever.
 * Auto-clear so a stuck upstream can never permanently break the UI.
 *
 * Read from config at call time (not module load) so `analyzing-timeout` applies
 * even though attributes are parsed after this module is first evaluated.
 */
function analyzingTimeoutMs(): number {
  return activeInstance.analyzingTimeoutMs;
}

let analyzingTimer: ReturnType<typeof setTimeout> | null = null;

function clearAnalyzingTimer(): void {
  if (analyzingTimer !== null) {
    clearTimeout(analyzingTimer);
    analyzingTimer = null;
  }
}

export const proactiveStore = {
  getSnapshot: (): ProactiveState => state,

  subscribe: (cb: () => void): (() => void) => {
    subscribers.add(cb);
    return () => {
      subscribers.delete(cb);
    };
  },

  /** Override the primary agent for the active persona. */
  setPersona(agentId: string | null, label?: string): void {
    state = { ...state, personaAgentId: agentId, personaLabel: label ?? null };
    notify();
  },

  /**
   * Set a proactive greeting to display when the panel opens. Ends the analyzing
   * state. Returns false without changing anything when the visitor has switched
   * auto-engage off, so callers can tell the greeting was declined.
   */
  engage(greeting: string, suggestions: string[] = []): boolean {
    clearAnalyzingTimer();
    if (!state.autoEngage) {
      if (state.isAnalyzing) {
        state = { ...state, isAnalyzing: false };
        notify();
      }
      return false;
    }
    state = { ...state, greeting, suggestions, isAnalyzing: false };
    notify();
    return true;
  },

  /**
   * Apply the host-configured default for auto-engage (`auto-engage` attribute).
   *
   * A no-op once the visitor has made their own choice — their stored preference
   * always outranks the host default. Safe to call on every mount.
   */
  applyAutoEngageDefault(enabled: boolean): void {
    if (readAutoEngagePref() !== null) return;
    if (state.autoEngage === enabled) return;
    state = { ...state, autoEngage: enabled };
    notify();
  },

  /**
   * Record the visitor's auto-engage preference. Switching it off also clears any
   * greeting currently on screen, so the control takes effect immediately rather
   * than only applying to the next page.
   */
  setAutoEngage(enabled: boolean): void {
    if (state.autoEngage === enabled) return;
    writeAutoEngagePref(enabled);
    clearAnalyzingTimer();
    state = enabled
      ? { ...state, autoEngage: true }
      : { ...state, autoEngage: false, greeting: null, suggestions: [], isAnalyzing: false };
    notify();
  },

  /**
   * Toggle the "analyzing" indicator that drives the launcher spinner.
   * Self-clears after ANALYZING_MAX_MS if the caller never resolves.
   */
  setAnalyzing(analyzing: boolean): void {
    clearAnalyzingTimer();
    // Nothing is coming when auto-engage is off, so don't imply otherwise.
    if (analyzing && !state.autoEngage) return;
    if (analyzing) {
      const limit = analyzingTimeoutMs();
      analyzingTimer = setTimeout(() => {
        analyzingTimer = null;
        if (!state.isAnalyzing) return;
        console.warn(
          `[algolia-chat] Analyzing indicator auto-cleared after ${limit}ms — ` +
            'setAnalyzing(true) was never followed by engage() or setAnalyzing(false). ' +
            'Raise the analyzing-timeout attribute if your decision legitimately takes longer.',
        );
        state = { ...state, isAnalyzing: false };
        notify();
      }, limit);
    }
    if (state.isAnalyzing === analyzing) return;
    state = { ...state, isAnalyzing: analyzing };
    notify();
  },

  /** Clear the proactive greeting (e.g. after the user starts typing). */
  clearGreeting(): void {
    clearAnalyzingTimer();
    state = { ...state, greeting: null, suggestions: [], isAnalyzing: false };
    notify();
  },

  /**
   * Reset the proactive state (e.g. on new chat). The selected persona and the
   * visitor's auto-engage preference are deliberately preserved — neither is
   * conversation state.
   */
  reset(): void {
    clearAnalyzingTimer();
    state = {
      ...INITIAL,
      personaAgentId: state.personaAgentId,
      personaLabel: state.personaLabel,
      autoEngage: state.autoEngage,
    };
    notify();
  },
};

/** React hook — subscribes to proactive state changes. */
export function useProactive(): ProactiveState {
  return useSyncExternalStore(proactiveStore.subscribe, proactiveStore.getSnapshot);
}
