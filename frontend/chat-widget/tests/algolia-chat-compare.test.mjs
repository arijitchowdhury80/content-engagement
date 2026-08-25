import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';

const comparePath = new URL('../algolia-chat-compare.js', import.meta.url);
const deployScript = new URL('../../../tools/deployment/deploy_compare_integration_jahia.py', import.meta.url);
const generalDeployScript = new URL('../../../tools/deployment/deploy_jahia_engagement_tracker.py', import.meta.url);
const parityServer = new URL('../../../tools/local_chat_parity_server.py', import.meta.url);

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
  const preparedBodies = [];
  const primaryMessages = [];
  let preparedListener = null;
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
    algoliaContextCompiler: {
      fetchPrepared: (...args) => { fetchCalls.push(args); return fetchImpl(...args); },
    },
    algoliaHandoffToOrchestrator: {
      subscribePreparedTurn(listener) {
        preparedListener = listener;
        return () => { if (preparedListener === listener) preparedListener = null; };
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
  const addBubble = (text) => {
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
    preparedListener?.({ body, turnKey: `primary-conversation:${user.id}`, question: text });
    primaryMessages.push({
      id: `primary-assistant-${turnSequence}`,
      role: 'assistant',
      parts: [{ type: 'text', text: `primary answer ${turnSequence}` }],
    });
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
    fetchCalls, preparedBodies,
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

test('normal centered panel remains eligible on a wide viewport', () => {
  const h = createHarness({ chatWidth: 1080, viewportWidth: 2266 });
  assert.ok(h.toggle(), '1080px normal panel must not be mistaken for the docked panel');
  h.setExpanded(false);
  h.flush();
  assert.equal(h.toggle(), null, 'the narrower docked panel must still hide Compare');
});

test('compare off: asking a question never calls production', async () => {
  const h = createHarness();
  h.addBubble('What is NeuralSearch?');
  await h.settle();
  assert.equal(h.fetchCalls.length, 0);
});

test('a conversation already in progress never replays, and cannot enable Compare', async () => {
  const h = createHarness();
  h.addBubble('asked before compare was on');
  await h.settle();

  // The first question locks the choice, so Compare can no longer be switched on.
  assert.equal(h.api().state().locked, true);
  h.clickToggle();
  await h.settle();
  assert.equal(h.api().state().compareOn, false, 'cannot enable mid-conversation');
  assert.equal(h.fetchCalls.length, 0, 'existing history is never replayed');

  // After a reset the earlier bubble must still not be resent.
  (h.documentListeners['algolia-visitor-state-reset'] || []).forEach((fn) => fn({ detail: {} }));
  await h.settle();
  h.clickToggle();                                     // now selectable again
  await h.settle();
  assert.equal(h.api().state().compareOn, true);
  assert.equal(h.fetchCalls.length, 0, 'bubbles seen before the reset are not replayed');
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

test('question one locks the choice even when Compare was left OFF', async () => {
  const h = createHarness();
  assert.equal(h.toggle().getAttribute('aria-pressed'), 'false', 'starts off');

  h.addBubble('question one, asked with Compare off');
  await h.settle();

  // the first bubble must freeze the choice in whichever state it was left
  assert.equal(h.toggle().getAttribute('aria-disabled'), 'true', 'toggle is disabled after turn one');
  assert.match(h.toggle().textContent, /new (chat|conversation)/i, 'locked-off state explains recovery');
  assert.match(h.toggle().getAttribute('aria-label') || '', /new (chat|conversation)/i);
  assert.equal(h.api().state().locked, true);

  h.clickToggle();                                     // must be inert while locked
  await h.settle();
  assert.equal(h.api().state().compareOn, false, 'cannot be enabled mid-conversation');
  assert.equal(h.toggle().getAttribute('aria-pressed'), 'false');
  assert.equal(h.fetchCalls.length, 0, 'no production request is ever made');

  // a reset must make it selectable again
  (h.documentListeners['algolia-visitor-state-reset'] || []).forEach((fn) => fn({ detail: {} }));
  await h.settle();
  assert.equal(h.api().state().locked, false, 'reset unlocks the choice');
  assert.notEqual(h.toggle().getAttribute('aria-disabled'), 'true', 'toggle is selectable again');

  h.clickToggle();                                     // now it may be enabled
  await h.settle();
  assert.equal(h.api().state().compareOn, true);
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

test('visitor reset clears mirrored state, turns Compare off, and unlocks the toggle', async () => {
  const h = createHarness();
  h.clickToggle();
  h.addBubble('q1');
  await h.settle();
  const before = h.api().state();
  assert.ok(before.mirroredTurns > 0);

  (h.documentListeners['algolia-visitor-state-reset'] || []).forEach((fn) => fn({ detail: { source: 'test' } }));
  await h.settle();

  const after = h.api().state();
  assert.equal(after.mirroredTurns, 0, 'mirrored turn state cleared');
  assert.equal(after.locked, false, 'choice is selectable again');
  assert.equal(after.compareOn, false, 'a new conversation defaults Compare to off');
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

  assert.equal(h.api().state().mirroredTurns, 0, 'stale answer must not enter the new generation');
});

test('a production failure is contained and never throws', async () => {
  const h = createHarness();
  h.clickToggle();
  h.setFetch(async () => ({ ok: false, status: 503, text: async () => 'upstream down', body: null }));
  h.addBubble('q1');
  await assert.doesNotReject(h.settle());
  assert.equal(h.api().state().mirroredTurns, 0, 'failed turn is not counted as completed');
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

test('production receives the exact prepared primary body bytes and retries are deduplicated', async () => {
  const h = createHarness();
  h.clickToggle();
  h.addBubble('same packet please');
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

/* --------------------------------------------------- Jahia deployment wiring */

function transformBlock(html) {
  const program = [
    'import importlib.util, pathlib, sys',
    'path = pathlib.Path(sys.argv[1])',
    'sys.path.insert(0, str(path.parent))',
    "spec = importlib.util.spec_from_file_location('deploy', path)",
    'module = importlib.util.module_from_spec(spec)',
    'spec.loader.exec_module(module)',
    'assets = module.immutable_assets()',
    'config = {"PROD_ASKAI_SEARCH_KEY":"sentinel"}',
    'print(module.update_block_html(sys.stdin.read(), assets, config), end="")',
  ].join('; ');
  return execFileSync('python3', ['-c', program, deployScript.pathname], { input: html, encoding: 'utf8' });
}

const BLOCK_FIXTURE = [
  '<div class="algolia-chat-embed" data-release="test">',
  '  <algolia-chat theme="algolia"><algolia-agent role="primary"></algolia-agent></algolia-chat>',
  '  <script src="https://tmp-content-eng-algolia.cloud.jahia.com/files/live/sites/www/files/algolia-engagement-tracker.js?tracker=x"></script>',
  '  <script src="https://tmp-content-eng-algolia.cloud.jahia.com/files/live/sites/www/files/algolia-context-compiler.js?context=x"></script>',
  '  <script src="https://tmp-content-eng-algolia.cloud.jahia.com/files/live/sites/www/files/algolia-proactive-controller.js?proactive=x"></script>',
  '  <script src="https://tmp-content-eng-algolia.cloud.jahia.com/files/live/sites/www/files/handoff-to-orchestrator.js?handoff=x"></script>',
  '  <script src="https://tmp-content-eng-algolia.cloud.jahia.com/files/live/sites/www/files/algolia-chat-engage.js?engage=x"></script>',
  '</div>',
].join('\n');

test('Jahia transform adds the Compare script and its config exactly once', () => {
  const once = transformBlock(BLOCK_FIXTURE);
  const twice = transformBlock(once);
  assert.match(once, /algolia-chat-compare-[a-f0-9]{12}\.js/);
  assert.match(once, /window\.ACS_COMPARE=/);
  assert.equal((twice.match(/algolia-chat-compare-[a-f0-9]{12}\.js/g) || []).length, 1, 'idempotent');
  assert.equal((twice.match(/window\.ACS_COMPARE=/g) || []).length, 1, 'idempotent');
  assert.equal((twice.match(/token-telemetry-[a-f0-9]{12}\.js/g) || []).length, 1, 'one telemetry observer');
});

test('Compare config is emitted before the Compare module', () => {
  const html = transformBlock(BLOCK_FIXTURE);
  assert.ok(html.indexOf('window.ACS_COMPARE=') < html.search(/algolia-chat-compare-[a-f0-9]{12}\.js/));
  assert.ok(
    html.search(/algolia-chat-compare-[a-f0-9]{12}\.js/) < html.search(/token-telemetry-[a-f0-9]{12}\.js/),
    'telemetry observes the transport after Compare is configured',
  );
});

test('narrow deployment script plans immutable integration assets, validates and can roll back', () => {
  const source = fs.readFileSync(deployScript, 'utf8');
  assert.match(source, /CompareIntegrationApplyPlan\.v1/);
  assert.match(source, /create_immutable/);
  assert.match(source, /validate_live/);
  assert.match(source, /rollback = restore\(plan_path\)/);
  assert.match(source, /--apply-plan/);
  assert.equal(source.includes('publish("/sites/www/files"'), false, 'must not publish the files subtree');
  assert.equal(source.includes('20ab8adc'), false, 'production key must come from env, not source');
});

test('the chat stack manifest requires the Compare marker live', () => {
  const manifest = JSON.parse(
    fs.readFileSync(new URL('../../../config/deployments/algolia-chat-stack.json', import.meta.url), 'utf8'),
  );
  assert.ok(manifest.jahia.requiredLiveMarkers.includes('algolia-chat-compare-'));
  assert.ok(manifest.jahia.requiredLiveMarkers.includes('algolia-context-compiler'));
  assert.ok(manifest.jahia.requiredLiveMarkers.includes('handoff-to-orchestrator'));
  assert.ok(manifest.jahia.requiredLiveMarkers.includes('token-telemetry-'));
  assert.equal(manifest.jahia.requiredLiveMarkers.includes('algolia-context-compiler.js'), false);
  assert.equal(manifest.jahia.requiredLiveMarkers.includes('handoff-to-orchestrator.js'), false);
  assert.equal(manifest.jahia.compareWithProduction.productionAgent.searchKeyEnv, 'PROD_ASKAI_SEARCH_KEY');
  assert.equal(manifest.jahia.compareWithProduction.deploymentTool, 'tools/deployment/deploy_compare_integration_jahia.py');
  assert.equal(manifest.jahia.tokenTelemetry.script, 'frontend/chat-widget/token-telemetry.js');
});

test('the general deployer remains free of Compare cutover behavior', () => {
  const general = fs.readFileSync(generalDeployScript, 'utf8');
  assert.equal(general.includes('COMPARE_PROD_SEARCH_KEY_ENV'), false);
  assert.equal(general.includes('upsertCompare'), false);
  assert.equal(general.includes('algolia-chat-compare.js'), false);
});

test('normal and journey deployments remain compatible with an integrated Compare block', () => {
  const input = transformBlock(BLOCK_FIXTURE);
  const program = [
    'import importlib.util, pathlib, sys',
    'path = pathlib.Path(sys.argv[1])',
    'sys.path.insert(0, str(path.parent))',
    "spec = importlib.util.spec_from_file_location('deploy', path)",
    'module = importlib.util.module_from_spec(spec)',
    'spec.loader.exec_module(module)',
    'print(module.update_block_html(sys.stdin.read()), end="")',
  ].join('; ');
  const output = execFileSync('python3', ['-c', program, generalDeployScript.pathname], {
    input, encoding: 'utf8',
  });
  assert.match(output, /window\.ACS_COMPARE=/);
  assert.match(output, /algolia-chat-compare-[a-f0-9]{12}\.js/);
  assert.equal((output.match(/algolia-context-compiler[^"\n]*\.js/g) || []).length, 1);
  assert.equal((output.match(/handoff-to-orchestrator[^"\n]*\.js/g) || []).length, 1);

  const journeyProgram = program.replace(
    'module.update_block_html(sys.stdin.read())',
    'module.update_journey_runtime_block_html(sys.stdin.read())'
  );
  const journeyOutput = execFileSync('python3', ['-c', journeyProgram, generalDeployScript.pathname], {
    input, encoding: 'utf8',
  });
  assert.match(journeyOutput, /algolia-context-compiler\.js\?context=/);
  assert.equal(journeyOutput.includes('algolia-context-compiler-compare-'), false);
  assert.equal((journeyOutput.match(/algolia-context-compiler[^"\n]*\.js/g) || []).length, 1);
});

test('apply consumes an approved plan and revalidates config and block drift', () => {
  const source = fs.readFileSync(deployScript, 'utf8');
  assert.match(source, /assert_clean_commit\(plan\["sourceCommit"\]\)/);
  assert.match(source, /Compare configuration changed after plan approval/);
  assert.match(source, /Jahia block drifted after plan approval; no mutation made/);
  assert.match(source, /privatePlanSha256/);
});

test('the local production proxy binds loopback only', () => {
  const program = [
    'import importlib.util, pathlib, sys',
    'path = pathlib.Path(sys.argv[1])',
    "spec = importlib.util.spec_from_file_location('parity', path)",
    'm = importlib.util.module_from_spec(spec)',
    'spec.loader.exec_module(m)',
    'print("HOST", m.HOST)',
    'print("ACCEPT_V4", m.assert_loopback("127.0.0.1") == "127.0.0.1")',
    'print("ACCEPT_V6", m.assert_loopback("::1") == "::1")',
    'ok = True',
    'for bad in ("0.0.0.0", "192.168.1.10", "10.0.0.5", "::"):',
    '    try:',
    '        m.assert_loopback(bad); ok = False',
    '    except SystemExit: pass',
    'print("REJECTS_NON_LOOPBACK", ok)',
  ].join('\n');
  const out = execFileSync('python3', ['-c', program, parityServer.pathname], { encoding: 'utf8' });
  assert.match(out, /HOST 127\.0\.0\.1/);
  assert.match(out, /ACCEPT_V4 True/);
  assert.match(out, /ACCEPT_V6 True/);
  assert.match(out, /REJECTS_NON_LOOPBACK True/, '0.0.0.0 and LAN addresses must be refused');

  // the bind address must not be reachable through the CLI at all
  const source = fs.readFileSync(parityServer, 'utf8');
  assert.equal(source.includes('"--host"'), false, '--host must be removed');
  assert.equal(source.includes('args.host'), false, 'nothing may read a host argument');
  assert.match(source, /assert_loopback\(HOST\)/, 'the bind must be validated');
  assert.match(source, /ThreadingTCPServer/, 'a slow production stream must not block local assets');
  assert.equal(source.includes('_create_unverified_context'), false, 'TLS verification cannot be disabled');
});

test('the local proxy accepts only the exact same-origin browser boundary and a Compare-only env', () => {
  const program = [
    'import importlib.util, pathlib, sys, tempfile, types',
    'path = pathlib.Path(sys.argv[1])',
    "spec = importlib.util.spec_from_file_location('parity', path)",
    'm = importlib.util.module_from_spec(spec)',
    'spec.loader.exec_module(m)',
    'h = object.__new__(m.LocalParityHandler)',
    'h.server = types.SimpleNamespace(server_address=(m.HOST, 5177))',
    'def valid(headers):',
    '    h.headers = headers',
    '    return h._valid_compare_browser_boundary()',
    'good = {"Host":"127.0.0.1:5177","Origin":"http://127.0.0.1:5177","Sec-Fetch-Site":"same-origin"}',
    'print("GOOD", valid(good))',
    'print("BAD_HOST", valid({**good, "Host":"attacker.example"}))',
    'print("BAD_ORIGIN", valid({**good, "Origin":"http://attacker.example"}))',
    'print("MISSING_ORIGIN", valid({k:v for k,v in good.items() if k != "Origin"}))',
    'print("CROSS_SITE", valid({**good, "Sec-Fetch-Site":"cross-site"}))',
    'with tempfile.TemporaryDirectory() as d:',
    '    p = pathlib.Path(d) / ".env.compare.local"',
    '    p.write_text("PROD_ASKAI_APP_ID=attacker.example/steal\\nALGOLIA_ADMIN_API_KEY=secret\\nPROD_ASKAI_SEARCH_KEY=key\\nPROD_ASKAI_AGENT_ID=attacker-agent\\n")',
    '    env = m.load_env(p)',
    '    print("ENV_KEYS", sorted(env))',
    'print("PINNED_HOST", m.urllib.parse.urlsplit(m.completions_url()).hostname)',
  ].join('\n');
  const out = execFileSync('python3', ['-c', program, parityServer.pathname], { encoding: 'utf8' });
  assert.match(out, /GOOD True/);
  assert.match(out, /BAD_HOST False/);
  assert.match(out, /BAD_ORIGIN False/);
  assert.match(out, /MISSING_ORIGIN False/);
  assert.match(out, /CROSS_SITE False/);
  assert.match(out, /ENV_KEYS \['PROD_ASKAI_SEARCH_KEY'\]/);
  assert.match(out, /PINNED_HOST 1qdawl72tq\.algolia\.net/);
  assert.equal(out.includes('ALGOLIA_ADMIN_API_KEY'), false);
});

test('the parity site loads Compare and routes production through the parity server', () => {
  const html = fs.readFileSync(new URL('../../../local-sites/algolia-com-parity/index.html', import.meta.url), 'utf8');
  assert.match(html, /\/chat\/algolia-chat-compare\.js/);
  assert.match(html, /proxyPath: "\/__compare\/production"/);
  assert.equal(html.includes('proxyPath: "/agent-studio'), false, 'must not collide with the local agent mock');
});
