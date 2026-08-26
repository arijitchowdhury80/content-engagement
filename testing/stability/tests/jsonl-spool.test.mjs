import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { AppendOnlyJsonlSpool, readSpool } from '../src/observe/jsonl-spool.mjs';

test('spool fsyncs ordered append-only evidence that survives writer close', (t) => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'algolia-stability-spool-'));
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const spool = new AppendOnlyJsonlSpool(path.join(parent, 'raw'), 'worker/events.jsonl');
  spool.append({ type: 'first' });
  spool.append({ type: 'failure-before-worker-exit' });
  const filePath = spool.path;
  spool.close();
  assert.deepEqual(readSpool(filePath).map(({ sequence, type }) => ({ sequence, type })), [
    { sequence: 1, type: 'first' },
    { sequence: 2, type: 'failure-before-worker-exit' },
  ]);
  assert.equal(fs.statSync(filePath).mode & 0o777, 0o600);
  assert.throws(() => new AppendOnlyJsonlSpool(path.join(parent, 'raw'), 'worker/events.jsonl'), /EEXIST/);
});
