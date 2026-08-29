import { sameAnswerIdentity } from "../../shared/core/answer-record.mjs";
import { createConfidenceContribution } from "../../shared/widget/answer-contributors.mjs";

const ALLOWED_JUDGE_ROLES = Object.freeze(["skeptic", "referee", "advocate"]);
const DIMENSIONS = Object.freeze(["grounding", "completeness", "depth", "relevance"]);

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

function round1(value) {
  return Math.round(value * 10) / 10;
}

function mean(values) {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0;
}

function sameNumber(left, right) {
  return Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) < 0.001;
}

function packetPassages(evaluationPackage) {
  return asArray(evaluationPackage?.evidencePacket?.passages);
}

function packetPassageMap(evaluationPackage) {
  const passages = packetPassages(evaluationPackage);
  const index = asArray(evaluationPackage?.evidencePacket?.passageIndex);
  const byId = new Map(passages.map((passage) => [passage?.evidencePassageId, passage]));
  const result = new Map();
  for (const item of index) {
    const passage = byId.get(item?.evidencePassageId);
    if (!passage) return null;
    for (const key of ["eventId", "fieldPath", "text"]) {
      if (passage[key] !== item[key]) return null;
    }
    result.set(item.evidencePassageId, passage);
  }
  return result.size ? result : null;
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

function bindingFromSealedIds(evaluationPackage) {
  const ids = [
    ...asArray(evaluationPackage?.answerManifest).map((unit) => unit?.sentenceId),
    ...packetPassages(evaluationPackage).map((passage) => passage?.evidencePassageId),
  ].filter(Boolean);
  if (!ids.length) return null;
  let binding = null;
  for (const id of ids) {
    const match = String(id).match(/^J([0-9a-f]{24})-/i);
    if (!match) return null;
    if (binding && binding !== match[1]) return null;
    binding = match[1];
  }
  return binding;
}

function hasJudgeCoreBoundPackage(evaluationPackage) {
  if (!asObject(evaluationPackage)) return false;
  if (evaluationPackage.contractVersion !== "algolia-judge-v3.3") return false;
  if (!/^[a-f0-9]{64}$/i.test(String(evaluationPackage.evidenceHash || ""))) return false;
  const evaluationMatch = String(evaluationPackage.evaluationId || "")
    .match(/^judge-([a-f0-9]{8})-([a-f0-9]{8})-([a-f0-9]{8})$/i);
  if (!evaluationMatch) return false;
  const binding = bindingFromSealedIds(evaluationPackage);
  if (!binding) return false;
  if (binding !== `${evaluationMatch[1]}${evaluationMatch[2]}${evaluationMatch[3]}`) return false;
  if (!String(evaluationPackage.evidenceHash).startsWith(evaluationMatch[3])) return false;
  const passagesDescriptor = Object.getOwnPropertyDescriptor(evaluationPackage.evidencePacket || {}, "passages");
  if (!passagesDescriptor || passagesDescriptor.enumerable !== false) return false;
  if (!packetPassageMap(evaluationPackage)) return false;
  return true;
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

function hasMatchingIdentity(identity, sealedIdentity, existingRecord) {
  if (!sealedIdentity || !existingRecord?.identity) return false;
  try {
    return sameAnswerIdentity(identity, existingRecord.identity) &&
      sameAnswerIdentity(identity, sealedIdentity);
  } catch {
    return false;
  }
}

function sourceStableKey(value) {
  const source = asObject(value) || {};
  return source.objectID || source.objectId || source.id || source.url || source.href || source.title || null;
}

function hitAtFieldPath(evaluationPackage, passage) {
  const match = String(passage?.fieldPath || "").match(/^\/output\/hits\/(\d+)(?:\/|$)/);
  if (!match) return { index: null, hit: null };
  const event = asArray(evaluationPackage?.evidencePacket?.events)
    .find((candidate) => candidate?.eventId === passage.eventId);
  const index = Number(match[1]);
  const hit = asArray(event?.output?.hits)[index] || null;
  return { index, hit };
}

function derivePassageToCanonicalMap(evaluationPackage, existingRecord) {
  const packetMap = packetPassageMap(evaluationPackage);
  if (!packetMap) return null;
  const canonicalSources = asArray(existingRecord?.evidence?.passages)
    .filter((passage) => passage?.kind === "source");
  if (!canonicalSources.length) return null;
  const bySequence = new Map(canonicalSources.map((passage) => [passage.sequence, passage]));
  const map = new Map();
  for (const [judgePassageId, passage] of packetMap.entries()) {
    const { index, hit } = hitAtFieldPath(evaluationPackage, passage);
    if (!Number.isInteger(index)) continue;
    const canonical = bySequence.get(index);
    if (!canonical) continue;
    const hitKey = sourceStableKey(hit);
    const canonicalKey = sourceStableKey(canonical.value);
    if (hitKey && canonicalKey && String(hitKey) !== String(canonicalKey)) continue;
    map.set(judgePassageId, canonical.id);
  }
  return map.size ? map : null;
}

function validateCallerPassageMap(callerMap, derivedMap, referencedIds) {
  const supplied = normalizedPassageMap(callerMap);
  if (supplied.size === 0) return true;
  for (const id of referencedIds) {
    if (supplied.get(id) !== derivedMap.get(id)) return false;
  }
  return true;
}

function validReports(judgeReports) {
  const roles = new Set();
  const reports = [];
  for (const report of asArray(judgeReports)) {
    if (!report?.ok || !report.value) continue;
    const role = report.role || report.value.role;
    if (!ALLOWED_JUDGE_ROLES.includes(role)) return null;
    if (report.value.role !== role) return null;
    if (roles.has(role)) return null;
    roles.add(role);
    reports.push(report);
  }
  if (reports.length < 2 || reports.length > 3) return null;
  return reports;
}

function expectedVerdictFromReports(reports) {
  const dims = Object.fromEntries(DIMENSIONS.map((dimension) => [
    dimension,
    round1(mean(reports.map((report) => report.value.dimensionScores?.[dimension]))),
  ]));
  return {
    validJudgeCount: reports.length,
    expectedJudgeCount: 3,
    provisional: reports.length === 2,
    status: reports.length === 2 ? "provisional" : "complete",
    composite: round1(mean(DIMENSIONS.map((dimension) => dims[dimension]))),
    dims,
    roles: reports.map((report) => report.role || report.value.role),
  };
}

function verdictMatchesReports(verdict, reports) {
  const expected = expectedVerdictFromReports(reports);
  if (verdict.validJudgeCount !== expected.validJudgeCount) return false;
  if (verdict.expectedJudgeCount !== expected.expectedJudgeCount) return false;
  if (Boolean(verdict.provisional) !== expected.provisional) return false;
  if (verdict.status !== expected.status) return false;
  if (!sameNumber(confidenceScore(verdict), expected.composite)) return false;
  for (const dimension of DIMENSIONS) {
    if (!sameNumber(verdict.dims?.[dimension], expected.dims[dimension])) return false;
  }
  const verdictRoles = asArray(verdict.perJudge).map((judge) => judge?.role).filter(Boolean);
  if (verdictRoles.length !== expected.roles.length) return false;
  return expected.roles.every((role) => verdictRoles.includes(role));
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
  if (!hasJudgeCoreBoundPackage(evaluationPackage)) return null;
  if (!evaluationPackage.evaluationId || !evaluationPackage.evidenceHash) return null;
  if (verdict.evaluationId !== evaluationPackage.evaluationId) return null;
  if (verdict.evidenceHash !== evaluationPackage.evidenceHash) return null;
  if (!hasMatchingIdentity(identity, answerIdentity || evaluationPackage.answerIdentity, existingRecord)) return null;

  const canonicalIds = new Set(canonicalSourcePassageIds(existingRecord));
  if (canonicalIds.size === 0) return null;
  const passageMap = derivePassageToCanonicalMap(evaluationPackage, existingRecord);
  if (!passageMap) return null;
  const reports = validReports(judgeReports);
  if (!reports || !verdictMatchesReports(verdict, reports)) return null;

  const evaluations = [];
  for (const [index, report] of reports.entries()) {
    const judgePassageIds = referencedJudgePassageIds(report);
    if (judgePassageIds.length === 0) return null;
    if (!validateCallerPassageMap(evidencePassageMap || evaluationPackage.canonicalEvidencePassageMap, passageMap, judgePassageIds)) return null;
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
