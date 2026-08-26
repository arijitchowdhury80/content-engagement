import { TurnLease } from './turn-lease.mjs';

const TRANSITIONS = Object.freeze({
  PREFLIGHT: ['READY'],
  READY: ['RUNNING'],
  RUNNING: ['ABORTING', 'COMPLETE'],
  ABORTING: ['DRAINING'],
  DRAINING: ['RECOVERY'],
  RECOVERY: ['COMPLETE'],
  COMPLETE: [],
});

export class RunSupervisor {
  constructor({ journal, budget }) {
    if (!journal?.append) throw new Error('Supervisor requires a synchronous journal');
    this.journal = journal;
    this.budget = budget;
    this.state = 'PREFLIGHT';
    this.epoch = 1;
    this.abortLatched = false;
    this.leasesIssued = 0;
    this.activeLeases = new Map();
  }

  transition(next, detail = {}) {
    if (!TRANSITIONS[this.state].includes(next)) throw new Error(`Invalid supervisor transition ${this.state} -> ${next}`);
    const previous = this.state;
    this.state = next;
    this.journal.append({ type: 'state_transition', previous, next, epoch: this.epoch, detail });
  }

  issueLease({ turnId, role = 'primary', physicalReservation = 1 }) {
    if (this.state !== 'RUNNING' || this.abortLatched) throw new Error('Supervisor is not accepting turn leases');
    this.budget?.reserve(role, physicalReservation);
    const id = `${this.epoch}:${++this.leasesIssued}:${turnId}`;
    const lease = new TurnLease({ id, epoch: this.epoch, release: (released) => this.activeLeases.delete(released.id) });
    this.activeLeases.set(id, lease);
    this.journal.append({ type: 'lease_issued', id, epoch: this.epoch, turnId, role, physicalReservation });
    return lease;
  }

  abort(reason) {
    if (this.abortLatched) return false;
    if (this.state !== 'RUNNING') throw new Error('Only a running supervisor can abort');
    this.journal.append({ type: 'abort_triggered', reason, epoch: this.epoch, activeLeases: this.activeLeases.size });
    this.abortLatched = true;
    this.state = 'ABORTING';
    this.epoch += 1;
    return true;
  }

  snapshot() {
    return Object.freeze({
      schema: 'SupervisorState.v1', state: this.state, epoch: this.epoch, abortLatched: this.abortLatched,
      leasesIssued: this.leasesIssued, leasesActive: this.activeLeases.size,
    });
  }
}
