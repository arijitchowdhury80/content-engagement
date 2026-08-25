import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

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
function createHarness({ responses = [], compilerSender = false } = {}) {
  const fetchCalls = [];
  const windowListeners = {};
  const documentListeners = {};
  const timers = [];
  let completedListener = null;
  const chatShadow = {
    addEventListener() {},
    querySelectorAll() { return []; },
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
    MutationObserver: class MutationObserver { observe() {} },
    document: {
      addEventListener(type, listener) {
        (documentListeners[type] ||= []).push(listener);
      },
      querySelector(selector) {
        return selector === 'algolia-chat' ? { shadowRoot: chatShadow } : null;
      },
      createElement() {
        return { className: '', textContent: '', title: '', setAttribute() {} };
      },
    },
    fetch: async (url, init = {}) => {
      fetchCalls.push({ url: String(url), init });
      const response = responses.shift() || { ok: true, data: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } };
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
    algoliaHandoffToOrchestrator: {
      subscribeCompletedTurn(listener) {
        completedListener = listener;
        return () => { completedListener = null; };
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

test('accumulates token totals across successful primary turns and resets', async () => {
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
    { inputTokens: 30, outputTokens: 12, totalTokens: 42, turns: 2 },
  );
  h.reset();
  assert.equal(h.context.__algoliaChatUsage.usage, null);
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
  assert.equal(h.context.__algoliaChatUsage.usage.totalTokens, 12, 'failed lookup cannot erase prior totals');
});
