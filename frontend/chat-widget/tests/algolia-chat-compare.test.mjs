import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createOpaqueActionContribution } from '../source/shared/widget/answer-contributors.mjs';

const comparePath = new URL('../algolia-chat-compare.js', import.meta.url);

/* ------------------------------------------------------------------ fake DOM */

class El {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.style = {};
    this.dataset = {};
    this.attrs = {};
    this.listeners = {};
    this.parentElement = null;
    this._text = '';
    this._html = '';
    this.rect = { width: 1000, height: 800, top: 0, bottom: 800, left: 0, right: 1000 };
  }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  removeAttribute(k) { delete this.attrs[k]; }
  appendChild(c) {
    if (c.parentElement) c.parentElement.children = c.parentElement.children.filter((child) => child !== c);
    c.parentElement = this;
    this.children.push(c);
    return c;
  }
  append(...cs) { cs.forEach((c) => this.appendChild(c)); }
  replaceChildren(...cs) { this.children = []; cs.forEach((c) => this.appendChild(c)); }
  insertBefore(node, ref) {
    if (node.parentElement) node.parentElement.children = node.parentElement.children.filter((child) => child !== node);
    node.parentElement = this;
    const i = this.children.indexOf(ref);
    if (i < 0) this.children.push(node); else this.children.splice(i, 0, node);
    return node;
  }
  remove() {
    if (!this.parentElement) return;
    this.parentElement.children = this.parentElement.children.filter((c) => c !== this);
    this.parentElement = null;
  }
  get lastElementChild() { return this.children[this.children.length - 1] || null; }
  getBoundingClientRect() { return this.rect; }
  addEventListener(t, fn) { (this.listeners[t] ||= []).push(fn); }
  dispatch(t, ev) { (this.listeners[t] || []).forEach((fn) => fn(ev)); }
  set textContent(v) { this._text = String(v); this.children = []; }
  get textContent() { return this.children.length ? this.children.map((c) => c.textContent).join('') : (this._text || this._html.replace(/<[^>]+>/g, '')); }
  set innerHTML(v) { this._html = String(v); }
  get innerHTML() { return this._html; }
  matches(sel) {
    const attr = /^\[([^=\]]+)="([^"]+)"\]$/.exec(sel);
    if (attr) return this.getAttribute(attr[1]) === attr[2];
    if (sel.startsWith('#')) return this.attrs.id === sel.slice(1) || this.id === sel.slice(1);
    if (sel.startsWith('.')) return String(this.attrs.class || '').split(/\s+/).includes(sel.slice(1));
    return this.tagName === sel.toUpperCase();
  }
  walk(out = []) { this.children.forEach((c) => { out.push(c); c.walk(out); }); return out; }
  querySelector(sel) { return this.walk().find((n) => n.matches(sel)) || null; }
  querySelectorAll(sel) { return this.walk().filter((n) => n.matches(sel)); }
}

// `id` is a real property on elements the module creates.
Object.defineProperty(El.prototype, 'id', {
  get() { return this.attrs.id || ''; },
  set(v) { this.attrs.id = String(v); },
});

function sse(frames) {
  const body = frames.map((f) => `data: ${JSON.stringify(f)}\n`).join('');
  return new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode(body)); controller.close(); },
  });
}

function answerIdentityKey(identity) {
  if (!identity || typeof identity !== 'object') return '';
  const parts = [
    identity.widgetInstanceId,
    identity.conversationId,
    identity.answerSegmentId,
    identity.networkAttemptId,
  ].map((value) => String(value || '').trim());
  return parts.every(Boolean) ? parts.join('\n') : '';
}

function createHarness({ proxyPath = '/__compare/production', chatWidth = 1000, viewportWidth = 1200, widgetInstanceId = 'widget-1', extraWidgetInstanceIds = [] } = {}) {
  const frames = [];                // queued rAF callbacks
  const observers = [];             // MutationObserver callbacks
  const fetchCalls = [];
  const preparedBodies = [];
  const primaryMessages = [];
  const answerHarnessEvents = [];
  const footersByMessageId = new Map();
  const identitiesByTurnKey = new Map();
  const trustedActiveTurns = new Map();
  const trustedGenerations = new Map();
  let preparedListener = null;
  let completedListener = null;
  let turnSequence = 0;
  let fetchImpl = async () => ({ ok: true, status: 200, body: sse([{ type: 'text-delta', delta: 'ok' }]) });

  const panel = new El('div'); panel.setAttribute('part', 'panel');
  panel.rect = { ...panel.rect, width: chatWidth };
  const header = new El('header'); header.setAttribute('part', 'header');
  header.rect = { width: chatWidth, height: 60, top: 0, bottom: 60, left: 0, right: chatWidth };
  const iconCluster = new El('div');
  header.appendChild(iconCluster);
  const chatContent = new El('div'); chatContent.setAttribute('part', 'chat-content');
  chatContent.rect = { width: chatWidth, height: 800, top: 0, bottom: 800, left: 0, right: chatWidth };
  const composer = new El('form'); composer.setAttribute('part', 'composer');
  composer.rect = { width: chatWidth, height: 60, top: 740, bottom: 800, left: 0, right: chatWidth };
  const scroller = new El('div'); scroller.setAttribute('class', 'overflow-y-auto');
  chatContent.append(header, scroller, composer);

  const shadowRoot = new El('div');
  shadowRoot.appendChild(panel);
  shadowRoot.appendChild(chatContent);

  const chatHost = new El('algolia-chat');
  chatHost.shadowRoot = shadowRoot;
  if (widgetInstanceId) chatHost.__algoliaWidgetInstanceId = widgetInstanceId;
  const confidence = new El('algolia-chat-confidence');
  chatHost.appendChild(confidence);
  const extraHosts = extraWidgetInstanceIds.map((id) => {
    const host = new El('algolia-chat');
    host.__algoliaWidgetInstanceId = id;
    host.shadowRoot = new El('div');
    return host;
  });
  const addExtraHost = (id) => {
    const host = new El('algolia-chat');
    host.__algoliaWidgetInstanceId = id;
    host.shadowRoot = new El('div');
    extraHosts.push(host);
    observers.forEach((cb) => cb([{ type: 'childList' }]));
    return host;
  };
  const removeExtraHost = (id) => {
    const index = extraHosts.findIndex((host) => host.__algoliaWidgetInstanceId === id);
    if (index >= 0) extraHosts.splice(index, 1);
    observers.forEach((cb) => cb([{ type: 'childList' }]));
  };

  const documentListeners = {};
  const context = {
    console,
    URL, URLSearchParams, TextEncoder, TextDecoder, ReadableStream, AbortController,
    Promise, JSON, Math, Object, Array, String, Number, Boolean, Error, Date,
    crypto: { randomUUID: () => `id-${Math.random().toString(16).slice(2)}` },
    location: { search: '', href: 'http://localhost:5177/' },
    window: null,
    setTimeout, clearTimeout,
    requestAnimationFrame: (fn) => { frames.push(fn); return frames.length; },
    MutationObserver: class {
      constructor(cb) { observers.push(cb); }
      observe() {}
      disconnect() {}
    },
    document: {
      querySelector: (sel) => (sel === 'algolia-chat' ? chatHost : shadowRoot.querySelector(sel)),
      querySelectorAll: (sel) => (sel === 'algolia-chat' ? [chatHost, ...extraHosts] : shadowRoot.querySelectorAll(sel)),
      createElement: (tag) => new El(tag),
      addEventListener: (t, fn) => { (documentListeners[t] ||= []).push(fn); },
    },
    fetch: (...args) => { fetchCalls.push(args); return fetchImpl(...args); },
    algoliaAnswerHarness: {
      accept(event) {
        answerHarnessEvents.push(JSON.parse(JSON.stringify(event)));
      },
    },
    algoliaAnswerContributors: {
      createOpaqueActionContribution,
    },
    algoliaContextCompiler: {
      fetchPrepared: (...args) => { fetchCalls.push(args); return fetchImpl(...args); },
    },
    algoliaHandoffToOrchestrator: {
      subscribePreparedTurn(listener) {
        preparedListener = listener;
        return () => { if (preparedListener === listener) preparedListener = null; };
      },
      subscribeCompletedTurn(listener) {
        completedListener = listener;
        return () => { if (completedListener === listener) completedListener = null; };
      },
      ensureAnswerFooter(detail) {
        return footersByMessageId.get(String(detail?.messageId || '')) || null;
      },
      validateTurnEvent(detail) {
        const key = answerIdentityKey(detail?.answerIdentity);
        const trusted = key ? trustedActiveTurns.get(key) : null;
        return Boolean(
          trusted &&
          trusted.turnKey === String(detail?.turnKey || '') &&
          trusted.messageId === String(detail?.messageId || '') &&
          trusted.conversationGeneration === Number(detail?.conversationGeneration) &&
          trusted.networkAttemptOrdinal === Number(detail?.networkAttemptOrdinal),
        );
      },
    },
  };
  context.window = context;
  context.window.ACS_COMPARE = { prod: { proxyPath }, exposeForTests: true };
  context.window.innerWidth = viewportWidth;
  context.window.addEventListener = () => {};

  vm.createContext(context);
  vm.runInContext(fs.readFileSync(comparePath, 'utf8'), context);

  const flush = () => { while (frames.length) frames.shift()(); };
  const trustPreparedTurn = (detail) => {
    const key = answerIdentityKey(detail?.answerIdentity);
    if (!key) return detail;
    trustedActiveTurns.set(key, {
      turnKey: String(detail?.turnKey || ''),
      messageId: String(detail?.messageId || ''),
      conversationGeneration: Number(detail?.conversationGeneration),
      networkAttemptOrdinal: Number(detail?.networkAttemptOrdinal),
    });
    return detail;
  };
  const resetTrustedTurns = (widgetId = '') => {
    const widgetKey = String(widgetId || '').trim();
    if (widgetKey) {
      trustedGenerations.set(widgetKey, (trustedGenerations.get(widgetKey) || 0) + 1);
      for (const key of [...trustedActiveTurns.keys()]) {
        if (key.startsWith(`${widgetKey}\n`)) trustedActiveTurns.delete(key);
      }
      return;
    }
    trustedGenerations.clear();
    trustedActiveTurns.clear();
  };
  const preparedDetail = (detail, { trust = true } = {}) => {
    const next = { ...detail };
    if (next.answerIdentity) {
      const widgetKey = next.answerIdentity.widgetInstanceId;
      if (next.conversationGeneration === undefined) {
        next.conversationGeneration = trustedGenerations.get(widgetKey) || 0;
      }
      if (next.networkAttemptOrdinal === undefined) {
        const match = String(next.answerIdentity.networkAttemptId || '').match(/(?:^|[^0-9])(\d+)(?:[^0-9]|$)/);
        next.networkAttemptOrdinal = match ? Number(match[1]) : 1;
      }
    }
    if (trust) trustPreparedTurn(next);
    return next;
  };
  const addBubble = (text, { sources: hasSources = true } = {}) => {
    const b = new El('div');
    b.setAttribute('part', 'message-user-bubble');
    b.textContent = text;
    chatContent.appendChild(b);
    observers.forEach((cb) => cb([{ type: 'childList' }]));
    turnSequence += 1;
    const user = { id: `user-${turnSequence}`, role: 'user', parts: [{ type: 'text', text }] };
    primaryMessages.push(user);
    const body = JSON.stringify({ id: 'primary-conversation', messages: [...primaryMessages], trigger: 'user' });
    preparedBodies.push(body);
    const answerIdentity = {
      widgetInstanceId: 'widget-1',
      conversationId: 'primary-conversation',
      answerSegmentId: `primary-assistant-${turnSequence}`,
      networkAttemptId: `attempt-${turnSequence}`,
    };
    const turnDetail = preparedDetail({
      body,
      turnKey: `primary-conversation:${user.id}`,
      conversationGeneration: 0,
      networkAttemptOrdinal: turnSequence,
      messageId: user.id,
      question: text,
      answerIdentity,
    });
    identitiesByTurnKey.set(`primary-conversation:${user.id}`, answerIdentity);
    preparedListener?.(turnDetail);
    primaryMessages.push({
      id: `primary-assistant-${turnSequence}`,
      role: 'assistant',
      parts: [{ type: 'text', text: `primary answer ${turnSequence}` }],
    });
    const footer = new El('div');
    footer.setAttribute('class', 'flex items-end justify-between gap-4');
    const sourceWrap = new El('div');
    sourceWrap.setAttribute('class', 'min-w-0 flex-1');
    if (hasSources) {
      const sources = new El('div');
      sources.setAttribute('aria-label', 'Grounded sources');
      sourceWrap.appendChild(sources);
    }
    footer.appendChild(sourceWrap);
    scroller.appendChild(footer);
    footer.dataset.algoliaAnswerFooter = user.id;
    footersByMessageId.set(user.id, footer);
    observers.forEach((cb) => cb([{ type: 'childList' }]));
    b.turnKey = `primary-conversation:${user.id}`;
    b.footer = footer;
    return b;
  };
  const addPostAnswerControl = (messageId = `user-${turnSequence}`) => {
    const footer = footersByMessageId.get(String(messageId));
    if (!footer) return null;
    let badge = footer.querySelector('algolia-confidence-badge');
    if (!badge) {
      badge = new El('algolia-confidence-badge');
      footer.appendChild(badge);
    }
    badge.textContent = 'Confidence 9.0 /10';
    observers.forEach((cb) => cb([{ type: 'childList' }]));
    return badge;
  };
  const completeTurn = (turnKey = `primary-conversation:user-${turnSequence}`, { postAnswerReady = true } = {}) => {
    const messageId = turnKey.split(':').at(-1);
    completedListener?.({
      turnKey,
      conversationGeneration: 0,
      networkAttemptOrdinal: Number((identitiesByTurnKey.get(turnKey)?.networkAttemptId || '').match(/attempt-(\d+)/)?.[1] || 0),
      messageId,
      question: primaryMessages.find((message) => message.id === messageId)?.parts?.[0]?.text || '',
      conversationId: 'primary-conversation',
      answerIdentity: identitiesByTurnKey.get(turnKey) || null,
    });
    if (postAnswerReady) addPostAnswerControl(messageId);
    observers.forEach((cb) => cb([{ type: 'childList' }]));
  };
  const toggle = () => shadowRoot.querySelector('#acs-compare-toggle');
  const clickToggle = () => {
    const t = toggle();
    shadowRoot.dispatch('click', { composedPath: () => [t] });
  };

  // Collapse/expand the way the widget's size modes do: by changing panel width.
  const setExpanded = (on) => {
    panel.rect = { ...panel.rect, width: on ? chatWidth : Math.round(context.window.innerWidth * 0.3) };
    observers.forEach((cb) => cb([{ type: 'attributes' }]));
  };

  flush(); // initial reconcile mounts the toggle
  return {
    context, flush, addBubble, addPostAnswerControl, completeTurn, toggle, clickToggle, setExpanded, shadowRoot, chatContent, documentListeners,
    addExtraHost, removeExtraHost,
    fetchCalls, preparedBodies, answerHarnessEvents,
    setFetch: (fn) => { fetchImpl = fn; },
    api: () => ({
      ...context.window.__acsCompare,
      acceptPreparedTurn(detail) {
        return context.window.__acsCompare.acceptPreparedTurn(preparedDetail(detail));
      },
      acceptCompletedTurn(detail) {
        return context.window.__acsCompare.acceptCompletedTurn(detail);
      },
      reset(reason, widgetInstanceId = '') {
        resetTrustedTurns(widgetInstanceId);
        return context.window.__acsCompare.reset(reason, widgetInstanceId);
      },
      acceptUntrustedPreparedTurn(detail) {
        return context.window.__acsCompare.acceptPreparedTurn(preparedDetail(detail, { trust: false }));
      },
      acceptRawPreparedTurn(detail) {
        return context.window.__acsCompare.acceptPreparedTurn(detail);
      },
    }),
    settle: async () => {
      for (let i = 0; i < 25; i += 1) {
        flush();
        await new Promise((r) => setTimeout(r, 0));
      }
      flush();
    },
  };
}

/* -------------------------------------------------------------------- tests */

test('toggle is absent from the header and appears only beside answer evidence controls', async () => {
  const h = createHarness();
  assert.equal(h.toggle(), null, 'there is nothing to compare before an answer exists');
  assert.equal(h.context.document.querySelector('algolia-chat').querySelector('algolia-chat-confidence').getAttribute('mode'), null);

  h.addBubble('answer with grounded evidence');
  await h.settle();
  assert.equal(h.toggle(), null, 'toggle stays hidden while the answer is still streaming');
  h.completeTurn(undefined, { postAnswerReady: false });
  await h.settle();
  assert.equal(h.toggle(), null, 'sources alone do not make the answer footer ready for Compare');
  h.addPostAnswerControl();
  await h.settle();
  const t = h.toggle();
  assert.ok(t, 'toggle appears after an answer exists');
  assert.equal(t.getAttribute('aria-pressed'), 'false');
  assert.equal(t.parentElement.getAttribute('class'), 'flex items-end justify-between gap-4');
});

test('Compare mirrors only an opaque post-answer action slot into the answer harness', async () => {
  const h = createHarness();

  h.addBubble('answer with grounded evidence');
  await h.settle();
  assert.equal(
    h.answerHarnessEvents.some((event) => event.detail?.contribution?.kind === 'opaqueAction'),
    false,
    'Compare action is not contributed while the answer is still streaming',
  );

  h.completeTurn();
  await h.settle();
  const actionContribution = h.answerHarnessEvents.find((event) =>
    event.eventName === 'contribution' &&
    event.detail?.contribution?.kind === 'opaqueAction'
  );

  assert.ok(actionContribution);
  assert.deepEqual(
    actionContribution.detail.contribution.slots.actions,
    { status: 'ready', value: { label: 'Compare with Prod', pressed: false, available: true } },
  );
  assert.deepEqual(
    Object.keys(actionContribution.detail.contribution.slots),
    ['actions'],
    'Compare cannot contribute sources, judge, telemetry, or footer lifecycle',
  );
});

test('Compare never owns or mutates judge configuration', async () => {
  const h = createHarness();
  const confidence = h.context.document.querySelector('algolia-chat').querySelector('algolia-chat-confidence');
  h.addBubble('normal answer');
  await h.settle();
  h.completeTurn();
  await h.settle();
  assert.equal(confidence.getAttribute('mode'), null);

  h.clickToggle();
  await h.settle();
  assert.equal(confidence.getAttribute('mode'), null, 'post-answer Compare cannot configure judging');

  h.addBubble('future turn while Compare is already on');
  await h.settle();
  assert.equal(confidence.getAttribute('mode'), null, 'future Compare turns cannot suppress judging');
  h.completeTurn();
  await h.settle();

  h.clickToggle();
  await h.settle();
  assert.equal(confidence.getAttribute('mode'), null, 'turning Compare off cannot reconfigure judging');
});

test('normal centered panel remains eligible on a wide viewport', () => {
  const h = createHarness({ chatWidth: 1080, viewportWidth: 2266 });
  h.addBubble('answer');
  h.completeTurn();
  h.flush();
  assert.ok(h.toggle(), '1080px normal panel must not be mistaken for the docked panel');
  h.setExpanded(false);
  h.flush();
  assert.ok(h.toggle(), 'the completed-answer footer action must not disappear when the panel is docked');
});

test('production panel cannot open before an answer exists', () => {
  const h = createHarness();
  assert.equal(h.toggle(), null);
  assert.equal(h.shadowRoot.querySelector('#acs-compare-empty'), null);
  assert.equal(h.api().state().compareOn, false);
});

test('compare off: asking a question never calls production', async () => {
  const h = createHarness();
  h.addBubble('What is NeuralSearch?');
  await h.settle();
  assert.equal(h.fetchCalls.length, 0);
});

test('an existing answer can be compared later using its exact prepared request', async () => {
  const h = createHarness();
  h.addBubble('asked before compare was on');
  await h.settle();
  h.completeTurn();
  await h.settle();

  assert.equal(h.api().state().hasPreparedTurn, true);
  assert.equal(h.toggle().textContent, 'Compare with Prod');
  h.clickToggle();
  await h.settle();
  assert.equal(h.api().state().compareOn, true, 'can enable after the answer exists');
  assert.equal(h.fetchCalls.length, 1, 'the latest existing turn is replayed once');
  assert.equal(h.fetchCalls[0][1].body, h.preparedBodies[0], 'replay remains byte-identical');

  // After reset, the prior conversation is forgotten and cannot be replayed.
  (h.documentListeners['algolia-visitor-state-reset'] || []).forEach((fn) => fn({ detail: {} }));
  await h.settle();
  assert.equal(h.api().state().hasPreparedTurn, false);
  assert.equal(h.toggle(), null, 'reset removes the answer-scoped control');
  assert.equal(h.api().state().compareOn, false);
  assert.equal(h.fetchCalls.length, 1, 'the reset conversation does not replay old work');
});

test('sourceful turn followed by a no-source turn moves Compare to the exact newest footer', async () => {
  const h = createHarness();
  const first = h.addBubble('sourceful first');
  h.completeTurn(first.turnKey);
  await h.settle();
  assert.equal(h.toggle().parentElement, first.footer);

  const second = h.addBubble('no sources second', { sources: false });
  h.completeTurn(second.turnKey);
  await h.settle();
  assert.equal(h.toggle().parentElement, second.footer);
  assert.equal(second.footer.querySelector('[aria-label="Grounded sources"]'), null);

  h.clickToggle();
  await h.settle();
  assert.equal(h.fetchCalls.length, 1);
  assert.equal(h.fetchCalls[0][1].body, h.preparedBodies[1]);
});

test('two turns run in order and turn two carries turn one in history', async () => {
  const h = createHarness();
  h.setFetch(async (_url, init) => ({
    ok: true, status: 200,
    body: sse([{ type: 'text-delta', delta: `answer for ${JSON.parse(init.body).messages.at(-1).parts[0].text}` }]),
  }));
  h.addBubble('first question');
  await h.settle();
  h.completeTurn();
  await h.settle();
  h.clickToggle();
  await h.settle();
  h.addBubble('second question');
  await h.settle();

  assert.equal(h.fetchCalls.length, 2);
  const first = JSON.parse(h.fetchCalls[0][1].body);
  const second = JSON.parse(h.fetchCalls[1][1].body);
  assert.equal(first.messages.length, 1, 'turn one sends only the new question');
  assert.equal(second.messages.length, 3, 'turn two sends user + assistant + user');
  assert.equal(second.messages[0].parts[0].text, 'first question');
  assert.equal(second.messages[1].role, 'assistant');
  assert.equal(second.messages[2].parts[0].text, 'second question');
  assert.equal(first.id, second.id, 'conversation id is stable across turns');
});

test('question one keeps Compare available when it was left OFF', async () => {
  const h = createHarness();
  assert.equal(h.toggle(), null, 'header stays free of Compare');

  h.addBubble('question one, asked with Compare off');
  await h.settle();
  h.completeTurn();
  await h.settle();

  assert.notEqual(h.toggle().getAttribute('aria-disabled'), 'true');
  assert.equal(h.toggle().textContent, 'Compare with Prod');
  assert.match(h.toggle().getAttribute('aria-label') || '', /answer with production/i);
  assert.equal(h.api().state().hasPreparedTurn, true);

  h.clickToggle();
  await h.settle();
  assert.equal(h.api().state().compareOn, true, 'can be enabled mid-conversation');
  assert.equal(h.toggle().getAttribute('aria-pressed'), 'true');
  assert.equal(h.fetchCalls.length, 1, 'the retained request is sent to production');

  // A reset clears the retained replay packet.
  (h.documentListeners['algolia-visitor-state-reset'] || []).forEach((fn) => fn({ detail: {} }));
  await h.settle();
  assert.equal(h.api().state().hasPreparedTurn, false);
  assert.equal(h.toggle(), null, 'a new conversation has no answer action yet');
  assert.equal(h.api().state().compareOn, false);
});

test('compare can be turned off and on again without duplicating a mirrored turn', async () => {
  const h = createHarness();
  h.addBubble('one comparison');
  await h.settle();
  h.completeTurn();
  await h.settle();
  h.clickToggle();
  await h.settle();
  assert.equal(h.fetchCalls.length, 1);
  h.clickToggle();
  await h.settle();
  assert.equal(h.toggle().getAttribute('aria-pressed'), 'false');
  h.clickToggle();
  await h.settle();
  assert.equal(h.toggle().getAttribute('aria-pressed'), 'true');
  assert.equal(h.fetchCalls.length, 1, 'the same prepared turn is never replayed twice');
});

test('visitor reset clears mirrored state, turns Compare off, and unlocks the toggle', async () => {
  const h = createHarness();
  h.addBubble('q1');
  await h.settle();
  h.completeTurn();
  await h.settle();
  h.clickToggle();
  await h.settle();
  const before = h.api().state();
  assert.ok(before.mirroredTurns > 0);

  (h.documentListeners['algolia-visitor-state-reset'] || []).forEach((fn) => fn({ detail: { source: 'test' } }));
  await h.settle();

  const after = h.api().state();
  assert.equal(after.mirroredTurns, 0, 'mirrored turn state cleared');
  assert.equal(after.hasPreparedTurn, false, 'the prior replay packet is cleared');
  assert.equal(after.compareOn, false, 'a new conversation defaults Compare to off');
  assert.ok(after.generation > before.generation, 'generation advanced');
});

test('a late response from a previous conversation is discarded', async () => {
  const h = createHarness();
  let release;
  h.setFetch(() => new Promise((resolve) => {
    release = () => resolve({ ok: true, status: 200, body: sse([{ type: 'text-delta', delta: 'stale answer' }]) });
  }));
  h.addBubble('q1');
  await h.settle();
  h.completeTurn();
  await h.settle();
  h.clickToggle();
  await h.settle();

  (h.documentListeners['algolia-visitor-state-reset'] || []).forEach((fn) => fn({ detail: {} }));
  await h.settle();
  release();                                          // resolves after the reset
  await h.settle();

  assert.equal(h.api().state().mirroredTurns, 0, 'stale answer must not enter the new generation');
});

test('a production failure is contained and never throws', async () => {
  const h = createHarness();
  h.setFetch(async () => ({ ok: false, status: 503, text: async () => 'upstream down', body: null }));
  h.addBubble('q1');
  h.completeTurn();
  h.clickToggle();
  await assert.doesNotReject(h.settle());
  assert.equal(h.api().state().mirroredTurns, 0, 'failed turn is not counted as completed');
});

test('window.fetch is never patched (proactive handoff owns the transport)', () => {
  const h = createHarness();
  const before = h.context.fetch;
  h.addBubble('answer');
  h.completeTurn();
  h.clickToggle();
  h.flush();
  assert.equal(h.context.fetch, before, 'compare must not replace window.fetch');
  assert.equal(fs.readFileSync(comparePath, 'utf8').includes('window.fetch ='), false);
});

test('source URLs are sanitised: only http/https survive', () => {
  const { safeHref } = createHarness().api();
  assert.equal(safeHref('javascript:alert(1)'), null);
  assert.equal(safeHref('data:text/html;base64,PHN2Zz4='), null);
  assert.equal(safeHref('/doc/guides'), 'https://www.algolia.com/doc/guides');
  assert.equal(safeHref('https://www.algolia.com/x'), 'https://www.algolia.com/x');
  assert.equal(safeHref(''), null);
  assert.equal(safeHref(null), null);
});

test('markdown escapes html and drops unsafe link protocols', () => {
  const { md } = createHarness().api();
  const out = md('<img src=x onerror=alert(1)> [click](javascript:alert(1)) [ok](https://www.algolia.com/a)');
  assert.equal(out.includes('<img'), false, 'raw html is escaped');
  assert.equal(out.includes('javascript:'), false, 'unsafe link is not emitted as an href');
  assert.ok(out.includes('href="https://www.algolia.com/a"'));
});

test('narrow widths stack instead of splitting 50/50', () => {
  const wide = createHarness({ chatWidth: 1000 });
  wide.addBubble('wide answer');
  wide.completeTurn();
  wide.flush();
  wide.clickToggle(); wide.flush();
  const narrow = createHarness({ chatWidth: 500, viewportWidth: 600 });
  narrow.addBubble('narrow answer');
  narrow.completeTurn();
  narrow.flush();
  narrow.clickToggle(); narrow.flush();
  const wideStyle = wide.shadowRoot.querySelector('#acs-compare-style');
  const narrowStyle = narrow.shadowRoot.querySelector('#acs-compare-style');
  assert.match(wideStyle.textContent || wideStyle._text, /padding-right/);
  assert.match(narrowStyle.textContent || narrowStyle._text, /padding-bottom/);
});

test('compare is inert when no production endpoint is configured', () => {
  const h = createHarness({ proxyPath: '' });
  assert.equal(h.toggle(), null, 'no toggle without configuration');
});

test('Compare survives collapse and expand, and turn two keeps turn one', async () => {
  const h = createHarness();
  h.setFetch(async (_url, init) => ({
    ok: true, status: 200,
    body: sse([{ type: 'text-delta', delta: `answer:${JSON.parse(init.body).messages.at(-1).parts[0].text}` }]),
  }));

  h.addBubble('question one');
  await h.settle();
  h.completeTurn();
  await h.settle();
  h.clickToggle();
  await h.settle();
  assert.equal(h.fetchCalls.length, 1, 'turn one reaches production');

  h.setExpanded(false);                               // collapse
  await h.settle();
  assert.equal(h.api().state().compareOn, true, 'collapsing must not disable Compare');

  h.setExpanded(true);                                // reopen
  await h.settle();
  assert.equal(h.toggle()?.getAttribute('aria-pressed'), 'true', 'still on after reopening');

  h.addBubble('question two');
  await h.settle();

  assert.equal(h.fetchCalls.length, 2, 'turn two still reaches production');
  const second = JSON.parse(h.fetchCalls[1][1].body);
  assert.equal(second.messages.length, 3, 'turn two carries turn one user + assistant');
  assert.equal(second.messages[0].parts[0].text, 'question one');
  assert.equal(second.messages[2].parts[0].text, 'question two');
});

test('production receives the exact prepared primary body bytes and retries are deduplicated', async () => {
  const h = createHarness();
  h.addBubble('same packet please');
  await h.settle();
  h.completeTurn();
  await h.settle();
  h.clickToggle();
  await h.settle();

  assert.equal(h.fetchCalls.length, 1);
  assert.equal(h.fetchCalls[0][1].body, h.preparedBodies[0], 'body must be byte-identical');

  h.api().acceptPreparedTurn({
    body: h.preparedBodies[0],
    turnKey: 'primary-conversation:user-1',
    question: 'same packet please',
  });
  await h.settle();
  assert.equal(h.fetchCalls.length, 1, 'a primary retry/tool continuation cannot mirror twice');
});

test('explicit unmatched canonical widget identity fails closed on an unidentified host', async () => {
  const h = createHarness({ widgetInstanceId: '' });
  h.api().acceptPreparedTurn({
    body: JSON.stringify({ question: 'must not attach' }),
    turnKey: 'unmatched-conversation:user-1',
    messageId: 'user-1',
    question: 'must not attach',
    answerIdentity: {
      widgetInstanceId: 'missing-widget',
      conversationId: 'unmatched-conversation',
      answerSegmentId: 'assistant-1',
      networkAttemptId: 'attempt-1',
    },
  });
  await h.settle();

  assert.equal(h.api().state().hasPreparedTurn, false);
  assert.equal(h.fetchCalls.length, 0);
});

test('incomplete nested answer identity fails closed instead of using legacy fallback', async () => {
  const h = createHarness({ widgetInstanceId: '' });
  h.api().acceptPreparedTurn({
    body: JSON.stringify({ question: 'must not degrade to legacy' }),
    turnKey: 'incomplete-conversation:user-1',
    messageId: 'user-1',
    question: 'must not degrade to legacy',
    answerIdentity: {
      widgetInstanceId: 'widget-1',
      conversationId: 'incomplete-conversation',
      answerSegmentId: 'assistant-1',
    },
  });
  h.api().acceptCompletedTurn({
    turnKey: 'incomplete-conversation:user-1',
    messageId: 'user-1',
    answerIdentity: {
      widgetInstanceId: 'widget-1',
      conversationId: 'incomplete-conversation',
      answerSegmentId: 'assistant-1',
    },
  });
  await h.settle();

  assert.equal(h.api().state().hasPreparedTurn, false);
  assert.equal(h.api().state().completedTurns, 0);
  assert.equal(h.fetchCalls.length, 0);
});

test('identity-less completion works only through the one-host legacy fallback', async () => {
  const h = createHarness({ widgetInstanceId: '' });
  h.api().acceptPreparedTurn({
    body: JSON.stringify({ question: 'legacy single host' }),
    turnKey: 'legacy-conversation:user-1',
    messageId: 'user-1',
    question: 'legacy single host',
  });
  h.api().acceptCompletedTurn({
    turnKey: 'legacy-conversation:user-1',
    messageId: 'user-1',
    question: 'legacy single host',
  });
  await h.settle();

  assert.equal(h.api().state().hasPreparedTurn, true);
  assert.equal(h.api().state().completedTurns, 1);
});

test('Compare dedupe is scoped by answer identity, not bare turnKey', async () => {
  const h = createHarness();
  h.addBubble('prime comparison');
  await h.settle();
  h.completeTurn();
  await h.settle();
  h.clickToggle();
  await h.settle();

  const body = h.preparedBodies[0];
  h.api().acceptPreparedTurn({
    body,
    turnKey: 'same-conversation:same-user-message',
    conversationGeneration: 0,
    networkAttemptOrdinal: 2,
    messageId: 'left-message',
    question: 'left',
    answerIdentity: {
      widgetInstanceId: 'widget-1',
      conversationId: 'same-conversation',
      answerSegmentId: 'same-segment',
      networkAttemptId: 'attempt-left',
    },
  });
  h.api().acceptPreparedTurn({
    body,
    turnKey: 'same-conversation:same-user-message',
    conversationGeneration: 0,
    networkAttemptOrdinal: 3,
    messageId: 'right-message',
    question: 'right',
    answerIdentity: {
      widgetInstanceId: 'widget-1',
      conversationId: 'same-conversation',
      answerSegmentId: 'same-segment',
      networkAttemptId: 'attempt-right',
    },
  });
  await h.settle();

  assert.equal(h.fetchCalls.length, 3, 'distinct answer identities with the same turnKey must both be eligible for Compare');
  assert.equal(h.fetchCalls[1][1].body, body);
  assert.equal(h.fetchCalls[2][1].body, body);
});

test('Compare accepted-attempt state is bounded without reopening stale turns', async () => {
  const h = createHarness();
  h.setFetch(async () => ({
    ok: true,
    status: 200,
    body: sse([{ type: 'text-delta', delta: 'bounded' }]),
  }));
  h.addBubble('seed comparison');
  await h.settle();
  h.completeTurn();
  await h.settle();
  h.clickToggle();
  await h.settle();
  const fetchesAfterOriginal = h.fetchCalls.length;

  for (let i = 0; i < 620; i += 1) {
    const attemptNumber = i + 2;
    const answerIdentity = {
      widgetInstanceId: 'widget-1',
      conversationId: 'bounded-conversation',
      answerSegmentId: `bounded-segment-${i}`,
      networkAttemptId: `bounded-attempt-${attemptNumber}`,
    };
	    h.api().acceptPreparedTurn({
	      body: JSON.stringify({ question: `bounded ${i}` }),
	      turnKey: `bounded-conversation:user-${i}`,
	      messageId: `bounded-user-${i}`,
	      question: `bounded ${i}`,
	      answerIdentity,
	      networkAttemptOrdinal: attemptNumber,
	    });
	  }
  await h.settle();

  assert.ok(
    h.api().state().mirroredTurnDiagnostics <= 500,
    `mirrored turn diagnostics should be bounded, got ${h.api().state().mirroredTurnDiagnostics}`,
  );
  assert.ok(
    h.api().state().acceptedAttemptSegments <= 500,
    `accepted attempt state should be bounded, got ${h.api().state().acceptedAttemptSegments}`,
  );
  h.api().acceptPreparedTurn({
    body: h.preparedBodies[0],
    turnKey: 'primary-conversation:user-1',
    question: 'seed comparison',
    answerIdentity: {
      widgetInstanceId: 'widget-1',
      conversationId: 'primary-conversation',
	      answerSegmentId: 'primary-assistant-1',
	      networkAttemptId: 'attempt-1',
	    },
	    networkAttemptOrdinal: 1,
	  });
	  await h.settle();
  assert.equal(
    h.fetchCalls.length,
    fetchesAfterOriginal + 620,
	    'an evicted diagnostic key must not make an old prepared turn replayable',
	  );
	  assert.equal(h.api().acceptPreparedTurn({
	    body: JSON.stringify({ question: 'fresh retry after bounded eviction' }),
	    turnKey: 'primary-conversation:user-1',
	    question: 'fresh retry after bounded eviction',
	    answerIdentity: {
	      widgetInstanceId: 'widget-1',
	      conversationId: 'primary-conversation',
	      answerSegmentId: 'primary-assistant-1',
	      networkAttemptId: 'fresh-after-eviction',
	    },
	    networkAttemptOrdinal: 623,
	  }), true, 'a fresh higher-ordinal attempt on the evicted segment must still be accepted');
	});

test('Compare rejects exact canonical prepared replay after scoped reset', async () => {
  const h = createHarness();
  h.addBubble('seed scoped reset comparison');
  await h.settle();
  assert.equal(h.api().state().acceptedTurns, 1);

  h.api().reset('scoped-reset-test', 'widget-1');
  await h.settle();
  assert.equal(h.api().state().acceptedTurns, 0);
  assert.equal(h.api().state().retiredAttemptSegments, 1);

  h.api().acceptPreparedTurn({
    body: h.preparedBodies[0],
    turnKey: 'primary-conversation:user-1',
    messageId: 'user-1',
    question: 'seed scoped reset comparison',
    answerIdentity: {
      widgetInstanceId: 'widget-1',
      conversationId: 'primary-conversation',
      answerSegmentId: 'primary-assistant-1',
      networkAttemptId: 'attempt-1',
    },
  });
  await h.settle();

  assert.equal(h.api().state().acceptedTurns, 0, 'scoped reset must not reopen the exact old prepared identity');
  assert.equal(h.api().state().hasPreparedTurn, false);
});

test('Compare rejects exact opaque canonical prepared replay after scoped reset', async () => {
  const h = createHarness();
  const opaqueIdentity = {
    widgetInstanceId: 'widget-1',
    conversationId: 'opaque-conversation',
    answerSegmentId: 'opaque-assistant',
    networkAttemptId: 'request-left',
  };
  h.api().acceptPreparedTurn({
    body: JSON.stringify({ question: 'opaque scoped reset comparison' }),
    turnKey: 'opaque-conversation:user-1',
    messageId: 'user-1',
    question: 'opaque scoped reset comparison',
    answerIdentity: opaqueIdentity,
  });
  await h.settle();
  assert.equal(h.api().state().acceptedTurns, 1);

  h.api().reset('scoped-reset-test', 'widget-1');
  await h.settle();
  assert.equal(h.api().state().acceptedTurns, 0);
  assert.equal(h.api().state().retiredAttemptSegments, 1);

  h.api().acceptPreparedTurn({
    body: JSON.stringify({ question: 'opaque scoped reset comparison' }),
    turnKey: 'opaque-conversation:user-1',
    messageId: 'user-1',
    question: 'opaque scoped reset comparison',
    answerIdentity: opaqueIdentity,
  });
  await h.settle();

  assert.equal(h.api().state().acceptedTurns, 0, 'scoped reset must retire exact opaque attempt IDs');
  assert.equal(h.api().state().hasPreparedTurn, false);
});

test('Compare rejects old opaque attempts after reset but accepts a new same-segment retry', async () => {
  const h = createHarness();
  const attemptA = {
    widgetInstanceId: 'widget-1',
    conversationId: 'opaque-retry-conversation',
    answerSegmentId: 'opaque-retry-assistant',
    networkAttemptId: 'request-left',
  };
	  const attemptB = {
	    ...attemptA,
	    networkAttemptId: 'request-right',
	  };
	  const attemptC = {
	    ...attemptA,
	    networkAttemptId: 'request-after-reset',
	  };
  const baseTurn = {
    body: JSON.stringify({ question: 'opaque retry comparison' }),
    turnKey: 'opaque-retry-conversation:user-1',
    messageId: 'user-1',
    question: 'opaque retry comparison',
  };

	  h.api().acceptPreparedTurn({ ...baseTurn, answerIdentity: attemptA, networkAttemptOrdinal: 1 });
	  h.api().acceptPreparedTurn({ ...baseTurn, answerIdentity: attemptB, networkAttemptOrdinal: 2 });
	  await h.settle();
	  assert.equal(h.api().state().acceptedTurns, 1, 'same segment keeps only the latest live attempt');

  h.api().reset('scoped-reset-test', 'widget-1');
  await h.settle();

	  assert.equal(h.api().acceptPreparedTurn({ ...baseTurn, answerIdentity: attemptA, networkAttemptOrdinal: 1 }), false);
	  assert.equal(h.api().acceptPreparedTurn({
	    ...baseTurn,
	    turnKey: '1:opaque-retry-conversation:user-1',
	    conversationGeneration: 1,
	    answerIdentity: attemptC,
	    networkAttemptOrdinal: 3,
	  }), true);
	  await h.settle();

	  assert.equal(h.api().state().acceptedTurns, 1, 'reset must allow a legitimate new same-segment retry');
	  assert.equal(h.api().state().hasPreparedTurn, true);
	});

test('Compare rejects exact canonical prepared replay after global reset', async () => {
  const h = createHarness();
  h.addBubble('seed global reset comparison');
  await h.settle();
  assert.equal(h.api().state().acceptedTurns, 1);

  h.api().reset('global-reset-test');
  await h.settle();
  assert.equal(h.api().state().acceptedTurns, 0);
  assert.equal(h.api().state().retiredAttemptSegments, 1);

  h.api().acceptPreparedTurn({
    body: h.preparedBodies[0],
    turnKey: 'primary-conversation:user-1',
    messageId: 'user-1',
    question: 'seed global reset comparison',
    answerIdentity: {
      widgetInstanceId: 'widget-1',
      conversationId: 'primary-conversation',
      answerSegmentId: 'primary-assistant-1',
      networkAttemptId: 'attempt-1',
    },
  });
  await h.settle();

  assert.equal(h.api().state().acceptedTurns, 0, 'global reset must not reopen the exact old prepared identity');
  assert.equal(h.api().state().hasPreparedTurn, false);
});

test('Compare rejects exact opaque canonical prepared replay after global reset', async () => {
  const h = createHarness();
  const opaqueIdentity = {
    widgetInstanceId: 'widget-1',
    conversationId: 'opaque-global-conversation',
    answerSegmentId: 'opaque-global-assistant',
    networkAttemptId: 'prod-request-alpha',
  };
  h.api().acceptPreparedTurn({
    body: JSON.stringify({ question: 'opaque global reset comparison' }),
    turnKey: 'opaque-global-conversation:user-1',
    messageId: 'user-1',
    question: 'opaque global reset comparison',
    answerIdentity: opaqueIdentity,
  });
  await h.settle();
  assert.equal(h.api().state().acceptedTurns, 1);

  h.api().reset('global-reset-test');
  await h.settle();
  assert.equal(h.api().state().acceptedTurns, 0);
  assert.equal(h.api().state().retiredAttemptSegments, 1);

  h.api().acceptPreparedTurn({
    body: JSON.stringify({ question: 'opaque global reset comparison' }),
    turnKey: 'opaque-global-conversation:user-1',
    messageId: 'user-1',
    question: 'opaque global reset comparison',
    answerIdentity: opaqueIdentity,
  });
  await h.settle();

  assert.equal(h.api().state().acceptedTurns, 0, 'global reset must retire exact opaque attempt IDs');
  assert.equal(h.api().state().hasPreparedTurn, false);
});

test('Compare rejects exact opaque canonical prepared replay after disconnect and reconnect', async () => {
  const h = createHarness();
  const opaqueIdentity = {
    widgetInstanceId: 'widget-1',
    conversationId: 'opaque-disconnect-conversation',
    answerSegmentId: 'opaque-disconnect-assistant',
    networkAttemptId: 'live-request-token',
  };
  const turn = {
    body: JSON.stringify({ question: 'opaque disconnect comparison' }),
    turnKey: 'opaque-disconnect-conversation:user-1',
    messageId: 'user-1',
    question: 'opaque disconnect comparison',
    answerIdentity: opaqueIdentity,
  };
  h.api().acceptPreparedTurn(turn);
  await h.settle();
  assert.equal(h.api().state().acceptedTurns, 1);

  h.api().reset('disconnected', 'widget-1');
  await h.settle();
  h.api().acceptPreparedTurn(turn);
  await h.settle();

  assert.equal(h.api().state().acceptedTurns, 0, 'disconnect/reconnect must not reopen an exact opaque prepared identity');
  assert.equal(h.api().state().hasPreparedTurn, false);
});

test('Compare rejects exact legacy prepared replay after scoped reset', async () => {
  const h = createHarness();
  const turn = {
    body: JSON.stringify({ question: 'legacy scoped reset comparison' }),
    turnKey: 'legacy-scoped-conversation:user-1',
    messageId: 'user-1',
    widgetInstanceId: 'widget-1',
    question: 'legacy scoped reset comparison',
  };
  h.api().acceptPreparedTurn(turn);
  await h.settle();
  assert.equal(h.api().state().acceptedTurns, 1);

  h.api().reset('scoped-reset-test', 'widget-1');
  await h.settle();
  assert.equal(h.api().state().acceptedTurns, 0);
  assert.equal(h.api().state().legacyRetiredTurns, 1);

  h.api().acceptPreparedTurn(turn);
  await h.settle();

  assert.equal(h.api().state().acceptedTurns, 0, 'scoped reset must retire exact legacy turn keys');
  assert.equal(h.api().state().hasPreparedTurn, false);
});

test('Compare rejects exact legacy prepared replay after global reset', async () => {
  const h = createHarness();
  const turn = {
    body: JSON.stringify({ question: 'legacy global reset comparison' }),
    turnKey: 'legacy-global-conversation:user-1',
    messageId: 'user-1',
    widgetInstanceId: 'widget-1',
    question: 'legacy global reset comparison',
  };
  h.api().acceptPreparedTurn(turn);
  await h.settle();
  assert.equal(h.api().state().acceptedTurns, 1);

  h.api().reset('global-reset-test');
  await h.settle();
  assert.equal(h.api().state().acceptedTurns, 0);
  assert.equal(h.api().state().legacyRetiredTurns, 1);

  h.api().acceptPreparedTurn(turn);
  await h.settle();

  assert.equal(h.api().state().acceptedTurns, 0, 'global reset must retire exact legacy turn keys');
  assert.equal(h.api().state().hasPreparedTurn, false);
});

test('Compare rejects legacy prepared replay after accepted legacy keys exceed the retention window', async () => {
  const h = createHarness();
  const firstTurn = {
    body: JSON.stringify({ question: 'legacy bounded 0' }),
    turnKey: 'legacy-bounded-conversation:user-0',
    messageId: 'legacy-user-0',
    widgetInstanceId: 'widget-1',
    question: 'legacy bounded 0',
  };

  h.api().acceptPreparedTurn(firstTurn);
  for (let i = 1; i < 506; i += 1) {
    h.api().acceptPreparedTurn({
      body: JSON.stringify({ question: `legacy bounded ${i}` }),
      turnKey: `legacy-bounded-conversation:user-${i}`,
      messageId: `legacy-user-${i}`,
      widgetInstanceId: 'widget-1',
      question: `legacy bounded ${i}`,
    });
  }
  await h.settle();
  assert.ok(h.api().state().legacyAcceptedTurns <= 500, 'live legacy acceptance state should remain bounded');

  h.api().reset('scoped-reset-test', 'widget-1');
  await h.settle();
  h.api().acceptPreparedTurn(firstTurn);
  await h.settle();

  assert.equal(h.api().state().acceptedTurns, 0, 'legacy keys evicted from live retention must still be retired after reset');
  assert.equal(h.api().state().hasPreparedTurn, false);
});

test('Compare accepted-attempt guard is bounded per widget and not evicted by sibling traffic', async () => {
  const h = createHarness({ extraWidgetInstanceIds: ['widget-b'] });
  h.addBubble('widget A original');
  await h.settle();
  assert.equal(h.api().state().acceptedTurns, 1);

  for (let i = 0; i < 620; i += 1) {
    h.api().acceptPreparedTurn({
      body: JSON.stringify({ question: `widget b ${i}` }),
      turnKey: `widget-b-conversation:user-${i}`,
      messageId: `widget-b-user-${i}`,
      question: `widget b ${i}`,
      answerIdentity: {
        widgetInstanceId: 'widget-b',
        conversationId: 'widget-b-conversation',
        answerSegmentId: `widget-b-segment-${i}`,
        networkAttemptId: `widget-b-attempt-${i + 1}`,
      },
    });
  }
  await h.settle();
  const beforeReplay = h.api().state();

  h.api().acceptPreparedTurn({
    body: h.preparedBodies[0],
    turnKey: 'primary-conversation:user-1',
    messageId: 'user-1',
    question: 'widget A original',
    answerIdentity: {
      widgetInstanceId: 'widget-1',
      conversationId: 'primary-conversation',
      answerSegmentId: 'primary-assistant-1',
      networkAttemptId: 'attempt-1',
    },
  });
  await h.settle();
  const afterReplay = h.api().state();

  assert.equal(beforeReplay.acceptedAttemptWidgets, 2, 'sibling traffic should not delete widget A attempt state');
  assert.equal(afterReplay.acceptedTurns, beforeReplay.acceptedTurns, 'widget B traffic must not make widget A stale turn replayable');
  assert.ok(afterReplay.acceptedAttemptSegments <= 501, 'each widget bounds its own accepted segment history');
});

test('Compare keeps widget A completion and cached history after 500+ widget B completions', async () => {
  const h = createHarness({ extraWidgetInstanceIds: ['widget-b'] });
  const a1 = h.addBubble('widget A one');
  h.completeTurn(a1.turnKey);
  const a1Turn = {
    identityKey: 'widget-1\nprimary-conversation\nprimary-assistant-1\nattempt-1',
    answerIdentity: {
      widgetInstanceId: 'widget-1',
      conversationId: 'primary-conversation',
      answerSegmentId: 'primary-assistant-1',
      networkAttemptId: 'attempt-1',
    },
    question: 'widget A one',
  };
  h.api().rememberProductionTurnResultForTest(a1Turn, { status: 'done', text: 'A1 cached production', sources: [], question: 'widget A one' });

  const a2 = h.addBubble('widget A two');
  h.completeTurn(a2.turnKey);
  const a2Turn = {
    identityKey: 'widget-1\nprimary-conversation\nprimary-assistant-2\nattempt-2',
    answerIdentity: {
      widgetInstanceId: 'widget-1',
      conversationId: 'primary-conversation',
      answerSegmentId: 'primary-assistant-2',
      networkAttemptId: 'attempt-2',
    },
    question: 'widget A two',
  };
  h.api().rememberProductionTurnResultForTest(a2Turn, { status: 'done', text: 'A2 cached production', sources: [], question: 'widget A two' });

  for (let i = 0; i < 620; i += 1) {
    const identityKey = `widget-b\nwidget-b-conversation\nwidget-b-segment-${i}\nwidget-b-attempt-${i + 1}`;
    const answerIdentity = {
      widgetInstanceId: 'widget-b',
      conversationId: 'widget-b-conversation',
      answerSegmentId: `widget-b-segment-${i}`,
      networkAttemptId: `widget-b-attempt-${i + 1}`,
    };
    h.api().acceptPreparedTurn({
      body: JSON.stringify({ question: `widget b ${i}` }),
      turnKey: `widget-b-conversation:user-${i}`,
      messageId: `widget-b-user-${i}`,
      question: `widget b ${i}`,
      answerIdentity,
    });
    h.api().acceptCompletedTurn({
      turnKey: `widget-b-conversation:user-${i}`,
      messageId: `widget-b-user-${i}`,
      question: `widget b ${i}`,
      answerIdentity,
    });
    h.api().rememberProductionTurnResultForTest(
      { identityKey, answerIdentity, question: `widget b ${i}` },
      { status: 'done', text: `B${i} cached production`, sources: [], question: `widget b ${i}` },
    );
  }
  await h.settle();

  h.clickToggle();
  await h.settle();
  const panelText = h.shadowRoot.querySelector('#acs-compare-panel')?.textContent || '';
  assert.match(panelText, /A1 cached production/);
  assert.match(panelText, /A2 cached production/);
  assert.doesNotMatch(panelText, /B619 cached production/);
  assert.equal(h.toggle()?.textContent, 'Compare with Prod', 'widget A completion should still keep its Compare toggle eligible');
});

test('Compare retired attempt state is bounded across repeated fresh widget disconnects', async () => {
  const h = createHarness();
  const firstIdentity = {
    widgetInstanceId: 'temp-widget-0',
    conversationId: 'temp-conversation',
    answerSegmentId: 'temp-assistant-0',
    networkAttemptId: 'request-left',
  };
  for (let i = 0; i < 160; i += 1) {
    const widgetId = `temp-widget-${i}`;
    h.addExtraHost(widgetId);
    const answerIdentity = i === 0 ? firstIdentity : {
      widgetInstanceId: widgetId,
      conversationId: 'temp-conversation',
      answerSegmentId: `temp-assistant-${i}`,
      networkAttemptId: `opaque-request-${i}`,
    };
	    h.api().acceptPreparedTurn({
	      body: JSON.stringify({ question: `temp ${i}` }),
	      turnKey: `temp-conversation:user-${i}`,
	      messageId: `temp-user-${i}`,
	      question: `temp ${i}`,
	      answerIdentity,
	      networkAttemptOrdinal: i + 1,
	    });
    h.removeExtraHost(widgetId);
    h.api().reset('disconnected', widgetId);
  }
  await h.settle();
  const bounded = h.api().state();
	  assert.ok(bounded.retiredAttemptWidgets <= 1000, `outer retired widget state should be bounded, got ${bounded.retiredAttemptWidgets}`);

  h.addExtraHost('temp-widget-0');
  h.api().acceptPreparedTurn({
    body: JSON.stringify({ question: 'temp 0' }),
    turnKey: 'temp-conversation:user-0',
    messageId: 'temp-user-0',
    question: 'temp 0',
	    answerIdentity: firstIdentity,
	    networkAttemptOrdinal: 1,
	  });
  await h.settle();

  assert.equal(h.api().state().acceptedTurns, 0, 'a stale disconnected widget identity must still fail closed after outer pruning');
});

test('Compare same-segment opaque retry/reset state remains bounded', async () => {
  const h = createHarness();
  const baseTurn = {
    body: JSON.stringify({ question: 'same segment opaque churn' }),
    turnKey: 'same-segment-conversation:user-1',
    messageId: 'same-segment-user-1',
    question: 'same segment opaque churn',
  };
  for (let i = 0; i < 700; i += 1) {
    h.api().acceptPreparedTurn({
      ...baseTurn,
      answerIdentity: {
        widgetInstanceId: 'widget-1',
        conversationId: 'same-segment-conversation',
	        answerSegmentId: 'same-segment-assistant',
	        networkAttemptId: `opaque-request-${i}`,
	      },
	      networkAttemptOrdinal: i + 1,
	    });
	  }
  await h.settle();
  assert.equal(h.api().state().acceptedAttemptSegments, 1, 'live retry state is one segment, not one opaque id per retry');

  h.api().reset('scoped-reset-test', 'widget-1');
  await h.settle();

  assert.equal(h.api().state().acceptedTurns, 0);
	  assert.ok(h.api().state().retiredAttemptSegments <= 500, 'retired exact retry state is bounded');
	  assert.equal(h.api().acceptPreparedTurn({
	    ...baseTurn,
	    turnKey: '1:same-segment-conversation:user-1',
	    conversationGeneration: 1,
	    answerIdentity: {
	      widgetInstanceId: 'widget-1',
	      conversationId: 'same-segment-conversation',
	      answerSegmentId: 'same-segment-assistant',
	      networkAttemptId: 'opaque-request-after-reset',
	    },
	    networkAttemptOrdinal: 701,
	  }), true, 'a valid new retry on the same segment must not be blocked by bounded stale guards');
	});

	test('Compare accepts valid same-segment attempts after disconnect while rejecting the old attempt', async () => {
	  const h = createHarness();
	  const attemptA = {
	    widgetInstanceId: 'widget-1',
	    conversationId: 'disconnect-retry-conversation',
	    answerSegmentId: 'disconnect-retry-assistant',
	    networkAttemptId: 'opaque-before-disconnect',
	  };
	  const attemptB = {
	    ...attemptA,
	    networkAttemptId: 'opaque-after-disconnect',
	  };
	  const baseTurn = {
	    body: JSON.stringify({ question: 'disconnect retry comparison' }),
	    turnKey: 'disconnect-retry-conversation:user-1',
	    messageId: 'user-1',
	    question: 'disconnect retry comparison',
	  };

	  assert.equal(h.api().acceptPreparedTurn({ ...baseTurn, answerIdentity: attemptA, networkAttemptOrdinal: 1 }), true);
	  h.api().reset('disconnected', 'widget-1');
	  await h.settle();

	  assert.equal(h.api().acceptPreparedTurn({ ...baseTurn, answerIdentity: attemptA, networkAttemptOrdinal: 1 }), false);
  assert.equal(h.api().acceptPreparedTurn({
    ...baseTurn,
    turnKey: '1:disconnect-retry-conversation:user-1',
    conversationGeneration: 1,
    answerIdentity: attemptB,
    networkAttemptOrdinal: 2,
  }), true);
	});

test('Compare stale guards do not falsely reject fresh identities after heavy sibling retirement', async () => {
  const h = createHarness({ extraWidgetInstanceIds: ['widget-b'] });
  for (let i = 0; i < 2000; i += 1) {
	    const widgetId = 'widget-b';
	    h.api().acceptPreparedTurn({
	      body: JSON.stringify({ question: `retired sibling ${i}` }),
	      turnKey: `sibling-retirement:user-${i}`,
	      messageId: `sibling-user-${i}`,
	      question: `retired sibling ${i}`,
	      answerIdentity: {
	        widgetInstanceId: widgetId,
	        conversationId: 'sibling-retirement',
	        answerSegmentId: `sibling-segment-${i}`,
	        networkAttemptId: `sibling-attempt-${i + 1}`,
	      },
	      networkAttemptOrdinal: i + 1,
	    });
	    if (i % 50 === 0) h.api().reset('disconnected', widgetId);
	  }

	  for (let i = 0; i < 200; i += 1) {
	    assert.equal(h.api().acceptPreparedTurn({
	      body: JSON.stringify({ question: `fresh widget a ${i}` }),
	      turnKey: `fresh-widget-a:user-${i}`,
	      messageId: `fresh-a-user-${i}`,
	      question: `fresh widget a ${i}`,
	      answerIdentity: {
	        widgetInstanceId: 'widget-1',
	        conversationId: 'fresh-widget-a',
	        answerSegmentId: `fresh-a-segment-${i}`,
	        networkAttemptId: `fresh-a-attempt-${2001 + i}`,
	      },
	      networkAttemptOrdinal: 2001 + i,
    }), true, `fresh widget A identity ${i} should not be polluted by widget B retirement`);
  }
});

test('Compare fails closed for metadata-less opaque canonical events after outer eviction', async () => {
  const h = createHarness();
  const firstIdentity = {
    widgetInstanceId: 'temp-widget-0',
    conversationId: 'metadata-less-conversation',
    answerSegmentId: 'metadata-less-segment',
    networkAttemptId: 'opaque-request-0',
  };

  for (let i = 0; i < 1005; i += 1) {
    const widgetId = `temp-widget-${i}`;
    h.addExtraHost(widgetId);
    h.api().acceptPreparedTurn({
      body: JSON.stringify({ question: `temp ${i}` }),
      turnKey: `temp-conversation:user-${i}`,
      messageId: `temp-user-${i}`,
      question: `temp ${i}`,
      answerIdentity: i === 0 ? firstIdentity : {
        widgetInstanceId: widgetId,
        conversationId: 'metadata-less-conversation',
        answerSegmentId: `metadata-less-segment-${i}`,
        networkAttemptId: `opaque-request-${i}`,
      },
      networkAttemptOrdinal: i + 1,
    });
    h.removeExtraHost(widgetId);
    h.api().reset('disconnected', widgetId);
  }

  h.addExtraHost('temp-widget-0');
  assert.equal(h.api().acceptRawPreparedTurn({
    body: JSON.stringify({ question: 'metadata-less stale event' }),
    turnKey: 'metadata-less-conversation:user-0',
    messageId: 'temp-user-0',
    question: 'metadata-less stale event',
    answerIdentity: firstIdentity,
  }), false, 'canonical stale protection must not depend on evicted exact tombstones');
});

test('Compare rejects forged ordinal poisoning and then accepts the legitimate retry', async () => {
  const h = createHarness();
  const baseTurn = {
    body: JSON.stringify({ question: 'ordinal poisoning comparison' }),
    turnKey: 'ordinal-poison-conversation:user-1',
    messageId: 'ordinal-user-1',
    question: 'ordinal poisoning comparison',
  };

  for (let i = 0; i < 700; i += 1) {
    h.api().acceptPreparedTurn({
      ...baseTurn,
      answerIdentity: {
        widgetInstanceId: 'widget-1',
        conversationId: 'ordinal-poison-conversation',
        answerSegmentId: 'ordinal-poison-segment',
        networkAttemptId: `opaque-attempt-${i + 1}`,
      },
      networkAttemptOrdinal: i + 1,
    });
  }
  h.api().reset('scoped-reset-test', 'widget-1');
  await h.settle();

  const forged = h.api().acceptUntrustedPreparedTurn({
    ...baseTurn,
    turnKey: '1:ordinal-poison-conversation:user-1',
    conversationGeneration: 1,
    answerIdentity: {
      widgetInstanceId: 'widget-1',
      conversationId: 'ordinal-poison-conversation',
      answerSegmentId: 'ordinal-poison-segment',
      networkAttemptId: 'opaque-attempt-1',
    },
    networkAttemptOrdinal: 1_000_000,
  });
  assert.equal(forged, false, 'caller-supplied ordinal must not be trusted without handoff validation');

  const legitimate = h.api().acceptPreparedTurn({
    ...baseTurn,
    turnKey: '1:ordinal-poison-conversation:user-1',
    conversationGeneration: 1,
    answerIdentity: {
      widgetInstanceId: 'widget-1',
      conversationId: 'ordinal-poison-conversation',
      answerSegmentId: 'ordinal-poison-segment',
      networkAttemptId: 'opaque-attempt-701',
    },
    networkAttemptOrdinal: 701,
  });
  assert.equal(legitimate, true, 'forged ordinal rejection must not poison the legitimate next attempt');
});

test('Compare validates canonical events with the subscribed handoff bridge, not a replaced global', async () => {
  const h = createHarness();
  const trustedTurn = {
    body: JSON.stringify({ question: 'stable validator comparison' }),
    turnKey: 'stable-validator-conversation:user-1',
    messageId: 'stable-validator-user-1',
    question: 'stable validator comparison',
    answerIdentity: {
      widgetInstanceId: 'widget-1',
      conversationId: 'stable-validator-conversation',
      answerSegmentId: 'stable-validator-segment',
      networkAttemptId: 'attempt-1',
    },
    conversationGeneration: 0,
    networkAttemptOrdinal: 1,
  };

  h.context.window.algoliaHandoffToOrchestrator = {
    validateTurnEvent() {
      return false;
    },
  };
  assert.equal(
    h.api().acceptPreparedTurn(trustedTurn),
    true,
    'a later deny-all global replacement must not break the subscribed validator',
  );

  h.context.window.algoliaHandoffToOrchestrator = {
    validateTurnEvent() {
      return true;
    },
  };
  assert.equal(
    h.api().acceptUntrustedPreparedTurn({
      ...trustedTurn,
      answerIdentity: {
        ...trustedTurn.answerIdentity,
        networkAttemptId: 'attempt-untrusted',
      },
      networkAttemptOrdinal: 2,
    }),
    false,
    'a later allow-all global replacement must not bypass the subscribed validator',
  );
});

test('Compare rejects delayed canonical and identity-less completions after reset', async () => {
  const h = createHarness();
  const baseTurn = {
    body: JSON.stringify({ question: 'delayed completion comparison' }),
    turnKey: 'completion-race-conversation:user-1',
    messageId: 'completion-user-1',
    question: 'delayed completion comparison',
  };
  const attemptA = {
    widgetInstanceId: 'widget-1',
    conversationId: 'completion-race-conversation',
    answerSegmentId: 'completion-race-segment',
    networkAttemptId: 'opaque-before-reset',
  };
  const attemptB = {
    ...attemptA,
    networkAttemptId: 'opaque-after-reset',
  };

  assert.equal(h.api().acceptPreparedTurn({ ...baseTurn, answerIdentity: attemptA, networkAttemptOrdinal: 1 }), true);
  h.api().reset('scoped-reset-test', 'widget-1');
  await h.settle();
  assert.equal(h.api().acceptPreparedTurn({
    ...baseTurn,
    turnKey: '1:completion-race-conversation:user-1',
    conversationGeneration: 1,
    answerIdentity: attemptB,
    networkAttemptOrdinal: 2,
  }), true);

  assert.equal(h.api().acceptCompletedTurn({
    ...baseTurn,
    answerIdentity: attemptA,
    conversationGeneration: 0,
    networkAttemptOrdinal: 1,
  }), false, 'stale canonical completion must not mark the new attempt complete');
  assert.equal(h.api().acceptCompletedTurn({
    ...baseTurn,
    conversationGeneration: 0,
    networkAttemptOrdinal: 1,
  }), false, 'stale identity-less completion must not map onto the new attempt');
  assert.equal(h.api().state().completedTurns, 0);

  assert.equal(h.api().acceptCompletedTurn({
    ...baseTurn,
    turnKey: '1:completion-race-conversation:user-1',
    conversationGeneration: 1,
    answerIdentity: attemptB,
    networkAttemptOrdinal: 2,
  }), true, 'the matching fresh completion is still accepted');
  assert.equal(h.api().state().completedTurns, 1);
});

test('Compare flushes TextDecoder and consumes a final valid SSE frame without a trailing newline', async () => {
  const h = createHarness();
  const payload = `data: ${JSON.stringify({ type: 'text-delta', delta: 'final frame retained' })}`;
  h.setFetch(async () => ({
    ok: true,
    status: 200,
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(payload));
        controller.close();
      },
    }),
  }));
  const updates = [];
  const result = await h.api().askProdForTest(
    JSON.stringify({ messages: [] }),
    new AbortController().signal,
    (text) => updates.push(text),
  );
  assert.equal(result.text, 'final frame retained');
  assert.deepEqual(updates, ['final frame retained']);
});
