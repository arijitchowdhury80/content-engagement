import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const widgetRoot = new URL("../", import.meta.url);

const FOOTER_DOM_PATTERNS = [
  "data-algolia-answer-footer",
  "ensureAnswerFooter",
  "algolia-usage-pill",
  "acs-compare-toggle",
];

const COMPATIBILITY_OWNERS = new Set([
  "handoff-to-orchestrator.js",
  "algolia-chat-compare.js",
]);
const PRESENTATION_CLASS_OWNERS = new Set([
  "algolia-chat-theme-algolia.js",
]);

function walkFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (
        entry.name === "tests" ||
        entry.name === "source" ||
        entry.name === "patches" ||
        entry.name === "dist" ||
        entry.name === "node_modules"
      ) return [];
      return walkFiles(absolute);
    }
    return entry.isFile() && entry.name.endsWith(".js") ? [absolute] : [];
  });
}

test("footer DOM ownership is limited to the known compatibility bridge during migration", () => {
  const files = walkFiles(widgetRoot.pathname);
  const matches = [];

  for (const file of files) {
    const source = fs.readFileSync(file, "utf8");
    const matchedPatterns = FOOTER_DOM_PATTERNS.filter((pattern) => source.includes(pattern));
    if (matchedPatterns.length === 0) continue;
    matches.push({
      file: path.relative(widgetRoot.pathname, file),
      matchedPatterns,
    });
  }

  const domOwners = matches
    .filter((match) => !(
      PRESENTATION_CLASS_OWNERS.has(match.file) &&
      match.matchedPatterns.length === 1 &&
      match.matchedPatterns[0] === "algolia-usage-pill"
    ))
    .map((match) => match.file)
    .sort();

  assert.deepEqual(
    domOwners,
    [...COMPATIBILITY_OWNERS].sort(),
    `Only the temporary compatibility bridge may touch answer footer DOM: ${JSON.stringify(matches)}`
  );
});

test("shared answer harness remains DOM-free", () => {
  const files = [
    new URL("../source/shared/core/answer-record.mjs", import.meta.url),
    new URL("../source/shared/widget/answer-contributors.mjs", import.meta.url),
    new URL("../source/shared/widget/answer-presentation.mjs", import.meta.url),
  ];
  const source = files.map((file) => fs.readFileSync(file, "utf8")).join("\n");

  assert.doesNotMatch(source, /\b(document|window)\b/);
  assert.doesNotMatch(source, /\b(querySelector|appendChild|insertBefore|replaceChildren)\b/);
  assert.doesNotMatch(source, /data-algolia-answer-footer|algolia-usage-pill|acs-compare-toggle/);
});

test("telemetry pill presentation stays in the Algolia theme, not the handoff bridge", () => {
  const handoffSource = fs.readFileSync(new URL("../handoff-to-orchestrator.js", import.meta.url), "utf8");
  const themeSource = fs.readFileSync(new URL("../algolia-chat-theme-algolia.js", import.meta.url), "utf8");

  assert.match(handoffSource, /algolia-usage-pill/);
  assert.doesNotMatch(handoffSource, /TELEMETRY_PILL_CSS|algolia-usage-pill-style/);
  assert.doesNotMatch(handoffSource, /box-shadow:\s*0 12px|linear-gradient\(135deg|font-family:\s*var\(--algolia-font-sans\)/);
  assert.match(themeSource, /\.algolia-usage-pill \{/);
  assert.match(themeSource, /\.algolia-usage-pill__in/);
  assert.match(themeSource, /\.algolia-usage-pill__out/);
});
