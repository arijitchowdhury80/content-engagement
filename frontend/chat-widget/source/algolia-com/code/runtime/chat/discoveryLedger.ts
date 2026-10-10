/**
 * discoveryLedger — the Discovery Context Ledger's data model and pure logic.
 *
 * No React in it, deliberately, matching turnRunner.ts's own design principle:
 * this module is called from turnRunner.ts (which owns the ledger's lifecycle
 * through TurnDeps) but has no dependency on it, so it's independently testable
 * and never needs a mocked completions call to verify its own correctness.
 *
 * Design docs: docs/discovery-engagement/{discovery-context-ledger.md,
 * phase5b-ledger-implementation-plan.md} in the AC2 repo (provenance/context
 * only — this file is the implementation, not a mirror of those docs).
 */

// ── Data model ──────────────────────────────────────────────────────────────

export const SLOT_NAMES = [
  'intent',
  'pain_point',
  'stack_platform',
  'catalog_size',
  'industry_domain',
  'integration_constraints',
  'business_outcome',
] as const;

export type SlotName = (typeof SLOT_NAMES)[number];

export type SlotStatus = 'unknown' | 'inferred' | 'confirmed';

export type SlotSource = 'get_visitor_profile' | 'page_context' | 'visitor_message' | null;

export interface SlotEntry {
  slot: SlotName;
  status: SlotStatus;
  value: string | null;
  source: SlotSource;
  turnSet: number | null;
  reopened: boolean;
}

export type SuppressionReason =
  | 'ignored'
  | 'declined'
  | 'consecutive_turn_cap'
  | 'frustration_override'
  | 'specialist_declined';

export interface SuppressionEntry {
  /** null = a specialist-offer-level suppression (S8), not tied to one slot. */
  slot: SlotName | null;
  turn: number;
  reason: SuppressionReason;
  /** Only set when reason is 'specialist_declined'. */
  specialistKey?: string;
}

export interface DiscoveryLedgerState {
  slots: Record<SlotName, SlotEntry>;
  lastProbeTurn: number | null;
  lastProbeSlot: SlotName | null;
  suppressionLog: SuppressionEntry[];
  turnCount: number;
}

/** A fresh ledger — every slot unknown, no history. One per conversation. */
export function createLedgerState(): DiscoveryLedgerState {
  const slots = {} as Record<SlotName, SlotEntry>;
  for (const slot of SLOT_NAMES) {
    slots[slot] = { slot, status: 'unknown', value: null, source: null, turnSet: null, reopened: false };
  }
  return { slots, lastProbeTurn: null, lastProbeSlot: null, suppressionLog: [], turnCount: 0 };
}

function isSlotName(value: unknown): value is SlotName {
  return typeof value === 'string' && (SLOT_NAMES as readonly string[]).includes(value);
}

// ── Marker contract ───────────────────────────────────────────────────────────

export interface DiscoveryMarkerSlotValue {
  slot: SlotName;
  value: string;
}

export interface DiscoveryMarker {
  probedSlot: SlotName | null;
  confirmedSlots: DiscoveryMarkerSlotValue[];
  inferredSlots: DiscoveryMarkerSlotValue[];
  suppressedSlots: SlotName[];
  handoffRecommended: boolean;
  handoffSpecialistKey: string | null;
  confidence: 'high' | 'medium' | 'low';
  visibleFollowupQuestion: string | null;
}

const MARKER_OPEN = '<!--DISCOVERY_STATE';
const MARKER_CLOSE = 'DISCOVERY_STATE-->';

/**
 * Locate every occurrence of the marker delimiter pair in text, regardless of
 * validity — used both to strip and to detect the "multiple markers" reject
 * case (§ marker safety acceptance criteria: multiple markers reject the whole
 * update, they are never merged or the first/last one silently preferred).
 */
function findMarkerSpans(text: string): Array<{ start: number; end: number; body: string }> {
  const spans: Array<{ start: number; end: number; body: string }> = [];
  let searchFrom = 0;
  for (;;) {
    const openIdx = text.indexOf(MARKER_OPEN, searchFrom);
    if (openIdx === -1) break;
    const closeIdx = text.indexOf(MARKER_CLOSE, openIdx);
    if (closeIdx === -1) break;
    const end = closeIdx + MARKER_CLOSE.length;
    spans.push({ start: openIdx, end, body: text.slice(openIdx + MARKER_OPEN.length, closeIdx) });
    searchFrom = end;
  }
  return spans;
}

/**
 * True when `index` falls inside an odd-numbered code fence run — i.e. inside
 * an open ``` block. A marker-shaped span that starts inside a fenced code
 * example in the model's own answer must never be treated as a real marker
 * (the model might legitimately show `<!--DISCOVERY_STATE...` as a *documented
 * example* of the mechanism itself, however unlikely — safety, not likelihood,
 * is what this guards).
 */
function isInsideCodeFence(text: string, index: number): boolean {
  const before = text.slice(0, index);
  const fenceCount = (before.match(/```/g) ?? []).length;
  return fenceCount % 2 === 1;
}

/**
 * Strip every marker span from `fullText` unconditionally — even an invalid or
 * multiply-occurring marker must never leak raw `<!--DISCOVERY_STATE...` JSON
 * into visible text. Stripping and validity are independent: text is always
 * cleaned; the ledger is only ever updated when exactly one valid marker was
 * found outside a code fence.
 */
export function parseDiscoveryMarker(fullText: string): {
  visibleText: string;
  marker: DiscoveryMarker | null;
} {
  const allSpans = findMarkerSpans(fullText);
  const realSpans = allSpans.filter((s) => !isInsideCodeFence(fullText, s.start));

  // Strip every real (non-code-fenced) span from the visible text, regardless
  // of validity or count — never let a mangled or duplicate block leak.
  let visibleText = fullText;
  for (let i = realSpans.length - 1; i >= 0; i--) {
    const s = realSpans[i];
    visibleText = visibleText.slice(0, s.start) + visibleText.slice(s.end);
  }
  visibleText = visibleText.trimEnd();

  if (realSpans.length !== 1) {
    // Zero real spans: nothing to apply, not an error. More than one: reject
    // the whole update — ambiguous intent, same "no partial application"
    // principle as single-marker field validation.
    return { visibleText, marker: null };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(realSpans[0].body);
  } catch {
    return { visibleText, marker: null };
  }

  return { visibleText, marker: validateDiscoveryMarker(raw) };
}

/**
 * Validate a parsed marker payload against the real SlotName union and field
 * shapes. Any single field failing invalidates the whole marker — a
 * half-valid marker is more dangerous than a fully rejected one, since a
 * partially-applied ledger update is a state nothing else in this design
 * accounts for.
 */
export function validateDiscoveryMarker(raw: unknown): DiscoveryMarker | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;

  const probedSlot = r.probed_slot;
  if (probedSlot !== null && !isSlotName(probedSlot)) return null;

  const confirmedSlots = parseSlotValueArray(r.confirmed_slots);
  if (confirmedSlots === null) return null;

  const inferredSlots = parseSlotValueArray(r.inferred_slots);
  if (inferredSlots === null) return null;

  const suppressedSlotsRaw = r.suppressed_slots;
  if (!Array.isArray(suppressedSlotsRaw) || !suppressedSlotsRaw.every(isSlotName)) return null;

  const handoffRecommended = r.handoff_recommended;
  if (typeof handoffRecommended !== 'boolean') return null;

  const handoffSpecialistKey = r.handoff_specialist_key;
  if (handoffSpecialistKey !== null && typeof handoffSpecialistKey !== 'string') return null;
  if (handoffSpecialistKey !== null && !handoffRecommended) return null;

  const confidence = r.confidence;
  if (confidence !== 'high' && confidence !== 'medium' && confidence !== 'low') return null;

  const visibleFollowupQuestion = r.visible_followup_question;
  if (visibleFollowupQuestion !== null && typeof visibleFollowupQuestion !== 'string') return null;

  return {
    probedSlot: probedSlot as SlotName | null,
    confirmedSlots,
    inferredSlots,
    suppressedSlots: suppressedSlotsRaw,
    handoffRecommended,
    handoffSpecialistKey,
    confidence,
    visibleFollowupQuestion,
  };
}

function parseSlotValueArray(raw: unknown): DiscoveryMarkerSlotValue[] | null {
  if (!Array.isArray(raw)) return null;
  const out: DiscoveryMarkerSlotValue[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) return null;
    const o = item as Record<string, unknown>;
    if (!isSlotName(o.slot) || typeof o.value !== 'string') return null;
    out.push({ slot: o.slot, value: o.value });
  }
  return out;
}

// ── Ledger transitions ────────────────────────────────────────────────────────

/** Apply a validated marker's reported deltas to the ledger for this turn. */
export function applyMarker(
  ledger: DiscoveryLedgerState,
  marker: DiscoveryMarker,
  turn: number,
): DiscoveryLedgerState {
  const slots = { ...ledger.slots };

  for (const { slot, value } of marker.confirmedSlots) {
    slots[slot] = { slot, status: 'confirmed', value, source: 'visitor_message', turnSet: turn, reopened: false };
  }
  for (const { slot, value } of marker.inferredSlots) {
    // Never let an inference downgrade an already-confirmed slot.
    if (slots[slot].status === 'confirmed') continue;
    slots[slot] = { slot, status: 'inferred', value, source: slots[slot].source ?? null, turnSet: turn, reopened: false };
  }

  const suppressionLog = [...ledger.suppressionLog];
  for (const slot of marker.suppressedSlots) {
    suppressionLog.push({ slot, turn, reason: 'ignored' });
  }

  return {
    ...ledger,
    slots,
    suppressionLog,
    lastProbeTurn: marker.probedSlot ? turn : ledger.lastProbeTurn,
    lastProbeSlot: marker.probedSlot ?? ledger.lastProbeSlot,
  };
}

const DECLINE_PATTERNS = /^\s*(no|nah|not\s*sure|skip(\s*that)?|doesn'?t\s*matter|n\/a)\s*[.!]?\s*$/i;

/**
 * Rule-based backstop for decline/ignore detection — runs regardless of
 * whether the marker already reported a suppression, in case the model's own
 * self-report under-reports a decline. Belt-and-suspenders, not primary.
 */
export function applyRuleBasedDecline(
  ledger: DiscoveryLedgerState,
  visitorMessage: string,
  turn: number,
): DiscoveryLedgerState {
  if (!ledger.lastProbeSlot) return ledger;
  if (!DECLINE_PATTERNS.test(visitorMessage)) return ledger;

  const alreadyLogged = ledger.suppressionLog.some(
    (e) => e.slot === ledger.lastProbeSlot && e.turn === turn,
  );
  if (alreadyLogged) return ledger;

  return {
    ...ledger,
    suppressionLog: [...ledger.suppressionLog, { slot: ledger.lastProbeSlot, turn, reason: 'declined' }],
  };
}

/** Record that the visitor declined an ask_specialist offer for this turn. */
export function applySpecialistDecline(
  ledger: DiscoveryLedgerState,
  specialistKey: string,
  turn: number,
): DiscoveryLedgerState {
  return {
    ...ledger,
    suppressionLog: [...ledger.suppressionLog, { slot: null, turn, reason: 'specialist_declined', specialistKey }],
  };
}

/**
 * Fold get_visitor_profile's discoveryHints into the ledger. Only ever writes
 * `inferred` — behavioral/profile inference never self-promotes to confirmed,
 * only the marker's confirmedSlots (the visitor's own stated words) can do
 * that. Never overwrites a slot that's already inferred or confirmed from
 * another source: first plausible inference wins, the visitor's own words
 * always win over any of this.
 */
export function ingestProfileHints(
  ledger: DiscoveryLedgerState,
  discoveryHints: Partial<Record<SlotName, string>> | undefined,
  turn: number,
): DiscoveryLedgerState {
  if (!discoveryHints) return ledger;
  const slots = { ...ledger.slots };
  for (const slot of SLOT_NAMES) {
    const hint = discoveryHints[slot];
    if (!hint) continue;
    if (slots[slot].status !== 'unknown') continue;
    slots[slot] = { slot, status: 'inferred', value: hint, source: 'get_visitor_profile', turnSet: turn, reopened: false };
  }
  return { ...ledger, slots };
}

/** True when this turn is eligible to ask a discovery question at all — the
 *  consecutive-turn cap, independent of which slot might be targeted. */
export function isProbeEligible(ledger: DiscoveryLedgerState, turn: number): boolean {
  return ledger.lastProbeTurn !== turn - 1;
}

/** True when `slot` may still be asked about — not suppressed, not reopened-false. */
export function isSlotAskable(ledger: DiscoveryLedgerState, slot: SlotName): boolean {
  if (ledger.slots[slot].status !== 'unknown') return false;
  const suppressed = ledger.suppressionLog.some((e) => e.slot === slot);
  if (!suppressed) return true;
  return ledger.slots[slot].reopened;
}

/**
 * Remove a discovery question from visible text when the ledger says this
 * turn should not have asked one, even though the marker (or the model's own
 * prose) produced one anyway. Turn-level enforcement, not a render-time
 * concern — see phase5b-ledger-implementation-plan.md §10 for why.
 */
export function enforceSuppression(
  visibleText: string,
  marker: DiscoveryMarker | null,
  ledger: DiscoveryLedgerState,
  turn: number,
): string {
  const question = marker?.visibleFollowupQuestion;
  if (!question) return visibleText;

  const probeAllowed =
    isProbeEligible(ledger, turn) && (marker.probedSlot === null || isSlotAskable(ledger, marker.probedSlot));
  if (probeAllowed) return visibleText;

  return visibleText.includes(question) ? visibleText.replace(question, '').trimEnd() : visibleText;
}

// ── Prompt injection ──────────────────────────────────────────────────────────

/** Build the "[DISCOVERY STATE]" block injected into the Orchestrator's context each turn. */
export function buildPromptInjection(ledger: DiscoveryLedgerState, turn: number): string {
  const confirmed = SLOT_NAMES.filter((s) => ledger.slots[s].status === 'confirmed');
  const inferred = SLOT_NAMES.filter((s) => ledger.slots[s].status === 'inferred');
  const unknown = SLOT_NAMES.filter((s) => ledger.slots[s].status === 'unknown');

  const lines = [
    '[DISCOVERY CONTROL — internal, never quote this block back to the visitor]',
    'You are acting as an Algolia commercial discovery concierge, not only a reactive Q&A bot.',
    'Answer structure for commercial discovery: Direct answer; Architecture fit; Implementation effort; Effort drivers; Diagnostic fork.',
    'For ERP/PIM/CMS, migration, pricing, stack, implementation, or effort questions, be concrete: name the integration pattern, the moving parts, realistic effort ranges when supported, and the variables that change the estimate.',
    'Avoid vague hype and unsupported speed claims. If evidence is thin, say what the estimate depends on instead of bluffing.',
    'Answer the visitor first. If this turn is eligible for discovery, include exactly one visible follow-up question that uncovers the question behind the question.',
    'Do not hide the follow-up only in suggestions or the marker. The visitor must see it as natural conversational text.',
    'The follow-up must be a diagnostic fork with 2-3 plausible paths, not a generic documentation suggestion.',
    'Use confirmed and inferred facts to avoid re-asking. Prefer the most commercially useful unknown slot: intent, pain_point, stack_platform, integration_constraints, catalog_size, industry_domain, business_outcome.',
    'Do not ask a discovery question on consecutive turns, do not re-ask suppressed slots, and back off when the visitor declines or sounds frustrated.',
    'If a specialist would help, offer it warmly and include all known context in the ask_specialist question.',
    'Always append exactly one hidden marker at the very end. The marker is for software only; never mention it.',
    'Marker shape: <!--DISCOVERY_STATE {"probed_slot": SlotName|null, "confirmed_slots": [{"slot": SlotName, "value": string}], "inferred_slots": [{"slot": SlotName, "value": string}], "suppressed_slots": SlotName[], "handoff_recommended": boolean, "handoff_specialist_key": string|null, "confidence": "high"|"medium"|"low", "visible_followup_question": string|null} DISCOVERY_STATE-->',
    `Allowed SlotName values: ${SLOT_NAMES.join(', ')}`,
    '[DISCOVERY STATE]',
    `Turn: ${turn}`,
  ];

  if (confirmed.length) {
    lines.push(`Confirmed: ${confirmed.map((s) => `${s}="${ledger.slots[s].value}"`).join('; ')}`);
  }
  if (inferred.length) {
    lines.push(`Inferred: ${inferred.map((s) => `${s}="${ledger.slots[s].value}"`).join('; ')}`);
  }
  if (unknown.length) {
    lines.push(`Unknown: ${unknown.join(', ')}`);
  }

  const suppressed = ledger.suppressionLog.filter((e) => e.slot !== null);
  if (suppressed.length) {
    const parts = suppressed.map((e) => `${e.slot} (turn ${e.turn}, ${e.reason})`);
    lines.push(`Suppressed this session (do not re-ask unless the visitor reopens it): ${parts.join('; ')}`);
  }

  if (ledger.lastProbeTurn !== null) {
    lines.push(`Last probe: turn ${ledger.lastProbeTurn}, slot=${ledger.lastProbeSlot}`);
  }

  lines.push('[END DISCOVERY STATE]');
  lines.push('[END DISCOVERY CONTROL]');
  return lines.join('\n');
}

// ── Specialist handoff ─────────────────────────────────────────────────────────

export interface HandoffPacketInput {
  originalQuestion: string;
  currentQuestion: string;
  handoffReason: string;
}

/**
 * Build the internal handoff packet serialized into ask_specialist's
 * `question` argument. Only confirmed/inferred slots are listed — unknown
 * slots are omitted, not listed as "unknown" (no reason to hand the
 * specialist a list of what isn't known). This has nowhere else to go: the
 * real askSpecialistSchema (chat-central/src/tools/schemas.js) fixes
 * inputSchema to exactly specialist_key/question, both strings.
 */
export function buildHandoffPacket(ledger: DiscoveryLedgerState, input: HandoffPacketInput): string {
  const known = SLOT_NAMES.filter((s) => ledger.slots[s].status !== 'unknown').map(
    (s) => `${s}=${ledger.slots[s].status}("${ledger.slots[s].value}")`,
  );
  const unanswered = SLOT_NAMES.filter((s) => ledger.slots[s].status === 'unknown');

  const lines = ['[DISCOVERY CONTEXT — do not repeat this block back to the visitor]'];
  lines.push(`Original question: "${input.originalQuestion}"`);
  lines.push(`Current question: "${input.currentQuestion}"`);
  if (known.length) lines.push(`Known: ${known.join('; ')}`);
  if (unanswered.length) lines.push(`Unanswered: ${unanswered.join(', ')}`);
  lines.push(`Handoff reason: ${input.handoffReason}`);
  lines.push('[END CONTEXT]');
  lines.push('');
  lines.push(input.currentQuestion);

  return lines.join('\n');
}
