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

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
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
  await page.waitForFunction(() => window.__localParityReady?.path === location.pathname);
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
    return current?.maxScrollDepth >= 30;
  });
}

async function waitForCommittedAnswer(page, expectedText) {
  await page.waitForFunction(
    (text) => {
      const conversation = JSON.parse(
        sessionStorage.getItem('algolia-chat:conversation') || 'null'
      );
      const segment = conversation?.turns?.at(-1)?.segments?.at(-1);
      const root = document.querySelector('algolia-chat')?.shadowRoot;
      return segment?.status === 'success' &&
        segment.text.includes(text) &&
        root?.textContent?.includes(text);
    },
    expectedText,
    { timeout: 10_000 }
  );
}

test('local parity proves one greeting, one proactive handoff, and one grounded orchestrator answer', async () => {
  const { server, baseUrl } = await startServer();
  const browser = await chromium.launch({ headless: process.env.HEADED !== '1' });
  const context = await browser.newContext();
  await context.addInitScript(() => {
    window.__localParityReadinessEvents = [];
    document.addEventListener('algolia-local-parity-ready', (event) => {
      window.__localParityReadinessEvents.push(event.detail);
    });
  });
  const page = await context.newPage();

  try {
    await page.goto(`${baseUrl}/products/ai-search`, { waitUntil: 'domcontentloaded' });
    await waitForRuntime(page);
    await qualifyCurrentPage(page);
    await page.waitForFunction(() => {
      const state = JSON.parse(sessionStorage.getItem('algolia_proactive_state') || '{}');
      return (state.opportunities || []).some(
        (item) => item.trigger === 'product_page_3s_30_scroll' && item.status === 'shown'
      );
    });

    await page.evaluate(() => document.querySelector('algolia-chat').ask('Implementation reality'));

    await waitForCommittedAnswer(page, 'Here is the practical implementation path');
    await page.waitForFunction(
      () => window.__localGreetingCalls === 1 && window.__localOrchestratorCalls === 1
    );

    const proof = await page.evaluate(() => {
      const state = JSON.parse(sessionStorage.getItem('algolia_proactive_state') || '{}');
      const opportunity = (state.opportunities || []).find(
        (item) => item.trigger === 'product_page_3s_30_scroll'
      );
      const root = document.querySelector('algolia-chat').shadowRoot;
      return {
        greetingCalls: window.__localGreetingCalls,
        orchestratorCalls: window.__localOrchestratorCalls,
        orchestratorRequest: window.__localOrchestratorRequests?.[0] || null,
        status: opportunity?.status,
        sourceRendered: Boolean(root.querySelector('.acs-source-section')),
        discoveryRendered: Boolean(root.querySelector('.acs-followup-wrap')),
        shadowText: root.textContent.replace(/\s+/g, ' ').trim().slice(0, 1600),
        answerClasses: [...root.querySelectorAll('[class]')]
          .map((node) => node.className)
          .filter((value) => typeof value === 'string' && value.includes('acs-')),
      };
    });

    assert.equal(proof.greetingCalls, 1);
    assert.equal(proof.orchestratorCalls, 1);
    assert.match(
      proof.orchestratorRequest?.messages?.at(-1)?.parts?.[0]?.text || '',
      /PROACTIVE_HANDOFF_CONTEXT/
    );
    assert.equal(proof.status, 'active');
    assert.equal(proof.sourceRendered, true);
    assert.equal(
      proof.discoveryRendered,
      true,
      JSON.stringify({ shadowText: proof.shadowText, answerClasses: proof.answerClasses })
    );

    const sessionBeforeNavigation = await page.evaluate(() => {
      const session = JSON.parse(sessionStorage.getItem('algolia_session') || '{}');
      return session.sessionId;
    });
    await page.locator(
      'a[href="/doc/guides/building-search-ui/what-is-instantsearch/js/"]'
    ).first().click();
    await page.waitForURL(
      (url) => url.pathname === '/doc/guides/building-search-ui/what-is-instantsearch/js/'
    );
    await waitForRuntime(page);
    await waitForCommittedAnswer(page, 'Here is the practical implementation path');
    assert.equal(
      await page.evaluate(() => window.__localParityReadinessEvents.length),
      1,
      'destination readiness event count'
    );

    await page.evaluate(() =>
      document
        .querySelector('algolia-chat')
        .ask('Bring in the Developer Specialist to plan a safe InstantSearch migration.')
    );
    await page.waitForFunction(() => {
      const requests = JSON.parse(
        sessionStorage.getItem('algolia-local-orchestrator-requests') || '[]'
      );
      return requests.length === 2;
    });

    const continuity = await page.evaluate(() => {
      const session = JSON.parse(sessionStorage.getItem('algolia_session') || '{}');
      const state = JSON.parse(sessionStorage.getItem('algolia_proactive_state') || '{}');
      const requests = JSON.parse(
        sessionStorage.getItem('algolia-local-orchestrator-requests') || '[]'
      );
      const lastRequest = requests.at(-1);
      const lastUser = [...(lastRequest?.messages || [])]
        .reverse()
        .find((message) => message.role === 'user');
      return {
        sessionId: session.sessionId,
        activeCount: (state.opportunities || []).filter((item) => item.status === 'active').length,
        shownCount: (state.opportunities || []).filter((item) => item.status === 'shown').length,
        lastUserText: lastUser?.parts?.find((part) => part.type === 'text')?.text || '',
        currentPath: lastUser?.metadata?.turnContext?.current_page || null,
      };
    });

    assert.equal(continuity.sessionId, sessionBeforeNavigation);
    assert.equal(continuity.activeCount, 1);
    assert.equal(continuity.shownCount, 0);
    assert.match(continuity.lastUserText, /PROACTIVE_HANDOFF_CONTEXT/);
    assert.equal(
      continuity.currentPath,
      '/doc/guides/building-search-ui/what-is-instantsearch/js/'
    );
    try {
      await page.getByRole('button', { name: 'Yes, go deeper' }).waitFor({ timeout: 5_000 });
    } catch (error) {
      const diagnostic = await page.evaluate(() => {
        const requests = JSON.parse(
          sessionStorage.getItem('algolia-local-orchestrator-requests') || '[]'
        );
        const lastUser = [...(requests.at(-1)?.messages || [])]
          .reverse()
          .find((message) => message.role === 'user');
        return {
          lastUserText: lastUser?.parts?.find((part) => part.type === 'text')?.text || '',
          agentMarkup: document.querySelector('algolia-chat')?.innerHTML || '',
          chatText: document
            .querySelector('algolia-chat')
            ?.shadowRoot?.querySelector('.algolia-chat-root')?.textContent,
        };
      });
      throw new Error(`specialist consent did not render: ${JSON.stringify(diagnostic)}`, {
        cause: error,
      });
    }
    const specialistCallsBeforeConsent = await page.evaluate(() =>
      JSON.parse(sessionStorage.getItem('algolia-local-specialist-requests') || '[]').length
    );
    assert.equal(specialistCallsBeforeConsent, 0);

    await page.getByRole('button', { name: 'Yes, go deeper' }).click();
    await page.waitForFunction(() => {
      const requests = JSON.parse(
        sessionStorage.getItem('algolia-local-specialist-requests') || '[]'
      );
      const root = document.querySelector('algolia-chat')?.shadowRoot;
      return requests.length === 1 && root?.textContent?.includes('Use a staged indexing rollout');
    });

    const specialistProof = await page.evaluate(() => {
      const requests = JSON.parse(
        sessionStorage.getItem('algolia-local-specialist-requests') || '[]'
      );
      const root = document.querySelector('algolia-chat').shadowRoot;
      return {
        requests,
        developerLabelRendered: root.textContent.includes('Developer Specialist'),
      };
    });
    assert.equal(specialistProof.requests.length, 1);
    assert.equal(specialistProof.requests[0].agentId, 'local_tech_agent');
    assert.equal(specialistProof.developerLabelRendered, true);
  } finally {
    await context.close();
    await browser.close();
    server.close();
  }
});
