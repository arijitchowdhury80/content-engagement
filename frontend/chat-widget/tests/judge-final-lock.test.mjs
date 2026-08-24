import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../../..');
const readJson = async (path) => JSON.parse(await readFile(resolve(root, path), 'utf8'));

test('final judge files and immutable OpenAI agents remain explicitly locked', async () => {
  const lock = await readJson('config/judge-final-lock.json');
  const config = await readJson('production_comparison/config.json');

  assert.equal(lock.status, 'locked');
  assert.match(lock.changePolicy, /explicit approval/);
  assert.equal(lock.provider.name, 'OpenAI');
  assert.equal(lock.provider.model, 'gpt-5.4-mini');
  assert.deepEqual(config.judges.agents, lock.agents);

  for (const [path, expected] of Object.entries(lock.protectedFileSha256)) {
    const actual = createHash('sha256').update(await readFile(resolve(root, path))).digest('hex');
    assert.equal(actual, expected, `${path} changed without updating the explicit judge lock`);
  }
});
