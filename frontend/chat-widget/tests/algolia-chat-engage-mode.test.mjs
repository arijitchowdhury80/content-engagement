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

test('proactive greeting keeps normal transcript width when the window is maximized', () => {
  const bundle = fs.readFileSync(chatPath, 'utf8');
  const transcriptStart = bundle.indexOf('function s1({turns:t,onPickSample:n,onRetry:i,onPickFollowUp:a,onOpenJudge:l,onRunDeepDive:u,onDeclineDeepDive:f,inputBlocked:d,emptyStateFooter:p})');
  const transcriptEnd = bundle.indexOf('const l1=', transcriptStart);

  assert.notEqual(transcriptStart, -1, 'transcript renderer should exist');
  assert.notEqual(transcriptEnd, -1, 'transcript renderer should have a stable boundary');

  const transcriptBlock = bundle.slice(transcriptStart, transcriptEnd);

  assert.doesNotMatch(
    transcriptBlock,
    /p&&w\.jsx\("div",\{className:"w-full max-w-algolia-measure"/,
    'proactive greeting should not be constrained to the narrow empty-state measure'
  );
  assert.match(
    transcriptBlock,
    /p\?w\.jsxs\("div",\{className:"flex flex-1 flex-col gap-7 overflow-y-auto px-4 py-6 sm:px-6"/,
    'proactive greeting should use the same full transcript lane as normal chat turns'
  );
});

test('sample questions stay in the composer footer even on first access', () => {
  const bundle = fs.readFileSync(chatPath, 'utf8');
  const panelStart = bundle.indexOf('function HR({onClose:t,initialMessage:n,sizeMode:i,onToggleSize:a,onRestore:l})');
  const panelEnd = bundle.indexOf('function zR()', panelStart);

  assert.notEqual(panelStart, -1, 'chat panel renderer should exist');
  assert.notEqual(panelEnd, -1, 'chat panel renderer should have a stable boundary');

  const panelBlock = bundle.slice(panelStart, panelEnd);

  assert.match(
    panelBlock,
    /R=!1,T=oe\.useRef\(!1\)/,
    'first access should not suppress the footer sample-question trigger'
  );
  assert.match(
    panelBlock,
    /children:\[\!R&&w\.jsx\(bg,\{onPick:I=>\{d\(I\)\},disabled:f\}\),w\.jsx\(an,\{name:"composer"/,
    'sample-question trigger should remain directly above the composer'
  );
});
