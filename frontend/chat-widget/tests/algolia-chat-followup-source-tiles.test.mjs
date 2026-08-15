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

test('follow-up discovery question renders after source pills as a borderless raised prompt', () => {
  const bundle = fs.readFileSync(chatPath, 'utf8');

  assert.match(
    bundle,
    /g&&w\.jsx\(Jb,\{[\s\S]*?\}\),m&&w\.jsx\(e1,\{turnId:n,followUps:f,inputBlocked:p,onPickFollowUp:v\}\)/,
    'the follow-up prompt should render after sources and grounding controls'
  );
  assert.match(
    bundle,
    /function e1\(\{turnId:t,followUps:n,inputBlocked:i,onPickFollowUp:a\}\)\{return w\.jsxs\("div",\{className:"acs-followup-wrap flex flex-col gap-2 pt-6"/,
    'follow-up section should use a dedicated visual wrapper'
  );
  assert.match(
    bundle,
    /className:"acs-followup-card group flex w-full/,
    'follow-up question should be a glassy raised question tile'
  );
  assert.match(
    bundle,
    /\.acs-followup-wrap\{[^}]*width:100%[^}]*margin-top:24px[^}]*padding-top:20px[^}]*border-top:1px solid color-mix\(in srgb,var\(--algolia-accent\) 18%,var\(--algolia-border\)\)[^}]*\}\.acs-followup-card\{[^}]*border:0[^}]*linear-gradient\(135deg,#ffffff,#edf5ff[^}]*backdrop-filter:blur\(16px\)[^}]*box-shadow:0 12px 26px/,
    'follow-up prompt should share the source-pill glass language without a visible border'
  );
  assert.doesNotMatch(
    bundle,
    /acs-followup-icon|J\.strings\.discovery\.eyebrow/,
    'follow-up prompt should not render the old icon or eyebrow label'
  );
});

test('answer markdown has breathing room between sections', () => {
  const bundle = fs.readFileSync(chatPath, 'utf8');

  assert.match(
    bundle,
    /function bS\(\{text:t,unsupportedTerms:n=\[\]\}\)[\s\S]*?className:"flex flex-col gap-3"/,
    'answer block should not stack every markdown run with the old tight gap'
  );
  assert.match(
    bundle,
    /function fS\(t,n,i,a,l=!1\)\{const u=ig\.exec\(t\),f=u\?u\[2\]:t,d=l\?"mt-7":"mt-1"/,
    'headings after the opening answer should create a new visual section'
  );
  assert.match(
    bundle,
    /function hS\(t,n,i,a,l=!1\).*space-y-4/s,
    'lists should breathe more between bullets'
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
    /\.acs-source-section\{[^}]*width:100%[^}]*margin-top:22px[^}]*padding-top:18px[^}]*border-top:1px solid color-mix\(in srgb,var\(--algolia-accent\) 18%,var\(--algolia-border\)\)[^}]*\}\.acs-source-group-pill\{[^}]*linear-gradient\(135deg,#ffffff,#edf5ff\)[^}]*box-shadow:0 8px 18px/,
    'source section should be separated from the answer before the raised source pills'
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

test('contextual trailing discovery question is split out of the answer body', () => {
  const { Xl, _R } = loadDiscoverySplitters();
  const followUp =
    "Since you're looking at this from a cost and configuration angle, are you currently seeing unexplained spikes in your logs, or are you mapping out the projected costs for a new high-traffic launch?";
  const content = `The Tradeoff: High responsiveness (request-per-keystroke) increases conversion by making the site feel "instant," but it increases the operation count.
Most teams find the sweet spot by debouncing at 100-300ms.

${followUp}`;

  const result = _R(
    { discoveryLedgerRef: { current: null } },
    { query: 'What counts as an API call?' },
    { ledger: Xl(), turn: 1 },
    content
  );

  assert.equal(result.followUp, followUp);
  assert.doesNotMatch(result.text, /Since you're looking at this from a cost and configuration angle/);
  assert.match(result.text, /The Tradeoff:/);
});
