/**
 * visitorDataSource — pluggable data interface for the person agent.
 *
 * The widget ships with `localStorageSource` (reads acs_profile, acs_events,
 * acs_session keys) as the default adapter. Hosts with a backend user store
 * can swap in a custom implementation via `setVisitorDataSource()` on the
 * `<algolia-chat>` element — the same element that previously accepted
 * `setContextProvider()`.
 *
 * Each method should be cheap to call per turn (read a cache, not a network
 * round-trip). The runtime reads permission and current source state before
 * every answer, then reuses synthesis only when material signals are unchanged.
 */

/** Persona profile attributes as stored / returned by the profile sub-agent. */
export interface VisitorProfile {
  persona?: string;
  personaProfile?: Record<string, unknown>;
  firstSeen?: string | number | null;
  visits?: number;
  [key: string]: unknown;
}

/** A single behavioural event. */
export interface VisitorEvent {
  name?: string;
  type?: string;
  page?: string;
  path?: string;
  props?: Record<string, unknown>;
  meta?: Record<string, unknown>;
  ts?: number;
  [key: string]: unknown;
}

/** A page viewed in the current session. */
export interface SessionPage {
  path: string;
  title: string;
  enteredAt?: number;
  exitedAt?: number;
  dwellMs?: number;
  maxScrollDepth?: number;
  readDepth?: 'none' | 'shallow' | 'medium' | 'deep';
  previousPath?: string | null;
  sequence?: number;
  [key: string]: unknown;
}

/** Session-level metadata written by the tracker bundle. */
export interface VisitorSession {
  sessionId?: string;
  startedAt?: number;
  lastSeenAt?: number;
  initialReferrer?: string | null;
  pages?: SessionPage[];
  [key: string]: unknown;
}

/** Full data contract the person agent exposes to the chat orchestrator. */
export interface VisitorData {
  profile: VisitorProfile;
  events: VisitorEvent[];
  sessionPages?: SessionPage[];
  session?: VisitorSession;
}

/**
 * Pluggable data source interface.
 *
 * Implement this and call `setVisitorDataSource(impl)` to swap out the
 * default localStorage adapter for a CDP, session endpoint, or backend store.
 */
export interface VisitorDataSource {
  /** Stored persona and profile attributes. */
  getProfile(): VisitorProfile;
  /** Recent behavioural events (page reads, CTA clicks, etc.). */
  getEvents(): VisitorEvent[];
  /** Pages visited in the current browser session. */
  getSessionPages(): SessionPage[];
  /** Optional session metadata including id/referrer. */
  getSession?(): VisitorSession;
  /** Current permission/storage state for persisted behavioral intelligence. */
  getConsentState?(): { analytics: boolean; storageAvailable: boolean };
}

// Module-global singleton — set before React mounts so it is always available.
let _source: VisitorDataSource | null = null;

/** Replace the active data source. Passing null falls back to localStorage. */
export function setVisitorDataSource(source: VisitorDataSource | null): void {
  _source = source;
}

/** Read the active data source, falling back to the lazy-loaded localStorage adapter. */
export async function getVisitorDataSource(): Promise<VisitorDataSource> {
  if (_source) return _source;
  // Lazy import: only loaded when no custom source is set.
  const { localStorageSource } = await import('./localStorageSource');
  return localStorageSource;
}
