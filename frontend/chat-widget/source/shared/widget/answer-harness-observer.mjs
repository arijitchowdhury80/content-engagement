import {
  ANSWER_CONTRACT_VERSION,
  ANSWER_LIFECYCLE,
  ANSWER_SLOT_STATUS,
  answerIdentityKey,
  closeAnswerRecord,
  createAnswerRecord,
} from "../core/answer-record.mjs";
import {
  applyAnswerContribution,
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

function buildLifecycleContribution(identity, lifecycle) {
  return createAnswerContributor({
    identity,
    lifecycle,
  });
}

export function createAnswerHarnessObserver({ onRecord } = {}) {
  const state = {
    records: new Map(),
    activeBySegment: new Map(),
    rejections: [],
  };

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
      if (previousKey && previousKey !== key) {
        const previous = state.records.get(previousKey);
        if (previous) {
          state.records.set(previousKey, closeAnswerRecord(previous, ANSWER_LIFECYCLE.SUPERSEDED));
        }
      }
      const record = buildPreparedRecord(identity);
      state.activeBySegment.set(segmentKey, key);
      state.records.set(key, record);
      return notify(onRecord, record, event.eventName);
    }

    if (state.activeBySegment.get(segmentKey) !== key) {
      return rejectEvent(state, event, "stale_answer_attempt");
    }

    if (event.eventName === "completed") {
      const record = state.records.get(key) || buildPreparedRecord(identity);
      const completed = applyAnswerContribution(record, buildCompletedContribution(identity));
      const next = detail.contribution
        ? applyAnswerContribution(completed, detail.contribution)
        : completed;
      state.records.set(key, next);
      return notify(onRecord, next, event.eventName);
    }

    if (event.eventName === "contribution") {
      const record = state.records.get(key) || buildPreparedRecord(identity);
      const contribution = detail.contribution;
      if (!contribution) return rejectEvent(state, event, "missing_contribution");
      const next = applyAnswerContribution(record, contribution);
      state.records.set(key, next);
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
      state.records.set(key, next);
      return notify(onRecord, next, event.eventName);
    }

    if (event.eventName === "reset" || event.eventName === "disconnected") {
      const record = state.records.get(key) || buildPreparedRecord(identity);
      const lifecycle = event.eventName === "reset"
        ? ANSWER_LIFECYCLE.RESET
        : ANSWER_LIFECYCLE.DISCONNECTED;
      const next = closeAnswerRecord(record, lifecycle);
      state.records.set(key, next);
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
