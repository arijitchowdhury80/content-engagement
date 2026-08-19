import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const chatPath = new URL("../algolia-chat.js", import.meta.url);
const engagePath = new URL("../algolia-chat-engage.js", import.meta.url);
const identifier = String.raw`[$A-Z_a-z][$\w]*`;

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function functionContaining(bundle, marker) {
  const markerIndex = bundle.indexOf(marker);
  assert.notEqual(markerIndex, -1, `bundle should contain ${marker}`);

  const start = bundle.lastIndexOf("function ", markerIndex);
  const end = bundle.indexOf("function ", markerIndex);
  assert.notEqual(start, -1, `${marker} should belong to a function`);
  assert.notEqual(end, -1, `${marker} function should have a boundary`);

  const block = bundle.slice(start, end);
  const name = block.match(/^function ([$A-Z_a-z][$\w]*)\(/)?.[1];
  assert.ok(name, `${marker} function should have a discoverable name`);
  return { block, name };
}

test("engage bridge never makes a competing Greetings Agent completion", () => {
  const source = fs.readFileSync(engagePath, "utf8");

  assert.doesNotMatch(source, /callConcierge|\/completions\?/);
  assert.doesNotMatch(source, /enableProactiveAnalysis|applyDecision/);
});

test("proactive engage opens in docked mode unless a caller explicitly overrides it", () => {
  const bundle = fs.readFileSync(chatPath, "utf8");

  assert.match(
    bundle,
    new RegExp(
      `${identifier}\\(${identifier}\\?\\.openMode\\)\\?${identifier}\\.openMode:"docked"`,
    ),
    "public engage() should validate an override and otherwise use docked mode",
  );
  assert.match(
    bundle,
    new RegExp(
      `\\.engage\\(\\{greeting:${identifier},suggestions:${identifier},openMode:${identifier}\\}\\)`,
    ),
    "public engage() should forward the selected open mode to the internal widget API",
  );
  assert.match(
    bundle,
    new RegExp(
      `engage:\\(\\{greeting:${identifier},suggestions:${identifier},openMode:${identifier}="docked"\\}\\)=>` +
        `\\{const ${identifier}=${identifier}\\.engage\\(${identifier},${identifier}\\?\\?\\[\\]\\);` +
        `return ${identifier}&&\\(${identifier}\\(${identifier}\\),${identifier}\\(\\)\\),${identifier}\\}`,
    ),
    "internal engage() should accept the greeting, apply its mode, and then open",
  );
});

test("proactive greeting uses the same transcript lane instead of a separate avatar rail", () => {
  const bundle = fs.readFileSync(chatPath, "utf8");
  const { block: greetingBlock } = functionContaining(
    bundle,
    'proactiveGreetingLabel,className:"flex w-full flex-col gap-3 pt-6 pb-4"',
  );

  assert.doesNotMatch(
    greetingBlock,
    /ml-11 flex flex-wrap gap-2/,
    "suggestion chips should not retain an avatar indent",
  );
  assert.doesNotMatch(
    greetingBlock,
    /rounded-algolia-lg rounded-tl-sm bg-algolia-surface-2/,
    "greeting should not use the legacy bubble treatment",
  );
  assert.match(
    greetingBlock,
    /className:"flex items-start gap-0"/,
    "greeting row should align to the transcript lane",
  );
  assert.match(
    greetingBlock,
    /className:"flex w-full flex-col gap-2"/,
    "greeting copy and suggestions should use the full transcript width",
  );
});

test("proactive greeting keeps normal transcript width when the window is maximized", () => {
  const bundle = fs.readFileSync(chatPath, "utf8");
  const { block: transcriptBlock } = functionContaining(
    bundle,
    "emptyStateFooter:",
  );

  assert.doesNotMatch(
    transcriptBlock,
    /w-full max-w-algolia-measure/,
    "proactive greeting should not be constrained to the narrow empty-state measure",
  );
  assert.match(
    transcriptBlock,
    /className:"flex flex-1 flex-col gap-7 overflow-y-auto px-4 py-6 sm:px-6"/,
    "proactive greeting should use the same full transcript lane as normal chat turns",
  );
});

test("sample questions stay directly above the composer from first access onward", () => {
  const bundle = fs.readFileSync(chatPath, "utf8");
  const { name: sampleQuestionsName } = functionContaining(
    bundle,
    "relative z-20 inline-flex items-center gap-1.5",
  );
  const sampleQuestionsCall = new RegExp(
    `\\.jsx\\(${escapeRegex(sampleQuestionsName)},`,
    "g",
  );
  const calls = [...bundle.matchAll(sampleQuestionsCall)];

  assert.equal(
    calls.length,
    1,
    "sample questions should render once, not separately in the welcome and composer areas",
  );

  const composerBlock = bundle.slice(calls[0].index, calls[0].index + 500);
  assert.match(
    composerBlock,
    /name:"composer"/,
    "the single sample-question trigger should share the composer footer",
  );
  assert.ok(
    composerBlock.indexOf(sampleQuestionsName) <
      composerBlock.indexOf('name:"composer"'),
    "sample-question trigger should be immediately before the composer",
  );
});
