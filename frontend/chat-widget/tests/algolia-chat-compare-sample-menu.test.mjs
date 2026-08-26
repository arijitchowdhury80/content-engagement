import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';

const chatPath = new URL('../algolia-chat.js', import.meta.url);
const themePath = new URL('../algolia-chat-theme-algolia.js', import.meta.url);
const comparePath = new URL('../algolia-chat-compare.js', import.meta.url);

let browser;

before(async () => {
  browser = await chromium.launch({ headless: true });
});

after(async () => {
  await browser?.close();
});

async function createComparePage() {
  const page = await browser.newPage({ viewport: { width: 1158, height: 890 } });
  await page.route('**/*', async (route) => {
    if (route.request().isNavigationRequest()) {
      await route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<!doctype html><html><body style="margin:0"></body></html>',
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
  await page.addScriptTag({
    content: 'if(!crypto.randomUUID){crypto.randomUUID=()=>"00000000-0000-4000-8000-"+String(Math.random()).slice(2,14).padEnd(12,"0");}',
  });
  await page.addScriptTag({ content: fs.readFileSync(themePath, 'utf8') });
  await page.addScriptTag({ content: fs.readFileSync(chatPath, 'utf8') });
  await page.addScriptTag({ content: 'window.ACS_COMPARE={prod:{proxyPath:"/__compare/production"}};' });
  await page.addScriptTag({ content: fs.readFileSync(comparePath, 'utf8') });

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
    widget.setAttribute('sample-questions', JSON.stringify([
      {
        section: 'Technical deep-dives',
        questions: [
          'What counts as an API call keystrokes, filters applied, or page loads and does that change how I should configure rate limiting to control cost?',
          'Is Algolia headless and API-first enough to bolt onto my existing ERP/PIM/CMS stack, and how much dev effort should I expect for a full implementation?',
          'How does the query context go to the engine?',
        ],
      },
      {
        section: 'Business & solutioning',
        questions: [
          "What's the actual cost difference between Grow and Elevate, and are AI features like personalization included or a paid add-on?",
          'How does Algolia compare to Coveo or Constructor for a mid-market catalog?',
          'Can a non-technical marketing team run search day-to-day without a developer?',
        ],
      },
    ]));

    const agent = document.createElement('algolia-agent');
    agent.setAttribute('role', 'primary');
    agent.setAttribute('agent-id', 'test-agent');
    widget.append(agent);
    search.append(widget);
    document.body.append(search);
    await new Promise((resolve) => setTimeout(resolve, 200));
    widget.open();
  });

  await page.waitForFunction(() =>
    document.querySelector('algolia-chat')?.shadowRoot?.querySelector('[part="panel"]')
  );
  return page;
}

test('compare mode does not collapse the sample questions menu into skinny columns', async () => {
  const page = await createComparePage();
  try {
    await page.waitForFunction(() =>
      document.querySelector('algolia-chat')?.shadowRoot?.querySelector('#acs-compare-toggle')
    );
    await page.evaluate(() => {
      const root = document.querySelector('algolia-chat').shadowRoot;
      root.querySelector('#acs-compare-toggle')?.click();
    });
    await page.waitForTimeout(100);
    await page.evaluate(() => {
      const root = document.querySelector('algolia-chat').shadowRoot;
      const trigger = [...root.querySelectorAll('button')]
        .find((button) => /Sample questions/i.test(button.textContent));
      trigger.click();
    });
    await page.waitForTimeout(150);

    const state = await page.evaluate(() => {
      const root = document.querySelector('algolia-chat').shadowRoot;
      const dialog = root.querySelector('[role="dialog"][aria-label="Sample questions"]');
      const grid = dialog?.querySelector('.grid');
      const columns = grid ? getComputedStyle(grid).gridTemplateColumns.split(' ') : [];
      const dialogRect = dialog?.getBoundingClientRect();
      const gridRect = grid?.getBoundingClientRect();
      return {
        compareOn: root.querySelector('#acs-compare-toggle')?.getAttribute('aria-pressed'),
        dialogWidth: dialogRect?.width ?? 0,
        gridWidth: gridRect?.width ?? 0,
        columnWidths: columns.map((value) => Number.parseFloat(value)),
        questionWidth: grid?.querySelector('button')?.getBoundingClientRect().width ?? 0,
      };
    });

    assert.equal(state.compareOn, 'true');
    assert.ok(state.dialogWidth > 650, `dialog should remain wide, got ${state.dialogWidth}`);
    assert.ok(state.gridWidth >= state.dialogWidth - 48, `grid should fill dialog, got ${state.gridWidth}/${state.dialogWidth}`);
    assert.ok(state.columnWidths.length >= 2, 'desktop menu should keep multiple readable columns');
    assert.ok(Math.min(...state.columnWidths) >= 280, `columns should be readable, got ${state.columnWidths.join(', ')}`);
    assert.ok(state.questionWidth >= 280, `question buttons should not squeeze, got ${state.questionWidth}`);
  } finally {
    await page.close();
  }
});
