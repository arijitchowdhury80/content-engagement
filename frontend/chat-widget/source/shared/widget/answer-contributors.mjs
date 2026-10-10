import {
  ANSWER_LIFECYCLE,
  ANSWER_SLOT_STATUS,
  canonicalEvidencePassageId,
} from "../core/answer-record.mjs";
import {
  ANSWER_CONTRIBUTOR_KIND,
  createAnswerContributor,
} from "./answer-presentation.mjs";

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function hasObjectValue(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function clampPercent(percent) {
  const value = Number(percent);
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

function sourcePassage(source, index) {
  const origin = hasObjectValue(source) && typeof source.origin === "string" && source.origin.trim()
    ? source.origin.trim()
    : "retrieval";
  const id = canonicalEvidencePassageId({
    kind: "source",
    origin,
    sequence: index,
    value: source,
    id: hasObjectValue(source) ? source.evidencePassageId || source.passageId : null,
  });
  return { id, kind: "source", origin, sequence: index, value: source };
}

function visibleSource(source, passage) {
  return hasObjectValue(source)
    ? { ...source, evidencePassageId: passage.id }
    : { title: asText(source), evidencePassageId: passage.id };
}

function evidenceEvaluation(item, index) {
  const value = hasObjectValue(item) ? item : { value: item };
  const passageIds = asArray(value.passageIds || value.sourcePassageIds || value.referencedPassageIds || value.references)
    .map(asText)
    .filter(Boolean);
  return {
    ...value,
    kind: "judge",
    origin: "confidence",
    sequence: index,
    passageIds,
    value,
  };
}

export function createAnswerContentContribution({
  identity,
  tldrAnalogy = null,
  tldrShort = null,
  details = "",
  followUp = null,
  lifecycle = ANSWER_LIFECYCLE.STREAMING,
} = {}) {
  const analogyText = asText(tldrAnalogy);
  const shortText = asText(tldrShort);
  const detailsText = asText(details);
  const discoveryFollowUp = asText(followUp);
  return createAnswerContributor({
    kind: ANSWER_CONTRIBUTOR_KIND.CONTENT,
    identity,
    lifecycle,
    slots: {
      tldrAnalogy: analogyText
        ? { status: ANSWER_SLOT_STATUS.READY, value: analogyText }
        : { status: ANSWER_SLOT_STATUS.EMPTY, value: null, message: "No analogy canvas provided." },
      tldrShort: shortText
        ? { status: ANSWER_SLOT_STATUS.READY, value: shortText }
        : { status: ANSWER_SLOT_STATUS.EMPTY, value: null, message: "No short answer provided." },
      details: detailsText
        ? { status: ANSWER_SLOT_STATUS.READY, value: detailsText }
        : { status: ANSWER_SLOT_STATUS.EMPTY, value: null, message: "No detail body provided." },
      followUp: discoveryFollowUp
        ? { status: ANSWER_SLOT_STATUS.READY, value: discoveryFollowUp }
        : { status: ANSWER_SLOT_STATUS.EMPTY, value: null, message: "No discovery follow-up provided." },
    },
  });
}

export function createSourcesContribution({ identity, sources = [] } = {}) {
  const normalized = asArray(sources);
  const passages = normalized.map(sourcePassage);
  return createAnswerContributor({
    kind: ANSWER_CONTRIBUTOR_KIND.SOURCES,
    identity,
    slots: {
      sources: normalized.length
        ? { status: ANSWER_SLOT_STATUS.READY, value: normalized.map((source, index) => visibleSource(source, passages[index])) }
        : { status: ANSWER_SLOT_STATUS.UNAVAILABLE, value: [], message: "Sources unavailable." },
    },
    evidence: { passages },
  });
}

export function createTelemetryContribution({ identity, telemetry = null } = {}) {
  return createAnswerContributor({
    kind: ANSWER_CONTRIBUTOR_KIND.TELEMETRY,
    identity,
    slots: {
      telemetry: hasObjectValue(telemetry)
        ? { status: ANSWER_SLOT_STATUS.READY, value: telemetry }
        : { status: ANSWER_SLOT_STATUS.UNAVAILABLE, value: null, message: "Telemetry unavailable." },
    },
  });
}

export function createConfidenceContribution({
  identity,
  confidence = null,
  judgeEvidence = [],
  lineageUnavailable = false,
} = {}) {
  return createAnswerContributor({
    kind: ANSWER_CONTRIBUTOR_KIND.CONFIDENCE,
    identity,
    slots: {
      confidence: hasObjectValue(confidence) && !lineageUnavailable
        ? { status: ANSWER_SLOT_STATUS.READY, value: confidence }
        : {
          status: ANSWER_SLOT_STATUS.UNAVAILABLE,
          value: null,
          message: lineageUnavailable ? "Confidence evidence lineage unavailable." : "Confidence unavailable.",
        },
    },
    evidence: { evaluations: asArray(judgeEvidence).map(evidenceEvaluation) },
  });
}

export function createOpaqueActionContribution({ identity, action = null } = {}) {
  return createAnswerContributor({
    kind: ANSWER_CONTRIBUTOR_KIND.OPAQUE_ACTION,
    identity,
    slots: {
      actions: action
        ? { status: ANSWER_SLOT_STATUS.READY, value: action }
        : { status: ANSWER_SLOT_STATUS.UNAVAILABLE, value: null, message: "Action unavailable." },
    },
  });
}

export function createProgressContribution({ identity, percent = 0, phase = null, lifecycle = null } = {}) {
  return createAnswerContributor({
    kind: ANSWER_CONTRIBUTOR_KIND.PROGRESS,
    identity,
    lifecycle,
    slots: {
      progress: {
        status: ANSWER_SLOT_STATUS.READY,
        value: { percent: clampPercent(percent), phase: asText(phase) || null },
      },
    },
  });
}

export function createErrorRetryContribution({
  identity,
  failedSlot = "details",
  message = "This step failed.",
  retrying = false,
} = {}) {
  const status = retrying ? ANSWER_SLOT_STATUS.RETRYING : ANSWER_SLOT_STATUS.FAILED;
  return createAnswerContributor({
    kind: ANSWER_CONTRIBUTOR_KIND.ERROR_RETRY,
    identity,
    lifecycle: retrying ? ANSWER_LIFECYCLE.RETRYING : ANSWER_LIFECYCLE.FAILED,
    slots: {
      [failedSlot]: {
        status,
        value: null,
        message: retrying ? "Retrying this step..." : message,
        error: retrying ? null : message,
      },
      errorRetry: {
        status,
        value: { failedSlot },
        message: retrying ? "Retrying this step..." : message,
        error: retrying ? null : message,
      },
    },
  });
}
