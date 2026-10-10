import {
  ANSWER_CONTRACT_VERSION,
  ANSWER_LIFECYCLE,
  ANSWER_SLOT_STATUS,
  answerIdentityKey,
  closeAnswerRecord,
  createAnswerRecord,
  createAnswerSlot,
} from "../core/answer-record.mjs";
import {
  applyAnswerContribution,
  ANSWER_CONTRIBUTOR_KIND,
  createAnswerContributor,
} from "./answer-presentation.mjs";

function segmentIdentityKey(identity) {
  return [
    identity.widgetInstanceId,
    identity.conversationId,
    identity.answerSegmentId,
  ].map(encodeURIComponent).join(":");
}

function rejectEvent(state, event, reason) {
  state.rejections.push(Object.freeze({
    eventName: event?.eventName || null,
    reason,
  }));
  while (state.rejections.length > state.maxRejections) state.rejections.shift();
  return null;
}

function notify(onRecord, record, eventName) {
  if (typeof onRecord === "function") {
    onRecord(record, Object.freeze({ eventName }));
  }
  return record;
}

function buildPreparedRecord(identity) {
  return createAnswerRecord({
    identity,
    lifecycle: ANSWER_LIFECYCLE.SEARCHING,
    slots: {
      progress: {
        status: ANSWER_SLOT_STATUS.READY,
        value: { percent: 0, phase: "prepared" },
      },
    },
  });
}

function buildCompletedContribution(identity) {
  return createAnswerContributor({
    kind: ANSWER_CONTRIBUTOR_KIND.PROGRESS,
    identity,
    lifecycle: ANSWER_LIFECYCLE.COMPLETE,
    slots: {
      progress: {
        status: ANSWER_SLOT_STATUS.READY,
        value: { percent: 100, phase: "completed" },
      },
    },
  });
}

function buildNoErrorContribution(identity) {
  return createAnswerContributor({
    kind: ANSWER_CONTRIBUTOR_KIND.ERROR_RETRY,
    identity,
    slots: {
      errorRetry: {
        status: ANSWER_SLOT_STATUS.EMPTY,
        value: null,
        message: "No retry needed.",
      },
    },
  });
}

function buildLifecycleContribution(identity, lifecycle) {
  return createAnswerContributor({
    kind: ANSWER_CONTRIBUTOR_KIND.LIFECYCLE,
    identity,
    lifecycle,
  });
}

function completedFallbackForSlot(key) {
  if (key === "sources") {
    return { status: ANSWER_SLOT_STATUS.UNAVAILABLE, value: [], message: "Sources unavailable." };
  }
  if (key === "confidence") {
    return { status: ANSWER_SLOT_STATUS.UNAVAILABLE, value: null, message: "Confidence unavailable." };
  }
  if (key === "telemetry") {
    return { status: ANSWER_SLOT_STATUS.UNAVAILABLE, value: null, message: "Telemetry unavailable." };
  }
  if (key === "actions") {
    return { status: ANSWER_SLOT_STATUS.UNAVAILABLE, value: null, message: "Action unavailable." };
  }
  if (key === "errorRetry") {
    return { status: ANSWER_SLOT_STATUS.EMPTY, value: null, message: "No retry needed." };
  }
  return { status: ANSWER_SLOT_STATUS.EMPTY, value: null, message: "No content provided." };
}

function finalizeCompletedRecord(record) {
  const slots = {};
  for (const [key, slot] of Object.entries(record.slots)) {
    slots[key] = slot.status === ANSWER_SLOT_STATUS.LOADING
      ? createAnswerSlot(key, completedFallbackForSlot(key))
      : slot;
  }
  return createAnswerRecord({
    identity: record.identity,
    lifecycle: record.lifecycle,
    evidence: record.evidence,
    slots,
  });
}

export function createAnswerHarnessObserver({ onRecord } = {}) {
  const state = {
    records: new Map(),
    recordOrder: [],
    activeBySegment: new Map(),
    rejections: [],
    maxRecords: 200,
    maxRejections: 200,
  };

  function writeRecord(key, record) {
    if (!state.records.has(key)) state.recordOrder.push(key);
    state.records.set(key, record);
    while (state.recordOrder.length > state.maxRecords) {
      const oldest = state.recordOrder.shift();
      state.records.delete(oldest);
      for (const [segmentKey, recordKey] of state.activeBySegment.entries()) {
        if (recordKey === oldest) state.activeBySegment.delete(segmentKey);
      }
    }
    return record;
  }

  function accept(event) {
    if (!event || typeof event !== "object") return rejectEvent(state, event, "invalid_event");
    const detail = event.detail || {};
    const identity = detail.answerIdentity;
    if (!identity) return rejectEvent(state, event, "missing_answer_identity");

    let key;
    let segmentKey;
    try {
      key = answerIdentityKey(identity);
      segmentKey = segmentIdentityKey(identity);
    } catch {
      return rejectEvent(state, event, "invalid_answer_identity");
    }

    if (event.eventName === "prepared") {
      const previousKey = state.activeBySegment.get(segmentKey);
      if (previousKey === key) {
        const existing = state.records.get(key);
        if (existing) return existing;
      }
      if (previousKey && previousKey !== key) {
        const previous = state.records.get(previousKey);
        if (previous) {
          writeRecord(previousKey, closeAnswerRecord(previous, ANSWER_LIFECYCLE.SUPERSEDED));
        }
      }
      const record = buildPreparedRecord(identity);
      state.activeBySegment.set(segmentKey, key);
      writeRecord(key, record);
      return notify(onRecord, record, event.eventName);
    }

    if (state.activeBySegment.get(segmentKey) !== key) {
      return rejectEvent(state, event, "stale_answer_attempt");
    }

    if (event.eventName === "completed") {
      const record = state.records.get(key) || buildPreparedRecord(identity);
      const settled = record.slots.errorRetry?.status === ANSWER_SLOT_STATUS.LOADING
        ? applyAnswerContribution(record, buildNoErrorContribution(identity))
        : record;
      const completed = applyAnswerContribution(settled, buildCompletedContribution(identity));
      const next = detail.contribution
        ? applyAnswerContribution(completed, detail.contribution)
        : completed;
      const finalized = finalizeCompletedRecord(next);
      writeRecord(key, finalized);
      return notify(onRecord, finalized, event.eventName);
    }

    if (event.eventName === "contribution") {
      const record = state.records.get(key) || buildPreparedRecord(identity);
      const contribution = detail.contribution;
      if (!contribution) return rejectEvent(state, event, "missing_contribution");
      const next = applyAnswerContribution(record, contribution);
      writeRecord(key, next);
      return notify(onRecord, next, event.eventName);
    }

    if (event.eventName === "streaming" || event.eventName === "judging" || event.eventName === "failed") {
      const record = state.records.get(key) || buildPreparedRecord(identity);
      const lifecycle = event.eventName === "streaming"
        ? ANSWER_LIFECYCLE.STREAMING
        : event.eventName === "judging"
          ? ANSWER_LIFECYCLE.JUDGING
          : ANSWER_LIFECYCLE.FAILED;
      const next = applyAnswerContribution(record, buildLifecycleContribution(identity, lifecycle));
      writeRecord(key, next);
      return notify(onRecord, next, event.eventName);
    }

    if (event.eventName === "reset" || event.eventName === "disconnected") {
      const record = state.records.get(key) || buildPreparedRecord(identity);
      const lifecycle = event.eventName === "reset"
        ? ANSWER_LIFECYCLE.RESET
        : ANSWER_LIFECYCLE.DISCONNECTED;
      const next = closeAnswerRecord(record, lifecycle);
      writeRecord(key, next);
      state.activeBySegment.delete(segmentKey);
      return notify(onRecord, next, event.eventName);
    }

    return rejectEvent(state, event, "unknown_event");
  }

  function getRecord(identity) {
    return state.records.get(typeof identity === "string" ? identity : answerIdentityKey(identity)) || null;
  }

  return Object.freeze({
    accept,
    getRecord,
    records: () => Object.freeze([...state.records.values()]),
    rejections: () => Object.freeze([...state.rejections]),
    contractVersion: ANSWER_CONTRACT_VERSION,
  });
}
