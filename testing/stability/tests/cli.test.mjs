import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { main } from '../cli.mjs';

const DATASET = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../datasets/reactive-conversations.v1.json');

test('CLI rejects unsupported commands before any hosted action exists', async () => {
  await assert.rejects(() => main(['run', '--stage', 'five-user']), /Unsupported command/);
});

test('CLI validates the frozen dataset', async () => {
  let output = '';
  const original = process.stdout.write;
  process.stdout.write = (chunk) => { output += chunk; return true; };
  try {
    assert.equal(await main(['validate-dataset', '--dataset', DATASET]), 0);
  } finally {
    process.stdout.write = original;
  }
  const result = JSON.parse(output);
  assert.equal(result.status, 'PASS');
  assert.equal(result.turnCount, 120);
});
