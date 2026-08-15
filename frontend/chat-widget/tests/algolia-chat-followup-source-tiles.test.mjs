import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const chatPath = new URL('../algolia-chat.js', import.meta.url);

function loadDiscoverySplitters() {
  const bundle = fs.readFileSync(chatPath, 'utf8');
  const start = bundle.indexOf('const Pn=');
  const end = bundle.indexOf('function kR', start);

  assert.notEqual(start, -1, 'discovery state helpers should exist');
  assert.notEqual(end, -1, 'discovery state helpers should have a stable boundary');

  return vm.runInNewContext(`${bundle.slice(start, end)};({ Xl, _R });`);
}

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

test('visible discovery follow-up question is split out of the answer body', () => {
  const { Xl, _R } = loadDiscoverySplitters();
  const followUp =
    'Are you planning a high-traffic launch where bot protection is the priority, or are you more focused on fine-tuning the UX to keep the monthly operation count lean?';
  const content = `Rate Limiting Advice:
If you are worried about costs spiking, create a dedicated Search API key.

${followUp}
<!--DISCOVERY_STATE {"probed_slot":"business_outcome","confirmed_slots":[],"inferred_slots":[],"suppressed_slots":[],"handoff_recommended":false,"handoff_specialist_key":null,"confidence":"medium","visible_followup_question":"${followUp}"} DISCOVERY_STATE-->`;

  const result = _R(
    { discoveryLedgerRef: { current: null } },
    { query: 'How should I configure rate limiting?' },
    { ledger: Xl(), turn: 1 },
    content
  );

  assert.equal(result.followUp, followUp);
  assert.doesNotMatch(result.text, /Are you planning a high-traffic launch/);
  assert.match(result.text, /Rate Limiting Advice:/);
});

test('trailing discovery-style question is split out even when marker metadata is absent', () => {
  const { Xl, _R } = loadDiscoverySplitters();
  const followUp =
    'Are you optimizing for bot protection first, or are you trying to keep search operations predictable during normal browsing?';
  const content = `Rate Limiting Advice:
Create a dedicated Search API key with maxQueriesPerIPPerHour restrictions and handle backend limits at the edge.

${followUp}`;

  const result = _R(
    { discoveryLedgerRef: { current: null } },
    { query: 'How should I configure rate limiting?' },
    { ledger: Xl(), turn: 1 },
    content
  );

  assert.equal(result.followUp, followUp);
  assert.doesNotMatch(result.text, /Are you optimizing for bot protection first/);
  assert.match(result.text, /Create a dedicated Search API key/);
});
