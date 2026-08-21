import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const script = readFileSync('agents/admin/deploy_judge_v2.mjs', 'utf8');

test('v2 judge deployment is immutable, scoped, and dry-run by default', () => {
  assert.match(script, /const apply = process\.argv\.includes\('--apply'\)/);
  assert.match(script, /immutableCreateOnly: true/);
  assert.match(script, /tools: \[\]/);
  assert.match(script, /suggestions: \{ enabled: false/);
  assert.doesNotMatch(script, /PATCH/);
  assert.match(script, /EXPECTED_APP_ID = '0EXRPAXB56'/);
  assert.match(script, /JUDGE_V2_AGENT_RELEASE/);
  assert.match(script, /createdThisRun/);
  assert.match(script, /deleteAndVerify/);
  assert.match(script, /failed-apply\.json/);
  assert.match(script, /after-readback\.json/);
  assert.match(script, /rollback\.json/);
  assert.match(script, /method === 'POST' && path === '\/agents' \? 1 : 3/);
  assert.match(script, /discoveredAfterAmbiguousCreate/);
  assert.match(script, /exactImmutableConfigMatch/);
  assert.match(script, /quarantined because an ambiguous create response cannot prove ownership/);
  assert.match(script, /const cleanupTargets = createdThisRun\.filter/);
  assert.doesNotMatch(script, /cleanupTargets = \[\.\.\.createdThisRun, \.\.\.discovered\]/);
});
