import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';

import { allowlistedHeaders, containsSensitiveMaterial, redactText, runScopedDigest, safeMetadata, safeUrl } from '../src/observe/redaction.mjs';

test('redaction removes credentials, query strings, bearer values, and email addresses', () => {
  const key = '0123456789abcdef0123456789abcdef'; // gitleaks:allow -- deterministic fake test value
  const headers = allowlistedHeaders({
    authorization: `Bearer ${key}`,
    'x-algolia-api-key': key,
    cookie: 'session=secret',
    'content-type': 'application/json',
    'x-request-id': `request-${key}`,
  });
  assert.deepEqual(headers, { 'content-type': 'application/json', 'x-request-id': 'request-[REDACTED_SECRET]' });
  assert.equal(safeUrl('https://example.test/path?token=secret#fragment'), 'https://example.test/path');
  assert.equal(redactText('write to alice@example.com'), 'write to [REDACTED_EMAIL]');
  assert.equal(containsSensitiveMaterial(JSON.stringify(headers), [key, 'session=secret']), false);
});

test('metadata is allowlisted rather than recursively dumping unknown input', () => {
  const safe = safeMetadata({ status: 429, token: 'secret', message: 'user@example.com', rawBody: 'private' }, {
    allowedKeys: ['status', 'message', 'rawBody', 'token'],
  });
  assert.equal(safe.status, 429);
  assert.equal(safe.message, '[REDACTED_EMAIL]');
  assert.equal('token' in safe, false);
  assert.equal(safe.rawBody, 'private');
});

test('run-scoped HMACs are stable within a run and unlinkable across runs', () => {
  const first = randomBytes(32);
  const second = randomBytes(32);
  assert.equal(runScopedDigest(first, 'same value'), runScopedDigest(first, 'same value'));
  assert.notEqual(runScopedDigest(first, 'same value'), runScopedDigest(second, 'same value'));
});
