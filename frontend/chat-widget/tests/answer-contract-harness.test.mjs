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
  createPostAnswerFooterState,
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

test("answer splitting follows the runtime analogy and lead-in contract", () => {
  const answer = [
    "I can certainly help you map those out. Since we do not have goals yet, this starts high-level.",
    "",
    "Measuring search is a bit like checking the health of a retail store: traffic is only useful when people find and buy.",
    "",
    "Depending on what you are trying to solve, focus on revenue, effectiveness, and operational health.",
    "",
    "## Details",
    "Conversion rate and zero-result rate usually tell the clearest story.",
  ].join("\n");

  const split = splitAnswerContent(answer);

  assert.equal(
    split.tldrAnalogy,
    "Measuring search is a bit like checking the health of a retail store: traffic is only useful when people find and buy."
  );
  assert.equal(split.tldrShort, null);
  assert.doesNotMatch(split.details, /I can certainly help/);
  assert.match(split.details, /Depending on what you are trying to solve/);
  assert.match(split.details, /Conversion rate and zero-result rate/);
  assert.doesNotMatch(split.details, /^## Details/);
});

test("unlabeled direct read stays as the normal short TLDR block only when the analogy starts the answer", () => {
  const answer = [
    "Comparing one grocery success story to another is like comparing two high-performing kitchens.",
    "",
    "If you liked the H-E-B approach, look for similar operating frictions rather than the same logo.",
    "",
    "- Albertsons: agentic shopping experiences.",
    "- Industry trends: grocery teams are reducing repeat-purchase friction.",
  ].join("\n");

  const split = splitAnswerContent(answer);

  assert.match(split.tldrAnalogy, /high-performing kitchens/);
  assert.match(split.tldrShort, /H-E-B approach/);
  assert.doesNotMatch(split.details, /H-E-B approach/);
  assert.match(split.details, /Albertsons/);
});

test("plain prose followed by non-short prose stays flat unless an analogy contract is present", () => {
  const answer = [
    "A plain opening paragraph without analogy language should not become TLDR by accident.",
    "",
    "A second plain paragraph should remain part of the flat detail body.",
    "",
    "The rest of the answer continues normally.",
  ].join("\n");

  const split = splitAnswerContent(answer);

  assert.equal(split.tldrAnalogy, null);
  assert.equal(split.tldrShort, null);
  assert.match(split.details, /plain opening paragraph/);
  assert.match(split.details, /second plain paragraph/);
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
  assert.equal(accepted.evidence.passages[0].kind, "source");
  assert.equal(accepted.evidence.passages[0].value.title, "Docs");
  assert.equal(Object.hasOwn(accepted.evidence, "sources"), false);
  assert.equal(Object.hasOwn(accepted.evidence, "judgeEvidence"), false);
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

test("footer state allows sources early but defers post-answer actions until stream completion", () => {
  const streaming = createAnswerRecord({
    identity,
    lifecycle: ANSWER_LIFECYCLE.STREAMING,
    slots: {
      sources: { status: ANSWER_SLOT_STATUS.READY, value: [{ title: "Docs" }] },
      telemetry: { status: ANSWER_SLOT_STATUS.READY, value: { inputTokens: 1234, outputTokens: 56 } },
      compareAction: { status: ANSWER_SLOT_STATUS.READY, value: { enabled: true } },
      confidence: { status: ANSWER_SLOT_STATUS.READY, value: { score: 8.2 } },
      followUp: { status: ANSWER_SLOT_STATUS.READY, value: "Which system are you replacing?" },
    },
  });
  const complete = createAnswerRecord({
    identity,
    lifecycle: ANSWER_LIFECYCLE.COMPLETE,
    slots: streaming.slots,
  });

  const streamingFooter = createPostAnswerFooterState(streaming);
  const completeFooter = createPostAnswerFooterState(complete);

  assert.equal(streamingFooter.slots.sources.status, ANSWER_SLOT_STATUS.READY);
  assert.equal(streamingFooter.slots.telemetry.status, ANSWER_SLOT_STATUS.LOADING);
  assert.equal(streamingFooter.slots.compareAction.status, ANSWER_SLOT_STATUS.LOADING);
  assert.equal(streamingFooter.slots.confidence.status, ANSWER_SLOT_STATUS.LOADING);
  assert.equal(streamingFooter.slots.followUp.status, ANSWER_SLOT_STATUS.LOADING);

  assert.equal(completeFooter.slots.sources.status, ANSWER_SLOT_STATUS.READY);
  assert.equal(completeFooter.slots.telemetry.status, ANSWER_SLOT_STATUS.READY);
  assert.equal(completeFooter.slots.compareAction.status, ANSWER_SLOT_STATUS.READY);
  assert.equal(completeFooter.slots.confidence.status, ANSWER_SLOT_STATUS.READY);
  assert.equal(completeFooter.slots.followUp.status, ANSWER_SLOT_STATUS.READY);
});

test("answer presentation exposes one ordered footer contract", () => {
  const record = createPresentationFromAnswerText({
    identity,
    text: [
      "API calls are like little door swings at a very busy store.",
      "",
      "Short version: almost every data request counts.",
      "",
      "Debounce typing and cache stable requests.",
      "",
      "Are you protecting against bots or ordinary browsing traffic?",
    ].join("\n"),
    sources: [{ title: "Docs" }],
    telemetry: { inputTokens: 42000, outputTokens: 900 },
    compareAction: { label: "Compare with Prod" },
    confidence: { score: 8.1 },
    lifecycle: ANSWER_LIFECYCLE.COMPLETE,
  });
  const presentation = toAnswerPresentation(record);

  assert.deepEqual(presentation.footer.order, [
    "sources",
    "telemetry",
    "compareAction",
    "confidence",
    "followUp",
  ]);
  assert.equal(presentation.footer.postStream, true);
  assert.equal(presentation.footer.sources.status, ANSWER_SLOT_STATUS.READY);
  assert.equal(presentation.footer.telemetry.status, ANSWER_SLOT_STATUS.READY);
  assert.equal(presentation.footer.compareAction.status, ANSWER_SLOT_STATUS.READY);
  assert.equal(presentation.footer.confidence.status, ANSWER_SLOT_STATUS.READY);
  assert.equal(presentation.footer.followUp.status, ANSWER_SLOT_STATUS.READY);
  assert.equal(presentation.details.value.includes("Are you protecting"), false);
});
