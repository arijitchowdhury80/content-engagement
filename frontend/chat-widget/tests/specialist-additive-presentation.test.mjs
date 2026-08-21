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

function specialistFixture() {
  return `<!doctype html>
<html><head><meta charset="utf-8">
<script>
  window.__specialistPresentationCalls = [];
  const specialistMode = new URLSearchParams(location.search).get('mode') || 'unsourced';
  const stream = (frames) => {
    const encoder = new TextEncoder();
    return new Response(new ReadableStream({
      start(controller) {
        for (const frame of frames) controller.enqueue(encoder.encode('data: ' + JSON.stringify(frame) + '\\n\\n'));
        controller.close();
      }
    }), { status: 200, headers: { 'content-type': 'text/event-stream' } });
  };
  window.fetch = async (input, init = {}) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes('/agent-studio/1/agents/local_orchestrator_agent/')) {
      window.__specialistPresentationCalls.push('orchestrator');
      return stream([
        { type: 'tool-output-available', toolCallId: 'primary-search', output: { hits: [{
          objectID: 'primary-proof', title: 'Grounded primary evidence',
          url: 'https://www.algolia.com/customers/example/', source: 'Customer Stories',
          description: 'A directly relevant primary source.'
        }] } },
        { type: 'text-delta', delta: 'The grounded primary answer remains the answer the visitor asked for.' },
        { type: 'tool-input-available', toolCallId: 'specialist-offer', toolName: 'ask_specialist', input: {
          specialist_key: 'evidence', question: 'Pressure-test this claim with customer evidence.'
        } }
      ]);
    }
    if (url.includes('/agent-studio/1/agents/local_evidence_agent/')) {
      window.__specialistPresentationCalls.push('specialist');
      return specialistMode !== 'unsourced' ? stream([
        { type: 'tool-output-available', toolCallId: 'specialist-search', output: { hits: [{
          objectID: 'specialist-proof', title: 'Additional specialist evidence',
          url: 'https://www.algolia.com/customers/specialist-example/', source: 'Customer Stories',
          description: 'Additional sourced specialist depth.'
        }] } },
        { type: 'text-delta', delta: specialistMode === 'rejected'
          ? 'The specialist guarantees 99.99% conversion growth.'
          : 'The specialist adds a distinct, sourced comparison.\\n\\nWhich business claim should we pressure-test next?' }
      ]) : stream([
        { type: 'text-delta', delta: 'I could not find matching customer evidence for that exact claim.' }
      ]);
    }
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  };
</script>
<script src="/chat/algolia-chat.js"></script></head><body>
<algolia-chat app-id="0EXRPAXB56" search-api-key="local" index-name="local" discovery-enabled="true">
  <algolia-agent role="primary" agent-id="local_orchestrator_agent" label="aRRIe">
    <algolia-agent role="specialist" key="evidence" agent-id="local_evidence_agent" label="Customer Evidence Specialist"></algolia-agent>
  </algolia-agent>
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
      if ((request.url || '').startsWith('/specialist-fixture')) {
        response.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' });
        response.end(specialistFixture());
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
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${address.port}` });
    });
  });
}

async function openSpecialistFlow({ specialistMode, acceptSpecialist = true }) {
  const { server, baseUrl } = await startServer();
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${baseUrl}/specialist-fixture?mode=${specialistMode}`, {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForFunction(() => customElements.get('algolia-chat'));

  await page.evaluate(() =>
    document
      .querySelector('algolia-chat')
      .ask('Bring in the Evidence Specialist to pressure-test this customer claim.')
  );
  await page.getByRole('button', { name: 'Yes, go deeper' }).waitFor();
  if (acceptSpecialist) await page.getByRole('button', { name: 'Yes, go deeper' }).click();
  return { context, page, server };
}

test('zero-source specialist refusal preserves the grounded primary answer', async () => {
  const { context, page, server } = await openSpecialistFlow({ specialistMode: 'unsourced' });
  try {
    await page.waitForFunction(() => {
      const root = document.querySelector('algolia-chat')?.shadowRoot;
      return root?.querySelector('.acs-specialist-limitation') &&
        root.querySelectorAll('.acs-followup-card').length === 1;
    });

    const result = await page.evaluate(() => {
      const root = document.querySelector('algolia-chat').shadowRoot;
      const limitation = root.querySelector('.acs-specialist-limitation');
      const sourceSections = root.querySelectorAll('.acs-source-section');
      return {
        primaryVisible: root.textContent.includes(
          'The grounded primary answer remains the answer the visitor asked for.'
        ),
        primarySourceVisible: root.textContent.includes('Grounded primary evidence'),
        limitationVisible: limitation?.textContent.includes(
          'I could not find matching customer evidence for that exact claim.'
        ),
        sourceSectionCount: sourceSections.length,
        limitationCount: root.querySelectorAll('.acs-specialist-limitation').length,
        discoveryCount: root.querySelectorAll('.acs-followup-card').length,
        order: limitation?.compareDocumentPosition(root.querySelector('.acs-followup-wrap')) ?? 0,
        calls: window.__specialistPresentationCalls,
        shadowText: root.textContent.replace(/\s+/g, ' ').trim(),
      };
    });

    assert.equal(result.primaryVisible, true, JSON.stringify(result));
    assert.equal(result.primarySourceVisible, true);
    assert.equal(result.sourceSectionCount, 1, 'the primary source set must remain authoritative');
    assert.equal(result.limitationVisible, true);
    assert.equal(result.limitationCount, 1);
    assert.equal(result.discoveryCount, 1);
    assert.ok(result.order & 4, 'the discovery question must follow the limitation note');
    assert.deepEqual(result.calls, ['orchestrator', 'specialist']);
  } finally {
    await context.close();
    server.close();
  }
});

test('sourced specialist depth remains an additive answer segment', async () => {
  const { context, page, server } = await openSpecialistFlow({ specialistMode: 'sourced' });
  try {
    await page.waitForFunction(() => {
      const root = document.querySelector('algolia-chat')?.shadowRoot;
      return root?.textContent.includes('The specialist adds a distinct, sourced comparison.') &&
        root.querySelectorAll('.acs-followup-card').length === 1;
    });

    const result = await page.evaluate(() => {
      const root = document.querySelector('algolia-chat').shadowRoot;
      const sourceSections = [...root.querySelectorAll('.acs-source-section')];
      return {
        primaryVisible: root.textContent.includes(
          'The grounded primary answer remains the answer the visitor asked for.'
        ),
        primarySourceVisible: root.textContent.includes('Grounded primary evidence'),
        specialistVisible: root.textContent.includes(
          'The specialist adds a distinct, sourced comparison.'
        ),
        specialistSourceSectionVisible: sourceSections[1]?.textContent.includes('Customer Stories'),
        limitationCount: root.querySelectorAll('.acs-specialist-limitation').length,
        discoveryCount: root.querySelectorAll('.acs-followup-card').length,
        sourceSectionCount: sourceSections.length,
        shadowText: root.textContent.replace(/\s+/g, ' ').trim(),
      };
    });

    assert.equal(result.primaryVisible, true, JSON.stringify(result));
    assert.equal(result.primarySourceVisible, true);
    assert.equal(result.specialistVisible, true);
    assert.equal(result.specialistSourceSectionVisible, true, JSON.stringify(result));
    assert.equal(result.limitationCount, 0);
    assert.equal(result.discoveryCount, 1);
    assert.equal(result.sourceSectionCount, 2, 'primary and specialist sources should both render');
  } finally {
    await context.close();
    server.close();
  }
});

test('confidence evaluation cannot demote sourced specialist output', async () => {
  const { context, page, server } = await openSpecialistFlow({ specialistMode: 'rejected' });
  try {
    await page.waitForFunction(() => {
      const root = document.querySelector('algolia-chat')?.shadowRoot;
      return root?.textContent.includes('The specialist guarantees 99.99% conversion growth.') &&
        root.querySelectorAll('.acs-followup-card').length === 1;
    });

    const result = await page.evaluate(() => {
      const root = document.querySelector('algolia-chat').shadowRoot;
      return {
        text: root.textContent.replace(/\s+/g, ' ').trim(),
        sourceSectionCount: root.querySelectorAll('.acs-source-section').length,
        limitationCount: root.querySelectorAll('.acs-specialist-limitation').length,
        discoveryCount: root.querySelectorAll('.acs-followup-card').length,
        calls: window.__specialistPresentationCalls,
        persisted: sessionStorage.getItem('algolia-chat:conversation'),
      };
    });

    assert.match(result.text, /99\.99% conversion growth/, JSON.stringify(result));
    assert.match(result.persisted, /99\.99% conversion growth/);
    assert.equal(result.sourceSectionCount, 2, 'primary and specialist sources must both render');
    assert.equal(result.limitationCount, 0);
    assert.equal(result.discoveryCount, 1, JSON.stringify(result));
    assert.deepEqual(result.calls, ['orchestrator', 'specialist']);
  } finally {
    await context.close();
    server.close();
  }
});

test('pending specialist consent streams primary text but does not persist an incomplete turn', async () => {
  const { context, page, server } = await openSpecialistFlow({
    specialistMode: 'sourced',
    acceptSpecialist: false,
  });
  try {
    await page.waitForFunction(() => {
      const persisted = JSON.parse(sessionStorage.getItem('algolia-chat:conversation') || 'null');
      return persisted?.turns[0]?.deepDiveOffered &&
        persisted.turns[0].segments[0].status === 'streaming';
    });
    const beforeReload = await page.evaluate(() => {
      const root = document.querySelector('algolia-chat').shadowRoot;
      const persisted = JSON.parse(sessionStorage.getItem('algolia-chat:conversation'));
      return {
        visible: root.textContent.includes(
          'The grounded primary answer remains the answer the visitor asked for.'
        ),
        segment: persisted.turns[0].segments[0],
        serialized: JSON.stringify(persisted),
      };
    });

    assert.equal(beforeReload.visible, true, 'streaming text must paint while specialist consent is pending');
    assert.equal(beforeReload.segment.status, 'streaming');
    assert.equal(beforeReload.segment.text, '');
    assert.doesNotMatch(beforeReload.serialized, /grounded primary answer remains/);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => {
      const persisted = JSON.parse(sessionStorage.getItem('algolia-chat:conversation') || 'null');
      return customElements.get('algolia-chat') &&
        persisted?.turns[0]?.segments[0]?.status === 'error';
    });
    const afterReload = await page.evaluate(() => {
      const root = document.querySelector('algolia-chat').shadowRoot;
      return {
        visible: root.textContent.includes(
          'The grounded primary answer remains the answer the visitor asked for.'
        ),
        persisted: sessionStorage.getItem('algolia-chat:conversation'),
      };
    });

    assert.equal(afterReload.visible, false);
    assert.doesNotMatch(afterReload.persisted, /grounded primary answer remains/);
  } finally {
    await context.close();
    server.close();
  }
});
