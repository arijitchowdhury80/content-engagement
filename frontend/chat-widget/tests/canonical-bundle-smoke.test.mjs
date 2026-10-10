import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const widgetRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bundlePath = path.join(widgetRoot, 'dist', 'content-engagement.js');

test('source-built customer artifact registers one real widget and Algolia capabilities', async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));

  try {
    await page.route('http://content-engagement.local/', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><html><body></body></html>',
      }),
    );
    await page.goto('http://content-engagement.local/');
    await page.addScriptTag({ path: bundlePath });

    const state = await page.evaluate(() => ({
      widgetDefined: Boolean(customElements.get('algolia-chat')),
      confidenceBadgeDefined: Boolean(customElements.get('algolia-confidence-badge')),
      judgeCore: typeof window.AlgoliaJudgeCore,
      tracker: typeof window.algoliaEngagementTracker,
      contextCompiler: typeof window.algoliaContextCompiler,
      proactive: typeof window.algoliaProactiveController,
    }));

    assert.equal(state.widgetDefined, true);
    assert.equal(state.confidenceBadgeDefined, true);
    assert.equal(state.judgeCore, 'object');
    assert.equal(state.tracker, 'object');
    assert.equal(state.contextCompiler, 'object');
    assert.equal(state.proactive, 'object');
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

test('source-built customer artifact distinguishes rate limiting from a generic service failure', () => {
  const bundle = fs.readFileSync(bundlePath, 'utf8');
  assert.match(bundle, /rate-limited right now/);
  assert.match(bundle, /service error, not an answer/);
});
