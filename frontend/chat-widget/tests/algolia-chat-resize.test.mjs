import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';

const chatPath = new URL('../algolia-chat.js', import.meta.url);
const themePath = new URL('../algolia-chat-theme-algolia.js', import.meta.url);

let browser;

before(async () => {
  browser = await chromium.launch({ headless: true });
});

after(async () => {
  await browser?.close();
});

async function createOpenWidgetPage(viewport) {
  const page = await browser.newPage({ viewport });
  await page.route('**/*', async (route) => {
    if (route.request().isNavigationRequest()) {
      await route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<!doctype html><html><body></body></html>',
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: [{ hits: [], nbHits: 0 }] }),
    });
  });
  await page.goto('http://localhost/');
  await page.addScriptTag({ content: fs.readFileSync(themePath, 'utf8') });
  await page.addScriptTag({ content: fs.readFileSync(chatPath, 'utf8') });
  await page.evaluate(async () => {
    await Promise.all([
      customElements.whenDefined('algolia-instant-search'),
      customElements.whenDefined('algolia-chat'),
      customElements.whenDefined('algolia-agent'),
    ]);
    const search = document.createElement('algolia-instant-search');
    search.setAttribute('app-id', 'test-app');
    search.setAttribute('api-key', 'test-key');
    search.setAttribute('index-name', 'test-index');

    const widget = document.createElement('algolia-chat');
    widget.setAttribute('theme', 'algolia');
    widget.setAttribute('default-open-mode', 'normal');
    widget.setAttribute('show-welcome', 'true');

    const agent = document.createElement('algolia-agent');
    agent.setAttribute('role', 'primary');
    agent.setAttribute('agent-id', 'test-agent');
    widget.append(agent);
    search.append(widget);
    document.body.append(search);
    await new Promise((resolve) => setTimeout(resolve, 100));
    widget.open();
  });
  await page.waitForFunction(() =>
    document.querySelector('algolia-chat')?.shadowRoot?.querySelector('[part="panel"]')
  );
  return page;
}

async function panelResizeState(page) {
  return page.evaluate(() => {
    const panel = document.querySelector('algolia-chat').shadowRoot.querySelector('[part="panel"]');
    const style = getComputedStyle(panel);
    const gripStyle = getComputedStyle(panel, '::after');
    return {
      resize: style.resize,
      minWidth: style.minWidth,
      minHeight: style.minHeight,
      maxWidth: style.maxWidth,
      maxHeight: style.maxHeight,
      inlineStyle: panel.getAttribute('style'),
      gripDisplay: gripStyle.display,
      gripContent: gripStyle.content,
    };
  });
}

test('normal desktop modal is user-resizable without changing default geometry', async () => {
  const page = await createOpenWidgetPage({ width: 1280, height: 900 });
  try {
    const state = await panelResizeState(page);

    assert.equal(state.inlineStyle, 'width: var(--algolia-panel-w); height: var(--algolia-panel-h);');
    assert.equal(state.resize, 'both');
    assert.equal(state.minWidth, '720px');
    assert.equal(state.minHeight, '560px');
    assert.equal(state.maxWidth, '1248px');
    assert.equal(state.maxHeight, '868px');
    assert.equal(state.gripDisplay, 'block');
    assert.notEqual(state.gripContent, 'none');
  } finally {
    await page.close();
  }
});

test('mobile modal keeps fixed near-full-screen geometry instead of resize handles', async () => {
  const page = await createOpenWidgetPage({ width: 390, height: 844 });
  try {
    const state = await panelResizeState(page);

    assert.equal(state.resize, 'none');
    assert.equal(state.minWidth, '0px');
    assert.equal(state.minHeight, '0px');
    assert.equal(state.gripDisplay, 'none');
  } finally {
    await page.close();
  }
});
