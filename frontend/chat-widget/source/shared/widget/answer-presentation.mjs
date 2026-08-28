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
  [ANSWER_CONTRIBUTOR_KIND.OPAQUE_ACTION]: new Set(["compareAction"]),
  [ANSWER_CONTRIBUTOR_KIND.PROGRESS]: new Set(["progress"]),
  [ANSWER_CONTRIBUTOR_KIND.LIFECYCLE]: new Set(),
});
const CONTRIBUTOR_LIFECYCLE_ALLOWLIST = new Set([
  ANSWER_CONTRIBUTOR_KIND.PROGRESS,
  ANSWER_CONTRIBUTOR_KIND.ERROR_RETRY,
  ANSWER_CONTRIBUTOR_KIND.LIFECYCLE,
]);

const HEADING_RE = /^\s{0,3}#{1,6}\s+/;
const BULLET_RE = /^\s*[-*+]\s+/;
const ORDERED_RE = /^\s*\d+[.)]\s+/;
const CODE_FENCE_RE = /^\s*(```|~~~)/;
const TABLE_RE = /^\s*\|.+\|\s*$/;
const HR_RE = /^\s{0,3}(-{3,}|\*{3,}|_{3,})\s*$/;
const DISCOVERY_MARKER_RE = /<\s*(?:pivot|discovery|followup)\s*>([\s\S]*?)<\s*\/\s*(?:pivot|discovery|followup)\s*>/i;
const TRAILING_QUESTION_RE = /(?:^|\n)([^.!?\n][^\n]{24,240}\?)\s*$/;
const ANALOGY_RE =
  /^it['’]s\s+like\b/i;
const ANALOGY_PHRASE_RE =
  /\b(?:is|are|feels?|works?|looks?)\b(?:\s+\S+){0,3}\s+like\b/i;
const ANALOGY_IMPERATIVE_RE = /\b(?:think of|imagine|picture)\b/i;
const ANALOGY_COLON_RE = /:\s*[^.?!]+(?:is|are)\s+like\b/i;
const SHORT_ANSWER_RE =
  /^(?:(?:the\s+)?short\s+(?:version|answer))(?:\s*:|\s+is\b)/i;
const SOFT_LEAD_IN_RE =
  /^(?:i\s+can|i(?:'|’)ll|i\s+will|i\s+would|since\s+we|before\s+we|let(?:'|’)s|we\s+can|happy\s+to)\b/i;
const POST_STREAM_LIFECYCLES = new Set([
  ANSWER_LIFECYCLE.JUDGING,
  ANSWER_LIFECYCLE.COMPLETE,
  ANSWER_LIFECYCLE.FAILED,
]);
function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}

function plainText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function nonEmptyParagraphs(text) {
  return plainText(text).split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
}

function isProseBlock(text) {
  const value = plainText(text);
  return Boolean(value) &&
    !CODE_FENCE_RE.test(value) &&
    !HEADING_RE.test(value) &&
    !BULLET_RE.test(value) &&
    !ORDERED_RE.test(value) &&
    !TABLE_RE.test(value) &&
    !HR_RE.test(value);
}

function looksLikeAnalogyBlock(text) {
  const value = plainText(text);
  return ANALOGY_RE.test(value) ||
    ANALOGY_PHRASE_RE.test(value) ||
    ANALOGY_IMPERATIVE_RE.test(value) ||
    ANALOGY_COLON_RE.test(value);
}

function isShortAnswerBlock(text) {
  return isProseBlock(text) && SHORT_ANSWER_RE.test(plainText(text));
}

function isSoftLeadInBlock(text) {
  const value = plainText(text);
  return isProseBlock(value) && value.length <= 320 && SOFT_LEAD_IN_RE.test(value);
}

function cleanDetails(text) {
  return plainText(text).replace(/^\s{0,3}#{1,6}\s*details\s*\n+/i, "").trim();
}

function withoutTrailingQuestion(text, question) {
  if (!question) return text;
  const escaped = question.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.replace(new RegExp(`\\s*${escaped}\\s*$`), "").trim();
}

function stripDiscoveryMarker(text) {
  const match = plainText(text).match(DISCOVERY_MARKER_RE);
  if (!match) return { text: plainText(text), followUp: null };
  return {
    text: plainText(text).replace(match[0], "").trim(),
    followUp: match[1].trim() || null,
  };
}

function extractFollowUp(answerText) {
  const marked = stripDiscoveryMarker(answerText);
  if (marked.followUp) return marked;
  const match = marked.text.match(TRAILING_QUESTION_RE);
  const followUp = match?.[1]?.trim() || null;
  return { text: withoutTrailingQuestion(marked.text, followUp), followUp };
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

export function splitAnswerContent(answerText) {
  const extracted = extractFollowUp(answerText);
  const paragraphs = nonEmptyParagraphs(extracted.text);
  if (paragraphs.length < 2) {
    return deepFreeze({
      tldrAnalogy: null,
      tldrShort: null,
      details: extracted.text,
      followUp: extracted.followUp,
    });
  }

  const analogyIndex = paragraphs.findIndex(
    (part, index) => index < 3 && isProseBlock(part) && looksLikeAnalogyBlock(part)
  );
  let tldrStart = 0;
  let tldrSize = 0;

  if (
    analogyIndex >= 0 &&
    (analogyIndex === 0 || paragraphs.slice(0, analogyIndex).every(isSoftLeadInBlock))
  ) {
    tldrStart = analogyIndex;
    tldrSize = 1;
    if (isShortAnswerBlock(paragraphs[analogyIndex + 1] || "")) {
      tldrSize = 2;
    } else if (
      analogyIndex === 0 &&
      paragraphs[1] &&
      isProseBlock(paragraphs[1])
    ) {
      tldrSize = 2;
    }
  } else {
    if (!isProseBlock(paragraphs[0])) {
      return deepFreeze({
        tldrAnalogy: null,
        tldrShort: null,
        details: extracted.text,
        followUp: extracted.followUp,
      });
    }
    if (isShortAnswerBlock(paragraphs[1] || "")) tldrSize = 2;
  }

  if (tldrSize < 1) {
    return deepFreeze({
      tldrAnalogy: null,
      tldrShort: null,
      details: extracted.text,
      followUp: extracted.followUp,
    });
  }

  const tldrBlocks = paragraphs.slice(tldrStart, tldrStart + tldrSize);
  const leadIns = paragraphs.slice(0, tldrStart).filter((part) => !isSoftLeadInBlock(part));
  const remaining = paragraphs.slice(tldrStart + tldrSize);

  return deepFreeze({
    tldrAnalogy: tldrBlocks[0] || null,
    tldrShort: tldrBlocks.slice(1).join("\n\n").trim() || null,
    details: cleanDetails([...leadIns, ...remaining].join("\n\n")),
    followUp: extracted.followUp,
  });
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
    nextSlots[key] = mergeSlot(record.slots[key], { ...slot, key });
  }

  const allowedEvidence = evidenceAllowedForContribution(kind, contribution.evidence, record);
  const nextEvidence = allowedEvidence
    ? mergeEvidenceRecords(record.evidence, allowedEvidence, record.identityKey)
    : record.evidence;

  return createAnswerRecord({
    identity: record.identity,
    lifecycle: lifecycleAllowedForContribution(kind) && contribution.lifecycle
      ? contribution.lifecycle
      : record.lifecycle,
    evidence: nextEvidence,
    slots: nextSlots,
  });
}

export function createPresentationFromAnswerText({
  identity,
  text,
  sources = [],
  confidence = null,
  telemetry = null,
  compareAction = null,
  progress = null,
  lifecycle = ANSWER_LIFECYCLE.STREAMING,
} = {}) {
  const content = splitAnswerContent(text || "");
  const slots = {
    tldrAnalogy: content.tldrAnalogy
      ? { status: ANSWER_SLOT_STATUS.READY, value: content.tldrAnalogy }
      : { status: ANSWER_SLOT_STATUS.EMPTY, value: null, message: "No analogy canvas provided." },
    tldrShort: content.tldrShort
      ? { status: ANSWER_SLOT_STATUS.READY, value: content.tldrShort }
      : { status: ANSWER_SLOT_STATUS.EMPTY, value: null, message: "No short answer provided." },
    details: content.details
      ? { status: ANSWER_SLOT_STATUS.READY, value: content.details }
      : { status: ANSWER_SLOT_STATUS.EMPTY, value: null, message: "No detail body provided." },
    sources: sources.length
      ? { status: ANSWER_SLOT_STATUS.READY, value: sources }
      : { status: ANSWER_SLOT_STATUS.UNAVAILABLE, value: [], message: "Sources unavailable." },
    followUp: content.followUp
      ? { status: ANSWER_SLOT_STATUS.READY, value: content.followUp }
      : { status: ANSWER_SLOT_STATUS.EMPTY, value: null, message: "No discovery follow-up provided." },
    confidence: confidence
      ? { status: ANSWER_SLOT_STATUS.READY, value: confidence }
      : { status: ANSWER_SLOT_STATUS.UNAVAILABLE, value: null, message: "Confidence unavailable." },
    telemetry: telemetry
      ? { status: ANSWER_SLOT_STATUS.READY, value: telemetry }
      : { status: ANSWER_SLOT_STATUS.UNAVAILABLE, value: null, message: "Telemetry unavailable." },
    compareAction: compareAction
      ? { status: ANSWER_SLOT_STATUS.READY, value: compareAction }
      : { status: ANSWER_SLOT_STATUS.UNAVAILABLE, value: null, message: "Compare unavailable." },
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
      sources: slots.sources,
      telemetry: postStream
        ? slots.telemetry
        : deferredSlot(slots.telemetry, "Telemetry waits for answer completion."),
      compareAction: postStream
        ? slots.compareAction
        : deferredSlot(slots.compareAction, "Compare waits for answer completion."),
      confidence: postStream
        ? slots.confidence
        : deferredSlot(slots.confidence, "Confidence waits for answer completion."),
      followUp: postStream
        ? slots.followUp
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
      compareAction: footer.slots.compareAction,
      order: footer.order,
      postStream: footer.postStream,
    },
    progress: slots.progress,
    errorRetry: slots.errorRetry,
  });
}
