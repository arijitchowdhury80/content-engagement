export class TurnLease {
  constructor({ id, epoch, release }) {
    this.id = id;
    this.epoch = epoch;
    this.released = false;
    this.releaseCallback = release;
    Object.seal(this);
  }

  release() {
    if (this.released) return false;
    this.released = true;
    this.releaseCallback(this);
    return true;
  }
}
