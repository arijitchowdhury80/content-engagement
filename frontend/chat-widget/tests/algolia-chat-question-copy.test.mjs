import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const chatPath = new URL("../algolia-chat.js", import.meta.url);

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

test("question buttons copy their text before invoking the existing action", () => {
  const bundle = fs.readFileSync(chatPath, "utf8");
  const clipboardHelper = bundle.match(
    /function ([$A-Z_a-z][$\w]*)\(([$A-Z_a-z][$\w]*)\)\{const ([$A-Z_a-z][$\w]*)=\2\.trim\(\);if\(\3\)try\{if\(!navigator\.clipboard\?\.writeText\)/,
  );

  assert.ok(
    clipboardHelper,
    "built bundle should contain the shared clipboard helper",
  );
  const helperName = clipboardHelper[1];
  const helperBlock = bundle.slice(
    clipboardHelper.index,
    bundle.indexOf("function ", clipboardHelper.index + 20),
  );

  assert.match(
    helperBlock,
    /navigator\.clipboard\.writeText\([^)]+\)\.catch\(\(\)=>[$A-Z_a-z][$\w]*\([^)]+\)\)/,
    "clipboard rejection should use the fallback",
  );
  assert.match(
    bundle,
    /document\.execCommand\("copy"\)/,
    "clipboard fallback should use the browser copy command",
  );

  const copyThenAct = new RegExp(
    `onClick:\\(\\)=>\\{${escapeRegex(helperName)}\\(([$A-Z_a-z][$\\w]*)\\),([$A-Z_a-z][$\\w]*)\\(\\1\\)\\}`,
    "g",
  );
  assert.equal(
    [...bundle.matchAll(copyThenAct)].length,
    3,
    "discovery, sample-question, and proactive chips should each copy before acting",
  );
});
