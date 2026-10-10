/**
 * personAgent — calls the person orchestrator agent via runToolLoop.
 *
 * The person agent is responsible for synthesising the three sub-agent signals
 * (profile, events, session pages) into a single holistic visitor profile that
 * the chat orchestrator can use to personalise its answer.
 *
 * The three sub-agent tool handlers each:
 *   1. Read their slice from the active VisitorDataSource
 *   2. POST that slice as input to the corresponding Agent Studio sub-agent
 *   3. Return the sub-agent's interpreted JSON output
 *
 * Result reuse requires an unchanged material-signal fingerprint within TTL.
 * A null person config means visitor intelligence is not registered or fetched.
 */

import { runToolLoop, type CompletionsConfig, type ToolRegistry } from '../shared/agentStudio';
import { getVisitorDataSource } from './visitorDataSource';
import {
  buildVisitorSignalPacket,
  computeVisitorSignalFingerprint,
  emptyVisitorIntelligencePacket,
  validateEventAnalysis,
  validateProfileAnalysis,
  validateSessionAnalysis,
  validateVisitorIntelligencePacket,
  withFreshness,
  type EventAnalysisV1,
  type ProfileAnalysisV1,
  type SessionAnalysisV1,
  type ValidationResult,
  type VisitorIntelligencePacketV1,
  type VisitorSignalPacketV1,
} from './contracts';
import type { PersonConfig, PersonAgentRole } from '../connectChatPerson';

// ── Exported descriptor matching the IS renderState shape ─────────────────────

export interface PersonAgentDescriptor {
  id: string;
  role: PersonAgentRole;
  label?: string;
}

// ── Cache ─────────────────────────────────────────────────────────────────────

interface ProfileCache {
  profile: VisitorIntelligencePacketV1;
  timestamp: number;
  fingerprint: string;
  visitorId: string | null;
  sessionId: string | null;
}

let _cache: ProfileCache | null = null;

function isCacheValid(
  cache: ProfileCache,
  signalPacket: VisitorSignalPacketV1,
  fingerprint: string,
  ttlMs: number,
): boolean {
  const age = Date.now() - cache.timestamp;
  if (age > ttlMs) return false;
  if (cache.fingerprint !== fingerprint) return false;
  if (cache.visitorId !== signalPacket.session.visitorId) return false;
  if (cache.sessionId !== signalPacket.session.sessionId) return false;
  return true;
}

export function clearPersonProfileCache(): void {
  _cache = null;
}

// ── Sub-agent caller ──────────────────────────────────────────────────────────

/** Algolia credentials for the completions endpoint. */
interface PersonEnv {
  appId: string;
  searchKey: string;
}

type PersonSchemaName = 'ProfileAnalysisV1' | 'EventAnalysisV1' | 'SessionAnalysisV1';
const PERSON_PIPELINE_TIMEOUT_MS = 5_000;

/** Call a person sub-agent (profile / events / session) with its slice of data. */
async function callSubAgent(
  config: CompletionsConfig,
  data: unknown,
  schemaName: PersonSchemaName,
  validate: (raw: unknown) => ValidationResult<unknown>,
): Promise<unknown> {
  const dataJson = JSON.stringify(data);
  const first = await runToolLoop(config, { query: `Analyse this VisitorSignalPacketV1 slice and return only ${schemaName} JSON:\n${dataJson}` }, {});
  const firstParsed = parseAndValidate(first.content, validate);
  if (firstParsed.ok) return firstParsed.value;

  const retry = await runToolLoop(
    config,
    {
      query:
        `schema correction: your previous response did not validate as ${schemaName}. ` +
        `Return valid JSON only, with no prose, for this input:\n${dataJson}\nErrors: ${firstParsed.errors.join('; ')}`,
    },
    {},
  );
  const retryParsed = parseAndValidate(retry.content, validate);
  if (retryParsed.ok) return retryParsed.value;
  return deterministicSubAgentFallback(schemaName, retryParsed.errors);
}

/**
 * Interpret one slice of visitor data.
 *
 * Falls back to the raw slice when no sub-agent is configured for that role, so
 * a partial configuration still yields a usable profile.
 */
async function analyseSlice(
  env: PersonEnv,
  descriptor: PersonAgentDescriptor | undefined,
  data: unknown,
  schemaName: PersonSchemaName,
): Promise<unknown> {
  const validate: (raw: unknown) => ValidationResult<unknown> =
    schemaName === 'ProfileAnalysisV1'
      ? validateProfileAnalysis
      : schemaName === 'EventAnalysisV1'
        ? validateEventAnalysis
        : validateSessionAnalysis;
  if (!descriptor) return deterministicSubAgentFallback(schemaName, []);
  try {
    return await callSubAgent({ ...env, agentId: descriptor.id }, data, schemaName, validate);
  } catch (error) {
    return deterministicSubAgentFallback(schemaName, [errorMessage(error)]);
  }
}

// ── Main resolver ─────────────────────────────────────────────────────────────

/**
 * Build a ToolRegistry for the chat orchestrator's `get_visitor_profile` tool.
 *
 * When called, this tool:
 *  1. Reads local visitor data from the active VisitorDataSource
 *  2. Runs each configured sub-agent against its slice of data (in parallel)
 *  3. Calls the person orchestrator agent to synthesise the sub-agent outputs
 *  4. Returns the synthesised profile JSON
 *
 * Results are cached per `personConfig.ttlMs` (default 10 min), but reused only
 * while the normalized material-signal fingerprint remains unchanged.
 */
export function buildPersonToolRegistry(
  personConfig: PersonConfig,
  appId: string,
  searchKey: string,
): ToolRegistry {
  const {
    agentId: personAgentId,
    agents: subAgents = [],
    ttlMs = 10 * 60 * 1000,
  } = personConfig;

  if (!personAgentId) return {};

  const env: PersonEnv = { appId, searchKey };
  const subAgentsByRole = Object.fromEntries(subAgents.map((a) => [a.role, a])) as Partial<
    Record<PersonAgentRole, PersonAgentDescriptor>
  >;

  return {
    get_visitor_profile: () =>
      acquireVisitorIntelligence({ env, personAgentId, subAgentsByRole, ttlMs }),
  };
}

interface PersonResolverContext {
  env: PersonEnv,
  personAgentId: string;
  subAgentsByRole: Partial<Record<PersonAgentRole, PersonAgentDescriptor>>;
}

interface PersonAcquisitionContext extends PersonResolverContext {
  ttlMs: number;
}

async function acquireVisitorIntelligence(
  context: PersonAcquisitionContext,
): Promise<VisitorIntelligencePacketV1> {
  const source = await getVisitorDataSource();
  const signalPacket = readCurrentSignals(source);
  const fingerprint = computeVisitorSignalFingerprint(signalPacket);
  if (_cache && isCacheValid(_cache, signalPacket, fingerprint, context.ttlMs)) {
    return withFreshness(_cache.profile, signalPacket, fingerprint, 'hit');
  }

  const resolved = resolvePersonIntelligence(context, signalPacket, fingerprint).then((packet) => ({
    packet,
    cacheable: true,
  }));
  const result = await withPersonBudget(resolved, signalPacket, fingerprint);
  if (result.cacheable) cachePacket(result.packet, signalPacket, fingerprint);
  return result.packet;
}

function readCurrentSignals(source: Awaited<ReturnType<typeof getVisitorDataSource>>): VisitorSignalPacketV1 {
  const consent = readConsentState(source);
  const allowed = consent.analytics && consent.storageAvailable;
  if (!allowed) {
    return buildVisitorSignalPacket(
      { profile: {}, events: [], sessionPages: [] },
      currentPageContext(consent),
    );
  }

  const session = source.getSession ? source.getSession() : undefined;
  const sessionPages = session?.pages ?? source.getSessionPages();
  return buildVisitorSignalPacket(
    {
      profile: source.getProfile(),
      events: source.getEvents(),
      sessionPages,
      session,
    },
    currentPageContext(consent),
  );
}

/**
 * Read the same consent-filtered, normalized browser packet used by the Person
 * pipeline without invoking any Person agents. Native turn-context experiments
 * use this path to measure the deterministic zero-LLM alternative.
 */
export async function readVisitorSignalPacket(): Promise<VisitorSignalPacketV1> {
  return readCurrentSignals(await getVisitorDataSource());
}

function readConsentState(source: Awaited<ReturnType<typeof getVisitorDataSource>>): {
  analytics: boolean;
  storageAvailable: boolean;
} {
  return source.getConsentState
    ? source.getConsentState()
    : { analytics: true, storageAvailable: true };
}

function cachePacket(
  packet: VisitorIntelligencePacketV1,
  signalPacket: VisitorSignalPacketV1,
  fingerprint: string,
): void {
  _cache = {
    profile: packet,
    timestamp: Date.now(),
    fingerprint,
    visitorId: signalPacket.session.visitorId,
    sessionId: signalPacket.session.sessionId,
  };
}

async function resolvePersonIntelligence(
  context: PersonResolverContext,
  signalPacket: VisitorSignalPacketV1,
  fingerprint: string,
): Promise<VisitorIntelligencePacketV1> {
  const eventSignals = {
    searches: signalPacket.searches,
    meaningfulActions: signalPacket.meaningfulActions,
  };
  const sessionSignals = {
    journey: signalPacket.journey,
    currentPage: signalPacket.currentPage,
    readSignal: signalPacket.readSignal,
    initialReferrer: signalPacket.session.initialReferrer,
  };
  const [profile, events, sessionPages] = await Promise.all([
    analyseSlice(context.env, context.subAgentsByRole.profile, signalPacket.profile, 'ProfileAnalysisV1'),
    analyseSlice(context.env, context.subAgentsByRole.events, eventSignals, 'EventAnalysisV1'),
    analyseSlice(context.env, context.subAgentsByRole.session, sessionSignals, 'SessionAnalysisV1'),
  ]);
  const synthesised = await synthesiseProfile(
    { ...context.env, agentId: context.personAgentId },
    { signalPacket, profile, events, sessionPages },
    fingerprint,
  );
  return withFreshness(synthesised, signalPacket, fingerprint, 'miss');
}

function partialResult(
  signalPacket: VisitorSignalPacketV1,
  fingerprint: string,
  error: string,
): { packet: VisitorIntelligencePacketV1; cacheable: false } {
  const fallback = emptyVisitorIntelligencePacket(signalPacket, fingerprint, 'partial', [error]);
  return {
    packet: withFreshness(fallback, signalPacket, fingerprint, 'bypass'),
    cacheable: false,
  };
}

function withPersonBudget(
  resolved: Promise<{ packet: VisitorIntelligencePacketV1; cacheable: boolean }>,
  signalPacket: VisitorSignalPacketV1,
  fingerprint: string,
): Promise<{ packet: VisitorIntelligencePacketV1; cacheable: boolean }> {
  return new Promise((resolve) => {
    const timer = setTimeout(
      () => resolve(partialResult(signalPacket, fingerprint, 'person intelligence timed out')),
      PERSON_PIPELINE_TIMEOUT_MS,
    );
    resolved.then(
      (result) => {
        clearTimeout(timer);
        resolve(result);
      },
      (error) => {
        clearTimeout(timer);
        resolve(partialResult(signalPacket, fingerprint, errorMessage(error)));
      },
    );
  });
}

function currentPath(): string {
  return typeof location === 'undefined' ? '' : location.pathname;
}

function currentPageContext(consent: { analytics: boolean; storageAvailable: boolean }): {
  path: string;
  title: string;
  snapshotNow: number;
  consentAllowed: boolean;
  storageAvailable: boolean;
} {
  return {
    path: currentPath(),
    title: typeof document === 'undefined' ? '' : document.title,
    snapshotNow: Date.now(),
    consentAllowed: consent.analytics,
    storageAvailable: consent.storageAvailable,
  };
}

/** Ask the person orchestrator to fold the interpreted slices into one profile. */
async function synthesiseProfile(
  config: CompletionsConfig,
  slices: Record<string, unknown>,
  fingerprint: string,
): Promise<VisitorIntelligencePacketV1> {
  const signalPacket = slices.signalPacket as VisitorSignalPacketV1;
  const synthesis = await runToolLoop(
    config,
    {
      query: `Synthesise this validated Person Intelligence input into VisitorIntelligencePacketV1 JSON only:\n${JSON.stringify(slices)}`,
    },
    {},
  );
  const parsed = parseAndValidate(synthesis.content, validateVisitorIntelligencePacket);
  if (parsed.ok) return parsed.value!;

  const retry = await runToolLoop(
    config,
    {
      query:
        'schema correction: your previous response did not validate as VisitorIntelligencePacketV1. ' +
        `Return valid JSON only, with no prose. Errors: ${parsed.errors.join('; ')}\nInput:\n${JSON.stringify(slices)}`,
    },
    {},
  );
  const retryParsed = parseAndValidate(retry.content, validateVisitorIntelligencePacket);
  if (retryParsed.ok) return retryParsed.value!;
  return emptyVisitorIntelligencePacket(signalPacket, fingerprint, 'error', retryParsed.errors);
}

function parseAndValidate<T>(
  content: string,
  validate: (raw: unknown) => ValidationResult<T>,
): ValidationResult<T> {
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    return { ok: false, errors: ['response was not valid JSON'] };
  }
  return validate(raw);
}

function deterministicSubAgentFallback(
  schemaName: PersonSchemaName,
  errors: string[],
): ProfileAnalysisV1 | EventAnalysisV1 | SessionAnalysisV1 {
  const confidence = { level: 'low' as const };
  const provenance = [{ source: 'validator', field: 'status' }];
  if (schemaName === 'ProfileAnalysisV1') {
    return {
      schemaVersion: 'ProfileAnalysisV1',
      persona: null,
      expertise: 'unknown',
      interests: [],
      preferences: {},
      visitHistory: {},
      confidence,
      provenance,
      missingFields: errors.length ? errors : ['profile'],
    };
  }
  if (schemaName === 'EventAnalysisV1') {
    return {
      schemaVersion: 'EventAnalysisV1',
      recentTopics: [],
      meaningfulActions: [],
      searches: [],
      ctaIntent: null,
      recency: 'none',
      signalStrength: 'none',
      confidence,
      provenance,
      missingFields: errors.length ? errors : ['events'],
    };
  }
  return {
    schemaVersion: 'SessionAnalysisV1',
    currentFocus: null,
    orderedJourney: [],
    pageTransitions: [],
    dwellReadDepth: {},
    scrollSignal: {},
    decisionStageIndicators: [],
    confidence,
    provenance,
    missingFields: errors.length ? errors : ['session'],
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
