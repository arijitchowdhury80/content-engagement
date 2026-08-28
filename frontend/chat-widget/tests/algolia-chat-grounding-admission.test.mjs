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
    if (scenario === 'stalledStream') {
      const nativeSetTimeout = window.setTimeout.bind(window);
      window.setTimeout = (callback, delay, ...args) => nativeSetTimeout(callback, delay === 60000 ? 50 : delay, ...args);
    }
    window.__agentRequests = [];
    window.__judgeRequests = [];
    window.__judgeValidations = [];
    window.__verdictEvents = [];
    const followUp = 'Are you shaping a quick proof of concept, or planning the architecture for a production implementation?';
    document.addEventListener('algolia-verdict', (event) => window.__verdictEvents.push(event.detail));
    const candidates = {
      pass: 'This guidance matches the retrieved material.',
      judgeGate: 'The Enterprise plan guarantees 99.99% annual conversion growth.',
      deterministicGate: 'The API guarantees 999 requests per millisecond.',
      metadataGrounded: 'A Forrester Total Economic Impact study showed a 213% ROI.',
      unavailable: 'InstantSearch guarantees automatic conversion growth for every implementation.',
      oneJudgeUnavailable: 'InstantSearch is available for React implementations.',
      twoJudgesUnavailable: 'InstantSearch is available for React implementations.',
      slowJudges: 'InstantSearch is available for React implementations.',
      partialTerminalError: 'This partial answer remains visible.',
      retryIdentity: 'The retried answer is now complete.',
      discoveryTurn: 'This is the grounded answer for the current discovery turn.',
      twoTurnRace: 'InstantSearch is available for React implementations.',
      retry429: 'The rate-limited request recovered safely.',
      manualRetry429: 'The manually retried rate-limited request recovered safely.',
      retry500: 'The server-error request recovered safely.'
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
      if (['local_skeptic', 'local_referee', 'local_advocate'].some((agentId) =>
        url.includes('/agent-studio/1/agents/' + agentId + '/'))) {
        window.__judgeRequests.push(JSON.parse(init.body));
        if (scenario === 'unavailable') throw new TypeError('Agent Studio unavailable');
        if (scenario === 'oneJudgeUnavailable' && url.includes('local_skeptic')) throw new TypeError('Skeptic unavailable');
        if (scenario === 'twoJudgesUnavailable' && !url.includes('local_advocate')) throw new TypeError('Two judges unavailable');
        if (scenario === 'slowJudges') await new Promise((resolve) => setTimeout(resolve, 1_000));
        const gateTripped = scenario === 'judgeGate';
        const request = window.__judgeRequests.at(-1);
        const queryText = request.messages.flatMap((message) => message.parts || [])
          .find((part) => part.type === 'text')?.text || '{}';
        const judgeInput = JSON.parse(queryText);
        if (scenario === 'twoTurnRace' && judgeInput.question.includes('requested implementation')) {
          await new Promise((resolve) => setTimeout(resolve, 800));
        }
        const evidencePassageId = judgeInput.evidencePacket.passageIndex
          .find((passage) => passage.fieldPath.endsWith('/description'))?.evidencePassageId;
        const sentenceAssessments = judgeInput.answerManifest.map((unit) => {
          const isUnsupported = gateTripped && unit.text.includes('99.99%');
          if (!unit.text.trim()) return { sentenceId: unit.sentenceId, classification: 'non_factual', claims: [] };
          return {
            sentenceId: unit.sentenceId,
            classification: 'factual',
            claims: [{
              claimText: unit.text,
              verdict: isUnsupported ? 'contradicted' : 'supported',
              materiality: isUnsupported ? 'critical' : 'material',
              centralToAnswer: isUnsupported,
              evidencePassageIds: [evidencePassageId],
              reason: isUnsupported ? 'The evidence does not support this guarantee.' : 'The evidence supports the answer.',
            }],
          };
        });
        const report = {
          dimensionScores: { grounding: gateTripped ? 1 : 10, completeness: 9, depth: 8, relevance: 9 },
          dimensionRationales: { grounding: gateTripped ? 'Central contradiction.' : 'Supported.', completeness: 'Complete.', depth: 'Detailed.', relevance: 'Direct.' },
          sentenceAssessments,
          summary: gateTripped ? 'Material unsupported claim.' : 'Grounded.'
        };
        const role = ['skeptic', 'referee', 'advocate'].find((candidate) => url.includes('local_' + candidate));
        const validationInput = {
          ...judgeInput,
          evidencePacket: AlgoliaJudgeCore.buildEvidencePacket(judgeInput.evidencePacket.events),
        };
        window.__judgeValidations.push(AlgoliaJudgeCore.validateJudgeReport(role, report, validationInput));
        return stream([{ type: 'text-delta', delta: JSON.stringify(report) }]);
      }
      if (url.includes('/agent-studio/1/agents/local_primary_agent/')) {
        const request = JSON.parse(init.body);
        window.__agentRequests.push(request);
        if (scenario === 'retry429' && window.__agentRequests.length === 1) {
          return new Response('rate limited', { status: 429, headers: { 'retry-after': '0' } });
        }
        if (scenario === 'retry429Long') {
          return new Response('rate limited', { status: 429, headers: { 'retry-after': '60' } });
        }
        if (scenario === 'manualRetry429' && window.__agentRequests.length === 1) {
          return new Response('rate limited', { status: 429, headers: { 'retry-after': '60' } });
        }
        if (scenario === 'retry500' && window.__agentRequests.length === 1) {
          return new Response('temporary server failure', { status: 500 });
        }
        if (scenario === 'networkFailure') throw new TypeError('Failed to fetch');
        if (scenario === 'guardrailInput') {
          return stream([{
            type: 'data-guardrail-violation',
            data: {
              category: 'prompt_injection_or_secrets',
              guardrailType: 'input',
              fallbackResponse: 'I cannot share hidden instructions or credentials.'
            }
          }]);
        }
        if (scenario === 'empty200') return stream([]);
        if (scenario === 'stalledStream') {
          return new Response(new ReadableStream({ start() {}, cancel() { return new Promise(() => {}); } }), {
            status: 200,
            headers: { 'content-type': 'text/event-stream' }
          });
        }
        if (scenario === 'partialTerminalError') {
          return stream([
            { type: 'text-delta', delta: candidates.partialTerminalError },
            { type: 'error', message: 'terminal upstream failure' }
          ]);
        }
        if (scenario === 'retryIdentity' && window.__agentRequests.length === 1) {
          return stream([{ type: 'error', message: 'first attempt failed' }]);
        }
        const answer = candidates[scenario];
        return stream([
          { type: 'start', messageId: 'alg_msg_primary_response_' + window.__agentRequests.length },
          { type: 'tool-output-available', toolCallId: 'docs', output: { hits: [{
            objectID: 'docs-hit', title: scenario === 'metadataGrounded'
              ? 'Forrester Total Economic Impact study'
              : 'InstantSearch React documentation',
            url: 'https://www.algolia.com/doc/guides/building-search-ui/what-is-instantsearch/react/',
            source: 'Documentation', description: scenario === 'metadataGrounded'
              ? 'The study reported a 213% return on investment.'
              : 'InstantSearch is available for React implementations.'
          }, {
            objectID: 'customer-hit', title: 'Customer implementation story',
            url: 'https://www.algolia.com/customers/example/', source: 'Customer Stories',
            description: 'A customer implementation story without quantified conversion guarantees.'
          }] } },
          { type: 'text-delta', delta: answer },
          { type: 'data-suggestions', data: { suggestions: [followUp] } }
        ]);
      }
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    };
  </script><script src="/chat/algolia-confidence-badge.js"></script><script src="/chat/algolia-judge-core.js"></script><script src="/chat/algolia-chat.js"></script></head><body>
    <algolia-chat app-id="0EXRPAXB56" search-api-key="local" index-name="local">
      <algolia-agent role="primary" agent-id="local_primary_agent" label="aRRIe"></algolia-agent>
      <algolia-chat-confidence>
        <algolia-agent role="skeptic" agent-id="local_skeptic"></algolia-agent>
        <algolia-agent role="referee" agent-id="local_referee"></algolia-agent>
        <algolia-agent role="advocate" agent-id="local_advocate"></algolia-agent>
      </algolia-chat-confidence>
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

async function openScenario(scenario, { waitForJudge = true, requireFollowUp = true } = {}) {
  const { server, baseUrl } = await startServer();
  const context = await browser.newContext();
  const page = await context.newPage();
  const browserErrors = [];
  page.on('pageerror', (error) => browserErrors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') browserErrors.push(`${message.type()}: ${message.text()}`);
  });
  try {
    await page.goto(`${baseUrl}/admission-fixture?scenario=${scenario}&algoliaChatDebug=1`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => customElements.get('algolia-chat'), null, { timeout: 10_000 });
    await page.evaluate(() => document.querySelector('algolia-chat').ask('Verify the requested implementation specifics.'));
    await page.waitForFunction((followUpRequired) => {
      const root = document.querySelector('algolia-chat')?.shadowRoot;
      const stored = sessionStorage.getItem('algolia-chat:conversation');
      if (!stored) return false;
      return (!followUpRequired || root?.querySelectorAll('.acs-followup-card').length === 1) &&
        JSON.parse(stored).turns[0]?.segments[0]?.status === 'success';
    }, requireFollowUp, { timeout: 10_000 });
    if (waitForJudge) {
      await page.waitForFunction(() => {
        const badge = document.querySelector('algolia-chat')?.shadowRoot?.querySelector('algolia-confidence-badge');
        return Boolean(badge?.verdict) && badge.verdict.panelPending !== true && badge.scoring === false;
      }, null, { timeout: 10_000 });
    }
  } catch (error) {
    const state = await page.evaluate(() => ({
      judgeRequests: window.__judgeRequests,
      judgeValidations: window.__judgeValidations,
      agentRequests: window.__agentRequests,
      debug: window.__algoliaChatJudgeDebugLog,
      text: document.querySelector('algolia-chat')?.shadowRoot?.textContent,
    }));
    await context.close();
    await new Promise((resolve) => server.close(resolve));
    throw new Error(`${error.message}\nBrowser errors: ${browserErrors.join(' | ')}\nState: ${JSON.stringify(state).slice(0, 8000)}`);
  }
  return { context, page, server, browserErrors };
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
      agentRequests: window.__agentRequests,
      judgeRequestCount: window.__judgeRequests.length,
      judgeRequests: window.__judgeRequests,
      judgeValidations: window.__judgeValidations,
      badgeVerdict: badge?.verdict || null,
      followUpCount: root.querySelectorAll('.acs-followup-card').length,
    };
  });
}

async function openFailedScenario(scenario) {
  const { server, baseUrl } = await startServer();
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${baseUrl}/admission-fixture?scenario=${scenario}&algoliaChatDebug=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => customElements.get('algolia-chat'), null, { timeout: 10_000 });
  await page.evaluate(() => document.querySelector('algolia-chat').ask('Verify failure handling.'));
  await page.waitForFunction(() => {
    const raw = sessionStorage.getItem('algolia-chat:conversation');
    return raw && JSON.parse(raw).turns[0]?.segments[0]?.status === 'error';
  }, null, { timeout: 10_000 });
  return { context, page, server };
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
    assert.equal(result.judgeRequestCount, 3);
    assert.equal(typeof result.badgeVerdict.gateTripped, 'boolean');
    assert.equal(result.segment.admissionVerdict, undefined);
    assert.equal(result.followUpCount, 1);
    assert.equal(result.agentRequests[0].id, result.persisted.conversationId);
    assert.ok(result.agentRequests[0].id.startsWith('alg_cnv_'));
    assert.ok(result.agentRequests[0].messages.every((message) => typeof message.id === 'string' && message.id.startsWith('alg_msg_')));
    assert.equal(result.agentRequests[0].messages.at(-1).id, result.persisted.turns[0].userMessageId);
    assert.equal(result.segment.messageId, 'alg_msg_primary_response_1');
  } finally {
    await closeScenario(run);
  }
});

test('one explicit pre-stream 429 is retried once with the same logical identities', async () => {
  const run = await openScenario('retry429');
  try {
    const result = await runtimeState(run.page);
    assert.equal(result.agentRequestCount, 2);
    assert.equal(result.agentRequests[0].id, result.agentRequests[1].id);
    assert.deepEqual(
      result.agentRequests[0].messages.map((message) => message.id),
      result.agentRequests[1].messages.map((message) => message.id),
    );
    assert.match(result.segment.text, /recovered safely/);
  } finally {
    await closeScenario(run);
  }
});

test('one explicit pre-stream 500 is retried once and then succeeds', async () => {
  const run = await openScenario('retry500');
  try {
    const result = await runtimeState(run.page);
    assert.equal(result.agentRequestCount, 2);
    assert.equal(result.agentRequests[0].id, result.agentRequests[1].id);
    assert.match(result.segment.text, /recovered safely/);
  } finally {
    await closeScenario(run);
  }
});

test('a Retry-After beyond the turn deadline is honored without an early retry', async () => {
  const run = await openFailedScenario('retry429Long');
  try {
    const result = await runtimeState(run.page);
    assert.equal(result.agentRequestCount, 1);
    assert.match(result.text, /rate-limited right now/i);
  } finally {
    await closeScenario(run);
  }
});

test('manual retry after a visible 429 error sends a fresh request and replaces the failed turn', async () => {
  const run = await openFailedScenario('manualRetry429');
  try {
    let result = await runtimeState(run.page);
    const firstTurnId = result.persisted.turns[0].id;
    assert.equal(result.agentRequestCount, 1);
    assert.match(result.text, /rate-limited right now/i);

    await run.page.evaluate(() => {
      const root = document.querySelector('algolia-chat').shadowRoot;
      const retry = [...root.querySelectorAll('button')]
        .find((button) => /retry/i.test(button.textContent));
      if (!retry) throw new Error(`Retry button missing: ${root.textContent}`);
      retry.click();
    });
    await run.page.waitForFunction(() => {
      const raw = sessionStorage.getItem('algolia-chat:conversation');
      return raw && JSON.parse(raw).turns[0]?.segments[0]?.status === 'success';
    }, null, { timeout: 10_000 });
    result = await runtimeState(run.page);

    assert.equal(result.agentRequestCount, 2);
    assert.notEqual(result.persisted.turns[0].id, firstTurnId);
    assert.match(result.segment.text, /manually retried rate-limited request recovered safely/);
  } finally {
    await closeScenario(run);
  }
});

test('an uncertain network failure is not retried and shows a classified message', async () => {
  const run = await openFailedScenario('networkFailure');
  try {
    const result = await runtimeState(run.page);
    assert.equal(result.agentRequestCount, 1);
    assert.match(result.text, /could not reach the assistant service/i);
    assert.match(result.text, /no automatic duplicate was sent/i);
  } finally {
    await closeScenario(run);
  }
});

test('an empty 200 is not retried and shows an empty-response message', async () => {
  const run = await openFailedScenario('empty200');
  try {
    const result = await runtimeState(run.page);
    assert.equal(result.agentRequestCount, 1);
    assert.match(result.text, /empty response/i);
  } finally {
    await closeScenario(run);
  }
});

test('a guardrail violation is classified specifically and is not mislabeled as an empty response', async () => {
  const run = await openFailedScenario('guardrailInput');
  try {
    const result = await runtimeState(run.page);
    assert.equal(result.agentRequestCount, 1);
    assert.match(result.text, /safety filter classified this as a request for hidden instructions or credentials/i);
    assert.doesNotMatch(result.text, /empty response/i);
    assert.match(result.segment.error, /guardrail violation: prompt_injection_or_secrets/i);
  } finally {
    await closeScenario(run);
  }
});

test('a stalled HTTP 200 SSE stream reaches the bounded timeout without a retry', async () => {
  const run = await openFailedScenario('stalledStream');
  try {
    const result = await runtimeState(run.page);
    assert.equal(result.agentRequestCount, 1);
    assert.equal(result.segment.status, 'error');
    assert.match(result.text, /timed out after 60 seconds/i);
  } finally {
    await closeScenario(run);
  }
});

test('clicking a completed confidence badge opens the evaluation drawer', async () => {
  const run = await openScenario('pass');
  try {
    await run.page.evaluate(() => {
      const badge = document.querySelector('algolia-chat')
        .shadowRoot
        .querySelector('algolia-confidence-badge');
      badge.shadowRoot.querySelector('button').click();
    });
    await run.page.waitForFunction(() => Boolean(document
      .querySelector('algolia-chat')
      .shadowRoot
      .querySelector('[role="dialog"][aria-label="Answer evaluation breakdown"]')));

    const drawer = await run.page.evaluate(() => {
      const root = document.querySelector('algolia-chat').shadowRoot;
      const dialog = root.querySelector('[role="dialog"][aria-label="Answer evaluation breakdown"]');
      return {
        text: dialog?.textContent || '',
        question: dialog?.querySelector('p')?.textContent || '',
      };
    });
    assert.match(drawer.text, /Answer evaluation/);
    assert.match(drawer.question, /Verify the requested implementation specifics/);
  } finally {
    await closeScenario(run);
  }
});

test('a pending judge panel exposes all three live role states instead of a fake zero score', async () => {
  const run = await openScenario('slowJudges', { waitForJudge: false });
  try {
    await run.page.waitForFunction(() => Boolean(document
      .querySelector('algolia-chat')
      .shadowRoot
      .querySelector('algolia-confidence-badge')));
    const pendingText = await run.page.evaluate(() => document
      .querySelector('algolia-chat')
      .shadowRoot
      .querySelector('algolia-confidence-badge')
      .shadowRoot.textContent);
    assert.match(pendingText, /0\/3 judged/i);
    assert.doesNotMatch(pendingText, /0\.0/);
    await run.page.evaluate(() => document
      .querySelector('algolia-chat')
      .shadowRoot
      .querySelector('algolia-confidence-badge')
      .shadowRoot
      .querySelector('button')
      .click());
    const drawerText = await run.page.evaluate(() => document
      .querySelector('algolia-chat')
      .shadowRoot
      .querySelector('[role="dialog"][aria-label="Answer evaluation breakdown"]')
      ?.textContent || '');
    assert.match(drawerText, /Skeptic/);
    assert.match(drawerText, /Referee/);
    assert.match(drawerText, /Advocate/);
    assert.match(drawerText, /Judging/);
  } finally {
    await closeScenario(run);
  }
});

test('a partial answer followed by a terminal error stays visible and is never judged', async () => {
  const run = await openScenario('partialTerminalError', { waitForJudge: false, requireFollowUp: false });
  try {
    await run.page.waitForTimeout(100);
    const result = await runtimeState(run.page);
    assert.match(result.text, /This partial answer remains visible/);
    assert.equal(result.segment.status, 'success');
    assert.equal(result.segment.confidenceSuppressed, true);
    assert.equal(result.judgeRequestCount, 0);
    assert.equal(result.badgeVerdict, null);
  } finally {
    await closeScenario(run);
  }
});

test('retrying a failed turn creates a fresh answer identity before judging', async () => {
  const { server, baseUrl } = await startServer();
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.goto(`${baseUrl}/admission-fixture?scenario=retryIdentity&algoliaChatDebug=1`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => customElements.get('algolia-chat'));
    await page.evaluate(() => document.querySelector('algolia-chat').ask('Retry this question.'));
    await page.waitForFunction(() => {
      const raw = sessionStorage.getItem('algolia-chat:conversation');
      return raw && JSON.parse(raw).turns[0]?.segments[0]?.status === 'error';
    });
    const firstId = await page.evaluate(() => JSON.parse(sessionStorage.getItem('algolia-chat:conversation')).turns[0].id);
    await page.evaluate(() => {
      const root = document.querySelector('algolia-chat').shadowRoot;
      const retry = [...root.querySelectorAll('button')].find((button) => /try again|retry/i.test(button.textContent));
      if (!retry) throw new Error(`Retry button missing: ${root.textContent}`);
      retry.click();
    });
    await page.waitForFunction(() => {
      const stored = JSON.parse(sessionStorage.getItem('algolia-chat:conversation'));
      return stored.turns[0].segments[0].status === 'success' && window.__judgeRequests.length === 3;
    });
    const state = await page.evaluate(() => ({
      turn: JSON.parse(sessionStorage.getItem('algolia-chat:conversation')).turns[0],
      judgeRequests: window.__judgeRequests.length,
      agentRequests: window.__agentRequests.length,
    }));
    assert.notEqual(state.turn.id, firstId);
    assert.match(state.turn.segments[0].text, /retried answer is now complete/);
    assert.equal(state.agentRequests, 2);
    assert.equal(state.judgeRequests, 3);
  } finally {
    await context.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('an older delayed judge run cannot overwrite the standalone verdict for a newer answer', async () => {
  const run = await openScenario('twoTurnRace', { waitForJudge: false });
  try {
    await run.page.waitForFunction(() => window.__judgeRequests.length === 3);
    await run.page.waitForTimeout(25);
    await run.page.evaluate(() => document.querySelector('algolia-chat').shadowRoot.querySelector('.acs-followup-card').click());
    await run.page.waitForTimeout(1_500);
    const raceState = await run.page.evaluate(() => {
      const stored = JSON.parse(sessionStorage.getItem('algolia-chat:conversation'));
      return { turns: stored.turns, judgeRequestCount: window.__judgeRequests.length, verdictEvents: window.__verdictEvents };
    });
    assert.equal(raceState.turns.length, 2, JSON.stringify(raceState));
    assert.equal(raceState.turns[1].segments[0].status, 'success', JSON.stringify(raceState));
    assert.equal(raceState.judgeRequestCount, 6, JSON.stringify(raceState));
    assert.equal(raceState.verdictEvents.length, 1, JSON.stringify(raceState));
    assert.equal(
      raceState.verdictEvents[0].question,
      'Are you shaping a quick proof of concept, or planning the architecture for a production implementation?',
    );
    assert.match(raceState.verdictEvents[0].answerId, /:primary$/);
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
    assert.equal(first.followUpCount, 1);
    assert.deepEqual(first.segment.rawHits.map((hit) => hit.source), ['Documentation', 'Customer Stories']);
    assert.equal(first.segment.sources.length, 2);
    assert.match(first.segment.text, /99\.99% annual conversion growth/);
    assert.equal(first.segment.admissionRewritten, undefined);
    assert.equal(first.segment.admissionVerdict, undefined);
    assert.equal(first.agentRequestCount, 1);
    assert.equal(first.judgeRequestCount, 3, JSON.stringify({
      validations: first.judgeValidations,
      firstRequest: first.judgeRequests[0],
    }));
    assert.equal(first.badgeVerdict.gateTripped, true);
    assert.equal(first.badgeVerdict.composite, 6.8);
    assert.equal(first.badgeVerdict.appliedCap, null);
    assert.deepEqual(
      first.badgeVerdict.unsupportedTerms.map(({ term }) => term),
      ['The Enterprise plan guarantees 99.99% annual conversion growth.'],
    );
    const highlightedClaims = await run.page.evaluate(() => document
      .querySelector('algolia-chat')
      .shadowRoot
      .querySelectorAll('[data-source-review="unsupported-term"]').length);
    assert.equal(highlightedClaims, 1);

    const badgeText = await run.page.evaluate(() => {
      const root = document.querySelector('algolia-chat').shadowRoot;
      const badge = root.querySelector('algolia-confidence-badge');
      badge.shadowRoot.querySelector('button').click();
      return badge.shadowRoot.textContent;
    });
    await run.page.waitForFunction(() => Boolean(document
      .querySelector('algolia-chat')
      .shadowRoot
      .querySelector('[role="dialog"][aria-label="Answer evaluation breakdown"]')));
    const drawerText = await run.page.evaluate(() => document
      .querySelector('algolia-chat')
      .shadowRoot
      .querySelector('[role="dialog"][aria-label="Answer evaluation breakdown"]')
      .textContent);
    assert.match(badgeText, /Confidence6\.8\/10.*1 to review/);
    assert.match(drawerText, /Overall · four-dimension panel mean/);
    assert.match(drawerText, /grounding concern is shown separately/i);
    assert.doesNotMatch(drawerText, /cap(?:ped)? (?:at|the composite)/i);

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
    assert.equal(result.judgeRequestCount, 3);
    assert.equal(result.badgeVerdict.composite, 9);
    assert.equal(result.badgeVerdict.gateTripped, false);
    assert.equal(result.badgeVerdict.grounded, undefined);
    assert.deepEqual(
      result.badgeVerdict.deterministicGrounding.unsupportedTerms.map(({ term }) => term),
      ['999'],
    );
    const presentation = await run.page.evaluate(() => {
      const root = document.querySelector('algolia-chat').shadowRoot;
      const badge = root.querySelector('algolia-confidence-badge');
      return {
        highlightedTerms: root.querySelectorAll('[data-source-review="unsupported-term"]').length,
        badgeText: badge.shadowRoot.textContent,
      };
    });
    assert.equal(presentation.highlightedTerms, 0);
    assert.match(presentation.badgeText, /Confidence9\.0\/10/);
  } finally {
    await closeScenario(run);
  }
});

test('source title metadata grounds the Forrester study reference', async () => {
  const run = await openScenario('metadataGrounded');
  try {
    const result = await runtimeState(run.page);
    assert.equal(result.badgeVerdict.composite, 9);
    assert.equal(result.badgeVerdict.gateTripped, false);
    assert.equal(result.badgeVerdict.deterministicGrounding.grounded, true);
    assert.deepEqual(result.badgeVerdict.deterministicGrounding.unsupportedTerms, []);

    const highlightedTerms = await run.page.evaluate(() => document
      .querySelector('algolia-chat')
      .shadowRoot
      .querySelectorAll('[data-source-review="unsupported-term"]').length);
    assert.equal(highlightedTerms, 0);
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
    assert.equal(result.judgeRequestCount, 6, 'Each unavailable role retries once against the same packet');
    assert.equal(result.followUpCount, 1);
  } finally {
    await closeScenario(run);
  }
});

test('one unavailable role produces an explicit provisional two-judge score', async () => {
  const run = await openScenario('oneJudgeUnavailable');
  try {
    const result = await runtimeState(run.page);
    assert.equal(result.judgeRequestCount, 4, 'Only the unavailable skeptic retries');
    assert.equal(result.badgeVerdict.status, 'provisional');
    assert.equal(result.badgeVerdict.provisional, true);
    assert.equal(result.badgeVerdict.validJudgeCount, 2);
    assert.equal(result.badgeVerdict.groundingStatus, 'disagreement');
    assert.equal(result.badgeVerdict.composite, 9);
  } finally {
    await closeScenario(run);
  }
});

test('two unavailable roles never expose a one-judge score', async () => {
  const run = await openScenario('twoJudgesUnavailable');
  try {
    const result = await runtimeState(run.page);
    assert.equal(result.judgeRequestCount, 5, 'Only the two unavailable roles retry');
    assert.ok(result.badgeVerdict.error);
    assert.equal(result.badgeVerdict.composite, 0);
    assert.equal(result.badgeVerdict.perJudge.length, 0);
  } finally {
    await closeScenario(run);
  }
});

test('a clicked server-provided follow-up remains visitor text and completes its second turn', async () => {
  const run = await openScenario('discoveryTurn');
  try {
    await run.page.evaluate(() => {
      document.querySelector('algolia-chat').shadowRoot.querySelector('.acs-followup-card').click();
    });
    await run.page.waitForFunction(() => {
      const conversation = JSON.parse(sessionStorage.getItem('algolia-chat:conversation'));
      return conversation.turns.length === 2 && conversation.turns[1].segments[0].status !== 'loading';
    });

    const result = await run.page.evaluate(() => ({
      requests: window.__agentRequests,
      conversation: JSON.parse(sessionStorage.getItem('algolia-chat:conversation')),
      text: document.querySelector('algolia-chat').shadowRoot.textContent,
    }));
    const secondTurn = result.conversation.turns[1].segments[0];
    const secondRequest = JSON.stringify(result.requests[1]);

    assert.equal(result.requests.length, 2);
    assert.doesNotMatch(secondRequest, /\[DISCOVERY CONTROL/);
    assert.equal(secondTurn.status, 'success');
    assert.match(secondTurn.text, /grounded answer for the current discovery turn/);
    assert.doesNotMatch(result.text, /Couldn.t reach the Assistant agent/);
  } finally {
    await closeScenario(run);
  }
});
