import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { validateContract } from '../src/contracts/validate.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('all versioned JSON schema files are valid and have unique IDs', () => {
  const files = fs.readdirSync(path.join(ROOT, 'contracts')).filter((name) => name.endsWith('.schema.json')).sort();
  assert.equal(files.length, 11);
  const ids = files.map((name) => {
    const schema = JSON.parse(fs.readFileSync(path.join(ROOT, 'contracts', name), 'utf8'));
    assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
    assert.equal(schema.type, 'object');
    assert.ok(Array.isArray(schema.required) && schema.required.length > 0);
    return schema.$id;
  });
  assert.equal(new Set(ids).size, ids.length);
});

test('contract validator rejects missing required fields', () => {
  assert.throws(() => validateContract({ schema: 'RunManifest.v1' }), /missing required field runId/);
});

test('contract validator rejects mixed or unknown fault origins', () => {
  const manifest = {
    schema: 'RunManifest.v1', runId: 'stab-test', createdAt: new Date().toISOString(), faultOrigin: 'MIXED',
    target: {}, runtime: {}, inputs: {}, execution: {}, thresholds: {}, trafficBudget: {}, evaluator: {}, host: {}, permissions: {}, hashes: {},
  };
  assert.throws(() => validateContract(manifest), /faultOrigin must be NATURAL or INJECTED/);
  manifest.faultOrigin = 'NATURAL';
  assert.equal(validateContract(manifest), true);
});

test('unsupported schema fails closed', () => {
  assert.throws(() => validateContract({ schema: 'FutureContract.v9' }), /Unsupported contract schema/);
});
