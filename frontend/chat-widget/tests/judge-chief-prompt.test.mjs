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

for (const bundleName of ['algolia-chat.js']) {
  test(`${bundleName} includes retrieved sources in chief judge prompt when role judges are enabled`, () => {
    const branch = roleJudgeChiefPromptBranch(readBundle(bundleName));

    assert.match(branch, /QUESTION:/);
    assert.match(branch, /ANSWER:/);
    assert.match(branch, /SOURCES:/);
    assert.match(branch, /JSON\.stringify\([^)]*\.sources\)/);
  });

  test(`${bundleName} tells judges to distinguish hallucination from semantic paraphrase`, () => {
    const bundle = readBundle(bundleName);
    const branch = roleJudgeChiefPromptBranch(bundle);

    assert.match(bundle, /Treat semantically equivalent paraphrases as grounded/);
    assert.match(bundle, /Judge semantic support, not exact wording/);
    assert.match(bundle, /Exact values, prices, dates, limits, version names, API names/);
    assert.match(bundle, /gateTripped=true only for critical or material unsupported factual claims/);
    assert.match(bundle, /harmless paraphrases, headings, transitions/);
    assert.match(branch, /section labels, connective phrasing, or generic advice/);
  });

  test(`${bundleName} highlights unsupported answer spans without blocking the answer`, () => {
    const bundle = readBundle(bundleName);
    const rendererName = bundleName.includes('jahia') ? 'hE' : 't1';
    const visibleTextValue = bundleName.includes('jahia') ? 'R=e.text' : 'R=t.text';
    const staleJudgeGate = bundleName.includes('jahia') ? 'R=x?e.text:""' : 'R=S?t.text:""';
    const rendererStart = bundle.indexOf(`function ${rendererName}(`);
    assert.notEqual(rendererStart, -1, 'assistant message renderer should exist');

    const nextFunction = bundle.indexOf('function ', rendererStart + 20);
    assert.notEqual(nextFunction, -1, 'assistant renderer should have a clear boundary');
    const renderer = bundle.slice(rendererStart, nextFunction);

    assert.doesNotMatch(bundle, /I cannot verify this answer against the retrieved sources/);
    assert.doesNotMatch(bundle, /function acShouldBlockAnswer/);
    assert.match(bundle, /function acHighlightUnsupported/);
    assert.match(bundle, /text-algolia-negative/);
    assert.match(bundle, /needs source review/);
    assert.match(bundle, /unsupportedTerms/);
    assert.ok(renderer.includes(visibleTextValue), 'streamed answer text should render before final judging succeeds');
    assert.ok(!renderer.includes(staleJudgeGate), 'visible answer text must not be gated by judge eligibility');
    assert.match(renderer, /unsupportedTerms:/);
    assert.doesNotMatch(renderer, /acUnsupportedAnswerMessage/);
    assert.match(renderer, /text:[te]\.text/);
    assert.match(renderer, /name:"thinking"/);
    assert.match(renderer, /&&!\s*R&&w\.jsx\([^,]+,\{name:"thinking"/);
  });

  test(`${bundleName} presents grounding as review instead of a hard unsupported verdict`, () => {
    const bundle = readBundle(bundleName);

    assert.match(bundle, /Grounding review/);
    assert.match(bundle, /NEEDS REVIEW/);
    assert.match(bundle, /grounding needs review/);
    assert.match(bundle, /material source support needs review/);
    assert.match(bundle, /term\(s\) need review|term(?:\(s\)|s)? to review/);
    assert.doesNotMatch(bundle, /Grounding verdict/);
    assert.doesNotMatch(bundle, /UNSUPPORTED/);
    assert.doesNotMatch(bundle, /floored to/);
    assert.doesNotMatch(bundle, /hard-floor/);
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

  test(`${bundleName} aligns header title and subtitle to the same left edge`, () => {
    const bundle = readBundle(bundleName);
    const headerStart = bundle.indexOf('function zx(');
    assert.notEqual(headerStart, -1, 'default header renderer should exist');

    const headerEnd = bundle.indexOf('function ', headerStart + 20);
    assert.notEqual(headerEnd, -1, 'default header renderer should have a clear boundary');
    const headerBlock = bundle.slice(headerStart, headerEnd);

    assert.match(headerBlock, /flex min-w-0 flex-col items-start text-left leading-tight/);
    assert.match(headerBlock, /truncate text-left font-algolia-sans text-algolia-base/);
    assert.match(headerBlock, /truncate text-left text-algolia-xs text-algolia-text-muted/);
    assert.doesNotMatch(headerBlock, /flex min-w-0 flex-col text-left leading-tight/);
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
    assert.match(bundle, /acs-source-group-pill/);
    assert.match(bundle, /acs-source-group-count/);
    assert.match(bundle, /backdrop-filter:blur\(10px\)/);
    assert.match(bundle, /box-shadow:inset 0 1px 0/);
    assert.doesNotMatch(bundle, /className:"flex flex-col gap-2 border-t border-algolia-border pt-3","aria-label":J\.strings\.sources\.sectionLabel/);
    assert.match(bundle, /className:"flex flex-col gap-2 pt-2","aria-label":J\.strings\.sources\.sectionLabel/);
    assert.doesNotMatch(bundle, /className:"acs-source-chips"/);
    assert.doesNotMatch(bundle, /Source groups being checked/);
    assert.doesNotMatch(bundle, /acs-source-chip__count/);
    assert.match(renderer, /sources:[te]\.sources/);
    assert.match(renderer, /status:[te]\.status/);
    assert.match(renderer, /text:[te]\.text/);
    assert.doesNotMatch(renderer, /inline-flex items-center rounded-algolia-full border px-2\.5 py-1 text-algolia-2xs/);
    assert.match(renderer, /&&!\s*R&&w\.jsx\([^,]+,\{name:"thinking"/);
    assert.doesNotMatch(bundle, /acs-step--active \.acs-step__dot\{background:var\(--algolia-accent\)/);
    assert.doesNotMatch(bundle, /acs-progress__fill[^"]*background:var\(--algolia-accent\)/);
    assert.match(traceBlock, /--acs-progress/);
    assert.match(traceBlock, /background:linear-gradient\(90deg,color-mix\(in srgb,var\(--algolia-accent\) 10%,transparent\) var\(--acs-progress\)/);
    assert.match(traceBlock, /className:"sr-only"[^}]*role:"progressbar"/);
    assert.doesNotMatch(traceBlock, /className:"acs-progress"/);
    assert.doesNotMatch(traceBlock, /\.acs-progress\{height/);
    assert.doesNotMatch(traceBlock, /acs-progress__fill/);
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
