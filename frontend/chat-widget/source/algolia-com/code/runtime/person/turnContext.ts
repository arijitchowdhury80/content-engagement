/**
 * turnContext — compact, deterministic transport for Agent Studio's native
 * per-turn context. This is deliberately a projection, never a raw telemetry
 * dump. The full visitor packet remains in the client runtime and ledger.
 */
import type { TurnContext } from '../shared/agentStudio.js';
import type { VisitorIntelligencePacketV1, VisitorSignalPacketV1 } from './contracts.js';

export const TURN_CONTEXT_LIMITS = {
  maxKeys: 32,
  maxBytes: 4096,
  maxValueBytes: 1024,
} as const;

const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const PHONE = /(?:\+?\d[\d\s().-]{7,}\d)/;
const SAFE_KEY = /^[A-Za-z0-9_.-]{1,64}$/;

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function compact(value: string | null | undefined, maxBytes = 280): string | null {
  if (!value) return null;
  const normalized = value.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!normalized || EMAIL.test(normalized) || PHONE.test(normalized)) return null;
  let out = normalized;
  while (out && byteLength(out) > Math.min(maxBytes, TURN_CONTEXT_LIMITS.maxValueBytes)) {
    out = out.slice(0, -1);
  }
  return out || null;
}

function safePath(path: string | null | undefined): string | null {
  if (!path) return null;
  if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(path)) {
    try {
      return compact(new URL(path).pathname, 256);
    } catch {
      // Fall through to the deliberately origin-free path projection below.
    }
  }
  return compact(path.split(/[?#]/, 1)[0], 256);
}

function origin(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return compact(new URL(value).origin, 160);
  } catch {
    return null;
  }
}

/** Apply documented Agent Studio limits deterministically, preserving insertion priority. */
export function boundedTurnContext(input: Record<string, string | null | undefined>): TurnContext {
  const output: TurnContext = {};
  for (const [key, raw] of Object.entries(input)) {
    if (Object.keys(output).length >= TURN_CONTEXT_LIMITS.maxKeys || !SAFE_KEY.test(key)) continue;
    const value = compact(raw);
    if (!value) continue;
    const candidate = { ...output, [key]: value };
    if (byteLength(JSON.stringify(candidate)) > TURN_CONTEXT_LIMITS.maxBytes) continue;
    output[key] = value;
  }
  return output;
}

function lastMeaningfulAction(packet: VisitorSignalPacketV1): string | null {
  const action = packet.meaningfulActions.at(-1);
  if (!action) return null;
  return [action.type, action.name ?? action.label].filter(Boolean).join(': ');
}

function journeyPaths(packet: VisitorSignalPacketV1): string | null {
  const paths = packet.journey
    .slice(-3)
    .map((page) => safePath(page.path))
    .filter((path): path is string => Boolean(path));
  return paths.length ? paths.join(' -> ') : null;
}

/** Candidate A: zero LLM calls; current browser evidence only. */
export function compileDeterministicTurnContext(packet: VisitorSignalPacketV1): TurnContext {
  return boundedTurnContext({
    'context.version': '1',
    'context.source': 'deterministic_browser_signals',
    'page.path': safePath(packet.currentPage.path),
    'page.title': packet.currentPage.title,
    'journey.paths': journeyPaths(packet),
    'journey.page_count': String(packet.journey.length),
    'behavior.read_depth': packet.readSignal.readDepth,
    'behavior.last_action': lastMeaningfulAction(packet),
    'behavior.referrer_origin': origin(packet.session.initialReferrer),
    'profile.persona': packet.profile.persona,
    'profile.interests': packet.profile.interests.slice(0, 3).join(', '),
  });
}

/** Candidate B: validated Person inference, still transported natively and compactly. */
export function compilePersonTurnContext(packet: VisitorIntelligencePacketV1): TurnContext {
  const intent = packet.hypotheses.find((hypothesis) => hypothesis.slot === 'intent');
  return boundedTurnContext({
    'context.version': '1',
    'context.source': 'validated_person_intelligence',
    'context.freshness': packet.freshness.state,
    'page.path': safePath(packet.currentPage.path),
    'page.title': packet.currentPage.title,
    'journey.summary': packet.safeJourneySummary,
    'behavior.summary': packet.behaviorSummary,
    'behavior.referrer_origin': origin(packet.referrer),
    'profile.persona': packet.persona,
    'profile.expertise': packet.expertise === 'unknown' ? null : packet.expertise,
    'profile.interests': packet.interests.slice(0, 3).join(', '),
    'focus.current': packet.currentFocus,
    'intent.hypothesis': intent?.value ?? packet.discoveryHints.intent,
    'intent.confidence': intent?.confidence ?? packet.confidence.level,
    'discovery.stack_platform': packet.discoveryHints.stack_platform,
    'discovery.industry_domain': packet.discoveryHints.industry_domain,
  });
}
