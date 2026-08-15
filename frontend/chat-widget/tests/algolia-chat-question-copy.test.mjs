import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const chatPath = new URL('../algolia-chat.js', import.meta.url);

test('question buttons copy their text before invoking the existing action', () => {
  const bundle = fs.readFileSync(chatPath, 'utf8');

  assert.match(
    bundle,
    /function acCopyQuestion\(t\)\{const n=typeof t=="string"\?t\.trim\(\):"";if\(!n\)return;try\{const i=navigator\?\.clipboard\?\.writeText\?\.call\(navigator\.clipboard,n\);if\(i&&typeof i\.catch=="function"\)i\.catch\(\(\)=>\{\}\);return\}catch\{\}try\{/,
    'shared clipboard helper should copy question text with a safe fallback'
  );
  assert.match(
    bundle,
    /function HS\(\{question:t,onAsk:n,disabled:i\}\)\{return .*?onClick:\(\)=>\{acCopyQuestion\(t\),n\(t\)\}/,
    'discovery question cards should copy before asking'
  );
  assert.match(
    bundle,
    /f\.questions\.map\(d=>.*?onClick:\(\)=>\{acCopyQuestion\(d\),t\(d\)\}/,
    'sample question menu items should copy before using the question'
  );
  const emptyStart = bundle.indexOf('function o1({onPick:t,hideWelcome:n})');
  const emptyEnd = bundle.indexOf('function s1(', emptyStart);
  assert.notEqual(emptyStart, -1, 'empty-state renderer should exist');
  assert.notEqual(emptyEnd, -1, 'empty-state renderer should have a stable boundary');

  const emptyBlock = bundle.slice(emptyStart, emptyEnd);
  assert.doesNotMatch(
    emptyBlock,
    /variant:"inline"|f\.map\(v=>.*?acCopyQuestion\(v\)/,
    'empty-state sample questions should not render in the welcome area'
  );
  assert.match(
    bundle,
    /n\.map\(u=>.*?onClick:\(\)=>\{acCopyQuestion\(u\),i\(u\)\}/,
    'proactive greeting suggestion chips should copy before using the question'
  );
});
