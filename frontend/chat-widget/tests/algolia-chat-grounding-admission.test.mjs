import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const chatDir = join(root, 'frontend', 'chat-widget');
const siteDir = join(root, 'local-sites', 'algolia-com-parity');
const fixturePath = join(siteDir, 'index.html');
let browser;

function fixture() {
  return `<!doctype html><html><head><meta charset="utf-8"><script>
    const params = new URLSearchParams(location.search);
    const scenario = params.get('scenario');
    window.__agentRequests = [];
    window.__judgeRequests = [];
    const candidates = {
      pass: 'This guidance matches the retrieved material.',
      judgeGate: 'The Enterprise plan guarantees 99.99% annual conversion growth.',
      deterministicGate: 'The API guarantees 999 requests per millisecond.',
      unavailable: 'InstantSearch guarantees automatic conversion growth for every implementation.'
    };
    const stream = (frames) => {
      const encoder = new TextEncoder();
      return new Response(new ReadableStream({ start(controller) {
        for (const frame of frames) controller.enqueue(encoder.encode('data: ' + JSON.stringify(frame) + '\\n\\n'));
        controller.close();
      }}), { status: 200, headers: { 'content-type': 'text/event-stream' } });
    };
    window.fetch = async (input, init = {}) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes('/api/judge')) {
        window.__judgeRequests.push(JSON.parse(init.body));
        if (scenario === 'unavailable') return new Response('offline', { status: 503 });
        const gateTripped = scenario === 'judgeGate';
        return new Response(JSON.stringify({ panels: [{
          panelId: 'primary', dims: { grounding: gateTripped ? 2 : 9, coverage: 9, depth: 8, relevance: 9 },
          synthesizedScore: gateTripped ? 3 : 9, composite: gateTripped ? 3 : 8.8,
          preGateScore: 8.8, gateTripped, borderline: false,
          flaggedClaims: gateTripped ? [{ claim: '99.99% annual conversion growth', reason: 'unsupported', certainty: 1 }] : [],
          perJudge: [], rationale: gateTripped ? 'material unsupported claim' : 'grounded'
        }] }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url.includes('/agent-studio/1/agents/local_primary_agent/')) {
        window.__agentRequests.push(JSON.parse(init.body));
        const answer = candidates[scenario];
        return stream([
          { type: 'tool-output-available', toolCallId: 'docs', output: { hits: [{
            objectID: 'docs-hit', title: 'InstantSearch React documentation',
            url: 'https://www.algolia.com/doc/guides/building-search-ui/what-is-instantsearch/react/',
            source: 'Documentation', description: 'InstantSearch is available for React implementations.'
          }, {
            objectID: 'customer-hit', title: 'Customer implementation story',
            url: 'https://www.algolia.com/customers/example/', source: 'Customer Stories',
            description: 'A customer implementation story without quantified conversion guarantees.'
          }] } },
          { type: 'text-delta', delta: answer }
        ]);
      }
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    };
  </script><script src="/chat/algolia-chat.js"></script></head><body>
    <algolia-chat app-id="0EXRPAXB56" search-api-key="local" index-name="local" discovery-enabled="true">
      <algolia-agent role="primary" agent-id="local_primary_agent" label="aRRIe"></algolia-agent>
      <algolia-chat-confidence mode="hosted" url="/judge"></algolia-chat-confidence>
    </algolia-chat>
  </body></html>`;
}

before(async () => {
  browser = await chromium.launch({ headless: true });
});

after(async () => {
  await browser?.close();
});

function localPath(urlPath) {
  const path = urlPath.split('?')[0].split('#')[0];
  if (path.startsWith('/chat/')) return join(chatDir, path.replace('/chat/', ''));
  if (path === '/' || !extname(path)) return fixturePath;
  return join(siteDir, path.replace(/^\//, ''));
}

function startServer() {
  const server = createServer(async (request, response) => {
    try {
      if ((request.url || '').startsWith('/admission-fixture')) {
        response.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' });
        response.end(fixture());
        return;
      }
      const target = normalize(localPath(request.url || '/'));
      const body = await readFile(target);
      response.writeHead(200, {
        'content-type': extname(target) === '.js' ? 'application/javascript' : 'text/html',
        'cache-control': 'no-store',
      });
      response.end(body);
    } catch (error) {
      response.writeHead(404, { 'content-type': 'text/plain' });
      response.end(String(error));
    }
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    resolve({ server, baseUrl: `http://127.0.0.1:${server.address().port}` });
  }));
}

async function openScenario(scenario) {
  const { server, baseUrl } = await startServer();
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${baseUrl}/admission-fixture?scenario=${scenario}&algoliaChatDebug=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => customElements.get('algolia-chat'));
  await page.evaluate(() => document.querySelector('algolia-chat').ask('Verify the requested implementation specifics.'));
  await page.waitForFunction(() => {
    const root = document.querySelector('algolia-chat')?.shadowRoot;
    return root?.querySelectorAll('.acs-followup-card').length === 1 &&
      JSON.parse(sessionStorage.getItem('algolia-chat:conversation')).turns[0].segments[0].status === 'success';
  });
  await page.waitForFunction(() => {
    const badge = document.querySelector('algolia-chat')?.shadowRoot?.querySelector('algolia-confidence-badge');
    return Boolean(badge?.verdict);
  });
  return { context, page, server };
}

async function runtimeState(page) {
  return page.evaluate(() => {
    const root = document.querySelector('algolia-chat').shadowRoot;
    const persisted = JSON.parse(sessionStorage.getItem('algolia-chat:conversation'));
    const streamingTexts = (window.__algoliaChatJudgeDebugLog || [])
      .filter((entry) => entry.label === 'segment state update' && entry.data.nextStatus === 'streaming')
      .map((entry) => entry.data.next?.text || '');
    const badge = root.querySelector('algolia-confidence-badge');
    return {
      text: root.textContent,
      persisted,
      segment: persisted.turns[0].segments[0],
      streamingTexts,
      agentRequestCount: window.__agentRequests.length,
      judgeRequestCount: window.__judgeRequests.length,
      badgeVerdict: badge?.verdict || null,
      discoveryCount: root.querySelectorAll('.acs-followup-card').length,
    };
  });
}

async function closeScenario({ context, server }) {
  await context.close();
  await new Promise((resolve) => server.close(resolve));
}

test('streams and persists the original answer while confidence runs separately', async () => {
  const run = await openScenario('pass');
  try {
    const result = await runtimeState(run.page);
    assert.match(result.text, /This guidance matches the retrieved material/);
    assert.match(JSON.stringify(result.persisted), /This guidance matches the retrieved material/);
    assert.equal(result.streamingTexts.some((text) => text.includes('This guidance matches')), true);
    assert.equal(result.agentRequestCount, 1);
    assert.equal(result.judgeRequestCount, 1);
    assert.equal(typeof result.badgeVerdict.gateTripped, 'boolean');
    assert.equal(result.segment.admissionVerdict, undefined);
    assert.equal(result.discoveryCount, 1);
  } finally {
    await closeScenario(run);
  }
});

test('a judge gate never hides, replaces, or regenerates the streamed answer', async () => {
  const run = await openScenario('judgeGate');
  try {
    const first = await runtimeState(run.page);
    assert.match(first.text, /99\.99% annual conversion growth/);
    assert.equal(first.streamingTexts.some((text) => text.includes('99.99% annual conversion growth')), true);
    assert.equal(first.discoveryCount, 1);
    assert.deepEqual(first.segment.rawHits.map((hit) => hit.source), ['Documentation', 'Customer Stories']);
    assert.equal(first.segment.sources.length, 2);
    assert.match(first.segment.text, /99\.99% annual conversion growth/);
    assert.equal(first.segment.admissionRewritten, undefined);
    assert.equal(first.segment.admissionVerdict, undefined);
    assert.equal(first.agentRequestCount, 1);
    assert.equal(first.judgeRequestCount, 1);
    assert.equal(first.badgeVerdict.gateTripped, true);

    await run.page.evaluate(() => {
      document.querySelector('algolia-chat').shadowRoot.querySelector('.acs-followup-card').click();
    });
    await run.page.waitForFunction(() => window.__agentRequests.length === 2);
    const followUpRequest = await run.page.evaluate(() => JSON.stringify(window.__agentRequests[1]));
    assert.match(followUpRequest, /99\.99% annual conversion growth/);
  } finally {
    await closeScenario(run);
  }
});

test('deterministic confidence checks never become a second completion', async () => {
  const run = await openScenario('deterministicGate');
  try {
    const result = await runtimeState(run.page);
    assert.match(result.text, /999 requests per millisecond/);
    assert.equal(result.streamingTexts.some((text) => text.includes('999 requests per millisecond')), true);
    assert.equal(result.segment.admissionRewritten, undefined);
    assert.equal(result.agentRequestCount, 1);
    assert.equal(result.judgeRequestCount, 1);
  } finally {
    await closeScenario(run);
  }
});

test('judge unavailability cannot blank or replace a completed answer', async () => {
  const run = await openScenario('unavailable');
  try {
    const result = await runtimeState(run.page);
    assert.match(result.text, /automatic conversion growth/);
    assert.match(JSON.stringify(result.persisted), /automatic conversion growth/);
    assert.equal(result.streamingTexts.some((text) => text.includes('automatic conversion growth')), true);
    assert.equal(result.segment.admissionRejected, undefined);
    assert.equal(result.segment.admissionRewriteAttempted, undefined);
    assert.ok(result.badgeVerdict.error);
    assert.equal(result.agentRequestCount, 1);
    assert.equal(result.judgeRequestCount, 1);
    assert.equal(result.discoveryCount, 1);
  } finally {
    await closeScenario(run);
  }
});
