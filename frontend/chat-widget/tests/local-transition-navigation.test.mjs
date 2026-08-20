import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('all transition journeys survive real same-origin browser navigation', () => {
  const result = spawnSync(
    process.execPath,
    ['tools/inspection/validate_local_transition_navigation.mjs'],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 120_000,
    }
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);
  assert.equal(report.pass, true);
  assert.equal(report.results.length, 4);
  assert.deepEqual(
    report.results.map((item) => item.trigger).sort(),
    [
      'product_to_documentation',
      'product_to_pricing',
      'solution_to_customer_story',
      'solution_to_pricing',
    ]
  );
  for (const resultItem of report.results) {
    assert.equal(resultItem.sessionPreserved, true, resultItem.trigger);
    assert.equal(resultItem.sourceQualified, true, resultItem.trigger);
    assert.equal(resultItem.transitionShown, true, resultItem.trigger);
  }
});
