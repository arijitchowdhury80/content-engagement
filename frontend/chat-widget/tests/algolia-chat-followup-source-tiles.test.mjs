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
const answer = `# Quick take
One request is manageable; unbounded request volume is where cost gets noisy.

## The mechanism
Use the controls that match the traffic source:

- Debounce ordinary typing.
- Rate-limit abusive clients.`;

let browser;

before(async () => {
  browser = await chromium.launch({ headless: true });
});

after(async () => {
  await browser?.close();
});

test('final answer preserves previously retrieved sources when completion omits hits', () => {
  const bundle = fs.readFileSync(chatPath, 'utf8');
  const finalizerStart = bundle.indexOf('async function iR(');
  const finalizerEnd = bundle.indexOf('async function aR(', finalizerStart);
  const finalizer = bundle.slice(finalizerStart, finalizerEnd);

  assert.notEqual(finalizerStart, -1, 'orchestrator finalizer must exist');
  assert.match(
    finalizer,
    /turnsRef\.current\.find\([^)]*\)\?\.segments\[0\]/,
    'finalization must read the current streaming segment before committing the final answer'
  );
  assert.match(
    finalizer,
    /[A-Za-z_$][\w$]*\.hits\?\.length\?[A-Za-z_$][\w$]*\.hits:[A-Za-z_$][\w$]*\?\.rawHits\?\?\[\]/,
    'finalization must keep progress-time raw hits when the terminal payload has no hits'
  );
  assert.match(
    finalizer,
    /[A-Za-z_$][\w$]*\.length\?[A-Za-z_$][\w$]*:[A-Za-z_$][\w$]*\?\.sources\?\?\[\]/,
    'finalization must keep progress-time source pills when the terminal payload has no sources'
  );
});

test('assistant answer rendering uses one normalized presentation contract', () => {
  const bundle = fs.readFileSync(chatPath, 'utf8');

  assert.match(
    bundle,
    /function __arrieNormalizeAnswerPresentation\(\{segment:[A-Za-z_$][\w$]*,allowLayer:[A-Za-z_$][\w$]*,offerPending:/,
    'the assistant renderer must normalize answer text, TLDR layer, footer state, and follow-up state once'
  );
  assert.match(
    bundle,
    /function __arrieLayeredAnswer\(\{text:[A-Za-z_$][\w$]*,layer:[A-Za-z_$][\w$]*,unsupportedTerms:/,
    'the layered answer renderer must accept the already-normalized TLDR layer instead of recomputing it'
  );
  assert.doesNotMatch(
    bundle,
    /C&&!![A-Za-z_$][\w$]*\.text&&!!__arrieAnswerLayer\([A-Za-z_$][\w$]*\.text\)/,
    'the message renderer must not independently recompute TLDR eligibility for its label'
  );
  assert.doesNotMatch(
    bundle,
    /useAnswerLayer:C===0/,
    'TLDR rendering must not be gated to only the first conversation turn'
  );
  assert.match(
    bundle,
    /__arrieLayeredAnswer,\{text:[A-Za-z_$][\w$]*\.text,layer:[A-Za-z_$][\w$]*,unsupportedTerms:/,
    'the answer body must render from the same normalized layer used by the label'
  );
  assert.match(
    bundle,
    /window\.algoliaAnswerContributors\?\.createAnswerContentContribution/,
    'answer harness mirror content must use the canonical exposed content contributor'
  );
  assert.match(
    bundle,
    /__arrieCanonicalAnswerLayer\([A-Za-z_$][\w$]*\.text\)\?\?__arrieAnswerLayer\([A-Za-z_$][\w$]*\.text\)/,
    'the visible TLDR/details layer must prefer the Algolia-owned normalizer when the parity runtime is loaded'
  );
  assert.doesNotMatch(
    bundle,
    /function __arrieHarnessContentContribution[\s\S]*?__arrieAnswerLayer[\s\S]*?function __arrieHarnessSourcesContribution/,
    'answer harness mirror content must not reuse the live renderer TLDR parser'
  );
});

test('subsequent turns send the complete prior assistant answer', async () => {
  const longAnswer = [
    '# Complete answer',
    '',
    'This deliberately long answer verifies that conversation continuity keeps every material detail.',
    ...Array.from(
      { length: 16 },
      (_, index) => `Detail ${index + 1}: preserve this exact sentence for the next conversational turn.`,
    ),
    '',
    '[Grounding source](https://www.algolia.com/doc/)',
  ].join('\n');
  const page = await createWidgetPage({ frames: completionFrames(longAnswer, []) });
  try {
    await waitForAnswerText(page, 'Detail 16');
    await page.waitForFunction(() => {
      const state = JSON.parse(sessionStorage.getItem('algolia-chat:conversation') ?? 'null');
      const widget = document.querySelector('algolia-chat');
      return state?.turns?.[0]?.segments?.[0]?.status === 'success' &&
        widget?.shadowRoot?.querySelector('textarea')?.disabled === false;
    });
    const composer = page.locator('algolia-chat textarea');
    await composer.fill('How does that affect the next step?');
    await composer.press('Enter');
    await page.waitForFunction(() => window.__completionRequests.length === 2);

    const request = await page.evaluate(() => window.__completionRequests[1]);
    const priorAssistant = request.messages.find((message) => message.role === 'assistant');
    assert.ok(priorAssistant, JSON.stringify(request));
    assert.equal(priorAssistant.parts[0].text, longAnswer);
  } finally {
    await page.close();
  }
});

function completionFrames(content = answer, suggestions = [followUp]) {
  const frames = [
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
  if (suggestions.length > 0) {
    frames.push({ type: 'data-suggestions', data: { suggestions } });
  }
  return frames;
}

async function createWidgetPage({
  frames = completionFrames(),
  streamError = null,
  legacyDiscoveryAttribute = false,
} = {}) {
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
  await page.evaluate(async ({ setLegacyDiscoveryAttribute }) => {
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
    if (setLegacyDiscoveryAttribute) widget.setAttribute('discovery-enabled', 'true');
    const agent = document.createElement('algolia-agent');
    agent.setAttribute('role', 'primary');
    agent.setAttribute('agent-id', 'test-agent');
    agent.setAttribute('label', 'Assistant');
    widget.append(agent);
    search.append(widget);
    document.body.append(search);
    await new Promise((resolve) => setTimeout(resolve, 100));
    widget.ask('How should I configure rate limiting?');
  }, { setLegacyDiscoveryAttribute: legacyDiscoveryAttribute });

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
Start with frontend debounce, then protect shared backends with server-side throttling.`;
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
      const sourcesLabel = root.querySelector('.acs-source-section .acs-answer-section-label');
      const sourcesLabelStyle = sourcesLabel ? getComputedStyle(sourcesLabel) : null;
      const analogy = root.querySelector('.acs-answer-analogy');
      const short = root.querySelector('.acs-answer-short');
      const analogyStyle = analogy ? getComputedStyle(analogy) : null;
      const shortStyle = short ? getComputedStyle(short) : null;
      return {
        labelText: label?.textContent.trim(),
        labelWeight: labelStyle?.fontWeight,
        labelTransform: labelStyle?.textTransform,
        labelLetterSpacing: labelStyle?.letterSpacing,
        detailsLabelWeight: detailsLabelStyle?.fontWeight,
        detailsLabelText: detailsLabel?.textContent.trim(),
        detailsLabelTransform: detailsLabelStyle?.textTransform,
        detailsLabelLetterSpacing: detailsLabelStyle?.letterSpacing,
        sourcesLabelText: sourcesLabel?.textContent.trim(),
        sourcesLabelWeight: sourcesLabelStyle?.fontWeight,
        sourcesLabelTransform: sourcesLabelStyle?.textTransform,
        sourcesLabelLetterSpacing: sourcesLabelStyle?.letterSpacing,
        detailsTopPadding: getComputedStyle(details).paddingTop,
        hasAnalogyTreatmentHook: Boolean(root.querySelector('.acs-answer-analogy')),
        analogyText: analogy?.textContent.replace(/\s+/g, ' ').trim(),
        analogyFontStyle: analogyStyle?.fontStyle,
        shortText: short?.textContent.replace(/\s+/g, ' ').trim(),
        shortFontStyle: shortStyle?.fontStyle,
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
    assert.equal(result.detailsLabelText, 'Details');
    assert.equal(result.sourcesLabelText, 'Sources');
    assert.ok(Number(result.labelWeight) >= 700 || result.labelWeight === 'bold');
    assert.ok(Number(result.detailsLabelWeight) >= 700 || result.detailsLabelWeight === 'bold');
    assert.ok(Number(result.sourcesLabelWeight) >= 700 || result.sourcesLabelWeight === 'bold');
    assert.equal(result.labelTransform, 'uppercase');
    assert.equal(result.detailsLabelTransform, 'uppercase');
    assert.equal(result.sourcesLabelTransform, 'uppercase');
    assert.equal(result.labelLetterSpacing, result.detailsLabelLetterSpacing);
    assert.equal(result.detailsLabelLetterSpacing, result.sourcesLabelLetterSpacing);
    assert.equal(result.detailsTopPadding, '20px');
    assert.equal(result.hasAnalogyTreatmentHook, true);
    assert.match(result.analogyText, /little door swings/);
    assert.equal(result.analogyFontStyle, 'italic');
    assert.match(result.shortText, /Short version: yes/);
    assert.notEqual(result.shortFontStyle, 'italic');
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

test('TLDR treatment applies to each layerable primary answer in a conversation', async () => {
  const layeredAnswer = `Implementation planning is like setting a table before the guests arrive: the plates matter, but the sequence matters more.

Short version: start with the smallest working search path, then harden the data and events around it.

## Details
Use one integration path first, validate relevance, then expand the controls.`;
  const page = await createWidgetPage({ frames: completionFrames(layeredAnswer) });
  try {
    await waitForAnswerText(page, 'Short version: start with the smallest working search path');
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
        detailsText: root.querySelector('.acs-answer-details')?.textContent.replace(/\s+/g, ' ').trim(),
        detailsBodyHeadings: [...root.querySelectorAll('.acs-answer-details h1, .acs-answer-details h2, .acs-answer-details h3')]
          .map((node) => node.textContent.trim()),
        turnCount: JSON.parse(sessionStorage.getItem('algolia-chat:conversation')).turns.length,
      };
    });

    assert.equal(result.turnCount, 2);
    assert.equal(result.tldrTiles, 2);
    assert.equal(result.answerLayers, 2);
    assert.equal(result.detailsLabels, 2);
    assert.deepEqual(result.detailsBodyHeadings, []);
    assert.equal(result.tldrLabels, 2);
    assert.equal(result.assistantLabels, 0);
  } finally {
    await page.close();
  }
});

test('analogy canvas and unlabeled direct read stay together in TLDR', async () => {
  const text = `Comparing one grocery success story to another is a bit like comparing two high-performing kitchens—the menu might be different, but the secret is always in how they manage the chaos of the pantry to get the right dish to the table instantly.

If you liked the H-E-B México approach, you want to look at how other grocery teams handle the digital aisle.

- Albertsons: They are using Algolia for agentic shopping experiences.
- Industry-Wide Trends: Grocery teams are using AI to handle repeat purchase flows.

My recommendation: look for similar frictions, not just similar stories.`;
  const page = await createWidgetPage({ frames: completionFrames(text) });
  try {
    await waitForAnswerText(page, 'high-performing kitchens');
    const result = await page.evaluate(() => {
      const root = document.querySelector('algolia-chat').shadowRoot;
      const labels = [...root.querySelectorAll('.acs-answer-section-label')]
        .map((node) => node.textContent.trim())
        .filter(Boolean);
      const tldr = root.querySelector('.acs-answer-tldr');
      const analogy = root.querySelector('.acs-answer-analogy');
      const short = root.querySelector('.acs-answer-short');
      const details = root.querySelector('.acs-answer-details');
      return {
        labels,
        tldrText: tldr?.textContent.replace(/\s+/g, ' ').trim(),
        analogyText: analogy?.textContent.replace(/\s+/g, ' ').trim(),
        shortText: short?.textContent.replace(/\s+/g, ' ').trim(),
        hasShortBlock: Boolean(short),
        detailsText: details?.textContent.replace(/\s+/g, ' ').trim(),
        tldrCount: root.querySelectorAll('.acs-answer-tldr').length,
        detailsCount: root.querySelectorAll('.acs-answer-details').length,
      };
    });

    assert.equal(result.tldrCount, 1);
    assert.equal(result.detailsCount, 1);
    assert.ok(result.labels.includes('TL;DR'));
    assert.ok(result.labels.includes('Details'));
    assert.match(result.analogyText, /high-performing kitchens/);
    assert.match(result.tldrText, /high-performing kitchens/);
    assert.equal(result.hasShortBlock, true);
    assert.match(result.shortText, /If you liked the H-E-B/);
    assert.match(result.tldrText, /If you liked the H-E-B/);
    assert.doesNotMatch(result.tldrText, /Albertsons/);
    assert.match(result.detailsText, /Albertsons/);
    assert.match(result.detailsText, /My recommendation/);
  } finally {
    await page.close();
  }
});

test('short conversational preface before analogy does not block TLDR rendering', async () => {
  const text = `I can certainly help you map those out. Since we don't have your specific business goals yet, we'll keep this high-level—but as we refine your use case, these metrics will shift from "general ideas" to "hard targets."

Measuring search is a bit like checking the health of a retail store: you don't just count how many people walked in the door; you look at how many found what they wanted, how quickly they found it, and if they actually bought it.

Depending on what you're trying to solve, I'd recommend focusing on these three categories:

1. Conversion & Revenue (The Bottom Line)
These tell you if your search is actually driving business value.

- Search Conversion Rate: The percentage of users who search and then complete a purchase.
- Average Order Value from Search: Whether users who use search spend more per order than those who just browse.

My Recommendation
Start with the Zero-Result Rate and the Search Conversion Rate.`;
  const page = await createWidgetPage({ frames: completionFrames(text) });
  try {
    await waitForAnswerText(page, 'Measuring search is a bit like checking the health');
    const result = await page.evaluate(() => {
      const root = document.querySelector('algolia-chat').shadowRoot;
      const tldr = root.querySelector('.acs-answer-tldr');
      const analogy = root.querySelector('.acs-answer-analogy');
      const short = root.querySelector('.acs-answer-short');
      const details = root.querySelector('.acs-answer-details');
      return {
        labels: [...root.querySelectorAll('.acs-answer-section-label')]
          .map((node) => node.textContent.trim()),
        tldrText: tldr?.textContent.replace(/\s+/g, ' ').trim(),
        analogyText: analogy?.textContent.replace(/\s+/g, ' ').trim(),
        analogyFontStyle: analogy ? getComputedStyle(analogy).fontStyle : null,
        hasShort: Boolean(short),
        detailsText: details?.textContent.replace(/\s+/g, ' ').trim(),
      };
    });

    assert.ok(result.labels.includes('TL;DR'));
    assert.ok(result.labels.includes('Details'));
    assert.match(result.analogyText, /retail store/);
    assert.equal(result.analogyFontStyle, 'italic');
    assert.equal(result.hasShort, false);
    assert.match(result.tldrText, /retail store/);
    assert.doesNotMatch(result.tldrText, /specific business goals/);
    assert.doesNotMatch(result.tldrText, /Conversion & Revenue/);
    assert.match(result.detailsText, /Conversion & Revenue/);
    assert.match(result.detailsText, /Search Conversion Rate/);
  } finally {
    await page.close();
  }
});

test('one-paragraph answer does not force a broken TLDR split', async () => {
  const text = 'A single direct answer should stay flat when there is no separate short-version block.';
  const page = await createWidgetPage({ frames: completionFrames(text) });
  try {
    await waitForAnswerText(page, 'single direct answer');
    const result = await page.evaluate(() => {
      const root = document.querySelector('algolia-chat').shadowRoot;
      return {
        tldrTiles: root.querySelectorAll('.acs-answer-tldr').length,
        answerLayers: root.querySelectorAll('.acs-answer-layer').length,
        detailsLabels: root.querySelectorAll('.acs-answer-details-label').length,
        tldrLabels: [...root.querySelectorAll('.acs-answer-section-label')]
          .filter((node) => node.textContent.trim() === 'TL;DR').length,
        answerText: root.textContent.replace(/\s+/g, ' ').trim(),
      };
    });

    assert.equal(result.tldrTiles, 0);
    assert.equal(result.answerLayers, 0);
    assert.equal(result.detailsLabels, 0);
    assert.equal(result.tldrLabels, 0);
    assert.match(result.answerText, /single direct answer/);
  } finally {
    await page.close();
  }
});

test('heading-first answer stays flat instead of forcing the heading into TLDR', async () => {
  const text = `## Practical answer
Use rate limits where traffic concentrates, then debounce normal typing.`;
  const page = await createWidgetPage({ frames: completionFrames(text) });
  try {
    await waitForAnswerText(page, 'Practical answer');
    const result = await page.evaluate(() => {
      const root = document.querySelector('algolia-chat').shadowRoot;
      return {
        tldrTiles: root.querySelectorAll('.acs-answer-tldr').length,
        headingText: [...root.querySelectorAll('p, h1, h2, h3')]
          .map((node) => node.textContent.trim())
          .find((value) => value === 'Practical answer'),
      };
    });

    assert.equal(result.tldrTiles, 0);
    assert.equal(result.headingText, 'Practical answer');
  } finally {
    await page.close();
  }
});

test('the client mechanically projects the server-authored trailing question into one follow-up tile', async () => {
  const inlineQuestion =
    'Are you protecting against bot traffic, or trying to keep normal browsing costs predictable?';
  const text = `API calls are like little door swings at a busy store: one customer entering is harmless, but eager widgets can turn that door into a blur.

Short version: yes, almost every interaction that requests data from an Algolia index counts as a billable search request.

## The mechanism
Use debounce for normal typing and rate limits for abusive clients.

${inlineQuestion}`;
  const page = await createWidgetPage({ frames: completionFrames(text, []) });
  try {
    await waitForAnswerText(page, 'Short version: yes');
    const result = await page.evaluate((question) => {
      const root = document.querySelector('algolia-chat').shadowRoot;
      const tldr = root.querySelector('.acs-answer-tldr');
      const details = root.querySelector('.acs-answer-details');
      const followWrap = root.querySelector('.acs-followup-wrap');
      return {
        questionInTldr: Boolean(tldr?.textContent.includes(question)),
        questionInDetails: Boolean(details?.textContent.includes(question)),
        questionInFollowUp: Boolean(followWrap?.textContent.includes(question)),
        followUpCount: root.querySelectorAll('.acs-followup-card').length,
      };
    }, inlineQuestion);

    assert.equal(result.questionInTldr, false);
    assert.equal(result.questionInDetails, false);
    assert.equal(result.questionInFollowUp, true);
    assert.equal(result.followUpCount, 1);
  } finally {
    await page.close();
  }
});

test('the client does not invent a discovery card when the server returns no trailing question', async () => {
  const text = `API calls are like little door swings at a busy store.

Short version: debounce ordinary typing and rate-limit abusive clients.

## The mechanism
Monitor request volume and tune both controls using observed traffic.`;
  const page = await createWidgetPage({ frames: completionFrames(text, []) });
  try {
    await waitForAnswerText(page, 'Short version: debounce');
    const result = await page.evaluate(() => {
      const root = document.querySelector('algolia-chat').shadowRoot;
      return {
        answerText: root.textContent ?? '',
        followUpCount: root.querySelectorAll('.acs-followup-card').length,
      };
    });

    assert.match(result.answerText, /Monitor request volume/);
    assert.equal(result.followUpCount, 0);
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

test('answer markdown renders links nested inside bold list labels', async () => {
  const markdownAnswer = `API calls are like a busy store counter: the queue is manageable until every tiny interaction starts asking for service.

Short version: no-code controls can steer common merchandising changes without turning every edit into an engineering ticket.

## The No-Code Toolkit
Marketing and merchandising teams can control the search experience directly through the Algolia Dashboard:

- **[Visual Editor](https://support.algolia.com/hc/en-us/articles/4406981935761-What-can-I-do-with-the-Visual-Editor-in-the-dashboard)**: This is a code-free interface where you can see exactly what a user sees.
- **[Rules](https://academy.algolia.com/training/0191df92-53dd-7cde-a467-d27ef407d9ef)**: You can set up custom behaviors based on specific queries.
- **Merchandising Studio**: A dedicated workspace for digital merchandisers.`;
  const page = await createWidgetPage({ frames: completionFrames(markdownAnswer) });
  try {
    await waitForAnswerText(page, 'The No-Code Toolkit');
    const result = await page.evaluate(() => {
      const root = document.querySelector('algolia-chat').shadowRoot;
      const details = root.querySelector('.acs-answer-details');
      return {
        rawMarkdownVisible: details?.textContent.includes('[Visual Editor](') ||
          details?.textContent.includes('[Rules]('),
        links: [...details.querySelectorAll('li a')].map((anchor) => ({
          text: anchor.textContent.trim(),
          href: anchor.getAttribute('href'),
          insideStrong: anchor.closest('strong') !== null,
        })),
        strongLabels: [...details.querySelectorAll('li strong')]
          .map((node) => node.textContent.trim()),
      };
    });

    assert.equal(result.rawMarkdownVisible, false);
    assert.deepEqual(result.links, [
      {
        text: 'Visual Editor',
        href: 'https://support.algolia.com/hc/en-us/articles/4406981935761-What-can-I-do-with-the-Visual-Editor-in-the-dashboard',
        insideStrong: true,
      },
      {
        text: 'Rules',
        href: 'https://academy.algolia.com/training/0191df92-53dd-7cde-a467-d27ef407d9ef',
        insideStrong: true,
      },
    ]);
    assert.deepEqual(result.strongLabels, ['Visual Editor', 'Rules', 'Merchandising Studio']);
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

test('client discovery remains disabled even when a legacy host attribute is present', async () => {
  const page = await createWidgetPage({ legacyDiscoveryAttribute: true });
  try {
    await page.waitForFunction(() => {
      const raw = sessionStorage.getItem('algolia-chat:conversation');
      const conversation = raw ? JSON.parse(raw) : null;
      return window.__completionRequests.length === 1 &&
        conversation?.turns?.[0]?.segments?.[0]?.status === 'success';
    }, null, { timeout: 8_000 });
    const request = await page.evaluate(() => window.__completionRequests[0]);
    const userPart = request.messages[0].parts.find((part) => part.type === 'text');
    const turnContext = request.messages[0].metadata?.turnContext ?? {};

    assert.equal(userPart.text, 'How should I configure rate limiting?');
    for (const key of [
      'discovery.turn',
      'discovery.confirmed',
      'discovery.inferred',
      'discovery.unknown',
      'discovery.suppressed',
      'discovery.last_probe',
    ]) {
      assert.equal(turnContext[key], undefined, `client ledger key must be absent: ${key}`);
    }
    assert.doesNotMatch(JSON.stringify(request), /DISCOVERY CONTROL/);
    assert.doesNotMatch(JSON.stringify(request), /DISCOVERY_STATE/);
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
        followUpCount: root.querySelectorAll('.acs-followup-card').length,
      };
    }, partial);

    assert.equal(result.partialVisible, true);
    assert.ok(result.requestCount >= 1, 'the public completion boundary should have been exercised');
    assert.equal(result.followUpCount, 0, 'the browser must not invent discovery after a partial stream');
  } finally {
    await page.close();
  }
});
