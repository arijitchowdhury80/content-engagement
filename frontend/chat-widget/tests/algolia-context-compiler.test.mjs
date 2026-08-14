import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const compilerPath = new URL('../algolia-context-compiler.js', import.meta.url);

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

function createHarness({ profile, session, events, locationPath = '/products/ai-recommendations' } = {}) {
  const localStorage = new MemoryStorage({
    algolia_profile: JSON.stringify(profile ?? {
      schema: 'AlgoliaEngagementProfile.v1',
      visitorId: 'visitor_123',
      userToken: 'tok_123',
      persona: { value: 'developer', state: 'confirmed', source: 'demo_selector' },
      visits: 2,
    }),
  });
  const sessionStorage = new MemoryStorage({
    algolia_session: JSON.stringify(session ?? {
      schema: 'AlgoliaEngagementSession.v1',
      sessionId: 'sess_123',
      startedAt: 1786750000000,
      currentPageId: 'page_current',
      pages: [
        {
          pageId: 'page_old',
          path: '/pricing',
          title: 'Pricing',
          enteredAt: 1786750000000,
          dwellMs: 30000,
          maxScrollDepth: 75,
          pageGroup: 'pricing',
          topic: 'pricing_and_usage',
        },
        {
          pageId: 'page_current',
          path: locationPath,
          title: 'AI Recommendations',
          enteredAt: 1786750060000,
          dwellMs: 10000,
          maxScrollDepth: 50,
          pageGroup: 'product',
          topic: 'ai_search',
        },
      ],
      engagementHistory: [
        {
          id: 'eng_1',
          messageGoal: 'pricing_cost_help',
          shownAt: 1786750005000,
          status: 'shown_no_action',
        },
      ],
    }),
    algolia_events: JSON.stringify(events ?? {
      schema: 'AlgoliaEngagementEvents.v1',
      sessionId: 'sess_123',
      events: [
        {
          eventId: 'evt_1',
          name: 'page_view',
          ts: 1786750000000,
          pageId: 'page_old',
          path: '/pricing',
          source: 'observed',
          props: { pageGroup: 'pricing', topic: 'pricing_and_usage' },
        },
        {
          eventId: 'evt_2',
          name: 'nav_click',
          ts: 1786750061000,
          pageId: 'page_current',
          path: locationPath,
          source: 'observed',
          props: { label: 'Products', href: `https://www.algolia.com${locationPath}` },
        },
        {
          eventId: 'evt_3',
          name: 'site_search',
          ts: 1786750062000,
          pageId: 'page_current',
          path: locationPath,
          source: 'observed',
          props: { query: 'recommendations pricing person@example.com' },
        },
      ],
    }),
  });

  const context = {
    console,
    localStorage,
    sessionStorage,
    URL,
    URLSearchParams,
    TextEncoder,
    location: {
      href: `https://www.algolia.com${locationPath}`,
      origin: 'https://www.algolia.com',
      pathname: locationPath,
      search: '',
    },
    document: { title: 'AI Recommendations' },
    fetch: async (url, options) => ({
      ok: true,
      url,
      options,
      body: null,
      text: async () => '',
    }),
  };
  context.window = context;

  vm.createContext(context);
  vm.runInContext(fs.readFileSync(compilerPath, 'utf8'), context);

  return { context, localStorage, sessionStorage };
}

function byteLength(value) {
  return new TextEncoder().encode(value).length;
}

test('compiles rich context from tracker state without downgrading confirmed persona', () => {
  const { context } = createHarness();

  const packet = context.algoliaContextCompiler.compile();

  assert.equal(packet.schema, 'AlgoliaContextPacket.v1');
  assert.equal(packet.profile.persona.value, 'developer');
  assert.equal(packet.profile.persona.state, 'confirmed');
  assert.equal(packet.currentPage.path, '/products/ai-recommendations');
  assert.equal(packet.observedSignals.currentTopic.value, 'ai_search');
  assert.equal(packet.observedSignals.currentTopic.state, 'observed');
  assert.ok(packet.recentEvents.some((event) => event.name === 'nav_click'));
});

test('infers intent, friction, and persona softly with confidence and evidence', () => {
  const { context } = createHarness();

  const packet = context.algoliaContextCompiler.compile();

  assert.equal(packet.inferences.intent.state, 'inferred');
  assert.equal(packet.inferences.intent.value, 'ai_recommendations_evaluation');
  assert.ok(packet.inferences.intent.confidence > 0.5);
  assert.match(packet.inferences.intent.evidence.join(' '), /AI Recommendations|site_search/);
  assert.equal(packet.inferences.friction.value, 'pricing_or_cost_unclear');
  assert.equal(packet.inferences.persona.value, 'developer');
});

test('does not include hover events or raw PII in compiled context', () => {
  const { context } = createHarness({
    events: {
      schema: 'AlgoliaEngagementEvents.v1',
      sessionId: 'sess_123',
      events: [
        {
          eventId: 'evt_hover',
          name: 'nav_hover',
          ts: 1786750061000,
          pageId: 'page_current',
          path: '/products/ai-recommendations',
          source: 'observed',
          props: { label: 'AI Recommendations', email: 'person@example.com' },
        },
        {
          eventId: 'evt_click',
          name: 'cta_click',
          ts: 1786750062000,
          pageId: 'page_current',
          path: '/products/ai-recommendations',
          source: 'observed',
          props: { label: 'Book a demo', href: 'https://www.algolia.com/contact-sales' },
        },
      ],
    },
  });

  const serialized = JSON.stringify(context.algoliaContextCompiler.compile());

  assert.doesNotMatch(serialized, /nav_hover/);
  assert.doesNotMatch(serialized, /person@example.com/);
  assert.match(serialized, /cta_click/);
});

test('returns flat Agent Studio turn context within documented limits', () => {
  const { context } = createHarness();

  const turnContext = context.algoliaContextCompiler.compileTurnContext();
  const entries = Object.entries(turnContext);
  const serialized = JSON.stringify(turnContext);

  assert.ok(entries.length > 0);
  assert.ok(entries.length <= 32);
  assert.ok(byteLength(serialized) <= 4096);

  for (const [key, value] of entries) {
    assert.match(key, /^[a-zA-Z0-9_.-]{1,64}$/);
    assert.equal(typeof value, 'string');
    assert.notEqual(value, '');
    assert.ok(byteLength(value) <= 1024);
  }

  assert.equal(turnContext.persona, 'confirmed:developer');
  assert.equal(turnContext.current_topic, 'observed:ai_search');
  assert.match(turnContext.intent, /^inferred:ai_recommendations_evaluation:/);
  assert.doesNotMatch(serialized, /person@example.com/);
});

test('weights recent events above older pages when choosing next useful context', () => {
  const { context } = createHarness({
    events: {
      schema: 'AlgoliaEngagementEvents.v1',
      sessionId: 'sess_123',
      events: [
        {
          eventId: 'evt_old',
          name: 'page_view',
          ts: 1786750000000,
          pageId: 'page_old',
          path: '/developers',
          source: 'observed',
          props: { pageGroup: 'developer', topic: 'implementation' },
        },
        {
          eventId: 'evt_recent',
          name: 'cta_click',
          ts: 1786750200000,
          pageId: 'page_current',
          path: '/pricing',
          source: 'observed',
          props: { label: 'Contact sales', href: 'https://www.algolia.com/contact-sales' },
        },
      ],
    },
    locationPath: '/pricing',
  });

  const packet = context.algoliaContextCompiler.compile();

  assert.equal(packet.inferences.intent.value, 'pricing_or_demo_evaluation');
  assert.equal(packet.inferences.nextBestAction.value, 'answer_cost_or_route_to_demo');
});

test('injects turnContext into Agent Studio AI SDK v5 user message metadata', async () => {
  const calls = [];
  const { context } = createHarness();
  context.fetch = async (url, options = {}) => {
    calls.push({ url, options });
    return { ok: true, body: null, text: async () => '' };
  };

  context.algoliaContextCompiler.installFetchInterceptor();

  await context.fetch('https://0EXRPAXB56.algolia.net/agent-studio/1/agents/agent/completions?compatibilityMode=ai-sdk-5', {
    method: 'POST',
    body: JSON.stringify({
      messages: [
        { role: 'user', parts: [{ type: 'text', text: 'How hard is implementation?' }] },
      ],
    }),
  });

  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.messages[0].metadata.turnContext.persona, 'confirmed:developer');
  assert.equal(body.messages[0].metadata.turnContext.current_topic, 'observed:ai_search');
});

test('debug returns raw tracker state, rich packet, and flat turnContext', () => {
  const { context } = createHarness();

  const debug = context.algoliaContextCompiler.debug();

  assert.equal(debug.raw.profile.schema, 'AlgoliaEngagementProfile.v1');
  assert.equal(debug.compiled.schema, 'AlgoliaContextPacket.v1');
  assert.equal(debug.turnContext.persona, 'confirmed:developer');
});
