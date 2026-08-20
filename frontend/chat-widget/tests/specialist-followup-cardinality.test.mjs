import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const bundleUrl = new URL('../algolia-chat.js', import.meta.url);

test('every successful answer exposes exactly one discovery question', async () => {
  const bundle = await readFile(bundleUrl, 'utf8');

  assert.match(bundle, /function __arrieOneDiscoveryQuestion\(/);
  assert.match(bundle, /const s=yg\(e\.content,n,"specialist"\),u=__arrieOneDiscoveryQuestion\(t,e\.suggestions\[0\]\)/);
  assert.match(
    bundle,
    /const s=a\.active\?__arrieOneDiscoveryQuestion\(n\.query,a\.followUp,i\.suggestions\[0\]\):i\.suggestions/,
  );
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

test('Agent Studio completion steps retry one transient or empty response', async () => {
  const bundle = await readFile(bundleUrl, 'utf8');

  assert.match(bundle, /async function __arrieCompletionStep\(/);
  assert.match(bundle, /const E=await __arrieCompletionStep\(e,n,/);
  assert.match(
    bundle,
    /g\.content\.trim\(\)&&x\.some\(R=>\{if\(R\.type!=="tool-ask_specialist"\)/,
  );
});

test('qualified specialist journeys use the existing human-gated specialist handler deterministically', async () => {
  const bundle = await readFile(bundleUrl, 'utf8');

  assert.match(bundle, /function __arrieDeterministicSpecialistOffer\(/);
  assert.match(bundle, /function __arrieRunDeterministicSpecialistOffer\(/);
  assert.match(bundle, /qualified_journey/);
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
