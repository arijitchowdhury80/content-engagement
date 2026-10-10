import {
  ANSWER_CONTRACT_VERSION,
  ANSWER_LIFECYCLE,
  ANSWER_SLOT_KEYS,
  ANSWER_SLOT_STATUS,
  assertAnswerRecord,
  createAnswerEvidenceRecord,
  createAnswerRecord,
  createAnswerSlot,
  isClosedAnswerRecord,
  sameAnswerIdentity,
} from "../core/answer-record.mjs";
import { ANSWER_FOOTER_SLOT_ORDER } from "../presentation-contract.mjs";

export const ANSWER_CONTRIBUTOR_KIND = Object.freeze({
  CONTENT: "content",
  SOURCES: "sources",
  TELEMETRY: "telemetry",
  CONFIDENCE: "confidence",
  OPAQUE_ACTION: "opaqueAction",
  PROGRESS: "progress",
  ERROR_RETRY: "errorRetry",
  LIFECYCLE: "lifecycle",
});

const CONTRIBUTOR_KINDS = new Set(Object.values(ANSWER_CONTRIBUTOR_KIND));
const CONTRIBUTOR_SLOT_ALLOWLIST = Object.freeze({
  [ANSWER_CONTRIBUTOR_KIND.CONTENT]: new Set(["tldrAnalogy", "tldrShort", "details", "followUp"]),
  [ANSWER_CONTRIBUTOR_KIND.SOURCES]: new Set(["sources"]),
  [ANSWER_CONTRIBUTOR_KIND.TELEMETRY]: new Set(["telemetry"]),
  [ANSWER_CONTRIBUTOR_KIND.CONFIDENCE]: new Set(["confidence"]),
  [ANSWER_CONTRIBUTOR_KIND.OPAQUE_ACTION]: new Set(["actions"]),
  [ANSWER_CONTRIBUTOR_KIND.PROGRESS]: new Set(["progress"]),
  [ANSWER_CONTRIBUTOR_KIND.LIFECYCLE]: new Set(),
});
const CONTRIBUTOR_LIFECYCLE_ALLOWLIST = new Set([
  ANSWER_CONTRIBUTOR_KIND.PROGRESS,
  ANSWER_CONTRIBUTOR_KIND.ERROR_RETRY,
  ANSWER_CONTRIBUTOR_KIND.LIFECYCLE,
]);
const TERMINAL_ATTEMPT_LIFECYCLES = new Set([
  ANSWER_LIFECYCLE.COMPLETE,
  ANSWER_LIFECYCLE.FAILED,
]);
const CLOSED_ATTEMPT_LIFECYCLES = new Set([
  ANSWER_LIFECYCLE.SUPERSEDED,
  ANSWER_LIFECYCLE.RESET,
  ANSWER_LIFECYCLE.DISCONNECTED,
]);
const ALLOWED_LIFECYCLE_TRANSITIONS = Object.freeze({
  [ANSWER_LIFECYCLE.SEARCHING]: new Set([
    ANSWER_LIFECYCLE.READING,
    ANSWER_LIFECYCLE.SYNTHESIZING,
    ANSWER_LIFECYCLE.STREAMING,
    ANSWER_LIFECYCLE.JUDGING,
    ANSWER_LIFECYCLE.COMPLETE,
    ANSWER_LIFECYCLE.FAILED,
    ANSWER_LIFECYCLE.RETRYING,
  ]),
  [ANSWER_LIFECYCLE.READING]: new Set([
    ANSWER_LIFECYCLE.SYNTHESIZING,
    ANSWER_LIFECYCLE.STREAMING,
    ANSWER_LIFECYCLE.JUDGING,
    ANSWER_LIFECYCLE.COMPLETE,
    ANSWER_LIFECYCLE.FAILED,
    ANSWER_LIFECYCLE.RETRYING,
  ]),
  [ANSWER_LIFECYCLE.SYNTHESIZING]: new Set([
    ANSWER_LIFECYCLE.STREAMING,
    ANSWER_LIFECYCLE.JUDGING,
    ANSWER_LIFECYCLE.COMPLETE,
    ANSWER_LIFECYCLE.FAILED,
    ANSWER_LIFECYCLE.RETRYING,
  ]),
  [ANSWER_LIFECYCLE.STREAMING]: new Set([
    ANSWER_LIFECYCLE.JUDGING,
    ANSWER_LIFECYCLE.COMPLETE,
    ANSWER_LIFECYCLE.FAILED,
    ANSWER_LIFECYCLE.RETRYING,
  ]),
  [ANSWER_LIFECYCLE.JUDGING]: new Set([
    ANSWER_LIFECYCLE.COMPLETE,
    ANSWER_LIFECYCLE.FAILED,
  ]),
  [ANSWER_LIFECYCLE.RETRYING]: new Set([
    ANSWER_LIFECYCLE.FAILED,
  ]),
});

const POST_STREAM_LIFECYCLES = new Set([
  ANSWER_LIFECYCLE.JUDGING,
  ANSWER_LIFECYCLE.COMPLETE,
  ANSWER_LIFECYCLE.FAILED,
]);
const TERMINAL_UNAVAILABLE_LIFECYCLES = new Set([
  ANSWER_LIFECYCLE.COMPLETE,
  ANSWER_LIFECYCLE.FAILED,
]);
const TERMINAL_UNAVAILABLE_MESSAGES = Object.freeze({
  sources: "Sources unavailable.",
  telemetry: "Telemetry unavailable.",
  actions: "Action unavailable.",
  confidence: "Confidence unavailable.",
  followUp: "Discovery follow-up unavailable.",
});
function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}

function progressPercent(slot) {
  const value = slot?.value;
  const percent = typeof value?.percent === "number" ? value.percent : null;
  return Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : null;
}

function mergeSlot(existing, incoming) {
  const next = createAnswerSlot(incoming.key || existing.key, incoming);
  if (existing.key !== "progress") return next;
  const currentPercent = progressPercent(existing);
  const nextPercent = progressPercent(next);
  if (currentPercent === null || nextPercent === null || nextPercent >= currentPercent) return next;
  return createAnswerSlot("progress", {
    ...next,
    value: { ...next.value, percent: currentPercent },
  });
}

function hasAnsweredContent(record) {
  return ["tldrAnalogy", "tldrShort", "details"].some((key) =>
    record.slots[key]?.status === ANSWER_SLOT_STATUS.READY &&
      typeof record.slots[key]?.value === "string" &&
      record.slots[key].value.trim()
  );
}

function shouldIgnoreAttemptTerminalSlotUpdate(record, key, kind, slot) {
  if (!TERMINAL_ATTEMPT_LIFECYCLES.has(record.lifecycle)) return false;
  if (key === "progress") {
    if (record.lifecycle === ANSWER_LIFECYCLE.FAILED) return true;
    if (hasAnsweredContent(record)) return true;
    return slot?.value?.phase !== "error";
  }
  return kind === ANSWER_CONTRIBUTOR_KIND.ERROR_RETRY && hasAnsweredContent(record);
}

function lifecycleFromContribution(record, contribution, kind) {
  if (!lifecycleAllowedForContribution(kind) || !contribution.lifecycle) return record.lifecycle;
  if (
    kind === ANSWER_CONTRIBUTOR_KIND.ERROR_RETRY &&
    TERMINAL_ATTEMPT_LIFECYCLES.has(record.lifecycle) &&
    !hasAnsweredContent(record) &&
    contribution.lifecycle === ANSWER_LIFECYCLE.FAILED
  ) {
    return ANSWER_LIFECYCLE.FAILED;
  }
  return mergeLifecycle(record.lifecycle, contribution.lifecycle);
}

function evidencePassages(evidence) {
  if (!evidence || typeof evidence !== "object") return [];
  if (Array.isArray(evidence.passages)) return evidence.passages;
  const passages = [];
  if (Array.isArray(evidence.sources)) {
    for (const source of evidence.sources) passages.push({ kind: "source", value: source });
  }
  if (Array.isArray(evidence.judgeEvidence)) {
    for (const item of evidence.judgeEvidence) passages.push({ kind: "judge", value: item });
  }
  return passages;
}

function evidenceEvaluations(evidence) {
  if (!evidence || typeof evidence !== "object") return [];
  if (Array.isArray(evidence.evaluations)) return evidence.evaluations;
  if (Array.isArray(evidence.judgeEvidence)) return evidence.judgeEvidence;
  return [];
}

function existingEvidencePassageIds(record) {
  return new Set((record?.evidence?.passages || [])
    .map((passage) => typeof passage?.id === "string" ? passage.id.trim() : "")
    .filter(Boolean));
}

function mergeById(left = [], right = []) {
  const merged = new Map();
  for (const item of [...left, ...right]) {
    if (!item || typeof item !== "object") continue;
    const id = typeof item.id === "string" && item.id.trim() ? item.id.trim() : JSON.stringify(item);
    if (!merged.has(id)) merged.set(id, item);
  }
  return [...merged.values()];
}

function mergeEvidenceRecords(left, right, fallbackId) {
  const current = createAnswerEvidenceRecord(left || { id: fallbackId });
  const incoming = createAnswerEvidenceRecord(right || {});
  return {
    id: current.id || incoming.id || fallbackId,
    passages: mergeById(current.passages, incoming.passages),
    evaluations: mergeById(current.evaluations, incoming.evaluations),
  };
}

function slotAllowedForContribution(kind, key, slot) {
  if (kind === ANSWER_CONTRIBUTOR_KIND.ERROR_RETRY) {
    return key === "errorRetry" ||
      slot?.status === ANSWER_SLOT_STATUS.FAILED ||
      slot?.status === ANSWER_SLOT_STATUS.RETRYING;
  }
  return Boolean(CONTRIBUTOR_SLOT_ALLOWLIST[kind]?.has(key));
}

function confidenceEvidenceAllowedForRecord(evidence, record) {
  const knownPassageIds = existingEvidencePassageIds(record);
  const normalized = createAnswerEvidenceRecord({
    evaluations: evidenceEvaluations(evidence),
  });
  return {
    passages: [],
    evaluations: normalized.evaluations.filter((evaluation) =>
      Array.isArray(evaluation.passageIds) &&
      evaluation.passageIds.length > 0 &&
      evaluation.passageIds.every((id) => knownPassageIds.has(id))
    ),
  };
}

function evidenceAllowedForContribution(kind, evidence, record) {
  if (!evidence || typeof evidence !== "object") return null;
  if (kind === ANSWER_CONTRIBUTOR_KIND.SOURCES) {
    return {
      passages: evidencePassages(evidence).filter((passage) => passage?.kind === "source"),
      evaluations: [],
    };
  }
  if (kind === ANSWER_CONTRIBUTOR_KIND.CONFIDENCE) {
    return confidenceEvidenceAllowedForRecord(evidence, record);
  }
  return null;
}

function lifecycleAllowedForContribution(kind) {
  return CONTRIBUTOR_LIFECYCLE_ALLOWLIST.has(kind);
}

function mergeLifecycle(current, incoming) {
  if (!incoming) return current;
  if (current === incoming) return current;
  if (TERMINAL_ATTEMPT_LIFECYCLES.has(current) || CLOSED_ATTEMPT_LIFECYCLES.has(current)) return current;
  return ALLOWED_LIFECYCLE_TRANSITIONS[current]?.has(incoming) ? incoming : current;
}

export function createAnswerContributor({
  kind = ANSWER_CONTRIBUTOR_KIND.LIFECYCLE,
  identity,
  slots = {},
  lifecycle = null,
  evidence = null,
} = {}) {
  if (!CONTRIBUTOR_KINDS.has(kind)) throw new TypeError(`Unknown answer contributor kind: ${kind}`);
  return deepFreeze({
    contractVersion: ANSWER_CONTRACT_VERSION,
    kind,
    identity,
    lifecycle,
    slots,
    evidence,
  });
}

export function applyAnswerContribution(record, contribution) {
  assertAnswerRecord(record);
  if (!contribution || contribution.contractVersion !== ANSWER_CONTRACT_VERSION) {
    return record;
  }
  if (!sameAnswerIdentity(record.identity, contribution.identity)) return record;
  if (isClosedAnswerRecord(record)) return record;

  const nextSlots = { ...record.slots };
  const kind = CONTRIBUTOR_KINDS.has(contribution.kind)
    ? contribution.kind
    : ANSWER_CONTRIBUTOR_KIND.LIFECYCLE;
  for (const [key, slot] of Object.entries(contribution.slots || {})) {
    if (!ANSWER_SLOT_KEYS.includes(key)) continue;
    if (!slotAllowedForContribution(kind, key, slot)) continue;
    if (shouldIgnoreAttemptTerminalSlotUpdate(record, key, kind, slot)) continue;
    nextSlots[key] = mergeSlot(record.slots[key], { ...slot, key });
  }

  const allowedEvidence = evidenceAllowedForContribution(kind, contribution.evidence, record);
  const nextEvidence = allowedEvidence
    ? mergeEvidenceRecords(record.evidence, allowedEvidence, record.identityKey)
    : record.evidence;

  return createAnswerRecord({
    identity: record.identity,
    lifecycle: lifecycleFromContribution(record, contribution, kind),
    evidence: nextEvidence,
    slots: nextSlots,
  });
}

export function createPresentationFromAnswerText({
  identity,
  text,
  content = null,
  sources = [],
  confidence = null,
  telemetry = null,
  actions = null,
  progress = null,
  lifecycle = ANSWER_LIFECYCLE.STREAMING,
} = {}) {
  const normalizedContent = content && typeof content === "object"
    ? content
    : { tldrAnalogy: null, tldrShort: null, details: text || "", followUp: null };
  const slots = {
    tldrAnalogy: normalizedContent.tldrAnalogy
      ? { status: ANSWER_SLOT_STATUS.READY, value: normalizedContent.tldrAnalogy }
      : { status: ANSWER_SLOT_STATUS.EMPTY, value: null, message: "No analogy canvas provided." },
    tldrShort: normalizedContent.tldrShort
      ? { status: ANSWER_SLOT_STATUS.READY, value: normalizedContent.tldrShort }
      : { status: ANSWER_SLOT_STATUS.EMPTY, value: null, message: "No short answer provided." },
    details: normalizedContent.details
      ? { status: ANSWER_SLOT_STATUS.READY, value: normalizedContent.details }
      : { status: ANSWER_SLOT_STATUS.EMPTY, value: null, message: "No detail body provided." },
    sources: sources.length
      ? { status: ANSWER_SLOT_STATUS.READY, value: sources }
      : { status: ANSWER_SLOT_STATUS.UNAVAILABLE, value: [], message: "Sources unavailable." },
    followUp: normalizedContent.followUp
      ? { status: ANSWER_SLOT_STATUS.READY, value: normalizedContent.followUp }
      : { status: ANSWER_SLOT_STATUS.EMPTY, value: null, message: "No discovery follow-up provided." },
    confidence: confidence
      ? { status: ANSWER_SLOT_STATUS.READY, value: confidence }
      : { status: ANSWER_SLOT_STATUS.UNAVAILABLE, value: null, message: "Confidence unavailable." },
    telemetry: telemetry
      ? { status: ANSWER_SLOT_STATUS.READY, value: telemetry }
      : { status: ANSWER_SLOT_STATUS.UNAVAILABLE, value: null, message: "Telemetry unavailable." },
    actions: actions
      ? { status: ANSWER_SLOT_STATUS.READY, value: actions }
      : { status: ANSWER_SLOT_STATUS.UNAVAILABLE, value: null, message: "Action unavailable." },
    progress: progress
      ? { status: ANSWER_SLOT_STATUS.READY, value: progress }
      : { status: ANSWER_SLOT_STATUS.LOADING, value: { percent: 0 } },
    errorRetry: { status: ANSWER_SLOT_STATUS.EMPTY, value: null },
  };

  return createAnswerRecord({
    identity,
    lifecycle,
    evidence: {
      id: identity && Object.values(identity).join(":"),
      passages: sources.map((source) => ({ kind: "source", value: source })),
      evaluations: [],
    },
    slots,
  });
}

export function createFailedAnswerPresentation({
  identity,
  failedSlot = "details",
  message = "This step failed.",
  retrying = false,
} = {}) {
  const record = createAnswerRecord({
    identity,
    lifecycle: retrying ? ANSWER_LIFECYCLE.RETRYING : ANSWER_LIFECYCLE.FAILED,
    slots: {
      [failedSlot]: {
        status: retrying ? ANSWER_SLOT_STATUS.RETRYING : ANSWER_SLOT_STATUS.FAILED,
        value: null,
        message: retrying ? "Retrying this step..." : message,
        error: retrying ? null : message,
      },
      errorRetry: {
        status: retrying ? ANSWER_SLOT_STATUS.RETRYING : ANSWER_SLOT_STATUS.FAILED,
        value: { failedSlot },
        message: retrying ? "Retrying this step..." : message,
        error: retrying ? null : message,
      },
    },
  });
  return record;
}

function deferredSlot(slot, message) {
  if (!slot || slot.status !== ANSWER_SLOT_STATUS.READY) return slot;
  return createAnswerSlot(slot.key, {
    status: ANSWER_SLOT_STATUS.LOADING,
    value: null,
    message,
  });
}

function terminalSlot(slot, lifecycle) {
  if (!slot || slot.status !== ANSWER_SLOT_STATUS.LOADING ||
      !TERMINAL_UNAVAILABLE_LIFECYCLES.has(lifecycle)) {
    return slot;
  }
  return createAnswerSlot(slot.key, {
    status: ANSWER_SLOT_STATUS.UNAVAILABLE,
    value: null,
    message: TERMINAL_UNAVAILABLE_MESSAGES[slot.key] || "Unavailable.",
  });
}

export function createPostAnswerFooterState(record) {
  assertAnswerRecord(record);
  const postStream = POST_STREAM_LIFECYCLES.has(record.lifecycle);
  const slots = record.slots;
  return deepFreeze({
    identity: record.identity,
    identityKey: record.identityKey,
    lifecycle: record.lifecycle,
    postStream,
    order: ANSWER_FOOTER_SLOT_ORDER,
    slots: {
      sources: terminalSlot(slots.sources, record.lifecycle),
      telemetry: postStream
        ? terminalSlot(slots.telemetry, record.lifecycle)
        : deferredSlot(slots.telemetry, "Telemetry waits for answer completion."),
      actions: postStream
        ? terminalSlot(slots.actions, record.lifecycle)
        : deferredSlot(slots.actions, "Actions wait for answer completion."),
      confidence: postStream
        ? terminalSlot(slots.confidence, record.lifecycle)
        : deferredSlot(slots.confidence, "Confidence waits for answer completion."),
      followUp: postStream
        ? terminalSlot(slots.followUp, record.lifecycle)
        : deferredSlot(slots.followUp, "Discovery follow-up waits for answer completion."),
    },
  });
}

export function toAnswerPresentation(record) {
  assertAnswerRecord(record);
  const slots = record.slots;
  const footer = createPostAnswerFooterState(record);
  return deepFreeze({
    contractVersion: record.contractVersion,
    identity: record.identity,
    identityKey: record.identityKey,
    lifecycle: record.lifecycle,
    tldr: {
      analogy: slots.tldrAnalogy,
      short: slots.tldrShort,
    },
    details: slots.details,
    footer: {
      sources: footer.slots.sources,
      followUp: footer.slots.followUp,
      confidence: footer.slots.confidence,
      telemetry: footer.slots.telemetry,
      actions: footer.slots.actions,
      order: footer.order,
      postStream: footer.postStream,
    },
    progress: slots.progress,
    errorRetry: slots.errorRetry,
  });
}
