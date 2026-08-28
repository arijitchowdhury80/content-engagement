// answerSegmentId is the stable response correlation key for one visible
// answer segment. During compatibility, handoff may derive it from the
// originating user message ID until the chat runtime supplies a native answer ID.
const REQUIRED_IDENTITY_KEYS = Object.freeze([
  "widgetInstanceId",
  "conversationId",
  "answerSegmentId",
  "networkAttemptId",
]);

export const ANSWER_SLOT_KEYS = Object.freeze([
  "tldrAnalogy",
  "tldrShort",
  "details",
  "sources",
  "followUp",
  "confidence",
  "telemetry",
  "compareAction",
  "progress",
  "errorRetry",
]);

export const ANSWER_SLOT_STATUS = Object.freeze({
  LOADING: "loading",
  READY: "ready",
  EMPTY: "empty",
  UNAVAILABLE: "unavailable",
  RETRYING: "retrying",
  FAILED: "failed",
});

export const ANSWER_LIFECYCLE = Object.freeze({
  SEARCHING: "searching",
  READING: "reading",
  SYNTHESIZING: "synthesizing",
  STREAMING: "streaming",
  JUDGING: "judging",
  COMPLETE: "complete",
  FAILED: "failed",
  RETRYING: "retrying",
  SUPERSEDED: "superseded",
  RESET: "reset",
  DISCONNECTED: "disconnected",
});

export const ANSWER_CONTRACT_VERSION = 1;

const VALID_SLOT_STATUSES = new Set(Object.values(ANSWER_SLOT_STATUS));
const VALID_LIFECYCLES = new Set(Object.values(ANSWER_LIFECYCLE));
const CLOSED_LIFECYCLES = new Set([
  ANSWER_LIFECYCLE.SUPERSEDED,
  ANSWER_LIFECYCLE.RESET,
  ANSWER_LIFECYCLE.DISCONNECTED,
]);
const ACCOUNTED_SLOT_STATUSES = new Set([
  ANSWER_SLOT_STATUS.READY,
  ANSWER_SLOT_STATUS.EMPTY,
  ANSWER_SLOT_STATUS.UNAVAILABLE,
  ANSWER_SLOT_STATUS.FAILED,
]);

function assertPlainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
}

function assertNonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}

function cloneValue(value) {
  if (Array.isArray(value)) return value.map(cloneValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, cloneValue(nested)]));
}

function normalizeEvidencePassage(passage) {
  if (!passage || typeof passage !== "object" || Array.isArray(passage)) {
    return { kind: "unknown", value: cloneValue(passage) };
  }
  const kind = typeof passage.kind === "string" && passage.kind.trim()
    ? passage.kind.trim()
    : "unknown";
  return {
    ...cloneValue(passage),
    kind,
    value: cloneValue(passage.value ?? passage),
  };
}

function legacyEvidencePassages(evidence) {
  const passages = [];
  if (Array.isArray(evidence.sources)) {
    for (const source of evidence.sources) passages.push({ kind: "source", value: source });
  }
  if (Array.isArray(evidence.judgeEvidence)) {
    for (const item of evidence.judgeEvidence) passages.push({ kind: "judge", value: item });
  }
  return passages;
}

export function createAnswerIdentity(identity) {
  assertPlainObject(identity, "answer identity");
  const normalized = {};
  for (const key of REQUIRED_IDENTITY_KEYS) {
    assertNonEmptyString(identity[key], `answer identity ${key}`);
    normalized[key] = identity[key].trim();
  }
  return deepFreeze(normalized);
}

export function answerIdentityKey(identity) {
  const normalized = createAnswerIdentity(identity);
  return REQUIRED_IDENTITY_KEYS.map((key) => encodeURIComponent(normalized[key])).join(":");
}

export function sameAnswerIdentity(left, right) {
  if (!left || !right) return false;
  return REQUIRED_IDENTITY_KEYS.every((key) => left[key] === right[key]);
}

export function createAnswerEvidenceRecord(evidence = {}) {
  assertPlainObject(evidence, "answer evidence");
  const passages = Array.isArray(evidence.passages)
    ? evidence.passages.map(normalizeEvidencePassage)
    : legacyEvidencePassages(evidence).map(normalizeEvidencePassage);
  return deepFreeze({
    id: evidence.id || null,
    passages,
  });
}

export function createAnswerSlot(key, input = {}) {
  if (!ANSWER_SLOT_KEYS.includes(key)) throw new TypeError(`Unknown answer slot: ${key}`);
  const status = input.status || ANSWER_SLOT_STATUS.LOADING;
  if (!VALID_SLOT_STATUSES.has(status)) throw new TypeError(`Invalid answer slot status: ${status}`);
  return deepFreeze({
    key,
    status,
    value: cloneValue(input.value ?? null),
    message: input.message || null,
    error: input.error || null,
  });
}

export function createRequiredAnswerSlots(overrides = {}) {
  assertPlainObject(overrides, "answer slot overrides");
  const slots = {};
  for (const key of ANSWER_SLOT_KEYS) {
    slots[key] = createAnswerSlot(key, overrides[key] || {});
  }
  return deepFreeze(slots);
}

export function createAnswerRecord(input) {
  assertPlainObject(input, "answer record input");
  const identity = createAnswerIdentity(input.identity);
  const lifecycle = input.lifecycle || ANSWER_LIFECYCLE.SEARCHING;
  if (!VALID_LIFECYCLES.has(lifecycle)) throw new TypeError(`Invalid answer lifecycle: ${lifecycle}`);
  return deepFreeze({
    contractVersion: ANSWER_CONTRACT_VERSION,
    identity,
    identityKey: answerIdentityKey(identity),
    lifecycle,
    evidence: createAnswerEvidenceRecord(input.evidence || { id: answerIdentityKey(identity) }),
    slots: createRequiredAnswerSlots(input.slots || {}),
  });
}

export function closeAnswerRecord(record, lifecycle) {
  assertAnswerRecord(record);
  if (!CLOSED_LIFECYCLES.has(lifecycle)) throw new TypeError(`Invalid closed answer lifecycle: ${lifecycle}`);
  return deepFreeze({ ...record, lifecycle });
}

export function assertAnswerRecord(record) {
  assertPlainObject(record, "answer record");
  if (record.contractVersion !== ANSWER_CONTRACT_VERSION) {
    throw new TypeError(`Unsupported answer contract version: ${record.contractVersion}`);
  }
  createAnswerIdentity(record.identity);
  assertNonEmptyString(record.identityKey, "answer identity key");
  if (!VALID_LIFECYCLES.has(record.lifecycle)) {
    throw new TypeError(`Invalid answer lifecycle: ${record.lifecycle}`);
  }
  assertPlainObject(record.slots, "answer slots");
  for (const key of ANSWER_SLOT_KEYS) {
    if (!record.slots[key]) throw new TypeError(`Missing required answer slot: ${key}`);
    createAnswerSlot(key, record.slots[key]);
  }
}

export function isClosedAnswerRecord(record) {
  return CLOSED_LIFECYCLES.has(record?.lifecycle);
}

export function isAnswerRecordComplete(record) {
  assertAnswerRecord(record);
  return ANSWER_SLOT_KEYS.every((key) => ACCOUNTED_SLOT_STATUSES.has(record.slots[key].status));
}
