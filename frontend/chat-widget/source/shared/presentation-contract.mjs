/** Stable semantic surface that presentation is allowed to style. */

export const PRESENTATION_CONTRACT_VERSION = 1;

export const ANSWER_SEMANTIC_PARTS = Object.freeze([
  "answer",
  "answer-tldr",
  "answer-tldr-analogy",
  "answer-tldr-short",
  "answer-details",
  "answer-footer",
  "answer-sources",
  "answer-telemetry",
  "answer-compare-action",
  "answer-confidence",
  "answer-follow-up",
  "answer-progress",
  "answer-error-retry",
]);

export const ANSWER_SEMANTIC_STATES = Object.freeze([
  "loading",
  "ready",
  "empty",
  "unavailable",
  "retrying",
  "failed",
  "searching",
  "reading",
  "synthesizing",
  "streaming",
  "judging",
  "complete",
  "superseded",
  "reset",
  "disconnected",
]);

const PARTS = new Set(ANSWER_SEMANTIC_PARTS);
const STATES = new Set(ANSWER_SEMANTIC_STATES);

export function assertPresentationPart(part) {
  if (!PARTS.has(part)) throw new TypeError(`Unknown presentation part: ${part}`);
  return part;
}

export function assertPresentationState(state) {
  if (!STATES.has(state)) throw new TypeError(`Unknown presentation state: ${state}`);
  return state;
}
