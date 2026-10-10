import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';

const chatPath = new URL('../algolia-chat.js', import.meta.url);
const themePath = new URL('../algolia-chat-theme-algolia.js', import.meta.url);
const comparePath = new URL('../algolia-chat-compare.js', import.meta.url);
const handoffPath = new URL('../handoff-to-orchestrator.js', import.meta.url);
const telemetryPath = new URL('../token-telemetry.js', import.meta.url);
const approvedSampleSlotPath = new URL(
  './fixtures/approved-sample-questions-slot-20260826.html',
  import.meta.url
);
const approvedSampleSlot = fs.readFileSync(approvedSampleSlotPath, 'utf8').trim();

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
    ].join('\n'),
  },
  {
    type: 'data-suggestions',
    data: {
      suggestions: ['Are you trying to hand day-to-day search controls to marketing, merchandising, or support?'],
    },
  },
];

const markerlessFollowUpFrames = [
  {
    type: 'tool-output-available',
    toolCallId: 'search-1',
    output: {
      hits: [
        {
          objectID: 'inventory-strategy',
          title: 'Handling out-of-stock items',
          url: 'https://www.algolia.com/doc/guides/managing-results/rules/',
          source: 'Documentation',
          description: 'Use inventory attributes and rules to control product visibility.',
        },
      ],
    },
  },
  {
    type: 'text-delta',
    delta: [
      "Handling out-of-stock items is like managing a restaurant menu: you do not want to hide your best dish forever, but you also do not want to sell what the kitchen cannot make today.",
      '',
      'The best practice is to keep out-of-stock items indexed and push them down or filter them at query time, depending on the customer experience you want.',
      '',
      '## Consultant recommendation',
      'Use one combined index with an inventory attribute unless your catalog truly needs separate ranking strategies.',
      '',
      'What does your current data pipeline look like for updating stock levels?',
    ].join('\n\n'),
  },
];

const contractedAnalogyFrames = [
  {
    type: 'text-delta',
    delta: [
      "It's like the difference between a dictionary and a conversation. A dictionary requires you to know exactly which word leads to another, but a conversation allows you to understand the idea even when someone uses a different term.",
      '',
      'NeuralSearch handles concepts automatically by combining traditional keyword matching with AI-powered vector search.',
      '',
      'The mechanism creates a neural score that merges keyword precision with semantic understanding.',
    ].join('\n'),
  },
];

const flatNoSourceFrames = [
  {
    type: 'text-delta',
    delta: 'A direct answer without retrieved sources or a TLDR canvas.',
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
    window.__productionRequests = [];
    window.__completionFrameQueue = Array.isArray(frames[0]) ? frames : null;
    window.fetch = async (input, init = {}) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes('/agent-studio/1/agents/') && url.includes('/completions')) {
        window.__completionRequests.push(JSON.parse(String(init.body ?? '{}')));
        const activeFrames = window.__completionFrameQueue?.shift() || frames;
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          start(controller) {
            for (const frame of activeFrames) {
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
        window.__productionRequests.push(JSON.parse(String(init.body ?? '{}')));
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
  await page.addScriptTag({ content: `
    window.ACS_COMPARE={prod:{proxyPath:"/__compare/production"}};
    window.__preparedByKey=new Map();
    window.algoliaHandoffToOrchestrator={
      subscribePreparedTurn(listener){ window.__comparePreparedListener=listener; return ()=>{}; },
      subscribeCompletedTurn(listener){ window.__compareCompletedListener=listener; return ()=>{}; },
      ensureAnswerFooter(detail){
        const root=document.querySelector('algolia-chat')?.shadowRoot;
        if(!root) return null;
        const existing=[...root.querySelectorAll('[data-algolia-answer-footer]')]
          .find((node)=>node.dataset.algoliaAnswerFooter===detail.messageId);
        if(existing) return existing;
        const bubble=[...root.querySelectorAll('[part="message-user-bubble"]')].reverse()
          .find((node)=>node.textContent.trim()===detail.question);
        const turn=bubble?.parentElement?.parentElement;
        const lane=[...(turn?.children||[])].find((node)=>node.getAttribute('aria-live')==='polite');
        const card=lane?.querySelector('div[aria-busy]');
        if(!card) return null;
        const source=card.querySelector('[aria-label="Grounded sources"]');
        let footer=source?.parentElement?.parentElement||null;
        if(!footer){
          footer=document.createElement('div');
          footer.className='flex items-end justify-between gap-4';
          const slot=document.createElement('div');
          slot.className='min-w-0 flex-1';
          footer.append(slot);
          card.append(footer);
        }
        footer.dataset.algoliaAnswerFooter=detail.messageId;
        return footer;
      }
    };
    window.__emitComparePrepared=(question,key)=>{
      const detail={
        question,
        turnKey:key,
        messageId:key,
        body:JSON.stringify({id:"test-conversation",messages:[{role:"user",parts:[{type:"text",text:question}]}]})
      };
      window.__preparedByKey.set(key,detail);
      window.__comparePreparedListener?.(detail);
    };
    window.__emitCompareCompleted=(key)=>window.__compareCompletedListener?.({
      ...window.__preparedByKey.get(key),
      conversationId:"test-conversation"
    });
    window.__markComparePostAnswerReady=(key)=>{
      const detail=window.__preparedByKey.get(key);
      const footer=window.algoliaHandoffToOrchestrator.ensureAnswerFooter(detail);
      if(!footer) return false;
      if(!footer.querySelector('algolia-confidence-badge')){
        const badge=document.createElement('algolia-confidence-badge');
        badge.textContent='Confidence 9.0 /10';
        footer.appendChild(badge);
      }
      return true;
    };
  ` });
  await page.addScriptTag({ content: fs.readFileSync(comparePath, 'utf8') });

  await page.evaluate(async (sampleQuestionsSlot) => {
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
    widget.setAttribute('sample-questions-group-cap', '0');
    widget.insertAdjacentHTML('beforeend', sampleQuestionsSlot);

    const agent = document.createElement('algolia-agent');
    agent.setAttribute('role', 'primary');
    agent.setAttribute('agent-id', 'test-agent');
    widget.append(agent);
    search.append(widget);
    document.body.append(search);
    await new Promise((resolve) => setTimeout(resolve, 200));
    widget.open();
  }, approvedSampleSlot);

  await page.waitForFunction(() =>
    document.querySelector('algolia-chat')?.shadowRoot?.querySelector('[part="panel"]')
  );
  return page;
}

test('compare mode does not collapse the sample questions menu into skinny columns', async () => {
  const page = await createComparePage();
  try {
    await page.evaluate(() => {
      window.__emitComparePrepared('Seed answer for Compare.', 'seed:1');
      document.querySelector('algolia-chat').ask('Seed answer for Compare.');
      window.__emitCompareCompleted('seed:1');
    });
    await page.waitForFunction(() => window.__markComparePostAnswerReady?.('seed:1'));
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

test('a first no-source flat answer receives its own Compare footer', async () => {
  const page = await createComparePage({ responseFrames: flatNoSourceFrames });
  try {
    await page.evaluate(() => {
      window.__emitComparePrepared('Flat answer?', 'flat:1');
      document.querySelector('algolia-chat').ask('Flat answer?');
    });
    await page.waitForFunction(() =>
      document.querySelector('algolia-chat')?.shadowRoot?.textContent
        ?.includes('A direct answer without retrieved sources')
    );
    await page.evaluate(() => window.__emitCompareCompleted('flat:1'));
    await page.waitForFunction(() => window.__markComparePostAnswerReady?.('flat:1'));
    await page.waitForFunction(() =>
      document.querySelector('algolia-chat')?.shadowRoot?.querySelector('#acs-compare-toggle')
    );

    const placement = await page.evaluate(() => {
      const root = document.querySelector('algolia-chat').shadowRoot;
      const toggle = root.querySelector('#acs-compare-toggle');
      return {
        inHeader: Boolean(toggle.closest('[part="header"]')),
        footerId: toggle.parentElement.dataset.algoliaAnswerFooter,
        footerClass: toggle.parentElement.className,
      };
    });
    assert.equal(placement.inHeader, false);
    assert.equal(placement.footerId, 'flat:1');
    assert.equal(placement.footerClass, 'flex items-end justify-between gap-4');
  } finally {
    await page.close();
  }
});

test('real handoff resolver keeps Compare, telemetry, and Judge in one no-source footer', async () => {
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  try {
    await page.route('**/*', (route) => route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<!doctype html><html><body></body></html>',
    }));
    await page.goto('http://localhost/');
    await page.evaluate(() => {
      const host = document.createElement('algolia-chat');
      const root = host.attachShadow({ mode: 'open' });
      root.innerHTML = `
        <div part="panel" style="width:1000px;height:800px">
          <div part="chat-content">
            <header part="header"><div></div><div></div></header>
            <div class="turn flex flex-col gap-3.5">
              <div><div part="message-user-bubble">No-source exact turn?</div></div>
              <div aria-live="polite">
                <div aria-busy="false" class="flex flex-col gap-3 rounded-algolia-xl bg-algolia-surface p-6 shadow-algolia-2">
                  <p>A completed answer without retrieved sources.</p>
                  <div class="flex items-end justify-between gap-4">
                    <div class="min-w-0 flex-1"></div>
                    <algolia-confidence-badge></algolia-confidence-badge>
                  </div>
                </div>
              </div>
            </div>
            <form part="composer"></form>
          </div>
        </div>`;
      const confidence = document.createElement('algolia-chat-confidence');
      confidence.setAttribute('mode', 'algolia');
      host.append(confidence);
      document.body.append(host);

      window.ALGOLIA_HANDOFF_CONFIG = { primaryAgentId: 'orchestrator-test' };
      window.ACS_COMPARE = { prod: { proxyPath: '/__compare/production' } };
      window.ACS_TOKEN_TELEMETRY = {};
      window.algoliaChat = {
        setOrchestratorTransport(transport) { window.__testTransport = transport; },
      };
      window.algoliaContextCompiler = {
        prepareCompletionBody(body) { return body; },
        fetchPrepared(input) {
          const url = String(input);
          if (url.includes('algoliaTokenTelemetry')) {
            return Promise.resolve({
              ok: true,
              status: 200,
              json: async () => ({ inputTokens: 120, outputTokens: 30, totalTokens: 150 }),
            });
          }
          return Promise.resolve(new Response('data: {"type":"text-delta","delta":"done"}\n\n', {
            status: 200,
            headers: { 'X-Conversation-Id': 'alg_cnv_footer_test' },
          }));
        },
      };
    });
    await page.addScriptTag({ content: fs.readFileSync(handoffPath, 'utf8') });
    await page.addScriptTag({ content: fs.readFileSync(comparePath, 'utf8') });
    await page.addScriptTag({ content: fs.readFileSync(telemetryPath, 'utf8') });
    await page.evaluate(async () => {
      const response = await window.__testTransport(
        'https://test.algolia.net/agent-studio/1/agents/orchestrator-test/completions',
        {
          method: 'POST',
          body: JSON.stringify({
            id: 'conversation-footer-test',
            messages: [{
              id: 'user-footer-test',
              role: 'user',
              parts: [{ type: 'text', text: 'No-source exact turn?' }],
            }],
          }),
        },
      );
      await response.text();
    });
    await page.waitForFunction(() => {
      const root = document.querySelector('algolia-chat')?.shadowRoot;
      return root?.querySelector('#acs-compare-toggle') && root?.querySelector('.algolia-usage-pill');
    });

    const proof = await page.evaluate(() => {
      const root = document.querySelector('algolia-chat').shadowRoot;
      const footers = [...root.querySelectorAll('.flex.items-end.justify-between.gap-4')];
      const footer = footers[0];
      return {
        footerCount: footers.length,
        footerId: footer.dataset.algoliaAnswerFooter,
        hasJudge: Boolean(footer.querySelector('algolia-confidence-badge')),
        hasCompare: Boolean(footer.querySelector('#acs-compare-toggle')),
        telemetry: footer.querySelector('.algolia-usage-pill')?.textContent,
      };
    });
    assert.deepEqual(proof, {
      footerCount: 1,
      footerId: 'user-footer-test',
      hasJudge: true,
      hasCompare: true,
      telemetry: 'In 120 / 30 Out',
    });
  } finally {
    await page.close();
  }
});

test('compare mode preserves TLDR treatment on the primary answer', async () => {
  const page = await createComparePage();
  try {
    await page.evaluate(() => {
      window.__emitComparePrepared('Seed answer for Compare.', 'seed:2');
      document.querySelector('algolia-chat').ask('Seed answer for Compare.');
      window.__emitCompareCompleted('seed:2');
    });
    await page.waitForFunction(() => window.__markComparePostAnswerReady?.('seed:2'));
    await page.waitForFunction(() =>
      document.querySelector('algolia-chat')?.shadowRoot?.querySelector('#acs-compare-toggle')
    );
    await page.evaluate(() => {
      const root = document.querySelector('algolia-chat').shadowRoot;
      root.querySelector('#acs-compare-toggle')?.click();
    });
    await page.waitForFunction(() =>
      document.querySelector('algolia-chat')?.shadowRoot
        ?.querySelector('#acs-compare-toggle')?.getAttribute('aria-pressed') === 'true'
    );
    await page.evaluate(() => {
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

test('compare mode preserves TLDR treatment on a later primary answer', async () => {
  const page = await createComparePage({
    responseFrames: [
      flatNoSourceFrames,
      compareAnswerFrames,
    ],
  });
  try {
    await page.evaluate(() => {
      window.__emitComparePrepared('Flat warmup?', 'seed:tldr-later-1');
      document.querySelector('algolia-chat').ask('Flat warmup?');
    });
    await page.waitForFunction(() =>
      document.querySelector('algolia-chat')?.shadowRoot?.textContent
        ?.includes('A direct answer without retrieved sources')
    );
    await page.evaluate(() => window.__emitCompareCompleted('seed:tldr-later-1'));
    await page.waitForFunction(() => window.__markComparePostAnswerReady?.('seed:tldr-later-1'));
    await page.waitForFunction(() => {
      const root = document.querySelector('algolia-chat')?.shadowRoot;
      return root?.querySelector('textarea')?.disabled === false;
    });

    await page.evaluate(() => {
      window.__emitComparePrepared('Can a non-technical marketing team run search day-to-day without a developer?', 'seed:tldr-later-2');
    });
    const composer = page.locator('algolia-chat').locator('textarea');
    await composer.fill('Can a non-technical marketing team run search day-to-day without a developer?');
    await composer.press('Enter');
    await page.waitForFunction(() => {
      const root = document.querySelector('algolia-chat')?.shadowRoot;
      return root?.textContent?.includes('The magic happens in the Dashboard');
    }, null, { timeout: 8_000 });
    await page.evaluate(() => window.__emitCompareCompleted('seed:tldr-later-2'));
    await page.waitForFunction(() => window.__markComparePostAnswerReady?.('seed:tldr-later-2'));
    await page.waitForFunction(() =>
      document.querySelector('algolia-chat')?.shadowRoot?.querySelector('#acs-compare-toggle')
    );
    await page.evaluate(() => {
      document.querySelector('algolia-chat').shadowRoot
        .querySelector('#acs-compare-toggle')?.click();
    });
    await page.waitForFunction(() =>
      document.querySelector('algolia-chat')?.shadowRoot
        ?.querySelector('#acs-compare-toggle')?.getAttribute('aria-pressed') === 'true'
    );

    const state = await page.evaluate(() => {
      const root = document.querySelector('algolia-chat').shadowRoot;
      const tldrTiles = [...root.querySelectorAll('.acs-answer-tldr')];
      const latestTldr = tldrTiles.at(-1);
      const latestDetails = [...root.querySelectorAll('.acs-answer-details')].at(-1);
      return {
        compareOn: root.querySelector('#acs-compare-toggle')?.getAttribute('aria-pressed'),
        tldrCount: tldrTiles.length,
        latestTldrText: latestTldr?.textContent.replace(/\s+/g, ' ').trim(),
        latestDetailsText: latestDetails?.textContent.replace(/\s+/g, ' ').trim(),
      };
    });

    assert.equal(state.compareOn, 'true');
    assert.equal(state.tldrCount, 1);
    assert.match(state.latestTldrText, /store window display/);
    assert.match(state.latestTldrText, /The short answer is yes/);
    assert.doesNotMatch(state.latestTldrText, /The magic happens/);
    assert.match(state.latestDetailsText, /The magic happens/);
  } finally {
    await page.close();
  }
});

test('compare mode preserves the primary discovery follow-up as a separate tile', async () => {
  const page = await createComparePage();
  const question = 'Are you trying to hand day-to-day search controls to marketing, merchandising, or support?';
  try {
    await page.evaluate(() => {
      window.__emitComparePrepared('Seed answer for Compare.', 'seed:followup');
      document.querySelector('algolia-chat').ask('Seed answer for Compare.');
      window.__emitCompareCompleted('seed:followup');
    });
    await page.waitForFunction(() => window.__markComparePostAnswerReady?.('seed:followup'));
    await page.waitForFunction(() =>
      document.querySelector('algolia-chat')?.shadowRoot?.querySelector('#acs-compare-toggle')
    );
    await page.evaluate(() => {
      const root = document.querySelector('algolia-chat').shadowRoot;
      root.querySelector('#acs-compare-toggle')?.click();
    });
    await page.waitForFunction(() =>
      document.querySelector('algolia-chat')?.shadowRoot
        ?.querySelector('#acs-compare-toggle')?.getAttribute('aria-pressed') === 'true'
    );

    const state = await page.evaluate((expectedQuestion) => {
      const root = document.querySelector('algolia-chat').shadowRoot;
      const followWrap = root.querySelector('.acs-followup-wrap');
      const followCard = root.querySelector('.acs-followup-card');
      const answerClone = root.querySelector('.acs-answer-details, .prose, [aria-busy="false"]')?.cloneNode(true);
      answerClone?.querySelector('.acs-followup-wrap')?.remove();
      return {
        compareOn: root.querySelector('#acs-compare-toggle')?.getAttribute('aria-pressed'),
        followupCount: root.querySelectorAll('.acs-followup-wrap').length,
        followCardText: followCard?.textContent.replace(/\s+/g, ' ').trim(),
        answerStillContainsQuestion: Boolean(answerClone?.textContent.includes(expectedQuestion)),
        productionContainsQuestion: Boolean(root.querySelector('#acs-compare-panel')?.textContent.includes(expectedQuestion)),
      };
    }, question);

    assert.equal(state.compareOn, 'true');
    assert.equal(state.followupCount, 1);
    assert.match(state.followCardText, /marketing, merchandising, or support/);
    assert.equal(state.answerStillContainsQuestion, false);
    assert.equal(state.productionContainsQuestion, false);
  } finally {
    await page.close();
  }
});

test('compare mode extracts a markerless trailing discovery question into a separate tile', async () => {
  const page = await createComparePage({ responseFrames: markerlessFollowUpFrames });
  const question = 'What does your current data pipeline look like for updating stock levels?';
  try {
    await page.evaluate(() => {
      window.__emitComparePrepared('How should I handle out-of-stock items?', 'seed:inline-followup');
      document.querySelector('algolia-chat').ask('How should I handle out-of-stock items?');
    });
    await page.waitForFunction(() =>
      document.querySelector('algolia-chat')?.shadowRoot?.textContent
        ?.includes('Consultant recommendation')
    );
    await page.evaluate(() => window.__emitCompareCompleted('seed:inline-followup'));
    await page.waitForFunction(() => window.__markComparePostAnswerReady?.('seed:inline-followup'));
    await page.waitForFunction(() =>
      document.querySelector('algolia-chat')?.shadowRoot?.querySelector('#acs-compare-toggle')
    );
    await page.evaluate(() => {
      document.querySelector('algolia-chat').shadowRoot
        .querySelector('#acs-compare-toggle')?.click();
    });
    await page.waitForFunction(() =>
      document.querySelector('algolia-chat')?.shadowRoot
        ?.querySelector('#acs-compare-toggle')?.getAttribute('aria-pressed') === 'true'
    );

    const state = await page.evaluate((expectedQuestion) => {
      const root = document.querySelector('algolia-chat').shadowRoot;
      const followWrap = root.querySelector('.acs-followup-wrap');
      const followCard = root.querySelector('.acs-followup-card');
      const answerClone = root.querySelector('.acs-answer-details, .prose, [aria-busy="false"]')?.cloneNode(true);
      answerClone?.querySelector('.acs-followup-wrap')?.remove();
      return {
        compareOn: root.querySelector('#acs-compare-toggle')?.getAttribute('aria-pressed'),
        followupCount: root.querySelectorAll('.acs-followup-wrap').length,
        followCardText: followCard?.textContent.replace(/\s+/g, ' ').trim(),
        answerStillContainsQuestion: Boolean(answerClone?.textContent.includes(expectedQuestion)),
        detailsText: root.querySelector('.acs-answer-details')?.textContent.replace(/\s+/g, ' ').trim(),
      };
    }, question);

    assert.equal(state.compareOn, 'true');
    assert.equal(state.followupCount, 1);
    assert.equal(state.followCardText, question);
    assert.equal(state.answerStillContainsQuestion, false);
    assert.doesNotMatch(state.detailsText, /current data pipeline/);
  } finally {
    await page.close();
  }
});

test("concierge keeps the TLDR canvas for an 'It's like' analogy with Compare off and on", async () => {
  for (const compareOn of [false, true]) {
    const page = await createComparePage({ responseFrames: contractedAnalogyFrames });
    try {
      await page.evaluate((enableCompare) => {
        const widget = document.querySelector('algolia-chat');
        window.__emitComparePrepared('How does Neural Search handle synonyms and concepts?', 'analogy:1');
        widget.ask('How does Neural Search handle synonyms and concepts?');
      }, compareOn);
      await page.waitForFunction(() => {
        const root = document.querySelector('algolia-chat')?.shadowRoot;
        return root?.textContent?.includes('The mechanism creates a neural score');
      }, null, { timeout: 8_000 });
      await page.evaluate(() => window.__emitCompareCompleted('analogy:1'));
      await page.waitForFunction(() => window.__markComparePostAnswerReady?.('analogy:1'));
      await page.waitForFunction(() =>
        document.querySelector('algolia-chat')?.shadowRoot?.querySelector('#acs-compare-toggle')
      );
      if (compareOn) {
        await page.evaluate(() =>
          document.querySelector('algolia-chat').shadowRoot
            .querySelector('#acs-compare-toggle').click()
        );
        await page.waitForFunction(() =>
          document.querySelector('algolia-chat')?.shadowRoot
            ?.querySelector('#acs-compare-toggle')?.getAttribute('aria-pressed') === 'true'
        );
      }

      const state = await page.evaluate(() => {
        const root = document.querySelector('algolia-chat').shadowRoot;
        return {
          labels: [...root.querySelectorAll('.acs-answer-section-label')]
            .map((node) => node.textContent.trim()),
          tldr: root.querySelector('.acs-answer-tldr')?.textContent.replace(/\s+/g, ' ').trim(),
          short: root.querySelector('.acs-answer-short')?.textContent.replace(/\s+/g, ' ').trim(),
          details: root.querySelector('.acs-answer-details')?.textContent.replace(/\s+/g, ' ').trim(),
        };
      });

      assert.ok(state.labels.includes('TL;DR'), `TL;DR label missing with Compare ${compareOn ? 'on' : 'off'}`);
      assert.match(state.tldr, /It's like the difference between a dictionary and a conversation/);
      assert.match(state.short, /NeuralSearch handles concepts automatically/);
      assert.match(state.details, /The mechanism creates a neural score/);
      assert.doesNotMatch(state.tldr, /The mechanism creates a neural score/);
    } finally {
      await page.close();
    }
  }
});
