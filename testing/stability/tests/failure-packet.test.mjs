import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { writeFailurePacket } from '../src/report/failure-packet.mjs';

test('failure packets are atomically persisted and cannot overwrite prior evidence', (t) => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'algolia-stability-failure-'));
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const packet = { schema: 'FailurePacket.v1', failureId: 'failure-001', runValidity: 'VALID' };
  const destination = writeFailurePacket(path.join(parent, 'raw'), packet);
  assert.deepEqual(JSON.parse(fs.readFileSync(destination, 'utf8')), packet);
  assert.equal(fs.statSync(destination).mode & 0o777, 0o600);
  assert.throws(() => writeFailurePacket(path.join(parent, 'raw'), packet), /EEXIST/);
});
