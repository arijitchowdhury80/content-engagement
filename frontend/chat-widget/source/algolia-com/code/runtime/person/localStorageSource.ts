/**
 * localStorageSource — default VisitorDataSource that reads the three storage
 * keys written by the algolia-chat-tracker bundle
 * (acs_profile, acs_events, acs_session).
 *
 * This adapter ships with the widget so integrations that load the tracker
 * bundle get person-agent support with zero extra code. The keys match the
 * VisitorTracker contract — any tracker implementation that writes these keys
 * with the documented shapes will work with this reader.
 *
 * Hosts with a real backend store should call setVisitorDataSource() to
 * replace this with their own implementation.
 *
 * Safe in SSR / non-browser environments: every read is guarded by a
 * `typeof localStorage !== 'undefined'` check and falls back to empty data.
 */

import type {
  VisitorDataSource,
  VisitorProfile,
  VisitorEvent,
  SessionPage,
  VisitorSession,
} from './visitorDataSource';

// ── localStorage key constants ────────────────────────────────────────────────

const PROFILE_KEY = 'acs_profile';
const EVENTS_KEY = 'acs_events';
const SESSION_KEY = 'acs_session';

/** Maximum events to surface (matches context-engine.js CONTEXT_EVENT_LIMIT). */
const MAX_EVENTS = 20;

// ── Helpers ───────────────────────────────────────────────────────────────────

function safeRead<T>(key: string, fallback: T): T {
  if (typeof localStorage === 'undefined') return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

// ── Adapter ───────────────────────────────────────────────────────────────────

export const localStorageSource: VisitorDataSource = {
  getProfile(): VisitorProfile {
    return safeRead<VisitorProfile>(PROFILE_KEY, {});
  },

  getEvents(): VisitorEvent[] {
    const all = safeRead<VisitorEvent[]>(EVENTS_KEY, []);
    return all.slice(-MAX_EVENTS);
  },

  getSessionPages(): SessionPage[] {
    const session = safeRead<VisitorSession>(SESSION_KEY, {});
    return session.pages ?? [];
  },

  getSession(): VisitorSession {
    return safeRead<VisitorSession>(SESSION_KEY, {});
  },
};
