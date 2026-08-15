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
  assert.match(
    bundle,
    /function acTraceStageFromSignals\([^)]*\)\{[^}]*==="streaming"\|\|[^}]*==="success"[^}]*return [A-Za-z]\|\|[A-Za-z]\?5:[A-Za-z]\?2:1\}/,
    'streaming and success status should force the header progress target to 100% before first text delta'
  );
  assert.match(
    bundle,
    /function acHeaderProgressSync\(/,
    'header progress should have a non-visual sync path that remains mounted when answer text streams'
  );
  assert.match(
    bundle,
    /status[^?]+==="success"/,
    'successful finalization should also force the header progress target to 100%'
  );
  assert.match(
    bundle,
    /acTraceProgressCeiling\([^)]*,[^)]*x>0/,
    'progress should continue gliding after sources arrive instead of stopping at the source-stage percentage'
  );
  assert.match(
    bundle,
    /acHeaderProgressSync,\{searchCount:[^,]+,sources:[^,]+,status:[^,]+,text:[^}]+\}/,
    'assistant renderer should mount header progress sync even when answer text is visible'
  );
  assert.match(traceBlock, /style\.setProperty\("--algolia-header-progress",String\([A-Za-z]\)\+"%"\)/);
  assert.match(traceBlock, /toggleAttribute\("data-algolia-working",!0\)/);
  assert.doesNotMatch(traceBlock, /style\.removeProperty\("--algolia-header-progress"\)/);
  assert.doesNotMatch(traceBlock, /removeAttribute\("data-algolia-working"\)/);
  assert.match(traceBlock, /aria-valuenow/);
  assert.doesNotMatch(
    bundle,
    /acs-fill-sweep|\.acs-fill::after|\.acs-progress__fill::after/,
    'progress bars should only move by width, with no internal shimmer sweep'
  );
  assert.doesNotMatch(traceBlock, /querySelector\?\.\("algolia-chat"\)/);
  assert.doesNotMatch(traceBlock, /setTimeout\([^)]*--algolia-header-progress/);
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
});
