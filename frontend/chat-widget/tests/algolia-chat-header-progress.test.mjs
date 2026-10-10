import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';

const chatPath = new URL('../algolia-chat.js', import.meta.url);
const legacyHeaderProgressVar = ['--a', 'cs-header-progress'].join('');
const legacyWorkingAttr = ['data-a', 'cs-working'].join('');
const legacyHeaderProgressFlow = ['a', 'cs-header-progress-flow'].join('');

function literal(value) {
  return new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
}

let browser;

before(async () => {
  browser = await chromium.launch({ headless: true });
});

after(async () => {
  await browser?.close();
});

test('processing trace drives the header gradient fill from real progress state', () => {
  const bundle = fs.readFileSync(chatPath, 'utf8');
  const progressEmitterStart = bundle.indexOf('function mt(');
  const progressEmitterEnd = bundle.indexOf('function yg(', progressEmitterStart);
  const progressEmitter = bundle.slice(progressEmitterStart, progressEmitterEnd);
  const thinkingStart = bundle.indexOf('function lE(');
  const thinkingEnd = bundle.indexOf('function uE(', thinkingStart);
  const thinkingIndicator = bundle.slice(thinkingStart, thinkingEnd);
  const headerStart = bundle.indexOf('function mR({onReset');
  const headerEnd = bundle.indexOf('const Eg=', headerStart);
  const header = bundle.slice(headerStart, headerEnd);
  const headerProgressSetter = bundle.match(
    /function ([A-Za-z_$][\w$]*)\(e,n,[^)]+\)\{const [A-Za-z_$][\w$]*=Math\.max\(0,Math\.min\(100,n\)\)[\s\S]{0,240}e\.style\.setProperty\("--algolia-header-progress"/
  );

  assert.match(bundle, /algolia-chat-processing-progress/);
  assert.match(bundle, /--algolia-header-progress/);
  assert.match(bundle, /data-algolia-working/);
  assert.match(bundle, /data-algolia-progress-resetting/);
  assert.match(bundle, /aria-valuenow/);
  assert.ok(headerProgressSetter, 'bundle must include a helper that writes the header progress CSS variable');
  assert.match(
    bundle,
    /textLength/,
    'streaming progress must be based on observed answer text growth, not only a coarse status jump'
  );
  assert.doesNotMatch(
    bundle,
    /function A1\(e\)\{return e\.hasText\|\|e\.status==="streaming"\|\|e\.status==="success"\?5:e\.searchCount>0\?2:1\}/,
    'progress calculation must not collapse the answer journey to loading, sources-found, and final'
  );
  assert.match(
    bundle,
    /status==="success"\|\|[A-Za-z_$][\w$]*\.stage==="followup"\?5/,
    'only final success/follow-up completion should map to the final progress stage'
  );
  assert.match(
    bundle,
    /status==="streaming"[\s\S]{0,120}Math\.min\(98,Math\.round\(84\+/,
    'streaming should continue moving the header from real streamed text length before final completion'
  );
  assert.match(
    progressEmitter,
    /matches\?\.\("algolia-chat"\)[\s\S]{0,120}querySelectorAll\?\.\("algolia-chat"\)/,
    'streaming progress must synchronize the owning live chat host before falling back to document-wide compatibility'
  );
  assert.match(
    progressEmitter,
    /widgetInstanceId:[A-Za-z_$][\w$]*\?\.__algoliaWidgetInstanceId/,
    'progress events must carry the owning widget identity so sibling headers can ignore them'
  );
  assert.ok(
    progressEmitter.includes(`${headerProgressSetter[1]}(`),
    'progress emitter must write the header progress CSS variable on the live host'
  );
  assert.match(
    progressEmitter,
    /getPropertyValue\("--algolia-header-progress"\)/,
    'direct host sync must read existing header progress before writing'
  );
  assert.match(
    progressEmitter,
    /Math\.max\([^)]*,[A-Za-z_$][\w$]*\)/,
    'direct host sync must not lower the header within the current run'
  );
  assert.match(
    progressEmitter,
    /progress:[A-Za-z_$][\w$]*/,
    'the emitted event and the host sync must share the same computed progress value'
  );
  assert.match(
    thinkingIndicator,
    /useEffect\(\(\)=>\{[A-Za-z_$][\w$]*\(\{status:[A-Za-z_$][\w$]*,searchCount:[A-Za-z_$][\w$]*\?\?0,hasText:!![A-Za-z_$][\w$]*\.trim\(\),textLength:[A-Za-z_$][\w$]*\.length\},void 0,[A-Za-z_$][\w$]*,[A-Za-z_$][\w$]*\)\},\[[A-Za-z_$][\w$]*,[A-Za-z_$][\w$]*,[A-Za-z_$][\w$]*,[A-Za-z_$][\w$]*,[A-Za-z_$][\w$]*\]\)/,
    'rendered streaming/thinking state must synchronize progress with the owning widget and attempt context'
  );
  assert.match(
    header,
    /useRef\(0\)/,
    'header progress must remember the highest progress within the current run'
  );
  assert.match(
    header,
    /Math\.max\([^)]*\.current,[A-Za-z_$][\w$]*\)/,
    'header progress must be monotonic so late loading events cannot lower a streaming answer'
  );
  assert.match(
    header,
    /getPropertyValue\("--algolia-header-progress"\)/,
    'header remounts must seed progress from the host CSS variable before accepting later events'
  );
  assert.match(
    progressEmitter,
    /function __arrieResetHeaderProgress\([^)]*\)[\s\S]{0,180}[A-Za-z_$][\w$]*\([A-Za-z_$][\w$]*,0,!0\)/,
    'new run resets must be explicit, not inferred from arbitrary late loading events'
  );
  assert.match(
    bundle,
    /async function aR\([^)]*\)\{[\s\S]{0,220}__arrieResetHeaderProgress\([^)]*hostElement[^)]*\),[A-Za-z_$][\w$]*\(\{status:"loading"[\s\S]{0,80}hostElement(?:,[^)]+)?\)/,
    'a new answer run must reset progress only at the run boundary'
  );
  assert.doesNotMatch(
    header,
    /==="loading"&&[A-Za-z_$][\w$]*<50&&[A-Za-z_$][\w$]*>=95/,
    'late loading events must not reset or lower a completed header'
  );
  assert.doesNotMatch(bundle, literal(legacyHeaderProgressVar));
  assert.doesNotMatch(bundle, literal(legacyWorkingAttr));
  assert.doesNotMatch(
    bundle,
    /acs-fill-sweep|\.acs-fill::after|\.acs-progress__fill::after/,
    'progress bars should only move by width, with no internal shimmer sweep'
  );
});

test('rendered header progress does not fall back to retrieval progress after streaming starts', async () => {
  const page = await browser.newPage();
  try {
    await page.route('**/*', async (route) => {
      const request = route.request();
      if (request.isNavigationRequest()) {
        await route.fulfill({
          status: 200,
          contentType: 'text/html',
          body: '<!doctype html><html><body></body></html>',
        });
        return;
      }
      if (/\.algolia\.(net|com)\//.test(request.url())) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            results: [{ hits: [], nbHits: 0, page: 0, nbPages: 0, hitsPerPage: 0 }],
          }),
        });
        return;
      }
      await route.continue();
    });

    await page.goto('http://localhost/');
    await page.addScriptTag({ content: fs.readFileSync(chatPath, 'utf8') });
    await page.evaluate(async () => {
      await Promise.all([
        customElements.whenDefined('algolia-instant-search'),
        customElements.whenDefined('algolia-chat'),
        customElements.whenDefined('algolia-agent'),
      ]);
      const search = document.createElement('algolia-instant-search');
      search.setAttribute('app-id', 'test-app');
      search.setAttribute('api-key', 'test-search-key');
      search.setAttribute('index-name', 'test-index');
      const widget = document.createElement('algolia-chat');
      widget.setAttribute('judge-mode', 'off');
      const agent = document.createElement('algolia-agent');
      agent.setAttribute('role', 'primary');
      agent.setAttribute('agent-id', 'test-agent');
      widget.append(agent);
      search.append(widget);
      document.body.append(search);
      await new Promise((resolve) => setTimeout(resolve, 100));
      widget.open();
    });
    await page.waitForFunction(
      () => document.querySelector('algolia-chat')?.shadowRoot?.querySelector('[part="header"]')
    );

    const emit = async (detail) => {
      await page.evaluate((payload) => {
        globalThis.dispatchEvent(
          new CustomEvent('algolia-chat-processing-progress', { detail: payload })
        );
      }, detail);
    };
    const hostProgress = () =>
      page.evaluate(() =>
        document.querySelector('algolia-chat')?.style.getPropertyValue('--algolia-header-progress')
      );

    await emit({ status: 'loading', progress: 50 });
    await page.waitForFunction(
      () => document.querySelector('algolia-chat')?.style.getPropertyValue('--algolia-header-progress') === '50%'
    );
    await emit({ status: 'streaming', progress: 100 });
    await page.waitForFunction(
      () => document.querySelector('algolia-chat')?.style.getPropertyValue('--algolia-header-progress') === '100%'
    );
    await emit({ status: 'loading', progress: 50 });
    await page.waitForTimeout(100);
    assert.equal(await hostProgress(), '100%');

    await page.evaluate(async () => {
      const widget = document.querySelector('algolia-chat');
      const parent = widget.parentNode;
      widget.remove();
      parent.append(widget);
      await new Promise((resolve) => setTimeout(resolve, 100));
      widget.open();
    });
    await page.waitForFunction(
      () => document.querySelector('algolia-chat')?.shadowRoot?.querySelector('[part="header"]')
    );
    await emit({ status: 'loading', progress: 50 });
    await page.waitForTimeout(100);
    assert.equal(await hostProgress(), '100%');

    const lateLoadingRead = await page.evaluate(() => {
      globalThis.dispatchEvent(
        new CustomEvent('algolia-chat-processing-progress', {
          detail: { status: 'loading', progress: 33 },
        })
      );
      const widget = document.querySelector('algolia-chat');
      const header = widget?.shadowRoot?.querySelector('[part="header"]');
      return {
        progress: widget?.style.getPropertyValue('--algolia-header-progress'),
        resetting: widget?.hasAttribute('data-algolia-progress-resetting'),
      };
    });
    assert.equal(lateLoadingRead.progress, '100%');
    assert.equal(lateLoadingRead.resetting, false);
  } finally {
    await page.close();
  }
});

test('header progress skin keeps moving while work is active', () => {
  const themePath = new URL('../algolia-chat-theme-algolia.js', import.meta.url);
  const theme = fs.readFileSync(themePath, 'utf8');

  assert.doesNotMatch(
    theme,
    /@keyframes algolia-header-progress-flow/,
    'header progress should not have a secondary internal shimmer animation'
  );
  assert.doesNotMatch(
    theme,
    /animation: algolia-header-progress-flow/,
    'header progress should only move by real width progress'
  );
  assert.doesNotMatch(
    theme,
    /background-size: 220% 100%/,
    'header progress should not carry a moving background texture'
  );
  assert.doesNotMatch(theme, literal(legacyHeaderProgressFlow));
  assert.match(
    theme,
    /transition: width 900ms linear/,
    'header fill width should glide smoothly between real progress signals'
  );
  assert.match(
    theme,
    /:host\(\[data-algolia-progress-resetting\]\) \[part="header"\]::before \{ transition-duration: 1ms !important; \}/,
    'new answer resets should snap to the start instead of animating backwards from the prior answer'
  );
});
