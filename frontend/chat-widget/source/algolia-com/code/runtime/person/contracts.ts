/* eslint-disable complexity, max-statements, sonarjs/cognitive-complexity, max-lines */
import {
  ingestProfileHints,
  SLOT_NAMES,
  type DiscoveryLedgerState,
  type SlotName,
} from '../chat/discoveryLedger';
import type { SessionPage, VisitorData, VisitorEvent } from './visitorDataSource';

export type ConfidenceLevel = 'low' | 'medium' | 'high';
export type ExpertiseLevel = 'unknown' | 'beginner' | 'intermediate' | 'expert';
export type DataAvailability = 'available' | 'empty' | 'unavailable';

export interface ValidationResult<T> {
  ok: boolean;
  value?: T;
  errors: string[];
}

export interface ProvenanceEntry {
  source: string;
  field: string;
}

export interface Confidence {
  level: ConfidenceLevel;
  score?: number;
}

export interface ProfileAnalysisV1 {
  schemaVersion: 'ProfileAnalysisV1';
  persona: string | null;
  expertise: ExpertiseLevel;
  interests: string[];
  preferences: Record<string, unknown>;
  visitHistory: Record<string, unknown>;
  confidence: Confidence;
  provenance: ProvenanceEntry[];
  missingFields: string[];
}

export interface EventAnalysisV1 {
  schemaVersion: 'EventAnalysisV1';
  recentTopics: string[];
  meaningfulActions: Array<Record<string, unknown>>;
  searches: Array<Record<string, unknown>>;
  ctaIntent: string | null;
  recency: 'none' | 'stale' | 'recent';
  signalStrength: ConfidenceLevel | 'none';
  confidence: Confidence;
  provenance: ProvenanceEntry[];
  missingFields: string[];
}

export interface SessionAnalysisV1 {
  schemaVersion: 'SessionAnalysisV1';
  currentFocus: string | null;
  orderedJourney: Array<Record<string, unknown>>;
  pageTransitions: Array<Record<string, unknown>>;
  dwellReadDepth: Record<string, unknown>;
  scrollSignal: Record<string, unknown>;
  decisionStageIndicators: string[];
  confidence: Confidence;
  provenance: ProvenanceEntry[];
  missingFields: string[];
}

export interface VisitorHypothesis {
  slot: string;
  value: string;
  confidence: ConfidenceLevel;
  provenance: ProvenanceEntry[];
}

export interface VisitorFact {
  slot: string;
  value: string;
  source: string;
}

export interface VisitorIntelligencePacketV1 {
  schemaVersion: 'VisitorIntelligencePacketV1';
  generatedAt: string;
  sourceSnapshotAt: string;
  freshness: {
    state: 'fresh' | 'stale' | 'empty' | 'partial' | 'error';
    cache: 'hit' | 'miss' | 'bypass';
    fingerprint: string;
  };
  status: { state: 'ok' | 'partial' | 'error' | 'empty'; errors: string[] };
  persona: string | null;
  expertise: ExpertiseLevel;
  interests: string[];
  currentPage: { path: string; title: string };
  referrer: string | null;
  currentFocus: string | null;
  safeJourneySummary: string | null;
  behaviorSummary: string | null;
  confirmedFacts: VisitorFact[];
  hypotheses: VisitorHypothesis[];
  discoveryHints: Partial<Record<SlotName, string>>;
  missingInformation: string[];
  contradictions: string[];
  confidence: Confidence;
  provenance: ProvenanceEntry[];
}

export interface VisitorSignalPacketV1 {
  schemaVersion: 'VisitorSignalPacketV1';
  snapshotAt: string;
  session: {
    visitorId: string | null;
    sessionId: string | null;
    startedAt: string | null;
    initialReferrer: string | null;
    visitCount: number | null;
    firstSeen: string | null;
    consent: {
      analytics: boolean;
      storage: 'available' | 'unavailable';
    };
  };
  currentPage: {
    path: string;
    title: string;
    dwellMs: number;
    maxScrollDepth: number;
  };
  journey: Array<{
    sequence: number;
    path: string;
    title: string;
    enteredAt: string | null;
    dwellMs: number;
    maxScrollDepth: number;
    previousPath: string | null;
  }>;
  searches: Array<{ query: string; path: string; ts: string }>;
  meaningfulActions: Array<{ type: string; name: string | null; label: string | null; path: string; ts: string }>;
  readSignal: {
    readDepth: 'none' | 'shallow' | 'medium' | 'deep';
    maxScrollDepth: number;
    dwellMs: number;
  };
  profile: {
    persona: string | null;
    interests: string[];
    attributes: Record<string, unknown>;
  };
  dataAvailability: {
    profile: DataAvailability;
    events: DataAvailability;
    session: DataAvailability;
    errors: string[];
  };
}

export interface VisitorSignalBuildContext {
  path: string;
  title: string;
  snapshotNow?: number;
  storageAvailable?: boolean;
  consentAllowed?: boolean;
}

const SENSITIVE_KEYS = /pass(word)?|secret|token|email|phone|value|input|name/i;
const EMAIL_VALUE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const PHONE_VALUE = /(?:\+?\d[\d\s().-]{7,}\d)/;
function success<T>(value: T): ValidationResult<T> {
  return { ok: true, value, errors: [] };
}

function failure<T>(errors: string[]): ValidationResult<T> {
  return { ok: false, errors };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

function isProvenanceArray(value: unknown): value is ProvenanceEntry[] {
  return (
    Array.isArray(value) &&
    value.every((v) => isObject(v) && typeof v.source === 'string' && typeof v.field === 'string')
  );
}

function validateConfidence(value: unknown): value is Confidence {
  if (!isObject(value)) return false;
  if (value.level !== 'low' && value.level !== 'medium' && value.level !== 'high') return false;
  return value.score === undefined || (typeof value.score === 'number' && Number.isFinite(value.score));
}

function isExpertise(value: unknown): value is ExpertiseLevel {
  return value === 'unknown' || value === 'beginner' || value === 'intermediate' || value === 'expert';
}

function isSlotName(value: unknown): value is SlotName {
  return typeof value === 'string' && (SLOT_NAMES as readonly string[]).includes(value);
}

function isVisitorFact(value: unknown): value is VisitorFact {
  return (
    isObject(value) &&
    isSlotName(value.slot) &&
    typeof value.value === 'string' &&
    Boolean(value.value.trim()) &&
    value.source === 'visitor_message'
  );
}

function isVisitorHypothesis(value: unknown): value is VisitorHypothesis {
  return (
    isObject(value) &&
    isSlotName(value.slot) &&
    typeof value.value === 'string' &&
    Boolean(value.value.trim()) &&
    (value.confidence === 'low' || value.confidence === 'medium' || value.confidence === 'high') &&
    isProvenanceArray(value.provenance)
  );
}

function isDiscoveryHints(value: unknown): value is Partial<Record<SlotName, string>> {
  if (!isObject(value)) return false;
  return Object.entries(value).every(
    ([slot, hint]) => isSlotName(slot) && typeof hint === 'string' && Boolean(hint.trim()),
  );
}

function baseAnalysisErrors(raw: unknown, version: string): string[] {
  if (!isObject(raw)) return ['packet must be an object'];
  const errors: string[] = [];
  if (raw.schemaVersion !== version) errors.push(`schemaVersion must be ${version}`);
  if (!validateConfidence(raw.confidence)) errors.push('confidence must include level low|medium|high');
  if (!isProvenanceArray(raw.provenance)) errors.push('provenance must be an array of {source,field}');
  if (!isStringArray(raw.missingFields)) errors.push('missingFields must be a string array');
  return errors;
}

export function validateProfileAnalysis(raw: unknown): ValidationResult<ProfileAnalysisV1> {
  const errors = baseAnalysisErrors(raw, 'ProfileAnalysisV1');
  if (!isObject(raw)) return failure(errors);
  if (raw.persona !== null && typeof raw.persona !== 'string') errors.push('persona must be string|null');
  if (!isExpertise(raw.expertise)) errors.push('expertise has invalid enum value');
  if (!isStringArray(raw.interests)) errors.push('interests must be a string array');
  if (!isObject(raw.preferences)) errors.push('preferences must be an object');
  if (!isObject(raw.visitHistory)) errors.push('visitHistory must be an object');
  return errors.length ? failure(errors) : success(raw as unknown as ProfileAnalysisV1);
}

export function validateEventAnalysis(raw: unknown): ValidationResult<EventAnalysisV1> {
  const errors = baseAnalysisErrors(raw, 'EventAnalysisV1');
  if (!isObject(raw)) return failure(errors);
  if (!isStringArray(raw.recentTopics)) errors.push('recentTopics must be a string array');
  if (!Array.isArray(raw.meaningfulActions)) errors.push('meaningfulActions must be an array');
  if (!Array.isArray(raw.searches)) errors.push('searches must be an array');
  if (raw.ctaIntent !== null && typeof raw.ctaIntent !== 'string') errors.push('ctaIntent must be string|null');
  if (raw.recency !== 'none' && raw.recency !== 'stale' && raw.recency !== 'recent') errors.push('recency invalid');
  if (
    raw.signalStrength !== 'none' &&
    raw.signalStrength !== 'low' &&
    raw.signalStrength !== 'medium' &&
    raw.signalStrength !== 'high'
  ) {
    errors.push('signalStrength invalid');
  }
  return errors.length ? failure(errors) : success(raw as unknown as EventAnalysisV1);
}

export function validateSessionAnalysis(raw: unknown): ValidationResult<SessionAnalysisV1> {
  const errors = baseAnalysisErrors(raw, 'SessionAnalysisV1');
  if (!isObject(raw)) return failure(errors);
  if (raw.currentFocus !== null && typeof raw.currentFocus !== 'string') errors.push('currentFocus must be string|null');
  if (!Array.isArray(raw.orderedJourney)) errors.push('orderedJourney must be an array');
  if (!Array.isArray(raw.pageTransitions)) errors.push('pageTransitions must be an array');
  if (!isObject(raw.dwellReadDepth)) errors.push('dwellReadDepth must be an object');
  if (!isObject(raw.scrollSignal)) errors.push('scrollSignal must be an object');
  if (!isStringArray(raw.decisionStageIndicators)) errors.push('decisionStageIndicators must be a string array');
  return errors.length ? failure(errors) : success(raw as unknown as SessionAnalysisV1);
}

export function validateVisitorIntelligencePacket(
  raw: unknown,
): ValidationResult<VisitorIntelligencePacketV1> {
  if (!isObject(raw)) return failure(['packet must be an object']);
  const errors: string[] = [];
  if (raw.schemaVersion !== 'VisitorIntelligencePacketV1') errors.push('schemaVersion must be VisitorIntelligencePacketV1');
  if (!isIsoString(raw.generatedAt)) errors.push('generatedAt must be an ISO timestamp');
  if (!isIsoString(raw.sourceSnapshotAt)) errors.push('sourceSnapshotAt must be an ISO timestamp');
  if (!isObject(raw.freshness)) {
    errors.push('freshness is required');
  } else {
    if (!['fresh', 'stale', 'empty', 'partial', 'error'].includes(String(raw.freshness.state))) {
      errors.push('freshness.state invalid');
    }
    if (!['hit', 'miss', 'bypass'].includes(String(raw.freshness.cache))) errors.push('freshness.cache invalid');
    if (typeof raw.freshness.fingerprint !== 'string') errors.push('freshness.fingerprint required');
  }
  if (!isObject(raw.status)) {
    errors.push('status is required');
  } else {
    if (!['ok', 'partial', 'error', 'empty'].includes(String(raw.status.state))) errors.push('status.state invalid');
    if (!isStringArray(raw.status.errors)) errors.push('status.errors must be a string array');
  }
  if (raw.persona !== null && typeof raw.persona !== 'string') errors.push('persona must be string|null');
  if (!isExpertise(raw.expertise)) errors.push('expertise invalid');
  if (!isStringArray(raw.interests)) errors.push('interests must be a string array');
  if (
    !isObject(raw.currentPage) ||
    typeof raw.currentPage.path !== 'string' ||
    typeof raw.currentPage.title !== 'string'
  ) {
    errors.push('currentPage must contain path and title strings');
  }
  if (raw.referrer !== null && typeof raw.referrer !== 'string') {
    errors.push('referrer must be string|null');
  }
  if (raw.currentFocus !== null && typeof raw.currentFocus !== 'string') errors.push('currentFocus must be string|null');
  if (raw.safeJourneySummary !== null && typeof raw.safeJourneySummary !== 'string') {
    errors.push('safeJourneySummary must be string|null');
  }
  if (raw.behaviorSummary !== null && typeof raw.behaviorSummary !== 'string') {
    errors.push('behaviorSummary must be string|null');
  }
  if (!Array.isArray(raw.confirmedFacts) || !raw.confirmedFacts.every(isVisitorFact)) {
    errors.push('confirmedFacts must contain valid visitor-stated slot facts');
  }
  if (!Array.isArray(raw.hypotheses) || !raw.hypotheses.every(isVisitorHypothesis)) {
    errors.push('hypotheses must contain valid slot hypotheses with confidence and provenance');
  }
  if (!isDiscoveryHints(raw.discoveryHints)) {
    errors.push('discoveryHints must contain only valid slot names and non-empty values');
  }
  if (!isStringArray(raw.missingInformation)) errors.push('missingInformation must be a string array');
  if (!isStringArray(raw.contradictions)) errors.push('contradictions must be a string array');
  if (!validateConfidence(raw.confidence)) errors.push('confidence invalid');
  if (!isProvenanceArray(raw.provenance)) errors.push('provenance invalid');
  return errors.length ? failure(errors) : success(raw as unknown as VisitorIntelligencePacketV1);
}

export function validateVisitorSignalPacket(raw: unknown): ValidationResult<VisitorSignalPacketV1> {
  if (!isObject(raw)) return failure(['packet must be an object']);
  const errors: string[] = [];
  if (raw.schemaVersion !== 'VisitorSignalPacketV1') errors.push('schemaVersion must be VisitorSignalPacketV1');
  if (!isIsoString(raw.snapshotAt)) errors.push('snapshotAt must be an ISO timestamp');
  if (!isObject(raw.session)) errors.push('session is required');
  if (!isObject(raw.currentPage)) errors.push('currentPage is required');
  if (!Array.isArray(raw.journey)) errors.push('journey must be an array');
  if (!Array.isArray(raw.searches)) errors.push('searches must be an array');
  if (!Array.isArray(raw.meaningfulActions)) errors.push('meaningfulActions must be an array');
  if (!isObject(raw.readSignal)) errors.push('readSignal is required');
  if (!isObject(raw.profile)) errors.push('profile is required');
  if (!isObject(raw.dataAvailability)) errors.push('dataAvailability is required');
  return errors.length ? failure(errors) : success(raw as unknown as VisitorSignalPacketV1);
}

export function buildVisitorSignalPacket(
  data: VisitorData,
  context: VisitorSignalBuildContext,
): VisitorSignalPacketV1 {
  const snapshotNow = context.snapshotNow ?? Date.now();
  const profile = data.profile ?? {};
  const session = data.session ?? { pages: data.sessionPages ?? [] };
  const pages = Array.isArray(session.pages) ? session.pages : data.sessionPages ?? [];
  const journey = pages.map((page, index) => normalizeJourneyPage(page, index, pages[index - 1]));
  const currentFromJourney = [...journey].reverse().find((p) => p.path === context.path);
  const dwellMs =
    currentFromJourney && pages[journey.indexOf(currentFromJourney)]?.enteredAt
      ? Math.max(
          currentFromJourney.dwellMs,
          snapshotNow - Number(pages[journey.indexOf(currentFromJourney)].enteredAt),
        )
      : currentFromJourney?.dwellMs ?? 0;
  const maxScrollDepth = currentFromJourney?.maxScrollDepth ?? maxScrollFromEvents(data.events ?? [], context.path);
  const searches = normalizeSearches(data.events ?? []);
  const meaningfulActions = normalizeMeaningfulActions(data.events ?? []);
  const storageAvailable = context.storageAvailable ?? true;
  const consentAllowed = context.consentAllowed ?? true;
  const storedIntelligenceAllowed = storageAvailable && consentAllowed;

  return {
    schemaVersion: 'VisitorSignalPacketV1',
    snapshotAt: toIso(snapshotNow),
    session: {
      visitorId: storedIntelligenceAllowed ? safeString(profile.userToken) : null,
      sessionId: storedIntelligenceAllowed ? safeString(session.sessionId) : null,
      startedAt: storedIntelligenceAllowed ? toNullableIso(session.startedAt) : null,
      initialReferrer: storedIntelligenceAllowed ? sanitizeReferrer(session.initialReferrer) : null,
      visitCount: storedIntelligenceAllowed && typeof profile.visits === 'number' ? profile.visits : null,
      firstSeen: storedIntelligenceAllowed ? toNullableIso(profile.firstSeen) : null,
      consent: {
        analytics: consentAllowed,
        storage: storageAvailable ? 'available' : 'unavailable',
      },
    },
    currentPage: {
      path: sanitizePath(context.path),
      title: sanitizeTitle(context.title, context.path),
      dwellMs: Math.max(0, Math.round(dwellMs)),
      maxScrollDepth,
    },
    journey: storedIntelligenceAllowed ? journey : [],
    searches: storedIntelligenceAllowed ? searches : [],
    meaningfulActions: storedIntelligenceAllowed ? meaningfulActions : [],
    readSignal: {
      readDepth: readDepth(Math.max(dwellMs, 0), maxScrollDepth),
      maxScrollDepth,
      dwellMs: Math.max(0, Math.round(dwellMs)),
    },
    profile: {
      persona: storedIntelligenceAllowed ? safeString(profile.persona) : null,
      interests:
        storedIntelligenceAllowed && Array.isArray(profile.interests)
          ? profile.interests.filter((v): v is string => typeof v === 'string')
          : [],
      attributes: storedIntelligenceAllowed ? sanitizeRecord(profile) : {},
    },
    dataAvailability: {
      profile: storedIntelligenceAllowed ? (Object.keys(profile).length ? 'available' : 'empty') : 'unavailable',
      events: storedIntelligenceAllowed ? ((data.events ?? []).length ? 'available' : 'empty') : 'unavailable',
      session: storedIntelligenceAllowed ? (pages.length ? 'available' : 'empty') : 'unavailable',
      errors: [],
    },
  };
}

export function computeVisitorSignalFingerprint(packet: VisitorSignalPacketV1): string {
  const stablePacket = {
    ...packet,
    snapshotAt: undefined,
    currentPage: {
      ...packet.currentPage,
      dwellMs: materialDwellBucket(packet.currentPage.dwellMs),
    },
    journey: packet.journey.map((page) => ({
      ...page,
      dwellMs: materialDwellBucket(page.dwellMs),
    })),
    readSignal: {
      ...packet.readSignal,
      dwellMs: materialDwellBucket(packet.readSignal.dwellMs),
    },
  };
  return hashStableJson(stablePacket);
}

function materialDwellBucket(dwellMs: number): number {
  if (dwellMs >= 90_000) return 90_000;
  if (dwellMs >= 30_000) return 30_000;
  if (dwellMs >= 10_000) return 10_000;
  return 0;
}

export function emptyVisitorIntelligencePacket(
  signalPacket: VisitorSignalPacketV1,
  fingerprint: string,
  state: 'empty' | 'error' | 'partial' = 'empty',
  errors: string[] = [],
): VisitorIntelligencePacketV1 {
  return {
    schemaVersion: 'VisitorIntelligencePacketV1',
    generatedAt: new Date().toISOString(),
    sourceSnapshotAt: signalPacket.snapshotAt,
    freshness: {
      state: state === 'error' ? 'error' : state,
      cache: 'miss',
      fingerprint,
    },
    status: { state, errors },
    persona: null,
    expertise: 'unknown',
    interests: [],
    currentPage: {
      path: signalPacket.currentPage.path,
      title: signalPacket.currentPage.title,
    },
    referrer: signalPacket.session.initialReferrer,
    currentFocus: null,
    safeJourneySummary: null,
    behaviorSummary: null,
    confirmedFacts: [],
    hypotheses: [],
    discoveryHints: {},
    missingInformation: ['persona', 'intent', 'pain_point'],
    contradictions: [],
    confidence: { level: 'low' },
    provenance: [{ source: 'validator', field: 'status' }],
  };
}

export function withFreshness(
  packet: VisitorIntelligencePacketV1,
  signalPacket: VisitorSignalPacketV1,
  fingerprint: string,
  cache: 'hit' | 'miss' | 'bypass',
): VisitorIntelligencePacketV1 {
  return {
    ...packet,
    currentPage: {
      path: signalPacket.currentPage.path,
      title: signalPacket.currentPage.title,
    },
    referrer: signalPacket.session.initialReferrer,
    sourceSnapshotAt: signalPacket.snapshotAt,
    freshness: {
      ...packet.freshness,
      state:
        packet.status.state === 'error'
          ? 'error'
          : packet.status.state === 'empty'
            ? 'empty'
            : packet.status.state === 'partial'
              ? 'partial'
              : 'fresh',
      cache,
      fingerprint,
    },
  };
}

export function ingestVisitorIntelligence(
  ledger: DiscoveryLedgerState,
  packet: VisitorIntelligencePacketV1,
  turn: number,
): DiscoveryLedgerState {
  return ingestProfileHints(ledger, packet.discoveryHints, turn);
}

function normalizeJourneyPage(
  page: SessionPage,
  index: number,
  previous: SessionPage | undefined,
): VisitorSignalPacketV1['journey'][number] {
  return {
    sequence: index + 1,
    path: sanitizePath(page.path),
    title: sanitizeTitle(page.title, page.path),
    enteredAt: toNullableIso(page.enteredAt),
    dwellMs: Math.max(0, Math.round(numberOrZero(page.dwellMs))),
    maxScrollDepth: clampScroll(numberOrZero(page.maxScrollDepth)),
    previousPath: previous?.path ? sanitizePath(previous.path) : null,
  };
}

function normalizeSearches(events: VisitorEvent[]): VisitorSignalPacketV1['searches'] {
  return events.flatMap((event) => {
    const name = eventName(event);
    if (name !== 'search' && name !== 'site_search' && name !== 'query') return [];
    const props = isObject(event.props) ? event.props : isObject(event.meta) ? event.meta : {};
    const query =
      sanitizeBehaviorText(props.query, 160) ??
      sanitizeBehaviorText(props.search, 160) ??
      sanitizeBehaviorText(props.term, 160);
    if (!query) return [];
    return [{ query, path: sanitizePath(event.path ?? event.page), ts: toIso(numberOrZero(event.ts)) }];
  });
}

function normalizeMeaningfulActions(events: VisitorEvent[]): VisitorSignalPacketV1['meaningfulActions'] {
  return events.flatMap((event) => {
    const name = eventName(event);
    if (name !== 'cta_click' && name !== 'navigation_click' && name !== 'meaningful_click') return [];
    const props = isObject(event.props) ? event.props : isObject(event.meta) ? event.meta : {};
    return [
      {
        type: name,
        name: sanitizeBehaviorText(props.cta, 80) ?? sanitizeBehaviorText(props.name, 80),
        label: sanitizeBehaviorText(props.label, 80),
        path: sanitizePath(event.path ?? event.page),
        ts: toIso(numberOrZero(event.ts)),
      },
    ];
  });
}

function maxScrollFromEvents(events: VisitorEvent[], path: string): number {
  return events.reduce((max, event) => {
    if ((event.path ?? event.page) !== path) return max;
    const props = isObject(event.props) ? event.props : isObject(event.meta) ? event.meta : {};
    return Math.max(max, clampScroll(numberOrZero(props.maxScrollDepth ?? props.scrollDepth)));
  }, 0);
}

function eventName(event: VisitorEvent): string {
  return String(event.name ?? event.type ?? '');
}

function readDepth(dwellMs: number, maxScrollDepth: number): VisitorSignalPacketV1['readSignal']['readDepth'] {
  if (dwellMs >= 90_000 || maxScrollDepth >= 75) return 'deep';
  if (dwellMs >= 30_000 || maxScrollDepth >= 50) return 'medium';
  if (dwellMs >= 10_000 || maxScrollDepth >= 25) return 'shallow';
  return 'none';
}

function sanitizeRecord(record: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (SENSITIVE_KEYS.test(key)) continue;
    if (value === undefined || typeof value === 'function') continue;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value === null) {
      out[key] = value;
    } else if (Array.isArray(value)) {
      out[key] = value.filter((item) => typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean');
    }
  }
  return out;
}

function safeString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function containsPii(value: string): boolean {
  return EMAIL_VALUE.test(value) || PHONE_VALUE.test(value);
}

function sanitizeBehaviorText(value: unknown, maxLength: number): string | null {
  const text = safeString(value);
  if (!text || containsPii(text)) return null;
  return text.trim().slice(0, maxLength);
}

function sanitizePath(value: unknown): string {
  const text = safeString(value);
  if (!text) return '';
  try {
    return new URL(text, `https:${'//visitor.invalid'}`).pathname.slice(0, 256);
  } catch {
    return text.split(/[?#]/, 1)[0].slice(0, 256);
  }
}

function sanitizeReferrer(value: unknown): string | null {
  const text = safeString(value);
  if (!text) return null;
  try {
    const url = new URL(text);
    return `${url.origin}${url.pathname}`.slice(0, 320);
  } catch {
    return sanitizePath(text) || null;
  }
}

function sanitizeTitle(value: unknown, path: unknown): string {
  const title = safeString(value);
  if (title && !containsPii(title)) return title.slice(0, 160);
  const segment = sanitizePath(path).split('/').filter(Boolean).at(-1) ?? '';
  return segment
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .slice(0, 160);
}

function numberOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function clampScroll(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function isIsoString(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function toNullableIso(value: unknown): string | null {
  if (typeof value === 'string' && !Number.isNaN(Date.parse(value))) return new Date(value).toISOString();
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return new Date(value).toISOString();
  return null;
}

function toIso(value: number): string {
  return new Date(value).toISOString();
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (isObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .filter((key) => value[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function hashStableJson(value: unknown): string {
  const input = stableStringify(value);
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
