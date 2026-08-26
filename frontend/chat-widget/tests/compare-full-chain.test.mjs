import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const chatDir = join(root, 'frontend', 'chat-widget');
const siteDir = join(root, 'local-sites', 'algolia-com-parity');
const fixturePath = join(siteDir, 'index.html');

function localPath(urlPath) {
  const path = urlPath.split('?')[0].split('#')[0];
  if (path.startsWith('/chat/')) return join(chatDir, path.replace('/chat/', ''));
  if (path === '/' || !extname(path)) return fixturePath;
  return join(siteDir, path.replace(/^\//, ''));
}

function startServer() {
  const productionBodies = [];
  const server = createServer(async (request, response) => {
    if (request.method === 'POST' && request.url?.split('?')[0] === '/__compare/production') {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      productionBodies.push(Buffer.concat(chunks).toString('utf8'));
      response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' });
      response.write(`data: ${JSON.stringify({ type: 'text-delta', delta: 'Production comparison answer.' })}\n\n`);
      response.write(`data: ${JSON.stringify({
        type: 'tool-output-available',
        output: { hits: [{ title: 'Production source', url: 'https://www.algolia.com/doc/' }] },
      })}\n\n`);
      response.end();
      return;
    }
    try {
      const target = normalize(localPath(request.url || '/'));
      const body = await readFile(target);
      response.writeHead(200, {
        'content-type': extname(target) === '.js' ? 'application/javascript' : 'text/html; charset=utf-8',
        'cache-control': 'no-store',
      });
      response.end(body);
    } catch (error) {
      response.writeHead(404, { 'content-type': 'text/plain' });
      response.end(String(error));
    }
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({ server, productionBodies, baseUrl: `http://127.0.0.1:${address.port}` });
    });
  });
}

test('real widget sends the exact finalized body once and isolates the Production panel', async () => {
  const { server, productionBodies, baseUrl } = await startServer();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  try {
    await page.goto(`${baseUrl}/products/ai-search`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__localParityReady?.path === location.pathname, null, { timeout: 10_000 });
    await page.evaluate(() => document.querySelector('algolia-chat').open());
    await page.waitForFunction(() => document.querySelector('algolia-chat')?.shadowRoot, null, { timeout: 10_000 });
    await page.evaluate(() => {
      const root = document.querySelector('algolia-chat').shadowRoot;
      const control = [...root.querySelectorAll('button')].find((button) =>
        /maximize|expand to full view/i.test(`${button.title} ${button.getAttribute('aria-label') || ''}`)
      );
      control?.click();
    });
    await page.waitForFunction(() =>
      document.querySelector('algolia-chat')?.shadowRoot?.querySelector('#acs-compare-toggle')
    , null, { timeout: 10_000 });
    await page.evaluate(() => document.querySelector('algolia-chat').ask('Use the exact same packet.'));
    await page.waitForFunction(() => {
      const root = document.querySelector('algolia-chat')?.shadowRoot;
      return window.__localOrchestratorRequestBodies?.length === 1 &&
        root?.textContent?.includes('Here is the practical implementation path') &&
        root?.querySelector('#acs-compare-toggle')?.textContent?.includes('Compare latest with production');
    }, null, { timeout: 10_000 });

    await page.evaluate(() =>
      document.querySelector('algolia-chat').shadowRoot.querySelector('#acs-compare-toggle').click()
    );
    await page.waitForFunction(() => {
      const root = document.querySelector('algolia-chat')?.shadowRoot;
      return window.__localOrchestratorRequestBodies?.length === 1 &&
        root?.querySelector('#acs-compare-panel')?.textContent?.includes('Production comparison answer.');
    }, null, { timeout: 10_000 });

    assert.equal(productionBodies.length, 1, 'one accepted question produces one Production request');
    const primaryBody = await page.evaluate(() => window.__localOrchestratorRequestBodies[0]);
    assert.equal(productionBodies[0], primaryBody, 'the final outbound body bytes must be identical');

    const proof = await page.evaluate(() => {
      const root = document.querySelector('algolia-chat').shadowRoot;
      return {
        togglePressed: root.querySelector('#acs-compare-toggle')?.getAttribute('aria-pressed'),
        toggleDisabled: root.querySelector('#acs-compare-toggle')?.getAttribute('aria-disabled'),
        productionText: root.querySelector('#acs-compare-panel')?.textContent,
        primaryText: root.textContent,
      };
    });
    assert.equal(proof.togglePressed, 'true');
    assert.equal(proof.toggleDisabled, null);
    assert.match(proof.productionText, /Production comparison answer/);
    assert.match(proof.primaryText, /Here is the practical implementation path/);

    await page.evaluate(() => document.dispatchEvent(new CustomEvent('algolia-visitor-state-reset')));
    await page.waitForFunction(() => {
      const toggle = document.querySelector('algolia-chat')?.shadowRoot?.querySelector('#acs-compare-toggle');
      return toggle?.getAttribute('aria-pressed') === 'false' &&
        toggle?.getAttribute('aria-disabled') !== 'true';
    }, null, { timeout: 10_000 });
  } finally {
    await context.close();
    await browser.close();
    server.close();
  }
});
