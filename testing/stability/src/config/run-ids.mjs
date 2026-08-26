import { createHmac, randomBytes } from 'node:crypto';

const SAFE_ID = /^[a-z0-9][a-z0-9-]{15,127}$/;

function utcStamp(date) {
  return date.toISOString().replace(/[-:.]/g, '').replace(/\.\d{3}Z$/, 'Z').toLowerCase();
}

export function createRunId({ now = new Date(), random = randomBytes } = {}) {
  const suffix = random(16).toString('hex');
  const id = `stab-${utcStamp(now)}-${suffix}`;
  if (!SAFE_ID.test(id)) throw new Error('Generated run ID violates the safe identifier contract');
  return id;
}

export function deriveSafeId(parentId, role, ordinal, secret) {
  if (!SAFE_ID.test(parentId)) throw new Error('Parent ID violates the safe identifier contract');
  if (!/^[a-z][a-z0-9-]{1,31}$/.test(role)) throw new Error('Role is not a safe identifier');
  if (!Number.isSafeInteger(ordinal) || ordinal < 0) throw new Error('Ordinal must be non-negative');
  if (!Buffer.isBuffer(secret) || secret.length < 16) throw new Error('A run-scoped secret is required');
  const digest = createHmac('sha256', secret).update(`${parentId}\0${role}\0${ordinal}`).digest('hex').slice(0, 24);
  return `${parentId.slice(0, 48)}-${role}-${ordinal}-${digest}`;
}

export function isSafeSyntheticId(value) {
  return typeof value === 'string' && SAFE_ID.test(value);
}
