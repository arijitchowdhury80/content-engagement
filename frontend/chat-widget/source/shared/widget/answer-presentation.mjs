import {
  ANSWER_CONTRACT_VERSION,
  ANSWER_LIFECYCLE,
  ANSWER_SLOT_KEYS,
  ANSWER_SLOT_STATUS,
  assertAnswerRecord,
  createAnswerRecord,
  createAnswerSlot,
  isClosedAnswerRecord,
  sameAnswerIdentity,
} from "../core/answer-record.mjs";

const TEXT_STARTS_WITH_STRUCTURAL_MARKDOWN_RE =
  /^\s*(#{1,6}\s+|[-*+]\s+|\d+[.)]\s+|```|~~~|\|.+\|)/;
const DISCOVERY_MARKER_RE = /<\s*(?:pivot|discovery|followup)\s*>([\s\S]*?)<\s*\/\s*(?:pivot|discovery|followup)\s*>/i;
const TRAILING_QUESTION_RE = /(?:^|\n)([^.!?\n][^\n]{24,240}\?)\s*$/;

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

export function splitAnswerContent(answerText) {
  const extracted = extractFollowUp(answerText);
  const paragraphs = nonEmptyParagraphs(extracted.text);
  const first = paragraphs[0] || "";
  const second = paragraphs[1] || "";
  const canLayerTldr =
    paragraphs.length >= 2 &&
    !TEXT_STARTS_WITH_STRUCTURAL_MARKDOWN_RE.test(first) &&
    !TEXT_STARTS_WITH_STRUCTURAL_MARKDOWN_RE.test(second);

  if (!canLayerTldr) {
    return deepFreeze({
      tldrAnalogy: null,
      tldrShort: null,
      details: extracted.text,
      followUp: extracted.followUp,
    });
  }

  return deepFreeze({
    tldrAnalogy: first,
    tldrShort: second,
    details: paragraphs.slice(2).join("\n\n").trim(),
    followUp: extracted.followUp,
  });
}

export function createAnswerContributor({ identity, slots = {}, lifecycle = null, evidence = null } = {}) {
  return deepFreeze({
    contractVersion: ANSWER_CONTRACT_VERSION,
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
  for (const [key, slot] of Object.entries(contribution.slots || {})) {
    if (!ANSWER_SLOT_KEYS.includes(key)) continue;
    nextSlots[key] = mergeSlot(record.slots[key], { ...slot, key });
  }

  const nextEvidence = contribution.evidence
    ? {
        ...record.evidence,
        ...contribution.evidence,
        sources: Array.isArray(contribution.evidence.sources)
          ? contribution.evidence.sources
          : record.evidence.sources,
        judgeEvidence: Array.isArray(contribution.evidence.judgeEvidence)
          ? contribution.evidence.judgeEvidence
          : record.evidence.judgeEvidence,
      }
    : record.evidence;

  return createAnswerRecord({
    identity: record.identity,
    lifecycle: contribution.lifecycle || record.lifecycle,
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
    evidence: { id: identity && Object.values(identity).join(":"), sources },
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

export function toAnswerPresentation(record) {
  assertAnswerRecord(record);
  const slots = record.slots;
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
      sources: slots.sources,
      followUp: slots.followUp,
      confidence: slots.confidence,
      telemetry: slots.telemetry,
      compareAction: slots.compareAction,
    },
    progress: slots.progress,
    errorRetry: slots.errorRetry,
  });
}
