import test from "node:test";
import assert from "node:assert/strict";
import {
  ANSWER_LIFECYCLE,
  ANSWER_SLOT_STATUS,
} from "../source/shared/core/answer-record.mjs";
import {
  createAnswerContentContribution,
  createConfidenceContribution,
  createOpaqueActionContribution,
  createProgressContribution,
  createSourcesContribution,
  createTelemetryContribution,
} from "../source/shared/widget/answer-contributors.mjs";
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

function contributionEvent(contribution, answerIdentity = identity) {
  return Object.freeze({
    eventName: "contribution",
    detail: Object.freeze({ answerIdentity, contribution }),
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

test("mirror observer merges typed slot contributions into one answer record", () => {
  const observer = createAnswerHarnessObserver();

  observer.accept(event("prepared"));
  observer.accept(contributionEvent(createAnswerContentContribution({
    identity,
    text: [
      "API calls are like door swings in a busy store.",
      "",
      "Short version: data-requesting interactions usually count.",
      "",
      "Debounce typing and protect shared traffic.",
      "",
      "Are bots or normal browsers driving the cost?",
    ].join("\n"),
  })));
  observer.accept(contributionEvent(createSourcesContribution({
    identity,
    sources: [{ title: "Docs" }],
  })));
  observer.accept(contributionEvent(createTelemetryContribution({
    identity,
    telemetry: { inputTokens: 44141, outputTokens: 819 },
  })));
  observer.accept(contributionEvent(createOpaqueActionContribution({
    identity,
    action: { label: "Compare with Prod" },
  })));
  observer.accept(contributionEvent(createConfidenceContribution({
    identity,
    confidence: { score: 8.1 },
    judgeEvidence: [{ judge: "factuality" }],
  })));
  const record = observer.accept(event("completed"));

  assert.equal(record.lifecycle, ANSWER_LIFECYCLE.COMPLETE);
  assert.equal(record.slots.tldrAnalogy.status, ANSWER_SLOT_STATUS.READY);
  assert.equal(record.slots.tldrShort.status, ANSWER_SLOT_STATUS.READY);
  assert.equal(record.slots.details.status, ANSWER_SLOT_STATUS.READY);
  assert.equal(record.slots.followUp.status, ANSWER_SLOT_STATUS.READY);
  assert.equal(record.slots.sources.value[0].title, "Docs");
  assert.equal(record.slots.telemetry.value.inputTokens, 44141);
  assert.equal(record.slots.compareAction.value.label, "Compare with Prod");
  assert.equal(record.slots.confidence.value.score, 8.1);
  assert.equal(record.evidence.passages[0].kind, "source");
  assert.equal(record.evidence.passages[0].id, "source:retrieval:0:docs");
  assert.equal(record.evidence.passages[0].value.title, "Docs");
  assert.equal(record.evidence.evaluations[0].kind, "judge");
  assert.equal(record.evidence.evaluations[0].value.judge, "factuality");
  assert.equal(Object.hasOwn(record.evidence, "sources"), false);
  assert.equal(Object.hasOwn(record.evidence, "judgeEvidence"), false);
  assert.equal(record.slots.progress.value.percent, 100);
});

test("duplicate prepared replay for the same attempt does not erase later mirror state", () => {
  const observer = createAnswerHarnessObserver();

  observer.accept(event("prepared"));
  const progressed = observer.accept(contributionEvent(createProgressContribution({ identity, percent: 60, phase: "streaming" })));
  const replay = observer.accept(event("prepared"));

  assert.equal(progressed.slots.progress.value.percent, 60);
  assert.equal(replay.slots.progress.value.percent, 60);
  assert.equal(observer.records().length, 1);
  assert.deepEqual(observer.rejections(), []);
});

test("duplicate prepared replay after terminal completion does not reopen the answer", () => {
  const observer = createAnswerHarnessObserver();

  observer.accept(event("prepared"));
  const complete = observer.accept(event("completed"));
  const replay = observer.accept(event("prepared"));

  assert.equal(complete.lifecycle, ANSWER_LIFECYCLE.COMPLETE);
  assert.equal(replay.lifecycle, ANSWER_LIFECYCLE.COMPLETE);
  assert.equal(replay.slots.progress.value.percent, 100);
  assert.equal(observer.records().length, 1);
});

test("mirror observer preserves monotonic progress across contribution events", () => {
  const observer = createAnswerHarnessObserver();

  observer.accept(event("prepared"));
  observer.accept(contributionEvent(createProgressContribution({ identity, percent: 50, phase: "streaming" })));
  const lower = observer.accept(contributionEvent(createProgressContribution({ identity, percent: 20, phase: "late-search" })));
  const complete = observer.accept(contributionEvent(createProgressContribution({ identity, percent: 100, phase: "complete" })));

  assert.equal(lower.slots.progress.value.percent, 50);
  assert.equal(complete.slots.progress.value.percent, 100);
});

test("mirror observer rejects late contributions after reset", () => {
  const observer = createAnswerHarnessObserver();

  observer.accept(event("prepared"));
  const reset = observer.accept(event("reset"));
  const late = observer.accept(contributionEvent(createSourcesContribution({
    identity,
    sources: [{ title: "Late docs" }],
  })));

  assert.equal(reset.lifecycle, ANSWER_LIFECYCLE.RESET);
  assert.equal(late, null);
  assert.equal(observer.getRecord(identity).slots.sources.status, ANSWER_SLOT_STATUS.LOADING);
  assert.deepEqual(observer.rejections(), [{
    eventName: "contribution",
    reason: "stale_answer_attempt",
  }]);
});
