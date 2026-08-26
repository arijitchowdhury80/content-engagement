import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { chromium } from 'playwright';

import { ensureSafeRawRoot } from '../config/artifact-paths.mjs';
import { BrowserRecorder } from '../observe/browser-recorder.mjs';
import { HostHealthMonitor, evaluateHostHealth } from '../observe/host-health.mjs';
import { AppendOnlyJsonlSpool } from '../observe/jsonl-spool.mjs';
import { startFixtureServer } from '../fixture/server.mjs';

export const CALIBRATION_STAIRCASE = Object.freeze([1, 2, 5, 8, 12, 20]);

export function validateCalibrationContexts(contexts) {
  if (!Array.isArray(contexts) || contexts.length === 0) throw new Error('At least one calibration level is required');
  contexts.forEach((value, index) => {
    if (value !== CALIBRATION_STAIRCASE[index]) {
      throw new Error(`Calibration cannot jump levels; expected ${CALIBRATION_STAIRCASE[index]} at position ${index + 1}`);
    }
  });
  return contexts;
}

async function runWave({ browser, fixture, count, root, secret }) {
  const monitor = new HostHealthMonitor({ intervalMs: 25 }).start();
  const contexts = [];
  const latencies = [];
  try {
    await Promise.all(Array.from({ length: count }, async (_, index) => {
      const spool = new AppendOnlyJsonlSpool(root, `calibration/${count}/context-${index + 1}.jsonl`);
      const context = await browser.newContext();
      const recorder = new BrowserRecorder({
        spool,
        hmacSecret: secret,
        identity: {
          runId: 'stab-host-calibration', stageId: `contexts-${count}`, hostId: 'local',
          browserContextId: `context-${index + 1}`, personaId: 'fixture', conversationId: null,
          turnId: `calibration-${count}-${index + 1}`, attemptId: null,
        },
      });
      contexts.push({ context, spool, recorder });
      recorder.attach(context);
      const page = await context.newPage();
      await page.goto(fixture.origin);
      await page.fill('#scenario', 'delayed');
      const started = performance.now();
      await page.click('#submit');
      await page.waitForSelector('#status[data-terminal="true"]', { timeout: 5_000 });
      latencies.push(performance.now() - started);
    }));
  } finally {
    monitor.stop();
    await Promise.all(contexts.map(async ({ context, spool, recorder }) => {
      await recorder.flush();
      await context.close();
      spool.close();
    }));
  }
  const health = evaluateHostHealth(monitor.samples);
  const sorted = latencies.slice().sort((a, b) => a - b);
  const p95 = sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)];
  return { count, pass: health.pass && latencies.length === count, health, latencyP95Ms: p95, completed: latencies.length };
}

export async function calibrateHost({ rawRoot, contexts, browserType = chromium } = {}) {
  validateCalibrationContexts(contexts);
  const root = ensureSafeRawRoot(rawRoot);
  const fixture = await startFixtureServer();
  const browser = await browserType.launch({ headless: true });
  const secret = randomBytes(32);
  const levels = [];
  try {
    for (const count of contexts) {
      const result = await runWave({ browser, fixture, count, root, secret });
      levels.push(result);
      if (!result.pass) break;
    }
  } finally {
    await browser.close();
    await fixture.close();
  }
  const summary = {
    schema: 'HostCalibration.v1',
    at: new Date().toISOString(),
    requested: contexts,
    completedLevels: levels.length,
    pass: levels.length === contexts.length && levels.every((level) => level.pass),
    levels,
  };
  const summaryPath = path.join(root, 'calibration', 'summary.json');
  fs.mkdirSync(path.dirname(summaryPath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  fs.chmodSync(summaryPath, 0o600);
  return { ...summary, summaryPath };
}
