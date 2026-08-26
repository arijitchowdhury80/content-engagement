import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  assertSafeRawRoot,
  ensureSafeRawRoot,
  retentionDeadline,
  writePrivateFile,
} from '../src/config/artifact-paths.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

test('raw evidence rejects relative, repository, synchronized, and filesystem-root paths', () => {
  assert.throws(() => assertSafeRawRoot('relative/run'), /absolute path/);
  assert.throws(() => assertSafeRawRoot(path.join(REPO, '.runtime', 'run')), /inside the repository/);
  assert.throws(() => assertSafeRawRoot('/Users/test/Dropbox/unsafe/run'), /synchronized root/);
  assert.throws(() => assertSafeRawRoot(path.parse(REPO).root), /Filesystem root/);
});

test('raw root and private files use owner-only permissions and block traversal', (t) => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'algolia-stability-path-test-'));
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const root = ensureSafeRawRoot(path.join(parent, 'run'));
  assert.equal(fs.statSync(root).mode & 0o777, 0o700);
  const output = writePrivateFile(root, 'events/one.json', '{}\n');
  assert.equal(fs.statSync(output).mode & 0o777, 0o600);
  assert.throws(() => writePrivateFile(root, '../escape.json', '{}'), /escapes/);
  assert.throws(() => writePrivateFile(root, 'events/one.json', '{}'), /EEXIST/);
});

test('raw root rejects an existing symlink', (t) => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'algolia-stability-symlink-test-'));
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const actual = path.join(parent, 'actual');
  const link = path.join(parent, 'linked');
  fs.mkdirSync(actual);
  fs.symlinkSync(actual, link);
  assert.throws(() => assertSafeRawRoot(link), /symbolic link/);
});

test('retention defaults to seven days and rejects unbounded retention', () => {
  assert.equal(retentionDeadline('2026-08-25T00:00:00.000Z'), '2026-09-01T00:00:00.000Z');
  assert.throws(() => retentionDeadline('2026-08-25T00:00:00.000Z', 31), /between 1 and 30 days/);
});
