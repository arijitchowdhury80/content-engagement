import assert from 'node:assert/strict';
import test from 'node:test';

import { PhysicalRequestBudget } from '../src/scheduler/rate-budget.mjs';
import { RunSupervisor } from '../src/scheduler/supervisor.mjs';

function memoryJournal() {
  const records = [];
  return { records, append(record) { records.push(structuredClone(record)); return record; } };
}

test('supervisor issues epoch-bound leases only while running', () => {
  const journal = memoryJournal();
  const budget = new PhysicalRequestBudget({ stageCeiling: 4, roleCeilings: { primary: 4 } });
  const supervisor = new RunSupervisor({ journal, budget });
  supervisor.transition('READY');
  supervisor.transition('RUNNING');
  const lease = supervisor.issueLease({ turnId: 'turn-1' });
  assert.equal(supervisor.snapshot().leasesActive, 1);
  assert.equal(lease.epoch, 1);
  assert.equal(lease.release(), true);
  assert.equal(lease.release(), false);
  assert.equal(supervisor.snapshot().leasesActive, 0);
});

test('abort journals before latching and prevents every later lease', () => {
  const journal = memoryJournal();
  const supervisor = new RunSupervisor({
    journal,
    budget: new PhysicalRequestBudget({ stageCeiling: 10, roleCeilings: { primary: 10 } }),
  });
  supervisor.transition('READY');
  supervisor.transition('RUNNING');
  supervisor.issueLease({ turnId: 'turn-before-abort' });
  assert.equal(supervisor.abort('cross-user-leakage'), true);
  assert.equal(journal.records.at(-1).type, 'abort_triggered');
  assert.equal(supervisor.snapshot().state, 'ABORTING');
  assert.equal(supervisor.snapshot().abortLatched, true);
  assert.throws(() => supervisor.issueLease({ turnId: 'turn-after-abort' }), /not accepting/);
});

test('physical budget fails before dispatch at role or stage ceiling', () => {
  const budget = new PhysicalRequestBudget({ stageCeiling: 3, roleCeilings: { primary: 2, judge: 2 } });
  budget.reserve('primary', 2);
  assert.throws(() => budget.reserve('primary'), /for primary/);
  budget.reserve('judge');
  assert.throws(() => budget.reserve('judge'), /Stage physical request ceiling/);
});
