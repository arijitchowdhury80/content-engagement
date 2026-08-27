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

async function createClosedWidgetPage(viewport, { openMode = 'normal' } = {}) {
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
  }, openMode);
  await page.waitForFunction(() =>
    document.querySelector('algolia-chat')?.shadowRoot?.querySelector('[part="launcher"]')
  );
  return page;
}

async function panelResizeState(page) {
  return page.evaluate(() => {
    const panel = document.querySelector('algolia-chat').shadowRoot.querySelector('[part="panel"]');
    const style = getComputedStyle(panel);
    const rect = panel.getBoundingClientRect();
    const handles = [...panel.querySelectorAll('[data-resize-handle]')].map((handle) => ({
      dir: handle.getAttribute('data-resize-handle'),
      cursor: getComputedStyle(handle).cursor,
      display: getComputedStyle(handle).display,
    }));
    return {
      resize: style.resize,
      minWidth: style.minWidth,
      minHeight: style.minHeight,
      maxWidth: style.maxWidth,
      maxHeight: style.maxHeight,
      inlineStyle: panel.getAttribute('style'),
      handles,
      rect: {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      },
    };
  });
}

async function launcherState(page) {
  return page.evaluate(() => {
    const root = document.querySelector('algolia-chat').shadowRoot;
    const launcher = root.querySelector('[part="launcher"]');
    const rect = launcher.getBoundingClientRect();
    const style = getComputedStyle(launcher);
    return {
      cursor: style.cursor,
      touchAction: style.touchAction,
      inlineStyle: launcher.getAttribute('style'),
      panelOpen: Boolean(root.querySelector('[part="panel"]')),
      storedPosition: localStorage.getItem('algolia-chat-launcher-position'),
      rect: {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      },
    };
  });
}

async function dragLauncher(page, deltaX, deltaY) {
  const before = await launcherState(page);
  await page.mouse.move(
    before.rect.x + before.rect.width / 2,
    before.rect.y + before.rect.height / 2
  );
  await page.mouse.down();
  await page.mouse.move(
    before.rect.x + before.rect.width / 2 + deltaX,
    before.rect.y + before.rect.height / 2 + deltaY,
    { steps: 12 }
  );
  await page.mouse.up();
  await page.waitForTimeout(200);
  return { before, after: await launcherState(page) };
}

async function dragPanelHeader(page, deltaX, deltaY) {
  const before = await panelResizeState(page);
  await page.evaluate(() => {
    const panel = document.querySelector('algolia-chat').shadowRoot.querySelector('[part="panel"]');
    panel.scrollIntoView?.();
  });
  await page.mouse.move(before.rect.x + 110, before.rect.y + 28);
  await page.mouse.down();
  await page.mouse.move(before.rect.x + 110 + deltaX, before.rect.y + 28 + deltaY, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  return { before, after: await panelResizeState(page) };
}

async function dragResizeHandle(page, dir, deltaX, deltaY) {
  const before = await panelResizeState(page);
  const center = await page.evaluate((direction) => {
    const panel = document.querySelector('algolia-chat').shadowRoot.querySelector('[part="panel"]');
    const handle = panel.querySelector(`[data-resize-handle="${direction}"]`);
    if (!handle) return null;
    const rect = handle.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  }, dir);
  assert.ok(center, `expected ${dir} resize handle to exist`);
  await page.mouse.move(
    center.x,
    center.y
  );
  await page.mouse.down();
  await page.mouse.move(
    center.x + deltaX,
    center.y + deltaY,
    { steps: 12 }
  );
  await page.mouse.up();
  await page.waitForTimeout(200);
  return { before, after: await panelResizeState(page) };
}

async function clickHeaderControl(page, labelPattern) {
  const center = await page.evaluate((source) => {
    const pattern = new RegExp(source, 'i');
    const root = document.querySelector('algolia-chat').shadowRoot;
    const buttons = [...root.querySelectorAll('[part="header"] button')];
    const button = buttons.find((candidate) => {
      const label = [
        candidate.getAttribute('aria-label'),
        candidate.getAttribute('title'),
        candidate.textContent,
      ].filter(Boolean).join(' ');
      return pattern.test(label);
    });
    if (!button) return null;
    const rect = button.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  }, labelPattern.source);
  assert.ok(center, `expected header control matching ${labelPattern} to exist`);
  await page.mouse.move(center.x, center.y);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(200);
}

test('closed launcher bubble can be dragged without opening the chat', async () => {
  const page = await createClosedWidgetPage({ width: 1280, height: 900 });
  try {
    const dragged = await dragLauncher(page, -180, -130);
    assert.equal(dragged.before.cursor, 'grab');
    assert.equal(dragged.before.touchAction, 'none');
    assert.equal(dragged.after.panelOpen, false, 'dragging the launcher must not open the panel');
    assert.ok(
      dragged.after.rect.x < dragged.before.rect.x,
      `expected launcher to move left: ${JSON.stringify(dragged)}`
    );
    assert.ok(
      dragged.after.rect.y < dragged.before.rect.y,
      `expected launcher to move up: ${JSON.stringify(dragged)}`
    );
    assert.match(dragged.after.inlineStyle, /(?:left|inset):/);
    assert.match(dragged.after.storedPosition, /"left":/);

    await page.mouse.click(
      dragged.after.rect.x + dragged.after.rect.width / 2,
      dragged.after.rect.y + dragged.after.rect.height / 2
    );
    await page.waitForFunction(() =>
      document.querySelector('algolia-chat')?.shadowRoot?.querySelector('[part="panel"]')
    );
  } finally {
    await page.close();
  }
});

test('normal desktop modal is user-resizable without changing default geometry', async () => {
  const page = await createOpenWidgetPage({ width: 1280, height: 900 });
  try {
    const state = await panelResizeState(page);

    assert.equal(state.inlineStyle, 'width: var(--algolia-panel-w); height: var(--algolia-panel-h);');
    assert.equal(state.resize, 'none');
    assert.equal(state.minWidth, '720px');
    assert.equal(state.minHeight, '560px');
    assert.equal(state.maxWidth, '1248px');
    assert.equal(state.maxHeight, '868px');
    assert.deepEqual(
      state.handles.map((handle) => handle.dir).sort(),
      ['e', 'n', 'ne', 'nw', 's', 'se', 'sw', 'w']
    );
    assert.equal(state.handles.every((handle) => handle.display === 'block'), true);
    assert.equal(state.handles.find((handle) => handle.dir === 'e')?.cursor, 'ew-resize');
    assert.equal(state.handles.find((handle) => handle.dir === 's')?.cursor, 'ns-resize');
    assert.equal(state.handles.find((handle) => handle.dir === 'se')?.cursor, 'nwse-resize');

    const moved = await dragPanelHeader(page, 70, 45);
    assert.ok(
      moved.after.rect.x > moved.before.rect.x,
      `expected header drag to move panel right: ${JSON.stringify(moved)}`
    );
    assert.ok(
      moved.after.rect.y > moved.before.rect.y,
      `expected header drag to move panel down: ${JSON.stringify(moved)}`
    );

    const dragged = await dragResizeHandle(page, 'se', 80, 60);
    assert.ok(
      dragged.after.rect.width > dragged.before.rect.width,
      `expected drag to increase width: ${JSON.stringify(dragged)}`
    );
    assert.ok(
      dragged.after.rect.height > dragged.before.rect.height,
      `expected drag to increase height: ${JSON.stringify(dragged)}`
    );
    assert.equal(dragged.after.resize, 'none');
    assert.match(dragged.after.inlineStyle, /left: \d+(?:\.\d+)?px/);
    assert.match(dragged.after.inlineStyle, /top: \d+(?:\.\d+)?px/);
    assert.match(dragged.after.inlineStyle, /width: \d+(?:\.\d+)?px/);
    assert.match(dragged.after.inlineStyle, /height: \d+(?:\.\d+)?px/);
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

    const dragged = await dragResizeHandle(page, 'se', 80, 60);
    assert.ok(
      dragged.after.rect.width > dragged.before.rect.width,
      `expected post-answer drag to increase width: ${JSON.stringify(dragged)}`
    );
    assert.ok(
      dragged.after.rect.height > dragged.before.rect.height,
      `expected post-answer drag to increase height: ${JSON.stringify(dragged)}`
    );
    assert.equal(dragged.after.resize, 'none');

    const widenedFromLeft = await dragResizeHandle(page, 'w', -60, 0);
    assert.ok(
      widenedFromLeft.after.rect.x < widenedFromLeft.before.rect.x,
      `expected west handle to move left edge outward: ${JSON.stringify(widenedFromLeft)}`
    );
    assert.ok(
      widenedFromLeft.after.rect.width > widenedFromLeft.before.rect.width,
      `expected west handle to increase width: ${JSON.stringify(widenedFromLeft)}`
    );
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
    assert.deepEqual(state.handles, []);
  } finally {
    await page.close();
  }
});

test('docked desktop modal becomes fluid when dragged or resized', async () => {
  const page = await createOpenWidgetPage({ width: 1280, height: 900 }, { openMode: 'docked' });
  try {
    const state = await panelResizeState(page);
    assert.equal(state.resize, 'none');
    assert.deepEqual(
      state.handles.map((handle) => handle.dir).sort(),
      ['e', 'n', 'ne', 'nw', 's', 'se', 'sw', 'w']
    );

    const moved = await dragPanelHeader(page, -90, -70);
    assert.ok(
      moved.after.rect.x < moved.before.rect.x,
      `expected docked header drag to move panel left: ${JSON.stringify(moved)}`
    );
    assert.ok(
      moved.after.rect.y < moved.before.rect.y,
      `expected docked header drag to move panel up: ${JSON.stringify(moved)}`
    );
    assert.doesNotMatch(moved.after.inlineStyle, /bottom:/);
    assert.doesNotMatch(moved.after.inlineStyle, /right:/);

    const dragged = await dragResizeHandle(page, 'se', 70, 50);
    assert.ok(
      dragged.after.rect.width > dragged.before.rect.width,
      `expected docked resize to increase width: ${JSON.stringify(dragged)}`
    );
    assert.ok(
      dragged.after.rect.height > dragged.before.rect.height,
      `expected docked resize to increase height: ${JSON.stringify(dragged)}`
    );
  } finally {
    await page.close();
  }
});

test('docked expand control remains clickable after panel drag support is installed', async () => {
  const page = await createOpenWidgetPage({ width: 1280, height: 900 }, { openMode: 'docked' });
  try {
    const before = await panelResizeState(page);

    await clickHeaderControl(page, /expand to full view|maximize|expand/);

    await page.waitForFunction((previousWidth) => {
      const panel = document.querySelector('algolia-chat')?.shadowRoot?.querySelector('[part="panel"]');
      if (!panel) return false;
      const rect = panel.getBoundingClientRect();
      return rect.width > previousWidth + 120;
    }, before.rect.width);

    const after = await panelResizeState(page);
    assert.ok(
      after.rect.width > before.rect.width + 120,
      `expected expand control to widen docked panel: ${JSON.stringify({ before, after })}`
    );
    assert.ok(
      after.rect.height >= before.rect.height,
      `expected expand control not to shrink panel height: ${JSON.stringify({ before, after })}`
    );
  } finally {
    await page.close();
  }
});

test('maximized panel does not expose the resize affordance', async () => {
  const page = await createOpenWidgetPage({ width: 1280, height: 900 }, { openMode: 'maximized' });
  try {
    const state = await panelResizeState(page);
    assert.equal(state.resize, 'none');
    assert.deepEqual(state.handles, [], 'maximized should not expose resize handles');
  } finally {
    await page.close();
  }
});
