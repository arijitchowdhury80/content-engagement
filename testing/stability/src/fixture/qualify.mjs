import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { chromium } from 'playwright';

import { ensureSafeRawRoot } from '../config/artifact-paths.mjs';
import { BrowserRecorder } from '../observe/browser-recorder.mjs';
import { AppendOnlyJsonlSpool } from '../observe/jsonl-spool.mjs';
import { startFixtureServer } from './server.mjs';

const CASES = Object.freeze([
  ['clean', 'success'],
  ['http408', 'HTTP_408'],
  ['http429', 'HTTP_429'],
  ['http500', 'HTTP_500'],
  ['empty', 'stream-interrupted'],
  ['malformed', 'stream-interrupted'],
  ['partial', 'stream-interrupted'],
]);

export async function qualifyFixture({ rawRoot, browserType = chromium } = {}) {
  const root = ensureSafeRawRoot(rawRoot);
  const fixture = await startFixtureServer();
  const browser = await browserType.launch({ headless: true });
  const results = [];
  const secret = randomBytes(32);
  try {
    for (const [scenario, expected] of CASES) {
      const spool = new AppendOnlyJsonlSpool(root, `fixture/${scenario}.jsonl`);
      const context = await browser.newContext();
      const recorder = new BrowserRecorder({
        spool,
        hmacSecret: secret,
        identity: {
          runId: 'stab-fixture-qualification', stageId: 'fixture', hostId: 'local',
          browserContextId: `fixture-${scenario}`, personaId: 'fixture', conversationId: null,
          turnId: `fixture-${scenario}`, attemptId: null,
        },
      });
      recorder.attach(context);
      const page = await context.newPage();
      await page.goto(fixture.origin);
      await page.fill('#scenario', scenario);
      await page.click('#submit');
      await page.waitForSelector('#status[data-terminal="true"]', { timeout: 5_000 });
      const observed = await page.locator('#status').textContent();
      results.push({ scenario, expected, observed, pass: observed === expected });
      await recorder.flush();
      await context.close();
      spool.close();
    }

    const duplicateBefore = fixture.physicalRequests.length;
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(fixture.origin);
    await page.fill('#scenario', 'delayed');
    await page.locator('#submit').dblclick();
    await page.waitForSelector('#status[data-terminal="true"]', { timeout: 5_000 });
    const duplicatePhysical = fixture.physicalRequests.length - duplicateBefore;
    results.push({ scenario: 'duplicate-submit-protection', expected: 1, observed: duplicatePhysical, pass: duplicatePhysical === 1 });
    await context.close();
  } finally {
    await browser.close();
    await fixture.close();
  }
  const summary = {
    schema: 'FixtureQualification.v1',
    at: new Date().toISOString(),
    pass: results.every((result) => result.pass),
    results,
  };
  const summaryPath = path.join(root, 'fixture', 'qualification-summary.json');
  fs.mkdirSync(path.dirname(summaryPath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  fs.chmodSync(summaryPath, 0o600);
  return { ...summary, summaryPath };
}
