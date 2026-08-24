import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const chatPath = new URL('../algolia-chat.js', import.meta.url);

test('header icon buttons do not render visible tooltip pills', () => {
  const bundle = fs.readFileSync(chatPath, 'utf8');
  const iconButtonStart = bundle.indexOf('function _i({onClick');
  const iconButtonEnd = bundle.indexOf('function uR(', iconButtonStart);
  const iconButtonHelper = bundle.slice(iconButtonStart, iconButtonEnd);

  assert.notEqual(iconButtonStart, -1, 'header icon button helper should exist');
  assert.notEqual(iconButtonEnd, -1, 'header icon button helper should have a stable boundary');
  assert.match(iconButtonHelper, /aria-label/);
  assert.doesNotMatch(iconButtonHelper, /role:"tooltip"/);
  assert.doesNotMatch(iconButtonHelper, /top-\[calc\(100%\+8px\)\]/);
  assert.doesNotMatch(iconButtonHelper, /group-hover:opacity-100/);
  assert.doesNotMatch(iconButtonHelper, /bg-algolia-text/);
});
