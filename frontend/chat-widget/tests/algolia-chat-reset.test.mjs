import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';

const chatPath = new URL('../algolia-chat.js', import.meta.url);
const resetEventName = 'algolia-visitor-reset-requested';

let browser;

before(async () => {
  browser = await chromium.launch({ headless: true });
});

after(async () => {
  await browser?.close();
});

test('Assistant logo reset emits one bubbling composed request from the widget', async () => {
  const page = await browser.newPage();
  try {
    await page.route('**/*', async (route) => {
      if (route.request().isNavigationRequest()) {
        await route.fulfill({
          status: 200,
          contentType: 'text/html',
          body: '<!doctype html><html><body></body></html>',
        });
        return;
      }
      if (/\.algolia\.(net|com)\//.test(route.request().url())) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            results: [{ hits: [], nbHits: 0, page: 0, nbPages: 0, hitsPerPage: 0 }],
          }),
        });
        return;
      }
      await route.continue();
    });

    await page.goto('http://localhost/');
    await page.evaluate(() => {
      sessionStorage.setItem(
        'algolia-chat:conversation',
        JSON.stringify({
          version: 1,
          conversationId: 'persisted-conversation',
          turns: [{
            id: 'turn-1',
            query: 'Existing question',
            handoff: false,
            deepDiveOffered: false,
            segments: [{
              agent: 'primary',
              status: 'success',
              text: 'Existing answer',
              sources: [],
              searchCount: 0,
            }],
          }],
        }),
      );
    });
    await page.addScriptTag({ content: fs.readFileSync(chatPath, 'utf8') });
    await page.evaluate(async (eventName) => {
      await Promise.all([
        customElements.whenDefined('algolia-instant-search'),
        customElements.whenDefined('algolia-chat'),
        customElements.whenDefined('algolia-agent'),
      ]);

      const search = document.createElement('algolia-instant-search');
      search.setAttribute('app-id', 'test-app');
      search.setAttribute('api-key', 'test-search-key');
      search.setAttribute('index-name', 'test-index');
      const widget = document.createElement('algolia-chat');
      widget.setAttribute('brand-name', 'Algolia');
      widget.setAttribute('judge-mode', 'off');
      const agent = document.createElement('algolia-agent');
      agent.setAttribute('role', 'primary');
      agent.setAttribute('agent-id', 'test-agent');
      widget.append(agent);
      search.append(widget);
      document.body.append(search);

      window.__widgetResetEvents = [];
      window.__documentResetEvents = [];
      widget.addEventListener(eventName, (event) => {
        window.__widgetResetEvents.push({
          bubbles: event.bubbles,
          composed: event.composed,
          target: event.target?.tagName,
        });
      });
      document.addEventListener(eventName, (event) => {
        window.__documentResetEvents.push({
          bubbles: event.bubbles,
          composed: event.composed,
          target: event.target?.tagName,
        });
      });
      widget.open();
    }, resetEventName);

    const reset = page.getByRole('button', { name: /Algolia.*reset conversation/i });
    await reset.waitFor({ state: 'visible' });
    await reset.click();
    await page.waitForFunction(() => window.__documentResetEvents.length === 1);

    const result = await page.evaluate(() => ({
      conversation: sessionStorage.getItem('algolia-chat:conversation'),
      widgetEvents: window.__widgetResetEvents,
      documentEvents: window.__documentResetEvents,
    }));

    assert.equal(result.conversation, null, 'reset must clear the persisted conversation first');
    assert.deepEqual(result.widgetEvents, [
      { bubbles: true, composed: true, target: 'ALGOLIA-CHAT' },
    ]);
    assert.deepEqual(result.documentEvents, result.widgetEvents);
  } finally {
    await page.close();
  }
});
