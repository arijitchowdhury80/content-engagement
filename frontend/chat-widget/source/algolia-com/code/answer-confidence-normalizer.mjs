import { createConfidenceContribution } from "../../shared/widget/answer-contributors.mjs";

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

export function createAlgoliaConfidenceContribution({
  identity,
  confidence = null,
  judgeStatus = null,
} = {}) {
  const verdict = judgeStatus === "error" || confidence?.error
    ? null
    : asObject(confidence);

  return createConfidenceContribution({
    identity,
    confidence: null,
    judgeEvidence: [],
    lineageUnavailable: Boolean(verdict),
  });
}
