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
  await page.evaluate(() => {
    sessionStorage.clear();
    localStorage.clear();
  });
  await page.evaluate(
    ({ responseFrames, errorMessage }) => {
      window.__completionRequests = [];
      window.fetch = async (input, init = {}) => {
        const url = String(input instanceof Request ? input.url : input);
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

async function waitForAnswerText(page, text) {
  await page.waitForFunction(
    (expectedText) => {
      const root = document.querySelector('algolia-chat')?.shadowRoot;
      const persisted = JSON.parse(sessionStorage.getItem('algolia-chat:conversation') ?? 'null');
      const segment = persisted?.turns?.[0]?.segments?.[0];
      return segment?.status === 'success' && root?.textContent?.includes(expectedText);
    },
    text,
    { timeout: 8_000 }
  );
}

async function waitForTurnCount(page, expectedCount) {
  await page.waitForFunction(
    (count) => {
      const persisted = JSON.parse(sessionStorage.getItem('algolia-chat:conversation') ?? 'null');
      return persisted?.turns?.length === count &&
        persisted.turns.every((turn) => turn.segments?.[0]?.status === 'success');
    },
    expectedCount,
    { timeout: 8_000 }
  );
}

test('analogy canvas and consultant read render as a TLDR tile before flat details', async () => {
  const modelInlineFollowUp =
    'Are you planning for a specific amount of monthly search traffic or record volume?';
  const layeredAnswer = `API calls are like little door swings at a busy store: one customer entering is harmless, but autocomplete, filters, page loads, bots, and eager widgets can turn that door into a blur.

Short version: yes, almost every interaction that requests data from an Algolia index counts as a billable search request.

## The mechanism
Use the controls that match the traffic source:

- Debounce ordinary typing.
- Rate-limit abusive clients.

## Recommendation
Start with frontend debounce, then protect shared backends with server-side throttling.

${modelInlineFollowUp}
${discoveryMarker}`;
  const page = await createWidgetPage({ frames: completionFrames(layeredAnswer) });
  try {
    await waitForAnswerText(page, 'Short version: yes');
    const result = await page.evaluate(({ question, inlineQuestion }) => {
      const root = document.querySelector('algolia-chat').shadowRoot;
      const tldr = root.querySelector('.acs-answer-tldr');
      const tldrBlocks = [...(tldr?.firstElementChild?.children ?? [])]
        .map((node) => node.textContent.replace(/\s+/g, ' ').trim())
        .filter(Boolean);
      const details = root.querySelector('.acs-answer-details');
      const sources = root.querySelector('.acs-source-section');
      const followWrap = root.querySelector('.acs-followup-wrap');
      const label = [...root.querySelectorAll('span')]
        .find((node) => node.textContent.trim() === 'TL;DR');
      const labelStyle = label ? getComputedStyle(label) : null;
      const detailsLabel = root.querySelector('.acs-answer-details-label');
      const detailsLabelStyle = detailsLabel ? getComputedStyle(detailsLabel) : null;
      return {
        labelText: label?.textContent.trim(),
        labelWeight: labelStyle?.fontWeight,
        detailsLabelWeight: detailsLabelStyle?.fontWeight,
        detailsTopPadding: getComputedStyle(details).paddingTop,
        hasAnalogyTreatmentHook: Boolean(root.querySelector('.acs-answer-analogy')),
        tldrBlocks,
        tldrText: tldr?.textContent.replace(/\s+/g, ' ').trim(),
        detailsText: details?.textContent.replace(/\s+/g, ' ').trim(),
        questionInTldr: tldr?.textContent.includes(question),
        questionInDetails: details?.textContent.includes(question),
        inlineQuestionInTldr: tldr?.textContent.includes(inlineQuestion),
        inlineQuestionInDetails: details?.textContent.includes(inlineQuestion),
        followQuestion: followWrap?.textContent.includes(question),
        inlineQuestionInFollowUp: followWrap?.textContent.includes(inlineQuestion),
        detailsAfterTldr: Boolean(tldr.compareDocumentPosition(details) & Node.DOCUMENT_POSITION_FOLLOWING),
        sourcesAfterDetails: Boolean(details.compareDocumentPosition(sources) & Node.DOCUMENT_POSITION_FOLLOWING),
        followAfterSources: Boolean(sources.compareDocumentPosition(followWrap) & Node.DOCUMENT_POSITION_FOLLOWING),
        tldrBackground: getComputedStyle(tldr).backgroundImage,
        tldrShadow: getComputedStyle(tldr).boxShadow,
      };
    }, { question: followUp, inlineQuestion: modelInlineFollowUp });

    assert.equal(result.labelText, 'TL;DR');
    assert.ok(Number(result.labelWeight) >= 700 || result.labelWeight === 'bold');
    assert.ok(Number(result.detailsLabelWeight) >= 700 || result.detailsLabelWeight === 'bold');
    assert.equal(result.detailsTopPadding, '20px');
    assert.equal(result.hasAnalogyTreatmentHook, false);
    assert.match(result.tldrBlocks[0], /little door swings/);
    assert.match(result.tldrBlocks[1], /Short version: yes/);
    assert.match(result.tldrText, /little door swings/);
    assert.match(result.tldrText, /Short version: yes/);
    assert.doesNotMatch(result.tldrText, /The mechanism/);
    assert.match(result.detailsText, /Details\s*The mechanism/);
    assert.match(result.detailsText, /Recommendation/);
    assert.equal(result.questionInTldr, false);
    assert.equal(result.questionInDetails, false);
    assert.equal(result.inlineQuestionInTldr, false);
    assert.equal(result.inlineQuestionInDetails, false);
    assert.equal(result.followQuestion, true);
    assert.equal(result.inlineQuestionInFollowUp, false);
    assert.equal(result.detailsAfterTldr, true);
    assert.equal(result.sourcesAfterDetails, true);
    assert.equal(result.followAfterSources, true);
    assert.match(result.tldrBackground, /linear-gradient/);
    assert.notEqual(result.tldrShadow, 'none');
  } finally {
    await page.close();
  }
});

test('TLDR treatment is limited to the first primary answer in a conversation', async () => {
  const page = await createWidgetPage();
  try {
    await waitForAnswer(page);
    const composer = page.locator('algolia-chat').locator('textarea');
    await composer.waitFor({ state: 'visible' });
    await page.waitForFunction(() => {
      const root = document.querySelector('algolia-chat')?.shadowRoot;
      return root?.querySelector('textarea')?.disabled === false;
    });
    await composer.fill('What about the next implementation step?');
    await composer.press('Enter');
    await waitForTurnCount(page, 2);

    const result = await page.evaluate(() => {
      const root = document.querySelector('algolia-chat').shadowRoot;
      const labels = [...root.querySelectorAll('span')]
        .map((node) => node.textContent.trim())
        .filter(Boolean);
      return {
        tldrTiles: root.querySelectorAll('.acs-answer-tldr').length,
        answerLayers: root.querySelectorAll('.acs-answer-layer').length,
        detailsLabels: root.querySelectorAll('.acs-answer-details-label').length,
        tldrLabels: labels.filter((label) => label === 'TL;DR').length,
        assistantLabels: labels.filter((label) => label === 'Assistant').length,
        turnCount: JSON.parse(sessionStorage.getItem('algolia-chat:conversation')).turns.length,
      };
    });

    assert.equal(result.turnCount, 2);
    assert.equal(result.tldrTiles, 1);
    assert.equal(result.answerLayers, 1);
    assert.equal(result.detailsLabels, 1);
    assert.equal(result.tldrLabels, 1);
    assert.equal(result.assistantLabels, 0);
  } finally {
    await page.close();
  }
});

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
        markdownClasses: markdown?.className ?? null,
        quickTakeClasses: quickTake?.className ?? null,
        mechanismClasses: mechanism?.className ?? null,
        listClasses: list?.className ?? null,
        visibleBlocks: textBlocks.map((node) => node.textContent.trim()).slice(0, 12),
      };
    });

    assert.ok(result.markdownClasses, `missing markdown block: ${JSON.stringify(result.visibleBlocks)}`);
    assert.ok(result.quickTakeClasses, `missing Quick take block: ${JSON.stringify(result.visibleBlocks)}`);
    assert.ok(result.mechanismClasses, `missing The mechanism block: ${JSON.stringify(result.visibleBlocks)}`);
    assert.ok(result.listClasses, `missing list block: ${JSON.stringify(result.visibleBlocks)}`);
    assert.match(result.markdownClasses, /\bgap-3\b/);
    assert.match(result.quickTakeClasses, /\bmt-1\b/);
    assert.match(result.mechanismClasses, /\bmt-[15]\b/);
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

test('completion request keeps discovery state out of the visitor message', async () => {
  const page = await createWidgetPage();
  try {
    await waitForAnswer(page);
    const request = await page.evaluate(() => window.__completionRequests[0]);
    const userPart = request.messages[0].parts.find((part) => part.type === 'text');
    const turnContext = request.messages[0].metadata.turnContext;

    assert.equal(userPart.text, 'How should I configure rate limiting?');
    assert.equal(turnContext['discovery.turn'], '1');
    assert.match(turnContext['discovery.unknown'], /intent/);
    assert.doesNotMatch(JSON.stringify(request), /DISCOVERY CONTROL/);
    assert.doesNotMatch(JSON.stringify(request), /never quote this block/);
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
