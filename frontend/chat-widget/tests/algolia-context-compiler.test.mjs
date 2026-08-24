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

function createHarness({ profile, session, events, locationPath = '/products/ai-recommendations', initialLocal = {}, search = '' } = {}) {
  const localStorage = new MemoryStorage({
    ...initialLocal,
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
      href: `https://www.algolia.com${locationPath}${search}`,
      origin: 'https://www.algolia.com',
      pathname: locationPath,
      search,
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

function existingContextForExactMergedBytes(compiler, targetBytes) {
  const existing = {};

  for (let index = 0; index < 32; index += 1) {
    const currentBytes = byteLength(JSON.stringify(compiler.mergeTurnContext(existing)));
    if (currentBytes === targetBytes) return existing;

    const key = `boundary_${index}`;
    const oneByteCandidate = { ...existing, [key]: 'x' };
    const oneByteTotal = byteLength(JSON.stringify(compiler.mergeTurnContext(oneByteCandidate)));
    const entryOverhead = oneByteTotal - currentBytes - 1;
    const valueBytes = Math.min(1024, targetBytes - currentBytes - entryOverhead);
    assert.ok(valueBytes > 0, `cannot construct an exact ${targetBytes}-byte context`);
    existing[key] = 'x'.repeat(valueBytes);
  }

  assert.fail(`could not construct an exact ${targetBytes}-byte context`);
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

test('exposes the immediate navigation edge while preserving the complete page trail', () => {
  const pages = [
    { pageId: 'product', path: '/products/ai-search', title: 'AI Search', pageGroup: 'product', topic: 'ai_search', dwellMs: 3000, maxScrollDepth: 30 },
    { pageId: 'resource', path: '/resources/guide', title: 'Guide', pageGroup: 'resource', topic: 'research', dwellMs: 1000, maxScrollDepth: 5 },
    {
      pageId: 'pricing', path: '/pricing', title: 'Pricing', pageGroup: 'pricing', topic: 'pricing_and_usage',
      navigationType: 'navigate', sourcePageId: 'resource', sourcePath: '/resources/guide',
      destinationPageId: 'pricing', destinationPath: '/pricing', edgeId: 'resource-to-pricing',
    },
  ];
  const { context } = createHarness({
    locationPath: '/pricing',
    session: { schema: 'AlgoliaEngagementSession.v1', sessionId: 'sess_123', startedAt: 1786750000000, currentPageId: 'pricing', pages, engagementHistory: [] },
  });
  const packet = context.algoliaContextCompiler.compile();

  assert.equal(packet.session.pages.length, 3);
  assert.equal(packet.session.currentEdge.sourcePageId, 'resource');
  assert.equal(packet.session.currentEdge.destinationPageId, 'pricing');
  assert.equal(packet.session.currentEdge.edgeId, 'resource-to-pricing');
  assert.equal(packet.session.currentEdge.isImmediate, true);
});

test('preserves product feature focus for downstream personalization', () => {
  const { context } = createHarness({
    locationPath: '/products/features/personalization',
    session: {
      schema: 'AlgoliaEngagementSession.v1',
      sessionId: 'sess_123',
      startedAt: 1786750000000,
      currentPageId: 'page_current',
      pages: [
        {
          pageId: 'page_current',
          path: '/products/features/personalization',
          title: 'Search Personalization',
          enteredAt: 1786750060000,
          dwellMs: 10000,
          maxScrollDepth: 50,
          pageGroup: 'product',
          topic: 'ai_search',
          productFocus: 'personalization',
          productFocusLabel: 'Personalization',
        },
      ],
      engagementHistory: [],
    },
  });

  const packet = context.algoliaContextCompiler.compile();
  const turnContext = context.algoliaContextCompiler.compileTurnContext();

  assert.equal(packet.currentPage.productFocus, 'personalization');
  assert.equal(packet.currentPage.productFocusLabel, 'Personalization');
  assert.equal(packet.observedSignals.currentProductFocus.value, 'personalization');
  assert.equal(turnContext.current_product_focus, 'observed:personalization');
  assert.equal(turnContext.current_product_focus_label, 'Personalization');
});

test('preserves solution focus for downstream personalization', () => {
  const { context } = createHarness({
    locationPath: '/solutions/ecommerce',
    session: {
      schema: 'AlgoliaEngagementSession.v1',
      sessionId: 'sess_123',
      startedAt: 1786750000000,
      currentPageId: 'page_current',
      pages: [
        {
          pageId: 'page_current',
          path: '/solutions/ecommerce',
          title: 'Ecommerce Site Search Solutions',
          enteredAt: 1786750060000,
          dwellMs: 10000,
          maxScrollDepth: 50,
          pageGroup: 'solution',
          topic: 'commerce',
          solutionFocus: 'commerce',
          solutionFocusLabel: 'Commerce',
        },
      ],
      engagementHistory: [],
    },
  });

  const packet = context.algoliaContextCompiler.compile();
  const turnContext = context.algoliaContextCompiler.compileTurnContext();

  assert.equal(packet.currentPage.solutionFocus, 'commerce');
  assert.equal(packet.currentPage.solutionFocusLabel, 'Commerce');
  assert.equal(packet.observedSignals.currentSolutionFocus.value, 'commerce');
  assert.equal(turnContext.current_solution_focus, 'observed:commerce');
  assert.equal(turnContext.current_solution_focus_label, 'Commerce');
});

test('classifies enterprise use-case context as a solution', () => {
  const { context } = createHarness({
    locationPath: '/use-cases/enterprise',
    session: {
      schema: 'AlgoliaEngagementSession.v1',
      sessionId: 'sess_enterprise',
      startedAt: 1786750000000,
      currentPageId: 'page_current',
      pages: [{
        pageId: 'page_current',
        path: '/use-cases/enterprise',
        title: 'Enterprise Search',
        enteredAt: 1786750060000,
        dwellMs: 3000,
        maxScrollDepth: 30,
      }],
      engagementHistory: [],
    },
  });

  const packet = context.algoliaContextCompiler.compile();

  assert.equal(packet.currentPage.pageGroup, 'solution');
  assert.equal(packet.currentPage.solutionFocus, 'enterprise');
  assert.equal(packet.currentPage.solutionFocusLabel, 'Enterprise');
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
  assert.equal(turnContext.recent_events, undefined);
  assert.equal(turnContext.current_dwell_seconds, undefined);
  assert.equal(turnContext.current_scroll_depth, undefined);
  assert.match(turnContext.qualified_journey, /pricing.*AI Recommendations/i);
  assert.doesNotMatch(serialized, /person@example.com/);
});

test('qualified journey summary uses the shared 3 second and 30 percent boundary', () => {
  const buildPage = (pageId, dwellMs, maxScrollDepth) => ({
    pageId,
    path: `/products/${pageId}`,
    title: pageId,
    enteredAt: 1786750000000,
    dwellMs,
    maxScrollDepth,
    pageGroup: 'product',
    topic: pageId,
  });
  const { context } = createHarness({
    session: {
      schema: 'AlgoliaEngagementSession.v1',
      sessionId: 'sess_123',
      startedAt: 1786750000000,
      currentPageId: 'qualified',
      pages: [
        buildPage('short-dwell', 2999, 30),
        buildPage('shallow-scroll', 3000, 29),
        buildPage('qualified', 3000, 30),
      ],
      engagementHistory: [],
    },
  });

  const qualifiedJourney = context.algoliaContextCompiler.compileTurnContext().qualified_journey;

  assert.match(qualifiedJourney, /qualified/);
  assert.doesNotMatch(qualifiedJourney, /short-dwell/);
  assert.doesNotMatch(qualifiedJourney, /shallow-scroll/);
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

test('prepared completion bodies bypass the interceptor without a second mutation', async () => {
  const { context } = createHarness();
  const compiler = context.algoliaContextCompiler;
  const input = JSON.stringify({
    id: 'conversation-1',
    messages: [{ id: 'user-1', role: 'user', parts: [{ type: 'text', text: 'Compare this' }] }],
  });

  const prepared = compiler.prepareCompletionBody(input);
  const response = await compiler.fetchPrepared(
    'https://0EXRPAXB56.algolia.net/agent-studio/1/agents/agent/completions',
    { method: 'POST', body: prepared },
  );

  assert.equal(response.options.body, prepared, 'terminal sender must preserve the exact string');
  const sent = JSON.parse(response.options.body);
  assert.equal(sent.messages[0].metadata.turnContext.persona, 'confirmed:developer');
});

test('rejects an oversized existing turnContext field instead of clipping it', () => {
  const { context } = createHarness();
  const body = JSON.stringify({
    messages: [
      {
        role: 'user',
        parts: [{ type: 'text', text: 'How hard is implementation?' }],
        metadata: { turnContext: { oversized_field: 'x'.repeat(1025) } },
      },
    ],
  });

  assert.throws(
    () => context.algoliaContextCompiler.injectTurnContextIntoBody(body),
    (error) => {
      assert.equal(error.code, 'turn_context_value_too_large');
      assert.equal(error.field, 'oversized_field');
      assert.equal(error.actualBytes, 1025);
      assert.equal(error.limitBytes, 1024);
      return true;
    },
  );

  const recorded = JSON.parse(context.sessionStorage.getItem('algolia_context_validation_error'));
  assert.equal(recorded.field, 'oversized_field');
  assert.equal(recorded.actualBytes, 1025);
});

test('rejects turnContext above the total byte limit and identifies the field that crossed it', () => {
  const { context } = createHarness();
  const existing = Object.fromEntries(
    Array.from({ length: 12 }, (_, index) => [`existing_${index}`, 'x'.repeat(350)]),
  );

  assert.throws(
    () => context.algoliaContextCompiler.mergeTurnContext(existing),
    (error) => {
      assert.equal(error.code, 'turn_context_total_too_large');
      assert.match(error.field, /^existing_/);
      assert.ok(error.actualBytes > 4096);
      assert.equal(error.limitBytes, 4096);
      return true;
    },
  );
});

test('accepts turnContext at exactly 4096 bytes', () => {
  const { context } = createHarness();
  const compiler = context.algoliaContextCompiler;
  const existing = existingContextForExactMergedBytes(compiler, 4096);

  const merged = compiler.mergeTurnContext(existing);

  assert.equal(byteLength(JSON.stringify(merged)), 4096);
});

test('rejects turnContext at exactly 4097 bytes', () => {
  const { context } = createHarness();
  const compiler = context.algoliaContextCompiler;
  const existing = existingContextForExactMergedBytes(compiler, 4096);
  const boundaryField = Object.keys(existing).at(-1);
  existing[boundaryField] += 'x';

  assert.throws(
    () => compiler.mergeTurnContext(existing),
    (error) => {
      assert.equal(error.code, 'turn_context_total_too_large');
      assert.equal(error.actualBytes, 4097);
      assert.equal(error.limitBytes, 4096);
      return true;
    },
  );
});

test('debug returns raw tracker state, rich packet, and flat turnContext', () => {
  const { context } = createHarness();

  const debug = context.algoliaContextCompiler.debug();

  assert.equal(debug.raw.profile.schema, 'AlgoliaEngagementProfile.v1');
  assert.equal(debug.compiled.schema, 'AlgoliaContextPacket.v1');
  assert.equal(debug.turnContext.persona, 'confirmed:developer');
});

test('debug mode can be enabled persistently from localStorage without URL flags', () => {
  const logs = [];
  const { context } = createHarness({ initialLocal: { algoliaDebug: '1' } });
  context.console = {
    ...console,
    log(...args) {
      logs.push(args);
    },
  };

  context.algoliaContextCompiler.debug();

  assert.ok(logs.some((args) => args[0] === '[Algolia Context Compiler]' && args[1] === 'debug'));
});
