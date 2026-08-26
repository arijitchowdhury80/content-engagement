import assert from 'node:assert/strict';
import test from 'node:test';

import { HostHealthMonitor, evaluateHostHealth, systemMemoryUsedPercent } from '../src/observe/host-health.mjs';

test('host health thresholds distinguish valid generator from saturated generator', () => {
  const healthy = evaluateHostHealth([{ cpuPercent: 20, usedMemoryPercent: 30, eventLoopP99Ms: 5 }]);
  assert.equal(healthy.pass, true);
  const saturated = evaluateHostHealth([{ cpuPercent: 95, usedMemoryPercent: 90, eventLoopP99Ms: 150 }]);
  assert.equal(saturated.pass, false);
  assert.deepEqual(saturated.violations, ['average_cpu', 'memory', 'event_loop']);
});

test('host monitor captures real process and system samples', async () => {
  const monitor = new HostHealthMonitor({ intervalMs: 10 }).start();
  await new Promise((resolve) => setTimeout(resolve, 35));
  monitor.stop();
  assert.ok(monitor.samples.length >= 2);
  assert.ok(monitor.samples.every((sample) => Number.isFinite(sample.eventLoopP99Ms)));
});

test('platform-aware memory pressure returns a bounded usable-memory percentage', () => {
  const used = systemMemoryUsedPercent();
  assert.ok(used >= 0 && used <= 100, `unexpected memory pressure ${used}`);
});
