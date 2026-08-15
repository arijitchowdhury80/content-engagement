import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const chatPath = new URL('../algolia-chat.js', import.meta.url);

test('processing trace drives the header gradient fill from real progress state', () => {
  const bundle = fs.readFileSync(chatPath, 'utf8');
  const traceStart = bundle.indexOf('function acProcessingTrace');
  const traceEnd = bundle.indexOf('function ', traceStart + 20);

  assert.notEqual(traceStart, -1, 'processing trace should exist');
  assert.notEqual(traceEnd, -1, 'processing trace should have a stable boundary');

  const traceBlock = bundle.slice(traceStart, traceEnd);

  assert.match(traceBlock, /--acs-header-progress/);
  assert.match(traceBlock, /data-acs-working/);
  assert.match(traceBlock, /=zh\(\)/);
  assert.match(traceBlock, /requestAnimationFrame/);
  assert.match(traceBlock, /acTraceProgressCeiling/);
  assert.match(traceBlock, /style\.setProperty\("--acs-header-progress",String\([A-Za-z]\)\+"%"\)/);
  assert.match(traceBlock, /toggleAttribute\("data-acs-working",!0\)/);
  assert.doesNotMatch(traceBlock, /style\.removeProperty\("--acs-header-progress"\)/);
  assert.doesNotMatch(traceBlock, /removeAttribute\("data-acs-working"\)/);
  assert.match(traceBlock, /aria-valuenow/);
  assert.doesNotMatch(traceBlock, /querySelector\?\.\("algolia-chat"\)/);
  assert.doesNotMatch(traceBlock, /setTimeout\([^)]*--acs-header-progress/);
});

test('header progress skin keeps moving while work is active', () => {
  const themePath = new URL('../algolia-chat-theme-algolia.js', import.meta.url);
  const theme = fs.readFileSync(themePath, 'utf8');

  assert.match(
    theme,
    /@keyframes acs-header-progress-flow/,
    'header fill should have an internal motion layer for long-running stages'
  );
  assert.match(
    theme,
    /animation: acs-header-progress-flow 1\.8s linear infinite/,
    'header fill motion should be continuous instead of stage-jump only'
  );
  assert.match(
    theme,
    /transition: width 900ms linear/,
    'header fill width should glide smoothly between real progress signals'
  );
});
