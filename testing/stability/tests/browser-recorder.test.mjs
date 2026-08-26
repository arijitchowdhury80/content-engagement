import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { chromium } from 'playwright';

import { startFixtureServer } from '../src/fixture/server.mjs';
import { BrowserRecorder, summarizeSse } from '../src/observe/browser-recorder.mjs';
import { AppendOnlyJsonlSpool, readSpool } from '../src/observe/jsonl-spool.mjs';

test('browser recorder captures safe request lifecycle without bodies or query secrets', async (t) => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'algolia-stability-recorder-'));
  const fixture = await startFixtureServer();
  const browser = await chromium.launch({ headless: true });
  t.after(async () => { await browser.close(); await fixture.close(); fs.rmSync(parent, { recursive: true, force: true }); });
  const spool = new AppendOnlyJsonlSpool(path.join(parent, 'raw'), 'browser/events.jsonl');
  const context = await browser.newContext();
  const recorder = new BrowserRecorder({
    spool,
    identity: {
      runId: 'stab-recorder-test', stageId: 'fixture', hostId: 'host-1', browserContextId: 'context-1',
      personaId: 'u1', conversationId: null, turnId: 'turn-1', attemptId: null,
    },
  });
  recorder.attach(context);
  const page = await context.newPage();
  await page.goto(`${fixture.origin}/?token=SHOULD_NOT_APPEAR`);
  await page.click('#submit');
  await page.waitForSelector('#status[data-terminal="true"]');
  await recorder.flush();
  await context.close();
  spool.close();
  const serialized = fs.readFileSync(spool.path, 'utf8');
  const events = readSpool(spool.path);
  assert.doesNotMatch(serialized, /SHOULD_NOT_APPEAR/);
  assert.doesNotMatch(serialized, /Fixture answer/);
  assert.ok(events.some((event) => event.type === 'request_started' && event.classification === 'completion'));
  assert.ok(events.some((event) => event.type === 'response_received' && event.safePayload.status === 200));
  assert.deepEqual(events.map((event) => event.sequence), events.map((_, index) => index + 1));
});

test('SSE summaries retain event structure but never answer text', () => {
  const summary = summarizeSse([
    'data: {"type":"start","messageId":"alg_msg_test"}',
    'data: {"type":"text-delta","delta":"sensitive answer"}',
    'data: {"type":"tool-input-available","toolName":"ask_specialist"}',
    'data: {"type":"finish","messageId":"alg_msg_test"}',
  ].join('\n'));
  assert.equal(summary.textDeltaChars, 16);
  assert.deepEqual(summary.eventTypes, { start: 1, 'text-delta': 1, 'tool-input-available': 1, finish: 1 });
  assert.deepEqual(summary.toolNames, ['ask_specialist']);
  assert.doesNotMatch(JSON.stringify(summary), /sensitive answer/);
});
