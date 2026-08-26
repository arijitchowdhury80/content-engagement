import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from 'playwright';

import { startFixtureServer } from '../src/fixture/server.mjs';

test('fixture provides deterministic clean, rate-limit, and interrupted paths', async (t) => {
  const fixture = await startFixtureServer();
  t.after(() => fixture.close());
  const clean = await fetch(`${fixture.origin}/completions`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ scenario: 'clean', submissions: 1 }),
  });
  assert.equal(clean.status, 200);
  assert.match(await clean.text(), /Fixture answer/);
  const limited = await fetch(`${fixture.origin}/completions`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ scenario: 'http429', submissions: 1 }),
  });
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get('retry-after'), '1');
  const partial = await fetch(`${fixture.origin}/completions`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ scenario: 'partial', submissions: 1 }),
  });
  assert.doesNotMatch(await partial.text(), /finishReason/);
});

test('fixture browser prevents an ordinary double submission', async (t) => {
  const fixture = await startFixtureServer();
  const browser = await chromium.launch({ headless: true });
  t.after(async () => { await browser.close(); await fixture.close(); });
  const page = await browser.newPage();
  await page.goto(fixture.origin);
  await page.fill('#scenario', 'delayed');
  await page.locator('#submit').dblclick();
  await page.waitForSelector('#status[data-terminal="true"]');
  assert.equal((await page.evaluate(() => window.fixtureState())).submissions, 1);
  assert.equal(fixture.physicalRequests.filter((item) => item.scenario === 'delayed').length, 1);
});
