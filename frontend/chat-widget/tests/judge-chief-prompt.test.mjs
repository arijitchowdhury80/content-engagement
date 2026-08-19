import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

function readBundle(name) {
  return readFileSync(resolve(__dirname, '..', name), 'utf8');
}

for (const bundleName of ['algolia-chat.js']) {
  test(`${bundleName} ships the source-grounded chief-judge contract`, () => {
    const bundle = readBundle(bundleName);

    assert.match(bundle, /consult_skeptic/);
    assert.match(bundle, /consult_referee/);
    assert.match(bundle, /consult_advocate/);
    assert.match(bundle, /QUESTION:/);
    assert.match(bundle, /ANSWER:/);
    assert.match(bundle, /SOURCES:/);
    assert.match(bundle, /Treat semantically equivalent paraphrases as grounded/);
    assert.match(bundle, /Judge semantic support, not exact wording/);
    assert.match(bundle, /Exact values, prices, dates, limits, version names, (?:and )?API names/);
    assert.match(bundle, /gateTripped=true only for critical or material unsupported factual claims/);
    assert.match(bundle, /harmless paraphrases, headings, transitions/);
  });

  test(`${bundleName} ships hard answer admission before successful persistence`, () => {
    const bundle = readBundle(bundleName);

    assert.match(bundle, /unsupportedTerms/);
    assert.match(bundle, /function __arrieAdmitAnswer/);
    assert.match(bundle, /await xE\(/);
    assert.match(bundle, /BE\(f,u\)/);
    assert.match(bundle, /The retrieved material does not verify the specific details requested/);
    assert.match(bundle, /reason:g\?"judge-unavailable":v\?"material-gate"/);
    assert.match(bundle, /u\.admissionRejected\?\(\{\.\.\.u,admissionVerdict:void 0\}\):u/);
    assert.match(bundle, /u\.status==="success"/);
  });

  test(`${bundleName} preserves streamed answers and late-error recovery`, () => {
    const bundle = readBundle(bundleName);

    assert.match(bundle, /final answer text was empty after post-processing; preserving streamed text/);
    assert.match(bundle, /No answer text returned by the agent/);
    assert.match(bundle, /late agent error arrived after answer text/);
    assert.match(bundle, /late specialist error arrived after answer text/);
  });

  test(`${bundleName} ships the observable six-stage processing trace`, () => {
    const bundle = readBundle(bundleName);

    assert.match(bundle, /Planning retrieval/);
    assert.match(bundle, /Searching/);
    assert.match(bundle, /Reading retrieved sources/);
    assert.match(bundle, /Synthesizing evidence/);
    assert.match(bundle, /Composing grounded answer/);
    assert.match(bundle, /Writing answer/);
    assert.match(bundle, /algolia-chat-processing-progress/);
    assert.match(bundle, /Work /);
    assert.doesNotMatch(bundle, /Working for/);
    assert.doesNotMatch(bundle, /Source groups being checked/);
  });

  test(`${bundleName} logs segment transitions in chat debug mode`, () => {
    const bundle = readBundle(bundleName);

    assert.match(bundle, /segment state update/);
    assert.match(bundle, /previousStatus/);
    assert.match(bundle, /patchStatus/);
    assert.match(bundle, /nextStatus/);
    assert.match(bundle, /__algoliaChatJudgeDebugExport/);
  });
}
