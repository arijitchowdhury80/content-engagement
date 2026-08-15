import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const chatPath = new URL('../algolia-chat.js', import.meta.url);

test('follow-up discovery question renders before source pills as an elevated tile', () => {
  const bundle = fs.readFileSync(chatPath, 'utf8');

  assert.match(
    bundle,
    /m&&w\.jsx\(e1,\{turnId:n,followUps:f,inputBlocked:p,onPickFollowUp:v\}\),g&&w\.jsx\(Jb,\{/,
    'the follow-up prompt should render immediately after the answer and before sources'
  );
  assert.match(
    bundle,
    /function e1\(\{turnId:t,followUps:n,inputBlocked:i,onPickFollowUp:a\}\)\{return w\.jsxs\("div",\{className:"acs-followup-wrap/,
    'follow-up section should use a dedicated visual wrapper'
  );
  assert.match(
    bundle,
    /className:"acs-followup-card group flex w-full/,
    'follow-up question should be a glassy raised question tile'
  );
  assert.match(
    bundle,
    /\.acs-followup-card\{[^}]*backdrop-filter:blur\(18px\)[^}]*box-shadow:0 18px 38px/,
    'follow-up tile CSS should create glass and 3D elevation'
  );
});

test('source pills use Algolia white-to-blue 3D glass treatment', () => {
  const bundle = fs.readFileSync(chatPath, 'utf8');

  assert.match(
    bundle,
    /const PS="acs-source-pill acs-source-pill--link inline-flex/,
    'linked source pills should use the source-pill visual class'
  );
  assert.match(
    bundle,
    /className:"acs-source-group-pill inline-flex shrink-0/,
    'source category pills should use the 3D group pill class'
  );
  assert.match(
    bundle,
    /\.acs-source-group-pill\{[^}]*linear-gradient\(135deg,#ffffff,#edf5ff\)[^}]*box-shadow:0 8px 18px/,
    'source category pills should have Algolia white-to-blue gradient fill and raised depth'
  );
  assert.match(
    bundle,
    /\.acs-source-pill\{[^}]*linear-gradient\(135deg,#ffffffcc,#edf5ffcc\)[^}]*backdrop-filter:blur\(14px\)/,
    'individual source pills should have a glassy white-to-blue treatment'
  );
});
