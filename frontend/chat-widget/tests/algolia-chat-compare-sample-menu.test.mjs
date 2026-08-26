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

const compareAnswerFrames = [
  {
    type: 'tool-output-available',
    toolCallId: 'search-1',
    output: {
      hits: [
        {
          objectID: 'marketing-search',
          title: 'Merchandising search without developers',
          url: 'https://www.algolia.com/doc/guides/managing-results/rules/',
          source: 'Documentation',
          description: 'Rules let business teams steer search results without code changes.',
        },
      ],
    },
  },
  {
    type: 'text-delta',
    delta: [
      'You know that feeling when you want to change a store window display but have to wait for a contractor to move the glass? That is exactly what happens when search is locked behind a developer ticket.',
      '',
      'The short answer is yes. Algolia is designed so that once the initial plumbing is connected by your engineers, the steering wheel is handed over to the marketing and merchandising teams.',
      '',
      'The magic happens in the Dashboard, specifically through Rules. Instead of writing code to change a search result, a marketer can create a rule that changes ranking, redirects, or pins products.',
      '',
      '<!--DISCOVERY_STATE {"probed_slot":"business_outcome","confirmed_slots":[],"inferred_slots":[],"suppressed_slots":[],"handoff_recommended":false,"handoff_specialist_key":null,"confidence":"medium","visible_followup_question":"Are you trying to hand day-to-day search controls to marketing, merchandising, or support?"} DISCOVERY_STATE-->',
    ].join('\n'),
  },
];

async function createComparePage({ responseFrames = compareAnswerFrames } = {}) {
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
  await page.evaluate((frames) => {
    window.__completionRequests = [];
    window.fetch = async (input, init = {}) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes('/agent-studio/1/agents/') && url.includes('/completions')) {
        window.__completionRequests.push(JSON.parse(String(init.body ?? '{}')));
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          start(controller) {
            for (const frame of frames) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(frame)}\n\n`));
            }
            controller.close();
          },
        });
        return new Response(stream, {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        });
      }

      if (url.includes('/__compare/production')) {
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'text-delta', delta: 'Production comparison answer.' })}\n\n`));
            controller.close();
          },
        });
        return new Response(stream, {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        });
      }

      return new Response(JSON.stringify({ results: [{ hits: [], nbHits: 0 }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };
  }, responseFrames);
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

test('compare mode preserves TLDR treatment on the primary answer', async () => {
  const page = await createComparePage();
  try {
    await page.waitForFunction(() =>
      document.querySelector('algolia-chat')?.shadowRoot?.querySelector('#acs-compare-toggle')
    );
    await page.evaluate(() => {
      const root = document.querySelector('algolia-chat').shadowRoot;
      root.querySelector('#acs-compare-toggle')?.click();
      document.querySelector('algolia-chat').ask('Can a non-technical marketing team run search day-to-day without a developer?');
    });
    await page.waitForFunction(() => {
      const root = document.querySelector('algolia-chat')?.shadowRoot;
      return root?.textContent?.includes('The magic happens in the Dashboard');
    }, null, { timeout: 8_000 });

    const state = await page.evaluate(() => {
      const root = document.querySelector('algolia-chat').shadowRoot;
      const tldr = root.querySelector('.acs-answer-tldr');
      const analogy = root.querySelector('.acs-answer-analogy');
      const short = root.querySelector('.acs-answer-short');
      const details = root.querySelector('.acs-answer-details');
      const labels = [...root.querySelectorAll('.acs-answer-section-label')]
        .map((node) => node.textContent.trim());
      return {
        compareOn: root.querySelector('#acs-compare-toggle')?.getAttribute('aria-pressed'),
        tldrText: tldr?.textContent.replace(/\s+/g, ' ').trim(),
        analogyText: analogy?.textContent.replace(/\s+/g, ' ').trim(),
        analogyStyle: analogy ? getComputedStyle(analogy).fontStyle : null,
        shortText: short?.textContent.replace(/\s+/g, ' ').trim(),
        shortStyle: short ? getComputedStyle(short).fontStyle : null,
        detailsText: details?.textContent.replace(/\s+/g, ' ').trim(),
        labels,
      };
    });

    assert.equal(state.compareOn, 'true');
    assert.ok(state.labels.includes('TL;DR'));
    assert.ok(state.labels.includes('Details'));
    assert.match(state.analogyText, /store window display/);
    assert.equal(state.analogyStyle, 'italic');
    assert.match(state.shortText, /The short answer is yes/);
    assert.notEqual(state.shortStyle, 'italic');
    assert.doesNotMatch(state.tldrText, /The magic happens/);
    assert.match(state.detailsText, /The magic happens/);
  } finally {
    await page.close();
  }
});
