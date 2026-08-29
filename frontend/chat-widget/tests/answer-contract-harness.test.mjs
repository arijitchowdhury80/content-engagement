import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
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
  createAnswerContentContribution,
  createConfidenceContribution,
  createProgressContribution,
  createSourcesContribution,
} from "../source/shared/widget/answer-contributors.mjs";
import {
  applyAnswerContribution,
  ANSWER_CONTRIBUTOR_KIND,
  createAnswerContributor,
  createFailedAnswerPresentation,
  createPostAnswerFooterState,
  createPresentationFromAnswerText,
  toAnswerPresentation,
} from "../source/shared/widget/answer-presentation.mjs";
import {
  normalizeAlgoliaAnswerContent,
} from "../source/algolia-com/code/answer-content-normalizer.mjs";
import {
  createAlgoliaConfidenceContribution,
} from "../source/algolia-com/code/answer-confidence-normalizer.mjs";

const require = createRequire(import.meta.url);
const judgeCore = require("../algolia-judge-core.js");

const identity = Object.freeze({
  widgetInstanceId: "widget-1",
  conversationId: "conversation-1",
  answerSegmentId: "answer-1",
  networkAttemptId: "attempt-1",
});

const lineageAnswer = "Marketing teams can tune Rules.";
const lineageHits = Object.freeze([
  {
    objectID: "visual-editor",
    title: "Visual Editor",
    description: "Marketing teams can tune Rules without writing code.",
  },
]);

function judgeReportFor(evaluationPackage, role, evidencePassageId) {
  const rawReport = {
    dimensionScores: { grounding: 9, completeness: 8, depth: 8, relevance: 9 },
    dimensionRationales: {
      grounding: "The claim is supported by the cited passage.",
      completeness: "The answer covers the requested capability.",
      depth: "The answer is concise but sufficient.",
      relevance: "The answer addresses the question directly.",
    },
    sentenceAssessments: evaluationPackage.answerManifest.map((unit) => ({
      sentenceId: unit.sentenceId,
      classification: "factual",
      nonFactualSpans: [],
      claims: [{
        claimText: unit.text,
        verdict: "supported",
        materiality: "material",
        centralToAnswer: true,
        evidencePassageIds: [evidencePassageId],
        reason: "The cited passage supports this sentence.",
      }],
    })),
    summary: `${role} report is grounded.`,
  };
  const validated = judgeCore.validateJudgeReport(role, rawReport, evaluationPackage);
  assert.equal(validated.ok, true, validated.errors.join("; "));
  return validated;
}

async function sealedLineageFixture() {
  const evaluationPackage = await judgeCore.createEvaluationPackage({
    question: "Can marketers tune search?",
    answer: lineageAnswer,
    hits: lineageHits,
  });
  evaluationPackage.answerIdentity = identity;
  const evidencePassageId = evaluationPackage.evidencePacket.passageIndex.find((passage) =>
    passage.fieldPath === "/output/hits/0/description"
  ).evidencePassageId;
  const skeptic = judgeReportFor(evaluationPackage, "skeptic", evidencePassageId);
  const referee = judgeReportFor(evaluationPackage, "referee", evidencePassageId);
  const advocate = judgeReportFor(evaluationPackage, "advocate", evidencePassageId);
  const confidence = {
    ...judgeCore.aggregateJudgeReports([skeptic, referee, advocate]),
    evaluationId: evaluationPackage.evaluationId,
    evidenceHash: evaluationPackage.evidenceHash,
  };
  return { evaluationPackage, evidencePassageId, reports: { skeptic, referee, advocate }, confidence };
}

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

  const split = normalizeAlgoliaAnswerContent(answer);

  assert.equal(split.tldrAnalogy, "API calls are like little door swings at a very busy store.");
  assert.equal(split.tldrShort, "Short version: almost every data request counts as a billable search request.");
  assert.equal(split.details, "Debounce typing, cache stable requests, and protect shared traffic with rate limits.");
  assert.equal(split.followUp, "Are you protecting against bots or normal browsing costs?");
  assert.equal(split.details.includes(split.followUp), false);
});

test("content contributor accepts an explicitly extracted follow-up fact", () => {
  const contribution = createAnswerContentContribution({
    identity,
    tldrAnalogy: "Answer handling is like a filing cabinet: the useful label belongs outside the folder.",
    tldrShort: "Short version: keep the answer body separate from the next question.",
    details: "The details should remain flat and readable.",
    followUp: "Which part should we inspect next?",
  });

  assert.equal(contribution.slots.followUp.status, ANSWER_SLOT_STATUS.READY);
  assert.equal(contribution.slots.followUp.value, "Which part should we inspect next?");
  assert.equal(contribution.slots.details.value.includes("Which part should we inspect next?"), false);
});


test("heading-first or one-paragraph answers do not force a fake TLDR split", () => {
  const headingFirst = normalizeAlgoliaAnswerContent("# Quick take\n\nThis should remain detail content.");
  assert.equal(headingFirst.tldrAnalogy, null);
  assert.equal(headingFirst.tldrShort, null);
  assert.match(headingFirst.details, /# Quick take/);

  const oneParagraph = normalizeAlgoliaAnswerContent("Only one paragraph is available.");
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

  const split = normalizeAlgoliaAnswerContent(answer);

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

  const split = normalizeAlgoliaAnswerContent(answer);

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

  const split = normalizeAlgoliaAnswerContent(answer);

  assert.equal(split.tldrAnalogy, null);
  assert.equal(split.tldrShort, null);
  assert.match(split.details, /plain opening paragraph/);
  assert.match(split.details, /second plain paragraph/);
});

test("presentation records missing sources and judge as unavailable instead of invisible", () => {
  const record = createPresentationFromAnswerText({
    identity,
    text: "Analogy canvas.\n\nShort version: answer.\n\nDetails body.",
    content: {
      tldrAnalogy: "Analogy canvas.",
      tldrShort: "Short version: answer.",
      details: "Details body.",
      followUp: null,
    },
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
    createSourcesContribution({
      identity,
      sources: [{ title: "Docs" }],
    })
  );
  const rejected = applyAnswerContribution(
    accepted,
    createSourcesContribution({
      identity: { ...identity, networkAttemptId: "attempt-2" },
      sources: [{ title: "Wrong attempt" }],
    })
  );

  assert.equal(accepted.slots.sources.value[0].title, "Docs");
  assert.equal(accepted.slots.sources.value[0].evidencePassageId, "source:retrieval:0:docs");
  assert.equal(accepted.evidence.passages[0].kind, "source");
  assert.equal(accepted.evidence.passages[0].id, "source:retrieval:0:docs");
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
      kind: ANSWER_CONTRIBUTOR_KIND.CONTENT,
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
    createProgressContribution({
      identity,
      percent: 50,
    })
  );
  const staleLower = applyAnswerContribution(
    half,
    createProgressContribution({
      identity,
      percent: 20,
    })
  );
  const higher = applyAnswerContribution(
    staleLower,
    createProgressContribution({
      identity,
      percent: 100,
    })
  );

  assert.equal(staleLower.slots.progress.value.percent, 50);
  assert.equal(higher.slots.progress.value.percent, 100);
});

test("only lifecycle-owning contributors can change answer lifecycle", () => {
  const record = createAnswerRecord({ identity });
  const contentLifecycleAttempt = applyAnswerContribution(
    record,
    createAnswerContributor({
      kind: ANSWER_CONTRIBUTOR_KIND.CONTENT,
      identity,
      lifecycle: ANSWER_LIFECYCLE.COMPLETE,
      slots: {
        details: { status: ANSWER_SLOT_STATUS.READY, value: "Answer text landed." },
      },
    })
  );
  const sourceLifecycleAttempt = applyAnswerContribution(
    contentLifecycleAttempt,
    createAnswerContributor({
      kind: ANSWER_CONTRIBUTOR_KIND.SOURCES,
      identity,
      lifecycle: ANSWER_LIFECYCLE.COMPLETE,
      slots: {
        sources: { status: ANSWER_SLOT_STATUS.READY, value: [{ title: "Docs" }] },
      },
    })
  );
  const telemetryLifecycleAttempt = applyAnswerContribution(
    sourceLifecycleAttempt,
    createAnswerContributor({
      kind: ANSWER_CONTRIBUTOR_KIND.TELEMETRY,
      identity,
      lifecycle: ANSWER_LIFECYCLE.COMPLETE,
      slots: {
        telemetry: { status: ANSWER_SLOT_STATUS.READY, value: { inputTokens: 1000, outputTokens: 250 } },
      },
    })
  );
  const confidenceLifecycleAttempt = applyAnswerContribution(
    telemetryLifecycleAttempt,
    createAnswerContributor({
      kind: ANSWER_CONTRIBUTOR_KIND.CONFIDENCE,
      identity,
      lifecycle: ANSWER_LIFECYCLE.COMPLETE,
      slots: {
        confidence: { status: ANSWER_SLOT_STATUS.READY, value: { score: 8.2 } },
      },
    })
  );
  const actionLifecycleAttempt = applyAnswerContribution(
    confidenceLifecycleAttempt,
    createAnswerContributor({
      kind: ANSWER_CONTRIBUTOR_KIND.OPAQUE_ACTION,
      identity,
      lifecycle: ANSWER_LIFECYCLE.COMPLETE,
      slots: {
        compareAction: { status: ANSWER_SLOT_STATUS.READY, value: { label: "Compare with Prod" } },
      },
    })
  );
  const progressLifecycle = applyAnswerContribution(
    actionLifecycleAttempt,
    createProgressContribution({
      identity,
      percent: 100,
      lifecycle: ANSWER_LIFECYCLE.JUDGING,
    })
  );
  const explicitLifecycle = applyAnswerContribution(
    progressLifecycle,
    createAnswerContributor({
      kind: ANSWER_CONTRIBUTOR_KIND.LIFECYCLE,
      identity,
      lifecycle: ANSWER_LIFECYCLE.COMPLETE,
    })
  );

  assert.equal(contentLifecycleAttempt.lifecycle, ANSWER_LIFECYCLE.SEARCHING);
  assert.equal(sourceLifecycleAttempt.lifecycle, ANSWER_LIFECYCLE.SEARCHING);
  assert.equal(telemetryLifecycleAttempt.lifecycle, ANSWER_LIFECYCLE.SEARCHING);
  assert.equal(confidenceLifecycleAttempt.lifecycle, ANSWER_LIFECYCLE.SEARCHING);
  assert.equal(actionLifecycleAttempt.lifecycle, ANSWER_LIFECYCLE.SEARCHING);
  assert.equal(progressLifecycle.lifecycle, ANSWER_LIFECYCLE.JUDGING);
  assert.equal(explicitLifecycle.lifecycle, ANSWER_LIFECYCLE.COMPLETE);
});

test("confidence evaluations must reference existing canonical source passages", () => {
  const withSource = applyAnswerContribution(
    createAnswerRecord({ identity }),
    createSourcesContribution({
      identity,
      sources: [{ title: "Docs", url: "https://example.com/docs" }],
    })
  );
  const withConfidence = applyAnswerContribution(
    withSource,
    createConfidenceContribution({
      identity,
      confidence: { score: 8.1 },
      judgeEvidence: [
        {
          role: "factuality",
          passageIds: ["source:retrieval:0:https-example-com-docs"],
        },
        {
          role: "unsupported",
          passageIds: ["source:retrieval:99:missing"],
        },
        {
          role: "unanchored",
          passageIds: [],
        },
      ],
    })
  );
  const noSourceRecord = applyAnswerContribution(
    createAnswerRecord({ identity: { ...identity, networkAttemptId: "attempt-no-sources" } }),
    createConfidenceContribution({
      identity: { ...identity, networkAttemptId: "attempt-no-sources" },
      confidence: { score: 7.4 },
      judgeEvidence: [{ role: "unmatched", passageIds: ["source:retrieval:0:docs"] }],
    })
  );

  assert.equal(withConfidence.slots.confidence.status, ANSWER_SLOT_STATUS.READY);
  assert.equal(withConfidence.evidence.evaluations.length, 1);
  assert.equal(withConfidence.evidence.evaluations[0].role, "factuality");
  assert.deepEqual(
    withConfidence.evidence.evaluations[0].passageIds,
    ["source:retrieval:0:https-example-com-docs"]
  );
  assert.equal(noSourceRecord.slots.confidence.status, ANSWER_SLOT_STATUS.READY);
  assert.deepEqual(noSourceRecord.evidence.evaluations, []);
});

test("confidence mirror can explicitly mark missing evidence lineage unavailable", () => {
  const record = applyAnswerContribution(
    createAnswerRecord({ identity }),
    createConfidenceContribution({
      identity,
      confidence: { score: 8.1 },
      judgeEvidence: [],
      lineageUnavailable: true,
    })
  );

  assert.equal(record.slots.confidence.status, ANSWER_SLOT_STATUS.UNAVAILABLE);
  assert.match(record.slots.confidence.message, /lineage unavailable/i);
  assert.deepEqual(record.evidence.evaluations, []);
});

test("Algolia confidence contribution fails closed without sealed judge lineage", () => {
  const withSource = applyAnswerContribution(
    createAnswerRecord({ identity }),
    createSourcesContribution({
      identity,
      sources: [{ title: "Docs", url: "https://example.com/docs" }],
    })
  );
  const withConfidence = applyAnswerContribution(
    withSource,
    createAlgoliaConfidenceContribution({
      identity,
      existingRecord: withSource,
      confidence: {
        composite: 8.4,
        evaluationId: "judge-display-only",
        evidenceHash: "display-only",
        groundingStatus: "supported",
        perJudge: [
          { role: "skeptic", scores: { grounding: 8 }, summary: "Grounded." },
          { role: "referee", scores: { grounding: 9 }, summary: "Consistent." },
        ],
      },
    })
  );

  assert.equal(withConfidence.slots.confidence.status, ANSWER_SLOT_STATUS.UNAVAILABLE);
  assert.equal(withConfidence.evidence.passages.length, 1);
  assert.equal(withConfidence.evidence.evaluations.length, 0);
});

test("Algolia confidence contribution stays unavailable until trusted judge lineage exists", async () => {
  const { evaluationPackage, evidencePassageId, reports, confidence } = await sealedLineageFixture();
  const withSource = applyAnswerContribution(
    createAnswerRecord({ identity }),
    createSourcesContribution({
      identity,
      sources: [
        { objectID: "visual-editor", title: "Visual Editor" },
        { objectID: "extra-source", title: "Extra source not used by judges" },
      ],
    })
  );
  const withConfidence = applyAnswerContribution(
    withSource,
    createAlgoliaConfidenceContribution({
      identity,
      existingRecord: withSource,
      confidence,
      evaluationPackage,
      answerIdentity: identity,
      evidencePassageMap: {
        [evidencePassageId]: "source:retrieval:0:visual-editor",
      },
      judgeReports: [reports.skeptic, reports.referee, reports.advocate],
    })
  );

  assert.equal(withConfidence.slots.confidence.status, ANSWER_SLOT_STATUS.UNAVAILABLE);
  assert.equal(withConfidence.evidence.passages.length, 2);
  assert.equal(withConfidence.evidence.evaluations.length, 0);
});

test("Algolia confidence contribution rejects hash, identity, failed-role, and mapping mismatches", async () => {
  const { evaluationPackage, evidencePassageId, reports, confidence } = await sealedLineageFixture();
  const withSource = applyAnswerContribution(
    createAnswerRecord({ identity }),
    createSourcesContribution({
      identity,
      sources: [{ objectID: "visual-editor", title: "Visual Editor" }],
    })
  );
  const base = {
    identity,
    existingRecord: withSource,
    evaluationPackage,
    answerIdentity: identity,
    evidencePassageMap: { [evidencePassageId]: "source:retrieval:0:visual-editor" },
  };
  const hashMismatch = applyAnswerContribution(
    withSource,
    createAlgoliaConfidenceContribution({
      ...base,
      confidence: { ...confidence, evidenceHash: "wrong-hash" },
      judgeReports: [reports.skeptic, reports.referee],
    })
  );
  const staleIdentity = applyAnswerContribution(
    withSource,
    createAlgoliaConfidenceContribution({
      ...base,
      confidence,
      answerIdentity: { ...identity, answerSegmentId: "stale-answer" },
      judgeReports: [reports.skeptic, reports.referee],
    })
  );
  const unrelatedMapping = applyAnswerContribution(
    withSource,
    createAlgoliaConfidenceContribution({
      ...base,
      confidence,
      evidencePassageMap: { [evidencePassageId]: "source:retrieval:1:extra-source" },
      judgeReports: [reports.skeptic, reports.referee],
    })
  );
  const withFailedRole = applyAnswerContribution(
    withSource,
    createAlgoliaConfidenceContribution({
      ...base,
      confidence: {
        ...judgeCore.aggregateJudgeReports([
          reports.skeptic,
          reports.referee,
          { ok: false, role: "advocate", errors: ["failed"] },
        ]),
        evaluationId: evaluationPackage.evaluationId,
        evidenceHash: evaluationPackage.evidenceHash,
      },
      judgeReports: [
        reports.skeptic,
        reports.referee,
        { ok: false, role: "advocate", errors: ["failed"] },
      ],
    })
  );

  assert.equal(hashMismatch.slots.confidence.status, ANSWER_SLOT_STATUS.UNAVAILABLE);
  assert.equal(staleIdentity.slots.confidence.status, ANSWER_SLOT_STATUS.UNAVAILABLE);
  assert.equal(unrelatedMapping.slots.confidence.status, ANSWER_SLOT_STATUS.UNAVAILABLE);
  assert.equal(withFailedRole.slots.confidence.status, ANSWER_SLOT_STATUS.UNAVAILABLE);
  assert.deepEqual(withFailedRole.evidence.evaluations, []);
});

test("Algolia confidence contribution rejects fabricated judge lineage and missing sealed identity", async () => {
  const { evaluationPackage, evidencePassageId, reports, confidence } = await sealedLineageFixture();
  const withSource = applyAnswerContribution(
    createAnswerRecord({ identity }),
    createSourcesContribution({
      identity,
      sources: [{ objectID: "visual-editor", title: "Visual Editor" }],
    })
  );
  const explicitMap = { [evidencePassageId]: "source:retrieval:0:visual-editor" };
  const fabricatedPackage = JSON.parse(JSON.stringify(evaluationPackage));
  const withoutSealedIdentity = { ...evaluationPackage };
  delete withoutSealedIdentity.answerIdentity;
  const otherIdentity = { ...identity, widgetInstanceId: "widget-2" };
  const wrongRecord = applyAnswerContribution(
    createAnswerRecord({ identity: otherIdentity }),
    createSourcesContribution({
      identity: otherIdentity,
      sources: [{ objectID: "visual-editor", title: "Visual Editor" }],
    })
  );

  const fabricated = applyAnswerContribution(
    withSource,
    createAlgoliaConfidenceContribution({
      identity,
      existingRecord: withSource,
      confidence,
      evaluationPackage: fabricatedPackage,
      answerIdentity: identity,
      evidencePassageMap: explicitMap,
      judgeReports: [reports.skeptic, reports.referee],
    })
  );
  const missingIdentity = applyAnswerContribution(
    withSource,
    createAlgoliaConfidenceContribution({
      identity,
      existingRecord: withSource,
      confidence,
      evaluationPackage: withoutSealedIdentity,
      evidencePassageMap: explicitMap,
      judgeReports: [reports.skeptic, reports.referee],
    })
  );
  const wrongExistingRecord = applyAnswerContribution(
    withSource,
    createAlgoliaConfidenceContribution({
      identity,
      existingRecord: wrongRecord,
      confidence,
      evaluationPackage,
      answerIdentity: identity,
      evidencePassageMap: explicitMap,
      judgeReports: [reports.skeptic, reports.referee],
    })
  );

  assert.equal(fabricated.slots.confidence.status, ANSWER_SLOT_STATUS.UNAVAILABLE);
  assert.equal(missingIdentity.slots.confidence.status, ANSWER_SLOT_STATUS.UNAVAILABLE);
  assert.equal(wrongExistingRecord.slots.confidence.status, ANSWER_SLOT_STATUS.UNAVAILABLE);
});

test("Algolia confidence contribution rejects a genuine judge package relabeled to another answer", async () => {
  const answerA = await judgeCore.createEvaluationPackage({
    question: "Question A?",
    answer: "Answer A.",
    hits: [{ objectID: "visual-editor", title: "Visual Editor", description: "Evidence for answer A only." }],
  });
  const answerAPassageId = answerA.evidencePacket.passageIndex.find((passage) =>
    passage.fieldPath === "/output/hits/0/description"
  ).evidencePassageId;
  const reports = [
    judgeReportFor(answerA, "skeptic", answerAPassageId),
    judgeReportFor(answerA, "referee", answerAPassageId),
    judgeReportFor(answerA, "advocate", answerAPassageId),
  ];
  const confidence = {
    ...judgeCore.aggregateJudgeReports(reports),
    evaluationId: answerA.evaluationId,
    evidenceHash: answerA.evidenceHash,
  };
  const answerBIdentity = {
    widgetInstanceId: "widget-b",
    conversationId: "conversation-b",
    answerSegmentId: "answer-b",
    networkAttemptId: "attempt-b",
  };
  answerA.answerIdentity = answerBIdentity;
  const answerBRecord = applyAnswerContribution(
    createAnswerRecord({ identity: answerBIdentity }),
    createSourcesContribution({
      identity: answerBIdentity,
      sources: [{ objectID: "visual-editor", title: "Visual Editor" }],
    })
  );
  const relabeled = applyAnswerContribution(
    answerBRecord,
    createAlgoliaConfidenceContribution({
      identity: answerBIdentity,
      existingRecord: answerBRecord,
      confidence,
      evaluationPackage: answerA,
      answerIdentity: answerBIdentity,
      evidencePassageMap: { [answerAPassageId]: "source:retrieval:0:visual-editor" },
      judgeReports: reports,
    })
  );

  assert.equal(relabeled.slots.confidence.status, ANSWER_SLOT_STATUS.UNAVAILABLE);
  assert.deepEqual(relabeled.evidence.evaluations, []);
});

test("Algolia confidence contribution rejects role and aggregate inconsistencies", async () => {
  const { evaluationPackage, evidencePassageId, reports, confidence } = await sealedLineageFixture();
  const withSource = applyAnswerContribution(
    createAnswerRecord({ identity }),
    createSourcesContribution({
      identity,
      sources: [{ objectID: "visual-editor", title: "Visual Editor" }],
    })
  );
  const base = {
    identity,
    existingRecord: withSource,
    evaluationPackage,
    answerIdentity: identity,
    evidencePassageMap: { [evidencePassageId]: "source:retrieval:0:visual-editor" },
  };
  const twoReportConfidence = {
    ...judgeCore.aggregateJudgeReports([reports.skeptic, reports.referee]),
    evaluationId: evaluationPackage.evaluationId,
    evidenceHash: evaluationPackage.evidenceHash,
  };
  const unknownRole = {
    ok: true,
    role: "attacker",
    errors: [],
    value: { ...reports.skeptic.value, role: "attacker" },
  };
  const cases = [
    createAlgoliaConfidenceContribution({
      ...base,
      confidence: {
        ...judgeCore.aggregateJudgeReports([reports.skeptic]),
        evaluationId: evaluationPackage.evaluationId,
        evidenceHash: evaluationPackage.evidenceHash,
      },
      judgeReports: [reports.skeptic],
    }),
    createAlgoliaConfidenceContribution({
      ...base,
      confidence,
      judgeReports: [reports.skeptic, reports.skeptic, reports.referee],
    }),
    createAlgoliaConfidenceContribution({
      ...base,
      confidence: {
        ...judgeCore.aggregateJudgeReports([unknownRole, reports.referee]),
        evaluationId: evaluationPackage.evaluationId,
        evidenceHash: evaluationPackage.evidenceHash,
      },
      judgeReports: [unknownRole, reports.referee],
    }),
    createAlgoliaConfidenceContribution({
      ...base,
      confidence: { ...twoReportConfidence, status: "complete", provisional: false },
      judgeReports: [reports.skeptic, reports.referee],
    }),
    createAlgoliaConfidenceContribution({
      ...base,
      confidence: { ...confidence, status: "provisional", provisional: true },
      judgeReports: [reports.skeptic, reports.referee, reports.advocate],
    }),
    createAlgoliaConfidenceContribution({
      ...base,
      confidence: { ...twoReportConfidence, composite: twoReportConfidence.composite + 1 },
      judgeReports: [reports.skeptic, reports.referee],
    }),
  ].map((contribution) => applyAnswerContribution(withSource, contribution));

  for (const record of cases) {
    assert.equal(record.slots.confidence.status, ANSWER_SLOT_STATUS.UNAVAILABLE);
    assert.deepEqual(record.evidence.evaluations, []);
  }
});

test("reducer enforces contributor slot and evidence capabilities", () => {
  const record = createAnswerRecord({ identity });
  const rogue = applyAnswerContribution(
    record,
    createAnswerContributor({
      kind: ANSWER_CONTRIBUTOR_KIND.TELEMETRY,
      identity,
      slots: {
        telemetry: { status: ANSWER_SLOT_STATUS.READY, value: { inputTokens: 1000 } },
        sources: { status: ANSWER_SLOT_STATUS.READY, value: [{ title: "Should not land" }] },
        followUp: { status: ANSWER_SLOT_STATUS.READY, value: "Should not land?" },
      },
      evidence: {
        passages: [{ kind: "source", value: { title: "Should not land" } }],
        evaluations: [{ kind: "judge", passageIds: ["source:retrieval:0:docs"] }],
      },
    })
  );

  assert.equal(rogue.slots.telemetry.status, ANSWER_SLOT_STATUS.READY);
  assert.equal(rogue.slots.sources.status, ANSWER_SLOT_STATUS.LOADING);
  assert.equal(rogue.slots.followUp.status, ANSWER_SLOT_STATUS.LOADING);
  assert.deepEqual(rogue.evidence.passages, []);
  assert.deepEqual(rogue.evidence.evaluations, []);
});

test("canonical evidence dedupes sources and keeps judge evaluations as references", () => {
  const source = createSourcesContribution({
    identity,
    sources: [{ title: "Docs", url: "https://example.com/docs" }],
  });
  const duplicateSource = createSourcesContribution({
    identity,
    sources: [{ title: "Docs", url: "https://example.com/docs" }],
  });
  const judged = createAnswerContributor({
    kind: ANSWER_CONTRIBUTOR_KIND.CONFIDENCE,
    identity,
    slots: {
      confidence: { status: ANSWER_SLOT_STATUS.READY, value: { score: 8.1 } },
    },
    evidence: {
      evaluations: [{
        role: "factuality",
        passageIds: ["source:retrieval:0:https-example-com-docs"],
      }],
    },
  });

  const withSource = applyAnswerContribution(createAnswerRecord({ identity }), source);
  const withDuplicate = applyAnswerContribution(withSource, duplicateSource);
  const withJudgment = applyAnswerContribution(withDuplicate, judged);

  assert.equal(withJudgment.evidence.passages.length, 1);
  assert.equal(withJudgment.evidence.passages[0].id, "source:retrieval:0:https-example-com-docs");
  assert.equal(withJudgment.evidence.evaluations.length, 1);
  assert.deepEqual(withJudgment.evidence.evaluations[0].passageIds, ["source:retrieval:0:https-example-com-docs"]);
  assert.equal(withJudgment.evidence.evaluations[0].kind, "judge");
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
    content: normalizeAlgoliaAnswerContent([
      "API calls are like little door swings at a very busy store.",
      "",
      "Short version: almost every data request counts.",
      "",
      "Debounce typing and cache stable requests.",
      "",
      "Are you protecting against bots or ordinary browsing traffic?",
    ].join("\n")),
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
