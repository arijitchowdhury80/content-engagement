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
    ? { sentenceId: unit.sentenceId, classification: 'non_factual', nonFactualSpans: [unit.text], claims: [] }
    : {
        sentenceId: unit.sentenceId,
        classification: 'factual',
        nonFactualSpans: [],
        claims: [{
          claimText: unit.text,
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
  assert.equal(validated.value.sentenceAssessments[0].classification, 'non_factual');
  assert.equal(validated.value.unresolved.length, 0);
});

test('rejects a proofless supported claim so transport retries instead of manufacturing an unverifiable finding', async () => {
  const packet = await evaluation();
  const report = reportFor(packet);
  report.sentenceAssessments[1].claims[0].evidencePassageIds = [];
  const validated = core.validateJudgeReport('skeptic', report, packet);
  assert.equal(validated.ok, false);
  assert.equal(validated.value, null);
  assert.match(validated.errors.join('; '), /supported claim requires evidencePassageIds/);
});

test('rejects malformed claims instead of treating them as a non-factual sentence', async () => {
  const packet = await evaluation();
  const report = reportFor(packet);
  report.sentenceAssessments[1].claims = { verdict: 'supported' };
  const validated = core.validateJudgeReport('referee', report, packet);
  assert.equal(validated.ok, false);
  assert.equal(validated.value, null);
  assert.match(validated.errors.join('; '), /claims must be an array/);
});

test('requires the judge semantic classification instead of inferring it from claims', async () => {
  const packet = await evaluation();
  const report = reportFor(packet);
  report.sentenceAssessments[0].classification = 'heading';
  const validated = core.validateJudgeReport('advocate', report, packet);
  assert.equal(validated.ok, false);
  assert.match(validated.errors.join('; '), /classification must be factual, mixed, or non_factual/);
});

test('reconciles sentence labels mechanically from the judge semantic partitions', async () => {
  const packet = await evaluation();
  const nonFactualWithClaim = reportFor(packet);
  nonFactualWithClaim.sentenceAssessments[1].classification = 'non_factual';
  nonFactualWithClaim.sentenceAssessments[1].nonFactualSpans = [packet.answerManifest[1].text];
  const first = core.validateJudgeReport('skeptic', nonFactualWithClaim, packet);
  assert.equal(first.ok, true, first.errors.join('; '));
  assert.equal(first.value.sentenceAssessments[1].classification, 'non_factual');
  assert.equal(first.value.sentenceAssessments[1].claims.length, 0);

  const factualWithoutClaim = reportFor(packet);
  factualWithoutClaim.sentenceAssessments[1].claims = [];
  const second = core.validateJudgeReport('referee', factualWithoutClaim, packet);
  assert.equal(second.ok, false);
  assert.match(second.errors.join('; '), /must declare at least one factual claim or non-factual span/);
});

test('preserves an explicit non-factual decision when the model omits its copied span array', async () => {
  const packet = await evaluation();
  const report = reportFor(packet);
  delete report.sentenceAssessments[0].nonFactualSpans;
  const validated = core.validateJudgeReport('advocate', report, packet);
  assert.equal(validated.ok, true, validated.errors.join('; '));
  assert.equal(validated.value.sentenceAssessments[0].classification, 'non_factual');
  assert.deepEqual(validated.value.sentenceAssessments[0].nonFactualSpans, [{
    text: 'Architecture Fit', start: 0, end: 'Architecture Fit'.length,
  }]);
});

test('accepts a mixed unit only when factual claims and non-factual spans are disjoint', async () => {
  const packet = await core.createEvaluationPackage({
    question: 'What does Analytics report?',
    answer: 'Analytics is like a map; it reports no-result searches.',
    hits: [{ text: 'Analytics reports searches that return no results.' }],
  });
  const unit = packet.answerManifest[0];
  const passageId = packet.evidencePacket.passageIndex.find((item) => item.fieldPath === '/output/hits/0/text').evidencePassageId;
  const report = {
    dimensionScores: { grounding: 10, completeness: 9, depth: 8, relevance: 10 },
    dimensionRationales: { grounding: 'Supported.', completeness: 'Complete.', depth: 'Detailed.', relevance: 'Direct.' },
    sentenceAssessments: [{
      sentenceId: unit.sentenceId,
      classification: 'mixed',
      nonFactualSpans: ['Analytics is like a map'],
      claims: [{
        claimText: 'it reports no-result searches', verdict: 'supported', materiality: 'material', centralToAnswer: true,
        evidencePassageIds: [passageId], reason: 'The passage supports the literal product statement.',
      }],
    }],
    summary: 'The analogy is excluded from grounding.',
  };
  assert.equal(core.validateJudgeReport('referee', report, packet).ok, true);

  report.sentenceAssessments[0].claims[0].claimText = 'Analytics is like a map';
  const reconciled = core.validateJudgeReport('referee', report, packet);
  assert.equal(reconciled.ok, true, reconciled.errors.join('; '));
  assert.equal(reconciled.value.sentenceAssessments[0].classification, 'non_factual');
  assert.equal(reconciled.value.sentenceAssessments[0].claims.length, 0);
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

test('answer manifest does not split a sentence after non-terminal abbreviations', () => {
  const text = 'Compare iOS vs. Android behavior. For example, e.g. mobile traffic can differ.';
  const manifest = core.buildAnswerManifest(text);
  assert.deepEqual(manifest.units.map((unit) => unit.text), [
    'Compare iOS vs. Android behavior.',
    'For example, e.g. mobile traffic can differ.',
  ]);
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
        claimText: 'uses source-backed guidance',
        verdict: 'supported', materiality: 'minor', centralToAnswer: false,
        evidencePassageIds: [passageId], reason: 'supported',
      }],
    }],
    summary: 'Supported.',
  };
  const validated = core.validateJudgeReport('referee', report, packet);
  assert.equal(validated.ok, true);
  assert.equal(validated.value.sentenceAssessments[0].claims[0].claim, 'uses source-backed guidance');
  assert.equal(validated.value.sentenceAssessments[0].claims[0].start, packet.answer.indexOf('uses source-backed guidance'));
  assert.equal(validated.value.sentenceAssessments[0].claims[0].end, packet.answer.indexOf('uses source-backed guidance') + 'uses source-backed guidance'.length);
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
        claimText: repeatedPacket.answerManifest[0].text,
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
    claimText: factual.claims[0].claimText,
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
        claimText: claimIndex === 0 ? 'InstantSearch supports React' : 'the plan guarantees unlimited requests',
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

test('uses the exact span for consensus even when judges enumerate claims differently', async () => {
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
      claims: claimCount === 1 ? [{
        claimText: 'the plan guarantees unlimited requests',
        verdict: 'unverifiable', materiality: 'minor', centralToAnswer: false,
        evidencePassageIds: [], reason: 'Not verified.',
      }] : [{
        claimText: 'InstantSearch supports React',
        verdict: 'supported', materiality: 'minor', centralToAnswer: false,
        evidencePassageIds: [packet.evidencePacket.passageIndex.find((item) => item.fieldPath === '/output/hits/0/text').evidencePassageId],
        reason: 'Supported.',
      }, {
        claimText: 'the plan guarantees unlimited requests',
        verdict: 'unverifiable', materiality: 'minor', centralToAnswer: false,
        evidencePassageIds: [], reason: 'Not verified.',
      }],
    }],
    summary: 'Claim segmentation differs.',
  }, packet);
  const result = core.aggregateJudgeReports([
    makeReport('skeptic', 1),
    makeReport('referee', 2),
    core.validateJudgeReport('advocate', {
      dimensionScores: { grounding: 10, completeness: 9, depth: 8, relevance: 10 },
      dimensionRationales: { grounding: 'Supported.', completeness: 'Complete.', depth: 'Detailed.', relevance: 'Direct.' },
      sentenceAssessments: [{ sentenceId, classification: 'non_factual', nonFactualSpans: [packet.answerManifest[0].text], claims: [] }],
      summary: 'No concern.',
    }, packet),
  ]);
  assert.equal(result.flaggedClaims.length, 1);
  assert.equal(result.flaggedClaims[0].claim, 'the plan guarantees unlimited requests');
  assert.equal(result.appliedCap, null);
  assert.equal(result.groundingStatus, 'needs_review');
});

test('does not manufacture consensus from spans that share only a conjunction', async () => {
  const packet = await core.createEvaluationPackage({
    question: 'What is supported?',
    answer: 'Alpha is supported and beta is unsupported.',
    hits: [{ text: 'Alpha is supported.' }],
  });
  const sentenceId = packet.answerManifest[0].sentenceId;
  const makeReport = (role, claimText) => core.validateJudgeReport(role, {
    dimensionScores: { grounding: 6, completeness: 9, depth: 8, relevance: 10 },
    dimensionRationales: { grounding: 'One concern.', completeness: 'Complete.', depth: 'Detailed.', relevance: 'Direct.' },
    sentenceAssessments: [{ sentenceId, classification: 'factual', claims: [{
      claimText, verdict: 'unverifiable', materiality: 'material', centralToAnswer: false,
      evidencePassageIds: [], reason: 'Not verified.',
    }] }],
    summary: 'One concern.',
  }, packet);
  const result = core.aggregateJudgeReports([
    makeReport('skeptic', 'Alpha is supported and'),
    makeReport('referee', 'and beta is unsupported'),
    core.validateJudgeReport('advocate', {
      dimensionScores: { grounding: 10, completeness: 9, depth: 8, relevance: 10 },
      dimensionRationales: { grounding: 'Supported.', completeness: 'Complete.', depth: 'Detailed.', relevance: 'Direct.' },
      sentenceAssessments: [{ sentenceId, classification: 'non_factual', nonFactualSpans: [packet.answerManifest[0].text], claims: [] }],
      summary: 'No concern.',
    }, packet),
  ]);
  assert.equal(result.flaggedClaims.length, 0);
  assert.equal(result.disagreements.length, 2);
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

test('rejects paraphrased claimText and resolves repeated exact claims left to right', async () => {
  const packet = await core.createEvaluationPackage({
    question: 'What is repeated?',
    answer: 'API access is available, and API access is available.',
    hits: [{ text: 'API access is available.' }],
  });
  const sentenceId = packet.answerManifest[0].sentenceId;
  const passageId = packet.evidencePacket.passageIndex.find((item) => item.fieldPath === '/output/hits/0/text').evidencePassageId;
  const base = {
    dimensionScores: { grounding: 10, completeness: 10, depth: 8, relevance: 10 },
    dimensionRationales: { grounding: 'Supported.', completeness: 'Complete.', depth: 'Detailed.', relevance: 'Direct.' },
    sentenceAssessments: [{ sentenceId, classification: 'factual', claims: [0, 1].map(() => ({
      claimText: 'API access is available', verdict: 'supported', materiality: 'minor', centralToAnswer: false,
      evidencePassageIds: [passageId], reason: 'Supported.',
    })) }],
    summary: 'Supported.',
  };
  const valid = core.validateJudgeReport('referee', base, packet);
  assert.equal(valid.ok, true, valid.errors.join('; '));
  assert.deepEqual(valid.value.sentenceAssessments[0].claims.map((claim) => claim.start), [0, 29]);

  const paraphrased = structuredClone(base);
  paraphrased.sentenceAssessments[0].claims[0].claimText = 'The API can be accessed';
  const invalid = core.validateJudgeReport('referee', paraphrased, packet);
  assert.equal(invalid.ok, false);
  assert.match(invalid.errors.join('; '), /not an exact substring/);
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
