import { sameAnswerIdentity } from "../../shared/core/answer-record.mjs";
import { createConfidenceContribution } from "../../shared/widget/answer-contributors.mjs";

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function canonicalSourcePassageIds(record) {
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

function packetPassageIds(evaluationPackage) {
  return new Set(asArray(evaluationPackage?.evidencePacket?.passageIndex)
    .map((passage) => passage?.evidencePassageId)
    .filter(Boolean));
}

function normalizedPassageMap(mapLike) {
  const map = new Map();
  if (mapLike instanceof Map) {
    for (const [key, value] of mapLike.entries()) map.set(String(key), String(value));
    return map;
  }
  if (asObject(mapLike)) {
    for (const [key, value] of Object.entries(mapLike)) map.set(String(key), String(value));
  }
  return map;
}

function referencedJudgePassageIds(report) {
  const ids = [];
  for (const assessment of asArray(report?.value?.sentenceAssessments)) {
    for (const claim of asArray(assessment?.claims)) {
      for (const ref of asArray(claim?.evidenceRefs)) {
        if (ref?.evidencePassageId) ids.push(ref.evidencePassageId);
      }
      for (const id of asArray(claim?.evidencePassageIds)) {
        if (id) ids.push(id);
      }
    }
  }
  return unique(ids);
}

function hasMatchingIdentity(identity, sealedIdentity) {
  if (!sealedIdentity) return true;
  try {
    return sameAnswerIdentity(identity, sealedIdentity);
  } catch {
    return false;
  }
}

function validLineage({
  identity,
  verdict,
  evaluationPackage,
  answerIdentity,
  evidencePassageMap,
  existingRecord,
  judgeReports,
}) {
  if (!verdict || verdict.error || verdict.lineageUnavailable) return null;
  if (verdict.status === "unavailable") return null;
  if (!asObject(evaluationPackage)) return null;
  if (!evaluationPackage.evaluationId || !evaluationPackage.evidenceHash) return null;
  if (verdict.evaluationId !== evaluationPackage.evaluationId) return null;
  if (verdict.evidenceHash !== evaluationPackage.evidenceHash) return null;
  if (!hasMatchingIdentity(identity, answerIdentity || evaluationPackage.answerIdentity)) return null;

  const knownPacketPassages = packetPassageIds(evaluationPackage);
  if (knownPacketPassages.size === 0) return null;
  const canonicalIds = new Set(canonicalSourcePassageIds(existingRecord));
  if (canonicalIds.size === 0) return null;
  const passageMap = normalizedPassageMap(evidencePassageMap || evaluationPackage.canonicalEvidencePassageMap);
  if (passageMap.size === 0) return null;

  const evaluations = [];
  for (const [index, report] of asArray(judgeReports).entries()) {
    if (!report?.ok || !report.value) continue;
    const judgePassageIds = referencedJudgePassageIds(report);
    if (judgePassageIds.length === 0) return null;
    for (const id of judgePassageIds) if (!knownPacketPassages.has(id)) return null;
    const mappedPassageIds = judgePassageIds.map((id) => passageMap.get(id));
    if (mappedPassageIds.some((id) => !id)) return null;
    const passageIds = unique(mappedPassageIds);
    for (const id of passageIds) if (!canonicalIds.has(id)) return null;
    evaluations.push({
      id: `${evaluationPackage.evaluationId}:${report.role || report.value.role || `judge-${index + 1}`}`,
      role: report.role || report.value.role || `judge-${index + 1}`,
      scores: report.value.dimensionScores || null,
      summary: report.value.summary || "",
      evaluationId: evaluationPackage.evaluationId,
      evidenceHash: evaluationPackage.evidenceHash,
      composite: confidenceScore(verdict),
      groundingStatus: verdict.groundingStatus || null,
      flaggedClaims: asArray(verdict.flaggedClaims),
      passageIds,
    });
  }
  return evaluations.length > 0 ? evaluations : null;
}

export function createAlgoliaConfidenceContribution({
  identity,
  confidence = null,
  judgeStatus = null,
  existingRecord = null,
  evaluationPackage = null,
  answerIdentity = null,
  evidencePassageMap = null,
  judgeReports = [],
} = {}) {
  const verdict = judgeStatus === "error" || confidence?.error
    ? null
    : asObject(confidence);
  const judgeEvidence = validLineage({
    identity,
    verdict,
    evaluationPackage,
    answerIdentity,
    evidencePassageMap,
    existingRecord,
    judgeReports,
  });
  const lineageUnavailable = Boolean(verdict) && judgeEvidence === null;

  return createConfidenceContribution({
    identity,
    confidence: lineageUnavailable ? null : verdict,
    judgeEvidence: judgeEvidence || [],
    lineageUnavailable,
  });
}
