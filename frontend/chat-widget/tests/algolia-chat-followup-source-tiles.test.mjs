import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const chatPath = process.env.ALGOLIA_CHAT_BUNDLE_UNDER_TEST
  ? pathToFileURL(process.env.ALGOLIA_CHAT_BUNDLE_UNDER_TEST)
  : new URL('../algolia-chat.js', import.meta.url);
const followUp =
  'Are you protecting against bot traffic, or trying to keep normal browsing costs predictable?';
const discoveryMarker = `<!--DISCOVERY_STATE {"probed_slot":"business_outcome","confirmed_slots":[],"inferred_slots":[],"suppressed_slots":[],"handoff_recommended":false,"handoff_specialist_key":null,"confidence":"medium","visible_followup_question":"${followUp}"} DISCOVERY_STATE-->`;
const answer = `# Quick take
One request is manageable; unbounded request volume is where cost gets noisy.

## The mechanism
Use the controls that match the traffic source:

- Debounce ordinary typing.
- Rate-limit abusive clients.

${followUp}
${discoveryMarker}`;

let browser;

before(async () => {
  browser = await chromium.launch({ headless: true });
});

after(async () => {
  await browser?.close();
});

function completionFrames(content = answer) {
  return [
    {
      type: 'tool-output-available',
      toolCallId: 'search-1',
      output: {
        hits: [
          {
            objectID: 'rate-limits',
            title: 'Rate limiting an API key',
            url: 'https://www.algolia.com/doc/guides/security/api-keys/in-depth/rate-limits/',
            source: 'Documentation',
            text: [
              'One request is manageable; unbounded request volume is where cost gets noisy.',
              'Use the controls that match the traffic source: debounce ordinary typing and rate-limit abusive clients.',
            ].join(' '),
            description: 'Configure API key rate limits for predictable traffic.',
          },
        ],
      },
    },
    { type: 'text-delta', delta: content },
  ];
}

async function createWidgetPage({ frames = completionFrames(), streamError = null } = {}) {
  const page = await browser.newPage();
  const browserErrors = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text());
  });
  page.browserErrors = browserErrors;
  await page.route('**/*', async (route) => {
    const request = route.request();
    if (request.isNavigationRequest()) {
      await route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<!doctype html><html><body></body></html>',
      });
      return;
    }
    if (/\.algolia\.(net|com)\//.test(request.url())) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          results: [
            {
              hits: [],
              nbHits: 0,
              page: 0,
              nbPages: 0,
              hitsPerPage: 0,
              processingTimeMS: 1,
              query: '',
            },
          ],
        }),
      });
      return;
    }
    await route.continue();
  });
  await page.goto('http://localhost/');
  await page.evaluate(
    ({ responseFrames, errorMessage }) => {
      window.__completionRequests = [];
      window.fetch = async (input, init = {}) => {
        const url = String(input instanceof Request ? input.url : input);
        if (url.includes('/api/judge')) {
          return new Response(JSON.stringify({
            panels: [{
              panelId: 'primary',
              dims: { grounding: 9, coverage: 9, depth: 8, relevance: 9 },
              synthesizedScore: 9,
              composite: 8.8,
              preGateScore: 8.8,
              gateTripped: false,
              borderline: false,
              flaggedClaims: [],
              perJudge: [],
              rationale: 'The answer is supported by the retrieved source.',
            }],
          }), { status: 200, headers: { 'content-type': 'application/json' } });
        }
        if (url.includes('/agent-studio/1/agents/') && url.includes('/completions')) {
          window.__completionRequests.push(JSON.parse(String(init.body ?? '{}')));
          const encoder = new TextEncoder();
          const stream = new ReadableStream({
            start(controller) {
              for (const frame of responseFrames) {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(frame)}\n\n`));
              }
              if (errorMessage) {
                setTimeout(() => controller.error(new Error(errorMessage)), 50);
              }
              else controller.close();
            },
          });
          return new Response(stream, {
            status: 200,
            headers: { 'content-type': 'text/event-stream' },
          });
        }

        return new Response(
          JSON.stringify({
            results: [
              {
                hits: [],
                nbHits: 0,
                page: 0,
                nbPages: 0,
                hitsPerPage: 0,
                processingTimeMS: 1,
                query: '',
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      };
    },
    { responseFrames: frames, errorMessage: streamError }
  );

  await page.addScriptTag({ content: fs.readFileSync(chatPath, 'utf8') });
  await page.evaluate(async () => {
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
    widget.setAttribute('discovery-enabled', 'true');
    const agent = document.createElement('algolia-agent');
    agent.setAttribute('role', 'primary');
    agent.setAttribute('agent-id', 'test-agent');
    agent.setAttribute('label', 'Assistant');
    widget.append(agent);
    search.append(widget);
    document.body.append(search);
    await new Promise((resolve) => setTimeout(resolve, 100));
    widget.ask('How should I configure rate limiting?');
  });

  return page;
}

async function waitForAnswer(page) {
  try {
    await page.waitForFunction(
      (question) => {
        const root = document.querySelector('algolia-chat')?.shadowRoot;
        const persisted = JSON.parse(sessionStorage.getItem('algolia-chat:conversation') ?? 'null');
        const segment = persisted?.turns?.[0]?.segments?.[0];
        const hasQuickTake = [...(root?.querySelectorAll('p') ?? [])]
          .some((node) => node.textContent.trim() === 'Quick take');
        return segment?.status === 'success' && !segment.admissionRejected && hasQuickTake &&
          root?.querySelector('.acs-source-section') &&
          root.querySelector('.acs-followup-wrap')?.textContent.includes(question);
      },
      followUp,
      { timeout: 8_000 }
    );
  } catch (error) {
    const state = await page.evaluate(() => {
      const widget = document.querySelector('algolia-chat');
      return {
        requests: window.__completionRequests,
        persistedConversation: sessionStorage.getItem('algolia-chat:conversation'),
        judgeDebugLog: window.__algoliaChatJudgeDebugLog,
        shadowText: widget?.shadowRoot?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 800),
        shadowHtml: widget?.shadowRoot?.innerHTML.slice(0, 800),
        shadowChildren: [...(widget?.shadowRoot?.children ?? [])].map((node) => ({
          tag: node.tagName,
          className: node.className,
          text: node.tagName === 'STYLE' ? '[style]' : node.textContent?.replace(/\s+/g, ' ').trim().slice(0, 300),
        })),
        searchHtml: document.querySelector('algolia-instant-search')?.outerHTML.slice(0, 800),
      };
    });
    state.browserErrors = page.browserErrors;
    throw new Error(`widget did not render the expected answer: ${JSON.stringify(state)}`, {
      cause: error,
    });
  }
}

test('follow-up renders after sources with separated source and discovery sections', async () => {
  const page = await createWidgetPage();
  try {
    await waitForAnswer(page);
    const result = await page.evaluate((question) => {
      const root = document.querySelector('algolia-chat').shadowRoot;
      const sources = root.querySelector('.acs-source-section');
      const followWrap = root.querySelector('.acs-followup-wrap');
      const followCard = root.querySelector('.acs-followup-card');
      const sourceStyle = getComputedStyle(sources);
      const followStyle = getComputedStyle(followWrap);
      const cardStyle = getComputedStyle(followCard);
      const answerWithoutFollowUp = followWrap.parentElement.cloneNode(true);
      answerWithoutFollowUp.querySelector('.acs-followup-wrap')?.remove();
      return {
        followsSources: Boolean(
          sources.compareDocumentPosition(followWrap) & Node.DOCUMENT_POSITION_FOLLOWING
        ),
        questionInAnswer: answerWithoutFollowUp.textContent.includes(question),
        sourceMargin: sourceStyle.marginTop,
        sourcePadding: sourceStyle.paddingTop,
        sourceBorder: sourceStyle.borderTopStyle,
        followMargin: followStyle.marginTop,
        followPadding: followStyle.paddingTop,
        followBorder: followStyle.borderTopStyle,
        cardBorder: cardStyle.borderTopStyle,
        cardBackground: cardStyle.backgroundImage,
        cardShadow: cardStyle.boxShadow,
        hasOldAdornment: Boolean(
          root.querySelector('.acs-followup-icon, [data-discovery-eyebrow]')
        ),
      };
    }, followUp);

    assert.equal(result.followsSources, true, 'follow-up should come after cited sources');
    assert.equal(result.questionInAnswer, false, 'discovery question should be extracted from the answer body');
    assert.equal(result.sourceMargin, '22px');
    assert.equal(result.sourcePadding, '18px');
    assert.notEqual(result.sourceBorder, 'none');
    assert.equal(result.followMargin, '24px');
    assert.equal(result.followPadding, '20px');
    assert.notEqual(result.followBorder, 'none');
    assert.equal(result.cardBorder, 'none');
    assert.match(result.cardBackground, /linear-gradient/);
    assert.notEqual(result.cardShadow, 'none');
    assert.equal(result.hasOldAdornment, false);
  } finally {
    await page.close();
  }
});

test('answer markdown preserves section and list spacing', async () => {
  const page = await createWidgetPage();
  try {
    await waitForAnswer(page);
    const result = await page.evaluate(() => {
      const root = document.querySelector('algolia-chat').shadowRoot;
      const textBlocks = [...root.querySelectorAll('p, h1, h2, h3')];
      const quickTake = textBlocks.find((node) => node.textContent.trim() === 'Quick take');
      const mechanism = textBlocks.find((node) => node.textContent.trim() === 'The mechanism');
      const list = root.querySelector('ul');
      const markdown = quickTake?.parentElement;
      return {
        markdownClasses: markdown.className,
        quickTakeClasses: quickTake.className,
        mechanismClasses: mechanism.className,
        listClasses: list.className,
      };
    });

    assert.match(result.markdownClasses, /\bgap-3\b/);
    assert.match(result.quickTakeClasses, /\bmt-1\b/);
    assert.match(result.mechanismClasses, /\bmt-5\b/);
    assert.match(result.listClasses, /\bspace-y-2\b/);
  } finally {
    await page.close();
  }
});

test('source group and source links use the shipped white-to-blue glass treatment', async () => {
  const page = await createWidgetPage();
  try {
    await waitForAnswer(page);
    await page.locator('algolia-chat').locator('.acs-source-group-pill').click();
    const result = await page.evaluate(() => {
      const root = document.querySelector('algolia-chat').shadowRoot;
      const group = root.querySelector('.acs-source-group-pill');
      const source = root.querySelector('.acs-source-pill');
      const groupStyle = getComputedStyle(group);
      const sourceStyle = getComputedStyle(source);
      return {
        groupBackground: groupStyle.backgroundImage,
        groupShadow: groupStyle.boxShadow,
        sourceBackground: sourceStyle.backgroundImage,
        sourceBlur: sourceStyle.backdropFilter || sourceStyle.webkitBackdropFilter,
        href: source.getAttribute('href'),
      };
    });

    assert.match(result.groupBackground, /linear-gradient/);
    assert.notEqual(result.groupShadow, 'none');
    assert.match(result.sourceBackground, /linear-gradient/);
    assert.match(result.sourceBlur, /blur\(14px\)/);
    assert.match(result.href, /^https:\/\/www\.algolia\.com\/doc\//);
  } finally {
    await page.close();
  }
});

test('completion request constrains discovery to the grounded exchange', async () => {
  const page = await createWidgetPage();
  try {
    await waitForAnswer(page);
    const requestText = await page.evaluate(() => JSON.stringify(window.__completionRequests));

    assert.match(
      requestText,
      /The follow-up must be anchored in the visitor's visible question and the answer you just gave/
    );
    assert.match(
      requestText,
      /Do not introduce broad audience, traffic, catalog, support-deflection, or buyer-intent forks unless the visitor or retrieved evidence already raised them/
    );
    assert.doesNotMatch(requestText, /diagnostic fork with 2-3 plausible paths/);
  } finally {
    await page.close();
  }
});

test('partial streamed answer remains visible when the response terminates', async () => {
  const partial = 'You are absolutely right: the useful answer starts with the traffic pattern.';
  const page = await createWidgetPage({
    frames: [{ type: 'text-delta', delta: partial }],
    streamError: 'terminated mid-stream',
  });
  try {
    await page.waitForFunction(
      (text) => document.querySelector('algolia-chat')?.shadowRoot?.textContent?.includes(text),
      partial,
      { timeout: 8_000 }
    );
    const result = await page.evaluate((text) => {
      const root = document.querySelector('algolia-chat').shadowRoot;
      return {
        partialVisible: root.textContent.includes(text),
        requestCount: window.__completionRequests.length,
      };
    }, partial);

    assert.equal(result.partialVisible, true);
    assert.ok(result.requestCount >= 1, 'the public completion boundary should have been exercised');
  } finally {
    await page.close();
  }
});
