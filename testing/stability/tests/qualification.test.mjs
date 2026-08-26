import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { qualifyFixture } from '../src/fixture/qualify.mjs';
import { validateCalibrationContexts } from '../src/scheduler/calibrate-host.mjs';

test('fixture qualification exercises clean and adversarial terminal paths', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'algolia-stability-qualification-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const result = await qualifyFixture({ rawRoot: path.join(root, 'raw') });
  assert.equal(result.pass, true, JSON.stringify(result.results));
  assert.equal(result.results.length, 8);
  assert.ok(result.results.some((item) => item.scenario === 'http429' && item.observed === 'HTTP_429'));
  assert.ok(result.results.some((item) => item.scenario === 'duplicate-submit-protection' && item.observed === 1));
});

test('calibration levels cannot skip the 1, 2, 5 staircase', () => {
  assert.deepEqual(validateCalibrationContexts([1, 2, 5]), [1, 2, 5]);
  assert.throws(() => validateCalibrationContexts([5]), /cannot jump levels/);
  assert.throws(() => validateCalibrationContexts([1, 5]), /expected 2/);
  assert.throws(() => validateCalibrationContexts([1, 2, 5, 12]), /expected 8/);
});
