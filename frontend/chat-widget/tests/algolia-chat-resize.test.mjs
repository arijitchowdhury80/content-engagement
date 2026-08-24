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

async function createOpenWidgetPage(viewport, { openMode = 'normal' } = {}) {
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
  await page.evaluate(async (mode) => {
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
    widget.setAttribute('default-open-mode', mode);
    widget.setAttribute('show-welcome', 'true');

    const agent = document.createElement('algolia-agent');
    agent.setAttribute('role', 'primary');
    agent.setAttribute('agent-id', 'test-agent');
    widget.append(agent);
    search.append(widget);
    document.body.append(search);
    await new Promise((resolve) => setTimeout(resolve, 100));
    widget.open();
  }, openMode);
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
    const rect = panel.getBoundingClientRect();
    return {
      resize: style.resize,
      minWidth: style.minWidth,
      minHeight: style.minHeight,
      maxWidth: style.maxWidth,
      maxHeight: style.maxHeight,
      inlineStyle: panel.getAttribute('style'),
      gripDisplay: gripStyle.display,
      gripContent: gripStyle.content,
      rect: {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      },
    };
  });
}

async function dragPanelCorner(page, deltaX, deltaY) {
  const before = await panelResizeState(page);
  await page.mouse.move(
    before.rect.x + before.rect.width - 3,
    before.rect.y + before.rect.height - 3
  );
  await page.mouse.down();
  await page.mouse.move(
    before.rect.x + before.rect.width + deltaX,
    before.rect.y + before.rect.height + deltaY,
    { steps: 12 }
  );
  await page.mouse.up();
  await page.waitForTimeout(200);
  return { before, after: await panelResizeState(page) };
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

    const dragged = await dragPanelCorner(page, 80, 60);
    assert.ok(
      dragged.after.rect.width > dragged.before.rect.width,
      `expected drag to increase width: ${JSON.stringify(dragged)}`
    );
    assert.ok(
      dragged.after.rect.height > dragged.before.rect.height,
      `expected drag to increase height: ${JSON.stringify(dragged)}`
    );
    assert.equal(dragged.after.resize, 'both');
    assert.equal(dragged.after.gripDisplay, 'block');
    assert.match(dragged.after.inlineStyle, /width: \d+px; height: \d+px;/);
  } finally {
    await page.close();
  }
});

test('normal desktop modal remains resizable after answer content renders', async () => {
  const page = await createOpenWidgetPage({ width: 1280, height: 900 });
  try {
    await page.evaluate(() => {
      const root = document.querySelector('algolia-chat').shadowRoot;
      const transcript = root.querySelector('[part="messages"]') || root.querySelector('[part="body"]');
      const block = document.createElement('div');
      block.innerHTML = `
        <section class="acs-answer">
          <p>Choosing a plan is like choosing between a reliable sedan and a custom-built race car.</p>
          <p>Short version: Grow is standardized; Elevate is tailored.</p>
          <h2>Details</h2>
          <p>${'This paragraph keeps enough answer content in the panel to mimic a completed turn. '.repeat(18)}</p>
          <div class="acs-source-section">Sources</div>
          <div class="acs-followup-wrap">Are you comparing pricing for an existing workload?</div>
        </section>
      `;
      transcript?.append(block);
    });

    const dragged = await dragPanelCorner(page, 80, 60);
    assert.ok(
      dragged.after.rect.width > dragged.before.rect.width,
      `expected post-answer drag to increase width: ${JSON.stringify(dragged)}`
    );
    assert.ok(
      dragged.after.rect.height > dragged.before.rect.height,
      `expected post-answer drag to increase height: ${JSON.stringify(dragged)}`
    );
    assert.equal(dragged.after.resize, 'both');
    assert.equal(dragged.after.gripDisplay, 'block');
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

test('docked and maximized panels do not expose the resize affordance', async () => {
  for (const openMode of ['docked', 'maximized']) {
    const page = await createOpenWidgetPage({ width: 1280, height: 900 }, { openMode });
    try {
      const state = await panelResizeState(page);
      assert.equal(state.resize, 'none', `${openMode} should not be resizable`);
      assert.equal(state.gripDisplay, 'none', `${openMode} should not show the resize grip`);
    } finally {
      await page.close();
    }
  }
});
