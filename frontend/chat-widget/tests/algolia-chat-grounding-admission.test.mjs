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
const rejectionText = 'The retrieved material does not verify the specific details requested';
let browser;

function fixture() {
  return `<!doctype html><html><head><meta charset="utf-8"><script>
    const params = new URLSearchParams(location.search);
    const scenario = params.get('scenario');
    window.__agentRequests = [];
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
        const answer = window.__agentRequests.length === 1 ? candidates[scenario] : 'The retrieved documentation supports this follow-up answer.';
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
  await page.goto(`${baseUrl}/admission-fixture?scenario=${scenario}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => customElements.get('algolia-chat'));
  await page.evaluate(() => document.querySelector('algolia-chat').ask('Verify the requested implementation specifics.'));
  await page.waitForFunction(() => {
    const root = document.querySelector('algolia-chat')?.shadowRoot;
    return root?.querySelectorAll('.acs-followup-card').length === 1 &&
      JSON.parse(sessionStorage.getItem('algolia-chat:conversation')).turns[0].segments[0].status === 'success';
  });
  return { context, page, server };
}

async function closeScenario({ context, server }) {
  await context.close();
  await new Promise((resolve) => server.close(resolve));
}

test('gate false admits the candidate answer', async () => {
  const run = await openScenario('pass');
  try {
    const result = await run.page.evaluate(() => {
      const root = document.querySelector('algolia-chat').shadowRoot;
      const persisted = sessionStorage.getItem('algolia-chat:conversation');
      return { text: root.textContent, persisted, discoveryCount: root.querySelectorAll('.acs-followup-card').length };
    });
    assert.match(result.text, /This guidance matches the retrieved material/);
    assert.doesNotMatch(result.text, new RegExp(rejectionText));
    assert.match(result.persisted, /This guidance matches the retrieved material/);
    assert.equal(result.discoveryCount, 1);
  } finally {
    await closeScenario(run);
  }
});

test('material judge gate rejects text, preserves sources, and excludes rejected transcript history', async () => {
  const run = await openScenario('judgeGate');
  try {
    const first = await run.page.evaluate(() => {
      const root = document.querySelector('algolia-chat').shadowRoot;
      const persisted = JSON.parse(sessionStorage.getItem('algolia-chat:conversation'));
      return {
        text: root.textContent,
        discoveryCount: root.querySelectorAll('.acs-followup-card').length,
        segment: persisted.turns[0].segments[0],
        serialized: JSON.stringify(persisted),
      };
    });
    assert.match(first.text, new RegExp(rejectionText));
    assert.doesNotMatch(first.text, /99\.99% annual conversion growth/);
    assert.equal(first.discoveryCount, 1);
    assert.deepEqual(first.segment.rawHits.map((hit) => hit.source), ['Documentation', 'Customer Stories']);
    assert.equal(first.segment.sources.length, 2);
    assert.doesNotMatch(first.serialized, /99\.99% annual conversion growth/);

    await run.page.evaluate(() => {
      document.querySelector('algolia-chat').shadowRoot.querySelector('.acs-followup-card').click();
    });
    await run.page.waitForFunction(() => window.__agentRequests.length === 2);
    const followUpRequest = await run.page.evaluate(() => JSON.stringify(window.__agentRequests[1]));
    assert.doesNotMatch(followUpRequest, /99\.99% annual conversion growth/);
    assert.match(followUpRequest, new RegExp(rejectionText));
  } finally {
    await closeScenario(run);
  }
});

test('deterministic unsupported-term gate overrides a passing judge', async () => {
  const run = await openScenario('deterministicGate');
  try {
    const text = await run.page.evaluate(() => document.querySelector('algolia-chat').shadowRoot.textContent);
    assert.match(text, new RegExp(rejectionText));
    assert.doesNotMatch(text, /999 requests per millisecond/);
  } finally {
    await closeScenario(run);
  }
});

test('judge unavailability fails closed for claim-bearing text', async () => {
  const run = await openScenario('unavailable');
  try {
    const result = await run.page.evaluate(() => {
      const root = document.querySelector('algolia-chat').shadowRoot;
      return {
        text: root.textContent,
        persisted: sessionStorage.getItem('algolia-chat:conversation'),
        discoveryCount: root.querySelectorAll('.acs-followup-card').length,
      };
    });
    assert.match(result.text, new RegExp(rejectionText));
    assert.doesNotMatch(result.persisted, /automatic conversion growth/);
    assert.equal(result.discoveryCount, 1);
  } finally {
    await closeScenario(run);
  }
});
