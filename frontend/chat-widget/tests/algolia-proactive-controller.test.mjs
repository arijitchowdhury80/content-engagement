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
  solutionFocus,
  solutionFocusLabel,
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
    solutionFocus,
    solutionFocusLabel,
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
  instantSearch = true,
  chatAttrs = {},
  engageAttrs = {},
  chatAvailable = true,
  initialLocal = {},
  initialSession = {},
} = {}) {
  const currentPath = locationPath || pages?.at(-1)?.path || '/products/ai-recommendations';
  const localStorage = new MemoryStorage({
    ...initialLocal,
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
    ...initialSession,
  });
  const documentListeners = new Map();
  const documentEvents = [];
  const chatEngagements = [];
  const chatOpens = [];
  const chatElement = {
    autoEngage: true,
    getAttribute(name) {
      return chatAttrs[name] ?? null;
    },
    engage(payload) {
      chatEngagements.push(payload);
      return true;
    },
    open() {
      chatOpens.push(Date.now());
    },
  };
  const engageElement = {
    getAttribute(name) {
      return engageAttrs[name] ?? null;
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
        if (selector === 'algolia-chat') {
          const available = typeof chatAvailable === 'function' ? chatAvailable() : chatAvailable;
          return available ? chatElement : null;
        }
        if (selector === 'algolia-instant-search') {
          if (!instantSearch) return null;
          return {
            getAttribute(name) {
              if (name === 'app-id') return '0EXRPAXB56';
              if (name === 'api-key') return 'search_key';
              return null;
            },
          };
        }
        if (selector === 'algolia-chat-engage') return engageElement;
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
  return { context, localStorage, sessionStorage, documentEvents, chatEngagements, chatOpens };
}

function opportunity(context) {
  return context.algoliaProactiveController.evaluate();
}

async function flushAsyncControllerWork() {
  for (let index = 0; index < 5; index += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

test('product research triggers at 10 visible seconds and 50 percent scroll', () => {
  const { context } = createHarness({
    pages: [
      page({
        pageId: 'page_current',
        path: '/products/ai-recommendations',
        pageGroup: 'product',
        topic: 'ai_search',
        dwellMs: 10000,
        maxScrollDepth: 50,
      }),
    ],
  });

  const decision = opportunity(context);

  assert.equal(decision.engage, true);
  assert.equal(decision.moment, 'product_research');
  assert.equal(decision.trigger, 'product_page_10s_50_scroll');
  assert.equal(decision.messageGoal, 'explain_product_fit');
  assert.ok(decision.priority >= 60);
  assert.ok(decision.reasonCodes.includes('product_page'));
  assert.equal(decision.agentPromptPacket.currentPage.path, '/products/ai-recommendations');
});

test('developer depth requires 10 visible seconds and 50 percent scroll', () => {
  const { context } = createHarness({
    locationPath: '/developers',
    pages: [
      page({
        pageId: 'page_current',
        path: '/developers',
        pageGroup: 'developer',
        topic: 'implementation',
        dwellMs: 10000,
        maxScrollDepth: 50,
      }),
    ],
  });

  const decision = opportunity(context);

  assert.equal(decision.engage, true);
  assert.equal(decision.moment, 'implementation_research');
  assert.equal(decision.trigger, 'developer_page_10s_50_scroll');
  assert.equal(decision.messageGoal, 'reduce_implementation_uncertainty');
});

test('all eight canonical journeys honor below, exact, and above trigger boundaries', () => {
  const singlePageCases = [
    ['product_page_10s_50_scroll', '/products/ai-search', 'product'],
    ['solution_page_10s_50_scroll', '/solutions/ecommerce', 'solution'],
    ['developer_page_10s_50_scroll', '/developers', 'developer'],
    ['resource_page_10s_50_scroll', '/resources', 'resource'],
  ];
  for (const [trigger, path, pageGroup] of singlePageCases) {
    for (const [dwellMs, maxScrollDepth, expected] of [
      [9999, 50, false],
      [10000, 49, false],
      [10000, 50, true],
      [10001, 51, true],
    ]) {
      const { context } = createHarness({
        locationPath: path,
        pages: [page({ pageId: 'page_current', path, pageGroup, topic: 'test', dwellMs, maxScrollDepth })],
      });
      const decision = opportunity(context);
      assert.equal(decision.trigger === trigger, expected, `${trigger} at ${dwellMs}ms/${maxScrollDepth}%`);
    }
  }

  const depthTransitions = [
    ['product_to_documentation', '/products/ai-search', 'product', '/doc/guides/search/', 'documentation'],
    ['solution_to_customer_story', '/solutions/ecommerce', 'solution', '/customers/harry-rosen', 'customer_story'],
  ];
  for (const [trigger, sourcePath, sourceGroup, destinationPath, destinationGroup] of depthTransitions) {
    for (const [sourceDwell, sourceScroll, destinationDwell, destinationScroll, expected] of [
      [9999, 50, 10000, 50, false],
      [10000, 49, 10000, 50, false],
      [10000, 50, 9999, 50, false],
      [10000, 50, 10000, 49, false],
      [10000, 50, 10000, 50, true],
      [10001, 51, 10001, 51, true],
    ]) {
      const { context } = createHarness({
        locationPath: destinationPath,
        pages: [
          page({ pageId: 'page_source', path: sourcePath, pageGroup: sourceGroup, topic: 'test', dwellMs: sourceDwell, maxScrollDepth: sourceScroll }),
          page({ pageId: 'page_current', path: destinationPath, pageGroup: destinationGroup, topic: 'test', dwellMs: destinationDwell, maxScrollDepth: destinationScroll }),
        ],
      });
      const decision = opportunity(context);
      assert.equal(decision.trigger === trigger, expected, `${trigger} boundary case`);
    }
  }

  const pricingTransitions = [
    ['product_to_pricing', '/products/ai-search', 'product'],
    ['solution_to_pricing', '/solutions/ecommerce', 'solution'],
  ];
  for (const [trigger, sourcePath, sourceGroup] of pricingTransitions) {
    for (const [dwellMs, maxScrollDepth, expected] of [
      [9999, 50, false],
      [10000, 49, false],
      [10000, 50, true],
      [10001, 51, true],
    ]) {
      const { context } = createHarness({
        locationPath: '/pricing',
        pages: [
          page({ pageId: 'page_source', path: sourcePath, pageGroup: sourceGroup, topic: 'test', dwellMs, maxScrollDepth }),
          page({ pageId: 'page_current', path: '/pricing', pageGroup: 'pricing', topic: 'pricing_and_usage' }),
        ],
      });
      const decision = opportunity(context);
      assert.equal(decision.trigger === trigger, expected, `${trigger} at ${dwellMs}ms/${maxScrollDepth}%`);
    }
  }
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
        maxScrollDepth: 50,
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

test('demo and contact-sales conversion pages do not masquerade as pricing journeys', () => {
  for (const path of ['/demo', '/contact-sales']) {
    const { context } = createHarness({
      locationPath: path,
      pages: [
        page({
          pageId: 'page_product',
          path: '/products/ai-search',
          pageGroup: 'product',
          topic: 'ai_search',
          dwellMs: 10000,
          maxScrollDepth: 50,
        }),
        page({
          pageId: 'page_current',
          path,
          pageGroup: 'conversion',
          topic: 'conversion',
        }),
      ],
    });

    assert.notEqual(opportunity(context).trigger, 'product_to_pricing', path);
  }
});

test('pricing transition follows the most recent qualified product-or-solution source', () => {
  const cases = [
    {
      name: 'solution visited after product',
      sources: [
        page({ pageId: 'page_product', path: '/products/ai-search', pageGroup: 'product', topic: 'ai_search', dwellMs: 10000, maxScrollDepth: 50 }),
        page({ pageId: 'page_solution', path: '/solutions/ecommerce', pageGroup: 'solution', topic: 'ecommerce', dwellMs: 10000, maxScrollDepth: 50 }),
      ],
      expected: 'solution_to_pricing',
    },
    {
      name: 'product visited after solution',
      sources: [
        page({ pageId: 'page_solution', path: '/solutions/ecommerce', pageGroup: 'solution', topic: 'ecommerce', dwellMs: 10000, maxScrollDepth: 50 }),
        page({ pageId: 'page_product', path: '/products/ai-search', pageGroup: 'product', topic: 'ai_search', dwellMs: 10000, maxScrollDepth: 50 }),
      ],
      expected: 'product_to_pricing',
    },
  ];

  for (const item of cases) {
    const { context } = createHarness({
      locationPath: '/pricing',
      pages: [
        ...item.sources,
        page({ pageId: 'page_current', path: '/pricing', pageGroup: 'pricing', topic: 'pricing_and_usage' }),
      ],
    });

    assert.equal(opportunity(context).trigger, item.expected, item.name);
  }
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
        maxScrollDepth: 50,
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
        maxScrollDepth: 50,
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
        maxScrollDepth: 50,
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

test('solution to pricing summarizes multi-solution journey for greeting personalization', () => {
  const { context } = createHarness({
    locationPath: '/pricing',
    pages: [
      page({
        pageId: 'page_commerce',
        path: '/solutions/ecommerce',
        title: 'Ecommerce Site Search Solutions',
        pageGroup: 'solution',
        topic: 'commerce',
        solutionFocus: 'commerce',
        solutionFocusLabel: 'Commerce',
        dwellMs: 9000,
      }),
      page({
        pageId: 'page_marketplace',
        path: '/solutions/marketplaces',
        title: 'Marketplace Search Solutions',
        pageGroup: 'solution',
        topic: 'marketplace',
        solutionFocus: 'marketplace',
        solutionFocusLabel: 'Marketplace',
        dwellMs: 12000,
        maxScrollDepth: 50,
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

  assert.equal(decision.trigger, 'solution_to_pricing');
  assert.equal(decision.agentPromptPacket.contextualFocus.label, 'Marketplace');
  assert.equal(decision.agentPromptPacket.contextualFocus.type, 'solution');
  assert.equal(
    decision.agentPromptPacket.journeySummary.solutionTrail.map((item) => item.label).join(' > '),
    'Commerce > Marketplace'
  );
  assert.equal(decision.agentPromptPacket.journeySummary.currentTransition, 'solution_to_pricing');
  assert.match(decision.agentPromptPacket.journeySummary.storyHint, /Commerce and Marketplace/);
  assert.match(decision.agentPromptPacket.journeySummary.storyHint, /commercial evaluation/);
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
        maxScrollDepth: 50,
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
    locationPath: '/products/ai-search',
    state: {
      schema: 'AlgoliaProactiveState.v1',
      lastOpportunityAt: Date.now(),
      opportunities: [
        { id: 'opp_1', status: 'greeting_failed', pageId: 'page_old_1', pagePath: '/products/search', moment: 'product_research', trigger: 'product_page_10s_50_scroll', priority: 66 },
        { id: 'opp_2', status: 'greeting_requested', pageId: 'page_old_2', pagePath: '/products/features/personalization', moment: 'product_research', trigger: 'product_page_10s_50_scroll', priority: 66 },
        { id: 'opp_3', status: 'greeting_rejected', pageId: 'page_old_3', pagePath: '/developers', moment: 'implementation_research', trigger: 'developer_page_10s_50_scroll', priority: 76 },
      ],
    },
    pages: [
      page({
        pageId: 'page_current',
        path: '/products/ai-search',
        title: 'AI Search',
        pageGroup: 'product',
        topic: 'ai_search',
        dwellMs: 10000,
        maxScrollDepth: 50,
      }),
    ],
  });

  const decision = opportunity(context);

  assert.equal(decision.engage, true);
  assert.equal(decision.trigger, 'product_page_10s_50_scroll');
});

test('product to customer story is not a canonical journey trigger', () => {
  const { context } = createHarness({
    locationPath: '/customers/gymshark-recommend',
    pages: [
      page({
        pageId: 'page_product',
        path: '/products/ai-recommendations',
        pageGroup: 'product',
        topic: 'ai_search',
        dwellMs: 12000,
        maxScrollDepth: 50,
      }),
      page({
        pageId: 'page_current',
        path: '/customers/gymshark-recommend',
        pageGroup: 'customer_story',
        topic: 'customer_proof',
        dwellMs: 12000,
        maxScrollDepth: 50,
      }),
    ],
  });

  const decision = opportunity(context);

  assert.equal(decision.engage, false);
  assert.equal(decision.reason, 'no_trigger_match');
});

test('generic product engagement requires both 10 visible seconds and 50 percent scroll', () => {
  for (const [dwellMs, maxScrollDepth, expected] of [
    [10000, 49, false],
    [9999, 50, false],
    [10000, 50, true],
  ]) {
    const { context } = createHarness({
      locationPath: '/products/arbitrary-future-product',
      pages: [page({
        pageId: 'page_current',
        path: '/products/arbitrary-future-product',
        pageGroup: 'product',
        topic: 'future_product',
        dwellMs,
        maxScrollDepth,
      })],
    });
    const decision = opportunity(context);
    assert.equal(decision.engage, expected);
    if (expected) assert.equal(decision.trigger, 'product_page_10s_50_scroll');
  }
});

test('generic solution engagement requires both 10 visible seconds and 50 percent scroll', () => {
  for (const [dwellMs, maxScrollDepth, expected] of [
    [10000, 49, false],
    [9999, 50, false],
    [10000, 50, true],
  ]) {
    const { context } = createHarness({
      locationPath: '/solutions/grocery',
      pages: [page({
        pageId: 'page_current',
        path: '/solutions/grocery',
        pageGroup: 'solution',
        topic: 'grocery',
        solutionFocus: 'grocery',
        solutionFocusLabel: 'Grocery',
        dwellMs,
        maxScrollDepth,
      })],
    });
    const decision = opportunity(context);
    assert.equal(decision.engage, expected);
    if (expected) assert.equal(decision.trigger, 'solution_page_10s_50_scroll');
  }
});

test('product to documentation waits for destination engagement and preserves product context', () => {
  const pages = [
    page({
      pageId: 'page_product',
      path: '/products/ai-recommendations',
      pageGroup: 'product',
      topic: 'recommendations',
      productFocus: 'recommendations',
      productFocusLabel: 'AI Recommendations',
      dwellMs: 16000,
      maxScrollDepth: 60,
    }),
    page({
      pageId: 'page_current',
      path: '/doc/guides/ai-recommendations/getting-started/',
      pageGroup: 'documentation',
      topic: 'recommendations_implementation',
      dwellMs: 10000,
      maxScrollDepth: 50,
    }),
  ];
  const { context } = createHarness({
    locationPath: pages.at(-1).path,
    pages,
  });

  const decision = opportunity(context);
  assert.equal(decision.trigger, 'product_to_documentation');
  assert.equal(decision.agentPromptPacket.contextualFocus.label, 'AI Recommendations');
  assert.match(decision.agentPromptPacket.journeySummary.storyHint, /technical validation/i);
});

test('solution to customer proof waits for destination engagement', () => {
  const { context } = createHarness({
    locationPath: '/customers/heb-mexico',
    pages: [
      page({
        pageId: 'page_solution',
        path: '/solutions/grocery',
        pageGroup: 'solution',
        topic: 'grocery',
        solutionFocus: 'grocery',
        solutionFocusLabel: 'Grocery',
        dwellMs: 16000,
        maxScrollDepth: 60,
      }),
      page({
        pageId: 'page_current',
        path: '/customers/heb-mexico',
        pageGroup: 'customer_story',
        topic: 'customer_proof',
        dwellMs: 10000,
        maxScrollDepth: 50,
      }),
    ],
  });

  assert.equal(opportunity(context).trigger, 'solution_to_customer_story');
});

test('transition journeys require qualified sources and qualified depth destinations', () => {
  const cases = [
    {
      name: 'product source below dwell',
      locationPath: '/doc/guides/building-search-ui/what-is-instantsearch/js/',
      pages: [
        page({ pageId: 'page_product', path: '/products/ai-search', pageGroup: 'product', topic: 'ai_search', dwellMs: 9999, maxScrollDepth: 50 }),
        page({ pageId: 'page_current', path: '/doc/guides/building-search-ui/what-is-instantsearch/js/', pageGroup: 'documentation', topic: 'implementation', dwellMs: 10000, maxScrollDepth: 50 }),
      ],
      expected: 'developer_page_10s_50_scroll',
    },
    {
      name: 'documentation destination below scroll',
      locationPath: '/doc/guides/building-search-ui/what-is-instantsearch/js/',
      pages: [
        page({ pageId: 'page_product', path: '/products/ai-search', pageGroup: 'product', topic: 'ai_search', dwellMs: 10000, maxScrollDepth: 50 }),
        page({ pageId: 'page_current', path: '/doc/guides/building-search-ui/what-is-instantsearch/js/', pageGroup: 'documentation', topic: 'implementation', dwellMs: 10000, maxScrollDepth: 49 }),
      ],
      expected: null,
    },
    {
      name: 'solution source below scroll',
      locationPath: '/customers/heb-mexico',
      pages: [
        page({ pageId: 'page_solution', path: '/solutions/grocery', pageGroup: 'solution', topic: 'grocery', dwellMs: 10000, maxScrollDepth: 49 }),
        page({ pageId: 'page_current', path: '/customers/heb-mexico', pageGroup: 'customer_story', topic: 'customer_proof', dwellMs: 10000, maxScrollDepth: 50 }),
      ],
      expected: null,
    },
    {
      name: 'proof destination below dwell',
      locationPath: '/customers/heb-mexico',
      pages: [
        page({ pageId: 'page_solution', path: '/solutions/grocery', pageGroup: 'solution', topic: 'grocery', dwellMs: 10000, maxScrollDepth: 50 }),
        page({ pageId: 'page_current', path: '/customers/heb-mexico', pageGroup: 'customer_story', topic: 'customer_proof', dwellMs: 9999, maxScrollDepth: 50 }),
      ],
      expected: null,
    },
  ];

  for (const item of cases) {
    const { context } = createHarness({ locationPath: item.locationPath, pages: item.pages });
    const decision = opportunity(context);
    assert.equal(decision.engage, item.expected !== null, item.name);
    if (item.expected) {
      assert.equal(decision.trigger, item.expected, item.name);
    } else {
      assert.equal(decision.reason, 'no_trigger_match', item.name);
    }
  }
});

test('transition journeys find a qualified source across intermediate pages', () => {
  const { context } = createHarness({
    locationPath: '/pricing',
    pages: [
      page({ pageId: 'page_product', path: '/products/ai-search', pageGroup: 'product', topic: 'ai_search', dwellMs: 10000, maxScrollDepth: 50 }),
      page({ pageId: 'page_resource', path: '/resources/search-buyers-guide', pageGroup: 'resource', topic: 'evaluation', dwellMs: 1000, maxScrollDepth: 5 }),
      page({ pageId: 'page_current', path: '/pricing', pageGroup: 'pricing', topic: 'pricing_and_usage' }),
    ],
  });

  assert.equal(opportunity(context).trigger, 'product_to_pricing');
});

test('a closed unengaged greeting does not suppress a later journey transition', () => {
  const now = Date.now();
  const { context } = createHarness({
    locationPath: '/doc/guides/ai-recommendations/getting-started/',
    pages: [
      page({ pageId: 'page_product', path: '/products/ai-recommendations', pageGroup: 'product', topic: 'recommendations', productFocus: 'recommendations', productFocusLabel: 'AI Recommendations', dwellMs: 16000, maxScrollDepth: 60 }),
      page({ pageId: 'page_current', path: '/doc/guides/ai-recommendations/getting-started/', pageGroup: 'documentation', topic: 'implementation', dwellMs: 10000, maxScrollDepth: 50 }),
    ],
    events: [
      event({ eventId: 'evt_open', name: 'chat_open', path: '/products/ai-recommendations', ts: now - 20000, props: { open: true } }),
      event({ eventId: 'evt_close', name: 'chat_open', path: '/products/ai-recommendations', ts: now - 19000, props: { open: false } }),
    ],
    state: {
      opportunities: [{ id: 'opp_first', status: 'shown', shownAt: now - 20000, pageId: 'page_product', moment: 'product_research' }],
      lastOpportunityAt: now - 20000,
    },
  });

  assert.equal(opportunity(context).trigger, 'product_to_documentation');
});

test('an open unengaged greeting does not suppress a stronger journey transition', () => {
  const now = Date.now();
  const { context } = createHarness({
    locationPath: '/doc/guides/ai-recommendations/getting-started/',
    pages: [
      page({ pageId: 'page_product', path: '/products/ai-recommendations', pageGroup: 'product', topic: 'recommendations', productFocus: 'recommendations', productFocusLabel: 'AI Recommendations', dwellMs: 16000, maxScrollDepth: 60 }),
      page({ pageId: 'page_current', path: '/doc/guides/ai-recommendations/getting-started/', pageGroup: 'documentation', topic: 'implementation', dwellMs: 10000, maxScrollDepth: 50 }),
    ],
    events: [
      event({ eventId: 'evt_open', name: 'chat_open', path: '/products/ai-recommendations', ts: now - 20000, props: { open: true } }),
    ],
    state: {
      opportunities: [{
        id: 'opp_first',
        status: 'shown',
        shownAt: now - 20000,
        pageId: 'page_product',
        moment: 'product_research',
        trigger: 'product_page_10s_50_scroll',
        priority: 66,
      }],
      lastOpportunityAt: now - 20000,
    },
  });

  assert.equal(opportunity(context).trigger, 'product_to_documentation');
});

test('a trailing terminal opportunity does not hide the replaceable visible greeting', () => {
  const now = Date.now();
  const { context } = createHarness({
    locationPath: '/customers/harry-rosen',
    pages: [
      page({ pageId: 'page_solution', path: '/solutions/ecommerce', pageGroup: 'solution', topic: 'ecommerce', dwellMs: 10000, maxScrollDepth: 50 }),
      page({ pageId: 'page_current', path: '/customers/harry-rosen', pageGroup: 'customer_story', topic: 'customer_proof', dwellMs: 10000, maxScrollDepth: 50 }),
    ],
    events: [
      event({ eventId: 'evt_open', name: 'chat_open', path: '/solutions/ecommerce', ts: now - 20000, props: { open: true } }),
    ],
    state: {
      opportunities: [
        {
          id: 'opp_visible',
          status: 'shown',
          shownAt: now - 20000,
          pageId: 'page_solution',
          moment: 'solution_research',
          trigger: 'solution_page_10s_50_scroll',
          priority: 65,
        },
        {
          id: 'opp_terminal',
          status: 'superseded',
          pageId: 'page_stale',
          moment: 'product_research',
          trigger: 'product_page_10s_50_scroll',
          priority: 66,
        },
      ],
      lastOpportunityAt: now - 20000,
    },
  });

  const decision = opportunity(context);

  assert.equal(decision.engage, true);
  assert.equal(decision.trigger, 'solution_to_customer_story');
});

test('the newest visible opportunity blocks replacement when an older greeting is lower priority', async () => {
  const now = Date.now();
  let requestCount = 0;
  const { context, sessionStorage, chatEngagements } = createHarness({
    proactiveConfig: {
      greetingsAgentId: 'greeting_agent_123',
      appId: '0EXRPAXB56',
      apiKey: 'search_key',
    },
    locationPath: '/doc/guides/ai-recommendations/getting-started/',
    pages: [
      page({
        pageId: 'page_product',
        path: '/products/ai-recommendations',
        pageGroup: 'product',
        topic: 'recommendations',
        dwellMs: 10000,
        maxScrollDepth: 50,
      }),
      page({
        pageId: 'page_current',
        path: '/doc/guides/ai-recommendations/getting-started/',
        pageGroup: 'documentation',
        topic: 'implementation',
        dwellMs: 10000,
        maxScrollDepth: 50,
      }),
    ],
    events: [
      event({
        eventId: 'evt_open',
        name: 'chat_open',
        path: '/pricing',
        ts: now - 5000,
        props: { open: true },
      }),
    ],
    state: {
      schema: 'AlgoliaProactiveState.v1',
      opportunities: [
        {
          id: 'opp_older_low',
          status: 'shown',
          lifecycle: ['qualified', 'pending', 'shown'],
          shownAt: now - 20000,
          pageId: 'page_older',
          moment: 'product_research',
          trigger: 'product_page_10s_50_scroll',
          priority: 66,
        },
        {
          id: 'opp_newer_high',
          status: 'shown',
          lifecycle: ['qualified', 'pending', 'shown'],
          shownAt: now - 5000,
          pageId: 'page_pricing',
          moment: 'commercial_evaluation',
          trigger: 'product_to_pricing',
          priority: 88,
        },
      ],
      lastOpportunityAt: now - 5000,
    },
    fetchImpl: async () => {
      requestCount += 1;
      throw new Error('a blocked replacement must not request another greeting');
    },
  });

  context.document.dispatchEvent(
    new context.CustomEvent('algolia-engagement-signal', {
      detail: { name: 'scroll_depth', path: context.location.pathname },
    })
  );
  await flushAsyncControllerWork();

  const state = JSON.parse(sessionStorage.getItem('algolia_proactive_state'));
  assert.equal(opportunity(context).reason, 'chat_already_open');
  assert.equal(requestCount, 0);
  assert.equal(chatEngagements.length, 0);
  assert.equal(state.opportunities.length, 2);
  assert.deepEqual(
    state.opportunities.map(({ id, status }) => ({ id, status })),
    [
      { id: 'opp_older_low', status: 'shown' },
      { id: 'opp_newer_high', status: 'shown' },
    ]
  );
});

test('a closed unengaged greeting is superseded in stored state by a stronger transition', async () => {
  const now = Date.now();
  const { sessionStorage, chatEngagements } = createHarness({
    proactiveConfig: {
      greetingsAgentId: 'greeting_agent_123',
      appId: '0EXRPAXB56',
      apiKey: 'search_key',
    },
    locationPath: '/doc/guides/ai-recommendations/getting-started/',
    pages: [
      page({
        pageId: 'page_product',
        path: '/products/ai-recommendations',
        pageGroup: 'product',
        topic: 'recommendations',
        productFocus: 'recommendations',
        productFocusLabel: 'AI Recommendations',
        dwellMs: 10000,
        maxScrollDepth: 50,
      }),
      page({
        pageId: 'page_current',
        path: '/doc/guides/ai-recommendations/getting-started/',
        pageGroup: 'documentation',
        topic: 'implementation',
        dwellMs: 10000,
        maxScrollDepth: 50,
      }),
    ],
    events: [
      event({ eventId: 'evt_open', name: 'chat_open', path: '/products/ai-recommendations', ts: now - 20000, props: { open: true } }),
      event({ eventId: 'evt_close', name: 'chat_open', path: '/products/ai-recommendations', ts: now - 19000, props: { open: false } }),
    ],
    state: {
      schema: 'AlgoliaProactiveState.v1',
      opportunities: [{
        id: 'opp_first',
        status: 'shown',
        shownAt: now - 20000,
        pageId: 'page_product',
        moment: 'product_research',
        trigger: 'product_page_10s_50_scroll',
        priority: 66,
      }],
      lastOpportunityAt: now - 20000,
    },
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body);
      const packet = JSON.parse(body.messages[0].parts[0].text.replace(/^PROACTIVE_GREETING_REQUEST\n/, ''));
      return {
        ok: true,
        text: async () => JSON.stringify({
          schema: 'ProactiveGreetingResponse.v1',
          opportunityId: packet.opportunityId,
          greeting: 'You made it from product promise to implementation reality. Want the clean version of what fits, what bends, and what needs planning?',
          chips: ['Show implementation fit'],
          handoffSummary: {
            moment: packet.moment,
            trigger: packet.trigger,
            messageGoal: packet.messageGoal,
          },
        }),
      };
    },
  });

  await flushAsyncControllerWork();

  const state = JSON.parse(sessionStorage.getItem('algolia_proactive_state'));
  assert.equal(state.opportunities.length, 2);
  assert.equal(state.opportunities[0].status, 'superseded');
  assert.equal(state.opportunities[0].supersededByTrigger, 'product_to_documentation');
  assert.deepEqual(
    Array.from(state.opportunities[0].lifecycle),
    ['shown', 'superseded']
  );
  assert.equal(state.opportunities[1].status, 'shown');
  assert.equal(state.opportunities[1].trigger, 'product_to_documentation');
  assert.equal(chatEngagements.length, 1);
});

test('search to docs does not bypass the canonical developer depth rule', () => {
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
        maxScrollDepth: 0,
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

  assert.equal(decision.engage, false);
  assert.equal(decision.reason, 'no_trigger_match');
});

test('resource depth requires 10 visible seconds and 50 percent scroll', () => {
  for (const [dwellMs, maxScrollDepth, expected] of [
    [10000, 49, false],
    [9999, 50, false],
    [10000, 50, true],
  ]) {
    const { context } = createHarness({
      locationPath: '/resources/guides/search-platform-evaluation',
      pages: [page({
        pageId: 'page_current',
        path: '/resources/guides/search-platform-evaluation',
        pageGroup: 'resource',
        topic: 'search_platform_evaluation',
        dwellMs,
        maxScrollDepth,
      })],
    });
    const decision = opportunity(context);
    assert.equal(decision.engage, expected);
    if (expected) assert.equal(decision.trigger, 'resource_page_10s_50_scroll');
  }
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

test('emits one opportunity per page and moment from engagement signals', async () => {
  const { context, documentEvents, sessionStorage } = createHarness({
    contextEngineConfig: { conciergeAgentId: 'greeting_agent_123' },
    pages: [
      page({
        pageId: 'page_current',
        path: '/products/ai-recommendations',
        pageGroup: 'product',
        topic: 'ai_search',
        dwellMs: 15000,
        maxScrollDepth: 50,
      }),
    ],
    events: [
      event({ eventId: 'evt_page', name: 'page_view', path: '/products/ai-recommendations' }),
      event({ eventId: 'evt_scroll', name: 'scroll_depth', path: '/products/ai-recommendations', props: { depth: 50 } }),
    ],
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body);
      const packet = JSON.parse(body.messages[0].parts[0].text.replace(/^PROACTIVE_GREETING_REQUEST\n/, ''));
      return {
        ok: true,
        text: async () =>
          JSON.stringify({
            schema: 'ProactiveGreetingResponse.v1',
            opportunityId: packet.opportunityId,
            greeting: 'Looks like AI recommendations are on your radar. Want to compare the practical tradeoffs?',
            chips: ['Compare tradeoffs'],
            handoffSummary: {
              moment: packet.moment,
              trigger: packet.trigger,
              messageGoal: packet.messageGoal,
            },
          }),
      };
    },
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
  await flushAsyncControllerWork();

  const opportunities = documentEvents.filter((evt) => evt.type === 'algolia-proactive-opportunity');
  const state = JSON.parse(sessionStorage.getItem('algolia_proactive_state'));

  assert.equal(opportunities.length, 1);
  assert.equal(opportunities[0].detail.moment, 'product_research');
  assert.equal(state.opportunities.length, 1);
  assert.equal(state.opportunities[0].status, 'shown');
});

test('uses the canonical qualified to pending to shown lifecycle', async () => {
  const { context, sessionStorage } = createHarness({
    proactiveConfig: {
      greetingsAgentId: 'greeting_agent_123',
      appId: '0EXRPAXB56',
      apiKey: 'search_key',
      cooldownMs: 0,
    },
    pages: [
      page({
        pageId: 'page_current',
        path: '/products/ai-search',
        pageGroup: 'product',
        topic: 'ai_search',
        dwellMs: 10000,
        maxScrollDepth: 50,
      }),
    ],
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body);
      const packet = JSON.parse(body.messages[0].parts[0].text.replace(/^PROACTIVE_GREETING_REQUEST\n/, ''));
      return {
        ok: true,
        text: async () => JSON.stringify({
          schema: 'ProactiveGreetingResponse.v1',
          opportunityId: packet.opportunityId,
          greeting: 'AI Search has your attention. Want to separate the bright and shiny from what moves the needle?',
          chips: ['Show practical value'],
          handoffSummary: {
            moment: packet.moment,
            trigger: packet.trigger,
            messageGoal: packet.messageGoal,
          },
        }),
      };
    },
  });

  await flushAsyncControllerWork();

  const state = JSON.parse(sessionStorage.getItem('algolia_proactive_state'));
  assert.equal(state.opportunities[0].status, 'shown');
  assert.deepEqual(Array.from(state.opportunities[0].lifecycle), ['qualified', 'pending', 'shown']);
});

test('expires a stale unengaged opportunity and records the terminal lifecycle state', () => {
  const now = Date.now();
  const { context, sessionStorage } = createHarness({
    proactiveConfig: {
      opportunityTtlMs: 1000,
    },
    pages: [
      page({
        pageId: 'page_current',
        path: '/products/ai-search',
        pageGroup: 'product',
        topic: 'ai_search',
        dwellMs: 10000,
        maxScrollDepth: 50,
      }),
    ],
    state: {
      schema: 'AlgoliaProactiveState.v1',
      opportunities: [{
        id: 'opp_stale',
        status: 'shown',
        lifecycle: ['qualified', 'pending', 'shown'],
        pageId: 'page_previous',
        pagePath: '/products/ai-recommendations',
        moment: 'product_research',
        trigger: 'product_page_10s_50_scroll',
        priority: 66,
        createdAt: now - 5000,
        shownAt: now - 4000,
      }],
    },
  });

  context.algoliaProactiveController.evaluate();

  const state = JSON.parse(sessionStorage.getItem('algolia_proactive_state'));
  assert.equal(state.opportunities[0].status, 'expired');
  assert.ok(state.opportunities[0].expiredAt >= now);
  assert.deepEqual(
    Array.from(state.opportunities[0].lifecycle),
    ['qualified', 'pending', 'shown', 'expired']
  );
});

test('records a shown greeting as dismissed when the visitor closes it', () => {
  const now = Date.now();
  const { context, sessionStorage } = createHarness({
    state: {
      schema: 'AlgoliaProactiveState.v1',
      opportunities: [{
        id: 'opp_shown',
        status: 'shown',
        lifecycle: ['qualified', 'pending', 'shown'],
        pageId: 'page_current',
        pagePath: '/products/ai-search',
        moment: 'product_research',
        trigger: 'product_page_10s_50_scroll',
        priority: 66,
        createdAt: now,
        shownAt: now,
      }],
    },
  });

  context.document.dispatchEvent(
    new context.CustomEvent('algolia-chat-open-change', {
      detail: { open: false },
    })
  );

  const state = JSON.parse(sessionStorage.getItem('algolia_proactive_state'));
  assert.equal(state.opportunities[0].status, 'dismissed');
  assert.ok(state.opportunities[0].dismissedAt >= now);
  assert.deepEqual(
    Array.from(state.opportunities[0].lifecycle),
    ['qualified', 'pending', 'shown', 'dismissed']
  );
});

test('dismissed source greetings suppress same-page duplicates without blocking a new pricing page', async () => {
  const cases = [
    {
      name: 'product to pricing',
      source: page({
        pageId: 'page_product',
        path: '/products/ai-search',
        pageGroup: 'product',
        topic: 'ai_search',
        productFocus: 'ai_search',
        productFocusLabel: 'AI Search',
        dwellMs: 10000,
        maxScrollDepth: 50,
      }),
      sourceTrigger: 'product_page_10s_50_scroll',
      destinationTrigger: 'product_to_pricing',
    },
    {
      name: 'solution to pricing',
      source: page({
        pageId: 'page_solution',
        path: '/solutions/ecommerce',
        pageGroup: 'solution',
        topic: 'commerce',
        solutionFocus: 'commerce',
        solutionFocusLabel: 'Commerce',
        dwellMs: 10000,
        maxScrollDepth: 50,
      }),
      sourceTrigger: 'solution_page_10s_50_scroll',
      destinationTrigger: 'solution_to_pricing',
    },
  ];

  for (const item of cases) {
    const requests = [];
    const { context, sessionStorage } = createHarness({
      locationPath: item.source.path,
      currentPageId: item.source.pageId,
      pages: [item.source],
      proactiveConfig: {
        greetingsAgentId: 'greeting_agent_123',
        appId: '0EXRPAXB56',
        apiKey: 'search_key',
        cooldownMs: 0,
      },
      fetchImpl: async (_url, init) => {
        const body = JSON.parse(init.body);
        const packet = JSON.parse(
          body.messages[0].parts[0].text.replace(/^PROACTIVE_GREETING_REQUEST\n/, '')
        );
        requests.push(packet);
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({
            schema: 'ProactiveGreetingResponse.v1',
            opportunityId: packet.opportunityId,
            greeting: 'Here is the useful version for this decision. Where should we start?',
            chips: ['Show the practical view'],
            handoffSummary: {
              moment: packet.moment,
              trigger: packet.trigger,
              messageGoal: packet.messageGoal,
            },
          }),
        };
      },
    });

    await flushAsyncControllerWork();
    assert.equal(requests.length, 1, `${item.name}: source request`);
    assert.equal(requests[0].trigger, item.sourceTrigger, `${item.name}: source trigger`);

    context.document.dispatchEvent(
      new context.CustomEvent('algolia-chat-open-change', { detail: { open: false } })
    );
    let state = JSON.parse(sessionStorage.getItem('algolia_proactive_state'));
    assert.equal(state.opportunities[0].status, 'dismissed', `${item.name}: dismissed`);

    context.document.dispatchEvent(
      new context.CustomEvent('algolia-engagement-signal', {
        detail: { name: 'nav_click', path: item.source.path },
      })
    );
    await flushAsyncControllerWork();

    state = JSON.parse(sessionStorage.getItem('algolia_proactive_state'));
    assert.equal(requests.length, 1, `${item.name}: no same-page fetch`);
    assert.equal(state.opportunities.length, 1, `${item.name}: no same-page opportunity`);

    const destinationPageId = `${item.source.pageId}_pricing`;
    const session = JSON.parse(sessionStorage.getItem('algolia_session'));
    session.currentPageId = destinationPageId;
    session.pages.push(page({
      pageId: destinationPageId,
      path: '/pricing',
      pageGroup: 'pricing',
      topic: 'pricing_and_usage',
    }));
    sessionStorage.setItem('algolia_session', JSON.stringify(session));
    context.location.pathname = '/pricing';
    context.location.href = 'https://www.algolia.com/pricing';

    context.document.dispatchEvent(
      new context.CustomEvent('algolia-engagement-signal', {
        detail: { name: 'nav_click', path: '/pricing' },
      })
    );
    await flushAsyncControllerWork();

    state = JSON.parse(sessionStorage.getItem('algolia_proactive_state'));
    assert.equal(requests.length, 2, `${item.name}: one destination fetch`);
    assert.equal(requests[1].currentPage.pageId, destinationPageId, `${item.name}: destination page`);
    assert.equal(requests[1].trigger, item.destinationTrigger, `${item.name}: destination trigger`);
    assert.equal(state.opportunities.length, 2, `${item.name}: one destination opportunity`);
    assert.equal(state.opportunities[1].status, 'shown', `${item.name}: destination shown`);
  }
});

test('does not expire or dismiss an active opportunity', () => {
  const now = Date.now();
  const { context, sessionStorage } = createHarness({
    proactiveConfig: {
      opportunityTtlMs: 1,
    },
    state: {
      schema: 'AlgoliaProactiveState.v1',
      opportunities: [{
        id: 'opp_active',
        status: 'active',
        lifecycle: ['qualified', 'pending', 'shown', 'engaged', 'handed_off', 'active'],
        pageId: 'page_current',
        pagePath: '/products/ai-search',
        moment: 'product_research',
        trigger: 'product_page_10s_50_scroll',
        priority: 66,
        createdAt: now - 5000,
        updatedAt: now - 4000,
      }],
    },
  });

  context.algoliaProactiveController.evaluate();
  context.document.dispatchEvent(
    new context.CustomEvent('algolia-chat-engagement-dismissed', {
      detail: { opportunityId: 'opp_active' },
    })
  );

  const state = JSON.parse(sessionStorage.getItem('algolia_proactive_state'));
  assert.equal(state.opportunities[0].status, 'active');
  assert.deepEqual(
    Array.from(state.opportunities[0].lifecycle),
    ['qualified', 'pending', 'shown', 'engaged', 'handed_off', 'active']
  );
});

test('retries the same qualified page moment after a greeting request fails', async () => {
  let requestCount = 0;
  const { context, sessionStorage, chatEngagements } = createHarness({
    proactiveConfig: {
      greetingsAgentId: 'greeting_agent_123',
      appId: '0EXRPAXB56',
      apiKey: 'search_key',
      cooldownMs: 0,
    },
    pages: [
      page({
        pageId: 'page_current',
        path: '/products/ai-search',
        pageGroup: 'product',
        topic: 'ai_search',
        dwellMs: 10000,
        maxScrollDepth: 50,
      }),
    ],
    fetchImpl: async (_url, init) => {
      requestCount += 1;
      if (requestCount === 1) return { ok: false, status: 503, text: async () => '' };
      const body = JSON.parse(init.body);
      const packet = JSON.parse(body.messages[0].parts[0].text.replace(/^PROACTIVE_GREETING_REQUEST\n/, ''));
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          schema: 'ProactiveGreetingResponse.v1',
          opportunityId: packet.opportunityId,
          greeting: 'AI Search has your attention. Want the practical version of where it earns its keep?',
          chips: ['Show practical value'],
          handoffSummary: {
            moment: packet.moment,
            trigger: packet.trigger,
            messageGoal: packet.messageGoal,
          },
        }),
      };
    },
  });

  await flushAsyncControllerWork();
  let state = JSON.parse(sessionStorage.getItem('algolia_proactive_state'));
  assert.equal(requestCount, 1);
  assert.equal(state.opportunities[0].status, 'failed');

  context.document.dispatchEvent(
    new context.CustomEvent('algolia-engagement-signal', {
      detail: { name: 'page_dwell', path: '/products/ai-search' },
    })
  );
  await flushAsyncControllerWork();

  state = JSON.parse(sessionStorage.getItem('algolia_proactive_state'));
  assert.equal(requestCount, 2);
  assert.equal(chatEngagements.length, 1);
  assert.equal(state.opportunities.length, 1);
  assert.equal(state.opportunities[0].status, 'shown');
  assert.deepEqual(
    Array.from(state.opportunities[0].lifecycle),
    ['qualified', 'pending', 'failed', 'pending', 'shown']
  );
});

test('retries the same opportunity when the chat widget becomes ready after qualification', async () => {
  let widgetReady = false;
  let requestCount = 0;
  const { context, sessionStorage, chatEngagements } = createHarness({
    chatAvailable: () => widgetReady,
    proactiveConfig: {
      greetingsAgentId: 'greeting_agent_123',
      appId: '0EXRPAXB56',
      apiKey: 'search_key',
      cooldownMs: 0,
    },
    pages: [
      page({
        pageId: 'page_current',
        path: '/products/ai-search',
        pageGroup: 'product',
        topic: 'ai_search',
        dwellMs: 10000,
        maxScrollDepth: 50,
      }),
    ],
    fetchImpl: async (_url, init) => {
      requestCount += 1;
      const body = JSON.parse(init.body);
      const packet = JSON.parse(body.messages[0].parts[0].text.replace(/^PROACTIVE_GREETING_REQUEST\n/, ''));
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          schema: 'ProactiveGreetingResponse.v1',
          opportunityId: packet.opportunityId,
          greeting: 'AI Search has your attention. Want the practical version of where it earns its keep?',
          chips: ['Show practical value'],
          handoffSummary: {
            moment: packet.moment,
            trigger: packet.trigger,
            messageGoal: packet.messageGoal,
          },
        }),
      };
    },
  });

  await flushAsyncControllerWork();
  let state = JSON.parse(sessionStorage.getItem('algolia_proactive_state'));
  const opportunityId = state.opportunities[0].id;
  assert.equal(requestCount, 1);
  assert.equal(state.opportunities[0].status, 'failed');
  assert.equal(state.opportunities[0].failureReason, 'widget_unavailable');

  widgetReady = true;
  context.document.dispatchEvent(
    new context.CustomEvent('algolia-engagement-signal', {
      detail: { name: 'page_dwell', path: '/products/ai-search' },
    })
  );
  await flushAsyncControllerWork();

  state = JSON.parse(sessionStorage.getItem('algolia_proactive_state'));
  assert.equal(requestCount, 2);
  assert.equal(chatEngagements.length, 1);
  assert.equal(state.opportunities.length, 1);
  assert.equal(state.opportunities[0].id, opportunityId);
  assert.equal(state.opportunities[0].status, 'shown');
  assert.deepEqual(
    Array.from(state.opportunities[0].lifecycle),
    ['qualified', 'pending', 'failed', 'pending', 'shown']
  );
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
        dwellMs: 15000,
        maxScrollDepth: 50,
      }),
    ],
    events: [
      event({ eventId: 'evt_page', name: 'page_view', path: '/products/ai-recommendations' }),
      event({ eventId: 'evt_chat', name: 'chat_open', path: '/products/ai-recommendations' }),
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

test('an active persisted conversation suppresses a new proactive greeting after navigation', () => {
  const { context } = createHarness({
    pages: [
      page({
        pageId: 'page_current',
        path: '/products/ai-recommendations',
        pageGroup: 'product',
        topic: 'ai_search',
        dwellMs: 15000,
        maxScrollDepth: 50,
      }),
    ],
    initialSession: {
      'algolia-chat:conversation': JSON.stringify({
        version: 1,
        conversationId: 'conversation_1',
        turns: [{ id: 'turn_1' }],
      }),
    },
  });

  assert.equal(opportunity(context).reason, 'conversation_already_active');
});

test('an active conversation that was open is restored after navigation', () => {
  const { context, chatOpens } = createHarness({
    pages: [
      page({
        pageId: 'page_source',
        path: '/products/ai-recommendations',
        pageGroup: 'product',
        topic: 'ai_search',
        dwellMs: 15000,
        maxScrollDepth: 50,
      }),
      page({
        pageId: 'page_current',
        path: '/pricing',
        pageGroup: 'pricing',
        topic: 'pricing',
      }),
    ],
    events: [
      event({
        eventId: 'evt_chat_open',
        name: 'chat_open',
        path: '/products/ai-recommendations',
        pageId: 'page_source',
        ts: 1786750000000,
        props: { open: true },
      }),
      event({
        eventId: 'evt_destination',
        name: 'page_view',
        path: '/pricing',
        ts: 1786750001000,
      }),
    ],
    initialSession: {
      'algolia-chat:conversation': JSON.stringify({
        version: 1,
        conversationId: 'conversation_1',
        turns: [{ id: 'turn_1' }],
      }),
    },
  });

  context.document.dispatchEvent(
    new context.CustomEvent('algolia-engagement-signal', {
      detail: { name: 'controller_ready', path: '/pricing' },
    })
  );

  assert.equal(chatOpens.length, 1);
  assert.equal(opportunity(context).reason, 'conversation_already_active');
});

test('an active conversation that was closed stays closed after navigation', () => {
  const { context, chatOpens } = createHarness({
    pages: [
      page({
        pageId: 'page_source',
        path: '/products/ai-recommendations',
        pageGroup: 'product',
        topic: 'ai_search',
        dwellMs: 15000,
        maxScrollDepth: 50,
      }),
      page({
        pageId: 'page_current',
        path: '/pricing',
        pageGroup: 'pricing',
        topic: 'pricing',
      }),
    ],
    events: [
      event({
        eventId: 'evt_chat_open',
        name: 'chat_open',
        path: '/products/ai-recommendations',
        pageId: 'page_source',
        ts: 1786750000000,
        props: { open: true },
      }),
      event({
        eventId: 'evt_chat_close',
        name: 'chat_open',
        path: '/products/ai-recommendations',
        pageId: 'page_source',
        ts: 1786750000500,
        props: { open: false },
      }),
      event({
        eventId: 'evt_destination',
        name: 'page_view',
        path: '/pricing',
        ts: 1786750001000,
      }),
    ],
    initialSession: {
      'algolia-chat:conversation': JSON.stringify({
        version: 1,
        conversationId: 'conversation_1',
        turns: [{ id: 'turn_1' }],
      }),
    },
  });

  context.document.dispatchEvent(
    new context.CustomEvent('algolia-engagement-signal', {
      detail: { name: 'controller_ready', path: '/pricing' },
    })
  );

  assert.equal(chatOpens.length, 0);
});

test('a chat-open event from the previous page does not suppress the current-page journey', () => {
  const { context } = createHarness({
    pages: [
      page({
        pageId: 'page_current',
        path: '/products/ai-recommendations',
        pageGroup: 'product',
        topic: 'ai_search',
        dwellMs: 15000,
        maxScrollDepth: 50,
      }),
    ],
    events: [
      event({ eventId: 'evt_chat', name: 'chat_open', path: '/pricing', ts: 1786749999000, props: { open: true } }),
      event({ eventId: 'evt_page', name: 'page_view', path: '/products/ai-recommendations', ts: 1786750000000 }),
    ],
  });

  const decision = opportunity(context);
  assert.equal(decision.engage, true);
  assert.equal(decision.trigger, 'product_page_10s_50_scroll');
});

test('debug trace can be enabled persistently from localStorage without URL flags', () => {
  const { context, documentEvents } = createHarness({
    initialLocal: { algoliaDebug: '1' },
    pages: [
      page({
        pageId: 'page_current',
        path: '/products/ai-recommendations',
        pageGroup: 'product',
        topic: 'ai_search',
        dwellMs: 15000,
        maxScrollDepth: 50,
      }),
    ],
    events: [
      event({ eventId: 'evt_page', name: 'page_view', path: '/products/ai-recommendations' }),
      event({ eventId: 'evt_chat', name: 'chat_open', path: '/products/ai-recommendations' }),
    ],
  });

  context.document.dispatchEvent(
    new context.CustomEvent('algolia-engagement-signal', {
      detail: { name: 'page_dwell', path: '/products/ai-recommendations' },
    })
  );

  const suppression = documentEvents.find((evt) => evt.type === 'algolia-proactive-suppressed');
  assert.equal(suppression.detail.reason, 'chat_already_open');
  assert.ok(context.algoliaProactiveController.debug().trace.some((entry) => entry.stage === 'suppressed'));
});


test('trigger grammar contains exactly the eight canonical journeys', () => {
  const cases = [
    {
      name: 'product depth',
      locationPath: '/products/ai-recommendations',
      pages: [page({ pageId: 'page_current', path: '/products/ai-recommendations', pageGroup: 'product', topic: 'ai_search', dwellMs: 10000, maxScrollDepth: 50 })],
      expected: 'product_page_10s_50_scroll',
    },
    {
      name: 'product to documentation',
      locationPath: '/doc/guides/building-search-ui/what-is-instantsearch/js/',
      pages: [
        page({ pageId: 'page_product', path: '/products/ai-search', pageGroup: 'product', topic: 'ai_search', dwellMs: 10000, maxScrollDepth: 50 }),
        page({ pageId: 'page_current', path: '/doc/guides/building-search-ui/what-is-instantsearch/js/', pageGroup: 'documentation', topic: 'implementation', dwellMs: 10000, maxScrollDepth: 50 }),
      ],
      expected: 'product_to_documentation',
    },
    {
      name: 'solution depth',
      locationPath: '/solutions/ecommerce',
      pages: [page({ pageId: 'page_current', path: '/solutions/ecommerce', pageGroup: 'solution', topic: 'commerce', dwellMs: 10000, maxScrollDepth: 50 })],
      expected: 'solution_page_10s_50_scroll',
    },
    {
      name: 'solution to proof',
      locationPath: '/customers/lacoste',
      pages: [
        page({ pageId: 'page_solution', path: '/solutions/ecommerce', pageGroup: 'solution', topic: 'commerce', dwellMs: 10000, maxScrollDepth: 50 }),
        page({ pageId: 'page_current', path: '/customers/lacoste', pageGroup: 'customer_story', topic: 'customer_proof', dwellMs: 10000, maxScrollDepth: 50 }),
      ],
      expected: 'solution_to_customer_story',
    },
    {
      name: 'product to pricing',
      locationPath: '/pricing',
      pages: [
        page({ pageId: 'page_product', path: '/products/ai-recommendations', pageGroup: 'product', topic: 'ai_search', dwellMs: 10000, maxScrollDepth: 50 }),
        page({ pageId: 'page_current', path: '/pricing', pageGroup: 'pricing', topic: 'pricing_and_usage' }),
      ],
      expected: 'product_to_pricing',
    },
    {
      name: 'solution to pricing',
      locationPath: '/pricing',
      pages: [
        page({ pageId: 'page_solution', path: '/solutions/ecommerce', pageGroup: 'solution', topic: 'commerce', dwellMs: 10000, maxScrollDepth: 50 }),
        page({ pageId: 'page_current', path: '/pricing', pageGroup: 'pricing', topic: 'pricing_and_usage' }),
      ],
      expected: 'solution_to_pricing',
    },
    {
      name: 'developer depth',
      locationPath: '/developers',
      pages: [page({ pageId: 'page_current', path: '/developers', pageGroup: 'developer', topic: 'implementation', dwellMs: 10000, maxScrollDepth: 50 })],
      expected: 'developer_page_10s_50_scroll',
    },
    {
      name: 'resource depth',
      locationPath: '/resources/guides/search-platform-evaluation',
      pages: [page({ pageId: 'page_current', path: '/resources/guides/search-platform-evaluation', pageGroup: 'resource', topic: 'evaluation', dwellMs: 10000, maxScrollDepth: 50 })],
      expected: 'resource_page_10s_50_scroll',
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

test('legacy trigger paths do not create opportunities', () => {
  const cases = [
    {
      name: 'unqualified product to pricing',
      locationPath: '/pricing',
      pages: [
        page({ pageId: 'page_product', path: '/products/ai-search', pageGroup: 'product', topic: 'ai_search', dwellMs: 9999, maxScrollDepth: 50 }),
        page({ pageId: 'page_current', path: '/pricing', pageGroup: 'pricing', topic: 'pricing_and_usage', dwellMs: 9000 }),
      ],
    },
    {
      name: 'implementation to pricing',
      locationPath: '/pricing',
      pages: [
        page({ pageId: 'page_docs', path: '/doc/guides/building-search-ui/what-is-instantsearch/js/', pageGroup: 'documentation', topic: 'implementation', dwellMs: 10000, maxScrollDepth: 50 }),
        page({ pageId: 'page_current', path: '/pricing', pageGroup: 'pricing', topic: 'pricing_and_usage', dwellMs: 9000 }),
      ],
    },
    {
      name: 'product to customer story',
      locationPath: '/customers/lacoste',
      pages: [
        page({ pageId: 'page_product', path: '/products/ai-search', pageGroup: 'product', topic: 'ai_search', dwellMs: 10000, maxScrollDepth: 50 }),
        page({ pageId: 'page_current', path: '/customers/lacoste', pageGroup: 'customer_story', topic: 'customer_proof', dwellMs: 10000, maxScrollDepth: 50 }),
      ],
    },
    {
      name: 'standalone pricing dwell',
      locationPath: '/pricing',
      pages: [page({ pageId: 'page_current', path: '/pricing', pageGroup: 'pricing', topic: 'pricing_and_usage', dwellMs: 30000, maxScrollDepth: 100 })],
    },
    {
      name: 'two shallow product pages',
      locationPath: '/products/ai-recommendations',
      pages: [
        page({ pageId: 'page_product', path: '/products/ai-search', pageGroup: 'product', topic: 'ai_search', dwellMs: 4000 }),
        page({ pageId: 'page_current', path: '/products/ai-recommendations', pageGroup: 'product', topic: 'recommendations', dwellMs: 4000 }),
      ],
    },
  ];

  for (const item of cases) {
    const { context } = createHarness({ locationPath: item.locationPath, pages: item.pages });
    const decision = opportunity(context);
    assert.equal(decision.engage, false, item.name);
    assert.equal(decision.reason, 'no_trigger_match', item.name);
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

test('faq to pricing never invents a standalone pricing trigger', () => {
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
  assert.equal(opportunity(atThreshold.context).engage, false);
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
        maxScrollDepth: 50,
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

test('controller accepts white-glove concierge greetings that are specific and option-rich', async () => {
  const conciergeGreeting =
    'Hello, explorer. AI Search, Personalization, and Recommendations solve different jobs, so shall we compare the options, look at customer proof, or go straight into implementation reality?';
  const { context, chatEngagements, sessionStorage } = createHarness({
    proactiveConfig: {
      greetingsAgentId: 'greeting_agent_123',
      appId: '0EXRPAXB56',
      apiKey: 'search_key',
    },
    locationPath: '/pricing',
    pages: [
      page({
        pageId: 'page_ai_search',
        path: '/products/ai-search',
        title: 'AI Search',
        pageGroup: 'product',
        topic: 'ai_search',
        productFocus: 'ai_search',
        productFocusLabel: 'AI Search',
        dwellMs: 10000,
        maxScrollDepth: 50,
      }),
      page({
        pageId: 'page_personalization',
        path: '/products/features/personalization',
        title: 'Personalization',
        pageGroup: 'product',
        topic: 'ai_search',
        productFocus: 'personalization',
        productFocusLabel: 'Personalization',
        dwellMs: 10000,
        maxScrollDepth: 50,
      }),
      page({
        pageId: 'page_recommendations',
        path: '/products/ai-recommendations',
        title: 'AI Recommendations',
        pageGroup: 'product',
        topic: 'ai_search',
        productFocus: 'recommendations',
        productFocusLabel: 'AI Recommendations',
        dwellMs: 10000,
        maxScrollDepth: 50,
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
      const body = JSON.parse(init.body);
      const packet = JSON.parse(body.messages[0].parts[0].text.replace(/^PROACTIVE_GREETING_REQUEST\n/, ''));
      return {
        ok: true,
        text: async () =>
          JSON.stringify({
            schema: 'ProactiveGreetingResponse.v1',
            opportunityId: packet.opportunityId,
            greeting: conciergeGreeting,
            chips: ['Show customer examples', 'Compare the options', 'Go deeper'],
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

  assert.equal(chatEngagements.length, 1);
  assert.equal(chatEngagements[0].greeting, conciergeGreeting);
  assert.deepEqual(Array.from(chatEngagements[0].suggestions), [
    'Show customer examples',
    'Compare the options',
    'Go deeper',
  ]);
  const state = JSON.parse(sessionStorage.getItem('algolia_proactive_state'));
  assert.equal(state.opportunities[0].status, 'shown');
});

test('controller compacts greetings longer than the two-sentence popup contract', async () => {
  const { chatEngagements, sessionStorage } = createHarness({
    proactiveConfig: {
      greetingsAgentId: 'greeting_agent_123',
      appId: '0EXRPAXB56',
      apiKey: 'search_key',
    },
    locationPath: '/pricing',
    pages: [
      page({ pageId: 'page_product', path: '/products/search', pageGroup: 'product', topic: 'search', dwellMs: 12000, maxScrollDepth: 50 }),
      page({ pageId: 'page_current', path: '/pricing', pageGroup: 'pricing', topic: 'pricing_and_usage' }),
    ],
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body);
      const packet = JSON.parse(body.messages[0].parts[0].text.replace(/^PROACTIVE_GREETING_REQUEST\n/, ''));
      return {
        ok: true,
        text: async () => JSON.stringify({
          schema: 'ProactiveGreetingResponse.v1',
          opportunityId: packet.opportunityId,
          greeting: 'Pricing has entered the chat. Let us make the cost drivers useful. Where should we begin?',
          chips: ['Explain cost drivers'],
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

  assert.equal(chatEngagements.length, 1);
  assert.equal(
    chatEngagements[0].greeting,
    'Pricing has entered the chat. Let us make the cost drivers useful.'
  );
  const state = JSON.parse(sessionStorage.getItem('algolia_proactive_state'));
  assert.equal(state.opportunities[0].status, 'shown');
  assert.equal(state.opportunities[0].failureReason, null);
  assert.equal(state.opportunities[0].normalizationReason, 'greeting_compacted_to_two_sentences');
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
        maxScrollDepth: 50,
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

test('controller reads greeting agent id directly from algolia-chat-engage before engage script configures globals', async () => {
  const fetchCalls = [];
  const { chatEngagements } = createHarness({
    engageAttrs: {
      'concierge-agent-id': 'dom_greeting_agent_123',
    },
    locationPath: '/pricing',
    pages: [
      page({ pageId: 'page_product', path: '/products/search', pageGroup: 'product', topic: 'search', dwellMs: 12000, maxScrollDepth: 50 }),
      page({ pageId: 'page_current', path: '/pricing', pageGroup: 'pricing', topic: 'pricing_and_usage' }),
    ],
    fetchImpl: async (url, init) => {
      fetchCalls.push({ url: String(url), init });
      const body = JSON.parse(init.body);
      const packet = JSON.parse(body.messages[0].parts[0].text.replace(/^PROACTIVE_GREETING_REQUEST\n/, ''));
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            schema: 'ProactiveGreetingResponse.v1',
            opportunityId: packet.opportunityId,
            greeting: 'Pricing after product research is where the spreadsheet joins the party. Want the practical cost story?',
            chips: ['Cost drivers', 'Implementation effort'],
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
  assert.match(fetchCalls[0].url, /agents\/dom_greeting_agent_123\/completions/);
  assert.equal(chatEngagements.length, 1);
});

test('controller can use algolia-chat credentials when instant search is absent', async () => {
  const fetchCalls = [];
  const { chatEngagements } = createHarness({
    instantSearch: false,
    chatAttrs: {
      'app-id': '0EXRPAXB56',
      'search-api-key': 'chat_search_key',
    },
    engageAttrs: {
      'concierge-agent-id': 'dom_greeting_agent_123',
    },
    locationPath: '/solutions/ecommerce',
    pages: [
      page({
        pageId: 'page_current',
        path: '/solutions/ecommerce',
        pageGroup: 'solution',
        topic: 'commerce',
        solutionFocus: 'commerce',
        solutionFocusLabel: 'Commerce',
        dwellMs: 15000,
        maxScrollDepth: 50,
      }),
    ],
    fetchImpl: async (url, init) => {
      fetchCalls.push({ url: String(url), init });
      const body = JSON.parse(init.body);
      const packet = JSON.parse(body.messages[0].parts[0].text.replace(/^PROACTIVE_GREETING_REQUEST\n/, ''));
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            schema: 'ProactiveGreetingResponse.v1',
            opportunityId: packet.opportunityId,
            greeting: 'Commerce pages are where the nice ideas meet the cart. Want the useful version of where Algolia helps?',
            chips: ['Show examples', 'Compare use cases'],
            handoffSummary: {
              moment: 'solution_research',
              trigger: 'solution_page_10s_50_scroll',
              messageGoal: 'explain_solution_fit',
            },
          }),
      };
    },
  });

  await flushAsyncControllerWork();

  assert.equal(fetchCalls.length, 1);
  assert.match(fetchCalls[0].init.headers['X-Algolia-API-Key'], /chat_search_key/);
  assert.equal(chatEngagements.length, 1);
});

test('debug trace records candidate, credential, request, and render pipeline stages', async () => {
  const { sessionStorage, chatEngagements } = createHarness({
    search: '?algoliaProactiveDebug=1',
    engageAttrs: {
      'concierge-agent-id': 'dom_greeting_agent_123',
    },
    locationPath: '/pricing',
    pages: [
      page({ pageId: 'page_product', path: '/products/search', pageGroup: 'product', topic: 'search', dwellMs: 12000, maxScrollDepth: 50 }),
      page({ pageId: 'page_current', path: '/pricing', pageGroup: 'pricing', topic: 'pricing_and_usage' }),
    ],
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body);
      const packet = JSON.parse(body.messages[0].parts[0].text.replace(/^PROACTIVE_GREETING_REQUEST\n/, ''));
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            schema: 'ProactiveGreetingResponse.v1',
            opportunityId: packet.opportunityId,
            greeting: 'Pricing after product research is where budget gravity kicks in. Want the clean version?',
            chips: ['Cost drivers'],
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

  assert.equal(chatEngagements.length, 1);
  const trace = JSON.parse(sessionStorage.getItem('algolia_proactive_debug_log'));
  const stages = trace.map((entry) => entry.stage);
  assert.ok(stages.includes('controller_installed'));
  assert.ok(stages.includes('signal_received'));
  assert.ok(stages.includes('candidates_evaluated'));
  assert.ok(stages.includes('pre_reserve_credentials_checked'));
  assert.ok(stages.includes('opportunity_reserved'));
  assert.ok(stages.includes('greeting_request_started'));
  assert.ok(stages.includes('greeting_response_http'));
  assert.ok(stages.includes('widget_rendered'));
});

test('debug status keeps a rendered greeting recognizable when later signals see the open chat', async () => {
  const currentPath = '/products/ai-recommendations';
  const { context, sessionStorage } = createHarness({
    search: '?algoliaProactiveDebug=1',
    locationPath: currentPath,
    pages: [
      page({
        pageId: 'page_current',
        path: currentPath,
        pageGroup: 'product',
        topic: 'ai_recommendations',
        dwellMs: 12000,
        maxScrollDepth: 50,
      }),
    ],
    proactiveConfig: {
      greetingsAgentId: 'greeting_agent_123',
      appId: '0EXRPAXB56',
      apiKey: 'search_key',
      cooldownMs: 0,
    },
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body);
      const packet = JSON.parse(body.messages[0].parts[0].text.replace(/^PROACTIVE_GREETING_REQUEST\n/, ''));
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          schema: 'ProactiveGreetingResponse.v1',
          opportunityId: packet.opportunityId,
          greeting: 'Recommendations deserve a closer look. Want to separate useful discovery from expensive decoration?',
          chips: ['Show the practical value'],
          handoffSummary: {
            moment: 'product_research',
            trigger: 'product_page_10s_50_scroll',
            messageGoal: 'explain_product_fit',
          },
        }),
      };
    },
  });

  await flushAsyncControllerWork();
  const events = JSON.parse(sessionStorage.getItem('algolia_events'));
  events.events.push(event({ eventId: 'evt_chat', name: 'chat_open', path: currentPath }));
  sessionStorage.setItem('algolia_events', JSON.stringify(events));

  context.document.dispatchEvent(
    new context.CustomEvent('algolia-engagement-signal', {
      detail: { name: 'page_dwell', path: currentPath },
    })
  );

  assert.equal(context.__algoliaProactiveLastSuppression.reason, 'chat_already_open');
  assert.equal(
    context.__algoliaProactiveLastStatus.message,
    'Proactive greeting active: product_page_10s_50_scroll'
  );
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
        maxScrollDepth: 50,
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
      page({ pageId: 'page_product', path: '/products/search', pageGroup: 'product', topic: 'search', dwellMs: 12000, maxScrollDepth: 50 }),
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
  assert.equal(state.opportunities[0].status, 'failed');
  assert.equal(state.opportunities[0].failureReason, 'opportunity_mismatch');
});

test('controller rejects greeting JSON wrapped in model prose', async () => {
  const { context, chatEngagements, sessionStorage } = createHarness({
    proactiveConfig: {
      greetingsAgentId: 'greeting_agent_123',
      appId: '0EXRPAXB56',
      apiKey: 'search_key',
    },
    locationPath: '/pricing',
    pages: [
      page({ pageId: 'page_product', path: '/products/search', pageGroup: 'product', topic: 'search', dwellMs: 12000, maxScrollDepth: 50 }),
      page({ pageId: 'page_current', path: '/pricing', pageGroup: 'pricing', topic: 'pricing_and_usage' }),
    ],
    fetchImpl: async (_url, init) => {
      const request = JSON.parse(init.body);
      const packet = JSON.parse(request.messages[0].parts[0].text.replace(/^PROACTIVE_GREETING_REQUEST\n/, ''));
      const response = {
        schema: 'ProactiveGreetingResponse.v1',
        opportunityId: packet.opportunityId,
        greeting: 'Pricing after product research is where budget gravity arrives. Want the useful version?',
        chips: ['Explain cost drivers'],
        handoffSummary: {
          moment: 'commercial_evaluation',
          trigger: 'product_to_pricing',
          messageGoal: 'explain_cost_drivers',
        },
      };
      return { ok: true, text: async () => `Here is the JSON:\n${JSON.stringify(response)}` };
    },
  });

  await flushAsyncControllerWork();

  assert.equal(chatEngagements.length, 0);
  const state = JSON.parse(sessionStorage.getItem('algolia_proactive_state'));
  assert.equal(state.opportunities[0].status, 'failed');
  assert.equal(state.opportunities[0].failureReason, 'invalid_json');
});

test('controller accepts one validated greeting object wrapped in a JSON code fence', async () => {
  const { context, chatEngagements } = createHarness({
    proactiveConfig: {
      greetingsAgentId: 'greeting_agent_123',
      appId: '0EXRPAXB56',
      apiKey: 'search_key',
    },
    locationPath: '/pricing',
    pages: [
      page({ pageId: 'page_product', path: '/products/search', pageGroup: 'product', topic: 'search', dwellMs: 12000, maxScrollDepth: 50 }),
      page({ pageId: 'page_current', path: '/pricing', pageGroup: 'pricing', topic: 'pricing_and_usage' }),
    ],
    fetchImpl: async (_url, init) => {
      const request = JSON.parse(init.body);
      const packet = JSON.parse(request.messages[0].parts[0].text.replace(/^PROACTIVE_GREETING_REQUEST\n/, ''));
      const response = {
        schema: 'ProactiveGreetingResponse.v1',
        opportunityId: packet.opportunityId,
        greeting: 'Pricing after product research is where budget gravity arrives. Want the useful version?',
        chips: ['Explain cost drivers'],
        handoffSummary: {
          moment: 'commercial_evaluation',
          trigger: 'product_to_pricing',
          messageGoal: 'explain_cost_drivers',
        },
      };
      return { ok: true, text: async () => `\`\`\`json\n${JSON.stringify(response, null, 2)}\n\`\`\`` };
    },
  });

  await flushAsyncControllerWork();

  assert.equal(chatEngagements.length, 1);
  assert.match(chatEngagements[0].greeting, /budget gravity/);
  assert.deepEqual(Array.from(chatEngagements[0].suggestions), ['Explain cost drivers']);
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
      page({ pageId: 'page_product', path: '/products/search', pageGroup: 'product', topic: 'search', dwellMs: 12000, maxScrollDepth: 50 }),
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
