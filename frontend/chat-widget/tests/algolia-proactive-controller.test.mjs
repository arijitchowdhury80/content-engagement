import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const compilerPath = new URL('../algolia-context-compiler.js', import.meta.url);
const controllerPath = new URL('../algolia-proactive-controller.js', import.meta.url);

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

function page({
  pageId,
  path,
  pageGroup,
  topic,
  dwellMs = 0,
  maxScrollDepth = 0,
  enteredAt = 1786750000000,
}) {
  return {
    pageId,
    path,
    title: `${pageGroup} ${topic}`,
    pageGroup,
    topic,
    dwellMs,
    maxScrollDepth,
    enteredAt,
  };
}

function event({
  eventId,
  name,
  path,
  pageId = 'page_current',
  ts = 1786750000000,
  props = {},
}) {
  return {
    eventId,
    name,
    ts,
    pageId,
    path,
    source: 'observed',
    props,
  };
}

function createHarness({
  profile = {},
  pages,
  events,
  currentPageId = 'page_current',
  locationPath,
  state,
} = {}) {
  const currentPath = locationPath || pages?.at(-1)?.path || '/products/ai-recommendations';
  const localStorage = new MemoryStorage({
    algolia_profile: JSON.stringify({
      schema: 'AlgoliaEngagementProfile.v1',
      visitorId: 'visitor_123',
      persona: null,
      ...profile,
    }),
  });
  const sessionStorage = new MemoryStorage({
    algolia_session: JSON.stringify({
      schema: 'AlgoliaEngagementSession.v1',
      sessionId: 'sess_123',
      startedAt: 1786750000000,
      currentPageId,
      pages: pages || [
        page({
          pageId: 'page_current',
          path: currentPath,
          pageGroup: 'product',
          topic: 'ai_search',
          dwellMs: 10000,
        }),
      ],
      engagementHistory: [],
    }),
    algolia_events: JSON.stringify({
      schema: 'AlgoliaEngagementEvents.v1',
      sessionId: 'sess_123',
      events: events || [
        event({
          eventId: 'evt_page',
          name: 'page_view',
          path: currentPath,
          props: { pageGroup: 'product', topic: 'ai_search' },
        }),
      ],
    }),
    ...(state ? { algolia_proactive_state: JSON.stringify(state) } : {}),
  });
  const documentListeners = new Map();
  const documentEvents = [];
  const context = {
    console,
    localStorage,
    sessionStorage,
    URL,
    URLSearchParams,
    TextEncoder,
    setTimeout(fn) {
      return fn();
    },
    clearTimeout() {},
    location: {
      href: `https://www.algolia.com${currentPath}`,
      origin: 'https://www.algolia.com',
      pathname: currentPath,
      search: '',
    },
    CustomEvent: class CustomEvent {
      constructor(type, options = {}) {
        this.type = type;
        this.detail = options.detail;
      }
    },
    document: {
      hidden: false,
      title: pages?.at(-1)?.title || 'AI Recommendations',
      querySelector(selector) {
        if (selector === 'algolia-chat') return { autoEngage: true };
        return null;
      },
      addEventListener(type, handler) {
        documentListeners.set(type, handler);
      },
      dispatchEvent(evt) {
        documentEvents.push(evt);
        documentListeners.get(evt.type)?.(evt);
        return true;
      },
    },
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(compilerPath, 'utf8'), context);
  vm.runInContext(fs.readFileSync(controllerPath, 'utf8'), context);
  return { context, localStorage, sessionStorage, documentEvents };
}

function opportunity(context) {
  return context.algoliaProactiveController.evaluate();
}

test('product research triggers on product page dwell after 10 seconds', () => {
  const { context } = createHarness({
    pages: [
      page({
        pageId: 'page_current',
        path: '/products/ai-recommendations',
        pageGroup: 'product',
        topic: 'ai_search',
        dwellMs: 10000,
      }),
    ],
  });

  const decision = opportunity(context);

  assert.equal(decision.engage, true);
  assert.equal(decision.moment, 'product_research');
  assert.equal(decision.trigger, 'product_page_10s_dwell');
  assert.equal(decision.messageGoal, 'explain_product_fit');
  assert.ok(decision.priority >= 60);
  assert.ok(decision.reasonCodes.includes('product_page'));
  assert.equal(decision.agentPromptPacket.currentPage.path, '/products/ai-recommendations');
});

test('implementation research triggers on developer page dwell or scroll', () => {
  const { context } = createHarness({
    locationPath: '/developers',
    pages: [
      page({
        pageId: 'page_current',
        path: '/developers',
        pageGroup: 'developer',
        topic: 'implementation',
        dwellMs: 15000,
      }),
    ],
  });

  const decision = opportunity(context);

  assert.equal(decision.engage, true);
  assert.equal(decision.moment, 'implementation_research');
  assert.equal(decision.trigger, 'developer_page_15s_dwell');
  assert.equal(decision.messageGoal, 'reduce_implementation_uncertainty');
});

test('commercial evaluation wins when journey moves from product to pricing', () => {
  const { context } = createHarness({
    locationPath: '/pricing',
    pages: [
      page({
        pageId: 'page_product',
        path: '/products/ai-recommendations',
        pageGroup: 'product',
        topic: 'ai_search',
        dwellMs: 12000,
      }),
      page({
        pageId: 'page_current',
        path: '/pricing',
        pageGroup: 'pricing',
        topic: 'pricing_and_usage',
        dwellMs: 1000,
      }),
    ],
    events: [
      event({ eventId: 'evt_1', name: 'page_view', path: '/products/ai-recommendations', pageId: 'page_product' }),
      event({ eventId: 'evt_2', name: 'page_view', path: '/pricing', ts: 1786750060000 }),
    ],
  });

  const decision = opportunity(context);

  assert.equal(decision.engage, true);
  assert.equal(decision.moment, 'commercial_evaluation');
  assert.equal(decision.trigger, 'product_to_pricing');
  assert.equal(decision.messageGoal, 'explain_cost_drivers');
  assert.ok(decision.priority > 80);
  assert.ok(decision.reasonCodes.includes('journey_product_to_pricing'));
});

test('customer proof triggers from product research into customer story', () => {
  const { context } = createHarness({
    locationPath: '/customers/gymshark-recommend',
    pages: [
      page({
        pageId: 'page_product',
        path: '/products/ai-recommendations',
        pageGroup: 'product',
        topic: 'ai_search',
        dwellMs: 12000,
      }),
      page({
        pageId: 'page_current',
        path: '/customers/gymshark-recommend',
        pageGroup: 'customer_story',
        topic: 'customer_proof',
        dwellMs: 12000,
      }),
    ],
  });

  const decision = opportunity(context);

  assert.equal(decision.engage, true);
  assert.equal(decision.moment, 'customer_proof');
  assert.equal(decision.trigger, 'product_to_customer_story');
  assert.equal(decision.messageGoal, 'surface_relevant_customer_proof');
});

test('site search followed by docs creates implementation journey trigger', () => {
  const { context } = createHarness({
    locationPath: '/doc/guides/building-search-ui/what-is-instantsearch/js/',
    pages: [
      page({
        pageId: 'page_search',
        path: '/search',
        pageGroup: 'resource',
        topic: 'education',
      }),
      page({
        pageId: 'page_current',
        path: '/doc/guides/building-search-ui/what-is-instantsearch/js/',
        pageGroup: 'documentation',
        topic: 'instantsearch_implementation',
        dwellMs: 2000,
      }),
    ],
    events: [
      event({
        eventId: 'evt_search',
        name: 'site_search',
        path: '/search',
        pageId: 'page_search',
        props: { query: 'react instantsearch implementation' },
      }),
      event({
        eventId: 'evt_docs',
        name: 'page_view',
        path: '/doc/guides/building-search-ui/what-is-instantsearch/js/',
        ts: 1786750030000,
      }),
    ],
  });

  const decision = opportunity(context);

  assert.equal(decision.engage, true);
  assert.equal(decision.moment, 'implementation_research');
  assert.equal(decision.trigger, 'search_to_docs');
  assert.ok(decision.reasonCodes.includes('site_search_implementation_terms'));
});

test('hover-only activity never creates a proactive opportunity', () => {
  const { context } = createHarness({
    pages: [
      page({
        pageId: 'page_current',
        path: '/products/ai-recommendations',
        pageGroup: 'product',
        topic: 'ai_search',
        dwellMs: 0,
        maxScrollDepth: 0,
      }),
    ],
    events: [
      event({
        eventId: 'evt_hover',
        name: 'nav_hover',
        path: '/products/ai-recommendations',
        props: { label: 'Products' },
      }),
    ],
  });

  const decision = opportunity(context);

  assert.equal(decision.engage, false);
  assert.equal(decision.reason, 'no_trigger_match');
});

test('emits one opportunity per page and moment from engagement signals', () => {
  const { context, documentEvents, sessionStorage } = createHarness({
    pages: [
      page({
        pageId: 'page_current',
        path: '/products/ai-recommendations',
        pageGroup: 'product',
        topic: 'ai_search',
        maxScrollDepth: 50,
      }),
    ],
    events: [
      event({ eventId: 'evt_page', name: 'page_view', path: '/products/ai-recommendations' }),
      event({ eventId: 'evt_scroll', name: 'scroll_depth', path: '/products/ai-recommendations', props: { depth: 50 } }),
    ],
  });

  context.document.dispatchEvent(
    new context.CustomEvent('algolia-engagement-signal', {
      detail: { name: 'scroll_depth', path: '/products/ai-recommendations' },
    })
  );
  context.document.dispatchEvent(
    new context.CustomEvent('algolia-engagement-signal', {
      detail: { name: 'scroll_depth', path: '/products/ai-recommendations' },
    })
  );

  const opportunities = documentEvents.filter((evt) => evt.type === 'algolia-proactive-opportunity');
  const state = JSON.parse(sessionStorage.getItem('algolia_proactive_state'));

  assert.equal(opportunities.length, 1);
  assert.equal(opportunities[0].detail.moment, 'product_research');
  assert.equal(state.opportunities.length, 1);
  assert.equal(state.opportunities[0].status, 'eligible');
});

test('trigger grammar covers implemented journey, dwell, scroll, and priority permutations', () => {
  const cases = [
    {
      name: 'product_to_pricing',
      locationPath: '/pricing',
      pages: [
        page({ pageId: 'page_product', path: '/products/ai-recommendations', pageGroup: 'product', topic: 'ai_search', dwellMs: 12000 }),
        page({ pageId: 'page_current', path: '/pricing', pageGroup: 'pricing', topic: 'pricing_and_usage', dwellMs: 1000 }),
      ],
      expected: 'product_to_pricing',
    },
    {
      name: 'implementation_to_pricing',
      locationPath: '/pricing',
      pages: [
        page({ pageId: 'page_docs', path: '/doc/guides/building-search-ui/what-is-instantsearch/js/', pageGroup: 'documentation', topic: 'implementation', dwellMs: 18000 }),
        page({ pageId: 'page_current', path: '/pricing', pageGroup: 'pricing', topic: 'pricing_and_usage', dwellMs: 1000 }),
      ],
      expected: 'implementation_to_pricing',
    },
    {
      name: 'pricing_to_implementation',
      locationPath: '/developers',
      pages: [
        page({ pageId: 'page_pricing', path: '/pricing', pageGroup: 'pricing', topic: 'pricing_and_usage', dwellMs: 10000 }),
        page({ pageId: 'page_current', path: '/developers', pageGroup: 'developer', topic: 'implementation', dwellMs: 2000 }),
      ],
      expected: 'pricing_to_implementation',
    },
    {
      name: 'product_to_customer_story',
      locationPath: '/customers/lacoste',
      pages: [
        page({ pageId: 'page_product', path: '/products/ai-recommendations', pageGroup: 'product', topic: 'ai_search', dwellMs: 12000 }),
        page({ pageId: 'page_current', path: '/customers/lacoste', pageGroup: 'customer_story', topic: 'customer_proof', dwellMs: 2000 }),
      ],
      expected: 'product_to_customer_story',
    },
    {
      name: 'search_to_docs',
      locationPath: '/doc/guides/building-search-ui/what-is-instantsearch/js/',
      pages: [
        page({ pageId: 'page_search', path: '/search', pageGroup: 'search', topic: 'site_search', dwellMs: 5000 }),
        page({ pageId: 'page_current', path: '/doc/guides/building-search-ui/what-is-instantsearch/js/', pageGroup: 'documentation', topic: 'implementation', dwellMs: 1000 }),
      ],
      events: [
        event({ eventId: 'evt_search', name: 'site_search', path: '/search', pageId: 'page_search', props: { query: 'react instantsearch implementation' } }),
        event({ eventId: 'evt_docs', name: 'page_view', path: '/doc/guides/building-search-ui/what-is-instantsearch/js/' }),
      ],
      expected: 'search_to_docs',
    },
    {
      name: 'pricing_8s_dwell',
      locationPath: '/pricing',
      pages: [page({ pageId: 'page_current', path: '/pricing', pageGroup: 'pricing', topic: 'pricing_and_usage', dwellMs: 8000 })],
      expected: 'pricing_8s_dwell',
    },
    {
      name: 'developer_page_15s_dwell',
      locationPath: '/developers',
      pages: [page({ pageId: 'page_current', path: '/developers', pageGroup: 'developer', topic: 'implementation', dwellMs: 15000 })],
      expected: 'developer_page_15s_dwell',
    },
    {
      name: 'developer_page_60_scroll',
      locationPath: '/developers',
      pages: [page({ pageId: 'page_current', path: '/developers', pageGroup: 'developer', topic: 'implementation', dwellMs: 2000, maxScrollDepth: 60 })],
      expected: 'developer_page_60_scroll',
    },
    {
      name: 'customer_story_12s_dwell',
      locationPath: '/customers/lacoste',
      pages: [page({ pageId: 'page_current', path: '/customers/lacoste', pageGroup: 'customer_story', topic: 'customer_proof', dwellMs: 12000 })],
      expected: 'customer_story_12s_dwell',
    },
    {
      name: 'customer_story_60_scroll',
      locationPath: '/customers/lacoste',
      pages: [page({ pageId: 'page_current', path: '/customers/lacoste', pageGroup: 'customer_story', topic: 'customer_proof', dwellMs: 1000, maxScrollDepth: 60 })],
      expected: 'customer_story_60_scroll',
    },
    {
      name: 'product_page_10s_dwell',
      locationPath: '/products/ai-recommendations',
      pages: [page({ pageId: 'page_current', path: '/products/ai-recommendations', pageGroup: 'product', topic: 'ai_search', dwellMs: 10000 })],
      expected: 'product_page_10s_dwell',
    },
    {
      name: 'product_page_50_scroll',
      locationPath: '/products/ai-recommendations',
      pages: [page({ pageId: 'page_current', path: '/products/ai-recommendations', pageGroup: 'product', topic: 'ai_search', dwellMs: 1000, maxScrollDepth: 50 })],
      expected: 'product_page_50_scroll',
    },
    {
      name: 'multiple_product_pages',
      locationPath: '/products/ai-recommendations',
      pages: [
        page({ pageId: 'page_product_1', path: '/products/search', pageGroup: 'product', topic: 'search', dwellMs: 4000 }),
        page({ pageId: 'page_current', path: '/products/ai-recommendations', pageGroup: 'product', topic: 'ai_search', dwellMs: 1000 }),
      ],
      expected: 'multiple_product_pages',
    },
    {
      name: 'product_to_pricing_beats_pricing_dwell',
      locationPath: '/pricing',
      pages: [
        page({ pageId: 'page_product', path: '/products/ai-recommendations', pageGroup: 'product', topic: 'ai_search', dwellMs: 12000 }),
        page({ pageId: 'page_current', path: '/pricing', pageGroup: 'pricing', topic: 'pricing_and_usage', dwellMs: 9000 }),
      ],
      expected: 'product_to_pricing',
    },
    {
      name: 'implementation_to_pricing_beats_pricing_dwell',
      locationPath: '/pricing',
      pages: [
        page({ pageId: 'page_docs', path: '/doc/guides/building-search-ui/what-is-instantsearch/js/', pageGroup: 'documentation', topic: 'implementation', dwellMs: 18000 }),
        page({ pageId: 'page_current', path: '/pricing', pageGroup: 'pricing', topic: 'pricing_and_usage', dwellMs: 9000 }),
      ],
      expected: 'implementation_to_pricing',
    },
    {
      name: 'pricing_to_implementation_beats_developer_dwell_scroll',
      locationPath: '/developers',
      pages: [
        page({ pageId: 'page_pricing', path: '/pricing', pageGroup: 'pricing', topic: 'pricing_and_usage', dwellMs: 10000 }),
        page({ pageId: 'page_current', path: '/developers', pageGroup: 'developer', topic: 'implementation', dwellMs: 15000, maxScrollDepth: 60 }),
      ],
      expected: 'pricing_to_implementation',
    },
    {
      name: 'product_to_customer_beats_customer_dwell_scroll',
      locationPath: '/customers/lacoste',
      pages: [
        page({ pageId: 'page_product', path: '/products/ai-recommendations', pageGroup: 'product', topic: 'ai_search', dwellMs: 12000 }),
        page({ pageId: 'page_current', path: '/customers/lacoste', pageGroup: 'customer_story', topic: 'customer_proof', dwellMs: 12000, maxScrollDepth: 60 }),
      ],
      expected: 'product_to_customer_story',
    },
    {
      name: 'product_dwell_beats_product_scroll',
      locationPath: '/products/ai-recommendations',
      pages: [page({ pageId: 'page_current', path: '/products/ai-recommendations', pageGroup: 'product', topic: 'ai_search', dwellMs: 10000, maxScrollDepth: 50 })],
      expected: 'product_page_10s_dwell',
    },
    {
      name: 'developer_dwell_beats_developer_scroll',
      locationPath: '/developers',
      pages: [page({ pageId: 'page_current', path: '/developers', pageGroup: 'developer', topic: 'implementation', dwellMs: 15000, maxScrollDepth: 60 })],
      expected: 'developer_page_15s_dwell',
    },
    {
      name: 'customer_dwell_beats_customer_scroll',
      locationPath: '/customers/lacoste',
      pages: [page({ pageId: 'page_current', path: '/customers/lacoste', pageGroup: 'customer_story', topic: 'customer_proof', dwellMs: 12000, maxScrollDepth: 60 })],
      expected: 'customer_story_12s_dwell',
    },
  ];

  for (const item of cases) {
    const { context } = createHarness({
      locationPath: item.locationPath,
      pages: item.pages,
      events: item.events,
    });
    const decision = opportunity(context);
    assert.equal(decision.engage, true, item.name);
    assert.equal(decision.trigger, item.expected, item.name);
  }
});

test('unsupported journey paths do not invent path-specific triggers', () => {
  const noSpecificTriggerCases = [
    {
      name: 'faq_to_pricing_before_pricing_dwell',
      locationPath: '/pricing',
      pages: [
        page({ pageId: 'page_faq', path: '/faq', pageGroup: 'faq', topic: 'faq', dwellMs: 12000 }),
        page({ pageId: 'page_current', path: '/pricing', pageGroup: 'pricing', topic: 'pricing_and_usage', dwellMs: 1000 }),
      ],
    },
    {
      name: 'pricing_to_faq',
      locationPath: '/faq',
      pages: [
        page({ pageId: 'page_pricing', path: '/pricing', pageGroup: 'pricing', topic: 'pricing_and_usage', dwellMs: 10000 }),
        page({ pageId: 'page_current', path: '/faq', pageGroup: 'faq', topic: 'faq', dwellMs: 1000 }),
      ],
    },
    {
      name: 'homepage_to_signup',
      locationPath: '/signup',
      pages: [
        page({ pageId: 'page_home', path: '/', pageGroup: 'home', topic: 'homepage', dwellMs: 10000 }),
        page({ pageId: 'page_current', path: '/signup', pageGroup: 'signup', topic: 'conversion', dwellMs: 1000 }),
      ],
    },
  ];

  for (const item of noSpecificTriggerCases) {
    const { context } = createHarness({
      locationPath: item.locationPath,
      pages: item.pages,
    });
    const decision = opportunity(context);
    assert.equal(decision.engage, false, item.name);
    assert.equal(decision.reason, 'no_trigger_match', item.name);
  }
});

test('faq to pricing falls back to generic pricing dwell only after the pricing threshold', () => {
  const belowThreshold = createHarness({
    locationPath: '/pricing',
    pages: [
      page({ pageId: 'page_faq', path: '/faq', pageGroup: 'faq', topic: 'faq', dwellMs: 12000 }),
      page({ pageId: 'page_current', path: '/pricing', pageGroup: 'pricing', topic: 'pricing_and_usage', dwellMs: 1000 }),
    ],
  });
  const atThreshold = createHarness({
    locationPath: '/pricing',
    pages: [
      page({ pageId: 'page_faq', path: '/faq', pageGroup: 'faq', topic: 'faq', dwellMs: 12000 }),
      page({ pageId: 'page_current', path: '/pricing', pageGroup: 'pricing', topic: 'pricing_and_usage', dwellMs: 8000 }),
    ],
  });

  assert.equal(opportunity(belowThreshold.context).engage, false);
  assert.equal(opportunity(atThreshold.context).trigger, 'pricing_8s_dwell');
});
