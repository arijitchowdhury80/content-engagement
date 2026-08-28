import test from "node:test";
import assert from "node:assert/strict";

import {
  ANSWER_SEMANTIC_PARTS,
  ANSWER_SEMANTIC_STATES,
  assertPresentationPart,
  assertPresentationState,
} from "../source/shared/presentation-contract.mjs";

test("presentation contract names every required answer region", () => {
  assert.deepEqual(ANSWER_SEMANTIC_PARTS, [
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
});

test("presentation contract accepts slot and lifecycle states only", () => {
  for (const state of ANSWER_SEMANTIC_STATES) {
    assert.equal(assertPresentationState(state), state);
  }
  assert.throws(() => assertPresentationState("hidden"), /Unknown presentation state/);
});

test("presentation contract rejects unknown semantic parts", () => {
  assert.equal(assertPresentationPart("answer-tldr-short"), "answer-tldr-short");
  assert.throws(() => assertPresentationPart("footer-random-pill"), /Unknown presentation part/);
});
