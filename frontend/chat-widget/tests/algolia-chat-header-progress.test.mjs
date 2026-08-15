import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const chatPath = new URL('../algolia-chat.js', import.meta.url);
const legacyHeaderProgressVar = ['--a', 'cs-header-progress'].join('');
const legacyWorkingAttr = ['data-a', 'cs-working'].join('');
const legacyHeaderProgressFlow = ['a', 'cs-header-progress-flow'].join('');

function literal(value) {
  return new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
}

test('processing trace drives the header gradient fill from real progress state', () => {
  const bundle = fs.readFileSync(chatPath, 'utf8');
  const traceStart = bundle.indexOf('function acProcessingTrace');
  const traceEnd = bundle.indexOf('function ', traceStart + 20);

  assert.notEqual(traceStart, -1, 'processing trace should exist');
  assert.notEqual(traceEnd, -1, 'processing trace should have a stable boundary');

  const traceBlock = bundle.slice(traceStart, traceEnd);

  assert.match(traceBlock, /--algolia-header-progress/);
  assert.match(traceBlock, /data-algolia-working/);
  assert.doesNotMatch(traceBlock, literal(legacyHeaderProgressVar));
  assert.doesNotMatch(traceBlock, literal(legacyWorkingAttr));
  assert.match(traceBlock, /=zh\(\)/);
  assert.match(traceBlock, /requestAnimationFrame/);
  assert.match(traceBlock, /acTraceProgressCeiling/);
  assert.match(traceBlock, /style\.setProperty\("--algolia-header-progress",String\([A-Za-z]\)\+"%"\)/);
  assert.match(traceBlock, /toggleAttribute\("data-algolia-working",!0\)/);
  assert.doesNotMatch(traceBlock, /style\.removeProperty\("--algolia-header-progress"\)/);
  assert.doesNotMatch(traceBlock, /removeAttribute\("data-algolia-working"\)/);
  assert.match(traceBlock, /aria-valuenow/);
  assert.doesNotMatch(traceBlock, /querySelector\?\.\("algolia-chat"\)/);
  assert.doesNotMatch(traceBlock, /setTimeout\([^)]*--algolia-header-progress/);
});

test('header progress skin keeps moving while work is active', () => {
  const themePath = new URL('../algolia-chat-theme-algolia.js', import.meta.url);
  const theme = fs.readFileSync(themePath, 'utf8');

  assert.match(
    theme,
    /@keyframes algolia-header-progress-flow/,
    'header fill should have an internal motion layer for long-running stages'
  );
  assert.match(
    theme,
    /animation: algolia-header-progress-flow 1\.8s linear infinite/,
    'header fill motion should be continuous instead of stage-jump only'
  );
  assert.doesNotMatch(theme, literal(legacyHeaderProgressFlow));
  assert.match(
    theme,
    /transition: width 900ms linear/,
    'header fill width should glide smoothly between real progress signals'
  );
});
