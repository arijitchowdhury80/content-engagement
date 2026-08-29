import { canonicalEvidencePassageId } from "../../shared/core/answer-record.mjs";
import { createConfidenceContribution } from "../../shared/widget/answer-contributors.mjs";

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function sourcePassageId(source, index) {
  const value = asObject(source) || {};
  const origin = typeof value.origin === "string" && value.origin.trim()
    ? value.origin.trim()
    : "retrieval";
  return canonicalEvidencePassageId({
    kind: "source",
    origin,
    sequence: index,
    value: source,
    id: value.evidencePassageId || value.passageId,
  });
}

function sourcePassageIdsFromSources(sources) {
  return asArray(sources)
    .map(sourcePassageId)
    .filter(Boolean);
}

function sourcePassageIdsFromRecord(record) {
  return asArray(record?.evidence?.passages)
    .filter((passage) => passage?.kind === "source")
    .map((passage) => passage.id)
    .filter(Boolean);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function confidenceScore(confidence) {
  return confidence?.composite ??
    confidence?.score ??
    confidence?.synthesizedScore ??
    null;
}

function confidenceEvaluations(confidence, passageIds) {
  const verdict = asObject(confidence);
  if (!verdict || passageIds.length === 0) return [];
  const judges = asArray(verdict.perJudge).length
    ? verdict.perJudge
    : [{ role: "panel", scores: verdict.dims, summary: verdict.rationale }];

  return judges.map((judge, index) => ({
    role: judge?.role || `judge-${index + 1}`,
    scores: judge?.scores || judge?.dimensionScores || null,
    summary: judge?.summary || judge?.note || verdict.rationale || "",
    composite: confidenceScore(verdict),
    groundingStatus: verdict.groundingStatus || null,
    flaggedClaims: asArray(verdict.flaggedClaims),
    passageIds,
  }));
}

export function createAlgoliaConfidenceContribution({
  identity,
  confidence = null,
  judgeStatus = null,
  sources = [],
  existingRecord = null,
} = {}) {
  const verdict = judgeStatus === "error" || confidence?.error
    ? null
    : asObject(confidence);
  const passageIds = unique([
    ...sourcePassageIdsFromRecord(existingRecord),
    ...sourcePassageIdsFromSources(sources),
  ]);
  const lineageUnavailable = Boolean(verdict) && passageIds.length === 0;

  return createConfidenceContribution({
    identity,
    confidence: verdict,
    judgeEvidence: confidenceEvaluations(verdict, passageIds),
    lineageUnavailable,
  });
}
