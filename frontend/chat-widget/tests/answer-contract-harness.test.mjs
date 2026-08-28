import test from "node:test";
import assert from "node:assert/strict";
import {
  ANSWER_LIFECYCLE,
  ANSWER_SLOT_KEYS,
  ANSWER_SLOT_STATUS,
  closeAnswerRecord,
  createAnswerIdentity,
  createAnswerRecord,
  isAnswerRecordComplete,
} from "../source/shared/core/answer-record.mjs";
import {
  applyAnswerContribution,
  createAnswerContributor,
  createFailedAnswerPresentation,
  createPresentationFromAnswerText,
  splitAnswerContent,
  toAnswerPresentation,
} from "../source/shared/widget/answer-presentation.mjs";

const identity = Object.freeze({
  widgetInstanceId: "widget-1",
  conversationId: "conversation-1",
  answerSegmentId: "answer-1",
  networkAttemptId: "attempt-1",
});

function slotStatuses(record) {
  return Object.fromEntries(ANSWER_SLOT_KEYS.map((key) => [key, record.slots[key]?.status]));
}

test("every answer record has every required presentation slot", () => {
  const record = createAnswerRecord({ identity });

  assert.deepEqual(Object.keys(record.slots), [...ANSWER_SLOT_KEYS]);
  assert.deepEqual(
    slotStatuses(record),
    Object.fromEntries(ANSWER_SLOT_KEYS.map((key) => [key, ANSWER_SLOT_STATUS.LOADING]))
  );
  assert.ok(Object.isFrozen(record));
  assert.ok(Object.isFrozen(record.slots));
});

test("answer identity requires widget, conversation, segment, and network attempt", () => {
  assert.deepEqual(createAnswerIdentity(identity), identity);
  assert.throws(
    () => createAnswerIdentity({ ...identity, networkAttemptId: "" }),
    /networkAttemptId/
  );
});

test("TLDR splitting preserves analogy, short answer, details, and follow-up separation", () => {
  const answer = [
    "API calls are like little door swings at a very busy store.",
    "",
    "Short version: almost every data request counts as a billable search request.",
    "",
    "Debounce typing, cache stable requests, and protect shared traffic with rate limits.",
    "",
    "<pivot>Are you protecting against bots or normal browsing costs?</pivot>",
  ].join("\n");

  const split = splitAnswerContent(answer);

  assert.equal(split.tldrAnalogy, "API calls are like little door swings at a very busy store.");
  assert.equal(split.tldrShort, "Short version: almost every data request counts as a billable search request.");
  assert.equal(split.details, "Debounce typing, cache stable requests, and protect shared traffic with rate limits.");
  assert.equal(split.followUp, "Are you protecting against bots or normal browsing costs?");
  assert.equal(split.details.includes(split.followUp), false);
});

test("heading-first or one-paragraph answers do not force a fake TLDR split", () => {
  const headingFirst = splitAnswerContent("# Quick take\n\nThis should remain detail content.");
  assert.equal(headingFirst.tldrAnalogy, null);
  assert.equal(headingFirst.tldrShort, null);
  assert.match(headingFirst.details, /# Quick take/);

  const oneParagraph = splitAnswerContent("Only one paragraph is available.");
  assert.equal(oneParagraph.tldrAnalogy, null);
  assert.equal(oneParagraph.tldrShort, null);
  assert.equal(oneParagraph.details, "Only one paragraph is available.");
});

test("presentation records missing sources and judge as unavailable instead of invisible", () => {
  const record = createPresentationFromAnswerText({
    identity,
    text: "Analogy canvas.\n\nShort version: answer.\n\nDetails body.",
    progress: { percent: 100 },
    lifecycle: ANSWER_LIFECYCLE.COMPLETE,
  });
  const presentation = toAnswerPresentation(record);

  assert.equal(presentation.tldr.analogy.status, ANSWER_SLOT_STATUS.READY);
  assert.equal(presentation.tldr.short.status, ANSWER_SLOT_STATUS.READY);
  assert.equal(presentation.details.status, ANSWER_SLOT_STATUS.READY);
  assert.equal(presentation.footer.sources.status, ANSWER_SLOT_STATUS.UNAVAILABLE);
  assert.equal(presentation.footer.confidence.status, ANSWER_SLOT_STATUS.UNAVAILABLE);
  assert.equal(presentation.footer.telemetry.status, ANSWER_SLOT_STATUS.UNAVAILABLE);
  assert.equal(presentation.footer.compareAction.status, ANSWER_SLOT_STATUS.UNAVAILABLE);
  assert.equal(isAnswerRecordComplete(record), true);
});

test("contributors update data only for the matching exact answer attempt", () => {
  const record = createAnswerRecord({ identity });
  const accepted = applyAnswerContribution(
    record,
    createAnswerContributor({
      identity,
      slots: {
        sources: { status: ANSWER_SLOT_STATUS.READY, value: [{ title: "Docs" }] },
      },
      evidence: { sources: [{ title: "Docs" }] },
    })
  );
  const rejected = applyAnswerContribution(
    accepted,
    createAnswerContributor({
      identity: { ...identity, networkAttemptId: "attempt-2" },
      slots: {
        sources: { status: ANSWER_SLOT_STATUS.READY, value: [{ title: "Wrong attempt" }] },
      },
    })
  );

  assert.equal(accepted.slots.sources.value[0].title, "Docs");
  assert.equal(accepted.evidence.sources[0].title, "Docs");
  assert.equal(rejected, accepted);
});

test("closed answer records reject stale late updates after reset or supersession", () => {
  const record = createAnswerRecord({ identity });
  const closed = closeAnswerRecord(record, ANSWER_LIFECYCLE.RESET);
  const updated = applyAnswerContribution(
    closed,
    createAnswerContributor({
      identity,
      slots: {
        followUp: { status: ANSWER_SLOT_STATUS.READY, value: "Late stale question?" },
      },
    })
  );

  assert.equal(updated, closed);
  assert.equal(updated.slots.followUp.status, ANSWER_SLOT_STATUS.LOADING);
});

test("progress contributions cannot regress within the same answer attempt", () => {
  const record = createAnswerRecord({ identity });
  const half = applyAnswerContribution(
    record,
    createAnswerContributor({
      identity,
      slots: {
        progress: { status: ANSWER_SLOT_STATUS.READY, value: { percent: 50 } },
      },
    })
  );
  const staleLower = applyAnswerContribution(
    half,
    createAnswerContributor({
      identity,
      slots: {
        progress: { status: ANSWER_SLOT_STATUS.READY, value: { percent: 20 } },
      },
    })
  );
  const higher = applyAnswerContribution(
    staleLower,
    createAnswerContributor({
      identity,
      slots: {
        progress: { status: ANSWER_SLOT_STATUS.READY, value: { percent: 100 } },
      },
    })
  );

  assert.equal(staleLower.slots.progress.value.percent, 50);
  assert.equal(higher.slots.progress.value.percent, 100);
});

test("shared harness modules do not touch DOM placement APIs", async () => {
  const fs = await import("node:fs/promises");
  const files = [
    new URL("../source/shared/core/answer-record.mjs", import.meta.url),
    new URL("../source/shared/widget/answer-presentation.mjs", import.meta.url),
  ];
  const source = (await Promise.all(files.map((file) => fs.readFile(file, "utf8")))).join("\n");

  assert.doesNotMatch(source, /\b(document|window)\b/);
  assert.doesNotMatch(source, /\b(querySelector|appendChild|insertBefore|replaceChildren)\b/);
});

test("partial failures produce visible retry or failure slots", () => {
  const retrying = createFailedAnswerPresentation({
    identity,
    failedSlot: "sources",
    retrying: true,
  });
  const failed = createFailedAnswerPresentation({
    identity,
    failedSlot: "confidence",
    message: "Judge did not return a verdict.",
  });

  assert.equal(retrying.slots.sources.status, ANSWER_SLOT_STATUS.RETRYING);
  assert.equal(retrying.slots.sources.message, "Retrying this step...");
  assert.equal(retrying.slots.errorRetry.status, ANSWER_SLOT_STATUS.RETRYING);
  assert.equal(failed.slots.confidence.status, ANSWER_SLOT_STATUS.FAILED);
  assert.equal(failed.slots.errorRetry.error, "Judge did not return a verdict.");
});
