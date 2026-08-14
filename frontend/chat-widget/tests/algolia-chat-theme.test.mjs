import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const themePath = new URL('../algolia-chat-theme-algolia.js', import.meta.url);
const logoPackRoot = '/Users/arijitchowdhury/Dropbox/AI-Development/algolia-logo-pack/SVG';
const logoPackMarkWhitePath = `${logoPackRoot}/Algolia-mark-white.svg`;
const logoPackMarkBluePath = `${logoPackRoot}/Algolia-mark-blue.svg`;

function cssSvgUrlFromFile(url) {
  return `url("data:image/svg+xml,${encodeURIComponent(fs.readFileSync(url, 'utf8'))}")`;
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

  assert.equal(theme.typography.scale.sm, '12px');
  assert.equal(theme.typography.scale.base, '14px');
  assert.equal(theme.layout.headerHeight, '72px');
  assert.equal(theme.layout.dockedHeight, '560px');
  assert.equal(theme.space.maxWidth, '100%');
  assert.equal(theme.space.msgMaxW, 'min(920px, calc(100% - 56px))');
  assert.ok(fs.existsSync(logoPackMarkWhitePath), 'canonical white mark exists in local logo pack');
  assert.ok(fs.existsSync(logoPackMarkBluePath), 'canonical blue mark exists in local logo pack');

  const css = theme.css;
  assert.match(css, /Fully grounded/);
  assert.match(css, /\[part="panel"\]/);
  assert.match(css, /\[part="header"\][^{]+{[^}]*gap: 16px/);
  assert.match(css, /\[part="header"\] h1[^{]+{[^}]*line-height: 1.15/);
  assert.match(css, /\[part="header"\]::after[^{]+{[^}]*top: 46px/);
  assert.match(css, /\[part="header"\] > div[^{]+{[^}]*gap: 12px/);
  assert.match(css, /\[part="header"\] > div button[^{]+{[^}]*width: 28px/);
  assert.match(css, /\[part="header"\] > div button[^{]+{[^}]*background: transparent/);
  assert.match(css, /\[part="header"\] > div button[^{]+{[^}]*color: var\(--algolia-text-muted\)/);
  assert.match(css, /\[part="header"\] > div button svg[^{]+{[^}]*width: 17px/);
  assert.match(css, /\[part="header"\] > div button img[^{]+{[^}]*width: 17px/);
  assert.doesNotMatch(css, /\[part="header"\] button[^{]+{[^}]*margin-left: 6px/);
  assert.doesNotMatch(css, /\.bg-algolia-surface\.p-6\.shadow-algolia-2::before/);
  assert.doesNotMatch(css, /linear-gradient\(180deg, var\(--algolia-agent-primary\)/);
  assert.match(css, /\.bg-algolia-surface\.p-6\.shadow-algolia-2[^{]+{[^}]*background: transparent !important/);
  assert.match(css, /\.bg-algolia-surface\.p-6\.shadow-algolia-2[^{]+{[^}]*border: 0 !important/);
  assert.match(css, /\.bg-algolia-surface\.p-6\.shadow-algolia-2[^{]+{[^}]*box-shadow: none !important/);
  assert.match(css, /\.uppercase\.tracking-algolia-caps[^{]+{[^}]*border: 0 !important/);
  assert.match(css, /\.mx-auto\.flex\.w-full\.max-w-algolia-maxw\.flex-1\.flex-col\.overflow-hidden[^{]+{[^}]*max-width: 100% !important/);
  assert.match(css, /\.shrink-0\.border-t\.border-algolia-border\.bg-algolia-surface > \.mx-auto[^{]+{[^}]*max-width: 100% !important/);
  assert.match(css, /\.shrink-0\.border-t\.border-algolia-border\.bg-algolia-surface > \.mx-auto[^{]+{[^}]*padding: 6px 14px 8px !important/);
  assert.match(css, /\.flex\.items-center\.justify-between\.gap-3\.py-2\.text-algolia-xs\.text-algolia-text-muted[^{]+{[^}]*display: none !important/);
  assert.match(css, /\.acs-reasoning[^{]+{[^}]*background: transparent/);
  assert.match(css, /\.acs-reasoning[^{]+{[^}]*box-shadow: none/);
  assert.doesNotMatch(css, /\.acs-reasoning[^{]+{[^}]*border-bottom: 1px/);
  assert.doesNotMatch(css, /\.acs-progress\s*{[^}]*display: none !important/);
  assert.match(css, /\.acs-progress\s*{[^}]*height: 2px !important/);
  assert.match(css, /\.acs-progress__fill::after[^{]+{[^}]*display: none !important/);
  assert.doesNotMatch(css, /\.acs-source-chips/);
  assert.doesNotMatch(css, /\.acs-source-chip__count/);
  assert.match(css, /\.acs-step__label[^{]+{[^}]*font-size: var\(--algolia-fs-2xs\)/);
  assert.match(css, /\.acs-step__label[^{]+{[^}]*font-weight: var\(--algolia-fw-medium\)/);
  assert.match(css, /\.acs-step__detail[^{]+{[^}]*font-size: var\(--algolia-fs-2xs\)/);
  assert.match(css, /\.acs-step__detail[^{]+{[^}]*font-style: italic/);
  assert.match(css, /\.acs-step__detail[^{]+{[^}]*color: color-mix/);
  assert.match(css, /\.acs-step--active \.acs-step__label[^{]+{[^}]*color: var\(--algolia-text-secondary\)/);
  assert.match(css, /\[part="composer"\][^{]+{[^}]*border-radius: var\(--algolia-radius-full\)/);
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
