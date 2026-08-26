import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';

import { createRunId, deriveSafeId, isSafeSyntheticId } from '../src/config/run-ids.mjs';
import { assertCanonicalTarget, TARGET } from '../src/config/constants.mjs';

test('run IDs are high entropy, safe, and data free', () => {
  const ids = new Set(Array.from({ length: 1000 }, () => createRunId()));
  assert.equal(ids.size, 1000);
  for (const id of ids) {
    assert.equal(isSafeSyntheticId(id), true);
    assert.doesNotMatch(id, /@|\/|\\|\s/);
  }
});

test('derived IDs are deterministic within one run and role-separated', () => {
  const parent = createRunId({ now: new Date('2026-08-25T12:00:00.000Z'), random: () => Buffer.alloc(16, 7) });
  const secret = randomBytes(32);
  const first = deriveSafeId(parent, 'primary', 1, secret);
  assert.equal(first, deriveSafeId(parent, 'primary', 1, secret));
  assert.notEqual(first, deriveSafeId(parent, 'judge', 1, secret));
  assert.equal(isSafeSyntheticId(first), true);
});

test('canonical target admits only the Jahia development surface and Vanilla', () => {
  const valid = assertCanonicalTarget({
    origin: TARGET.origin,
    appId: TARGET.appId,
    primaryAgentName: TARGET.primaryAgentName,
    indexName: TARGET.indexName,
  });
  assert.equal(valid.indexName, 'Algolia_Prod_Copy_Vanilla');
  assert.throws(() => assertCanonicalTarget({ ...valid, indexName: 'Algolia_Prod_Copy_Enhanced' }), /Only Algolia_Prod_Copy_Vanilla/);
  assert.throws(() => assertCanonicalTarget({ ...valid, origin: 'https://www.algolia.com' }), /not allowlisted/);
  assert.throws(() => assertCanonicalTarget({ ...valid, appId: 'PRODUCTION' }), /Unexpected Algolia app/);
});
