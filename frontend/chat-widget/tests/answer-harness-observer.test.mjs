import test from "node:test";
import assert from "node:assert/strict";
import {
  ANSWER_LIFECYCLE,
  ANSWER_SLOT_STATUS,
} from "../source/shared/core/answer-record.mjs";
import { createAnswerHarnessObserver } from "../source/shared/widget/answer-harness-observer.mjs";

const identity = Object.freeze({
  widgetInstanceId: "widget-1",
  conversationId: "conversation-1",
  answerSegmentId: "answer-1",
  networkAttemptId: "attempt-1",
});

function event(eventName, answerIdentity = identity) {
  return Object.freeze({
    eventName,
    detail: Object.freeze({ answerIdentity }),
  });
}

test("mirror observer creates one answer record from prepared runtime events", () => {
  const seen = [];
  const observer = createAnswerHarnessObserver({ onRecord: (record) => seen.push(record) });

  const record = observer.accept(event("prepared"));

  assert.equal(record.lifecycle, ANSWER_LIFECYCLE.SEARCHING);
  assert.equal(record.slots.progress.status, ANSWER_SLOT_STATUS.READY);
  assert.equal(record.slots.progress.value.percent, 0);
  assert.equal(observer.records().length, 1);
  assert.equal(seen.length, 1);
  assert.deepEqual(observer.rejections(), []);
});

test("mirror observer marks the matching answer attempt complete without changing other slots", () => {
  const observer = createAnswerHarnessObserver();

  observer.accept(event("prepared"));
  const record = observer.accept(event("completed"));

  assert.equal(record.lifecycle, ANSWER_LIFECYCLE.COMPLETE);
  assert.equal(record.slots.progress.status, ANSWER_SLOT_STATUS.READY);
  assert.equal(record.slots.progress.value.percent, 100);
  assert.equal(record.slots.tldrAnalogy.status, ANSWER_SLOT_STATUS.LOADING);
  assert.deepEqual(observer.rejections(), []);
});

test("late completion from a superseded attempt is rejected instead of overwriting the active attempt", () => {
  const observer = createAnswerHarnessObserver();
  const retryIdentity = Object.freeze({ ...identity, networkAttemptId: "attempt-2" });

  observer.accept(event("prepared", identity));
  observer.accept(event("prepared", retryIdentity));
  const rejected = observer.accept(event("completed", identity));
  const current = observer.accept(event("completed", retryIdentity));

  assert.equal(rejected, null);
  assert.equal(current.lifecycle, ANSWER_LIFECYCLE.COMPLETE);
  assert.equal(observer.getRecord(identity).lifecycle, ANSWER_LIFECYCLE.SUPERSEDED);
  assert.deepEqual(observer.rejections(), [{
    eventName: "completed",
    reason: "stale_answer_attempt",
  }]);
});

test("mirror observer rejects malformed or unidentified events visibly for diagnostics", () => {
  const observer = createAnswerHarnessObserver();

  assert.equal(observer.accept(null), null);
  assert.equal(observer.accept({ eventName: "prepared", detail: {} }), null);
  assert.equal(observer.accept({ eventName: "bogus", detail: { answerIdentity: identity } }), null);

  assert.deepEqual(observer.rejections(), [
    { eventName: null, reason: "invalid_event" },
    { eventName: "prepared", reason: "missing_answer_identity" },
    { eventName: "bogus", reason: "stale_answer_attempt" },
  ]);
});
