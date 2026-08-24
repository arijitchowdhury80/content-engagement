#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const chatDir = join(root, 'frontend', 'chat-widget');
const siteDir = join(root, 'local-sites', 'algolia-com-parity');
const fixturePath = join(siteDir, 'index.html');

const scenarios = [
  {
    trigger: 'product_to_documentation',
    sourceTrigger: 'product_page_3s_30_scroll',
    sourcePath: '/products/features/ui-component-libraries',
    sourceLabel: 'UI Component Libraries',
    targetPath: '/doc/guides/building-search-ui/what-is-instantsearch/js/',
    targetSelector: 'a[href="/doc/guides/building-search-ui/what-is-instantsearch/js/"]',
    qualifyTarget: true,
    greetingPattern: /documentation/i,
  },
  {
    trigger: 'solution_to_customer_story',
    sourceTrigger: 'solution_page_3s_30_scroll',
    sourcePath: '/solutions/ecommerce',
    sourceLabel: 'Ecommerce',
    targetPath: '/customers/harry-rosen',
    targetSelector: 'a[href="/customers/harry-rosen"]',
    qualifyTarget: true,
    greetingPattern: /customer proof/i,
  },
  {
    trigger: 'product_to_pricing',
    sourceTrigger: 'product_page_3s_30_scroll',
    sourcePath: '/products/ai-recommendations',
    sourceLabel: 'AI Recommendations',
    targetPath: '/pricing',
    targetSelector: 'a[href="/pricing"]',
    qualifyTarget: false,
    greetingPattern: /pricing/i,
  },
  {
    trigger: 'solution_to_pricing',
    sourceTrigger: 'solution_page_3s_30_scroll',
    sourcePath: '/solutions/marketplace',
    sourceLabel: 'Marketplace',
    targetPath: '/pricing',
    targetSelector: 'a[href="/pricing"]',
    qualifyTarget: false,
    greetingPattern: /pricing/i,
  },
];

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
};

function localPath(urlPath) {
  const path = urlPath.split('?')[0].split('#')[0];
  if (path.startsWith('/chat/')) return join(chatDir, path.replace('/chat/', ''));
  if (path === '/' || !extname(path)) return fixturePath;
  return join(siteDir, path.replace(/^\//, ''));
}

function startServer() {
  const server = createServer(async (request, response) => {
    try {
      const target = normalize(localPath(request.url || '/'));
      const body = await readFile(target);
      response.writeHead(200, {
        'content-type': mime[extname(target)] || 'application/octet-stream',
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
      resolve({ server, baseUrl: `http://127.0.0.1:${address.port}` });
    });
  });
}

async function waitForRuntime(page) {
  await page.waitForFunction(
    () => window.__localParityReady?.path === location.pathname
  );
}

async function qualifyCurrentPage(page) {
  await page.waitForFunction(() => {
    const session = JSON.parse(sessionStorage.getItem('algolia_session') || '{}');
    const current = (session.pages || []).find(
      (item) => item.pageId === session.currentPageId
    );
    return current?.path === location.pathname && current?.dwellMs >= 3_000;
  });
  await page.evaluate(() => {
    const root = document.scrollingElement || document.documentElement;
    window.scrollTo(0, root.scrollHeight);
  });
  await page.waitForFunction(() => {
    const session = JSON.parse(sessionStorage.getItem('algolia_session') || '{}');
    const current = (session.pages || []).find(
      (item) => item.pageId === session.currentPageId
    );
    return current?.dwellMs >= 3_000 && current?.maxScrollDepth >= 30;
  });
}

async function waitForShownOpportunity(page, trigger) {
  await page.waitForFunction(
    (expectedTrigger) => {
      const state = JSON.parse(
        sessionStorage.getItem('algolia_proactive_state') || '{}'
      );
      return (state.opportunities || []).some(
        (item) => item.trigger === expectedTrigger && item.status === 'shown'
      );
    },
    trigger,
    { timeout: 15_000 }
  );
}

async function runScenario(browser, baseUrl, scenario) {
  const context = await browser.newContext();
  await context.addInitScript(() => {
    localStorage.setItem('algoliaDebug', '1');
    window.__localParityReadinessEvents = [];
    document.addEventListener('algolia-local-parity-ready', (event) => {
      window.__localParityReadinessEvents.push(event.detail);
    });
  });
  const page = await context.newPage();
  try {
    await page.goto(`${baseUrl}${scenario.sourcePath}`, {
      waitUntil: 'domcontentloaded',
    });
    await waitForRuntime(page);
    await qualifyCurrentPage(page);
    await waitForShownOpportunity(page, scenario.sourceTrigger);

    const source = await page.evaluate(() => {
      const session = JSON.parse(sessionStorage.getItem('algolia_session') || '{}');
      const current = (session.pages || []).find(
        (item) => item.pageId === session.currentPageId
      );
      return {
        sessionId: session.sessionId,
        qualified: current?.dwellMs >= 3_000 && current?.maxScrollDepth >= 30,
        readinessEvents: window.__localParityReadinessEvents.length,
      };
    });

    await page.locator(scenario.targetSelector).first().click();
    await page.waitForURL((url) => url.pathname === scenario.targetPath);
    await waitForRuntime(page);
    if (scenario.qualifyTarget) await qualifyCurrentPage(page);
    await waitForShownOpportunity(page, scenario.trigger);

    const destination = await page.evaluate((trigger) => {
      const session = JSON.parse(sessionStorage.getItem('algolia_session') || '{}');
      const state = JSON.parse(
        sessionStorage.getItem('algolia_proactive_state') || '{}'
      );
      const opportunity = (state.opportunities || []).find(
        (item) => item.trigger === trigger && item.status === 'shown'
      );
      const broaderJourney =
        opportunity?.requestPacket?.journeyContext?.broaderJourney || {};
      return {
        sessionId: session.sessionId,
        pagePaths: (session.pages || []).map((item) => item.path),
        transitionShown: !!opportunity,
        greeting: opportunity?.greetingResponse?.greeting || '',
        focusLabels: [
          ...(broaderJourney.productTrail || []).map((item) => item.label),
          ...(broaderJourney.solutionTrail || []).map((item) => item.label),
        ],
        traceStages: (window.algoliaProactiveController.debug().trace || []).map(
          (item) => item.stage
        ),
        readinessEvents: window.__localParityReadinessEvents.length,
      };
    }, scenario.trigger);

    assert.equal(destination.sessionId, source.sessionId, `${scenario.trigger}: session changed`);
    assert.equal(source.readinessEvents, 1, `${scenario.trigger}: source readiness event count`);
    assert.ok(destination.pagePaths.includes(scenario.sourcePath));
    assert.ok(destination.pagePaths.includes(scenario.targetPath));
    assert.equal(destination.readinessEvents, 1, `${scenario.trigger}: destination readiness event count`);
    assert.ok(
      destination.focusLabels.includes(scenario.sourceLabel),
      `${scenario.trigger}: greeting packet lost source label ${scenario.sourceLabel}; got ${destination.focusLabels.join(', ')}`
    );
    assert.ok(destination.traceStages.includes('widget_rendered'));
    assert.match(
      destination.greeting,
      scenario.greetingPattern,
      `${scenario.trigger}: greeting did not narrate the transition`
    );

    return {
      trigger: scenario.trigger,
      sourcePath: scenario.sourcePath,
      targetPath: scenario.targetPath,
      sourceQualified: source.qualified,
      sessionPreserved: destination.sessionId === source.sessionId,
      transitionShown: destination.transitionShown,
      greeting: destination.greeting,
      focusLabels: destination.focusLabels,
      pagePaths: destination.pagePaths,
      traceStages: destination.traceStages,
    };
  } finally {
    await context.close();
  }
}

async function main() {
  const { server, baseUrl } = await startServer();
  const browser = await chromium.launch({ headless: process.env.HEADED !== '1' });
  try {
    const results = [];
    for (const scenario of scenarios) {
      results.push(await runScenario(browser, baseUrl, scenario));
    }
    process.stdout.write(JSON.stringify({ pass: true, results }, null, 2));
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
