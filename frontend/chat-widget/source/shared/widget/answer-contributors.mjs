import {
  ANSWER_LIFECYCLE,
  ANSWER_SLOT_STATUS,
} from "../core/answer-record.mjs";
import {
  createAnswerContributor,
  splitAnswerContent,
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

export function createAnswerContentContribution({
  identity,
  text = "",
  lifecycle = ANSWER_LIFECYCLE.STREAMING,
} = {}) {
  const content = splitAnswerContent(text);
  return createAnswerContributor({
    identity,
    lifecycle,
    slots: {
      tldrAnalogy: content.tldrAnalogy
        ? { status: ANSWER_SLOT_STATUS.READY, value: content.tldrAnalogy }
        : { status: ANSWER_SLOT_STATUS.EMPTY, value: null, message: "No analogy canvas provided." },
      tldrShort: content.tldrShort
        ? { status: ANSWER_SLOT_STATUS.READY, value: content.tldrShort }
        : { status: ANSWER_SLOT_STATUS.EMPTY, value: null, message: "No short answer provided." },
      details: content.details
        ? { status: ANSWER_SLOT_STATUS.READY, value: content.details }
        : { status: ANSWER_SLOT_STATUS.EMPTY, value: null, message: "No detail body provided." },
      followUp: content.followUp
        ? { status: ANSWER_SLOT_STATUS.READY, value: content.followUp }
        : { status: ANSWER_SLOT_STATUS.EMPTY, value: null, message: "No discovery follow-up provided." },
    },
  });
}

export function createSourcesContribution({ identity, sources = [] } = {}) {
  const normalized = asArray(sources);
  return createAnswerContributor({
    identity,
    slots: {
      sources: normalized.length
        ? { status: ANSWER_SLOT_STATUS.READY, value: normalized }
        : { status: ANSWER_SLOT_STATUS.UNAVAILABLE, value: [], message: "Sources unavailable." },
    },
    evidence: { passages: normalized.map((source) => ({ kind: "source", value: source })) },
  });
}

export function createTelemetryContribution({ identity, telemetry = null } = {}) {
  return createAnswerContributor({
    identity,
    slots: {
      telemetry: hasObjectValue(telemetry)
        ? { status: ANSWER_SLOT_STATUS.READY, value: telemetry }
        : { status: ANSWER_SLOT_STATUS.UNAVAILABLE, value: null, message: "Telemetry unavailable." },
    },
  });
}

export function createConfidenceContribution({ identity, confidence = null, judgeEvidence = [] } = {}) {
  return createAnswerContributor({
    identity,
    slots: {
      confidence: hasObjectValue(confidence)
        ? { status: ANSWER_SLOT_STATUS.READY, value: confidence }
        : { status: ANSWER_SLOT_STATUS.UNAVAILABLE, value: null, message: "Confidence unavailable." },
    },
    evidence: { passages: asArray(judgeEvidence).map((item) => ({ kind: "judge", value: item })) },
  });
}

export function createOpaqueActionContribution({ identity, action = null } = {}) {
  return createAnswerContributor({
    identity,
    slots: {
      compareAction: action
        ? { status: ANSWER_SLOT_STATUS.READY, value: action }
        : { status: ANSWER_SLOT_STATUS.UNAVAILABLE, value: null, message: "Action unavailable." },
    },
  });
}

export function createProgressContribution({ identity, percent = 0, phase = null, lifecycle = null } = {}) {
  return createAnswerContributor({
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
