import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createTelemetryContribution } from '../source/shared/widget/answer-contributors.mjs';

const telemetryPath = new URL('../token-telemetry.js', import.meta.url);

/*
 * Scenario inventory:
 * - The module subscribes to completed turns and never replaces window.fetch.
 * - The proxy receives only conversationId, never browser-selected appId or agentId.
 * - Duplicate completed events produce one lookup.
 * - Two conversations accumulate input, output, total, and turn counts.
 * - Zero totals retry with bounded backoff.
 * - Proxy failures remain isolated from the primary answer path.
 * - The existing visitor reset clears cumulative state.
 */
function createHarness({ responses = [], compilerSender = false, confidenceBadgeCount = 0, answerFooter = true } = {}) {
  const fetchCalls = [];
  const answerHarnessEvents = [];
  const windowListeners = {};
  const documentListeners = {};
  const timers = [];
  let completedListener = null;
  let headerPill = null;
  let pillStyle = null;
  let mutationCallback = null;
  const iconCluster = { id: 'icon-cluster' };
  let headerInsertedBeforeCluster = false;
  let footerPill = null;
  const answerFooterElement = {
    querySelector(selector) {
      return selector === '.algolia-usage-pill' ? footerPill : null;
    },
    appendChild(element) {
      element.parentNode = this;
      element.parentElement = this;
      footerPill = element;
    },
    removeChild(element) {
      if (footerPill === element) footerPill = null;
    },
  };
  const sourceWrap = { parentElement: answerFooterElement };
  const groundedSources = { parentElement: sourceWrap };
  const chatHeader = {
    get lastElementChild() { return iconCluster; },
    querySelector(selector) {
      return selector === '.algolia-usage-pill' ? headerPill : null;
    },
    appendChild(element) {
      element.parentNode = this;
      headerPill = element;
    },
    insertBefore(element, anchor) {
      headerInsertedBeforeCluster = anchor === iconCluster;
      this.appendChild(element);
    },
    removeChild(element) {
      if (headerPill === element) headerPill = null;
    },
  };
  const badges = [];
  function addBadge() {
    let pill = null;
    let style = null;
    const verdict = { className: 'badge' };
    const root = {
      querySelector(selector) {
        if (selector === '.algolia-usage-pill') return pill;
        if (selector === '.badge') return verdict;
        if (selector === '#algolia-usage-pill-style') return style;
        return null;
      },
      appendChild(element) {
        element.parentNode = this;
        pill = element;
      },
      insertBefore(element) {
        this.appendChild(element);
      },
      prepend(element) { style = element; },
      removeChild(element) {
        if (pill === element) pill = null;
      },
      pill() { return pill; },
    };
    badges.push({ shadowRoot: root });
    mutationCallback?.([]);
  }
  for (let index = 0; index < confidenceBadgeCount; index += 1) addBadge();
  const chatShadow = {
    addEventListener() {},
    querySelectorAll(selector) {
      if (selector === 'algolia-confidence-badge') return badges;
      if (selector === '[aria-label="Grounded sources"]') return answerFooter ? [groundedSources] : [];
      if (selector === '.algolia-usage-pill') return footerPill ? [footerPill] : [];
      return [];
    },
    querySelector(selector) {
      if (selector === "header, [role='banner'], [part='header']") return chatHeader;
      if (selector === '#algolia-usage-pill-style') return pillStyle;
      if (selector === '.algolia-usage-pill--header') return headerPill;
      return null;
    },
    prepend(element) {
      pillStyle = element;
    },
  };
  const context = {
    console,
    URL,
    URLSearchParams,
    CustomEvent: class CustomEvent {
      constructor(type, options = {}) {
        this.type = type;
        this.detail = options.detail;
      }
    },
    MutationObserver: class MutationObserver {
      constructor(callback) { mutationCallback = callback; }
      observe() {}
    },
    document: {
      addEventListener(type, listener) {
        (documentListeners[type] ||= []).push(listener);
      },
      querySelector(selector) {
        return selector === 'algolia-chat' ? { shadowRoot: chatShadow } : null;
      },
      createElement() {
        let textContent = '';
        return {
          className: '',
          title: '',
          parentNode: null,
          parentElement: null,
          children: [],
          dataset: {},
          textWrites: 0,
          get textContent() {
            return this.children.length
              ? this.children.map((child) => child.textContent).join('')
              : textContent;
          },
          set textContent(value) {
            textContent = String(value);
            this.children = [];
            this.textWrites += 1;
          },
          appendChild(element) {
            element.parentNode = this;
            element.parentElement = this;
            this.children.push(element);
            return element;
          },
          append(...elements) {
            elements.forEach((element) => this.appendChild(element));
          },
          replaceChildren(...elements) {
            textContent = '';
            this.children = [];
            elements.forEach((element) => this.appendChild(element));
          },
          setAttribute() {},
          remove() { this.parentNode?.removeChild(this); },
        };
      },
    },
    fetch: async (url, init = {}) => {
      fetchCalls.push({ url: String(url), init });
      const queued = responses.shift();
      const response = await (queued || { ok: true, data: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } });
      return {
        ok: response.ok,
        status: response.status || (response.ok ? 200 : 503),
        json: async () => response.data,
      };
    },
    setInterval(callback) { callback(); return 1; },
    clearInterval() {},
    setTimeout(callback) { timers.push(callback); return timers.length; },
    addEventListener(type, listener) {
      (windowListeners[type] ||= []).push(listener);
    },
    dispatchEvent(event) {
      (windowListeners[event.type] || []).forEach((listener) => listener(event));
    },
    ACS_TOKEN_TELEMETRY: { exposeForTests: true },
    algoliaAnswerHarness: {
      accept(event) {
        answerHarnessEvents.push(JSON.parse(JSON.stringify(event)));
      },
    },
    algoliaAnswerContributors: {
      createTelemetryContribution,
    },
    algoliaHandoffToOrchestrator: {
      subscribeCompletedTurn(listener) {
        completedListener = listener;
        return () => { completedListener = null; };
      },
      ensureAnswerFooter() {
        return answerFooter ? answerFooterElement : null;
      },
    },
  };
  context.window = context;
  const nativeFetch = context.fetch;
  if (compilerSender) {
    context.algoliaContextCompiler = {
      fetchPrepared(input, init) {
        return nativeFetch(input, init);
      },
    };
    context.fetch = () => {
      throw new Error('telemetry lookup re-entered the wrapped global fetch');
    };
  }
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(telemetryPath, 'utf8'), context);
  const settle = async () => {
    for (let index = 0; index < 8; index += 1) await new Promise((resolve) => setImmediate(resolve));
  };
  return {
    context,
    fetchCalls,
    nativeFetch,
    timers,
    headerPill() { return headerPill; },
    footerPill() { return footerPill; },
    headerInsertedBeforeCluster() { return headerInsertedBeforeCluster; },
    badgePill(index) { return badges[index]?.shadowRoot.pill() || null; },
    answerHarnessEvents,
    addBadge,
    reconcile() { mutationCallback?.([]); },
    emitCompleted(detail) { completedListener(detail); },
    reset() {
      (documentListeners['algolia-visitor-state-reset'] || []).forEach((listener) => listener({ detail: {} }));
    },
    settle,
  };
}

test('subscribes to the canonical transport without patching global fetch', () => {
  const h = createHarness();

  assert.equal(h.context.fetch, h.nativeFetch);
  assert.equal(fs.readFileSync(telemetryPath, 'utf8').includes('window.fetch ='), false);
});

test('uses the compiler native sender without re-entering the global interceptor', async () => {
  const h = createHarness({ compilerSender: true });

  h.emitCompleted({ turnKey: 'conversation:user-1', conversationId: 'alg_cnv_native_1' });
  await h.settle();

  assert.equal(h.fetchCalls.length, 1);
});

test('looks up one completed conversation without browser-selected app or agent ids', async () => {
  const h = createHarness();

  h.emitCompleted({ turnKey: 'conversation:user-1', conversationId: 'alg_cnv_1' });
  h.emitCompleted({ turnKey: 'conversation:user-1', conversationId: 'alg_cnv_1' });
  await h.settle();

  assert.equal(h.fetchCalls.length, 1);
  assert.equal(String(h.fetchCalls[0].init.body), 'conversationId=alg_cnv_1');
  assert.equal(String(h.fetchCalls[0].init.body).includes('appId='), false);
  assert.equal(String(h.fetchCalls[0].init.body).includes('agentId='), false);
});

test('shows the latest response input/output in the answer footer and keeps cumulative diagnostics', async () => {
  const h = createHarness({
    responses: [
      { ok: true, data: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } },
      { ok: true, data: { inputTokens: 20, outputTokens: 7, totalTokens: 27 } },
    ],
  });

  h.emitCompleted({ turnKey: 'conversation:user-1', conversationId: 'alg_cnv_1' });
  await h.settle();
  h.emitCompleted({ turnKey: 'conversation:user-2', conversationId: 'alg_cnv_2' });
  await h.settle();

  assert.deepEqual(
    JSON.parse(JSON.stringify(h.context.__algoliaChatUsage.usage)),
    { inputTokens: 20, outputTokens: 7, totalTokens: 27 },
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(h.context.__algoliaChatUsage.cumulativeUsage)),
    { inputTokens: 30, outputTokens: 12, totalTokens: 42, turns: 2 },
  );
  assert.equal(h.headerPill(), null, 'telemetry never enters the header');
  assert.equal(h.footerPill().textContent, 'In 20 / 7 Out');
  assert.equal(h.footerPill().title, 'Current response: 20 input tokens and 7 output tokens');
  const writesBeforeReconcile = h.footerPill().textWrites;
  h.reconcile();
  h.reconcile();
  assert.equal(h.footerPill().textWrites, writesBeforeReconcile, 'stable renders must not rewrite pill text');
  h.reset();
  assert.equal(h.context.__algoliaChatUsage.usage, null);
  assert.equal(h.footerPill(), null);
});

test('formats input/output counts with commas and subtle split classes', async () => {
  const h = createHarness({
    responses: [
      { ok: true, data: { inputTokens: 44141, outputTokens: 819, totalTokens: 44960 } },
    ],
  });

  h.emitCompleted({ turnKey: 'conversation:user-1', conversationId: 'alg_cnv_large' });
  await h.settle();

  assert.equal(h.footerPill().textContent, 'In 44,141 / 819 Out');
  assert.equal(h.footerPill().title, 'Current response: 44,141 input tokens and 819 output tokens');
  assert.deepEqual(
    h.footerPill().children.map((child) => child.className),
    ['algolia-usage-pill__in', 'algolia-usage-pill__divider', 'algolia-usage-pill__out'],
  );
});

test('mirrors telemetry as a typed answer contribution for the completed answer identity', async () => {
  const h = createHarness({
    responses: [
      { ok: true, data: { inputTokens: 44141, outputTokens: 819, totalTokens: 44960 } },
    ],
  });
  const answerIdentity = {
    widgetInstanceId: 'widget-1',
    conversationId: 'conversation-1',
    answerSegmentId: 'assistant-1',
    networkAttemptId: 'attempt-1',
  };

  h.emitCompleted({ turnKey: 'conversation:user-1', conversationId: 'alg_cnv_large', answerIdentity });
  await h.settle();

  const telemetry = h.answerHarnessEvents.find((event) =>
    event.eventName === 'contribution' &&
    event.detail?.contribution?.kind === 'telemetry'
  );
  assert.ok(telemetry);
  assert.deepEqual(telemetry.detail.answerIdentity, answerIdentity);
  assert.deepEqual(
    telemetry.detail.contribution.slots.telemetry,
    { status: 'ready', value: { inputTokens: 44141, outputTokens: 819, totalTokens: 44960 } },
  );
});

test('derives the current response by subtracting the prior stable-conversation snapshot', async () => {
  const h = createHarness({
    responses: [
      { ok: true, data: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } },
      { ok: true, data: { inputTokens: 30, outputTokens: 12, totalTokens: 42 } },
    ],
  });

  h.emitCompleted({ turnKey: 'conversation:user-1', conversationId: 'alg_cnv_stable' });
  await h.settle();
  h.emitCompleted({ turnKey: 'conversation:user-2', conversationId: 'alg_cnv_stable' });
  await h.settle();

  assert.equal(h.fetchCalls.length, 2);
  assert.deepEqual(
    JSON.parse(JSON.stringify(h.context.__algoliaChatUsage.usage)),
    { inputTokens: 20, outputTokens: 7, totalTokens: 27 },
  );
  assert.equal(h.footerPill().textContent, 'In 20 / 7 Out');
});

test('retries a non-zero but unchanged conversation snapshot before showing the latest response', async () => {
  const h = createHarness({
    responses: [
      { ok: true, data: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } },
      { ok: true, data: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } },
      { ok: true, data: { inputTokens: 30, outputTokens: 12, totalTokens: 42 } },
    ],
  });

  h.emitCompleted({ turnKey: 'conversation:user-1', conversationId: 'alg_cnv_stable' });
  await h.settle();
  h.emitCompleted({ turnKey: 'conversation:user-2', conversationId: 'alg_cnv_stable' });
  await h.settle();

  assert.equal(h.context.__algoliaChatUsage.usage, null, 'stale totals are not mislabeled as the new response');
  assert.equal(h.timers.length, 1);
  h.timers.shift()();
  await h.settle();
  assert.equal(h.footerPill().textContent, 'In 20 / 7 Out');
});

test('an older overlapping lookup cannot regress a newer cumulative total or status', async () => {
  let resolveFirst;
  const first = new Promise((resolve) => { resolveFirst = resolve; });
  const h = createHarness({
    responses: [
      first,
      { ok: true, data: { inputTokens: 30, outputTokens: 12, totalTokens: 42 } },
    ],
  });

  h.emitCompleted({ turnKey: 'conversation:user-1', conversationId: 'alg_cnv_stable' });
  h.emitCompleted({ turnKey: 'conversation:user-2', conversationId: 'alg_cnv_stable' });
  await h.settle();
  assert.equal(h.context.__algoliaChatUsage.usage.totalTokens, 42);
  assert.equal(h.context.__algoliaChatUsage.status, 'ready');

  resolveFirst({ ok: true, data: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } });
  await h.settle();
  assert.equal(h.context.__algoliaChatUsage.usage.totalTokens, 42);
  assert.equal(h.context.__algoliaChatUsage.status, 'ready');
});

test('a retry queued before reset does not call the backend after reset', async () => {
  const h = createHarness({
    responses: [{ ok: true, data: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } }],
  });

  h.emitCompleted({ turnKey: 'conversation:user-1', conversationId: 'alg_cnv_stale' });
  await h.settle();
  assert.equal(h.timers.length, 1);
  h.reset();
  h.timers.shift()();
  await h.settle();
  assert.equal(h.fetchCalls.length, 1);
});

test('telemetry stays in the answer footer whether or not confidence badges exist', async () => {
  const h = createHarness();

  h.emitCompleted({ turnKey: 'conversation:user-1', conversationId: 'alg_cnv_1' });
  await h.settle();
  assert.equal(h.headerPill(), null);
  assert.equal(h.footerPill().textContent, 'In 10 / 5 Out');

  h.addBadge();
  assert.equal(h.headerPill(), null);
  assert.equal(h.footerPill().textContent, 'In 10 / 5 Out');
  assert.equal(h.badgePill(0), null);

  h.addBadge();
  assert.equal(h.badgePill(0), null);
  assert.equal(h.badgePill(1), null);
  assert.equal(h.footerPill().textContent, 'In 10 / 5 Out');

  h.reset();
  assert.equal(h.headerPill(), null);
  assert.equal(h.footerPill(), null);
  assert.equal(h.badgePill(0), null);
  assert.equal(h.badgePill(1), null);
});

test('retries totals that have not persisted and contains proxy failures', async () => {
  const h = createHarness({
    responses: [
      { ok: true, data: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } },
      { ok: true, data: { inputTokens: 8, outputTokens: 4, totalTokens: 12 } },
      { ok: false, status: 503, data: { error: 'unavailable' } },
    ],
  });

  h.emitCompleted({ turnKey: 'conversation:user-1', conversationId: 'alg_cnv_1' });
  await h.settle();
  assert.equal(h.timers.length, 1);
  h.timers.shift()();
  await h.settle();
  assert.equal(h.context.__algoliaChatUsage.usage.totalTokens, 12);

  assert.doesNotThrow(() => {
    h.emitCompleted({ turnKey: 'conversation:user-2', conversationId: 'alg_cnv_2' });
  });
  await h.settle();
  assert.equal(h.context.__algoliaChatUsage.usage, null, 'failed latest lookup cannot show stale turn data');
  assert.equal(h.context.__algoliaChatUsage.cumulativeUsage.totalTokens, 12, 'diagnostic cumulative totals remain intact');
});
