import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const widgetRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = path.join(widgetRoot, 'source');

function filesUnder(root) {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(root, entry.name);
    return entry.isDirectory() ? filesUnder(absolute) : [absolute];
  });
}

function sourceText(root) {
  return filesUnder(root)
    .filter((file) => /\.(?:[cm]?[jt]sx?|css)$/.test(file))
    .map((file) => fs.readFileSync(file, 'utf8'))
    .join('\n');
}

test('public source contains no excluded third-party brand material', () => {
  const excludedTerms = [
    ['Ad', 'obe'].join(''),
    ['Spec', 'trum'].join(''),
    ['React', 'Spec', 'trum'].join(''),
    ['Spec', 'trum', 'Two'].join(''),
  ];
  assert.equal(excludedTerms.some((term) => sourceText(sourceRoot).includes(term)), false);
});

test('shared source never imports Algolia-owned implementation source', () => {
  const sharedFiles = filesUnder(path.join(sourceRoot, 'shared'))
    .filter((file) => /\.(?:[cm]?[jt]sx?)$/.test(file));

  for (const file of sharedFiles) {
    assert.doesNotMatch(
      fs.readFileSync(file, 'utf8'),
      /(?:from\s+|import\s*)['"][^'"]*algolia-com\//,
      `${path.relative(widgetRoot, file)} imports Algolia-owned code`,
    );
  }
});

test('shared source contains no Algolia runtime, judge, visitor, or proactive mechanisms', () => {
  const shared = sourceText(path.join(sourceRoot, 'shared'));
  assert.doesNotMatch(
    shared,
    /agent-studio|Agent Studio|ask_specialist|proactiveStore|visitorContextStore|useJudge|JudgeVerdict|compareAction|answer-compare-action/i,
  );
});

test('Algolia presentation source cannot own runtime mechanisms', () => {
  const presentation = sourceText(path.join(sourceRoot, 'algolia-com', 'presentation'));
  assert.doesNotMatch(
    presentation,
    /\bfetch\s*\(|XMLHttpRequest|localStorage|sessionStorage|ACS_COMPARE|algolia_search_index|navigator\.clipboard|\.ask\s*\(|sourcePresentationSignature|normalizeSourcePresentationValue|createAlgoliaSourceGroups/,
  );
});

test('Algolia presentation source cannot normalize answer data or own host actions', () => {
  const presentation = sourceText(path.join(sourceRoot, 'algolia-com', 'presentation'));
  assert.doesNotMatch(
    presentation,
    /navigator\.clipboard|\.ask\s*\(|sourcePresentationSignature|normalizeSourcePresentationValue|createAlgoliaSourceGroups|configureAlgoliaAnswerFooterLayout/,
  );
});

test('customer build has one explicit source entry', () => {
  const config = fs.readFileSync(path.join(widgetRoot, 'vite.config.ts'), 'utf8');
  const entry = fs.readFileSync(path.join(sourceRoot, 'algolia-com', 'entry.ts'), 'utf8');

  assert.match(config, /source\/algolia-com\/entry\.ts/);
  assert.match(entry, /web-component\/chat-embed/);
  assert.doesNotMatch(config, /glob|readdir|fast-glob/);
  assert.match(
    entry,
    /code\/install-answer-runtime\.mjs/,
    'the customer entry must install the canonical answer runtime',
  );
  const installer = fs.readFileSync(
    path.join(sourceRoot, 'algolia-com', 'code', 'install-answer-runtime.mjs'),
    'utf8',
  );
  assert.match(installer, /web-component\/answer-runtime-bridge\.mjs/);
  assert.doesNotMatch(installer, /\.\.\/\.\.\/\.\.\/answer-harness-runtime\.mjs/);
});

test('legacy answer harness filename is only a compatibility loader', () => {
  const compatibility = fs.readFileSync(path.join(widgetRoot, 'answer-harness-runtime.mjs'), 'utf8');
  assert.match(compatibility, /source\/algolia-com\/web-component\/answer-runtime-bridge\.mjs/);
  assert.doesNotMatch(compatibility, /createLocalFooterBridge|createAnswerHarnessObserver/);
});

test('relocated Algolia behavior and presentation begin byte-identical to compatibility inputs', () => {
  const copies = {
    'source/algolia-com/code/engagement-tracker.js': 'algolia-engagement-tracker.js',
    'source/algolia-com/code/context-compiler.js': 'algolia-context-compiler.js',
    'source/algolia-com/code/proactive-controller.js': 'algolia-proactive-controller.js',
    'source/algolia-com/code/handoff-to-orchestrator.js': 'handoff-to-orchestrator.js',
    'source/algolia-com/code/chat-engage.js': 'algolia-chat-engage.js',
    'source/algolia-com/code/chat-form-tool.js': 'algolia-chat-form-tool.js',
    'source/algolia-com/code/judge-core.js': 'algolia-judge-core.js',
    'source/algolia-com/code/chat-compare.js': 'algolia-chat-compare.js',
    'source/algolia-com/code/token-telemetry.js': 'token-telemetry.js',
    'source/algolia-com/presentation/theme-algolia.js': 'algolia-chat-theme-algolia.js',
    'source/algolia-com/presentation/confidence-badge.js': 'algolia-confidence-badge.js',
  };

  for (const [sourcePath, compatibilityPath] of Object.entries(copies)) {
    assert.equal(
      fs.readFileSync(path.join(widgetRoot, sourcePath), 'utf8'),
      fs.readFileSync(path.join(widgetRoot, compatibilityPath), 'utf8'),
      `${sourcePath} drifted during source relocation`,
    );
  }
});
