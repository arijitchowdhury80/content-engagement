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
  title,
  productFocus,
  productFocusLabel,
  dwellMs = 0,
  maxScrollDepth = 0,
  enteredAt = 1786750000000,
}) {
  return {
    pageId,
    path,
    title: title || `${pageGroup} ${topic}`,
    pageGroup,
    topic,
    productFocus,
    productFocusLabel,
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
  proactiveConfig,
  contextEngineConfig,
  fetchImpl,
  search = '',
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
  const chatEngagements = [];
  const chatElement = {
    autoEngage: true,
    engage(payload) {
      chatEngagements.push(payload);
      return true;
    },
  };
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
    fetch: fetchImpl,
    location: {
      href: `https://www.algolia.com${currentPath}${search}`,
      origin: 'https://www.algolia.com',
      pathname: currentPath,
      search,
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
        if (selector === 'algolia-chat') return chatElement;
        if (selector === 'algolia-instant-search') {
          return {
            getAttribute(name) {
              if (name === 'app-id') return '0EXRPAXB56';
              if (name === 'api-key') return 'search_key';
              return null;
            },
          };
        }
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
  if (proactiveConfig) context.window.ALGOLIA_PROACTIVE_CONFIG = proactiveConfig;
  if (contextEngineConfig) context.window.ALGOLIA_CONTEXT_ENGINE_CONFIG = contextEngineConfig;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(compilerPath, 'utf8'), context);
  vm.runInContext(fs.readFileSync(controllerPath, 'utf8'), context);
  return { context, localStorage, sessionStorage, documentEvents, chatEngagements };
}

function opportunity(context) {
  return context.algoliaProactiveController.evaluate();
}

async function flushAsyncControllerWork() {
  for (let index = 0; index < 5; index += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
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

test('product to pricing carries exact prior product focus for personalized greeting', () => {
  const { context } = createHarness({
    locationPath: '/pricing',
    pages: [
      page({
        pageId: 'page_product',
        path: '/products/features/personalization',
        title: 'Search Personalization',
        pageGroup: 'product',
        topic: 'ai_search',
        productFocus: 'personalization',
        productFocusLabel: 'Personalization',
        dwellMs: 12000,
      }),
      page({
        pageId: 'page_current',
        path: '/pricing',
        title: 'Pricing',
        pageGroup: 'pricing',
        topic: 'pricing_and_usage',
        dwellMs: 1000,
      }),
    ],
  });

  const decision = opportunity(context);

  assert.equal(decision.trigger, 'product_to_pricing');
  assert.equal(decision.agentPromptPacket.contextualFocus.value, 'personalization');
  assert.equal(decision.agentPromptPacket.contextualFocus.label, 'Personalization');
  assert.equal(decision.agentPromptPacket.contextualFocus.source, 'prior_product_page');
  assert.equal(decision.agentPromptPacket.journey[0].productFocus, 'personalization');
  assert.equal(decision.agentPromptPacket.journey[0].title, 'Search Personalization');
});

test('product to pricing summarizes multi-product journey for greeting personalization', () => {
  const { context } = createHarness({
    locationPath: '/pricing',
    pages: [
      page({
        pageId: 'page_search',
        path: '/products/search',
        title: 'Search',
        pageGroup: 'product',
        topic: 'product_research',
        productFocus: 'search',
        productFocusLabel: 'Search',
        dwellMs: 9000,
      }),
      page({
        pageId: 'page_personalization',
        path: '/products/features/personalization',
        title: 'Personalization',
        pageGroup: 'product',
        topic: 'ai_search',
        productFocus: 'personalization',
        productFocusLabel: 'Personalization',
        dwellMs: 14000,
      }),
      page({
        pageId: 'page_recommendations',
        path: '/products/ai-recommendations',
        title: 'AI Recommendations',
        pageGroup: 'product',
        topic: 'ai_search',
        productFocus: 'recommendations',
        productFocusLabel: 'AI Recommendations',
        dwellMs: 11000,
      }),
      page({
        pageId: 'page_current',
        path: '/pricing',
        title: 'Pricing',
        pageGroup: 'pricing',
        topic: 'pricing_and_usage',
        dwellMs: 1000,
      }),
    ],
  });

  const decision = opportunity(context);

  assert.equal(decision.trigger, 'product_to_pricing');
  assert.equal(decision.agentPromptPacket.contextualFocus.label, 'AI Recommendations');
  assert.equal(
    decision.agentPromptPacket.journeySummary.productTrail.map((item) => item.label).join(' > '),
    'Search > Personalization > AI Recommendations'
  );
  assert.equal(decision.agentPromptPacket.journeySummary.currentTransition, 'product_to_pricing');
  assert.match(decision.agentPromptPacket.journeySummary.storyHint, /Search, Personalization, and AI Recommendations/);
  assert.match(decision.agentPromptPacket.journeySummary.storyHint, /cost\/value question/);
});

test('product to pricing overrides stale lower-priority product dwell opportunity', () => {
  const { context } = createHarness({
    locationPath: '/pricing',
    state: {
      schema: 'AlgoliaProactiveState.v1',
      lastOpportunityAt: Date.now(),
      opportunities: [
        {
          id: 'opp_product_dwell',
          status: 'greeting_requested',
          pageId: 'page_product',
          pagePath: '/products/features/personalization',
          moment: 'product_research',
          trigger: 'product_page_10s_dwell',
          priority: 66,
          messageGoal: 'explain_product_fit',
          createdAt: Date.now(),
        },
      ],
    },
    pages: [
      page({
        pageId: 'page_product',
        path: '/products/features/personalization',
        title: 'Search Personalization',
        pageGroup: 'product',
        topic: 'ai_search',
        productFocus: 'personalization',
        productFocusLabel: 'Personalization',
        dwellMs: 12000,
      }),
      page({
        pageId: 'page_current',
        path: '/pricing',
        title: 'Pricing',
        pageGroup: 'pricing',
        topic: 'pricing_and_usage',
        dwellMs: 1000,
      }),
    ],
    events: [
      event({ eventId: 'evt_product', name: 'page_view', path: '/products/features/personalization', pageId: 'page_product' }),
      event({ eventId: 'evt_pricing', name: 'page_view', path: '/pricing', pageId: 'page_current', ts: 1786750060000 }),
    ],
  });

  const decision = opportunity(context);

  assert.equal(decision.engage, true);
  assert.equal(decision.trigger, 'product_to_pricing');
  assert.equal(decision.agentPromptPacket.contextualFocus.label, 'Personalization');
});

test('unshown opportunities do not consume session cap or cooldown', () => {
  const { context } = createHarness({
    locationPath: '/pricing',
    state: {
      schema: 'AlgoliaProactiveState.v1',
      lastOpportunityAt: Date.now(),
      opportunities: [
        { id: 'opp_1', status: 'greeting_failed', pageId: 'page_old_1', pagePath: '/products/search', moment: 'product_research', trigger: 'product_page_10s_dwell', priority: 66 },
        { id: 'opp_2', status: 'greeting_requested', pageId: 'page_old_2', pagePath: '/products/features/personalization', moment: 'product_research', trigger: 'product_page_10s_dwell', priority: 66 },
        { id: 'opp_3', status: 'greeting_rejected', pageId: 'page_old_3', pagePath: '/developers', moment: 'implementation_research', trigger: 'developer_page_15s_dwell', priority: 76 },
      ],
    },
    pages: [
      page({
        pageId: 'page_current',
        path: '/pricing',
        title: 'Pricing',
        pageGroup: 'pricing',
        topic: 'pricing_and_usage',
        dwellMs: 8000,
      }),
    ],
  });

  const decision = opportunity(context);

  assert.equal(decision.engage, true);
  assert.equal(decision.trigger, 'pricing_8s_dwell');
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

test('debug mode exposes suppression reason for invisible proactive blocks', () => {
  const { context, documentEvents } = createHarness({
    search: '?algoliaProactiveDebug=1',
    pages: [
      page({
        pageId: 'page_current',
        path: '/products/ai-recommendations',
        pageGroup: 'product',
        topic: 'ai_search',
        dwellMs: 10000,
      }),
    ],
    events: [
      event({ eventId: 'evt_chat', name: 'chat_open', path: '/products/ai-recommendations' }),
      event({ eventId: 'evt_page', name: 'page_view', path: '/products/ai-recommendations' }),
    ],
  });

  context.document.dispatchEvent(
    new context.CustomEvent('algolia-engagement-signal', {
      detail: { name: 'page_dwell', path: '/products/ai-recommendations' },
    })
  );

  const suppression = documentEvents.find((evt) => evt.type === 'algolia-proactive-suppressed');
  assert.equal(context.__algoliaProactiveLastSuppression.reason, 'chat_already_open');
  assert.equal(suppression.detail.reason, 'chat_already_open');
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

test('configured controller posts a proactive greeting request and renders validated greeting chips', async () => {
  const fetchCalls = [];
  const { context, chatEngagements, sessionStorage } = createHarness({
    proactiveConfig: {
      greetingsAgentId: 'greeting_agent_123',
      appId: '0EXRPAXB56',
      apiKey: 'search_key',
    },
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
    fetchImpl: async (url, init) => {
      fetchCalls.push({ url: String(url), init });
      const body = JSON.parse(init.body);
      const packet = JSON.parse(body.messages[0].parts[0].text.replace(/^PROACTIVE_GREETING_REQUEST\n/, ''));
      return {
        ok: true,
        text: async () =>
          JSON.stringify({
            schema: 'ProactiveGreetingResponse.v1',
            opportunityId: packet.opportunityId,
            greeting:
              'Pricing pages are where good search ideas meet CFO gravity. Want the practical version of what actually drives cost?',
            chips: ['What drives cost?', 'API call counting', 'Which plan fits?'],
            handoffSummary: {
              moment: 'commercial_evaluation',
              trigger: 'product_to_pricing',
              messageGoal: 'explain_cost_drivers',
            },
          }),
      };
    },
  });

  context.document.dispatchEvent(
    new context.CustomEvent('algolia-engagement-signal', {
      detail: { name: 'page_view', path: '/pricing' },
    })
  );
  await flushAsyncControllerWork();

  assert.equal(fetchCalls.length, 1);
  assert.match(fetchCalls[0].url, /0EXRPAXB56\.algolia\.net\/agent-studio\/1\/agents\/greeting_agent_123\/completions/);
  const body = JSON.parse(fetchCalls[0].init.body);
  const text = body.messages[0].parts[0].text;
  assert.match(text, /^PROACTIVE_GREETING_REQUEST\n/);
  const packet = JSON.parse(text.replace(/^PROACTIVE_GREETING_REQUEST\n/, ''));
  const state = JSON.parse(sessionStorage.getItem('algolia_proactive_state'));
  const opportunityId = state.opportunities[0].id;

  assert.equal(packet.schema, 'ProactiveGreetingRequest.v1');
  assert.equal(packet.opportunityId, opportunityId);
  assert.equal(packet.trigger, 'product_to_pricing');
  assert.equal(body.messages[0].metadata.turnContext.context_schema, 'AlgoliaTurnContext.v1');
  assert.equal(chatEngagements.length, 1);
  assert.equal(chatEngagements[0].greeting, 'Pricing pages are where good search ideas meet CFO gravity. Want the practical version of what actually drives cost?');
  assert.deepEqual(Array.from(chatEngagements[0].suggestions), ['What drives cost?', 'API call counting', 'Which plan fits?']);

  const updatedState = JSON.parse(sessionStorage.getItem('algolia_proactive_state'));
  assert.equal(updatedState.opportunities[0].status, 'shown');
  assert.equal(updatedState.opportunities[0].greetingResponse.schema, 'ProactiveGreetingResponse.v1');
});

test('controller uses existing engage concierge agent id as greeting agent fallback', async () => {
  const fetchCalls = [];
  const { context, chatEngagements } = createHarness({
    contextEngineConfig: {
      conciergeAgentId: 'www_proactive_concierge_123',
    },
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
    fetchImpl: async (url, init) => {
      fetchCalls.push({ url: String(url), init });
      const body = JSON.parse(init.body);
      const packet = JSON.parse(body.messages[0].parts[0].text.replace(/^PROACTIVE_GREETING_REQUEST\n/, ''));
      return {
        ok: true,
        text: async () =>
          JSON.stringify({
            schema: 'ProactiveGreetingResponse.v1',
            opportunityId: packet.opportunityId,
            greeting:
              'Pricing pages are where good search ideas meet CFO gravity. Want the practical version of what actually drives cost?',
            chips: ['What drives cost?'],
            handoffSummary: {
              moment: 'commercial_evaluation',
              trigger: 'product_to_pricing',
              messageGoal: 'explain_cost_drivers',
            },
          }),
      };
    },
  });

  context.document.dispatchEvent(
    new context.CustomEvent('algolia-engagement-signal', {
      detail: { name: 'page_view', path: '/pricing' },
    })
  );
  await flushAsyncControllerWork();

  assert.equal(fetchCalls.length, 1);
  assert.match(fetchCalls[0].url, /agents\/www_proactive_concierge_123\/completions/);
  assert.equal(chatEngagements.length, 1);
});

test('controller evaluates once on install so initial page-view journey triggers are not missed', async () => {
  const fetchCalls = [];
  const { chatEngagements } = createHarness({
    proactiveConfig: {
      greetingsAgentId: 'greeting_agent_123',
      appId: '0EXRPAXB56',
      apiKey: 'search_key',
      cooldownMs: 0,
    },
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
      event({ eventId: 'evt_product', name: 'page_view', path: '/products/ai-recommendations', pageId: 'page_product' }),
      event({ eventId: 'evt_pricing', name: 'page_view', path: '/pricing', pageId: 'page_current' }),
    ],
    fetchImpl: async (url, init) => {
      fetchCalls.push({ url: String(url), init });
      const body = JSON.parse(init.body);
      const packet = JSON.parse(body.messages[0].parts[0].text.replace(/^PROACTIVE_GREETING_REQUEST\n/, ''));
      return {
        ok: true,
        text: async () =>
          JSON.stringify({
            schema: 'ProactiveGreetingResponse.v1',
            opportunityId: packet.opportunityId,
            greeting:
              'Looks like recommendations just met the pricing page. Want the clean version of what actually drives cost?',
            chips: ['What drives cost?'],
            handoffSummary: {
              moment: 'commercial_evaluation',
              trigger: 'product_to_pricing',
              messageGoal: 'explain_cost_drivers',
            },
          }),
      };
    },
  });

  await flushAsyncControllerWork();

  assert.equal(fetchCalls.length, 1);
  assert.equal(chatEngagements.length, 1);
  assert.equal(chatEngagements[0].suggestions[0], 'What drives cost?');
});

test('controller refuses invalid greeting responses and does not open the widget', async () => {
  const { context, chatEngagements, sessionStorage } = createHarness({
    proactiveConfig: {
      greetingsAgentId: 'greeting_agent_123',
      appId: '0EXRPAXB56',
      apiKey: 'search_key',
    },
    locationPath: '/pricing',
    pages: [
      page({ pageId: 'page_product', path: '/products/search', pageGroup: 'product', topic: 'search', dwellMs: 12000 }),
      page({ pageId: 'page_current', path: '/pricing', pageGroup: 'pricing', topic: 'pricing_and_usage' }),
    ],
    fetchImpl: async () => ({
      ok: true,
      text: async () =>
        JSON.stringify({
          schema: 'ProactiveGreetingResponse.v1',
          opportunityId: 'wrong',
          greeting: 'I noticed your browsing behavior and tracking says you need pricing help.',
          chips: ['one', 'two', 'three', 'four'],
          handoffSummary: {
            moment: 'commercial_evaluation',
            trigger: 'product_to_pricing',
            messageGoal: 'explain_cost_drivers',
          },
        }),
    }),
  });

  context.document.dispatchEvent(
    new context.CustomEvent('algolia-engagement-signal', {
      detail: { name: 'page_view', path: '/pricing' },
    })
  );
  await flushAsyncControllerWork();

  assert.equal(chatEngagements.length, 0);
  const state = JSON.parse(sessionStorage.getItem('algolia_proactive_state'));
  assert.equal(state.opportunities[0].status, 'greeting_rejected');
  assert.equal(state.opportunities[0].failureReason, 'opportunity_mismatch');
});

test('controller parses streamed text deltas from the greetings agent', async () => {
  const { context, chatEngagements } = createHarness({
    proactiveConfig: {
      greetingsAgentId: 'greeting_agent_123',
      appId: '0EXRPAXB56',
      apiKey: 'search_key',
    },
    locationPath: '/pricing',
    pages: [
      page({ pageId: 'page_product', path: '/products/search', pageGroup: 'product', topic: 'search', dwellMs: 12000 }),
      page({ pageId: 'page_current', path: '/pricing', pageGroup: 'pricing', topic: 'pricing_and_usage' }),
    ],
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body);
      const packet = JSON.parse(body.messages[0].parts[0].text.replace(/^PROACTIVE_GREETING_REQUEST\n/, ''));
      const payload = JSON.stringify({
        schema: 'ProactiveGreetingResponse.v1',
        opportunityId: packet.opportunityId,
        greeting: 'Pricing can look like spreadsheet fog. Want the clean version of what actually drives Algolia cost?',
        chips: ['What drives cost?'],
        handoffSummary: {
          moment: 'commercial_evaluation',
          trigger: 'product_to_pricing',
          messageGoal: 'explain_cost_drivers',
        },
      });
      return {
        ok: true,
        text: async () =>
          payload
            .match(/.{1,40}/g)
            .map((delta) => `data: ${JSON.stringify({ type: 'text-delta', delta })}\n`)
            .join(''),
      };
    },
  });

  context.document.dispatchEvent(
    new context.CustomEvent('algolia-engagement-signal', {
      detail: { name: 'page_view', path: '/pricing' },
    })
  );
  await flushAsyncControllerWork();

  assert.equal(chatEngagements.length, 1);
  assert.equal(chatEngagements[0].greeting, 'Pricing can look like spreadsheet fog. Want the clean version of what actually drives Algolia cost?');
});
