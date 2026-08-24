#!/usr/bin/env node

import { strict as assert } from 'node:assert';
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
    trigger: 'product_page_3s_30_scroll',
    current: page('/products/ai-search', 'product', 'AI Search'),
  },
  {
    trigger: 'product_to_documentation',
    previous: page(
      '/products/features/ui-component-libraries',
      'product',
      'UI Component Libraries'
    ),
    current: page(
      '/doc/guides/building-search-ui/what-is-instantsearch/js/',
      'documentation',
      'InstantSearch Docs'
    ),
  },
  {
    trigger: 'solution_page_3s_30_scroll',
    current: page('/solutions/ecommerce', 'solution', 'Ecommerce'),
  },
  {
    trigger: 'solution_to_customer_story',
    previous: page('/solutions/ecommerce', 'solution', 'Ecommerce'),
    current: page('/customers/harry-rosen', 'customer_story', 'Harry Rosen'),
  },
  {
    trigger: 'product_to_pricing',
    previous: page('/products/ai-recommendations', 'product', 'AI Recommendations'),
    current: page('/pricing', 'pricing', 'Pricing', false),
  },
  {
    trigger: 'solution_to_pricing',
    previous: page('/solutions/marketplace', 'solution', 'Marketplace'),
    current: page('/pricing', 'pricing', 'Pricing', false),
  },
  {
    trigger: 'developer_page_3s_30_scroll',
    current: page('/developers', 'developer', 'Developer Hub'),
  },
  {
    trigger: 'resource_page_3s_30_scroll',
    current: page('/resources', 'resource', 'Resources'),
  },
];

function page(path, pageGroup, label, qualified = true) {
  const slug = path.replace(/\W+/g, '_').replace(/^_|_$/g, '') || 'home';
  return {
    pageId: `page_${slug}`,
    path,
    url: `http://local.test${path}`,
    title: label,
    enteredAt: Date.now() - (qualified ? 15000 : 1000),
    dwellMs: qualified ? 12000 : 0,
    maxScrollDepth: qualified ? 55 : 0,
    pageGroup,
    topic: slug,
    ...(pageGroup === 'product'
      ? { productFocus: slug, productFocusLabel: label }
      : {}),
    ...(pageGroup === 'solution'
      ? { solutionFocus: slug, solutionFocusLabel: label }
      : {}),
  };
}

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

async function seedScenario(pageHandle, scenario) {
  await pageHandle.evaluate(({ current, previous }) => {
    const now = Date.now();
    const currentPage = { ...current, url: `${location.origin}${current.path}` };
    const previousPage = previous
      ? { ...previous, url: `${location.origin}${previous.path}` }
      : null;
    const pages = previousPage ? [previousPage, currentPage] : [currentPage];
    const sessionId = `local_${currentPage.pageId}`;

    localStorage.setItem(
      'algolia_profile',
      JSON.stringify({
        schema: 'AlgoliaEngagementProfile.v1',
        visitorId: `visitor_${currentPage.pageId}`,
        visits: 1,
        firstSeenAt: now - 30000,
        lastSeenAt: now,
      })
    );
    sessionStorage.setItem(
      'algolia_session',
      JSON.stringify({
        schema: 'AlgoliaEngagementSession.v1',
        sessionId,
        startedAt: now - 30000,
        lastSeenAt: now,
        currentPageId: currentPage.pageId,
        pages,
        engagementHistory: [],
      })
    );
    sessionStorage.setItem(
      'algolia_events',
      JSON.stringify({
        schema: 'AlgoliaEngagementEvents.v1',
        sessionId,
        events: pages.map((item, index) => ({
          eventId: `evt_${index}_${item.pageId}`,
          name: index === pages.length - 1 ? 'scroll_depth' : 'page_view',
          ts: now - (pages.length - index) * 1000,
          pageId: item.pageId,
          path: item.path,
          source: 'observed',
          props: {
            depth: item.maxScrollDepth,
            pageGroup: item.pageGroup,
            topic: item.topic,
            productFocus: item.productFocus,
            productFocusLabel: item.productFocusLabel,
            solutionFocus: item.solutionFocus,
            solutionFocusLabel: item.solutionFocusLabel,
          },
        })),
      })
    );
    sessionStorage.removeItem('algolia_proactive_state');
    sessionStorage.removeItem('algolia-chat:conversation');
  }, scenario);
}

async function runScenario(browser, baseUrl, scenario) {
  const context = await browser.newContext();
  const pageHandle = await context.newPage();

  try {
    await pageHandle.goto(
      `${baseUrl}${scenario.current.path}?algoliaChatDebug=1&algoliaProactiveDebug=1`,
      { waitUntil: 'domcontentloaded' }
    );
    await pageHandle.waitForFunction(
      () => !!window.algoliaProactiveController && !!window.algoliaContextCompiler
    );
    await seedScenario(pageHandle, scenario);

    const preview = await pageHandle.evaluate(() => window.algoliaProactiveController.evaluate());
    assert.equal(preview.engage, true, `${scenario.trigger}: expected an eligible opportunity`);
    assert.equal(preview.trigger, scenario.trigger);

    await pageHandle.evaluate(() => {
      document.dispatchEvent(
        new CustomEvent('algolia-engagement-signal', {
          detail: { name: 'journey_validation', ts: Date.now(), path: location.pathname },
        })
      );
    });
    try {
      await pageHandle.waitForFunction(
        (trigger) => {
          const state = JSON.parse(sessionStorage.getItem('algolia_proactive_state') || '{}');
          return (state.opportunities || []).some(
            (opportunity) => opportunity.trigger === trigger && opportunity.status === 'shown'
          );
        },
        scenario.trigger,
        { timeout: 8000 }
      );
    } catch (error) {
      const diagnostic = await pageHandle.evaluate(() => window.algoliaProactiveController.debug());
      throw new Error(
        `${scenario.trigger}: opportunity did not reach shown\n${JSON.stringify(diagnostic, null, 2)}`,
        { cause: error }
      );
    }

    return await pageHandle.evaluate((trigger) => {
      const debug = window.algoliaProactiveController.debug();
      const opportunity = debug.state.opportunities.find(
        (item) => item.trigger === trigger && item.status === 'shown'
      );
      return {
        trigger,
        currentPath: debug.packet?.currentPage?.path,
        agentCalls: window.__localAgentCalls || 0,
        opportunityId: opportunity?.id,
        journeyLength: opportunity?.requestPacket?.journey?.length || 0,
        traceStages: debug.trace.map((entry) => entry.stage),
      };
    }, scenario.trigger);
  } finally {
    await context.close();
  }
}

async function main() {
  const { server, baseUrl } = await startServer();
  const browser = await chromium.launch({ headless: true });

  try {
    const results = [];
    for (const scenario of scenarios) {
      const result = await runScenario(browser, baseUrl, scenario);
      assert.equal(result.agentCalls, 1, `${scenario.trigger}: expected one greeting call`);
      assert.ok(result.opportunityId, `${scenario.trigger}: missing opportunity ID`);
      assert.ok(result.traceStages.includes('widget_rendered'));
      if (scenario.previous) assert.equal(result.journeyLength, 2);
      results.push(result);
    }
    console.log(JSON.stringify({ pass: true, count: results.length, baseUrl, results }, null, 2));
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
