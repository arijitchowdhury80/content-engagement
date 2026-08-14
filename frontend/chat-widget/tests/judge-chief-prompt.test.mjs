import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

function readBundle(name) {
  return readFileSync(resolve(__dirname, '..', name), 'utf8');
}

function roleJudgeChiefPromptBranch(bundle) {
  const start = bundle.indexOf('Use your consult_skeptic, consult_referee, and consult_advocate tools');
  assert.notEqual(start, -1, 'chief role-judge prompt branch should exist');

  const end = bundle.indexOf(';const', start);
  assert.notEqual(end, -1, 'chief role-judge prompt branch should have a clear return boundary');

  return bundle.slice(start, end);
}

for (const bundleName of ['algolia-chat.js', 'algolia-chat-jahia-20260812-wip.js']) {
  test(`${bundleName} includes retrieved sources in chief judge prompt when role judges are enabled`, () => {
    const branch = roleJudgeChiefPromptBranch(readBundle(bundleName));

    assert.match(branch, /QUESTION:/);
    assert.match(branch, /ANSWER:/);
    assert.match(branch, /SOURCES:/);
    assert.match(branch, /JSON\.stringify\([^)]*\.sources\)/);
  });

  test(`${bundleName} highlights unsupported answer spans without blocking the answer`, () => {
    const bundle = readBundle(bundleName);
    const rendererName = bundleName.includes('jahia') ? 'hE' : 't1';
    const visibleTextGate = bundleName.includes('jahia')
      ? 'R=x?e.text:""'
      : 'R=S?t.text:""';
    const rendererStart = bundle.indexOf(`function ${rendererName}(`);
    assert.notEqual(rendererStart, -1, 'assistant message renderer should exist');

    const nextFunction = bundle.indexOf('function ', rendererStart + 20);
    assert.notEqual(nextFunction, -1, 'assistant renderer should have a clear boundary');
    const renderer = bundle.slice(rendererStart, nextFunction);

    assert.doesNotMatch(bundle, /I cannot verify this answer against the retrieved sources/);
    assert.doesNotMatch(bundle, /function acShouldBlockAnswer/);
    assert.match(bundle, /function acHighlightUnsupported/);
    assert.match(bundle, /text-algolia-negative/);
    assert.match(bundle, /not verified against the retrieved sources/);
    assert.match(bundle, /unsupportedTerms/);
    assert.ok(renderer.includes(visibleTextGate), 'successful answer should remain visible');
    assert.match(renderer, /unsupportedTerms:/);
    assert.doesNotMatch(renderer, /acUnsupportedAnswerMessage/);
    assert.match(renderer, /text:[te]\.text/);
    assert.match(renderer, /name:"thinking"/);
    assert.doesNotMatch(renderer, /&&!\s*R\)&&w\.jsx\([^,]+,\{name:"thinking"/);
  });

  test(`${bundleName} defines markdown cleanup regexes used by the answer renderer`, () => {
    const bundle = readBundle(bundleName);
    const usesCleanupRegexes = /\.replace\(pS,""\)\.replace\(mS,""\)/.test(bundle);

    if (!usesCleanupRegexes) return;

    assert.match(bundle, /(?:const|let|var|function) pS\b/);
    assert.match(bundle, /\bmS\s*=/);
    assert.match(bundle, /DISCOVERY_STATE/);
  });

  test(`${bundleName} defines markdown parser regexes used by the answer renderer`, () => {
    const bundle = readBundle(bundleName);
    const parserSymbols = ['ig', 'rS', 'tS', 'rg', 'ng'];

    for (const symbol of parserSymbols) {
      const usage = new RegExp(`\\b${symbol}\\.(?:exec|test)\\(`);
      if (!usage.test(bundle)) continue;

      const declaration = new RegExp(`(?:const|let|var|function)\\s+${symbol}\\b|\\b${symbol}\\s*=`);
      assert.match(bundle, declaration, `${symbol} should be declared before renderer usage`);
    }
  });

  test(`${bundleName} preserves streamed answer text when final post-processing yields empty text`, () => {
    const bundle = readBundle(bundleName);

    assert.match(bundle, /acLastVisibleAnswer/);
    assert.match(bundle, /acFinalAnswerText/);
    assert.match(bundle, /final answer text was empty after post-processing/);
    assert.match(bundle, /No answer text returned by the agent/);
  });

  test(`${bundleName} preserves non-empty answer text when a late agent error is attached`, () => {
    const bundle = readBundle(bundleName);

    assert.match(bundle, /late agent error arrived after answer text/);
    assert.match(bundle, /late specialist error arrived after answer text/);
  });

  test(`${bundleName} shows an observable processing trace while building an answer`, () => {
    const bundle = readBundle(bundleName);
    const rendererName = bundleName.includes('jahia') ? 'hE' : 't1';
    const rendererStart = bundle.indexOf(`function ${rendererName}(`);
    assert.notEqual(rendererStart, -1, 'assistant message renderer should exist');

    const nextFunction = bundle.indexOf('function ', rendererStart + 20);
    assert.notEqual(nextFunction, -1, 'assistant renderer should have a clear boundary');
    const renderer = bundle.slice(rendererStart, nextFunction);

    assert.match(bundle, /Searching/);
    assert.match(bundle, /Reading retrieved sources/);
    assert.match(bundle, /Synthesizing evidence/);
    assert.match(bundle, /Composing grounded answer/);
    assert.match(bundle, /Writing answer/);
    assert.match(bundle, /acProcessingTrace/);
    assert.doesNotMatch(bundle, /acTraceStageIndex/);
    assert.match(bundle, /acTraceCopyDecks/);
    assert.match(bundle, /acTracePickLine/);
    assert.match(bundle, /acTraceSourceFocus/);
    assert.match(bundle, /acTraceRandomOffset/);
    assert.match(bundle, /useMemo\(\(\)=>acTraceRandomOffset\(\),\[\]\)/);
    const traceDeckStart = bundle.indexOf('const acTraceCopyDecks=');
    const traceDeckEnd = bundle.indexOf('function acTraceStageFromSignals', traceDeckStart);
    assert.notEqual(traceDeckStart, -1, 'trace copy deck should exist');
    assert.notEqual(traceDeckEnd, -1, 'trace copy deck should end before trace helpers');
    const traceDeck = bundle.slice(traceDeckStart, traceDeckEnd);
    assert.ok(
      (traceDeck.match(/label:/g) || []).length >= 72,
      'trace copy deck should have enough variation to avoid feeling static'
    );
    const traceEnd = bundle.indexOf('function ', bundle.indexOf('function acProcessingTrace') + 20);
    assert.notEqual(traceEnd, -1, 'processing trace should have a clear boundary');
    const traceBlock = bundle.slice(traceDeckStart, traceEnd);
    assert.match(bundle, /gray cells/);
    assert.match(bundle, /evidence parade/);
    assert.match(bundle, /tiny courtroom/);
    assert.match(bundle, /French company mode/);
    assert.match(bundle, /Je lis/);
    assert.match(bundle, /Chalo/);
    assert.match(bundle, /Vamos/);
    assert.match(bundle, /Andiamo/);
    assert.match(bundle, /Cholo/);
    assert.match(bundle, /acTraceStageFromSignals/);
    assert.match(bundle, /acTraceFormatElapsed/);
    assert.match(bundle, /acTraceVisibleSteps/);
    assert.match(traceBlock, /Work /);
    assert.doesNotMatch(traceBlock, /Working for/);
    assert.doesNotMatch(traceBlock, /Reasoning/);
    assert.doesNotMatch(traceBlock, /acs-reasoning__chevron/);
    assert.match(traceBlock, /justify-content:flex-start/);
    assert.doesNotMatch(traceBlock, /acTraceLine\(N,l\+d,O,b\)/);
    assert.doesNotMatch(traceBlock, /acTraceSourceFocus\(p,l\+d\)/);
    assert.doesNotMatch(traceBlock, /"pending"/);
    assert.match(bundle, /answerStarted/);
    assert.match(traceBlock, /setInterval/);
    assert.doesNotMatch(traceBlock, /1400/);
    assert.doesNotMatch(traceBlock, /2\+n%4/);
    assert.match(bundle, /prefers-reduced-motion:no-preference/);
    assert.match(bundle, /name:"source-pill"/);
    assert.doesNotMatch(bundle, /className:"acs-source-chips"/);
    assert.doesNotMatch(bundle, /Source groups being checked/);
    assert.doesNotMatch(bundle, /acs-source-chip__count/);
    assert.match(renderer, /sources:[te]\.sources/);
    assert.match(renderer, /status:[te]\.status/);
    assert.match(renderer, /text:[te]\.text/);
    assert.doesNotMatch(renderer, /inline-flex items-center rounded-algolia-full border px-2\.5 py-1 text-algolia-2xs/);
    assert.doesNotMatch(renderer, /&&!\s*R\)&&w\.jsx\([^,]+,\{name:"thinking"/);
    assert.doesNotMatch(bundle, /acs-step--active \.acs-step__dot\{background:var\(--algolia-accent\)/);
    assert.doesNotMatch(bundle, /acs-progress__fill[^"]*background:var\(--algolia-accent\)/);
  });

  test(`${bundleName} logs segment state transitions when chat debug is enabled`, () => {
    const bundle = readBundle(bundleName);

    assert.match(bundle, /segment state update/);
    assert.match(bundle, /previousStatus/);
    assert.match(bundle, /patchStatus/);
    assert.match(bundle, /nextStatus/);
    assert.match(bundle, /__algoliaChatJudgeDebugExport/);
  });
}
