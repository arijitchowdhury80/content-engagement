import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const bundleUrl = new URL('../algolia-chat.js', import.meta.url);

test('every successful answer exposes exactly one discovery question', async () => {
  const bundle = await readFile(bundleUrl, 'utf8');

  assert.match(bundle, /function __arrieOneDiscoveryQuestion\(/);
  assert.match(bundle, /yg\(e\.content,n,"specialist"\),[a-z]=__arrieOneDiscoveryQuestion\(t,e\.suggestions\[0\]\)/);
  assert.match(
    bundle,
    /const s=a\.active\?__arrieOneDiscoveryQuestion\(n\.query,a\.followUp,i\.suggestions\[0\]\):\[a\.followUp,\.\.\.i\.suggestions\]\.map\([^)]*=>[^)]*\.trim\(\)\)\.filter\(Boolean\)\.slice\(0,1\)/,
  );
  assert.match(bundle, /rR\(e,n,s,\{followUp:d\.followUp,active:i!==null\}\)/);
  assert.doesNotMatch(bundle, /followUps:e\.suggestions,error:void 0/);
});

test('unsourced specialist output is demoted without replacing the primary answer', async () => {
  const bundle = await readFile(bundleUrl, 'utf8');

  assert.match(bundle, /function __arrieSpecialistAddsSourcedDepth\(/);
  assert.match(bundle, /a\.length===0\|\|__arrieSpecialistIsLimitation\(n\)/);
  assert.match(bundle, /function __arrieDemoteSpecialistSegment\(/);
  assert.match(bundle, /d\.length>i&&d\.splice\(i,1\)/);
  assert.match(bundle, /handoff:!1/);
  assert.match(bundle, /specialistLimitation:\{agent:n,text:__arrieSpecialistLimitationText\(a\),followUps:s\}/);
});

test('specialist limitation renders secondarily before the sole discovery question', async () => {
  const bundle = await readFile(bundleUrl, 'utf8');

  assert.match(bundle, /name:"specialist-limitation"/);
  assert.match(bundle, /className:"acs-specialist-limitation/);
  assert.match(bundle, /followUps:k\?void 0:/);

  const limitationIndex = bundle.indexOf('k&&S.jsx(__arrieSpecialistLimitationView');
  const discoveryIndex = bundle.indexOf('k&&m.length>0&&!d&&S.jsx(v_', limitationIndex);
  assert.ok(limitationIndex >= 0, 'secondary specialist limitation must render');
  assert.ok(discoveryIndex > limitationIndex, 'one discovery question must follow the limitation');
  assert.match(bundle, /m=k\?\.followUps\?\?e\.segments\[0\]\?\.followUps\?\?\[\]/);
});

test('Agent Studio completion steps share one explicit pre-stream retry budget', async () => {
  const bundle = await readFile(bundleUrl, 'utf8');

  assert.match(bundle, /async function __arrieCompletionStep\(/);
  assert.match(bundle, /safeToRetry=e\.status===408\|\|e\.status===429\|\|e\.status>=500/);
  assert.match(bundle, /const[^;]+remaining:1/);
  assert.doesNotMatch(bundle, /function __arrieEmptyCompletion\(/);
  assert.match(
    bundle,
    /\.content\.trim\(\)&&[^.]+\.some\([^=]+=>\{if\([^.]+\.type!=="tool-ask_specialist"\)/,
  );
});

test('confidence judges retry only the role whose response failed', async () => {
  const bundle = await readFile(bundleUrl, 'utf8');

  assert.match(bundle, /async function __arrieRunRoleJudge\(/);
  assert.match(bundle, /for\(let w=1;w<=2&&!s\.aborted;w\+\+\)/);
  assert.match(bundle, /phase:"retrying",role:i,attempt:w/);
  assert.match(bundle, /Judge failed validation twice/);
  assert.match(bundle, /s\.ROLES\.map\(g=>__arrieRunRoleJudge/);
});

test('specialist progress emissions carry widget and attempt context', async () => {
  const bundle = await readFile(bundleUrl, 'utf8');
  const specialistStart = bundle.indexOf('function q1(');
  const specialistEnd = bundle.indexOf('function __arrieFallbackDiscoveryQuestion', specialistStart);
  const specialistRunner = bundle.slice(specialistStart, specialistEnd);
  const specialistToolStart = bundle.indexOf('function V1(');
  const specialistToolEnd = bundle.indexOf('function Q1(', specialistToolStart);
  const specialistTool = bundle.slice(specialistToolStart, specialistToolEnd);
  const registryStart = bundle.indexOf('function tR(');
  const registryEnd = bundle.indexOf('function rR(', registryStart);
  const registry = bundle.slice(registryStart, registryEnd);
  const thinkingStart = bundle.indexOf('function lE(');
  const thinkingEnd = bundle.indexOf('function uE(', thinkingStart);
  const thinkingIndicator = bundle.slice(thinkingStart, thinkingEnd);

  assert.ok(specialistStart >= 0 && specialistEnd > specialistStart, 'specialist runner must exist');
  assert.match(
    registry,
    /hostElement:e\.hostElement/,
    'specialist tool registry must pass the owning widget host into specialist execution',
  );
  assert.match(
    specialistTool,
    /progressContext:\{widgetInstanceId:e\.hostElement\?\.__algoliaWidgetInstanceId,turnId:n\}/,
    'specialist execution must bind progress to the originating widget and turn',
  );
  assert.doesNotMatch(
    specialistRunner,
    /mt\(\{status:"(?:success|streaming|loading|error)"[^)]*\}\)(?!,)/,
    'specialist progress must never use the document-wide progress fallback',
  );
  assert.match(
    specialistRunner,
    /mt\(\{status:"success",searchCount:0,hasText:!0\},void 0,[a-z]\.hostElement\?\?null,[a-z]\.progressContext\?\?null\)/,
    'specialist failure fallback must complete only the owning widget progress',
  );
  assert.match(
    thinkingIndicator,
    /mt\(\{status:[a-z],searchCount:[a-z]\?\?0,hasText:!![a-z]\.trim\(\),textLength:[a-z]\.length\},void 0,[a-z],[a-z]\)/,
    'rendered reasoning progress must carry host/context and avoid sibling cross-talk',
  );
});

test('qualified specialist journeys use the existing human-gated specialist handler deterministically', async () => {
  const bundle = await readFile(bundleUrl, 'utf8');

  assert.match(bundle, /function __arrieDeterministicSpecialistOffer\(/);
  assert.match(bundle, /function __arrieRunDeterministicSpecialistOffer\(/);
  assert.match(bundle, /qualified_journey/);
  assert.match(bundle, /developer\|technical\|implementation\) specialist/);
  assert.match(bundle, /customer \)\?evidence specialist/);
  assert.match(bundle, /product specialist/);
  assert.match(bundle, /sales specialist\|sales concierge/);
  assert.match(bundle, /if\([a-z]&&[A-Z]\)return\{specialistKey:[A-Z],question:[a-z]\}/);
  assert.match(bundle, /specialist_key:[a-z]\.specialistKey,question:[a-z]\.question/);
  assert.match(
    bundle,
    /await __arrieRunDeterministicSpecialistOffer\([^)]*lastVisibleAnswer\)/,
  );
  assert.match(bundle, /if\(!\([a-z]\.content\|\|[a-z]\)\.trim\(\)\|\|/);

});

test('specialist consent and discovery are sequential rather than competing actions', async () => {
  const bundle = await readFile(bundleUrl, 'utf8');

  const offerIndex = bundle.indexOf('await __arrieRunDeterministicSpecialistOffer(');
  const settleIndex = bundle.indexOf(',await iR(', offerIndex);
  assert.ok(offerIndex >= 0, 'deterministic specialist offer must exist');
  assert.ok(settleIndex > offerIndex, 'specialist consent must resolve before primary discovery settles');
  assert.doesNotMatch(bundle, /status:"streaming"[^}]*status:"success"/);
  assert.match(bundle, /\.handoff;[A-Za-z]\?[^:]+followUps:\[\]/);
  assert.match(bundle, /:[a-zA-Z0-9_$]+\([a-zA-Z0-9_$]+,[a-zA-Z0-9_$]+,[a-zA-Z0-9_$]+,\{followUp:/);
});

test('a native specialist decision suppresses the deterministic fallback offer', async () => {
  const bundle = await readFile(bundleUrl, 'utf8');

  assert.match(bundle, /function __arrieTurnAlreadyHandledSpecialist\(/);
  assert.match(bundle, /deepDiveOffered/);
  assert.match(bundle, /deepDiveDeclined/);
  assert.match(bundle, /handoff/);
  assert.match(
    bundle,
    /__arrieTurnAlreadyHandledSpecialist\([^)]*\)\|\|await __arrieRunDeterministicSpecialistOffer\(/,
  );
});
