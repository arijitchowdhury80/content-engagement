import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const rendererPath = new URL("../source/shared/widget/answer-renderer.mjs", import.meta.url);
const presentationPath = new URL("../source/shared/widget/answer-presentation.mjs", import.meta.url);
const contributorsPath = new URL("../source/shared/widget/answer-contributors.mjs", import.meta.url);
const contractPath = new URL("../source/shared/presentation-contract.mjs", import.meta.url);

test("presentation contract and view-model code remain free of runtime transport concerns", () => {
  const source = [presentationPath, contributorsPath, contractPath]
    .map((file) => fs.readFileSync(file, "utf8"))
    .join("\n");

  assert.doesNotMatch(source, /\bfetch\b|agent-studio|AlgoliaJudgeCore|ACS_COMPARE|sessionStorage|localStorage/);
  assert.doesNotMatch(source, /\bquerySelector|appendChild|insertBefore|replaceChildren\b/);
});

test("shared renderer owns placement without owning Algolia presentation or transport", () => {
  const source = fs.readFileSync(rendererPath, "utf8");

  assert.match(source, /replaceChildren/);
  assert.match(source, /createElement/);
  assert.match(source, /ANSWER_FOOTER_SLOT_ORDER/);
  assert.doesNotMatch(source, /const\s+FOOTER_REGIONS/);
  assert.doesNotMatch(source, /fetch|agent-studio|AlgoliaJudgeCore|ACS_COMPARE|sessionStorage|localStorage/);
  assert.doesNotMatch(source, /className|style\.|algolia-usage-pill|acs-compare-toggle|Confidence|Sources/);
});
