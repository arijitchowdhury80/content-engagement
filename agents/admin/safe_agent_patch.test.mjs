import assert from 'node:assert/strict';
import test from 'node:test';

import { applyPatchWithRecovery } from './safe_agent_patch.mjs';

function classifier(state) {
  return {
    state: state.target === 'before' && state.protected === 'stable'
      ? 'before'
      : state.target === 'intended' && state.protected === 'stable'
        ? 'intended'
        : 'drift',
    details: { ...state },
  };
}

function injectedClient({ initial = { target: 'before', protected: 'stable' }, patchMode = 'success' } = {}) {
  let state = { ...initial };
  const calls = [];
  return {
    calls,
    drift(next) { state = { ...next }; },
    async read() { calls.push('read'); return { ...state }; },
    async patch(payload) {
      calls.push(`patch:${payload.target}`);
      state = { ...state, target: payload.target };
      if (payload.target === 'intended' && patchMode === 'ambiguous') {
        throw new Error('connection closed after server accepted PATCH');
      }
      if (payload.target === 'intended' && patchMode === 'failed-before') {
        state = { target: 'before', protected: 'stable' };
        throw new Error('server rejected PATCH');
      }
    },
  };
}

test('returns the exact intended readback after a successful injected PATCH', async () => {
  const client = injectedClient();
  const after = await applyPatchWithRecovery({
    read: client.read,
    patch: client.patch,
    classify: classifier,
    intendedPayload: { target: 'intended' },
  });
  assert.deepEqual(after, { target: 'intended', protected: 'stable' });
  assert.deepEqual(client.calls, ['patch:intended', 'read']);
});

test('accepts an idempotent before-and-intended state without rollback', async () => {
  const client = injectedClient({ initial: { target: 'same', protected: 'stable' } });
  client.patch = async () => { client.calls.push('patch:same'); };
  const after = await applyPatchWithRecovery({
    read: client.read,
    patch: client.patch,
    classify: (state) => ({ state: state.target === 'same' ? 'equivalent' : 'drift', details: state }),
    intendedPayload: { target: 'same' },
  });
  assert.deepEqual(after, { target: 'same', protected: 'stable' });
  assert.deepEqual(client.calls, ['patch:same', 'read']);
});

test('an ambiguous successful PATCH records intended state without an unsafe rollback', async () => {
  const client = injectedClient({ patchMode: 'ambiguous' });
  const evidence = [];
  await assert.rejects(() => applyPatchWithRecovery({
    read: client.read,
    patch: client.patch,
    classify: classifier,
    intendedPayload: { target: 'intended' },
    recordRecovery: (entry) => evidence.push(entry),
  }), /automatic rollback is disabled/);
  assert.deepEqual(client.calls, ['patch:intended', 'read']);
  assert.equal(evidence.at(-1).state, 'intended-manual-recovery-required');
});

test('a rejected PATCH with exact-before readback is a no-op', async () => {
  const client = injectedClient({ patchMode: 'failed-before' });
  const evidence = [];
  await assert.rejects(() => applyPatchWithRecovery({
    read: client.read,
    patch: client.patch,
    classify: classifier,
    intendedPayload: { target: 'intended' },
    recordRecovery: (entry) => evidence.push(entry),
  }), /no rollback required/);
  assert.deepEqual(client.calls, ['patch:intended', 'read']);
  assert.equal(evidence.at(-1).state, 'before-noop');
});

test('post-PATCH protected-field drift refuses rollback', async () => {
  const client = injectedClient();
  const evidence = [];
  client.patch = async (payload) => {
    client.calls.push(`patch:${payload.target}`);
    client.drift({ target: payload.target, protected: 'concurrent-change' });
    throw new Error('ambiguous PATCH response');
  };
  await assert.rejects(() => applyPatchWithRecovery({
    read: client.read,
    patch: client.patch,
    classify: classifier,
    intendedPayload: { target: 'intended' },
    recordRecovery: (entry) => evidence.push(entry),
  }), /refusing to overwrite concurrent changes/);
  assert.deepEqual(client.calls, ['patch:intended', 'read']);
  assert.equal(evidence.at(-1).state, 'drift-refused');
});
