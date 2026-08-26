export class PhysicalRequestBudget {
  constructor({ stageCeiling, roleCeilings }) {
    if (!Number.isSafeInteger(stageCeiling) || stageCeiling < 1) throw new Error('stageCeiling must be positive');
    this.stageCeiling = stageCeiling;
    this.roleCeilings = Object.freeze({ ...roleCeilings });
    this.stageUsed = 0;
    this.roleUsed = new Map();
  }

  reserve(role, count = 1) {
    if (!Number.isSafeInteger(count) || count < 1) throw new Error('Reservation count must be positive');
    const roleCeiling = this.roleCeilings[role];
    if (!Number.isSafeInteger(roleCeiling)) throw new Error(`Unknown request role: ${role}`);
    const roleUsed = this.roleUsed.get(role) ?? 0;
    if (roleUsed + count > roleCeiling) throw new Error(`Physical request ceiling exceeded for ${role}`);
    if (this.stageUsed + count > this.stageCeiling) throw new Error('Stage physical request ceiling exceeded');
    this.roleUsed.set(role, roleUsed + count);
    this.stageUsed += count;
    return Object.freeze({ role, count, stageUsed: this.stageUsed, roleUsed: roleUsed + count });
  }

  snapshot() {
    return { stageCeiling: this.stageCeiling, stageUsed: this.stageUsed, roles: Object.fromEntries(this.roleUsed) };
  }
}
