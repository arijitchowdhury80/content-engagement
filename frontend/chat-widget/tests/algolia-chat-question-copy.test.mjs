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
  assert.match(
    bundle,
    /f\.map\(v=>.*?onClick:\(\)=>\{acCopyQuestion\(v\),t\(v\)\}/,
    'inline empty-state question chips should copy before using the question'
  );
  assert.match(
    bundle,
    /n\.map\(u=>.*?onClick:\(\)=>\{acCopyQuestion\(u\),i\(u\)\}/,
    'proactive greeting suggestion chips should copy before using the question'
  );
});
