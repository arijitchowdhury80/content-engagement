import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const engagePath = new URL('../algolia-chat-engage.js', import.meta.url);

class MemoryStorage {
  constructor(initial = {}) {
    this.store = new Map(Object.entries(initial));
  }

  getItem(key) {
    return this.store.has(key) ? this.store.get(key) : null;
  }

  setItem(key, value) {
    this.store.set(key, String(value));
  }

  removeItem(key) {
    this.store.delete(key);
  }
}

function createHarness({ anchors = [] } = {}) {
  const documentListeners = new Map();
  const timers = [];
  const analyzingCalls = [];
  const chatElement = {
    autoEngage: true,
    visitorDataSource: null,
    engage() {
      return true;
    },
    setAnalyzing(value) {
      analyzingCalls.push(Boolean(value));
    },
    setVisitorDataSource(source) {
      this.visitorDataSource = source;
    },
  };

  const context = {
    console,
    URL,
    URLSearchParams,
    localStorage: new MemoryStorage(),
    sessionStorage: new MemoryStorage({
      algolia_session: JSON.stringify({
        schema: 'AlgoliaEngagementSession.v1',
        startedAt: Date.now(),
        pages: [{ path: '/pricing', title: 'Pricing', dwellMs: 0 }],
      }),
      algolia_events: JSON.stringify({
        schema: 'AlgoliaEngagementEvents.v1',
        events: [],
      }),
    }),
    location: {
      search: '?minPages=99&minEvents=99&delayMs=999999',
      pathname: '/pricing',
      origin: 'https://tmp-content-eng-algolia.cloud.jahia.com',
    },
    setTimeout(fn, delay) {
      timers.push({ fn, delay });
      return timers.length;
    },
    clearTimeout() {},
    setInterval() {
      return 1;
    },
    clearInterval() {},
    CustomEvent: class CustomEvent {
      constructor(type, options = {}) {
        this.type = type;
        this.detail = options.detail;
      }
    },
    document: {
      hidden: false,
      title: 'Pricing',
      querySelector(selector) {
        return selector === 'algolia-chat' ? chatElement : null;
      },
      querySelectorAll(selector) {
        return selector === 'a[data-finalurl][data-is-internal="true"]' ? anchors : [];
      },
      addEventListener(name, handler) {
        documentListeners.set(name, handler);
      },
      dispatchEvent(event) {
        documentListeners.get(event.type)?.(event);
        return true;
      },
    },
    fetch() {
      throw new Error('fetch should not run for the pulse-only test');
    },
  };
  context.window = context;

  vm.createContext(context);
  vm.runInContext(fs.readFileSync(engagePath, 'utf8'), context);

  return { context, analyzingCalls, timers, chatElement };
}

test('repairs malformed same-origin Jahia documentation hrefs using their final render URL', () => {
  const anchor = {
    dataset: {
      finalurl:
        'https://tmp-content-eng-algolia.cloud.jahia.com/cms/render/live/en/sites/www/home/doc/guides/example.html',
    },
    attributes: new Map([['href', '/sites/www/doc/guides/example']]),
    getAttribute(name) {
      return this.attributes.get(name) || null;
    },
    setAttribute(name, value) {
      this.attributes.set(name, String(value));
    },
  };

  createHarness({ anchors: [anchor] });

  assert.equal(
    anchor.getAttribute('href'),
    'https://tmp-content-eng-algolia.cloud.jahia.com/cms/render/live/en/sites/www/home/doc/guides/example.html',
  );
});

test('connects the reactive chat to the canonical Algolia tracker stores', async () => {
  const { context, chatElement } = createHarness();
  context.localStorage.setItem(
    'algolia_profile',
    JSON.stringify({ schema: 'AlgoliaEngagementProfile.v1', persona: 'developer' }),
  );
  context.sessionStorage.setItem(
    'algolia_session',
    JSON.stringify({
      schema: 'AlgoliaEngagementSession.v1',
      sessionId: 'session_1',
      pages: [{ path: '/products/search', title: 'Search' }, { path: '/pricing', title: 'Pricing' }],
    }),
  );
  context.sessionStorage.setItem(
    'algolia_events',
    JSON.stringify({
      schema: 'AlgoliaEngagementEvents.v1',
      events: [{ eventId: 'event_1', name: 'page_view', path: '/pricing' }],
    }),
  );

  await new Promise((resolve) => setImmediate(resolve));

  assert.ok(chatElement.visitorDataSource, 'expected the chat visitor source to be installed');
  assert.equal(chatElement.visitorDataSource.getProfile().persona, 'developer');
  assert.equal(
    JSON.stringify(chatElement.visitorDataSource.getSessionPages().map((page) => page.path)),
    JSON.stringify(['/products/search', '/pricing']),
  );
  assert.equal(chatElement.visitorDataSource.getEvents()[0].name, 'page_view');
  assert.equal(chatElement.visitorDataSource.getSession().sessionId, 'session_1');
});

test('pulses the launcher when the tracker reports visitor activity', () => {
  const { context, analyzingCalls, timers } = createHarness();

  context.document.dispatchEvent(
    new context.CustomEvent('algolia-engagement-signal', {
      detail: { name: 'nav_click', path: '/products/ai-recommendations' },
    })
  );

  assert.deepEqual(analyzingCalls.slice(0, 1), [true]);

  const clearTimer = timers.find((timer) => timer.delay === 900);
  assert.ok(clearTimer, 'expected a short visual pulse timeout');
  clearTimer.fn();

  assert.deepEqual(analyzingCalls.slice(-1), [false]);
});

test('does not schedule proactive analysis from activity signals by default', () => {
  const { context, timers } = createHarness();

  context.document.dispatchEvent(
    new context.CustomEvent('algolia-engagement-signal', {
      detail: { name: 'nav_click', path: '/products/ai-recommendations' },
    })
  );

  assert.equal(
    timers.some((timer) => timer.delay === 700),
    false,
    'activity signals should pulse only until proactive policy explicitly enables analysis'
  );
});
