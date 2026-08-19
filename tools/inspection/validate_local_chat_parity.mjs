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
  const server = createServer(async (req, res) => {
    try {
      const target = normalize(localPath(req.url || '/'));
      const body = await readFile(target);
      res.writeHead(200, {
        'content-type': mime[extname(target)] || 'application/octet-stream',
        'cache-control': 'no-store',
      });
      res.end(body);
    } catch (error) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end(String(error));
    }
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${address.port}` });
    });
  });
}

function stringifyAgentResponse(packet) {
  return JSON.stringify({
    schema: 'ProactiveGreetingResponse.v1',
    opportunityId: packet.opportunityId,
    greeting:
      'Hello, explorer. Looks like you are comparing the path, not just admiring the scenery. Good. I can help you connect the dots, find proof, or go straight into implementation reality.',
    chips: ['Show customer proof', 'Compare tradeoffs', 'Implementation reality'],
    handoffSummary: {
      moment: packet.moment,
      trigger: packet.trigger,
      messageGoal: packet.messageGoal,
    },
  });
}

async function seedProductJourney(page) {
  await page.evaluate(() => {
    const now = Date.now();
    const sessionId = 'local_sess_123';
    const productPage = {
      pageId: 'page_ai_search',
      path: '/products/ai-search',
      url: `${location.origin}/products/ai-search`,
      title: 'AI Search | Local Chat Parity',
      enteredAt: now - 40000,
      dwellMs: 18000,
      maxScrollDepth: 75,
      pageGroup: 'product',
      topic: 'ai_search',
      productFocus: 'ai_search',
      productFocusLabel: 'AI Search',
    };
    const currentPage = {
      pageId: 'page_recommendations',
      path: '/products/ai-recommendations',
      url: `${location.origin}/products/ai-recommendations`,
      title: 'AI Recommendations | Local Chat Parity',
      enteredAt: now - 16000,
      dwellMs: 12000,
      maxScrollDepth: 55,
      pageGroup: 'product',
      topic: 'ai_search',
      productFocus: 'recommendations',
      productFocusLabel: 'AI Recommendations',
    };
    localStorage.setItem(
      'algolia_profile',
      JSON.stringify({
        schema: 'AlgoliaEngagementProfile.v1',
        visitorId: 'visitor_local',
        persona: { value: 'merchandiser', state: 'confirmed', source: 'local_test' },
        visits: 1,
        firstSeenAt: now - 60000,
        lastSeenAt: now,
      })
    );
    sessionStorage.setItem(
      'algolia_session',
      JSON.stringify({
        schema: 'AlgoliaEngagementSession.v1',
        sessionId,
        startedAt: now - 60000,
        lastSeenAt: now,
        currentPageId: currentPage.pageId,
        pages: [productPage, currentPage],
        engagementHistory: [],
      })
    );
    sessionStorage.setItem(
      'algolia_events',
      JSON.stringify({
        schema: 'AlgoliaEngagementEvents.v1',
        sessionId,
        events: [
          {
            eventId: 'evt_ai_search',
            name: 'page_view',
            ts: now - 40000,
            pageId: productPage.pageId,
            path: productPage.path,
            source: 'observed',
            props: {
              pageGroup: 'product',
              topic: 'ai_search',
              productFocus: 'ai_search',
              productFocusLabel: 'AI Search',
            },
          },
          {
            eventId: 'evt_recommendations',
            name: 'scroll_depth',
            ts: now - 1000,
            pageId: currentPage.pageId,
            path: currentPage.path,
            source: 'observed',
            props: {
              depth: 55,
              pageGroup: 'product',
              topic: 'ai_search',
              productFocus: 'recommendations',
              productFocusLabel: 'AI Recommendations',
            },
          },
        ],
      })
    );
  });
}

async function installQualifiedAiSearchSeed(page) {
  await page.addInitScript(() => {
    if (location.pathname !== '/products/ai-search') return;
    const now = Date.now();
    const sessionId = 'local_docs_sess_123';
    const productPage = {
      pageId: 'page_ai_search',
      path: '/products/ai-search',
      url: `${location.origin}/products/ai-search`,
      title: 'AI Search | Local Chat Parity',
      enteredAt: now - 7000,
      dwellMs: 5000,
      maxScrollDepth: 25,
      pageGroup: 'product',
      topic: 'ai_search',
      productFocus: 'ai_search',
      productFocusLabel: 'AI Search',
    };
    sessionStorage.setItem(
      'algolia_session',
      JSON.stringify({
        schema: 'AlgoliaEngagementSession.v1',
        sessionId,
        startedAt: now - 7000,
        lastSeenAt: now,
        currentPageId: productPage.pageId,
        pages: [productPage],
        engagementHistory: [],
      })
    );
    sessionStorage.setItem(
      'algolia_events',
      JSON.stringify({
        schema: 'AlgoliaEngagementEvents.v1',
        sessionId,
        events: [{
          eventId: 'evt_ai_search_qualified',
          name: 'scroll_depth',
          ts: now,
          pageId: productPage.pageId,
          path: productPage.path,
          source: 'observed',
          props: {
            depth: 50,
            pageGroup: 'product',
            topic: 'ai_search',
            productFocus: 'ai_search',
            productFocusLabel: 'AI Search',
          },
        }],
      })
    );
  });
}

async function main() {
  const { server, baseUrl } = await startServer();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const consoleLines = [];
  const agentCalls = [];
  page.on('console', (message) => consoleLines.push(`${message.type()}: ${message.text()}`));

  await page.route('**/agent-studio/1/agents/**/completions?**', async (route) => {
    const requestBody = route.request().postDataJSON();
    agentCalls.push(requestBody);
    const text = requestBody?.messages?.[0]?.parts?.[0]?.text || '';
    const packet = JSON.parse(text.replace(/^PROACTIVE_GREETING_REQUEST\s*/, ''));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: stringifyAgentResponse(packet),
    });
  });

  try {
    await page.goto(`${baseUrl}/products/ai-recommendations?algoliaChatDebug=1&algoliaProactiveDebug=1`, {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForFunction(() => !!window.algoliaProactiveController && !!window.algoliaContextCompiler);
    await seedProductJourney(page);
    await page.evaluate(() => {
      document.dispatchEvent(
        new CustomEvent('algolia-engagement-signal', {
          detail: {
            eventId: 'evt_test_signal',
            name: 'scroll_depth',
            ts: Date.now(),
            pageId: 'page_recommendations',
            path: '/products/ai-recommendations',
            props: { depth: 55 },
          },
        })
      );
    });
    try {
      await page.waitForFunction(() => {
        const state = JSON.parse(sessionStorage.getItem('algolia_proactive_state') || '{}');
        return (state.opportunities || []).some((item) => item.status === 'shown');
      }, null, { timeout: 8000 });
    } catch (error) {
      const diagnostic = await page.evaluate(() => ({
        profile: localStorage.getItem('algolia_profile'),
        session: sessionStorage.getItem('algolia_session'),
        events: sessionStorage.getItem('algolia_events'),
        proactiveState: sessionStorage.getItem('algolia_proactive_state'),
        debug: window.algoliaProactiveController?.debug?.(),
        hasChat: !!document.querySelector('algolia-chat'),
        hasChatEngage: !!document.querySelector('algolia-chat-engage'),
        hasCompiler: !!window.algoliaContextCompiler,
      }));
      console.error(JSON.stringify({ waitFailure: error.message, diagnostic, consoleLines }, null, 2));
      throw error;
    }

    const result = await page.evaluate(() => {
      const profile = JSON.parse(localStorage.getItem('algolia_profile') || '{}');
      const session = JSON.parse(sessionStorage.getItem('algolia_session') || '{}');
      const events = JSON.parse(sessionStorage.getItem('algolia_events') || '{}');
      const packet = window.algoliaContextCompiler.compile();
      const debug = window.algoliaProactiveController.debug();
      return {
        storage: {
          hasProfile: !!profile.schema,
          hasSession: !!session.schema,
          hasEvents: Array.isArray(events.events),
          pageCount: session.pages?.length || 0,
          eventCount: events.events?.length || 0,
        },
        packet: {
          schema: packet.schema,
          currentPath: packet.currentPage?.path,
          productTrail: packet.session?.journey?.productTrail || [],
        },
        decision: debug.decision,
        opportunities: debug.state.opportunities,
        shownOpportunity: debug.state.opportunities.find((item) => item.status === 'shown') || null,
        traceStages: debug.trace.map((entry) => entry.stage),
        localAgentCalls: window.__localAgentCalls || 0,
      };
    });

    assert.equal(result.storage.hasProfile, true);
    assert.equal(result.storage.hasSession, true);
    assert.equal(result.storage.hasEvents, true);
    assert.ok(result.storage.pageCount >= 1);
    assert.ok(result.storage.eventCount >= 2);
    assert.equal(result.packet.schema, 'AlgoliaContextPacket.v1');
    assert.equal(result.packet.currentPath, '/products/ai-recommendations');
    assert.ok(result.shownOpportunity?.requestPacket?.journey?.length >= 2);
    assert.ok(result.shownOpportunity?.requestPacket?.journeySummary?.productTrail?.length >= 2);
    assert.equal(result.localAgentCalls + agentCalls.length, 1);
    assert.ok(result.opportunities.some((item) => item.status === 'shown'));
    assert.ok(result.traceStages.includes('greeting_response_parsed'));
    assert.ok(result.traceStages.includes('widget_rendered'));

    await installQualifiedAiSearchSeed(page);
    await page.goto(`${baseUrl}/products/ai-search?algoliaChatDebug=1&algoliaProactiveDebug=1`, {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForFunction(() => !!window.algoliaEngagementTracker && !!window.algoliaContextCompiler);

    const docsCta = page.locator('a[data-local-action="cta_docs"]');
    assert.equal(
      await docsCta.getAttribute('href'),
      '/doc/guides/building-search-ui/what-is-instantsearch/js/'
    );
    await docsCta.click();
    await page.waitForURL('**/doc/guides/building-search-ui/what-is-instantsearch/js/');
    await page.waitForFunction(() => {
      const packet = window.algoliaContextCompiler?.compile?.();
      return packet?.currentPage?.path === '/doc/guides/building-search-ui/what-is-instantsearch/js/';
    });

    const docsContinuity = await page.evaluate(() => {
      const session = JSON.parse(sessionStorage.getItem('algolia_session') || '{}');
      return {
        sessionId: session.sessionId,
        currentPath: session.pages?.find((item) => item.pageId === session.currentPageId)?.path,
        qualifiedProduct: session.pages?.find((item) => item.pageId === 'page_ai_search') || null,
      };
    });
    assert.equal(docsContinuity.sessionId, 'local_docs_sess_123');
    assert.equal(docsContinuity.currentPath, '/doc/guides/building-search-ui/what-is-instantsearch/js/');
    assert.equal(docsContinuity.qualifiedProduct?.dwellMs, 5000);
    assert.equal(docsContinuity.qualifiedProduct?.maxScrollDepth, 25);

    console.log(
      JSON.stringify(
        {
          pass: true,
          baseUrl,
          currentPath: result.packet.currentPath,
          storage: result.storage,
          shownOpportunity: {
            id: result.shownOpportunity.id,
            status: result.shownOpportunity.status,
            moment: result.shownOpportunity.moment,
            trigger: result.shownOpportunity.trigger,
            journeyLength: result.shownOpportunity.requestPacket.journey.length,
            productTrail: result.shownOpportunity.requestPacket.journeySummary.productTrail,
          },
          traceStages: result.traceStages.slice(-8),
          agentCalls: agentCalls.length + result.localAgentCalls,
          docsContinuity,
        },
        null,
        2
      )
    );
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
