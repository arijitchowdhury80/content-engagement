import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const trackerPath = new URL('../algolia-engagement-tracker.js', import.meta.url);

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

function createHarness({ pathname = '/pricing', search = '?utm_source=paid_search&email=nope@example.com', title = 'Pricing', pageMetadata = {}, initialLocal = {}, initialSession = {}, initialEvents = {}, resetOnLogo = false, initialNow = Date.now(), browserNavigationType = 'navigate' } = {}) {
  const listeners = new Map();
  const documentListeners = new Map();
  const documentDispatches = [];
  const logs = [];
  let entropyCounter = 0;
  let now = initialNow;
  const localStorage = new MemoryStorage(initialLocal);
  const sessionStorage = new MemoryStorage({
    ...initialSession,
    ...initialEvents,
  });
  const chatElement = {
    source: null,
    hasAttribute(name) {
      return name === 'reset-visitor-state-on-logo' && resetOnLogo;
    },
    setVisitorDataSource(source) {
      this.source = source;
    },
    dispatchEvent() {},
  };

  const location = {
    href: `https://www.algolia.com${pathname}${search}`,
    origin: 'https://www.algolia.com',
    pathname,
    search,
  };
  const context = {
    console: {
      ...console,
      log(...args) {
        logs.push(args);
      },
    },
    localStorage,
    sessionStorage,
    URL,
    URLSearchParams,
    Date: class extends Date {
      static now() {
        return now;
      }
    },
    setTimeout(fn) {
      return fn();
    },
    clearTimeout() {},
    CustomEvent: class CustomEvent {
      constructor(type, options = {}) {
        this.type = type;
        this.detail = options.detail;
        this.bubbles = options.bubbles ?? false;
        this.composed = options.composed ?? false;
      }
    },
    crypto: {
      getRandomValues(array) {
        entropyCounter += 1;
        for (let i = 0; i < array.length; i += 1) array[i] = i + entropyCounter;
        return array;
      },
    },
    location,
    history: {
      pushState(_state, _unused, nextUrl) {
        if (!nextUrl) return;
        const next = new URL(nextUrl, location.href);
        location.href = next.href;
        location.pathname = next.pathname;
        location.search = next.search;
      },
    },
    performance: {
      getEntriesByType(type) {
        return type === 'navigation' ? [{ type: browserNavigationType }] : [];
      },
    },
    addEventListener(name, handler) {
      listeners.set(name, handler);
    },
    dispatchWindowEvent(name, event) {
      listeners.get(name)?.(event);
    },
    document: {
      title,
      referrer: 'https://www.algolia.com/products/ai-search?token=secret',
      hidden: false,
      cookie: '',
      documentElement: { scrollHeight: 1000, dataset: {} },
      body: { scrollHeight: 1000, dataset: pageMetadata },
      querySelector(selector) {
        return selector === 'algolia-chat' ? chatElement : null;
      },
      addEventListener(name, handler) {
        documentListeners.set(name, handler);
      },
      dispatchEvent(event) {
        documentDispatches.push(event);
        documentListeners.get(event.type)?.(event);
        return true;
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

  return {
    context,
    localStorage,
    sessionStorage,
    chatElement,
    documentDispatches,
    logs,
    advanceTime(ms) {
      now += ms;
    },
  };
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

test('records the immediate source and destination edge for a normal navigation', () => {
  const now = 1_786_750_100_000;
  const { sessionStorage } = createHarness({
    pathname: '/pricing',
    search: '',
    initialNow: now,
    initialSession: {
      algolia_session: JSON.stringify({
        schema: 'AlgoliaEngagementSession.v1',
        sessionId: 'sess_123',
        startedAt: now - 10_000,
        lastSeenAt: now - 1_000,
        currentPageId: 'page_product',
        pages: [{ pageId: 'page_product', path: '/products/ai-search', title: 'AI Search', dwellMs: 3000, maxScrollDepth: 30, pageGroup: 'product', topic: 'ai_search' }],
        engagementHistory: [],
      }),
    },
  });
  const pages = parse(sessionStorage, 'algolia_session').pages;
  const current = pages.at(-1);

  assert.equal(current.navigationType, 'navigate');
  assert.equal(current.sourcePageId, 'page_product');
  assert.equal(current.sourcePath, '/products/ai-search');
  assert.equal(current.destinationPageId, current.pageId);
  assert.equal(current.destinationPath, '/pricing');
  assert.match(current.edgeId, /^page_product->page_/);
});

test('classifies SPA push, SPA pop, and persisted history restoration distinctly', () => {
  const { context, sessionStorage } = createHarness({ pathname: '/products/ai-search', search: '' });

  context.history.pushState({}, '', '/pricing');
  let current = parse(sessionStorage, 'algolia_session').pages.at(-1);
  assert.equal(current.navigationType, 'spa_push');
  assert.equal(current.sourcePath, '/products/ai-search');
  assert.equal(current.destinationPath, '/pricing');
  assert.equal(current.path, '/pricing');
  assert.match(current.edgeId, /^page_.*->page_/);

  context.dispatchWindowEvent('popstate');
  current = parse(sessionStorage, 'algolia_session').pages.at(-1);
  assert.equal(current.navigationType, 'spa_pop');

  context.dispatchWindowEvent('pageshow', { persisted: true });
  current = parse(sessionStorage, 'algolia_session').pages.at(-1);
  assert.equal(current.navigationType, 'back_forward');
});

test('emits the 30 percent scroll milestone required by proactive journeys', () => {
  const { context, sessionStorage } = createHarness({ pathname: '/products/ai-search', search: '' });

  context.document.documentElement.scrollHeight = 2000;
  context.document.body.scrollHeight = 2000;
  context.scrollY = 100;
  context.dispatchWindowEvent('scroll');

  const scrollEvents = parse(sessionStorage, 'algolia_events').events
    .filter((event) => event.name === 'scroll_depth');
  assert.equal(scrollEvents.length, 1);
  assert.equal(scrollEvents[0].props.depth, 30);
});

test('dwell accumulates visible time and excludes time while the page is hidden', () => {
  const { context, sessionStorage, advanceTime } = createHarness({
    pathname: '/products/ai-search',
    search: '',
    initialNow: 1_000_000,
  });

  advanceTime(3_000);
  context.document.hidden = true;
  context.document.dispatchDocumentEvent('visibilitychange');
  advanceTime(20_000);
  context.dispatchWindowEvent('beforeunload');

  let currentPage = parse(sessionStorage, 'algolia_session').pages[0];
  assert.equal(currentPage.dwellMs, 3_000);

  context.document.hidden = false;
  context.document.dispatchDocumentEvent('visibilitychange');
  advanceTime(7_000);
  context.dispatchWindowEvent('pagehide');

  currentPage = parse(sessionStorage, 'algolia_session').pages[0];
  assert.equal(currentPage.dwellMs, 10_000);
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

test('emits an in-page engagement signal whenever activity is tracked', () => {
  const { context, documentDispatches } = createHarness();

  context.algoliaEngagementTracker.track('nav_click', { label: 'Products' });

  const signals = documentDispatches.filter(
    (event) => event.type === 'algolia-engagement-signal'
  );
  assert.ok(signals.length >= 1, 'expected at least one engagement signal');
  assert.equal(signals.at(-1).detail.name, 'nav_click');
  assert.equal(signals.at(-1).detail.path, '/pricing');
});

test('classifies product feature focus on page views and events', () => {
  const { sessionStorage } = createHarness({
    pathname: '/products/features/personalization',
    search: '',
    title: 'Search Personalization',
  });

  const session = parse(sessionStorage, 'algolia_session');
  const events = parse(sessionStorage, 'algolia_events').events;
  const pageView = events.find((event) => event.name === 'page_view');

  assert.equal(session.pages[0].pageGroup, 'product');
  assert.equal(session.pages[0].topic, 'ai_search');
  assert.equal(session.pages[0].productFocus, 'personalization');
  assert.equal(session.pages[0].productFocusLabel, 'Personalization');
  assert.equal(pageView.props.productFocus, 'personalization');
  assert.equal(pageView.props.productFocusLabel, 'Personalization');
});

test('explicit page metadata takes precedence over an ambiguous rendered URL', () => {
  const { sessionStorage } = createHarness({
    pathname: '/cms/render/default/en/sites/www/home/content/commerce',
    search: '',
    title: 'Commerce experiences',
    pageMetadata: {
      algoliaPageGroup: 'solution',
      algoliaTopic: 'commerce',
      algoliaSolutionFocus: 'commerce',
      algoliaSolutionFocusLabel: 'Commerce',
    },
  });

  const page = parse(sessionStorage, 'algolia_session').pages[0];
  assert.equal(page.pageGroup, 'solution');
  assert.equal(page.topic, 'commerce');
  assert.equal(page.solutionFocus, 'commerce');
  assert.equal(page.solutionFocusLabel, 'Commerce');
});

test('classifies solution focus on page views and events', () => {
  const { sessionStorage } = createHarness({
    pathname: '/solutions/ecommerce',
    search: '',
    title: 'Ecommerce Site Search Solutions',
  });

  const session = parse(sessionStorage, 'algolia_session');
  const events = parse(sessionStorage, 'algolia_events').events;
  const pageView = events.find((event) => event.name === 'page_view');

  assert.equal(session.pages[0].pageGroup, 'solution');
  assert.equal(session.pages[0].topic, 'commerce');
  assert.equal(session.pages[0].solutionFocus, 'commerce');
  assert.equal(session.pages[0].solutionFocusLabel, 'Commerce');
  assert.equal(pageView.props.solutionFocus, 'commerce');
  assert.equal(pageView.props.solutionFocusLabel, 'Commerce');
});

test('classifies use-case pages as solutions for commercial journeys', () => {
  const { sessionStorage } = createHarness({
    pathname: '/use-cases/enterprise',
    search: '',
    title: 'Enterprise Search',
  });

  const session = parse(sessionStorage, 'algolia_session');
  const pageView = parse(sessionStorage, 'algolia_events').events.find((event) => event.name === 'page_view');

  assert.equal(session.pages[0].pageGroup, 'solution');
  assert.equal(session.pages[0].topic, 'industry_solution');
  assert.equal(session.pages[0].solutionFocus, 'enterprise');
  assert.equal(session.pages[0].solutionFocusLabel, 'Enterprise');
  assert.equal(pageView.props.pageGroup, 'solution');
  assert.equal(pageView.props.topic, 'industry_solution');
});

test('algoliaProactiveReset clears all Algolia session and chat state while preserving profile and unrelated storage', () => {
  const { localStorage, sessionStorage } = createHarness({
    pathname: '/products/features/personalization',
    search: '?algoliaProactiveReset=1',
    initialLocal: {
      algolia_profile: JSON.stringify({
        schema: 'AlgoliaEngagementProfile.v1',
        visitorId: 'visitor_keep',
        persona: { value: 'developer', state: 'confirmed' },
      }),
      jahia_editor_preference: 'keep-me',
    },
    initialSession: {
      algolia_session: JSON.stringify({ schema: 'AlgoliaEngagementSession.v1', sessionId: 'old', pages: [{ path: '/pricing' }] }),
      algolia_events: JSON.stringify({ schema: 'AlgoliaEngagementEvents.v1', sessionId: 'old', events: [{ name: 'chat_open' }] }),
      algolia_proactive_state: JSON.stringify({ opportunities: [{ id: 'old_opp' }] }),
      algolia_pending_greeting: JSON.stringify({ opportunityId: 'old_opp' }),
      algolia_proactive_debug_log: JSON.stringify([{ stage: 'old' }]),
      algolia_context_validation_error: JSON.stringify({ field: 'journey_summary' }),
      'algolia-chat:conversation': JSON.stringify({ version: 1, conversationId: 'old_chat', turns: [{ id: 'turn_1' }] }),
      'algolia-chat:conversation-ui': JSON.stringify({ open: true, mode: 'docked' }),
      'algolia-chat:handoff-context': JSON.stringify({ schema: 'ProactiveHandoffContext.v1', opportunityId: 'old_opp' }),
      algolia_token: 'old_token',
      jahia_route_state: 'keep-me-too',
    },
  });

  assert.equal(parse(localStorage, 'algolia_profile').visitorId, 'visitor_keep');
  assert.equal(parse(localStorage, 'algolia_profile').persona.value, 'developer');
  assert.equal(localStorage.getItem('jahia_editor_preference'), 'keep-me');
  assert.equal(sessionStorage.getItem('jahia_route_state'), 'keep-me-too');
  assert.notEqual(parse(sessionStorage, 'algolia_session').sessionId, 'old');
  assert.equal(parse(sessionStorage, 'algolia_events').events.some((event) => event.name === 'chat_open'), false);
  assert.equal(sessionStorage.getItem('algolia_proactive_state'), null);
  assert.equal(sessionStorage.getItem('algolia_pending_greeting'), null);
  assert.equal(sessionStorage.getItem('algolia_proactive_debug_log'), null);
  assert.equal(sessionStorage.getItem('algolia_context_validation_error'), null);
  assert.equal(sessionStorage.getItem('algolia-chat:conversation'), null);
  assert.equal(sessionStorage.getItem('algolia-chat:conversation-ui'), null);
  assert.equal(sessionStorage.getItem('algolia-chat:handoff-context'), null);
  assert.equal(sessionStorage.getItem('algolia_token'), null);
});

test('reset clears only Algolia visitor state and starts a fresh tracked session', () => {
  const { context, localStorage, sessionStorage } = createHarness({
    initialLocal: {
      algolia_profile: JSON.stringify({ visitorId: 'old_visitor' }),
      acs_profile: JSON.stringify({ visitorId: 'legacy_visitor' }),
      acs_session: JSON.stringify({ sessionId: 'legacy_session' }),
      acs_events: JSON.stringify([{ name: 'legacy_click' }]),
      acs_pending_greeting: JSON.stringify({ opportunityId: 'legacy_opp' }),
      acs_user_token: 'legacy_user_token',
      jahia_editor_preference: 'keep-me',
    },
    initialSession: {
      algolia_session: JSON.stringify({ sessionId: 'old_session' }),
      algolia_proactive_state: JSON.stringify({ opportunities: [{ id: 'old_opp' }] }),
      algolia_pending_greeting: JSON.stringify({ opportunityId: 'old_opp' }),
      algolia_proactive_debug_log: JSON.stringify([{ stage: 'old' }]),
      'algolia-chat:conversation': JSON.stringify({ version: 1, conversationId: 'old_chat', turns: [{ id: 'turn_1' }] }),
      'algolia-chat:conversation-ui': JSON.stringify({ open: true, mode: 'docked' }),
      'algolia-chat:handoff-context': JSON.stringify({ schema: 'ProactiveHandoffContext.v1', opportunityId: 'old_opp' }),
      algolia_token: 'old_token',
      acs_token: 'legacy_token',
      jahia_route_state: 'keep-me-too',
    },
    initialEvents: {
      algolia_events: JSON.stringify({ sessionId: 'old_session', events: [{ name: 'chat_open' }] }),
    },
  });

  context.algoliaEngagementTracker.reset();

  assert.equal(localStorage.getItem('jahia_editor_preference'), 'keep-me');
  assert.equal(sessionStorage.getItem('jahia_route_state'), 'keep-me-too');
  assert.notEqual(parse(localStorage, 'algolia_profile').visitorId, 'old_visitor');
  assert.notEqual(parse(sessionStorage, 'algolia_session').sessionId, 'old_session');
  assert.equal(parse(sessionStorage, 'algolia_events').events[0].name, 'page_view');
  assert.equal(sessionStorage.getItem('algolia_proactive_state'), null);
  assert.equal(sessionStorage.getItem('algolia_pending_greeting'), null);
  assert.equal(sessionStorage.getItem('algolia_proactive_debug_log'), null);
  assert.equal(sessionStorage.getItem('algolia-chat:conversation'), null);
  assert.equal(sessionStorage.getItem('algolia-chat:conversation-ui'), null);
  assert.equal(sessionStorage.getItem('algolia-chat:handoff-context'), null);
  assert.notEqual(sessionStorage.getItem('algolia_token'), 'old_token');
  assert.equal(localStorage.getItem('acs_profile'), null);
  assert.equal(localStorage.getItem('acs_session'), null);
  assert.equal(localStorage.getItem('acs_events'), null);
  assert.equal(localStorage.getItem('acs_pending_greeting'), null);
  assert.equal(localStorage.getItem('acs_user_token'), null);
  assert.equal(sessionStorage.getItem('acs_token'), null);
});

test('configured Assistant logo reset spins and produces one reset receipt', () => {
  const { context, sessionStorage, documentDispatches } = createHarness({
    resetOnLogo: true,
    initialSession: {
      algolia_proactive_state: JSON.stringify({ opportunities: [{ id: 'old_opp' }] }),
    },
  });
  const animations = [];
  const logo = {
    animate(frames, options) {
      animations.push({ target: 'logo', frames, options });
    },
  };
  const resetButton = {
    getAttribute(name) {
      return name === 'aria-label' ? 'Algolia - reset conversation' : null;
    },
    querySelector(selector) {
      return selector.includes('img') ? logo : null;
    },
    animate(frames, options) {
      animations.push({ target: 'button', frames, options });
    },
  };

  context.document.dispatchDocumentEvent('click', {
    composedPath() {
      return [resetButton];
    },
  });

  assert.equal(sessionStorage.getItem('algolia_proactive_state'), null);
  assert.equal(animations.length, 1);
  assert.equal(animations[0].target, 'logo');
  assert.equal(animations[0].frames.at(-1).transform, 'rotate(360deg)');
  assert.equal(context.__algoliaVisitorResetReceipt.schema, 'AlgoliaVisitorResetReceipt.v1');
  assert.equal(context.__algoliaVisitorResetReceipt.source, 'assistant_logo');
  assert.equal(context.__algoliaVisitorResetReceipt.pageCount, 1);
  assert.equal(context.__algoliaVisitorResetReceipt.eventCount, 1);
  assert.equal(context.__algoliaVisitorResetReceipt.conversationCleared, true);
  assert.equal(context.__algoliaVisitorResetReceipt.handoffContextCleared, true);
  assert.equal(
    documentDispatches.filter((event) => event.type === 'algolia-visitor-state-reset').length,
    1,
  );
});

test('one logo click followed by the widget reset request creates only one fresh session', () => {
  const now = 1_786_750_100_000;
  const { context, sessionStorage, documentDispatches } = createHarness({
    resetOnLogo: true,
    initialNow: now,
    initialSession: {
      'algolia-chat:conversation': JSON.stringify({ conversationId: 'old_chat', turns: [{ id: 'turn_1' }] }),
    },
  });
  const resetButton = {
    getAttribute(name) {
      return name === 'aria-label' ? 'Algolia - reset conversation' : null;
    },
    querySelector() {
      return { animate() {} };
    },
  };

  context.document.dispatchDocumentEvent('click', {
    composedPath() {
      return [resetButton];
    },
  });
  const firstReceipt = context.__algoliaVisitorResetReceipt;
  const firstSessionId = parse(sessionStorage, 'algolia_session').sessionId;

  context.document.dispatchEvent(new context.CustomEvent('algolia-visitor-reset-requested', {
    detail: { source: 'chat_widget' },
    bubbles: true,
    composed: true,
  }));

  assert.equal(context.__algoliaVisitorResetReceipt.resetId, firstReceipt.resetId);
  assert.equal(parse(sessionStorage, 'algolia_session').sessionId, firstSessionId);
  assert.equal(
    documentDispatches.filter((event) => event.type === 'algolia-visitor-state-reset').length,
    1,
  );
});

test('bubbling composed visitor reset request invokes the full tracker reset', () => {
  const { context, localStorage, sessionStorage } = createHarness({
    initialLocal: {
      algolia_profile: JSON.stringify({ visitorId: 'old_visitor' }),
      jahia_editor_preference: 'keep-me',
    },
    initialSession: {
      algolia_proactive_state: JSON.stringify({ opportunities: [{ id: 'old_opp' }] }),
      algolia_pending_greeting: JSON.stringify({ opportunityId: 'old_opp' }),
      algolia_proactive_debug_log: JSON.stringify([{ stage: 'old' }]),
      'algolia-chat:conversation': JSON.stringify({ version: 1, conversationId: 'old_chat', turns: [{ id: 'turn_1' }] }),
      'algolia-chat:conversation-ui': JSON.stringify({ open: true, mode: 'docked' }),
      'algolia-chat:handoff-context': JSON.stringify({ schema: 'ProactiveHandoffContext.v1', opportunityId: 'old_opp' }),
      jahia_route_state: 'keep-me-too',
    },
  });
  const resetRequest = new context.CustomEvent('algolia-visitor-reset-requested', {
    bubbles: true,
    composed: true,
    detail: { source: 'assistant_logo' },
  });

  context.document.dispatchEvent(resetRequest);

  assert.equal(resetRequest.bubbles, true);
  assert.equal(resetRequest.composed, true);
  assert.notEqual(parse(localStorage, 'algolia_profile').visitorId, 'old_visitor');
  assert.equal(localStorage.getItem('jahia_editor_preference'), 'keep-me');
  assert.equal(sessionStorage.getItem('jahia_route_state'), 'keep-me-too');
  assert.equal(sessionStorage.getItem('algolia_proactive_state'), null);
  assert.equal(sessionStorage.getItem('algolia_pending_greeting'), null);
  assert.equal(sessionStorage.getItem('algolia_proactive_debug_log'), null);
  assert.equal(sessionStorage.getItem('algolia-chat:conversation'), null);
  assert.equal(sessionStorage.getItem('algolia-chat:conversation-ui'), null);
  assert.equal(sessionStorage.getItem('algolia-chat:handoff-context'), null);
  assert.equal(parse(sessionStorage, 'algolia_events').events[0].name, 'page_view');
});

test('engagement debug can be enabled persistently from localStorage without URL flags', () => {
  const { context, logs } = createHarness({
    search: '',
    initialLocal: { algoliaDebug: '1' },
  });

  context.algoliaEngagementTracker.configure({ maxEvents: 12 });

  assert.ok(logs.some((args) => args[0] === '[Algolia Engagement Tracker]' && args[1] === 'configured'));
});
