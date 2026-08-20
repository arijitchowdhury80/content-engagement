import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';

const comparePath = new URL('../algolia-chat-compare.js', import.meta.url);
const deployScript = new URL('../../../tools/deployment/deploy_jahia_engagement_tracker.py', import.meta.url);

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
  appendChild(c) { c.parentElement = this; this.children.push(c); return c; }
  append(...cs) { cs.forEach((c) => this.appendChild(c)); }
  replaceChildren(...cs) { this.children = []; cs.forEach((c) => this.appendChild(c)); }
  insertBefore(node, ref) {
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
  get textContent() { return this.children.length ? this.children.map((c) => c.textContent).join('') : this._text; }
  set innerHTML(v) { this._html = String(v); }
  get innerHTML() { return this._html; }
  matches(sel) {
    const part = /^\[part="([^"]+)"\]$/.exec(sel);
    if (part) return this.getAttribute('part') === part[1];
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

function createHarness({ proxyPath = '/__compare/production', chatWidth = 1000, viewportWidth = 1200 } = {}) {
  const frames = [];                // queued rAF callbacks
  const observers = [];             // MutationObserver callbacks
  const fetchCalls = [];
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
      createElement: (tag) => new El(tag),
      addEventListener: (t, fn) => { (documentListeners[t] ||= []).push(fn); },
    },
    fetch: (...args) => { fetchCalls.push(args); return fetchImpl(...args); },
  };
  context.window = context;
  context.window.ACS_COMPARE = { prod: { proxyPath }, exposeForTests: true };
  context.window.innerWidth = viewportWidth;
  context.window.addEventListener = () => {};

  vm.createContext(context);
  vm.runInContext(fs.readFileSync(comparePath, 'utf8'), context);

  const flush = () => { while (frames.length) frames.shift()(); };
  const addBubble = (text) => {
    const b = new El('div');
    b.setAttribute('part', 'message-user-bubble');
    b.textContent = text;
    chatContent.appendChild(b);
    observers.forEach((cb) => cb([{ type: 'childList' }]));
    return b;
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
    context, flush, addBubble, toggle, clickToggle, setExpanded, shadowRoot, chatContent, documentListeners,
    fetchCalls,
    setFetch: (fn) => { fetchImpl = fn; },
    api: () => context.window.__acsCompare,
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

test('toggle mounts in the header, expanded, and starts off', () => {
  const h = createHarness();
  const t = h.toggle();
  assert.ok(t, 'toggle should mount when the panel is expanded');
  assert.equal(t.getAttribute('aria-pressed'), 'false');
  assert.equal(t.parentElement.getAttribute('part'), 'header', 'must be a direct header child');
});

test('compare off: asking a question never calls production', async () => {
  const h = createHarness();
  h.addBubble('What is NeuralSearch?');
  await h.settle();
  assert.equal(h.fetchCalls.length, 0);
});

test('enabling compare does not replay existing user bubbles', async () => {
  const h = createHarness();
  h.addBubble('asked before compare was on');
  await h.settle();
  h.clickToggle();
  await h.settle();
  assert.equal(h.toggle().getAttribute('aria-pressed'), 'true');
  assert.equal(h.fetchCalls.length, 0, 'history must not be replayed');
});

test('two turns run in order and turn two carries turn one in history', async () => {
  const h = createHarness();
  h.clickToggle();
  h.setFetch(async (_url, init) => ({
    ok: true, status: 200,
    body: sse([{ type: 'text-delta', delta: `answer for ${JSON.parse(init.body).messages.at(-1).parts[0].text}` }]),
  }));
  h.addBubble('first question');
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

test('compare is fixed for the conversation once a question is asked', async () => {
  const h = createHarness();
  h.clickToggle();
  h.addBubble('locks the choice');
  await h.settle();
  assert.equal(h.toggle().getAttribute('aria-disabled'), 'true');
  h.clickToggle();                                   // ignored while locked
  await h.settle();
  assert.equal(h.toggle().getAttribute('aria-pressed'), 'true');
});

test('visitor reset clears production history and unlocks the toggle', async () => {
  const h = createHarness();
  h.clickToggle();
  h.addBubble('q1');
  await h.settle();
  const before = h.api().state();
  assert.ok(before.historyLength > 0);

  (h.documentListeners['algolia-visitor-state-reset'] || []).forEach((fn) => fn({ detail: { source: 'test' } }));
  await h.settle();

  const after = h.api().state();
  assert.equal(after.historyLength, 0, 'history cleared');
  assert.equal(after.locked, false, 'choice is selectable again');
  assert.notEqual(after.convId, before.convId, 'a new conversation id is minted');
  assert.ok(after.generation > before.generation, 'generation advanced');
});

test('a late response from a previous conversation is discarded', async () => {
  const h = createHarness();
  h.clickToggle();
  let release;
  h.setFetch(() => new Promise((resolve) => {
    release = () => resolve({ ok: true, status: 200, body: sse([{ type: 'text-delta', delta: 'stale answer' }]) });
  }));
  h.addBubble('q1');
  await h.settle();

  (h.documentListeners['algolia-visitor-state-reset'] || []).forEach((fn) => fn({ detail: {} }));
  await h.settle();
  release();                                          // resolves after the reset
  await h.settle();

  assert.equal(h.api().state().historyLength, 0, 'stale answer must not enter history');
});

test('a production failure is contained and never throws', async () => {
  const h = createHarness();
  h.clickToggle();
  h.setFetch(async () => ({ ok: false, status: 503, text: async () => 'upstream down', body: null }));
  h.addBubble('q1');
  await assert.doesNotReject(h.settle());
  assert.equal(h.api().state().historyLength, 0, 'failed turn adds nothing to history');
});

test('window.fetch is never patched (proactive handoff owns the transport)', () => {
  const h = createHarness();
  const before = h.context.fetch;
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
  wide.clickToggle(); wide.flush();
  const narrow = createHarness({ chatWidth: 500, viewportWidth: 600 });
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
  h.clickToggle();                                    // enabled BEFORE the first question
  h.setFetch(async (_url, init) => ({
    ok: true, status: 200,
    body: sse([{ type: 'text-delta', delta: `answer:${JSON.parse(init.body).messages.at(-1).parts[0].text}` }]),
  }));

  h.addBubble('question one');
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

/* --------------------------------------------------- Jahia deployment wiring */

function transformBlock(html) {
  const program = [
    'import importlib.util, pathlib, sys',
    'path = pathlib.Path(sys.argv[1])',
    "spec = importlib.util.spec_from_file_location('deploy', path)",
    'module = importlib.util.module_from_spec(spec)',
    'spec.loader.exec_module(module)',
    'print(module.update_block_html(sys.stdin.read()), end="")',
  ].join('; ');
  return execFileSync('python3', ['-c', program, deployScript.pathname], { input: html, encoding: 'utf8' });
}

const BLOCK_FIXTURE = [
  '<div data-release="test">',
  '  <algolia-chat theme="algolia"><algolia-agent role="primary"></algolia-agent></algolia-chat>',
  '  <script src="https://tmp-content-eng-algolia.cloud.jahia.com/files/live/sites/www/files/algolia-chat-engage.js?engage=x"></script>',
  '</div>',
].join('\n');

test('Jahia transform adds the Compare script and its config exactly once', () => {
  const once = transformBlock(BLOCK_FIXTURE);
  const twice = transformBlock(once);
  assert.match(once, /algolia-chat-compare\.js\?compare=/);
  assert.match(once, /window\.ACS_COMPARE=/);
  assert.equal((twice.match(/algolia-chat-compare\.js/g) || []).length, 1, 'idempotent');
  assert.equal((twice.match(/window\.ACS_COMPARE=/g) || []).length, 1, 'idempotent');
});

test('Compare config is emitted before the Compare module', () => {
  const html = transformBlock(BLOCK_FIXTURE);
  assert.ok(html.indexOf('window.ACS_COMPARE=') < html.indexOf('algolia-chat-compare.js'));
});

test('deployment script snapshots, uploads, publishes, validates and can roll back Compare', () => {
  const source = fs.readFileSync(deployScript, 'utf8');
  assert.match(source, /"compareNode": node\(COMPARE, "EDIT"\)/);
  assert.match(source, /"compareNode": node\(COMPARE, "LIVE"\)/);
  assert.match(source, /"upsertCompare": upsert_file\(COMPARE, compare_content\)/);
  assert.match(source, /"publishCompare": publish\(COMPARE\)/);
  assert.match(source, /"liveCompareMatchesSource"/);
  assert.match(source, /"compareSha256": sha256\(compare_content\)/);
  assert.match(source, /"restoreOrRemoveCompareFrom"/);
  // the production key must never be a literal in the repo
  assert.equal(source.includes('20ab8adc'), false, 'production key must come from env, not source');
});

test('the chat stack manifest requires the Compare marker live', () => {
  const manifest = JSON.parse(
    fs.readFileSync(new URL('../../../config/deployments/algolia-chat-stack.json', import.meta.url), 'utf8'),
  );
  assert.ok(manifest.jahia.requiredLiveMarkers.includes('algolia-chat-compare.js'));
  assert.equal(manifest.jahia.compareWithProduction.productionAgent.searchKeyEnv, 'PROD_ASKAI_SEARCH_KEY');
});

test('--logo-reset-only leaves every Compare reference untouched', () => {
  const program = [
    'import importlib.util, pathlib, sys',
    'path = pathlib.Path(sys.argv[1])',
    "spec = importlib.util.spec_from_file_location('deploy', path)",
    'module = importlib.util.module_from_spec(spec)',
    'spec.loader.exec_module(module)',
    'html = sys.stdin.read()',
    'narrow = module.update_block_html_logo_reset_only(html)',
    'full = module.update_block_html(html)',
    'print("LOGO_RESET", "reset-visitor-state-on-logo" in narrow)',
    'print("NO_COMPARE_CFG", "ACS_COMPARE" not in narrow)',
    'print("NO_COMPARE_SRC", "algolia-chat-compare.js" not in narrow)',
    'print("FULL_HAS_COMPARE", "ACS_COMPARE" in full and "algolia-chat-compare.js" in full)',
    'print("PRESERVES_EXISTING", full.count("algolia-chat-compare.js") == module.update_block_html_logo_reset_only(full).count("algolia-chat-compare.js"))',
    'print("IDEMPOTENT", module.update_block_html_logo_reset_only(narrow) == narrow)',
  ].join('; ');
  const out = execFileSync('python3', ['-c', program, deployScript.pathname], {
    input: BLOCK_FIXTURE, encoding: 'utf8',
  });
  for (const key of ['LOGO_RESET', 'NO_COMPARE_CFG', 'NO_COMPARE_SRC', 'FULL_HAS_COMPARE', 'PRESERVES_EXISTING', 'IDEMPOTENT']) {
    assert.match(out, new RegExp(`${key} True`), `${key} should hold`);
  }
});

test('apply mode refuses to deploy when the production key is missing', () => {
  const source = fs.readFileSync(deployScript, 'utf8');
  const guard = source.indexOf('if not compare_prod_search_key():');
  assert.notEqual(guard, -1, 'a pre-mutation guard must exist');
  const firstMutation = source.indexOf('"upsertChat": upsert_file(CHAT, chat_content)', guard);
  assert.notEqual(firstMutation, -1);
  assert.ok(guard < firstMutation, 'the guard must run before any mutation');
  assert.match(source, /Refusing to deploy/);
  assert.match(source, /SystemExit\(/, 'must abort, not warn');
  // the key itself must never be echoed into logs or evidence
  assert.equal(/print\([^)]*compare_prod_search_key\(\)/.test(source), false, 'key must not be printed');
  assert.match(source, /"compareProductionKeyResolved": bool\(compare_prod_search_key\(\)\)/);
});

test('the parity site loads Compare and routes production through the parity server', () => {
  const html = fs.readFileSync(new URL('../../../local-sites/algolia-com-parity/index.html', import.meta.url), 'utf8');
  assert.match(html, /\/chat\/algolia-chat-compare\.js/);
  assert.match(html, /proxyPath: "\/__compare\/production"/);
  assert.equal(html.includes('proxyPath: "/agent-studio'), false, 'must not collide with the local agent mock');
});
