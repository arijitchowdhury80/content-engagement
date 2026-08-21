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
  test(`${bundleName} ships the direct three-role judge contract`, () => {
    const bundle = readBundle(bundleName);

    assert.match(bundle, /judgeAnswerViaPanel/);
    assert.match(bundle, /validateJudgeAgents/);
    assert.match(bundle, /buildJudgeInput/);
    assert.match(bundle, /validateJudgeReport/);
    assert.match(bundle, /aggregateJudgeReports/);
    assert.match(bundle, /evidenceEvents/);
    assert.match(bundle, /Promise\.all/);
    assert.doesNotMatch(bundle, /judgeAnswerViaChiefJudge/);
    assert.doesNotMatch(bundle, /consult_skeptic/);
    assert.doesNotMatch(bundle, /consult_referee/);
    assert.doesNotMatch(bundle, /consult_advocate/);
  });

  test(`${bundleName} keeps confidence evaluation outside the answer lifecycle`, () => {
    const bundle = readBundle(bundleName);

    assert.match(bundle, /unsupportedTerms/);
    assert.match(bundle, /xE\(\{question:w,answer:E,hits:A,evidenceEvents:C,panelId:h\},fetch,x\)/);
    assert.match(bundle, /admissionVerdict/);
    assert.doesNotMatch(bundle, /function __arrieAdmitAnswer/);
    assert.doesNotMatch(bundle, /GROUNDING REPAIR - SYSTEM-GENERATED RUNTIME INSTRUCTION/);
    assert.doesNotMatch(bundle, /function __arrieAttemptGroundedRewrite/);
    assert.doesNotMatch(bundle, /admissionRewritten/);
  });

  test(`${bundleName} treats exact-match grounding as advisory after semantic judging`, () => {
    const bundle = readBundle(bundleName);

    assert.match(bundle, /\[a\.title,a\.url,a\.text\]/);
    assert.match(bundle, /deterministicGrounding/);
    assert.match(bundle, /exact-match-advisory/);
    assert.doesNotMatch(bundle, /const WE=3/);
    assert.doesNotMatch(bundle, /not present verbatim in any retrieved source \(deterministic check\)/);
  });

  test(`${bundleName} supports only Agent Studio judge transport`, () => {
    const bundle = readBundle(bundleName);

    assert.match(bundle, /return e==="off"\?"off":"algolia"/);
    assert.match(bundle, /function VE\(e\)\{if\(e\)return\{mode:e\.mode,agents:e\.agents\}\}/);
    assert.doesNotMatch(bundle, /localhost:8788/);
    assert.doesNotMatch(bundle, /\/api\/judge/);
    assert.doesNotMatch(bundle, /VITE_JUDGE_URL/);
    assert.doesNotMatch(bundle, /VITE_JUDGE_API_KEY/);
    assert.doesNotMatch(bundle, /judge-url/);
    assert.doesNotMatch(bundle, /judge-api-key/);
    assert.doesNotMatch(bundle, /hosted judge/i);
    assert.doesNotMatch(bundle, /local judge/i);
    assert.doesNotMatch(bundle, /chief judge/i);
    assert.doesNotMatch(bundle, /judge-agent-id/);
    assert.doesNotMatch(bundle, /VITE_JUDGE_AGENT_ID/);
    assert.match(bundle, /static get observedAttributes\(\)\{return\["mode","agents"\]\}/);
  });

  test(`${bundleName} accepts exact fenced judge JSON without imposing elapsed-time scoring deadlines`, () => {
    const bundle = readBundle(bundleName);

    assert.match(bundle, /\^```\(\?:json\)\?/);
    assert.doesNotMatch(bundle, /Judge attempt timed out after/);
    assert.doesNotMatch(bundle, /Judge panel deadline exceeded after/);
    assert.match(bundle, /phase:"judging"/);
    assert.match(bundle, /phase:"retrying"/);
    assert.match(bundle, /phase:"complete"/);
    assert.match(bundle, /phase:"failed"/);
  });

  test(`${bundleName} preserves streamed answers and late-error recovery`, () => {
    const bundle = readBundle(bundleName);

    assert.match(bundle, /final answer text was empty after post-processing; preserving streamed text/);
    assert.match(bundle, /No answer text returned by the agent/);
    assert.match(bundle, /late agent error arrived after answer text/);
    assert.match(bundle, /late specialist error arrived after answer text/);
    assert.match(bundle, /confidenceSuppressed/);
    assert.match(bundle, /const retryTurnId = crypto\.randomUUID|P=crypto\.randomUUID/);
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
