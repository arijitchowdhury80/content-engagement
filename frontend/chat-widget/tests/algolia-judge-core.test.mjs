import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const core = require('../algolia-judge-core.js');

const answer = 'Architecture Fit\nA Forrester study reported 213% ROI.';
const hits = [{ objectID: 'study', title: 'Forrester Total Economic Impact', description: 'The study reported a return on investment of 213%.' }];

async function evaluation() {
  return core.createEvaluationPackage({ question: 'Show the impact.', answer, hits });
}

function reportFor(evaluationPacket, overrides = {}) {
  const assessments = evaluationPacket.answerManifest.map((unit) => unit.text === 'Architecture Fit'
    ? { sentenceId: unit.sentenceId, classification: 'not_factual', claims: [] }
    : {
        sentenceId: unit.sentenceId,
        classification: 'factual',
        claims: [{
          verdict: 'supported',
          materiality: 'material',
          centralToAnswer: true,
          evidencePassageIds: [evaluationPacket.evidencePacket.passageIndex.find((item) => item.fieldPath === '/output/hits/0/description').evidencePassageId],
          reason: 'The retrieved study supports the same ROI figure.',
        }],
      });
  return {
    dimensionScores: { grounding: 10, completeness: 9, depth: 8, relevance: 10 },
    dimensionRationales: { grounding: 'All claims supported.', completeness: 'Complete.', depth: 'Detailed.', relevance: 'Direct.' },
    sentenceAssessments: assessments,
    summary: 'Grounded and useful.',
    ...overrides,
  };
}

test('builds a complete, ordered evidence packet without deduplicating hits', async () => {
  const packet = await core.createEvaluationPackage({
    question: 'q', answer: 'a.', evidenceEvents: [{
      toolCallId: 'call-1', toolName: 'algolia_search_index', input: { query: 'q', indexName: 'idx' },
      output: { hits: [{ objectID: 'same', text: 'first' }, { objectID: 'same', text: 'second' }] },
    }],
  });
  assert.equal(packet.evidencePacket.events[0].output.hits.length, 2);
  assert.equal(packet.evidencePacket.events[0].output.hits[0].text, 'first');
  assert.equal(packet.evidencePacket.events[0].output.hits[1].text, 'second');
  assert.equal(packet.evidencePacket.events[0].input.indexName, 'idx');
  assert.equal(packet.evidencePacket.passageIndex.length, 4);
  assert.doesNotMatch(JSON.stringify(packet.evidencePacket), /"passages"/);
  assert.match(packet.evidenceHash, /^[a-f0-9]{64}$/);
  assert.match(packet.answerManifest[0].sentenceId, /^J[a-f0-9]{24}-B1-S1$/);
  assert.match(packet.evidencePacket.passageIndex[0].evidencePassageId, /^J[a-f0-9]{24}-E1:/);
});

test('rejects a crossed judge response from a different question, answer, or evidence packet', async () => {
  const first = await evaluation();
  const crossed = await core.createEvaluationPackage({
    question: 'A different question.',
    answer,
    hits,
  });
  const result = core.validateJudgeReport('referee', reportFor(first), crossed);
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /unknown sentenceId|missing sentence assessment/);
});

test('treats headings as assessable non-factual units and validates semantic evidence IDs', async () => {
  const packet = await evaluation();
  const validated = core.validateJudgeReport('referee', reportFor(packet), packet);
  assert.equal(validated.ok, true, validated.errors.join('; '));
  assert.equal(validated.value.sentenceAssessments[0].classification, 'not_factual');
  assert.equal(validated.value.unresolved.length, 0);
});

test('conservatively normalizes a proofless supported claim instead of accepting or retrying it', async () => {
  const packet = await evaluation();
  const report = reportFor(packet);
  report.sentenceAssessments[1].claims[0].evidencePassageIds = [];
  const validated = core.validateJudgeReport('skeptic', report, packet);
  assert.equal(validated.ok, true, validated.errors.join('; '));
  assert.equal(validated.value.sentenceAssessments[1].claims[0].verdict, 'unverifiable');
  assert.equal(validated.value.sentenceAssessments[1].claims[0].evidenceRefs.length, 0);
  assert.equal(validated.value.unresolved.length, 1);
  assert.match(validated.value.unresolved[0].reason, /no evidence passage ID/);
});

test('derives sentence classification mechanically from claims and ignores model label variants', async () => {
  const packet = await evaluation();
  const report = reportFor(packet);
  report.sentenceAssessments[0].classification = 'heading';
  report.sentenceAssessments[1].classification = 'substantive fact';
  const validated = core.validateJudgeReport('advocate', report, packet);
  assert.equal(validated.ok, true, validated.errors.join('; '));
  assert.equal(validated.value.sentenceAssessments[0].classification, 'not_factual');
  assert.equal(validated.value.sentenceAssessments[1].classification, 'factual');
});

test('answer manifest preserves decimal claims and Markdown URLs exactly', () => {
  const text = 'The plan guarantees 99.99% growth.\n\nSee [the study](https://www.algolia.com/customers/example/).';
  const manifest = core.buildAnswerManifest(text);
  assert.deepEqual(manifest.units.map((unit) => unit.text), [
    'The plan guarantees 99.99% growth.',
    'See [the study](https://www.algolia.com/customers/example/).',
  ]);
  for (const unit of manifest.units) assert.equal(text.slice(unit.start, unit.end), unit.text);
});

test('resolves exact answer and evidence text mechanically from validated IDs', async () => {
  const packet = await core.createEvaluationPackage({
    question: 'q',
    answer: '**Architecture Fit** uses source-backed guidance.',
    hits: [{ text: 'Architecture Fit uses source-backed guidance.' }],
  });
  const passageId = packet.evidencePacket.passageIndex.find((item) => item.fieldPath === '/output/hits/0/text').evidencePassageId;
  const report = {
    dimensionScores: { grounding: 10, completeness: 9, depth: 8, relevance: 10 },
    dimensionRationales: { grounding: 'Supported.', completeness: 'Complete.', depth: 'Detailed.', relevance: 'Direct.' },
    sentenceAssessments: [{
      sentenceId: packet.answerManifest[0].sentenceId,
      classification: 'factual',
      claims: [{
        verdict: 'supported', materiality: 'minor', centralToAnswer: false,
        evidencePassageIds: [passageId], reason: 'supported',
      }],
    }],
    summary: 'Supported.',
  };
  const validated = core.validateJudgeReport('referee', report, packet);
  assert.equal(validated.ok, true);
  assert.equal(validated.value.sentenceAssessments[0].claims[0].claim, '**Architecture Fit** uses source-backed guidance.');
  assert.equal(validated.value.sentenceAssessments[0].claims[0].evidenceRefs[0].excerpt, 'Architecture Fit uses source-backed guidance.');
  assert.equal(packet.evidencePacket.passageIndex.find((item) => item.evidencePassageId === passageId).text, 'Architecture Fit uses source-backed guidance.');
});

test('rejects missing sentence coverage but leaves semantic grounding scores to the judge', async () => {
  const packet = await evaluation();
  const incomplete = reportFor(packet, { sentenceAssessments: reportFor(packet).sentenceAssessments.slice(1) });
  const result = core.validateJudgeReport('skeptic', incomplete, packet);
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /missing sentence assessment/);

  const unexplained = reportFor(packet, { dimensionScores: { grounding: 8, completeness: 9, depth: 8, relevance: 10 } });
  const unexplainedResult = core.validateJudgeReport('skeptic', unexplained, packet);
  assert.equal(unexplainedResult.ok, true, unexplainedResult.errors.join('; '));
  assert.equal(unexplainedResult.value.dimensionScores.grounding, 8);
});

test('preserves independent semantic grounding scores even when findings suggest another band', async () => {
  const packet = await evaluation();
  const tooGenerous = unresolvedReport(packet, 'skeptic', { verdict: 'contradicted', materiality: 'material', score: 9 });
  assert.equal(tooGenerous.ok, true, tooGenerous.errors.join('; '));
  assert.equal(tooGenerous.value.dimensionScores.grounding, 9);
  assert.equal(tooGenerous.value.unresolved.length, 1);
  const tooHarsh = unresolvedReport(packet, 'skeptic', { verdict: 'unverifiable', materiality: 'minor', score: 1 });
  assert.equal(tooHarsh.ok, true, tooHarsh.errors.join('; '));
  assert.equal(tooHarsh.value.dimensionScores.grounding, 1);
  assert.equal(tooHarsh.value.unresolved.length, 1);
});

test('rejects unknown and duplicate evidence passage IDs', async () => {
  const repeatedPacket = await core.createEvaluationPackage({ question: 'q', answer: 'API API is available.', hits });
  const descriptionPassageId = repeatedPacket.evidencePacket.passageIndex.find((item) => item.fieldPath === '/output/hits/0/description').evidencePassageId;
  const bad = reportFor(repeatedPacket, {
    sentenceAssessments: [{
      sentenceId: repeatedPacket.answerManifest[0].sentenceId,
      classification: 'factual',
      claims: [{
        verdict: 'supported', materiality: 'minor', centralToAnswer: false,
        evidencePassageIds: [descriptionPassageId, descriptionPassageId, 'fabricated-id'], reason: 'bad',
      }],
    }],
  });
  const result = core.validateJudgeReport('advocate', bad, repeatedPacket);
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /duplicated/);
  assert.match(result.errors.join('\n'), /unknown/);
});

function unresolvedReport(packet, role, { verdict = 'unverifiable', materiality = 'material', centralToAnswer = false, score = 6 } = {}) {
  const base = reportFor(packet);
  const factual = base.sentenceAssessments.find((item) => item.classification === 'factual');
  factual.claims = [{
    verdict, materiality, centralToAnswer,
    evidencePassageIds: verdict === 'contradicted' ? [packet.evidencePacket.passageIndex.find((item) => item.fieldPath === '/output/hits/0/description').evidencePassageId] : [],
    reason: `${role} found a grounding problem.`,
  }];
  base.dimensionScores.grounding = score;
  return core.validateJudgeReport(role, base, packet);
}

test('calculates quality in code and applies consensus grounding caps', async () => {
  const packet = await evaluation();
  const reports = [
    unresolvedReport(packet, 'skeptic', { verdict: 'contradicted', materiality: 'material', score: 3 }),
    unresolvedReport(packet, 'referee', { verdict: 'contradicted', materiality: 'material', score: 4 }),
    core.validateJudgeReport('advocate', reportFor(packet), packet),
  ];
  const result = core.aggregateJudgeReports(reports);
  assert.equal(result.qualityBase, 9);
  assert.equal(result.appliedCap, 3);
  assert.equal(result.composite, 3);
  assert.equal(result.groundingStatus, 'unsupported');
  assert.equal(result.flaggedClaims.length, 1);
});

test('never calls a dissenting three-judge panel grounded', async () => {
  const packet = await evaluation();
  const reports = [
    unresolvedReport(packet, 'skeptic', { materiality: 'minor', score: 9 }),
    core.validateJudgeReport('referee', reportFor(packet), packet),
    core.validateJudgeReport('advocate', reportFor(packet), packet),
  ];
  const result = core.aggregateJudgeReports(reports);
  assert.equal(result.groundingStatus, 'disagreement');
  assert.equal(result.appliedCap, null);
  assert.notEqual(result.groundingStatus, 'grounded');
});

test('does not manufacture consensus from different claims in the same sentence', async () => {
  const packet = await core.createEvaluationPackage({
    question: 'What is supported?',
    answer: 'InstantSearch supports React, and the plan guarantees unlimited requests.',
    hits: [{ text: 'InstantSearch supports React implementations.' }],
  });
  const sentenceId = packet.answerManifest[0].sentenceId;
  const passageId = packet.evidencePacket.passageIndex.find((item) => item.fieldPath === '/output/hits/0/text').evidencePassageId;
  const makeReport = (role, unsupportedIndex) => core.validateJudgeReport(role, {
    dimensionScores: { grounding: unsupportedIndex === null ? 10 : 8, completeness: 9, depth: 8, relevance: 10 },
    dimensionRationales: { grounding: 'Claim assessment.', completeness: 'Complete.', depth: 'Detailed.', relevance: 'Direct.' },
    sentenceAssessments: [{
      sentenceId,
      classification: 'factual',
      claims: [0, 1].map((claimIndex) => ({
        verdict: claimIndex === unsupportedIndex ? 'unverifiable' : 'supported',
        materiality: 'minor',
        centralToAnswer: false,
        evidencePassageIds: claimIndex === unsupportedIndex ? [] : [passageId],
        reason: claimIndex === unsupportedIndex ? 'Not verified.' : 'Supported.',
      })),
    }],
    summary: 'Two separate claims assessed.',
  }, packet);
  const result = core.aggregateJudgeReports([
    makeReport('skeptic', 0),
    makeReport('referee', 1),
    makeReport('advocate', null),
  ]);
  assert.equal(result.flaggedClaims.length, 0);
  assert.equal(result.disagreements.length, 2);
  assert.deepEqual(result.disagreements.map((finding) => finding.claimIndex), [0, 1]);
  assert.equal(result.appliedCap, null);
  assert.equal(result.groundingStatus, 'disagreement');
});

test('treats different claim counts for one sentence as disagreement', async () => {
  const packet = await core.createEvaluationPackage({
    question: 'What is supported?',
    answer: 'InstantSearch supports React, and the plan guarantees unlimited requests.',
    hits: [{ text: 'InstantSearch supports React implementations.' }],
  });
  const sentenceId = packet.answerManifest[0].sentenceId;
  const makeReport = (role, claimCount) => core.validateJudgeReport(role, {
    dimensionScores: { grounding: 8, completeness: 9, depth: 8, relevance: 10 },
    dimensionRationales: { grounding: 'One concern.', completeness: 'Complete.', depth: 'Detailed.', relevance: 'Direct.' },
    sentenceAssessments: [{
      sentenceId,
      classification: 'factual',
      claims: Array.from({ length: claimCount }, () => ({
        verdict: 'unverifiable', materiality: 'minor', centralToAnswer: false,
        evidencePassageIds: [], reason: 'Not verified.',
      })),
    }],
    summary: 'Claim segmentation differs.',
  }, packet);
  const result = core.aggregateJudgeReports([
    makeReport('skeptic', 1),
    makeReport('referee', 2),
    core.validateJudgeReport('advocate', {
      dimensionScores: { grounding: 10, completeness: 9, depth: 8, relevance: 10 },
      dimensionRationales: { grounding: 'Supported.', completeness: 'Complete.', depth: 'Detailed.', relevance: 'Direct.' },
      sentenceAssessments: [{ sentenceId, classification: 'not_factual', claims: [] }],
      summary: 'No concern.',
    }, packet),
  ]);
  assert.equal(result.flaggedClaims.length, 0);
  assert.equal(result.appliedCap, null);
  assert.equal(result.groundingStatus, 'disagreement');
});

test('a single centrality vote cannot impose a consensus grounding cap', async () => {
  const packet = await evaluation();
  const reports = [
    unresolvedReport(packet, 'skeptic', { verdict: 'contradicted', materiality: 'critical', centralToAnswer: true, score: 1 }),
    unresolvedReport(packet, 'referee', { verdict: 'contradicted', materiality: 'minor', centralToAnswer: false, score: 6 }),
    core.validateJudgeReport('advocate', reportFor(packet), packet),
  ];
  const result = core.aggregateJudgeReports(reports);
  assert.equal(result.flaggedClaims.length, 1);
  assert.equal(result.flaggedClaims[0].centralToAnswer, false);
  assert.equal(result.appliedCap, 6);
});

test('two valid judges produce a provisional result and fewer than two are unavailable', async () => {
  const packet = await evaluation();
  const valid = ['skeptic', 'referee'].map((role) => core.validateJudgeReport(role, reportFor(packet), packet));
  const provisional = core.aggregateJudgeReports(valid);
  assert.equal(provisional.status, 'provisional');
  assert.equal(provisional.provisional, true);
  assert.notEqual(provisional.groundingStatus, 'grounded');

  const unavailable = core.aggregateJudgeReports(valid.slice(0, 1));
  assert.equal(unavailable.status, 'unavailable');
  assert.equal(unavailable.composite, null);
});

test('requires exactly three distinct role agents and rejects a Chief', () => {
  assert.equal(core.validateJudgeAgents([
    { role: 'skeptic', id: 's' }, { role: 'referee', id: 'r' }, { role: 'advocate', id: 'a' },
  ]).ok, true);
  const bad = core.validateJudgeAgents([{ id: 'chief' }, { role: 'skeptic', id: 'same' }, { role: 'referee', id: 'same' }]);
  assert.equal(bad.ok, false);
  assert.match(bad.errors.join('\n'), /chief\/default|missing judge role|distinct/);
});

test('fails capacity preflight without changing the evidence packet', async () => {
  const packet = await core.createEvaluationPackage(
    { question: 'q', answer: 'a.', hits: [{ text: 'x'.repeat(10_000) }] },
    { maxInputTokens: 100, outputReserveTokens: 20 },
  );
  assert.equal(packet.capacity.fits, false);
  assert.equal(packet.evidencePacket.events[0].output.hits[0].text.length, 10_000);
});

test('evaluation identity is deterministic and changes with question, answer, or evidence', async () => {
  const base = { question: 'What is the ROI?', answer: 'The study reported 213% ROI.', hits };
  const first = await core.createEvaluationPackage(base);
  const same = await core.createEvaluationPackage(base);
  const changedQuestion = await core.createEvaluationPackage({ ...base, question: 'What did the study report?' });
  const changedAnswer = await core.createEvaluationPackage({ ...base, answer: 'The study reported ROI.' });
  const changedEvidence = await core.createEvaluationPackage({ ...base, hits: [{ ...hits[0], title: 'Different title' }] });
  assert.equal(first.evaluationId, same.evaluationId);
  assert.notEqual(first.evaluationId, changedQuestion.evaluationId);
  assert.notEqual(first.evaluationId, changedAnswer.evaluationId);
  assert.notEqual(first.evaluationId, changedEvidence.evaluationId);
});
