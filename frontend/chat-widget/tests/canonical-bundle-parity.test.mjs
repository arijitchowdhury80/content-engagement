import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const widgetRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bundlePath = path.join(widgetRoot, 'dist', 'content-engagement.js');
const approvedQuestionsSlot = fs.readFileSync(
  path.join(widgetRoot, 'tests', 'fixtures', 'approved-sample-questions-slot-20260826.html'),
  'utf8',
);

const expectedQuestions = [
  'What counts as an API call keystrokes, filters applied, or page loads and does that change how I should configure rate limiting to control cost?',
  'Is Algolia headless and API-first enough to bolt onto my existing ERP/PIM/CMS stack, and how much dev effort should I expect for a full implementation?',
  'How does Neural Search handle synonyms and concepts, and would I still need a manual synonym dictionary?',
  "What's the best practice for out-of-stock items in results, and should that change whether I use one combined index or multiple?",
  'How do personalization, synonyms, and Rules-based merchandising interact when scoring a query?',
  "What's the actual cost difference between Grow and Elevate, and are AI features like personalization included or a paid add-on?",
  'How does Algolia compare to Coveo or Constructor for a mid-market catalog?',
  'Can a non-technical marketing team run search day-to-day without a developer?',
  'Is there a free trial, and can I access advanced AI features before committing to enterprise?',
  "If I'm on a competing platform today, what does migration actually look like?",
].map((value) => value.replace(/\s+/g, ' ').trim());

test('one-file source build upgrades the approved host without inventing copy or questions', async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 900, height: 950 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });

  try {
    await page.route('**/*.algolia.net/**', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: [{ hits: [], nbHits: 0 }] }),
    }));
    await page.route('http://content-engagement.local/', (route) => route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html><head>
        <script>window.ACS_COMPARE={exposeForTests:true,prod:{proxyPath:'/__compare/production'}};</script>
      </head><body>
        <algolia-chat app-id="test-app" search-api-key="test-key" index-name="test-index"
          theme="algolia" product-title="Algolia Assistant" show-welcome="true">
          <div slot="welcome">
            <p>Hello, how can I help you today?</p>
            <p>Ask anything about Algolia - we love to explore.</p>
          </div>
          ${approvedQuestionsSlot}
          <algolia-agent role="primary" agent-id="test-agent" label="Assistant"></algolia-agent>
        </algolia-chat>
      </body></html>`,
    }));
    await page.goto('http://content-engagement.local/', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      if (typeof crypto.randomUUID !== 'function') {
        let id = 0;
        Object.defineProperty(crypto, 'randomUUID', {
          configurable: true,
          value: () => `initial-${++id}`,
        });
      }
    });
    await page.addScriptTag({ path: bundlePath });
    await page.waitForFunction(() => document.querySelector('algolia-chat')?.shadowRoot);
    await page.evaluate(() => document.querySelector('algolia-chat').open());
    await page.waitForTimeout(100);

    const initial = await page.evaluate(() => {
      const host = document.querySelector('algolia-chat');
      const root = host.shadowRoot;
      const buttons = [...root.querySelectorAll('button')];
      const text = root.textContent.replace(/\s+/g, ' ').trim();
      const welcomeText = [...root.querySelectorAll('slot[name="welcome"]')]
        .flatMap((slot) => slot.assignedElements())
        .map((element) => element.textContent.replace(/\s+/g, ' ').trim())
        .join(' ');
      const logo = root.querySelector('img');
      const header = root.querySelector('[part="header"]');
      const headerButton = header?.querySelector('button');
      const composerSend = root.querySelector('[part="composer-send"]');
      return {
        hostCount: document.querySelectorAll('algolia-chat').length,
        titlePresent: text.includes('Algolia Assistant'),
        welcomePresent: welcomeText.includes('Hello, how can I help you today?') &&
          welcomeText.includes('Ask anything about Algolia - we love to explore.'),
        inventedCopy: /GROUNDED SEARCH|Ask about$/i.test(text),
        fontFamily: getComputedStyle(root.querySelector('button, input, textarea, [role="dialog"]') || host).fontFamily,
        accent: getComputedStyle(host).getPropertyValue('--algolia-accent').trim(),
        background: getComputedStyle(host).getPropertyValue('--algolia-bg').trim(),
        logoSource: logo?.getAttribute('src') || '',
        logoSize: logo ? { width: logo.getBoundingClientRect().width, height: logo.getBoundingClientRect().height } : null,
        headerDisplay: header ? getComputedStyle(header).display : '',
        headerButtonBorder: headerButton ? getComputedStyle(headerButton).borderTopWidth : '',
        composerSendSize: composerSend
          ? { width: composerSend.getBoundingClientRect().width, height: composerSend.getBoundingClientRect().height }
          : null,
        lightQuestionCount: host.querySelectorAll('[slot="sample-questions"] li').length,
        buttonLabels: buttons.map((button) => button.textContent.replace(/\s+/g, ' ').trim()),
        sampleButtonPresent: buttons.some((button) => /Sample questions/i.test(button.textContent || '')),
        capabilities: {
          tracker: typeof window.algoliaEngagementTracker?.track === 'function',
          context: typeof window.algoliaContextCompiler?.compile === 'function',
          proactive: typeof window.algoliaProactiveController?.evaluate === 'function',
          handoff: typeof window.algoliaHandoffToOrchestrator?.subscribeCompletedTurn === 'function',
          engage: typeof window.algoliaEngage?.configure === 'function',
          form: typeof window.algoliaFormTool?.configure === 'function',
          compare: typeof window.__acsCompare === 'object',
          telemetry: window.__algoliaTokenTelemetryInstalled === true,
        },
      };
    });

    assert.equal(initial.hostCount, 1);
    assert.equal(initial.titlePresent, true, JSON.stringify({ initial, errors }));
    assert.equal(initial.welcomePresent, true, JSON.stringify({ initial, errors }));
    assert.equal(initial.inventedCopy, false);
    assert.equal(initial.lightQuestionCount, 10, JSON.stringify(initial));
    assert.equal(initial.sampleButtonPresent, true, JSON.stringify(initial));

    await page.evaluate(() => {
      const root = document.querySelector('algolia-chat').shadowRoot;
      [...root.querySelectorAll('button')]
        .find((button) => /Sample questions/i.test(button.textContent || ''))
        ?.click();
    });
    await page.waitForFunction(() =>
      document.querySelector('algolia-chat')?.shadowRoot?.querySelector('[role="dialog"]'),
    );
    const questionButtons = await page.evaluate(() =>
      [...document.querySelector('algolia-chat').shadowRoot.querySelectorAll('[role="dialog"][aria-label="Sample questions"] button .min-w-0')]
        .map((label) => label.textContent.replace(/\s+/g, ' ').trim())
        .filter(Boolean),
    );
    const sampleDialogDisplay = await page.evaluate(() =>
      getComputedStyle(document.querySelector('algolia-chat').shadowRoot
        .querySelector('[role="dialog"][aria-label="Sample questions"] > .grid')).display,
    );

    assert.deepEqual(questionButtons, expectedQuestions);
    assert.match(initial.fontFamily, /Sora/i);
    assert.equal(initial.accent, '#003dff', JSON.stringify(initial));
    assert.equal(initial.background, '#f5f5fa', JSON.stringify(initial));
    assert.match(initial.logoSource, /^data:image\/svg\+xml,/);
    assert.deepEqual(initial.logoSize, { width: 32, height: 32 });
    assert.equal(initial.headerDisplay, 'flex');
    assert.equal(initial.headerButtonBorder, '0px');
    assert.deepEqual(initial.composerSendSize, { width: 40, height: 40 });
    assert.equal(sampleDialogDisplay, 'grid');
    assert.deepEqual(initial.capabilities, {
      tracker: true,
      context: true,
      proactive: true,
      handoff: true,
      engage: true,
      form: true,
      compare: true,
      telemetry: true,
    });
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

test('theme selector scoping preserves token names that contain body', async () => {
  const bundle = fs.readFileSync(bundlePath, 'utf8');
  assert.doesNotMatch(bundle, /--algolia-lh-:host/);
  assert.match(bundle, /--algolia-lh-body/);
});

test('one-file source build completes the approved answer, source, and follow-up lifecycle', async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 900, height: 950 } });
  const errors = [];
  const sourceBundleRequests = [];
  const judgeAgents = {
    'journey-judge-skeptic': 'skeptic',
    'journey-judge-referee': 'referee',
    'journey-judge-advocate': 'advocate',
  };
  const judgeStarts = [];
  let telemetryInput = 47000;
  let telemetryOutput = 700;
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });

  try {
    await page.route('http://127.0.0.1:41801/bundle.js', (route) => route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: fs.readFileSync(bundlePath),
    }));
    const frames = [
      {
        type: 'tool-output-available',
        toolCallId: 'search-1',
        output: {
          hits: [{
            objectID: 'rate-limits',
            title: 'Rate limiting an API key',
            url: 'https://www.algolia.com/doc/guides/security/api-keys/in-depth/rate-limits/',
            source: 'Documentation',
            text: 'Rate limits keep request volume and cost predictable.',
          }],
        },
      },
      {
        type: 'text-delta',
        delta: 'Managing requests is like controlling traffic at an entrance.\n\nShort version: debounce ordinary typing and rate-limit abusive clients.\n\n## Details\nUse API-key limits that match the traffic source.',
      },
      {
        type: 'data-suggestions',
        data: { suggestions: ['Which traffic source should we size first?'] },
      },
    ];
    await page.route('**/*.algolia.net/**', async (route) => {
      const request = route.request();
      if (request.url().includes('/agent-studio/1/agents/')) {
        const roleEntry = Object.entries(judgeAgents)
          .find(([agentId]) => request.url().includes(`/${agentId}/`));
        if (roleEntry) {
          const [, role] = roleEntry;
          const body = JSON.parse(request.postData() || '{}');
          const query = body.messages?.findLast?.((message) => message.role === 'user')
            ?.parts?.find((part) => part.type === 'text')?.text;
          const judgeInput = JSON.parse(query || '{}');
          const passageId = judgeInput.evidencePacket?.passageIndex?.[0]?.evidencePassageId;
          const report = {
            dimensionScores: { grounding: 8, completeness: 8, depth: 8, relevance: 8 },
            dimensionRationales: {
              grounding: 'The answer is supported by the supplied passage.',
              completeness: 'The answer covers the question.',
              depth: 'The answer gives useful detail.',
              relevance: 'The answer remains relevant.',
            },
            sentenceAssessments: judgeInput.answerManifest.map((unit) => ({
              sentenceId: unit.sentenceId,
              classification: 'factual',
              nonFactualSpans: [],
              claims: [{
                claimText: unit.text,
                verdict: 'supported',
                materiality: 'minor',
                centralToAnswer: false,
                evidencePassageIds: [passageId],
                reason: 'The supplied passage supports this statement.',
              }],
            })),
            summary: `${role} found the answer supported.`,
          };
          judgeStarts.push({ role, at: Date.now() });
          await route.fulfill({
            status: 200,
            contentType: 'text/event-stream',
            body: `data: ${JSON.stringify({ type: 'text-delta', delta: JSON.stringify(report) })}\n\n`,
          });
          return;
        }
        const sourceBundleRequest = JSON.parse(request.postData() || '{}');
        sourceBundleRequests.push(sourceBundleRequest);
        const question = sourceBundleRequest.messages?.findLast?.((message) => message.role === 'user')
          ?.parts?.find((part) => part.type === 'text')?.text || '';
        const responseFrames = question.includes('Which traffic source')
          ? [
              {
                type: 'tool-output-available',
                toolCallId: 'search-2',
                output: { hits: [{
                  objectID: 'merchandising',
                  title: 'Merchandising strategy',
                  url: 'https://www.algolia.com/doc/guides/managing-results/rules/merchandising-and-promoting/',
                  source: 'Documentation',
                  text: 'Rules and merchandising controls shape promoted results.',
                }] },
              },
              {
                type: 'text-delta',
                delta: 'Merchandising is like arranging a storefront for a specific audience.\n\nShort version: use Rules for deliberate promotion while relevance still retrieves the candidates.\n\n## Details\nStart with the business outcome, then apply the narrowest Rule that achieves it.',
              },
              {
                type: 'data-suggestions',
                data: { suggestions: ['Which merchandising outcome should we prioritize first?'] },
              },
            ]
          : frames;
        await route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Expose-Headers': 'X-Conversation-Id',
            'X-Conversation-Id': 'conversation-source-bundle',
          },
          body: responseFrames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join(''),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ results: [{ hits: [], nbHits: 0 }] }),
      });
    });
    await page.route('http://127.0.0.1:41801/sites/algolia-assets/home.algoliaTokenTelemetry.do',
      (route) => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          inputTokens: telemetryInput += 599,
          outputTokens: telemetryOutput += 66,
          totalTokens: telemetryInput + telemetryOutput,
        }),
      }),
    );
    await page.route('http://127.0.0.1:41801/__compare/production', (route) => route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: `data: ${JSON.stringify({ type: 'text-delta', delta: 'Production comparison answer.' })}\n\n`,
    }));
    await page.route('http://127.0.0.1:41801/', (route) => route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html><head>
        <script>window.ACS_COMPARE={prod:{proxyPath:'/__compare/production'}};</script>
        <script src="/bundle.js"></script>
      </head><body>
        <algolia-chat app-id="test-app" search-api-key="test-key" index-name="test-index"
          theme="algolia" product-title="Algolia Assistant" show-welcome="true">
          <div slot="welcome"><p>Hello, how can I help you today?</p></div>
          <algolia-agent role="primary" agent-id="test-agent" label="Assistant"></algolia-agent>
          <algolia-chat-confidence agents='${JSON.stringify(Object.entries(judgeAgents).map(([id, role]) => ({ id, role })))}'></algolia-chat-confidence>
        </algolia-chat>
      </body></html>`,
    }));
    await page.goto('http://127.0.0.1:41801/', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      if (typeof crypto.randomUUID !== 'function') {
        Object.defineProperty(crypto, 'randomUUID', {
          configurable: true,
          value: () => `test-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        });
      }
    });
    await page.waitForFunction(() => document.querySelector('algolia-chat')?.shadowRoot);
    await page.evaluate(() => {
      const widget = document.querySelector('algolia-chat');
      widget.open();
      widget.ask('How should I configure rate limiting?');
    });
    await page.waitForFunction(() => {
      const root = document.querySelector('algolia-chat')?.shadowRoot;
      return root?.textContent?.includes('Use API-key limits that match the traffic source.') &&
        root?.textContent?.includes('Which traffic source should we size first?');
    }, null, { timeout: 10000 });
    try {
      await page.waitForFunction(() => {
        const record = window.algoliaAnswerHarness?.records?.().at(-1);
        return record?.slots?.telemetry?.status === 'ready' &&
          record?.slots?.actions?.status === 'ready';
      }, null, { timeout: 4000 });
    } catch {
      const slots = await page.evaluate(() => window.algoliaAnswerHarness?.records?.().at(-1)?.slots);
      assert.fail(JSON.stringify({ slots, errors }));
    }

    const state = await page.evaluate(() => {
      const root = document.querySelector('algolia-chat').shadowRoot;
      const text = root.textContent.replace(/\s+/g, ' ').trim();
      return {
        text,
        sourceLink: root.querySelector('a[href*="rate-limits"]')?.textContent?.trim() || '',
        followUpCount: root.querySelectorAll('.acs-followup-wrap button').length,
        harnessRecords: window.algoliaAnswerHarness?.records?.().length || 0,
        rendererAuthority: window.ALGOLIA_ANSWER_RENDERER_AUTHORITY === true,
        migratedBodies: root.querySelectorAll('[data-algolia-rendered-answer-body]').length,
        visibleLegacyBodies: [...root.querySelectorAll('.acs-answer-layer')]
          .filter((node) => !node.hasAttribute('data-algolia-rendered-answer-body') && !node.hidden).length,
        rendererSourceRegions: root.querySelectorAll('[data-algolia-rendered-answer-sources]').length,
        rendererFollowUpRegions: root.querySelectorAll('[data-algolia-rendered-answer-follow-up]').length,
        telemetry: root.querySelector('.algolia-usage-pill')?.textContent?.replace(/\s+/g, ' ').trim() || '',
        compare: root.querySelector('#acs-compare-toggle')?.textContent?.trim() || '',
        footerWrap: getComputedStyle(root.querySelector('[data-algolia-rendered-answer-footer]')).flexWrap,
      };
    });

    assert.match(state.text, /Managing requests is like controlling traffic/);
    assert.match(state.text, /Short version: debounce ordinary typing/);
    assert.match(state.sourceLink, /Rate limiting an API key/);
    assert.equal(state.followUpCount, 1);
    assert.equal(state.rendererAuthority, true);
    assert.equal(state.harnessRecords, 1, JSON.stringify(state));
    assert.equal(state.migratedBodies, 1, JSON.stringify(state));
    assert.equal(state.visibleLegacyBodies, 0, JSON.stringify(state));
    assert.equal(state.rendererSourceRegions, 1, JSON.stringify(state));
    assert.equal(state.rendererFollowUpRegions, 1, JSON.stringify(state));
    assert.equal(state.telemetry, 'In 47,599 / 766 Out', JSON.stringify(state));
    assert.equal(state.compare, 'Compare with Prod', JSON.stringify(state));
    assert.equal(state.footerWrap, 'nowrap', JSON.stringify(state));
    assert.ok(sourceBundleRequests[0]?.messages?.length > 0);
    assert.deepEqual(errors, []);

    try {
      await page.waitForFunction(() => {
        const badge = document.querySelector('algolia-chat')?.shadowRoot?.querySelector('algolia-confidence-badge');
        return badge?.shadowRoot?.textContent?.includes('8.0');
      }, null, { timeout: 10000 });
    } catch (error) {
      const judgeDiagnostic = await page.evaluate(() => {
        const root = document.querySelector('algolia-chat')?.shadowRoot;
        const badge = root?.querySelector('algolia-confidence-badge');
        return {
          badge: badge?.shadowRoot?.textContent?.replace(/\s+/g, ' ').trim() || '',
          verdict: badge?.verdict,
          text: root?.textContent?.replace(/\s+/g, ' ').trim() || '',
        };
      });
      throw new Error(`First-turn confidence did not complete: ${JSON.stringify({ judgeStarts, judgeDiagnostic, errors })}`, {
        cause: error,
      });
    }
    const followUpClick = await page.evaluate(() => {
      const host = document.querySelector('algolia-chat');
      const button = host.shadowRoot
        .querySelector('[data-algolia-rendered-answer-follow-up] button');
      const originalAsk = host.ask.bind(host);
      host.ask = (question) => {
        window.__canonicalFollowUpAsk = question;
        return originalAsk(question);
      };
      button.click();
      return {
        question: button.dataset.algoliaFollowUp || '',
        asked: window.__canonicalFollowUpAsk || '',
        rootHostMatches: button.getRootNode()?.host === host,
      };
    });
    assert.equal(followUpClick.rootHostMatches, true, JSON.stringify(followUpClick));
    assert.equal(followUpClick.asked, followUpClick.question, JSON.stringify(followUpClick));
    try {
      await page.waitForFunction(() => {
        const root = document.querySelector('algolia-chat')?.shadowRoot;
        return root?.textContent?.includes('Start with the business outcome') &&
          root?.querySelectorAll('[data-algolia-rendered-answer-body]').length === 2 &&
          root?.querySelectorAll('[data-algolia-rendered-answer-sources]').length === 2 &&
          root?.querySelectorAll('algolia-confidence-badge').length === 2;
      }, null, { timeout: 10000 });
    } catch (error) {
      const multiTurnDiagnostic = await page.evaluate(() => {
        const root = document.querySelector('algolia-chat')?.shadowRoot;
        return {
          text: root?.textContent?.replace(/\s+/g, ' ').trim() || '',
          bodies: root?.querySelectorAll('[data-algolia-rendered-answer-body]').length || 0,
          sources: root?.querySelectorAll('[data-algolia-rendered-answer-sources]').length || 0,
          badges: root?.querySelectorAll('algolia-confidence-badge').length || 0,
          records: window.algoliaAnswerHarness?.records?.().map((record) => ({
            identity: record.identity,
            lifecycle: record.lifecycle,
          })) || [],
        };
      });
      throw new Error(`Second discovery turn did not complete: ${JSON.stringify({ sourceBundleRequests, judgeStarts, multiTurnDiagnostic, errors })}`, {
        cause: error,
      });
    }
    const multiTurn = await page.evaluate(() => {
      const root = document.querySelector('algolia-chat').shadowRoot;
      const pills = [...root.querySelectorAll('.algolia-usage-pill')];
      const buttons = [...root.querySelectorAll('#acs-compare-toggle')];
      const badges = [...root.querySelectorAll('algolia-confidence-badge')];
      return {
        userTurns: root.querySelectorAll('[part="message-user-bubble"]').length,
        bodies: root.querySelectorAll('[data-algolia-rendered-answer-body]').length,
        sources: root.querySelectorAll('[data-algolia-rendered-answer-sources]').length,
        followUps: root.querySelectorAll('[data-algolia-rendered-answer-follow-up]').length,
        telemetry: pills.at(-1)?.textContent?.replace(/\s+/g, ' ').trim() || '',
        compare: buttons.at(-1)?.textContent?.trim() || '',
        confidenceSharesFooter: badges.every((badge) =>
          badge.parentElement?.hasAttribute('data-algolia-answer-footer')),
      };
    });
    assert.deepEqual(multiTurn, {
      userTurns: 2,
      bodies: 2,
      sources: 2,
      followUps: 2,
      telemetry: 'In 599 / 66 Out',
      compare: 'Compare with Prod',
      confidenceSharesFooter: true,
    });
    assert.equal(sourceBundleRequests.length, 2, JSON.stringify(sourceBundleRequests));
    assert.deepEqual(
      judgeStarts.map(({ role }) => role).sort(),
      ['advocate', 'advocate', 'referee', 'referee', 'skeptic', 'skeptic'],
    );
    const judgeRequestCountBeforeReload = judgeStarts.length;

    // The production stack loads Compare in <head> before the custom element is
    // parsed. Give its bounded widget-attachment loop one turn before exercising
    // the delegated shadow-root click listener.
    await page.waitForTimeout(150);
    await page.evaluate(() =>
      document.querySelector('algolia-chat').shadowRoot.querySelector('#acs-compare-toggle').click(),
    );
    try {
      await page.waitForFunction(() =>
        document.querySelector('algolia-chat')?.shadowRoot?.textContent?.includes('Production comparison answer.'),
        null,
        { timeout: 10000 },
      );
    } catch (error) {
      const diagnostic = await page.evaluate(() => {
        const root = document.querySelector('algolia-chat')?.shadowRoot;
        return {
          text: root?.textContent?.replace(/\s+/g, ' ').trim() || '',
          comparePressed: root?.querySelector('#acs-compare-toggle')?.getAttribute('aria-pressed'),
          compareConfig: window.ACS_COMPARE,
        };
      });
      throw new Error(`Compare did not render in bundle parity test: ${JSON.stringify(diagnostic)}`, {
        cause: error,
      });
    }

    await page.reload({ waitUntil: 'domcontentloaded' });
    try {
      await page.waitForFunction(() => {
        const root = document.querySelector('algolia-chat')?.shadowRoot;
        return root?.querySelectorAll('[data-algolia-rendered-answer-body]').length === 2 &&
          root?.querySelectorAll('[data-algolia-rendered-answer-sources]').length === 2 &&
          root?.querySelectorAll('[data-algolia-rendered-answer-follow-up]').length === 2;
      }, null, { timeout: 10000 });
    } catch (error) {
      const diagnostic = await page.evaluate(() => {
        const host = document.querySelector('algolia-chat');
        const root = host?.shadowRoot;
        return {
          widgetInstanceId: host?.__algoliaWidgetInstanceId || '',
          bodyText: root?.textContent?.replace(/\s+/g, ' ').trim() || '',
          legacyBodies: root?.querySelectorAll('.acs-answer-layer').length || 0,
          migratedBodies: root?.querySelectorAll('[data-algolia-rendered-answer-body]').length || 0,
          footers: [...(root?.querySelectorAll('[data-algolia-answer-footer]') || [])]
            .map((node) => ({ id: node.dataset.algoliaAnswerFooter, html: node.outerHTML })),
          harnessRecords: window.algoliaAnswerHarness?.records?.() || [],
          storage: sessionStorage.getItem('algolia-chat:conversation'),
        };
      });
      throw new Error(`Restored answer did not acquire renderer authority: ${JSON.stringify(diagnostic)}`, {
        cause: error,
      });
    }
    const restored = await page.evaluate(() => {
      const root = document.querySelector('algolia-chat').shadowRoot;
      return {
        assistantLabels: [...root.querySelectorAll('span')]
          .filter((node) => node.textContent?.trim() === 'Assistant').length,
        migratedBodies: root.querySelectorAll('[data-algolia-rendered-answer-body]').length,
        sourceRegions: root.querySelectorAll('[data-algolia-rendered-answer-sources]').length,
        followUpRegions: root.querySelectorAll('[data-algolia-rendered-answer-follow-up]').length,
        sourceLink: root.querySelector('a[href*="rate-limits"]')?.textContent?.trim() || '',
        text: root.textContent.replace(/\s+/g, ' ').trim(),
        records: window.algoliaAnswerHarness?.records?.().map((record) => record.identity) || [],
      };
    });
    assert.equal(restored.assistantLabels, 2, JSON.stringify(restored));
    assert.equal(restored.migratedBodies, 2, JSON.stringify(restored));
    assert.equal(restored.sourceRegions, 2, JSON.stringify(restored));
    assert.equal(restored.followUpRegions, 2, JSON.stringify(restored));
    assert.match(restored.sourceLink, /Rate limiting an API key/);
    assert.match(restored.text, /Managing requests is like controlling traffic/);
    assert.match(restored.text, /Which traffic source should we size first\?/);
    assert.equal(restored.records.length, 2, JSON.stringify(restored));
    assert.ok(restored.records.every((identity) => /^restored:/.test(identity.networkAttemptId)));
    await page.waitForTimeout(500);
    assert.equal(
      judgeStarts.length,
      judgeRequestCountBeforeReload,
      'restoring completed answers must not re-run their judge panels',
    );
  } finally {
    await browser.close();
  }
});

test('one-file source build isolates two mounted widgets and their canonical answer identities', async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));

  try {
    await page.route('**/*.algolia.net/**', async (route) => {
      const request = route.request();
      if (request.url().includes('/agent-studio/1/agents/')) {
        const body = JSON.parse(request.postData() || '{}');
        const question = body.messages?.findLast?.((message) => message.role === 'user')
          ?.parts?.find((part) => part.type === 'text')?.text || '';
        const side = question.includes('LEFT') ? 'LEFT' : 'RIGHT';
        await route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Expose-Headers': 'X-Conversation-Id',
            'X-Conversation-Id': `conversation-${side.toLowerCase()}`,
          },
          body: `data: ${JSON.stringify({
            type: 'text-delta',
            delta: `${side} answer is like an isolated room.\n\nShort version: ${side} stays separate.\n\n## Details\nOnly ${side} owns this answer.`,
          })}\n\n`,
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ results: [{ hits: [], nbHits: 0 }] }),
      });
    });
    await page.route('http://content-engagement.local/', (route) => route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html><body>
        <algolia-chat app-id="test-app" search-api-key="test-key" index-name="test-index" theme="algolia">
          <algolia-agent role="primary" agent-id="test-agent" label="Assistant"></algolia-agent>
        </algolia-chat>
        <algolia-chat app-id="test-app" search-api-key="test-key" index-name="test-index" theme="algolia">
          <algolia-agent role="primary" agent-id="test-agent" label="Assistant"></algolia-agent>
        </algolia-chat>
      </body></html>`,
    }));
    await page.goto('http://content-engagement.local/');
    await page.evaluate(() => {
      if (typeof crypto.randomUUID !== 'function') {
        let id = 0;
        Object.defineProperty(crypto, 'randomUUID', {
          configurable: true,
          value: () => `test-id-${++id}`,
        });
      }
    });
    await page.addScriptTag({ path: bundlePath });
    await page.waitForFunction(() => document.querySelectorAll('algolia-chat')[1]?.shadowRoot);
    await page.evaluate(() => {
      const [left, right] = document.querySelectorAll('algolia-chat');
      left.ask('LEFT question');
      right.ask('RIGHT question');
    });
    await page.waitForFunction(() => {
      const [left, right] = document.querySelectorAll('algolia-chat');
      return left.shadowRoot?.textContent?.includes('Only LEFT owns this answer.') &&
        right.shadowRoot?.textContent?.includes('Only RIGHT owns this answer.');
    }, null, { timeout: 10000 });

    const result = await page.evaluate(() => {
      const [left, right] = document.querySelectorAll('algolia-chat');
      const records = window.algoliaAnswerHarness.records();
      return {
        ids: [left.__algoliaWidgetInstanceId, right.__algoliaWidgetInstanceId],
        leftText: left.shadowRoot.textContent.replace(/\s+/g, ' '),
        rightText: right.shadowRoot.textContent.replace(/\s+/g, ' '),
        recordWidgetIds: records.map((record) => record.identity.widgetInstanceId).sort(),
        recordCount: records.length,
      };
    });

    assert.notEqual(result.ids[0], result.ids[1]);
    assert.match(result.leftText, /Only LEFT owns this answer/);
    assert.doesNotMatch(result.leftText, /Only RIGHT owns this answer/);
    assert.match(result.rightText, /Only RIGHT owns this answer/);
    assert.doesNotMatch(result.rightText, /Only LEFT owns this answer/);
    assert.equal(result.recordCount, 2, JSON.stringify(result));
    assert.deepEqual(result.recordWidgetIds, [...result.ids].sort());
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

test('one-file source build keeps retry on one segment and advances only the network attempt', async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  let requestCount = 0;

  try {
    await page.route('**/*.algolia.net/**', async (route) => {
      const request = route.request();
      if (!request.url().includes('/agent-studio/1/agents/')) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{"results":[{"hits":[]}]}' });
        return;
      }
      requestCount += 1;
      if (requestCount <= 2) {
        await route.fulfill({ status: 503, body: 'temporary failure' });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Expose-Headers': 'X-Conversation-Id',
          'X-Conversation-Id': 'conversation-retry',
        },
        body: `data: ${JSON.stringify({
          type: 'text-delta',
          delta: 'Retry is like reopening one task.\n\nShort version: the new request owns the result.\n\n## Details\nThe same visible answer segment survives.',
        })}\n\n`,
      });
    });
    await page.route('http://content-engagement.local/', (route) => route.fulfill({
      contentType: 'text/html',
      body: '<algolia-chat app-id="test-app" search-api-key="test-key" index-name="test-index" theme="algolia"><algolia-agent role="primary" agent-id="test-agent" label="Assistant"></algolia-agent></algolia-chat>',
    }));
    await page.goto('http://content-engagement.local/');
    await page.evaluate(() => {
      if (typeof crypto.randomUUID !== 'function') {
        let id = 0;
        Object.defineProperty(crypto, 'randomUUID', { configurable: true, value: () => `retry-${++id}` });
      }
    });
    await page.addScriptTag({ path: bundlePath });
    await page.waitForFunction(() => document.querySelector('algolia-chat')?.shadowRoot);
    await page.evaluate(() => document.querySelector('algolia-chat').ask('Retry this answer'));
    await page.waitForFunction(() =>
      document.querySelector('algolia-chat')?.shadowRoot?.querySelector('[role="alert"] button')
        ?.textContent?.trim() === 'Retry',
      null,
      { timeout: 10000 },
    );
    const failedPresentation = await page.evaluate(() => {
      const root = document.querySelector('algolia-chat')?.shadowRoot;
      return {
        sources: root?.querySelectorAll('[data-algolia-rendered-answer-sources]').length || 0,
        telemetry: root?.querySelectorAll('.algolia-usage-pill').length || 0,
        followUps: root?.querySelectorAll('[data-algolia-rendered-answer-follow-up]').length || 0,
      };
    });
    assert.deepEqual(failedPresentation, { sources: 0, telemetry: 0, followUps: 0 });
    await page.evaluate(() =>
      document.querySelector('algolia-chat').shadowRoot.querySelector('[role="alert"] button').click(),
    );
    await page.waitForFunction(() =>
      document.querySelector('algolia-chat')?.shadowRoot?.textContent?.includes('The same visible answer segment survives.'),
      null,
      { timeout: 10000 },
    );

    const identities = await page.evaluate(() =>
      window.algoliaAnswerHarness.records().map((record) => record.identity),
    );
    const latest = identities.at(-1);
    assert.ok(identities.length >= 3, JSON.stringify(identities));
    assert.ok(identities.every((identity) => identity.answerSegmentId === latest.answerSegmentId));
    assert.equal(new Set(identities.map((identity) => identity.networkAttemptId)).size, identities.length);
    assert.equal(requestCount, 3);
  } finally {
    await browser.close();
  }
});

test('one-file source build runs the approved three-role judge panel in parallel without a chief or score cap', async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const judgeAgents = {
    'judge-skeptic': 'skeptic',
    'judge-referee': 'referee',
    'judge-advocate': 'advocate',
  };
  const judgeStarts = [];
  const judgeBodies = [];
  const primaryRequests = [];
  const runtimeErrors = [];
  page.on('pageerror', (error) => runtimeErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') runtimeErrors.push(message.text());
  });

  try {
    await page.route('**/*.algolia.net/**', async (route) => {
      const request = route.request();
      const url = request.url();
      if (!url.includes('/agent-studio/1/agents/')) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{"results":[{"hits":[]}]}' });
        return;
      }
      const roleEntry = Object.entries(judgeAgents).find(([agentId]) => url.includes(`/${agentId}/`));
      if (!roleEntry) {
        primaryRequests.push(url);
        await route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Expose-Headers': 'X-Conversation-Id',
            'X-Conversation-Id': 'conversation-judge-source',
          },
          body: [
            {
              type: 'tool-output-available',
              toolCallId: 'search-judge',
              output: { hits: [{
                objectID: 'judge-source',
                title: 'Rate limit guidance',
                url: 'https://www.algolia.com/doc/rate-limit-guidance',
                source: 'Documentation',
                text: 'Debouncing typing and rate limiting abusive clients controls request volume.',
              }] },
            },
            { type: 'text-delta', delta: 'Debouncing typing controls request volume.' },
          ].map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join(''),
        });
        return;
      }

      const [, role] = roleEntry;
      judgeStarts.push({ role, at: Date.now() });
      const body = JSON.parse(request.postData() || '{}');
      const query = body.messages?.findLast?.((message) => message.role === 'user')
        ?.parts?.find((part) => part.type === 'text')?.text;
      const judgeInput = JSON.parse(query || '{}');
      judgeBodies.push({ role, judgeInput });
      const passageId = judgeInput.evidencePacket?.passageIndex?.[0]?.evidencePassageId;
      const report = {
        dimensionScores: { grounding: 8, completeness: 8, depth: 8, relevance: 8 },
        dimensionRationales: {
          grounding: 'The answer is supported by the supplied passage.',
          completeness: 'The answer directly covers the question.',
          depth: 'The answer provides sufficient depth for this narrow question.',
          relevance: 'The answer remains relevant to the request.',
        },
        sentenceAssessments: judgeInput.answerManifest.map((unit) => ({
          sentenceId: unit.sentenceId,
          classification: 'factual',
          nonFactualSpans: [],
          claims: [{
            claimText: unit.text,
            verdict: 'supported',
            materiality: 'minor',
            centralToAnswer: false,
            evidencePassageIds: [passageId],
            reason: 'The evidence passage supports this statement.',
          }],
        })),
        summary: `${role} found the answer supported.`,
      };
      await new Promise((resolve) => setTimeout(resolve, 40));
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: `data: ${JSON.stringify({ type: 'text-delta', delta: JSON.stringify(report) })}\n\n`,
      });
    });
    await page.route('http://127.0.0.1:41799/', (route) => route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html><body>
        <algolia-chat app-id="test-app" search-api-key="test-key" index-name="test-index" theme="algolia">
          <algolia-agent role="primary" agent-id="primary-agent" label="Assistant"></algolia-agent>
          <algolia-chat-confidence>
            ${Object.entries(judgeAgents).map(([id, role]) =>
              `<algolia-agent role="${role}" agent-id="${id}" label="${role}"></algolia-agent>`
            ).join('')}
          </algolia-chat-confidence>
        </algolia-chat>
      </body></html>`,
    }));
    await page.goto('http://127.0.0.1:41799/');
    await page.evaluate(() => {
      if (typeof crypto.randomUUID !== 'function') {
        let id = 0;
        Object.defineProperty(crypto, 'randomUUID', {
          configurable: true,
          value: () => `judge-test-${++id}`,
        });
      }
    });
    await page.addScriptTag({ path: bundlePath });
    await page.waitForFunction(() => document.querySelector('algolia-chat')?.shadowRoot);
    await page.evaluate(() => document.querySelector('algolia-chat').ask('How should requests be controlled?'));
    try {
      await page.waitForFunction(() => {
        const badge = document.querySelector('algolia-chat')?.shadowRoot?.querySelector('algolia-confidence-badge');
        return badge?.shadowRoot?.textContent?.includes('8.0');
      }, null, { timeout: 10000 });
    } catch {
      const diagnostics = await page.evaluate(() => {
        const root = document.querySelector('algolia-chat')?.shadowRoot;
        const badge = root?.querySelector('algolia-confidence-badge');
        return {
          widgetText: root?.textContent?.replace(/\s+/g, ' ').trim(),
          badgeText: badge?.shadowRoot?.textContent?.replace(/\s+/g, ' ').trim(),
          badgeVerdict: badge?.verdict,
          confidence: (() => {
            const element = document.querySelector('algolia-chat-confidence');
            return element ? {
              mode: element.judgeMode,
              agents: element.judgeAgents,
              hasWidget: Boolean(element.instantSearchWidget),
            } : null;
          })(),
          childWidgets: [...document.querySelector('algolia-chat').querySelectorAll('algolia-agent')]
            .map((element) => ({ role: element.getAttribute('role'), id: element.getAttribute('agent-id'), hasWidget: Boolean(element.instantSearchWidget) })),
        };
      });
      assert.fail(JSON.stringify({ judgeStarts, judgeBodies, runtimeErrors, diagnostics }));
    }

    const state = await page.evaluate(() => {
      const root = document.querySelector('algolia-chat').shadowRoot;
      const badge = root.querySelector('algolia-confidence-badge');
      const record = window.algoliaAnswerHarness.records().at(-1);
      return {
        badge: badge?.shadowRoot?.textContent?.replace(/\s+/g, ' ').trim(),
        badgeInsideControls: badge?.parentElement?.hasAttribute('data-algolia-rendered-answer-footer'),
        harnessConfidence: record?.slots?.confidence?.status,
      };
    });
    assert.deepEqual(judgeStarts.map(({ role }) => role).sort(), ['advocate', 'referee', 'skeptic']);
    assert.equal(primaryRequests.length, 1, JSON.stringify(primaryRequests));
    assert.match(primaryRequests[0], /\/agents\/primary-agent\/completions/);
    assert.equal(judgeStarts.length, 3, JSON.stringify(judgeStarts));
    assert.ok(Math.max(...judgeStarts.map(({ at }) => at)) - Math.min(...judgeStarts.map(({ at }) => at)) < 150,
      JSON.stringify(judgeStarts));
    assert.ok(judgeBodies.every(({ judgeInput }) =>
      judgeInput.contractVersion === 'algolia-judge-v3.3' &&
      judgeInput.answerManifest?.length > 0 &&
      judgeInput.evidencePacket?.passageIndex?.length > 0));
    assert.match(state.badge, /Confidence\s*8\.0\s*\/10/);
    assert.equal(state.badgeInsideControls, false, JSON.stringify(state));
    assert.equal(state.harnessConfidence, 'unavailable');
  } finally {
    await browser.close();
  }
});

test('one-file source build gives the three-role panel one bounded retry owner', async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const judgeAgents = {
    'judge-skeptic': 'skeptic',
    'judge-referee': 'referee',
    'judge-advocate': 'advocate',
  };
  const requestsByRole = new Map(Object.values(judgeAgents).map((role) => [role, 0]));
  const requestTimesByRole = new Map(Object.values(judgeAgents).map((role) => [role, []]));
  const validationFeedbackByRole = new Map(Object.values(judgeAgents).map((role) => [role, []]));

  try {
    await page.route('**/*.algolia.net/**', async (route) => {
      const request = route.request();
      const url = request.url();
      if (!url.includes('/agent-studio/1/agents/')) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{"results":[]}' });
        return;
      }

      const roleEntry = Object.entries(judgeAgents).find(([agentId]) => url.includes(`/${agentId}/`));
      if (roleEntry) {
        const [, role] = roleEntry;
        requestsByRole.set(role, requestsByRole.get(role) + 1);
        requestTimesByRole.get(role).push(Date.now());
        const body = JSON.parse(request.postData() || '{}');
        const query = body.messages?.findLast?.((message) => message.role === 'user')
          ?.parts?.find((part) => part.type === 'text')?.text;
        const judgeInput = JSON.parse(query || '{}');
        validationFeedbackByRole.get(role).push(Object.hasOwn(judgeInput, 'validationFeedback'));
        await route.fulfill({
          status: 429,
          headers: { 'Retry-After': '0.05' },
          contentType: 'application/json',
          body: '{"message":"judge capacity temporarily unavailable"}',
        });
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: [
          {
            type: 'tool-output-available',
            toolCallId: 'search-judge-rate-limit',
            output: { hits: [{
              objectID: 'judge-rate-limit-source',
              title: 'Rate limit guidance',
              url: 'https://www.algolia.com/doc/rate-limit-guidance',
              source: 'Documentation',
              text: 'Bounded retries prevent retry storms.',
            }] },
          },
          { type: 'text-delta', delta: 'Bounded retries prevent retry storms.' },
        ].map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join(''),
      });
    });
    await page.route('http://127.0.0.1:41800/', (route) => route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html><body>
        <algolia-chat app-id="test-app" search-api-key="test-key" index-name="test-index" theme="algolia">
          <algolia-agent role="primary" agent-id="primary-agent" label="Assistant"></algolia-agent>
          <algolia-chat-confidence agents='${JSON.stringify(Object.entries(judgeAgents).map(([id, role]) => ({ id, role })))}'></algolia-chat-confidence>
        </algolia-chat>
      </body></html>`,
    }));
    await page.goto('http://127.0.0.1:41800/');
    await page.addScriptTag({ path: bundlePath });
    await page.waitForFunction(() => document.querySelector('algolia-chat')?.shadowRoot);
    await page.evaluate(() => document.querySelector('algolia-chat').ask('How should judge retries be bounded?'));
    await page.waitForFunction(() => {
      const badge = document.querySelector('algolia-chat')?.shadowRoot?.querySelector('algolia-confidence-badge');
      return Boolean(badge?.verdict?.error);
    }, null, { timeout: 10000 });

    const state = await page.evaluate(() => {
      const badge = document.querySelector('algolia-chat')?.shadowRoot?.querySelector('algolia-confidence-badge');
      return {
        errorKind: badge?.verdict?.errorKind,
        error: badge?.verdict?.error,
        badgeText: badge?.shadowRoot?.querySelector('.badge')?.textContent?.replace(/\s+/g, ' ').trim(),
      };
    });
    assert.deepEqual(Object.fromEntries(requestsByRole), {
      skeptic: 2,
      referee: 2,
      advocate: 2,
    });
    assert.equal([...requestsByRole.values()].reduce((total, value) => total + value, 0), 6);
    for (const times of requestTimesByRole.values()) {
      assert.equal(times.length, 2);
      assert.ok(times[1] - times[0] >= 35, JSON.stringify(Object.fromEntries(requestTimesByRole)));
    }
    assert.deepEqual(Object.fromEntries(validationFeedbackByRole), {
      skeptic: [false, false],
      referee: [false, false],
      advocate: [false, false],
    });
    assert.equal(state.errorKind, 'rate-limit');
    assert.match(state.error, /rate-limit/i);
    assert.match(state.badgeText, /Confidence\s*unavailable/i);
  } finally {
    await browser.close();
  }
});

test('one-file source build retries only the failed role and serves a provisional two-judge result', async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const judgeAgents = {
    'judge-skeptic': 'skeptic',
    'judge-referee': 'referee',
    'judge-advocate': 'advocate',
  };
  const requestsByRole = new Map(Object.values(judgeAgents).map((role) => [role, 0]));

  try {
    await page.route('**/*.algolia.net/**', async (route) => {
      const request = route.request();
      const url = request.url();
      if (!url.includes('/agent-studio/1/agents/')) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{"results":[]}' });
        return;
      }

      const roleEntry = Object.entries(judgeAgents).find(([agentId]) => url.includes(`/${agentId}/`));
      if (!roleEntry) {
        await route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          body: [
            {
              type: 'tool-output-available',
              toolCallId: 'search-provisional',
              output: { hits: [{
                objectID: 'provisional-source',
                title: 'Retry guidance',
                url: 'https://www.algolia.com/doc/retry-guidance',
                source: 'Documentation',
                text: 'A two-judge result is provisional when one role is unavailable.',
              }] },
            },
            { type: 'text-delta', delta: 'A two-judge result is provisional when one role is unavailable.' },
          ].map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join(''),
        });
        return;
      }

      const [, role] = roleEntry;
      requestsByRole.set(role, requestsByRole.get(role) + 1);
      if (role === 'skeptic') {
        await route.fulfill({
          status: 429,
          headers: { 'Retry-After': '0' },
          contentType: 'application/json',
          body: '{"message":"skeptic temporarily unavailable"}',
        });
        return;
      }

      const body = JSON.parse(request.postData() || '{}');
      const query = body.messages?.findLast?.((message) => message.role === 'user')
        ?.parts?.find((part) => part.type === 'text')?.text;
      const judgeInput = JSON.parse(query || '{}');
      const passageId = judgeInput.evidencePacket?.passageIndex?.[0]?.evidencePassageId;
      const report = {
        dimensionScores: { grounding: 8, completeness: 8, depth: 8, relevance: 8 },
        dimensionRationales: {
          grounding: 'The answer is supported by the supplied passage.',
          completeness: 'The answer directly covers the question.',
          depth: 'The answer provides sufficient depth.',
          relevance: 'The answer remains relevant.',
        },
        sentenceAssessments: judgeInput.answerManifest.map((unit) => ({
          sentenceId: unit.sentenceId,
          classification: 'factual',
          nonFactualSpans: [],
          claims: [{
            claimText: unit.text,
            verdict: 'supported',
            materiality: 'minor',
            centralToAnswer: false,
            evidencePassageIds: [passageId],
            reason: 'The supplied passage supports the statement.',
          }],
        })),
        summary: `${role} found the answer supported.`,
      };
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: `data: ${JSON.stringify({ type: 'text-delta', delta: JSON.stringify(report) })}\n\n`,
      });
    });
    await page.route('http://127.0.0.1:41802/', (route) => route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html><body>
        <algolia-chat app-id="test-app" search-api-key="test-key" index-name="test-index" theme="algolia">
          <algolia-agent role="primary" agent-id="primary-agent" label="Assistant"></algolia-agent>
          <algolia-chat-confidence agents='${JSON.stringify(Object.entries(judgeAgents).map(([id, role]) => ({ id, role })))}'></algolia-chat-confidence>
        </algolia-chat>
      </body></html>`,
    }));
    await page.goto('http://127.0.0.1:41802/');
    await page.addScriptTag({ path: bundlePath });
    await page.waitForFunction(() => document.querySelector('algolia-chat')?.shadowRoot);
    await page.evaluate(() => document.querySelector('algolia-chat').ask('What happens when one judge is unavailable?'));
    await page.waitForFunction(() => {
      const badge = document.querySelector('algolia-chat')?.shadowRoot?.querySelector('algolia-confidence-badge');
      return badge?.verdict?.borderline === true && badge?.verdict?.perJudge?.length === 2;
    }, null, { timeout: 10000 });

    const verdict = await page.evaluate(() => {
      const badge = document.querySelector('algolia-chat')?.shadowRoot?.querySelector('algolia-confidence-badge');
      return badge?.verdict;
    });
    assert.deepEqual(Object.fromEntries(requestsByRole), {
      skeptic: 2,
      referee: 1,
      advocate: 1,
    });
    assert.equal(verdict.error, undefined);
    assert.equal(verdict.borderline, true);
    assert.deepEqual(verdict.perJudge.map(({ role }) => role).sort(), ['advocate', 'referee']);
  } finally {
    await browser.close();
  }
});
