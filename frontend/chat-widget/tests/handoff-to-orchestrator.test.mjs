import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createAnswerHarnessObserver } from '../source/shared/widget/answer-harness-observer.mjs';

const handoffPath = new URL('../handoff-to-orchestrator.js', import.meta.url);

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

function createHarness({
  proactiveState,
  compilerPacket,
  turnContext,
  primaryAgentId = 'orchestrator_123',
  initialLocal = {},
  search = '',
  fetchError = null,
  mergeError = null,
  answerHarness = null,
  handoffConfig = null,
} = {}) {
  const fetchCalls = [];
  const registeredTools = {};
  let registeredTransport = null;
  const logs = [];
  const sessionStorage = new MemoryStorage({
    ...(proactiveState ? { algolia_proactive_state: JSON.stringify(proactiveState) } : {}),
  });
  const localStorage = new MemoryStorage(initialLocal);
  const documentEvents = [];
  const documentListeners = {};
  const timers = [];
  const context = {
    console: {
      ...console,
      log(...args) {
        logs.push(args);
      },
    },
    URL,
    URLSearchParams,
    TextEncoder,
    TextDecoder,
    ReadableStream,
    Response,
    localStorage,
    sessionStorage,
    location: {
      href: `https://widget-test.example/pricing${search}`,
      origin: 'https://widget-test.example',
      pathname: '/pricing',
      search,
    },
    CustomEvent: class CustomEvent {
      constructor(type, options = {}) {
        this.type = type;
        this.detail = options.detail;
      }
    },
    document: {
      addEventListener(type, listener) {
        (documentListeners[type] ||= []).push(listener);
      },
      querySelector(selector) {
        if (selector === 'algolia-agent[role="primary"]') {
          return {
            getAttribute(name) {
              return name === 'agent-id' ? primaryAgentId : null;
            },
          };
        }
        return null;
      },
      dispatchEvent(event) {
        documentEvents.push(event);
        return true;
      },
    },
    fetch: async (url, init = {}) => {
      fetchCalls.push({ url: String(url), init });
      if (fetchError) throw fetchError;
      return { ok: true, status: 200, text: async () => 'ok' };
    },
    setTimeout(callback, ms) {
      const timer = { callback, ms, cleared: false };
      timers.push(timer);
      return timers.length;
    },
    clearTimeout(id) {
      if (timers[id - 1]) timers[id - 1].cleared = true;
    },
    algoliaChat: {
      registerTool(name, handler) {
        registeredTools[name] = handler;
      },
      setOrchestratorTransport(handler) {
        registeredTransport = handler;
      },
    },
    algoliaContextCompiler: {
      compile() {
        return compilerPacket || { schema: 'AlgoliaContextPacket.v1', currentPage: { path: '/pricing' } };
      },
      compileTurnContext() {
        return turnContext || { context_schema: 'AlgoliaTurnContext.v1', current_page: '/pricing' };
      },
      mergeTurnContext(existing = {}) {
        if (mergeError) throw mergeError;
        return { ...existing, ...(turnContext || { context_schema: 'AlgoliaTurnContext.v1', current_page: '/pricing' }) };
      },
    },
  };
  if (handoffConfig) context.ALGOLIA_HANDOFF_CONFIG = handoffConfig;
  if (answerHarness) context.algoliaAnswerHarness = answerHarness;
  context.window = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(handoffPath, 'utf8'), context);
  context.invokeTransport = (...args) => {
    if (typeof registeredTransport !== 'function') throw new Error('No orchestrator transport registered');
    return registeredTransport(...args);
  };
  return {
    context,
    fetchCalls,
    registeredTools,
    getRegisteredTransport: () => registeredTransport,
    sessionStorage,
    documentEvents,
    timers,
    resetVisitorState() {
      for (const listener of documentListeners['algolia-visitor-state-reset'] || []) {
        listener({ detail: { source: 'test' } });
      }
    },
    logs,
  };
}

function stateWithShownOpportunity() {
  return {
    schema: 'AlgoliaProactiveState.v1',
    opportunities: [
      {
        id: 'opp_1',
        status: 'shown',
        requestPacket: {
          schema: 'ProactiveGreetingRequest.v1',
          opportunityId: 'opp_1',
          moment: 'commercial_evaluation',
          trigger: 'product_to_pricing',
          messageGoal: 'explain_cost_drivers',
          currentPage: {
            pageId: 'page_pricing',
            path: '/pricing',
            title: 'Pricing',
            pageGroup: 'pricing',
          },
          currentNavigationEdge: {
            navigationType: 'navigate',
            sourcePageId: 'page_product',
            sourcePath: '/products/ai-search',
            destinationPageId: 'page_pricing',
            destinationPath: '/pricing',
            edgeId: 'page_product->page_pricing',
            isImmediate: true,
          },
          contextualFocus: {
            value: 'ai_search',
            label: 'AI Search',
            state: 'observed',
          },
          journeyContext: {
            currentTransition: 'product_to_pricing',
            origin: { pageId: 'page_product', path: '/products/ai-search', label: 'AI Search', pageGroup: 'product' },
            destination: { pageId: 'page_pricing', path: '/pricing', label: 'Pricing', pageGroup: 'pricing' },
            broaderJourney: {
              productTrail: [{ value: 'ai_search', label: 'AI Search', pagePath: '/products/ai-search' }],
              solutionTrail: [],
              pageTrail: [
                { pageId: 'page_product', path: '/products/ai-search', label: 'AI Search', pageGroup: 'product' },
                { pageId: 'page_pricing', path: '/pricing', label: 'Pricing', pageGroup: 'pricing' },
              ],
            },
            journeyNarrativeHint: 'AI Search interest has moved into cost and value evaluation.',
          },
        },
        greetingResponse: {
          schema: 'ProactiveGreetingResponse.v1',
          opportunityId: 'opp_1',
          greeting: 'Pricing pages are where good search ideas meet CFO gravity. Want the practical version?',
          chips: ['What drives cost?', 'API call counting', 'Which plan fits?'],
          handoffSummary: {
            moment: 'commercial_evaluation',
            trigger: 'product_to_pricing',
            messageGoal: 'explain_cost_drivers',
          },
        },
      },
    ],
    lastOpportunityAt: 1786750000000,
  };
}

function createDomNode(tagName = 'div') {
  let text = '';
  const node = {
    tagName: tagName.toUpperCase(),
    id: '',
    className: '',
    title: '',
    dataset: {},
    children: [],
    parentElement: null,
    parentNode: null,
    root: null,
    attributes: new Map(),
    get textContent() {
      return this.children.length ? this.children.map((child) => child.textContent).join('') : text;
    },
    set textContent(value) {
      text = String(value);
      this.children = [];
    },
    setAttribute(name, value) {
      this.attributes.set(name, String(value));
      if (name === 'id') this.id = String(value);
    },
    appendChild(child) {
      child.parentElement = this;
      child.parentNode = this;
      child.root = this.root;
      this.children.push(child);
      return child;
    },
    append(...children) {
      children.forEach((child) => this.appendChild(child));
    },
    prepend(child) {
      child.parentElement = this;
      child.parentNode = this;
      child.root = this.root;
      this.children.unshift(child);
      return child;
    },
    replaceChildren(...children) {
      text = '';
      this.children = [];
      children.forEach((child) => this.appendChild(child));
    },
    remove() {
      const siblings = this.parentElement?.children;
      if (!siblings) return;
      const index = siblings.indexOf(this);
      if (index >= 0) siblings.splice(index, 1);
      this.parentElement = null;
      this.parentNode = null;
    },
    getRootNode() {
      return this.root || this;
    },
    matches(selector) {
      if (selector.startsWith('#')) return this.id === selector.slice(1);
      if (selector.startsWith('.')) return String(this.className).split(/\s+/).includes(selector.slice(1));
      if (selector === '[data-algolia-answer-footer]') return !!this.dataset.algoliaAnswerFooter;
      return false;
    },
    querySelector(selector) {
      return this.querySelectorAll(selector)[0] || null;
    },
    querySelectorAll(selector) {
      const out = [];
      const visit = (candidate) => {
        if (candidate.matches?.(selector)) out.push(candidate);
        for (const child of candidate.children || []) visit(child);
      };
      for (const child of this.children) visit(child);
      return out;
    },
  };
  node.root = node;
  return node;
}

test('does not register a competing model-callable handoff tool', () => {
  const { registeredTools } = createHarness({ proactiveState: stateWithShownOpportunity() });

  assert.equal(registeredTools.handoff_to_orchestrator, undefined);
});

test('registers an explicit orchestrator transport without patching global fetch', () => {
  const { context, getRegisteredTransport } = createHarness({
    proactiveState: stateWithShownOpportunity(),
  });
  const nativeFetch = context.fetch;

  assert.equal(typeof getRegisteredTransport(), 'function');
  assert.equal(context.fetch, nativeFetch);
});

test('injects proactive handoff context into the next orchestrator turn', async () => {
  const proactiveState = stateWithShownOpportunity();
  const { context, fetchCalls, sessionStorage, documentEvents } = createHarness({
    proactiveState,
    primaryAgentId: 'orchestrator_123',
  });

  const body = {
    messages: [
      {
        role: 'user',
        parts: [{ type: 'text', text: 'What drives cost?' }],
      },
    ],
  };

  await context.invokeTransport('https://TESTAPP123.algolia.net/agent-studio/1/agents/orchestrator_123/completions?compatibilityMode=ai-sdk-5', {
    method: 'POST',
    body: JSON.stringify(body),
  });

  assert.equal(fetchCalls.length, 1);
  const sent = JSON.parse(fetchCalls[0].init.body);
  const text = sent.messages[0].parts[0].text;
  assert.match(text, /^What drives cost\?\n\nPROACTIVE_HANDOFF_CONTEXT\n/);
  const packet = JSON.parse(text.split('PROACTIVE_HANDOFF_CONTEXT\n')[1]);
  assert.equal(packet.schema, 'ProactiveHandoffContext.v1');
  assert.equal(packet.opportunityId, 'opp_1');
  assert.equal(packet.selectedChip, 'What drives cost?');
  assert.equal(packet.userResponse, 'What drives cost?');
  assert.equal(packet.greeting, 'Pricing pages are where good search ideas meet CFO gravity. Want the practical version?');
  assert.equal(packet.originalTurnContext.context_schema, 'AlgoliaTurnContext.v1');
  assert.equal(
    JSON.stringify(packet.requestPacket),
    JSON.stringify(proactiveState.opportunities[0].requestPacket),
    'handoff must preserve the exact Greetings Agent request packet'
  );
  assert.equal(packet.requestPacket.journeyContext.origin.label, 'AI Search');
  assert.equal(packet.requestPacket.journeyContext.destination.label, 'Pricing');
  assert.equal(packet.contextPacket, undefined);
  assert.equal(sent.messages[0].metadata.turnContext.context_schema, 'AlgoliaTurnContext.v1');

  const state = JSON.parse(sessionStorage.getItem('algolia_proactive_state'));
  assert.equal(state.opportunities[0].status, 'active');
  assert.deepEqual(
    Array.from(state.opportunities[0].lifecycle),
    ['shown', 'engaged', 'handed_off', 'active']
  );
  assert.equal(documentEvents[0].type, 'algolia-proactive-handoff');
});

test('publishes the exact terminal body once context and handoff preparation are complete', async () => {
  const { context, fetchCalls } = createHarness({ proactiveState: stateWithShownOpportunity() });
  const preparedTurns = [];
  context.algoliaHandoffToOrchestrator.subscribePreparedTurn((detail) => preparedTurns.push(detail));
  context.algoliaContextCompiler.prepareCompletionBody = (body) => {
    const payload = JSON.parse(body);
    payload.messages[0].metadata = { turnContext: { prepared_once: 'yes' } };
    return JSON.stringify(payload);
  };
  context.algoliaContextCompiler.fetchPrepared = async (url, init) => {
    fetchCalls.push({ url: String(url), init });
    return { ok: true, status: 200, text: async () => 'ok' };
  };

  await context.invokeTransport('https://TESTAPP123.algolia.net/agent-studio/1/agents/orchestrator_123/completions', {
    method: 'POST',
    body: JSON.stringify({
      id: 'conversation-1',
      messages: [{ id: 'user-1', role: 'user', parts: [{ type: 'text', text: 'What drives cost?' }] }],
    }),
  });

  assert.equal(preparedTurns.length, 1);
  assert.equal(preparedTurns[0].body, fetchCalls[0].init.body, 'listener and primary must receive identical bytes');
  assert.equal(preparedTurns[0].turnKey, 'conversation-1:user-1');
  assert.equal(preparedTurns[0].messageId, 'user-1');
  assert.equal(preparedTurns[0].question, 'What drives cost?', 'visible label excludes private handoff metadata');
  const sent = JSON.parse(preparedTurns[0].body);
  assert.equal(sent.messages[0].metadata.turnContext.prepared_once, 'yes');
  assert.match(sent.messages[0].parts[0].text, /PROACTIVE_HANDOFF_CONTEXT/);
});

test('handoff does not install a competing default answer harness', async () => {
  const { context } = createHarness();
  context.algoliaContextCompiler.fetchPrepared = async () => new Response(
    'data: {"type":"text-delta","delta":"Hello"}\n\n',
    { status: 200, headers: { 'X-Conversation-Id': 'alg_cnv_harness_1' } },
  );

  const response = await context.invokeTransport('https://primary.example/completions', {
    method: 'POST',
    body: JSON.stringify({
      id: 'conversation-1',
      messages: [{ id: 'user-1', role: 'user', parts: [{ type: 'text', text: 'Hello' }] }],
    }),
  });
  assert.match(await response.text(), /text-delta/);

  assert.equal(context.algoliaAnswerHarness, undefined);
});

test('canonical answer harness records prepared, streaming, and completed lifecycle in memory', async () => {
  const records = [];
  const canonicalHarness = createAnswerHarnessObserver({
    onRecord(record, meta) {
      records.push({ lifecycle: record.lifecycle, meta });
    },
  });
  const { context } = createHarness({ answerHarness: canonicalHarness });
  context.algoliaContextCompiler.fetchPrepared = async () => new Response(
    'data: {"type":"text-delta","delta":"Hello"}\n\n',
    { status: 200, headers: { 'X-Conversation-Id': 'alg_cnv_harness_1' } },
  );

  const response = await context.invokeTransport('https://primary.example/completions', {
    method: 'POST',
    body: JSON.stringify({
      id: 'conversation-1',
      messages: [{ id: 'user-1', role: 'user', parts: [{ type: 'text', text: 'Hello' }] }],
    }),
  });
  assert.match(await response.text(), /text-delta/);

  assert.deepEqual(records.map((entry) => entry.meta.eventName), ['prepared', 'streaming', 'completed']);
  const identity = {
    widgetInstanceId: 'algolia-chat:default',
    conversationId: 'conversation-1',
    answerSegmentId: 'user-1',
    networkAttemptId: 'algolia-chat:default:conversation-1:user-1:attempt-1',
  };
  const record = context.algoliaAnswerHarness.getRecord(identity);
  assert.equal(record.lifecycle, 'complete');
  assert.equal(record.slots.progress.value.percent, 100);
});

test('fallback turn identity changes after a visitor reset', async () => {
  const h = createHarness();
  const preparedTurns = [];
  h.context.algoliaHandoffToOrchestrator.subscribePreparedTurn((detail) => preparedTurns.push(detail));
  const request = {
    method: 'POST',
    body: JSON.stringify({
      messages: [{ role: 'user', parts: [{ type: 'text', text: 'repeat me' }] }],
    }),
  };

  await h.context.invokeTransport('https://primary.example/completions', request);
  h.resetVisitorState();
  await h.context.invokeTransport('https://primary.example/completions', request);

  assert.equal(preparedTurns.length, 2);
  assert.notEqual(preparedTurns[0].turnKey, preparedTurns[1].turnKey);
});

test('answer identity uses the configured widget instance instead of a hardcoded global value', async () => {
  const left = createHarness({ handoffConfig: { widgetInstanceId: 'widget-left' } });
  const right = createHarness({ handoffConfig: { widgetInstanceId: 'widget-right' } });
  const leftTurns = [];
  const rightTurns = [];
  left.context.algoliaHandoffToOrchestrator.subscribePreparedTurn((detail) => leftTurns.push(detail));
  right.context.algoliaHandoffToOrchestrator.subscribePreparedTurn((detail) => rightTurns.push(detail));
  const request = {
    method: 'POST',
    body: JSON.stringify({
      id: 'conversation-1',
      messages: [{ id: 'user-1', role: 'user', parts: [{ type: 'text', text: 'same question' }] }],
    }),
  };

  await left.context.invokeTransport('https://primary.example/completions', request);
  await right.context.invokeTransport('https://primary.example/completions', request);

  assert.equal(leftTurns[0].answerIdentity.widgetInstanceId, 'widget-left');
  assert.equal(rightTurns[0].answerIdentity.widgetInstanceId, 'widget-right');
  assert.notEqual(
    leftTurns[0].answerIdentity.widgetInstanceId,
    rightTurns[0].answerIdentity.widgetInstanceId
  );
});

test('handoff bridge owns footer telemetry rendering and reset cleanup', () => {
  const h = createHarness();
  const root = createDomNode('shadow-root');
  const footer = createDomNode('div');
  footer.dataset.algoliaAnswerFooter = 'user-1';
  root.appendChild(footer);
  const host = {
    __algoliaWidgetInstanceId: 'widget-1',
    shadowRoot: root,
  };
  h.context.document.querySelectorAll = (selector) => selector === 'algolia-chat' ? [host] : [];
  h.context.document.createElement = createDomNode;

  const rendered = h.context.algoliaHandoffToOrchestrator.renderAnswerFooterTelemetry(
    { messageId: 'user-1', question: 'What changed?', widgetInstanceId: 'widget-1' },
    { status: 'ready', usage: { inputTokens: 44141, outputTokens: 819, totalTokens: 44960 } },
  );

  const pill = footer.querySelector('.algolia-usage-pill');
  assert.equal(rendered, true);
  assert.equal(root.querySelector('#algolia-usage-pill-style'), null);
  assert.equal(pill.textContent, 'In 44,141 / 819 Out');
  assert.equal(pill.title, 'Current response: 44,141 input tokens and 819 output tokens');
  assert.deepEqual(
    pill.children.map((child) => child.className),
    ['algolia-usage-pill__in', 'algolia-usage-pill__divider', 'algolia-usage-pill__out'],
  );

  h.context.algoliaHandoffToOrchestrator.renderAnswerFooterTelemetry(null, { status: 'idle', usage: null });
  assert.ok(footer.querySelector('.algolia-usage-pill'), 'unidentified idle updates cannot globally clear telemetry');
  h.context.algoliaHandoffToOrchestrator.renderAnswerFooterTelemetry(
    { messageId: 'user-1', question: 'What changed?', widgetInstanceId: 'widget-1' },
    { status: 'idle', usage: null },
  );
  assert.equal(footer.querySelector('.algolia-usage-pill'), null);
});

test('handoff telemetry bridge preserves sibling widgets and retries identity-scoped late footers', () => {
  const h = createHarness();
  const observers = [];
  h.context.MutationObserver = class MutationObserver {
    constructor(callback) {
      this.callback = callback;
      this.disconnected = false;
      observers.push(this);
    }
    observe(root) {
      this.root = root;
    }
    disconnect() {
      this.disconnected = true;
    }
  };
  h.context.document.createElement = createDomNode;

  const leftRoot = createDomNode('shadow-root');
  const rightRoot = createDomNode('shadow-root');
  const leftFooter = createDomNode('div');
  leftFooter.dataset.algoliaAnswerFooter = 'left-user';
  leftRoot.appendChild(leftFooter);
  const leftHost = { __algoliaWidgetInstanceId: 'widget-left', shadowRoot: leftRoot };
  const rightHost = { __algoliaWidgetInstanceId: 'widget-right', shadowRoot: rightRoot };
  h.context.document.querySelectorAll = (selector) =>
    selector === 'algolia-chat' ? [leftHost, rightHost] : [];
  const leftDetail = {
    messageId: 'left-user',
    question: 'Left question',
    answerIdentity: {
      widgetInstanceId: 'widget-left',
      conversationId: 'conversation-left',
      answerSegmentId: 'left-user',
      networkAttemptId: 'attempt-left',
    },
  };
  const rightDetail = {
    messageId: 'right-user',
    question: 'Right question',
    answerIdentity: {
      widgetInstanceId: 'widget-right',
      conversationId: 'conversation-right',
      answerSegmentId: 'right-user',
      networkAttemptId: 'attempt-right',
    },
  };

  h.context.algoliaHandoffToOrchestrator.renderAnswerFooterTelemetry(
    leftDetail,
    { status: 'ready', usage: { inputTokens: 1000, outputTokens: 200, totalTokens: 1200 } },
  );
  assert.equal(leftFooter.querySelector('.algolia-usage-pill').textContent, 'In 1,000 / 200 Out');

  const rightRenderedEarly = h.context.algoliaHandoffToOrchestrator.renderAnswerFooterTelemetry(
    rightDetail,
    { status: 'ready', usage: { inputTokens: 3000, outputTokens: 400, totalTokens: 3400 } },
  );
  assert.equal(rightRenderedEarly, false);
  assert.equal(observers.length, 1);
  assert.equal(observers[0].root, rightRoot);

  const rightFooter = createDomNode('div');
  rightFooter.dataset.algoliaAnswerFooter = 'right-user';
  rightRoot.appendChild(rightFooter);
  observers[0].callback();
  assert.equal(rightFooter.querySelector('.algolia-usage-pill').textContent, 'In 3,000 / 400 Out');
  assert.equal(leftFooter.querySelector('.algolia-usage-pill').textContent, 'In 1,000 / 200 Out');
  assert.equal(observers[0].disconnected, true);

  h.context.algoliaHandoffToOrchestrator.renderAnswerFooterTelemetry(
    leftDetail,
    { status: 'idle', usage: null },
  );
  assert.equal(leftFooter.querySelector('.algolia-usage-pill'), null);
  assert.equal(rightFooter.querySelector('.algolia-usage-pill').textContent, 'In 3,000 / 400 Out');
});

test('handoff telemetry bridge paints latest pending state when footer appears late', () => {
  const h = createHarness();
  const observers = [];
  h.context.MutationObserver = class MutationObserver {
    constructor(callback) {
      this.callback = callback;
      observers.push(this);
    }
    observe(root) {
      this.root = root;
    }
    disconnect() {}
  };
  h.context.document.createElement = createDomNode;

  const root = createDomNode('shadow-root');
  const host = { __algoliaWidgetInstanceId: 'widget-late', shadowRoot: root };
  h.context.document.querySelectorAll = (selector) =>
    selector === 'algolia-chat' ? [host] : [];
  const detail = {
    messageId: 'late-user',
    question: 'Late footer?',
    answerIdentity: {
      widgetInstanceId: 'widget-late',
      conversationId: 'conversation-late',
      answerSegmentId: 'late-user',
      networkAttemptId: 'attempt-late',
    },
  };

  const loadingRendered = h.context.algoliaHandoffToOrchestrator.renderAnswerFooterTelemetry(
    detail,
    { status: 'loading', usage: null },
  );
  const readyRendered = h.context.algoliaHandoffToOrchestrator.renderAnswerFooterTelemetry(
    detail,
    { status: 'ready', usage: { inputTokens: 3000, outputTokens: 400, totalTokens: 3400 } },
  );
  assert.equal(loadingRendered, false);
  assert.equal(readyRendered, false);
  assert.equal(observers.length, 1, 'same identity keeps one observer and updates its pending state');

  const footer = createDomNode('div');
  footer.dataset.algoliaAnswerFooter = 'late-user';
  root.appendChild(footer);
  observers[0].callback();

  assert.equal(footer.querySelector('.algolia-usage-pill').textContent, 'In 3,000 / 400 Out');
  assert.equal(
    footer.querySelector('.algolia-usage-pill').title,
    'Current response: 3,000 input tokens and 400 output tokens',
  );
  assert.equal(h.timers[0].cleared, true, 'successful late placement clears the bounded observer timer');
});

test('handoff telemetry bridge refuses stale attempts that target the current answer footer', async () => {
  const h = createHarness();
  h.context.document.createElement = createDomNode;
  const preparedTurns = [];
  h.context.algoliaHandoffToOrchestrator.subscribePreparedTurn((detail) => preparedTurns.push(detail));
  const request = {
    method: 'POST',
    body: JSON.stringify({
      id: 'conversation-1',
      messages: [{ id: 'user-1', role: 'user', parts: [{ type: 'text', text: 'same question' }] }],
    }),
  };

  await h.context.invokeTransport('https://primary.example/completions', request);
  await h.context.invokeTransport('https://primary.example/completions', request);
  assert.equal(preparedTurns.length, 2);

  const root = createDomNode('shadow-root');
  const footer = createDomNode('div');
  footer.dataset.algoliaAnswerFooter = 'user-1';
  root.appendChild(footer);
  const host = {
    __algoliaWidgetInstanceId: 'algolia-chat:default',
    shadowRoot: root,
  };
  h.context.document.querySelectorAll = (selector) => selector === 'algolia-chat' ? [host] : [];
  const oldDetail = {
    messageId: 'user-1',
    question: 'same question',
    answerIdentity: preparedTurns[0].answerIdentity,
  };
  const currentDetail = {
    messageId: 'user-1',
    question: 'same question',
    answerIdentity: preparedTurns[1].answerIdentity,
  };

  const oldRendered = h.context.algoliaHandoffToOrchestrator.renderAnswerFooterTelemetry(
    oldDetail,
    { status: 'ready', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } },
  );
  const currentRendered = h.context.algoliaHandoffToOrchestrator.renderAnswerFooterTelemetry(
    currentDetail,
    { status: 'ready', usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } },
  );

  assert.equal(oldRendered, false, 'late old attempt cannot paint over the same message footer');
  assert.equal(currentRendered, true);
  assert.equal(footer.querySelector('.algolia-usage-pill').textContent, 'In 10 / 5 Out');
});

test('handoff telemetry bridge keeps telemetry on older answer footers', () => {
  const h = createHarness();
  h.context.document.createElement = createDomNode;
  const root = createDomNode('shadow-root');
  const firstFooter = createDomNode('div');
  const secondFooter = createDomNode('div');
  firstFooter.dataset.algoliaAnswerFooter = 'user-1';
  secondFooter.dataset.algoliaAnswerFooter = 'user-2';
  root.appendChild(firstFooter);
  root.appendChild(secondFooter);
  const host = {
    __algoliaWidgetInstanceId: 'widget-1',
    shadowRoot: root,
  };
  h.context.document.querySelectorAll = (selector) => selector === 'algolia-chat' ? [host] : [];

  h.context.algoliaHandoffToOrchestrator.renderAnswerFooterTelemetry(
    {
      messageId: 'user-1',
      question: 'first question',
      answerIdentity: {
        widgetInstanceId: 'widget-1',
        conversationId: 'conversation-1',
        answerSegmentId: 'user-1',
        networkAttemptId: 'attempt-1',
      },
    },
    { status: 'ready', usage: { inputTokens: 1000, outputTokens: 200, totalTokens: 1200 } },
  );
  h.context.algoliaHandoffToOrchestrator.renderAnswerFooterTelemetry(
    {
      messageId: 'user-2',
      question: 'second question',
      answerIdentity: {
        widgetInstanceId: 'widget-1',
        conversationId: 'conversation-1',
        answerSegmentId: 'user-2',
        networkAttemptId: 'attempt-2',
      },
    },
    { status: 'ready', usage: { inputTokens: 3000, outputTokens: 400, totalTokens: 3400 } },
  );

  assert.equal(firstFooter.querySelector('.algolia-usage-pill').textContent, 'In 1,000 / 200 Out');
  assert.equal(secondFooter.querySelector('.algolia-usage-pill').textContent, 'In 3,000 / 400 Out');
});

test('handoff telemetry bridge drops a pending observer after its bounded timeout', () => {
  const h = createHarness();
  const observers = [];
  h.context.MutationObserver = class MutationObserver {
    constructor(callback) {
      this.callback = callback;
      this.disconnected = false;
      observers.push(this);
    }
    observe(root) {
      this.root = root;
    }
    disconnect() {
      this.disconnected = true;
    }
  };
  h.context.document.createElement = createDomNode;
  const root = createDomNode('shadow-root');
  const host = { __algoliaWidgetInstanceId: 'widget-timeout', shadowRoot: root };
  h.context.document.querySelectorAll = (selector) => selector === 'algolia-chat' ? [host] : [];
  const detail = {
    messageId: 'late-user',
    question: 'Late footer?',
    answerIdentity: {
      widgetInstanceId: 'widget-timeout',
      conversationId: 'conversation-timeout',
      answerSegmentId: 'late-user',
      networkAttemptId: 'attempt-timeout',
    },
  };

  h.context.algoliaHandoffToOrchestrator.renderAnswerFooterTelemetry(
    detail,
    { status: 'ready', usage: { inputTokens: 3000, outputTokens: 400, totalTokens: 3400 } },
  );
  assert.equal(h.timers[0].ms, 30000);
  h.timers[0].callback();
  assert.equal(observers[0].disconnected, true);

  const footer = createDomNode('div');
  footer.dataset.algoliaAnswerFooter = 'late-user';
  root.appendChild(footer);
  observers[0].callback();
  assert.equal(footer.querySelector('.algolia-usage-pill'), null);
});

test('payload widget instance metadata isolates two widget requests in one handoff runtime', async () => {
  const harness = createHarness();
  const preparedTurns = [];
  harness.context.algoliaHandoffToOrchestrator.subscribePreparedTurn((detail) => preparedTurns.push(detail));

  await harness.context.invokeTransport('https://primary.example/completions', {
    method: 'POST',
    body: JSON.stringify({
      id: 'conversation-1',
      widgetInstanceId: 'widget-left',
      messages: [{ id: 'user-1', role: 'user', parts: [{ type: 'text', text: 'same question' }] }],
    }),
  });
  await harness.context.invokeTransport('https://primary.example/completions', {
    method: 'POST',
    body: JSON.stringify({
      id: 'conversation-1',
      metadata: { widgetInstanceId: 'widget-right' },
      messages: [{ id: 'user-1', role: 'user', parts: [{ type: 'text', text: 'same question' }] }],
    }),
  });

  assert.equal(preparedTurns[0].answerIdentity.widgetInstanceId, 'widget-left');
  assert.equal(preparedTurns[1].answerIdentity.widgetInstanceId, 'widget-right');
  assert.notEqual(preparedTurns[0].answerIdentity.networkAttemptId, preparedTurns[1].answerIdentity.networkAttemptId);
});

test('out-of-band runtime context isolates two widget requests without changing request bytes', async () => {
  const harness = createHarness();
  const preparedTurns = [];
  harness.context.algoliaHandoffToOrchestrator.subscribePreparedTurn((detail) => preparedTurns.push(detail));
  const body = JSON.stringify({
    id: 'conversation-1',
    messages: [{ id: 'user-1', role: 'user', parts: [{ type: 'text', text: 'same question' }] }],
  });
  const request = { method: 'POST', body };

  await harness.context.invokeTransport('https://primary.example/completions', request, {
    widgetInstanceId: 'widget-left',
    answerSegmentId: 'assistant-left',
  });
  await harness.context.invokeTransport('https://primary.example/completions', request, {
    widgetInstanceId: 'widget-right',
    answerSegmentId: 'assistant-right',
  });

  assert.equal(preparedTurns.length, 2);
  assert.equal(preparedTurns[0].body, body, 'runtime identity context must not change on-wire request bytes');
  assert.equal(preparedTurns[1].body, body, 'runtime identity context must not change on-wire request bytes');
  assert.equal(preparedTurns[0].answerIdentity.widgetInstanceId, 'widget-left');
  assert.equal(preparedTurns[1].answerIdentity.widgetInstanceId, 'widget-right');
  assert.equal(preparedTurns[0].answerIdentity.answerSegmentId, 'assistant-left');
  assert.equal(preparedTurns[1].answerIdentity.answerSegmentId, 'assistant-right');
});

test('answer identity prefers native answer segment metadata over the triggering user message id', async () => {
  const harness = createHarness();
  const preparedTurns = [];
  harness.context.algoliaHandoffToOrchestrator.subscribePreparedTurn((detail) => preparedTurns.push(detail));

  await harness.context.invokeTransport('https://primary.example/completions', {
    method: 'POST',
    body: JSON.stringify({
      id: 'conversation-1',
      metadata: {
        answerSegmentId: 'assistant-segment-1',
        widgetInstanceId: 'widget-1',
      },
      messages: [{ id: 'user-1', role: 'user', parts: [{ type: 'text', text: 'same question' }] }],
    }),
  });

  assert.equal(preparedTurns[0].messageId, 'user-1');
  assert.equal(preparedTurns[0].answerIdentity.widgetInstanceId, 'widget-1');
  assert.equal(preparedTurns[0].answerIdentity.answerSegmentId, 'assistant-segment-1');
  assert.match(preparedTurns[0].answerIdentity.networkAttemptId, /widget-1:conversation-1:user-1:attempt-1$/);
});

/*
 * Completed-turn lifecycle scenarios:
 * - A successful, fully consumed SSE response publishes one conversation id.
 * - A missing conversation header publishes nothing.
 * - Guardrail and cancelled streams publish nothing.
 * - A listener failure cannot alter the response consumed by the chat widget.
 * - Multiple successful model calls in one logical turn are all published.
 */
test('publishes a completed turn once the successful primary stream is consumed', async () => {
  const { context } = createHarness();
  const completedTurns = [];
  context.algoliaHandoffToOrchestrator.subscribeCompletedTurn((detail) => completedTurns.push(detail));
  context.algoliaContextCompiler.fetchPrepared = async () => new Response(
    'data: {"type":"text-delta","delta":"Hello"}\n\n',
    { status: 200, headers: { 'X-Conversation-Id': 'alg_cnv_success_1' } },
  );

  const response = await context.invokeTransport('https://primary.example/completions', {
    method: 'POST',
    body: JSON.stringify({
      id: 'conversation-1',
      messages: [{ id: 'user-1', role: 'user', parts: [{ type: 'text', text: 'Hello' }] }],
    }),
  });

  assert.equal(completedTurns.length, 0, 'completion waits for the widget to consume the stream');
  assert.match(await response.text(), /text-delta/);
  assert.deepEqual(
    JSON.parse(JSON.stringify(completedTurns)),
	    [{
	      turnKey: 'conversation-1:user-1',
	      conversationGeneration: 0,
	      networkAttemptOrdinal: 1,
	      messageId: 'user-1',
	      question: 'Hello',
      conversationId: 'alg_cnv_success_1',
      answerIdentity: {
        widgetInstanceId: 'algolia-chat:default',
        conversationId: 'conversation-1',
        answerSegmentId: 'user-1',
        networkAttemptId: 'algolia-chat:default:conversation-1:user-1:attempt-1',
      },
    }],
  );
});

test('mirrors prepared, streaming, and completed turn lifecycle to the optional answer harness', async () => {
  const harnessEvents = [];
  const { context } = createHarness({
    answerHarness: {
      accept(event) {
        harnessEvents.push(event);
      },
    },
  });
  context.algoliaContextCompiler.fetchPrepared = async () => new Response(
    'data: {"type":"text-delta","delta":"Hello"}\n\n',
    { status: 200, headers: { 'X-Conversation-Id': 'alg_cnv_success_1' } },
  );

  const body = {
    id: 'conversation-1',
    messages: [
      {
        id: 'message-1',
        role: 'user',
        parts: [{ type: 'text', text: 'How should I think about pricing?' }],
      },
    ],
  };
  const response = await context.invokeTransport('/agent-studio/1/agents/orchestrator/completions', {
    body: JSON.stringify(body),
  });
  await response.text();

  assert.deepEqual(
    harnessEvents.map((event) => event.eventName),
    ['prepared', 'streaming', 'completed']
  );
  assert.equal(harnessEvents[0].detail.messageId, 'message-1');
  assert.equal(harnessEvents[0].detail.question, 'How should I think about pricing?');
  assert.equal(harnessEvents[0].detail.turnKey, 'conversation-1:message-1');
  assert.equal(harnessEvents[2].detail.conversationId, 'alg_cnv_success_1');
  assert.deepEqual(JSON.parse(JSON.stringify(harnessEvents[0].detail.answerIdentity)), {
    widgetInstanceId: 'algolia-chat:default',
    conversationId: 'conversation-1',
    answerSegmentId: 'message-1',
    networkAttemptId: 'algolia-chat:default:conversation-1:message-1:attempt-1',
  });
  assert.deepEqual(harnessEvents[1].detail.answerIdentity, harnessEvents[0].detail.answerIdentity);
  assert.deepEqual(harnessEvents[2].detail.answerIdentity, harnessEvents[0].detail.answerIdentity);
});

test('answer harness observer errors are contained and never break transport', async () => {
  const { context } = createHarness({
    proactiveState: stateWithShownOpportunity(),
    answerHarness: {
      accept() {
        throw new Error('observer exploded');
      },
    },
  });

  const body = {
    id: 'conversation-1',
    messages: [
      {
        id: 'message-1',
        role: 'user',
        parts: [{ type: 'text', text: 'Can this still answer?' }],
      },
    ],
  };
  const response = await context.invokeTransport('/agent-studio/1/agents/orchestrator/completions', {
    body: JSON.stringify(body),
  });

  assert.equal(await response.text(), 'ok');
});

test('completed-turn observers cannot break responses or hide multiple billable model calls', async () => {
  const { context } = createHarness();
  const completedTurns = [];
  context.algoliaHandoffToOrchestrator.subscribeCompletedTurn(() => {
    throw new Error('observer failed');
  });
  context.algoliaHandoffToOrchestrator.subscribeCompletedTurn((detail) => completedTurns.push(detail));
  context.algoliaContextCompiler.fetchPrepared = async () => new Response('primary answer', {
    status: 200,
    headers: { 'X-Conversation-Id': 'alg_cnv_retry_1' },
  });
  const request = {
    method: 'POST',
    body: JSON.stringify({
      id: 'conversation-1',
      messages: [{ id: 'user-1', role: 'user', parts: [{ type: 'text', text: 'Hello' }] }],
    }),
  };

  const first = await context.invokeTransport('https://primary.example/completions', request);
  const second = await context.invokeTransport('https://primary.example/completions', request);

  assert.equal(await first.text(), 'primary answer');
  assert.equal(await second.text(), 'primary answer');
  assert.equal(completedTurns.length, 2, 'each successful primary model call is observable');
  assert.equal(completedTurns[0].turnKey, completedTurns[1].turnKey, 'both calls retain logical-turn correlation');
  assert.notEqual(
    completedTurns[0].answerIdentity.networkAttemptId,
    completedTurns[1].answerIdentity.networkAttemptId,
    'each primary model call has a distinct answer attempt identity'
  );
});

test('live attempt authority is not evicted by unrelated completed traffic', async () => {
  const { context } = createHarness();
  const preparedTurns = [];
  const completedTurns = [];
  const encoder = new TextEncoder();
  let closeLongRunningAnswer;
  context.algoliaHandoffToOrchestrator.subscribePreparedTurn((detail) => preparedTurns.push(detail));
  context.algoliaHandoffToOrchestrator.subscribeCompletedTurn((detail) => completedTurns.push(detail));
  context.algoliaContextCompiler.fetchPrepared = async () => {
    if (!closeLongRunningAnswer) {
      return new Response(new ReadableStream({
        start(controller) {
          closeLongRunningAnswer = () => {
            controller.enqueue(encoder.encode('data: {"type":"text-delta","delta":"A"}\n\n'));
            controller.close();
          };
        },
      }), { status: 200, headers: { 'X-Conversation-Id': 'alg_cnv_live_a' } });
    }
    return new Response('data: {"type":"text-delta","delta":"B"}\n\n', {
      status: 200,
      headers: { 'X-Conversation-Id': 'alg_cnv_completed_b' },
    });
  };

  const aResponse = await context.invokeTransport('https://primary.example/completions', {
    method: 'POST',
    body: JSON.stringify({
      id: 'conversation-a',
      messages: [{ id: 'user-a', role: 'user', parts: [{ type: 'text', text: 'long running A' }] }],
    }),
  }, {
    widgetInstanceId: 'widget-a',
    answerSegmentId: 'assistant-a',
  });
  const aPrepared = preparedTurns.at(-1);
  assert.equal(context.algoliaHandoffToOrchestrator.validateTurnEvent(aPrepared), true);

  for (let index = 0; index < 505; index += 1) {
    const response = await context.invokeTransport('https://primary.example/completions', {
      method: 'POST',
      body: JSON.stringify({
        id: `conversation-b-${index}`,
        messages: [{ id: `user-b-${index}`, role: 'user', parts: [{ type: 'text', text: `completed B ${index}` }] }],
      }),
    }, {
      widgetInstanceId: 'widget-b',
      answerSegmentId: `assistant-b-${index}`,
    });
    await response.text();
  }

  assert.equal(
    context.algoliaHandoffToOrchestrator.validateTurnEvent(aPrepared),
    true,
    'unrelated completed answers must not evict the still-live A authority record',
  );

  closeLongRunningAnswer();
  assert.match(await aResponse.text(), /text-delta/);
  assert.ok(
    completedTurns.some((detail) => detail.answerIdentity?.widgetInstanceId === 'widget-a'),
    'the still-live A attempt must be allowed to complete',
  );
  assert.equal(
    context.algoliaHandoffToOrchestrator.validateTurnEvent(aPrepared),
    false,
    'successful completion retires A from the live authority table after listeners run',
  );
});

test('retry refreshes live authority so a fresh attempt is not FIFO-evicted', async () => {
  const { context } = createHarness();
  const preparedTurns = [];
  context.algoliaHandoffToOrchestrator.subscribePreparedTurn((detail) => preparedTurns.push(detail));
  context.algoliaContextCompiler.fetchPrepared = async () => new Response(new ReadableStream({ start() {} }), {
    status: 200,
    headers: { 'X-Conversation-Id': 'alg_cnv_pending' },
  });
  const aRequest = {
    method: 'POST',
    body: JSON.stringify({
      id: 'conversation-a',
      messages: [{ id: 'user-a', role: 'user', parts: [{ type: 'text', text: 'retry me' }] }],
    }),
  };
  const aContext = { widgetInstanceId: 'widget-a', answerSegmentId: 'assistant-a' };

  await context.invokeTransport('https://primary.example/completions', aRequest, aContext);
  const staleA = preparedTurns.at(-1);
  for (let index = 0; index < 499; index += 1) {
    await context.invokeTransport('https://primary.example/completions', {
      method: 'POST',
      body: JSON.stringify({
        id: `conversation-b-${index}`,
        messages: [{ id: `user-b-${index}`, role: 'user', parts: [{ type: 'text', text: `pending B ${index}` }] }],
      }),
    }, {
      widgetInstanceId: 'widget-b',
      answerSegmentId: `assistant-b-${index}`,
    });
  }
  await context.invokeTransport('https://primary.example/completions', aRequest, aContext);
  const freshA = preparedTurns.at(-1);
  await context.invokeTransport('https://primary.example/completions', {
    method: 'POST',
    body: JSON.stringify({
      id: 'conversation-b-final',
      messages: [{ id: 'user-b-final', role: 'user', parts: [{ type: 'text', text: 'one more B' }] }],
    }),
  }, {
    widgetInstanceId: 'widget-b',
    answerSegmentId: 'assistant-b-final',
  });

  assert.equal(
    context.algoliaHandoffToOrchestrator.validateTurnEvent(staleA),
    false,
    'the superseded A attempt is no longer live',
  );
  assert.equal(
    context.algoliaHandoffToOrchestrator.validateTurnEvent(freshA),
    true,
    'the fresh A retry remains live after later unrelated work',
  );
});

test('terminal failures and cancellations retire live attempt authority', async () => {
  const { context } = createHarness();
  const preparedTurns = [];
  context.algoliaHandoffToOrchestrator.subscribePreparedTurn((detail) => preparedTurns.push(detail));
  const request = {
    method: 'POST',
    body: JSON.stringify({
      id: 'conversation-terminal',
      messages: [{ id: 'user-terminal', role: 'user', parts: [{ type: 'text', text: 'terminal cleanup' }] }],
    }),
  };

  context.algoliaContextCompiler.fetchPrepared = async () => new Response('no header', { status: 200 });
  await context.invokeTransport('https://primary.example/completions', request);
  assert.equal(context.algoliaHandoffToOrchestrator.validateTurnEvent(preparedTurns.at(-1)), false);

  context.algoliaContextCompiler.fetchPrepared = async () => new Response('server failed', { status: 503 });
  await context.invokeTransport('https://primary.example/completions', request);
  assert.equal(context.algoliaHandoffToOrchestrator.validateTurnEvent(preparedTurns.at(-1)), false);

  context.algoliaContextCompiler.fetchPrepared = async () => new Response('cancel me', {
    status: 200,
    headers: { 'X-Conversation-Id': 'alg_cnv_cancel_cleanup' },
  });
  const cancelled = await context.invokeTransport('https://primary.example/completions', request);
  assert.equal(context.algoliaHandoffToOrchestrator.validateTurnEvent(preparedTurns.at(-1)), true);
  await cancelled.body.cancel();
  assert.equal(context.algoliaHandoffToOrchestrator.validateTurnEvent(preparedTurns.at(-1)), false);

  context.algoliaContextCompiler.fetchPrepared = async () => { throw new Error('network failed'); };
  await assert.rejects(context.invokeTransport('https://primary.example/completions', request), /network failed/);
  assert.equal(context.algoliaHandoffToOrchestrator.validateTurnEvent(preparedTurns.at(-1)), false);
});

test('does not publish completed turns for missing headers, guardrails, or cancelled streams', async () => {
  const { context } = createHarness();
  const completedTurns = [];
  context.algoliaHandoffToOrchestrator.subscribeCompletedTurn((detail) => completedTurns.push(detail));
  const request = {
    method: 'POST',
    body: JSON.stringify({
      id: 'conversation-1',
      messages: [{ id: 'user-1', role: 'user', parts: [{ type: 'text', text: 'Hello' }] }],
    }),
  };

  context.algoliaContextCompiler.fetchPrepared = async () => new Response('no header', { status: 200 });
  assert.equal(await (await context.invokeTransport('https://primary.example/completions', request)).text(), 'no header');

  context.algoliaContextCompiler.fetchPrepared = async () => new Response(
    'data: {"type":"data-guardrail-violation"}\n\n',
    { status: 200, headers: { 'X-Conversation-Id': 'alg_cnv_guardrail_1' } },
  );
  await (await context.invokeTransport('https://primary.example/completions', request)).text();

  context.algoliaContextCompiler.fetchPrepared = async () => new Response('cancel me', {
    status: 200,
    headers: { 'X-Conversation-Id': 'alg_cnv_cancel_1' },
  });
  const cancelled = await context.invokeTransport('https://primary.example/completions', request);
  await cancelled.body.cancel();

  assert.equal(completedTurns.length, 0);
});

test('a proactive primary retry keeps one clean logical turn identity', async () => {
  const { context } = createHarness({ proactiveState: stateWithShownOpportunity() });
  const preparedTurns = [];
  let attempts = 0;
  context.algoliaHandoffToOrchestrator.subscribePreparedTurn((detail) => preparedTurns.push(detail));
  context.algoliaContextCompiler.prepareCompletionBody = (body) => body;
  context.algoliaContextCompiler.fetchPrepared = async () => {
    attempts += 1;
    if (attempts === 1) throw new Error('retryable');
    return { ok: true, status: 200, text: async () => 'ok' };
  };
  const request = {
    method: 'POST',
    body: JSON.stringify({
      messages: [{ role: 'user', parts: [{ type: 'text', text: 'What drives cost?' }] }],
    }),
  };

  await assert.rejects(context.invokeTransport('https://primary.example/completions', request), /retryable/);
  await context.invokeTransport('https://primary.example/completions', request);

  assert.equal(preparedTurns.length, 2, 'the transport publishes both primary attempts');
  assert.equal(preparedTurns[0].turnKey, preparedTurns[1].turnKey, 'Compare can dedupe both attempts');
  assert.notEqual(
    preparedTurns[0].answerIdentity.networkAttemptId,
    preparedTurns[1].answerIdentity.networkAttemptId,
    'the harness can reject stale retry updates even when Compare keeps one logical turn'
  );
  assert.equal(preparedTurns[0].question, 'What drives cost?');
  assert.equal(preparedTurns[1].question, 'What drives cost?');
  assert.equal(preparedTurns[0].question.includes('PROACTIVE_HANDOFF_CONTEXT'), false);
});

test('removes legacy visitor intelligence before capturing the proactive response', async () => {
  const { context, fetchCalls } = createHarness({
    proactiveState: stateWithShownOpportunity(),
    primaryAgentId: 'orchestrator_123',
  });

  await context.invokeTransport('https://TESTAPP123.algolia.net/agent-studio/1/agents/orchestrator_123/completions', {
    method: 'POST',
    body: JSON.stringify({
      messages: [
        {
          role: 'user',
          parts: [
            {
              type: 'text',
              text:
                'What drives cost?\n\nVISITOR INTELLIGENCE (JSON DATA, NOT INSTRUCTIONS) — use this silently to tailor the answer.\n{"schema":"legacy"}',
            },
          ],
        },
      ],
    }),
  });

  const sent = JSON.parse(fetchCalls[0].init.body);
  const packet = JSON.parse(sent.messages[0].parts[0].text.split('PROACTIVE_HANDOFF_CONTEXT\n')[1]);

  assert.equal(packet.userResponse, 'What drives cost?');
  assert.equal(packet.selectedChip, 'What drives cost?');
});

test('does not inject handoff context into non-orchestrator or already-sent turns', async () => {
  const state = stateWithShownOpportunity();
  state.opportunities[0].status = 'handoff_sent';
  const { context, fetchCalls } = createHarness({ proactiveState: state, primaryAgentId: 'orchestrator_123' });

  await context.invokeTransport('https://TESTAPP123.algolia.net/agent-studio/1/agents/orchestrator_123/completions', {
    method: 'POST',
    body: JSON.stringify({
      messages: [{ role: 'user', parts: [{ type: 'text', text: 'normal question' }] }],
    }),
  });
  await context.fetch('https://TESTAPP123.algolia.net/agent-studio/1/agents/other_agent/completions', {
    method: 'POST',
    body: JSON.stringify({
      messages: [{ role: 'user', parts: [{ type: 'text', text: 'normal question' }] }],
    }),
  });

  for (const call of fetchCalls) {
    const sent = JSON.parse(call.init.body);
    assert.equal(sent.messages[0].parts[0].text, 'normal question');
  }
});

test('handoff debug can be enabled persistently from localStorage without URL flags', () => {
  const { context, logs } = createHarness({ initialLocal: { algoliaDebug: '1' } });

  context.algoliaHandoffToOrchestrator.configure({ enabled: true });

  assert.ok(logs.some((args) => args[0] === '[Algolia Handoff To Orchestrator]' && args[1] === 'configured'));
});

test('preserves the exact required request packet without merging unrelated compiler data', () => {
  const state = stateWithShownOpportunity();
  state.opportunities[0].requestPacket = {
    ...state.opportunities[0].requestPacket,
    detail: 'x'.repeat(7000),
    recentEvents: [{ name: 'cta_click', props: { email: 'person@example.com' } }],
  };
  const { context } = createHarness({
    proactiveState: state,
    compilerPacket: {
      schema: 'AlgoliaContextPacket.v1',
      recentEvents: [{ name: 'site_search', props: { query: 'private telemetry' } }],
    },
  });

  const packet = context.algoliaHandoffToOrchestrator.buildHandoffPacket(
    state.opportunities[0],
    'Tell me what drives cost.',
    { context_schema: 'AlgoliaTurnContext.v1', qualified_journey: 'product:AI Search > pricing:Pricing' },
  );

  const serialized = JSON.stringify(packet);
  assert.equal(packet.originalTurnContext.qualified_journey, 'product:AI Search > pricing:Pricing');
  assert.equal(
    JSON.stringify(packet.requestPacket),
    JSON.stringify(state.opportunities[0].requestPacket),
    'handoff must not cap, summarize, or reconstruct the original request packet'
  );
  assert.match(serialized, /person@example\.com|"detail"|recentEvents/);
  assert.doesNotMatch(serialized, /private telemetry/);
});

test('refuses proactive handoff when the canonical request packet is missing', () => {
  const state = stateWithShownOpportunity();
  delete state.opportunities[0].requestPacket;
  const { context } = createHarness({ proactiveState: state });

  assert.throws(
    () => context.algoliaHandoffToOrchestrator.buildHandoffPacket(
      state.opportunities[0],
      'Help me define my use case.',
    ),
    /complete ProactiveGreetingRequest\.v1 packet/,
  );
});

test('reattaches the original proactive handoff and fresh page context on later orchestrator turns', async () => {
  const { context, fetchCalls, sessionStorage } = createHarness({
    proactiveState: stateWithShownOpportunity(),
    primaryAgentId: 'orchestrator_123',
  });

  await context.invokeTransport('https://TESTAPP123.algolia.net/agent-studio/1/agents/orchestrator_123/completions', {
    method: 'POST',
    body: JSON.stringify({
      messages: [{ role: 'user', parts: [{ type: 'text', text: 'What drives cost?' }] }],
    }),
  });

  context.algoliaContextCompiler.mergeTurnContext = () => ({
    context_schema: 'AlgoliaTurnContext.v1',
    current_page: '/doc/guides/instantsearch',
    qualified_journey: 'product:AI Search > pricing:Pricing > documentation:InstantSearch',
  });

  await context.invokeTransport('https://TESTAPP123.algolia.net/agent-studio/1/agents/orchestrator_123/completions', {
    method: 'POST',
    body: JSON.stringify({
      messages: [{ role: 'user', parts: [{ type: 'text', text: 'How does that change implementation?' }] }],
    }),
  });

  assert.equal(fetchCalls.length, 2);
  const second = JSON.parse(fetchCalls[1].init.body);
  const secondText = second.messages[0].parts[0].text;
  assert.match(secondText, /^How does that change implementation\?\n\nPROACTIVE_HANDOFF_CONTEXT\n/);
  const packet = JSON.parse(secondText.split('PROACTIVE_HANDOFF_CONTEXT\n')[1]);
  assert.equal(packet.opportunityId, 'opp_1');
  assert.equal(packet.userResponse, 'What drives cost?');
  assert.equal(second.messages[0].metadata.turnContext.current_page, '/doc/guides/instantsearch');
  assert.match(second.messages[0].metadata.turnContext.qualified_journey, /documentation:InstantSearch/);
  assert.ok(sessionStorage.getItem('algolia-chat:handoff-context'));
});

test('a failed orchestrator request restores the shown opportunity for retry', async () => {
  const { context, sessionStorage } = createHarness({
    proactiveState: stateWithShownOpportunity(),
    fetchError: new Error('network unavailable'),
  });

  await assert.rejects(
    context.invokeTransport('https://TESTAPP123.algolia.net/agent-studio/1/agents/orchestrator_123/completions', {
      method: 'POST',
      body: JSON.stringify({
        messages: [{ role: 'user', parts: [{ type: 'text', text: 'What drives cost?' }] }],
      }),
    }),
    /network unavailable/,
  );

  const state = JSON.parse(sessionStorage.getItem('algolia_proactive_state'));
  assert.equal(state.opportunities[0].status, 'shown');
  assert.equal(state.opportunities[0].handoffFailure, 'network_error');
});

test('an invalid turnContext blocks the orchestrator request without consuming the opportunity', async () => {
  const mergeError = Object.assign(new Error('turnContext value exceeds 1024 bytes'), {
    code: 'turn_context_value_too_large',
    field: 'proactive_greeting',
    actualBytes: 1300,
    limitBytes: 1024,
  });
  const { context, fetchCalls, sessionStorage } = createHarness({
    proactiveState: stateWithShownOpportunity(),
    mergeError,
  });

  await assert.rejects(
    context.invokeTransport('https://TESTAPP123.algolia.net/agent-studio/1/agents/orchestrator_123/completions', {
      method: 'POST',
      body: JSON.stringify({
        messages: [{ role: 'user', parts: [{ type: 'text', text: 'What drives cost?' }] }],
      }),
    }),
    (error) => error === mergeError,
  );

  assert.equal(fetchCalls.length, 0);
  const state = JSON.parse(sessionStorage.getItem('algolia_proactive_state'));
  assert.equal(state.opportunities[0].status, 'shown');
  assert.equal(state.opportunities[0].handoffFailure, 'turn_context_value_too_large:proactive_greeting:1300');
});
