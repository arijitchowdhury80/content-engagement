import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const themePath = new URL('../algolia-chat-theme-algolia.js', import.meta.url);
const logoPackRoot = '/Users/arijitchowdhury/Dropbox/AI-Development/algolia-logo-pack/SVG';
const logoPackMarkWhitePath = `${logoPackRoot}/Algolia-mark-white.svg`;
const logoPackMarkBluePath = `${logoPackRoot}/Algolia-mark-blue.svg`;
const legacyHeaderProgressVar = ['--a', 'cs-header-progress'].join('');
const legacyWorkingAttr = ['data-a', 'cs-working'].join('');

function cssSvgUrlFromFile(url) {
  return `url("data:image/svg+xml,${encodeURIComponent(fs.readFileSync(url, 'utf8'))}")`;
}

function literal(value) {
  return new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
}

function loadAlgoliaTheme() {
  const registered = [];
  const context = {
    window: {
      algoliaChat: {
        registerTheme(name, theme) {
          registered.push({ name, theme });
        },
      },
    },
  };

  vm.createContext(context);
  vm.runInContext(fs.readFileSync(themePath, 'utf8'), context);

  assert.equal(registered.length, 1, 'theme should register exactly once');
  assert.equal(registered[0].name, 'algolia');

  return registered[0].theme;
}

test('Algolia theme keeps the chat panel compact and source-grounded in the header chrome', () => {
  const theme = loadAlgoliaTheme();

  assert.equal(theme.typography.scale.sm, '13px');
  assert.equal(theme.typography.scale.base, '14px');
  assert.equal(theme.layout.headerHeight, '60px');
  assert.equal(theme.layout.panelWidth, 'min(1080px, 70vw)');
  assert.equal(theme.layout.dockedWidth, '540px');
  assert.equal(theme.layout.dockedHeight, '500px');
  assert.equal(theme.space.maxWidth, '100%');
  assert.equal(theme.space.msgMaxW, 'min(920px, calc(100% - 56px))');
  assert.ok(fs.existsSync(logoPackMarkWhitePath), 'canonical white mark exists in local logo pack');
  assert.ok(fs.existsSync(logoPackMarkBluePath), 'canonical blue mark exists in local logo pack');

  const css = theme.css;
  assert.doesNotMatch(css, /Fully grounded/);
  assert.doesNotMatch(css, /Grounded answers cite sources/);
  assert.match(css, /\[part="panel"\]/);
  assert.match(css, /\[part="header"\][^{]+{[^}]*gap: 12px/);
  assert.match(css, /\[part="header"\][^{]+{[^}]*padding: 8px 14px 7px !important/);
  assert.match(css, /\[part="header"\][^{]+{[^}]*isolation: isolate/);
  assert.match(css, /\[part="header"\] h1[^{]+{[^}]*line-height: 1.15/);
  assert.match(css, /\[part="header"\] h1[^{]+{[^}]*margin-bottom: 0/);
  assert.doesNotMatch(css, /\[part="header"\]::after/);
  assert.match(css, /:host\(\[data-algolia-working\]\) \[part="header"\]::before[^{]+{[^}]*width: var\(--algolia-header-progress, 0%\)/);
  assert.match(css, /:host\(\[data-algolia-working\]\) \[part="header"\]::before[^{]+{[^}]*linear-gradient\(90deg, rgba\(0,61,255,0\.04\), rgba\(0,61,255,0\.16\)(?:, rgba\(0,61,255,0\.08\))?\)/);
  assert.doesNotMatch(css, literal(legacyHeaderProgressVar));
  assert.doesNotMatch(css, literal(legacyWorkingAttr));
  assert.match(css, /\[part="header"\] > \*[^{]+{[^}]*z-index: 1/);
  assert.match(css, /\[part="header"\] > div:first-child[^{]+{[^}]*align-self: center/);
  assert.match(css, /\[part="header"\] > div:first-child[^{]+{[^}]*min-width: 0/);
  assert.match(css, /\[part="header"\] > div:first-child[^{]+{[^}]*flex: 1 1 auto/);
  assert.match(css, /\[part="header"\] > div:first-child h1[^{]+{[^}]*text-overflow: ellipsis/);
  assert.match(css, /\[part="header"\] > div[^{]+{[^}]*gap: 12px/);
  assert.match(css, /\[part="header"\] > div button[^{]+{[^}]*width: 28px/);
  assert.match(css, /\[part="header"\] > div button[^{]+{[^}]*background: transparent/);
  assert.match(css, /\[part="header"\] > div button[^{]+{[^}]*color: var\(--algolia-text-muted\)/);
  assert.match(css, /\[part="header"\] > div button svg[^{]+{[^}]*width: 17px/);
  assert.match(css, /\[part="header"\] > div button img[^{]+{[^}]*width: 17px/);
  assert.doesNotMatch(css, /@media \(max-width: 640px\)[\s\S]*\[part="header"\]::after/);
  assert.doesNotMatch(css, /\[part="header"\] button[^{]+{[^}]*margin-left: 6px/);
  assert.doesNotMatch(css, /\.bg-algolia-surface\.p-6\.shadow-algolia-2::before/);
  assert.doesNotMatch(css, /linear-gradient\(180deg, var\(--algolia-agent-primary\)/);
  assert.match(css, /\.bg-algolia-surface\.p-6\.shadow-algolia-2[^{]+{[^}]*background: transparent !important/);
  assert.match(css, /\.bg-algolia-surface\.p-6\.shadow-algolia-2[^{]+{[^}]*border: 0 !important/);
  assert.match(css, /\.bg-algolia-surface\.p-6\.shadow-algolia-2[^{]+{[^}]*box-shadow: none !important/);
  assert.match(css, /\.bg-algolia-surface\.p-6\.shadow-algolia-2 > \.flex\.flex-col\s*{[^}]*gap: 0 !important/);
  assert.match(css, /\.bg-algolia-surface\.p-6\.shadow-algolia-2 > \.flex\.flex-col > p\s*{[^}]*font-size: 15px !important/);
  assert.match(css, /\.bg-algolia-surface\.p-6\.shadow-algolia-2 > \.flex\.flex-col > p\s*{[^}]*line-height: 1\.6 !important/);
  assert.match(css, /\.bg-algolia-surface\.p-6\.shadow-algolia-2 > \.flex\.flex-col > p:first-child[^{]+{[^}]*font-size: 15\.5px !important/);
  assert.match(css, /\.bg-algolia-surface\.p-6\.shadow-algolia-2 > \.flex\.flex-col > p:first-child[^{]+{[^}]*line-height: 1\.62 !important/);
  assert.match(css, /\.bg-algolia-surface\.p-6\.shadow-algolia-2 > \.flex\.flex-col > p:first-child[^{]+{[^}]*font-style: italic !important/);
  assert.match(css, /\.bg-algolia-surface\.p-6\.shadow-algolia-2 > \.flex\.flex-col > p:first-child[^{]+{[^}]*font-weight: 400 !important/);
  assert.match(css, /\.bg-algolia-surface\.p-6\.shadow-algolia-2 > \.flex\.flex-col > p:first-child[^{]+{[^}]*text-shadow: 0 1px 0 rgba\(255,255,255,0\.92\), 0 8px 18px rgba\(35,38,59,0\.16\)/);
  assert.match(css, /\.bg-algolia-surface\.p-6\.shadow-algolia-2 > \.flex\.flex-col > p:first-child[^{]+{[^}]*margin: 2px 0 7px !important/);
  assert.match(css, /\.bg-algolia-surface\.p-6\.shadow-algolia-2 > \.flex\.flex-col > p:first-child \+ p[^{]+{[^}]*margin-bottom: 30px !important/);
  assert.match(css, /\.bg-algolia-surface\.p-6\.shadow-algolia-2 > \.flex\.flex-col > p\.font-algolia-bold[^{]+{[^}]*margin-top: 32px !important/);
  assert.match(css, /\.bg-algolia-surface\.p-6\.shadow-algolia-2 > \.flex\.flex-col > p\.font-algolia-bold[^{]+{[^}]*font-size: 18px !important/);
  assert.match(css, /\.bg-algolia-surface\.p-6\.shadow-algolia-2 > \.flex\.flex-col > p:not\(:first-child\):has\(> strong:first-child\)[^{]+{[^}]*margin-top: 26px !important/);
  assert.match(css, /\.bg-algolia-surface\.p-6\.shadow-algolia-2 > \.flex\.flex-col > ul, \.bg-algolia-surface\.p-6\.shadow-algolia-2 > \.flex\.flex-col > ol[^{]+{[^}]*margin-bottom: 26px !important/);
  assert.match(css, /\.bg-algolia-surface\.p-6\.shadow-algolia-2 > \.flex\.flex-col li[^{]+{[^}]*font-size: 15px !important/);
  assert.match(css, /\.bg-algolia-surface\.p-6\.shadow-algolia-2 > \.flex\.flex-col > table[^{]+{[^}]*margin-bottom: 28px !important/);
  assert.doesNotMatch(css, /aRRIe take/);
  assert.match(css, /\.uppercase\.tracking-algolia-caps[^{]+{[^}]*border: 0 !important/);
  assert.match(css, /\.mx-auto\.flex\.w-full\.max-w-algolia-maxw\.flex-1\.flex-col\.overflow-hidden[^{]+{[^}]*max-width: 100% !important/);
  assert.match(css, /\.w-full\.max-w-algolia-measure\s*{[^}]*max-width: var\(--algolia-msg-max-w\) !important/);
  assert.match(css, /\.flex\.flex-1\.flex-col\.items-center\.overflow-y-auto\.px-4\.pb-8\.pt-6\.sm\\:px-6\.sm\\:pt-10[^{]+{[^}]*padding-top: 12px !important/);
  assert.match(css, /\.flex\.flex-1\.flex-col\.items-center\.overflow-y-auto\.px-4\.pb-8\.pt-6\.sm\\:px-6\.sm\\:pt-10[^{]+{[^}]*padding-bottom: 14px !important/);
  assert.match(css, /\.mx-auto\.flex\.w-full\.max-w-algolia-measure\.flex-col\.items-center\.gap-5\.px-4\.text-center[^{]+{[^}]*gap: 12px !important/);
  assert.match(css, /\.flex\.w-full\.flex-col\.gap-3\.pt-6\.pb-4[^{]+{[^}]*padding-top: 10px !important/);
  assert.match(css, /\.flex\.w-full\.flex-col\.gap-3\.pt-6\.pb-4[^{]+{[^}]*padding-bottom: 8px !important/);
  assert.match(css, /\.rounded-algolia-lg\.rounded-tl-sm\.bg-algolia-surface-2\.px-4\.py-3\.text-algolia-sm\.text-algolia-text\.shadow-algolia-1[^{]+{[^}]*max-width: 100% !important/);
  assert.match(css, /\.shrink-0\.border-t\.border-algolia-border\.bg-algolia-surface > \.mx-auto[^{]+{[^}]*max-width: 100% !important/);
  assert.match(css, /\.shrink-0\.border-t\.border-algolia-border\.bg-algolia-surface > \.mx-auto[^{]+{[^}]*padding: 6px 14px 8px !important/);
  assert.match(css, /\.shrink-0\.border-t\.border-algolia-border\.bg-algolia-surface\s*{[^}]*border-top: 0 !important/);
  assert.match(css, /\.flex\.items-center\.justify-between\.gap-3\.py-2\.text-algolia-xs\.text-algolia-text-muted[^{]+{[^}]*display: none !important/);
  assert.match(css, /\.acs-reasoning[^{]+{[^}]*background: transparent/);
  assert.match(css, /\.acs-reasoning[^{]+{[^}]*box-shadow: none/);
  assert.doesNotMatch(css, /\.acs-reasoning[^{]+{[^}]*border-bottom: 1px/);
  assert.match(css, /\.acs-progress\s*{[^}]*display: none !important/);
  assert.doesNotMatch(css, /\.acs-progress\s*{[^}]*height: 2px !important/);
  assert.doesNotMatch(css, /\.acs-progress\s*{[^}]*background: color-mix/);
  assert.doesNotMatch(css, /\.acs-progress__fill[^{]+{[^}]*background: var\(--algolia-text-secondary\)/);
  assert.doesNotMatch(css, /\.acs-progress__fill::after/);
  assert.doesNotMatch(css, /\.acs-source-chips/);
  assert.doesNotMatch(css, /\.acs-source-chip__count/);
  assert.match(css, /\.acs-step__label[^{]+{[^}]*font-size: var\(--algolia-fs-2xs\)/);
  assert.match(css, /\.acs-step__label[^{]+{[^}]*font-weight: var\(--algolia-fw-medium\)/);
  assert.match(css, /\.acs-step__detail[^{]+{[^}]*font-size: var\(--algolia-fs-2xs\)/);
  assert.match(css, /\.acs-step__detail[^{]+{[^}]*font-style: italic/);
  assert.match(css, /\.acs-step__detail[^{]+{[^}]*color: color-mix/);
  assert.match(css, /\.acs-step--active \.acs-step__label[^{]+{[^}]*color: var\(--algolia-text-secondary\)/);
  assert.match(css, /\[part="composer"\][^{]+{[^}]*border-radius: var\(--algolia-radius-full\)/);
  assert.match(css, /\[part="composer-input"\][^{]+{[^}]*display: flex/);
  assert.match(css, /\[part="composer-input"\][^{]+{[^}]*align-items: center/);
  assert.match(css, /\[part="composer-input"\][^{]+{[^}]*line-height: 38px/);
  assert.match(css, /\[part="composer-input"\]::placeholder[^{]+{[^}]*line-height: 38px/);
  assert.match(css, /\[part="composer-send"\][^{]+{[^}]*width: 40px/);
  assert.match(css, /\[part="composer-send"\][^{]+{[^}]*background: #050505/);
  assert.match(css, /data:image\/svg\+xml/);
  assert.match(css, /M250%2C0/);
  assert.match(css, /Generated from local Algolia logo pack/);
  assert.match(css, new RegExp(cssSvgUrlFromFile(logoPackMarkWhitePath).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(css, /\[part="composer-send"\]::before/);
  assert.doesNotMatch(css, /\[part="composer-send"\]::after/);
  assert.doesNotMatch(css, /border-right-color: transparent/);
  assert.doesNotMatch(css, /Powered by Algolia/);
  assert.doesNotMatch(css, /10rem/);
});
