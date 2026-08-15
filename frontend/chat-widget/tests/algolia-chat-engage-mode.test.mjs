import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const chatPath = new URL('../algolia-chat.js', import.meta.url);

test('proactive engage opens in docked mode unless a caller explicitly overrides it', () => {
  const bundle = fs.readFileSync(chatPath, 'utf8');

  assert.match(
    bundle,
    /n\?\.openMode==="normal"\|\|n\?\.openMode==="maximized"\|\|n\?\.openMode==="docked"\?n\.openMode:"docked"/,
    'public engage() should default proactive greetings to docked mode'
  );
  assert.match(
    bundle,
    /[a-z]\.engage\(\{greeting:i,suggestions:a,openMode:/,
    'public engage() should forward the selected open mode to the internal widget API'
  );
  assert.match(
    bundle,
    /engage:\(\{greeting:b,suggestions:k,openMode:m\}\)=>\{const R=Je\.engage\(b,k\?\?\[\]\);return R&&\(m==="docked"\|\|m==="normal"\|\|m==="maximized"\)&&d\(m\),R&&E\(\),R\}/,
    'internal engage() should apply the requested mode before opening'
  );
});

test('proactive greeting uses the same transcript lane instead of a separate avatar rail', () => {
  const bundle = fs.readFileSync(chatPath, 'utf8');
  const greetingStart = bundle.indexOf('function d1({greeting:t,suggestions:n,onPickSuggestion:i,personaLabel:a})');
  const greetingEnd = bundle.indexOf('const Wl=', greetingStart);

  assert.notEqual(greetingStart, -1, 'proactive greeting renderer should exist');
  assert.notEqual(greetingEnd, -1, 'proactive greeting renderer should have a stable boundary');

  const greetingBlock = bundle.slice(greetingStart, greetingEnd);

  assert.doesNotMatch(greetingBlock, /w\.jsx\(f1,\{\}\)/, 'proactive greeting should not render a separate blue chat avatar');
  assert.doesNotMatch(greetingBlock, /ml-11 flex flex-wrap gap-2/, 'suggestion chips should not be indented for a removed avatar rail');
  assert.doesNotMatch(greetingBlock, /rounded-algolia-lg rounded-tl-sm bg-algolia-surface-2/, 'greeting should not use a separate chat-bubble visual system');
  assert.match(greetingBlock, /className:"flex items-start gap-0"/, 'greeting row should align to the normal transcript lane');
  assert.match(greetingBlock, /className:"flex w-full flex-col gap-2"/, 'greeting copy and suggestions should use the full transcript width');
});
