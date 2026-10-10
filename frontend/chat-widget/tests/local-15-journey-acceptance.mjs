import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = path.dirname(fileURLToPath(import.meta.url));
const widgetRoot = path.resolve(here, '..');
const bundlePath = path.join(widgetRoot, 'dist', 'content-engagement.js');
const sampleFixturePath = path.join(here, 'fixtures', 'approved-sample-questions-slot-20260826.html');

function approvedQuestions() {
  const fixture = fs.readFileSync(sampleFixturePath, 'utf8');
  return [...fixture.matchAll(/<li>([\s\S]*?)<\/li>/g)]
    .map((match) => match[1].replace(/\s+/g, ' ').trim());
}

const APPROVED = approvedQuestions();
const ADDITIONAL = [
  'Which traffic source should we size first?',
  'Which integration boundary should we validate first?',
  'Which synonym maintenance burden matters most?',
  'Which out-of-stock business outcome should we prioritize?',
  'Which merchandising objective should we prioritize?',
];
const JOURNEYS = [...APPROVED, ...ADDITIONAL];

function safeName(index, question) {
  const stem = question.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 52);
  return `${String(index + 1).padStart(2, '0')}-${stem}`;
}

function judgeReport(input, role) {
  const passageId = input.evidencePacket?.passageIndex?.[0]?.evidencePassageId;
  return {
    dimensionScores: { grounding: 8, completeness: 8, depth: 8, relevance: 8 },
    dimensionRationales: {
      grounding: 'The answer is supported by the supplied passage.',
      completeness: 'The answer covers the question.',
      depth: 'The answer gives useful detail.',
      relevance: 'The answer remains relevant.',
    },
    sentenceAssessments: input.answerManifest.map((unit) => ({
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
}

function answerFrames(journey, turn) {
  const sourceId = `journey-${journey + 1}-turn-${turn}`;
  const topic = turn === 1 ? 'implementation choice' : 'discovery priority';
  return [
    {
      type: 'tool-output-available',
      toolCallId: `search-${sourceId}`,
      output: { hits: [{
        objectID: sourceId,
        title: `Approved evidence ${journey + 1}.${turn}`,
        url: `https://www.algolia.com/doc/${sourceId}`,
        source: 'Documentation',
        text: `Grounded evidence for journey ${journey + 1}, turn ${turn}.`,
      }] },
    },
    {
      type: 'text-delta',
      delta: `This decision is like choosing the right lane before accelerating.\n\nShort version: validate the ${topic} with evidence before expanding scope.\n\n## Details\nUse the smallest measurable configuration, verify the result, and then iterate.`,
    },
    {
      type: 'data-suggestions',
      data: { suggestions: [turn === 1
        ? `Which ${topic} should journey ${journey + 1} validate first?`
        : `What should journey ${journey + 1} validate next?`] },
    },
  ];
}

async function installRoutes(page, journey, counters) {
  const judgeAgents = {
    'acceptance-judge-skeptic': 'skeptic',
    'acceptance-judge-referee': 'referee',
    'acceptance-judge-advocate': 'advocate',
  };
  const sampleFixture = fs.readFileSync(sampleFixturePath, 'utf8');

  await page.route('http://127.0.0.1:41801/bundle.js', (route) => route.fulfill({
    status: 200,
    contentType: 'application/javascript',
    body: fs.readFileSync(bundlePath),
  }));
  await page.route('**/*.algolia.net/**', async (route) => {
    const request = route.request();
    if (!request.url().includes('/agent-studio/1/agents/')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"results":[{"hits":[]}]}' });
      return;
    }
    const roleEntry = Object.entries(judgeAgents).find(([agentId]) => request.url().includes(`/${agentId}/`));
    if (roleEntry) {
      const [, role] = roleEntry;
      const body = JSON.parse(request.postData() || '{}');
      const query = body.messages?.findLast?.((message) => message.role === 'user')
        ?.parts?.find((part) => part.type === 'text')?.text;
      const report = judgeReport(JSON.parse(query || '{}'), role);
      counters.judges.push(role);
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: `data: ${JSON.stringify({ type: 'text-delta', delta: JSON.stringify(report) })}\n\n`,
      });
      return;
    }
    counters.primary += 1;
    const frames = answerFrames(journey, counters.primary);
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Expose-Headers': 'X-Conversation-Id',
        'X-Conversation-Id': `acceptance-${journey + 1}`,
      },
      body: frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join(''),
    });
  });
  await page.route('http://127.0.0.1:41801/sites/algolia-assets/home.algoliaTokenTelemetry.do', (route) => {
    counters.telemetry += 1;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        inputTokens: 10000 + (counters.telemetry * 1000),
        outputTokens: 500 + (counters.telemetry * 100),
        totalTokens: 10500 + (counters.telemetry * 1100),
      }),
    });
  });
  await page.route('http://127.0.0.1:41801/__compare/production', (route) => route.fulfill({
    status: 200,
    contentType: 'text/event-stream',
    body: `data: ${JSON.stringify({ type: 'text-delta', delta: `Production comparison ${journey + 1}.` })}\n\n`,
  }));
  await page.route('http://127.0.0.1:41801/', (route) => route.fulfill({
    contentType: 'text/html',
    body: `<!doctype html><html><head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width,initial-scale=1">
      <script>window.ACS_COMPARE={prod:{proxyPath:'/__compare/production'}};</script>
      <script src="/bundle.js"></script>
      </head><body><algolia-chat app-id="test-app" search-api-key="test-key" index-name="test-index"
        theme="algolia" product-title="Algolia Assistant" show-welcome="true">
        <div slot="welcome"><p>Hello, how can I help you today?</p></div>
        ${sampleFixture}
        <algolia-agent role="primary" agent-id="acceptance-primary" label="Assistant"></algolia-agent>
        <algolia-chat-confidence agents='${JSON.stringify(Object.entries(judgeAgents).map(([id, role]) => ({ id, role })))}'></algolia-chat-confidence>
      </algolia-chat></body></html>`,
  }));
}

async function inspectLatest(page, expectedTurns) {
  return page.evaluate((turns) => {
    const root = document.querySelector('algolia-chat').shadowRoot;
    const bodies = [...root.querySelectorAll('[data-algolia-rendered-answer-body]')];
    const latestBody = bodies.at(-1);
    const footers = [...root.querySelectorAll('[data-algolia-answer-footer]')];
    const latestFooter = footers.at(-1);
    const controls = latestFooter?.querySelector('[data-algolia-rendered-answer-footer]');
    const confidence = latestFooter?.querySelector('algolia-confidence-badge');
    const source = latestFooter?.querySelector('[data-algolia-rendered-answer-sources]');
    const rect = (node) => node ? node.getBoundingClientRect() : null;
    return {
      userTurns: root.querySelectorAll('[part="message-user-bubble"]').length,
      bodies: bodies.length,
      sources: root.querySelectorAll('[data-algolia-rendered-answer-sources]').length,
      followUps: root.querySelectorAll('[data-algolia-rendered-answer-follow-up]').length,
      confidenceBadges: root.querySelectorAll('algolia-confidence-badge').length,
      analogyItalic: getComputedStyle(latestBody.querySelector('.acs-answer-analogy')).fontStyle === 'italic',
      shortItalic: getComputedStyle(latestBody.querySelector('.acs-answer-short')).fontStyle,
      details: latestBody.querySelector('[part="answer-details"]')?.textContent?.trim() || '',
      telemetry: latestFooter?.querySelector('.algolia-usage-pill')?.textContent?.replace(/\s+/g, ' ').trim() || '',
      compare: latestFooter?.querySelector('#acs-compare-toggle')?.textContent?.trim() || '',
      confidence: confidence?.shadowRoot?.textContent?.replace(/\s+/g, ' ').trim() || '',
      footerWrap: latestFooter ? getComputedStyle(latestFooter).flexWrap : '',
      controlsRect: rect(controls),
      confidenceRect: rect(confidence),
      sourceRect: rect(source),
      footerBorder: latestFooter ? getComputedStyle(latestFooter).borderTopStyle : '',
      sourceBorder: source?.querySelector('.acs-source-section')
        ? getComputedStyle(source.querySelector('.acs-source-section')).borderTopStyle
        : '',
      expectedTurns: turns,
    };
  }, expectedTurns);
}

async function run() {
  assert.equal(APPROVED.length, 10, 'The checked-in approved sample fixture must contain exactly 10 questions.');
  assert.equal(new Set(JOURNEYS).size, 15, 'Acceptance requires 15 distinct initial queries.');
  assert.ok(fs.existsSync(bundlePath), 'Build frontend/chat-widget before running journey acceptance.');

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const evidenceDir = path.resolve(widgetRoot, '..', '..', 'docs', 'evidence', `local-15-journeys-${stamp}`);
  fs.mkdirSync(evidenceDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const results = [];
  try {
    for (let index = 0; index < JOURNEYS.length; index += 1) {
      const question = JOURNEYS[index];
      const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
      const errors = [];
      const counters = { primary: 0, telemetry: 0, judges: [] };
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
      await installRoutes(page, index, counters);
      await page.goto('http://127.0.0.1:41801/', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => document.querySelector('algolia-chat')?.shadowRoot);
      const menuQuestions = await page.evaluate(() => {
        const host = document.querySelector('algolia-chat');
        return [...host.querySelectorAll('[slot="sample-questions"] li')].map((node) => node.textContent.replace(/\s+/g, ' ').trim());
      });
      assert.deepEqual(menuQuestions, APPROVED, `Journey ${index + 1} changed the approved sample set.`);
      await page.evaluate(() => document.querySelector('algolia-chat').open());
      await page.waitForFunction(() => [...document.querySelector('algolia-chat').shadowRoot.querySelectorAll('button')]
        .some((button) => /Sample questions/i.test(button.textContent || '')));
      const sampleToggleText = await page.evaluate(() => [...document.querySelector('algolia-chat').shadowRoot.querySelectorAll('button')]
        .find((button) => /Sample questions/i.test(button.textContent || ''))?.textContent?.replace(/\s+/g, ' ').trim() || '');
      assert.match(sampleToggleText, /^✦\s*Sample questions\s*[⌃⌄]$/, `Journey ${index + 1}: ${sampleToggleText}`);

      await page.evaluate((query) => {
        const widget = document.querySelector('algolia-chat');
        widget.ask(query);
      }, question);
      await page.waitForFunction(() => {
        const root = document.querySelector('algolia-chat')?.shadowRoot;
        const badge = [...(root?.querySelectorAll('algolia-confidence-badge') || [])].at(-1);
        return root?.querySelectorAll('[data-algolia-rendered-answer-body]').length === 1 &&
          root?.querySelectorAll('[data-algolia-rendered-answer-sources]').length === 1 &&
          badge?.shadowRoot?.textContent?.includes('8.0');
      }, null, { timeout: 10000 });
      const stem = safeName(index, question);
      await page.screenshot({ path: path.join(evidenceDir, `${stem}-01-answer.png`), fullPage: true });
      const first = await inspectLatest(page, 1);
      assert.equal(first.analogyItalic, true, JSON.stringify(first));
      assert.notEqual(first.shortItalic, 'italic', JSON.stringify(first));
      assert.match(first.details, /Details/i, JSON.stringify(first));
      assert.doesNotMatch(first.telemetry, /unavailable/i, JSON.stringify(first));
      assert.equal(first.compare, 'Compare with Prod', JSON.stringify(first));
      assert.match(first.confidence, /8\.0/, JSON.stringify(first));
      assert.equal(first.footerWrap, 'nowrap', JSON.stringify(first));
      assert.equal(first.footerBorder, 'solid', JSON.stringify(first));
      assert.equal(first.sourceBorder, 'none', JSON.stringify(first));

      await page.screenshot({ path: path.join(evidenceDir, `${stem}-02-discovery.png`), fullPage: true });
      await page.evaluate(() => document.querySelector('algolia-chat').shadowRoot
        .querySelectorAll('[data-algolia-rendered-answer-follow-up] button')[0].click());
      await page.waitForFunction(() => {
        const root = document.querySelector('algolia-chat')?.shadowRoot;
        const badges = [...(root?.querySelectorAll('algolia-confidence-badge') || [])];
        return root?.querySelectorAll('[data-algolia-rendered-answer-body]').length === 2 &&
          root?.querySelectorAll('[data-algolia-rendered-answer-sources]').length === 2 &&
          badges.length === 2 && badges.every((badge) => badge.shadowRoot?.textContent?.includes('8.0'));
      }, null, { timeout: 10000 });
      const second = await inspectLatest(page, 2);
      assert.deepEqual(
        { userTurns: second.userTurns, bodies: second.bodies, sources: second.sources, followUps: second.followUps, confidenceBadges: second.confidenceBadges },
        { userTurns: 2, bodies: 2, sources: 2, followUps: 2, confidenceBadges: 2 },
        JSON.stringify(second),
      );
      assert.doesNotMatch(second.telemetry, /unavailable/i, JSON.stringify(second));
      assert.equal(second.compare, 'Compare with Prod', JSON.stringify(second));
      assert.equal(second.footerWrap, 'nowrap', JSON.stringify(second));
      assert.equal(counters.primary, 2);
      assert.equal(counters.judges.length, 6);
      await page.screenshot({ path: path.join(evidenceDir, `${stem}-03-follow-up.png`), fullPage: true });

      await page.evaluate(() => document.querySelector('algolia-chat').shadowRoot
        .querySelectorAll('#acs-compare-toggle')[1].click());
      await page.waitForFunction((journeyNumber) =>
        document.querySelector('algolia-chat')?.shadowRoot?.textContent?.includes(`Production comparison ${journeyNumber}.`),
      index + 1, { timeout: 10000 });
      const compareLayout = await page.evaluate(() => {
        const root = document.querySelector('algolia-chat').shadowRoot;
        const split = root.querySelector('#acs-compare-panel').getBoundingClientRect();
        const latestFooter = [...root.querySelectorAll('[data-algolia-answer-footer]')].at(-1);
        const controls = [
          latestFooter.querySelector('.algolia-usage-pill'),
          latestFooter.querySelector('#acs-compare-toggle'),
          latestFooter.querySelector('algolia-confidence-badge'),
        ].map((node) => {
          const rect = node.getBoundingClientRect();
          return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
        });
        return { splitLeft: split.left, controls };
      });
      assert.ok(compareLayout.controls.every((rect) => rect.right <= compareLayout.splitLeft + 1), JSON.stringify(compareLayout));
      await page.screenshot({ path: path.join(evidenceDir, `${stem}-04-compare.png`), fullPage: true });
      assert.deepEqual(errors, [], `Journey ${index + 1}: ${JSON.stringify(errors)}`);
      results.push({ index: index + 1, question, first, second, screenshots: 4, status: 'passed' });
      await page.close();
    }
  } finally {
    await browser.close();
  }
  const report = { createdAt: new Date().toISOString(), bundlePath, journeys: results, passed: results.length, screenshots: results.length * 4 };
  fs.writeFileSync(path.join(evidenceDir, 'acceptance-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`15-journey acceptance passed; evidence: ${evidenceDir}\n`);
}

await run();
