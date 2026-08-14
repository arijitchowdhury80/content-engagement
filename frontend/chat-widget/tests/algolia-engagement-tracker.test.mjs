import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const trackerPath = new URL('../algolia-engagement-tracker.js', import.meta.url);

class MemoryStorage {
  constructor() {
    this.store = new Map();
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

function createHarness() {
  const listeners = new Map();
  const documentListeners = new Map();
  const localStorage = new MemoryStorage();
  const sessionStorage = new MemoryStorage();
  const chatElement = {
    source: null,
    setVisitorDataSource(source) {
      this.source = source;
    },
    dispatchEvent() {},
  };

  const context = {
    console,
    localStorage,
    sessionStorage,
    URL,
    URLSearchParams,
    setTimeout(fn) {
      return fn();
    },
    clearTimeout() {},
    crypto: {
      getRandomValues(array) {
        for (let i = 0; i < array.length; i += 1) array[i] = i + 1;
        return array;
      },
    },
    location: {
      href: 'https://www.algolia.com/pricing?utm_source=paid_search&email=nope@example.com',
      origin: 'https://www.algolia.com',
      pathname: '/pricing',
      search: '?utm_source=paid_search&email=nope@example.com',
    },
    history: {
      pushState() {},
    },
    addEventListener(name, handler) {
      listeners.set(name, handler);
    },
    dispatchWindowEvent(name) {
      listeners.get(name)?.();
    },
    document: {
      title: 'Pricing',
      referrer: 'https://www.algolia.com/products/ai-search?token=secret',
      hidden: false,
      cookie: '',
      documentElement: { scrollHeight: 1000 },
      body: { scrollHeight: 1000 },
      querySelector(selector) {
        return selector === 'algolia-chat' ? chatElement : null;
      },
      addEventListener(name, handler) {
        documentListeners.set(name, handler);
      },
      dispatchDocumentEvent(name, event) {
        documentListeners.get(name)?.(event);
      },
    },
    innerHeight: 500,
    scrollY: 0,
  };
  context.window = context;

  vm.createContext(context);
  vm.runInContext(fs.readFileSync(trackerPath, 'utf8'), context);

  return { context, localStorage, sessionStorage, chatElement };
}

function parse(storage, key) {
  return JSON.parse(storage.getItem(key));
}

test('initializes profile in localStorage and session data in sessionStorage', () => {
  const { context, localStorage, sessionStorage } = createHarness();

  assert.ok(context.algoliaEngagementTracker);
  assert.equal(parse(localStorage, 'algolia_profile').schema, 'AlgoliaEngagementProfile.v1');
  assert.equal(parse(sessionStorage, 'algolia_session').schema, 'AlgoliaEngagementSession.v1');
  assert.equal(parse(sessionStorage, 'algolia_events').schema, 'AlgoliaEngagementEvents.v1');
  assert.equal(localStorage.getItem('algolia_session'), null);
  assert.equal(localStorage.getItem('algolia_events'), null);
});

test('captures page view with sanitized URL and safe UTM values', () => {
  const { sessionStorage } = createHarness();
  const events = parse(sessionStorage, 'algolia_events').events;
  const pageView = events.find((event) => event.name === 'page_view');

  assert.equal(pageView.path, '/pricing');
  assert.equal(pageView.props.url, 'https://www.algolia.com/pricing');
  assert.equal(pageView.props.referrer, 'https://www.algolia.com/products/ai-search');
  assert.deepEqual(pageView.props.utm, { utm_source: 'paid_search' });
  assert.equal(pageView.props.email, undefined);
});

test('redacts sensitive strings inside otherwise safe event props', () => {
  const { context, sessionStorage } = createHarness();

  context.algoliaEngagementTracker.track('site_search', {
    query: 'pricing for person@example.com and +1 415 555 1234',
  });

  const serialized = sessionStorage.getItem('algolia_events');

  assert.match(serialized, /\[redacted-email\]/);
  assert.match(serialized, /\[redacted-phone\]/);
  assert.doesNotMatch(serialized, /person@example.com/);
  assert.doesNotMatch(serialized, /415 555 1234/);
});

test('setPersona persists confirmed persona and records persona_select event', () => {
  const { context, localStorage, sessionStorage } = createHarness();

  context.algoliaEngagementTracker.setPersona('developer');

  const profile = parse(localStorage, 'algolia_profile');
  const events = parse(sessionStorage, 'algolia_events').events;

  assert.deepEqual(profile.persona.value, 'developer');
  assert.equal(profile.persona.state, 'confirmed');
  assert.ok(events.some((event) => event.name === 'persona_select' && event.props.persona === 'developer'));
});

test('records concierge engagement history separately from raw events', () => {
  const { context, sessionStorage } = createHarness();

  context.algoliaEngagementTracker.recordEngagement({
    messageGoal: 'pricing_cost_help',
    status: 'shown_no_action',
  });

  const session = parse(sessionStorage, 'algolia_session');
  const events = parse(sessionStorage, 'algolia_events').events;

  assert.equal(session.engagementHistory.length, 1);
  assert.equal(session.engagementHistory[0].messageGoal, 'pricing_cost_help');
  assert.ok(events.some((event) => event.name === 'engagement_exposed'));
});

test('records lead form success without storing form values', () => {
  const { context, sessionStorage } = createHarness();

  context.document.dispatchDocumentEvent('algolia-chat:lead', {
    detail: {
      email: 'person@example.com',
      name: 'Someone',
      company: 'Example Inc.',
    },
  });

  const events = parse(sessionStorage, 'algolia_events').events;
  const success = events.find((event) => event.name === 'form_success');

  assert.equal(success.props.formId, 'lead_form');
  assert.equal(success.props.email, undefined);
  assert.equal(success.props.name, undefined);
  assert.equal(success.props.company, undefined);
});

test('bounds raw event buffer to 100 events', () => {
  const { context, sessionStorage } = createHarness();

  for (let i = 0; i < 150; i += 1) {
    context.algoliaEngagementTracker.track('cta_click', { label: `CTA ${i}` });
  }

  const events = parse(sessionStorage, 'algolia_events').events;
  assert.equal(events.length, 100);
  assert.equal(events.at(-1).props.label, 'CTA 149');
});

test('registers with existing chat widget visitor data source and legacy bridge', () => {
  const { context, chatElement } = createHarness();

  assert.equal(typeof context.algoliaTracker.snapshot, 'function');
  assert.ok(chatElement.source);
  assert.equal(chatElement.source.getProfile().schema, 'AlgoliaEngagementProfile.v1');
  assert.ok(Array.isArray(chatElement.source.getEvents()));
  assert.ok(Array.isArray(chatElement.source.getSessionPages()));
});
