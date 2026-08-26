import { createHmac } from 'node:crypto';

const SECRET_NAME = /authorization|api[-_]?key|cookie|token|secret|password|credential/i;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const BEARER = /\bbearer\s+[a-z0-9._~+\/-]+=*/gi;
const ALGOLIA_KEY = /\b[a-f0-9]{32,64}\b/gi;

export function safeUrl(raw) {
  const url = new URL(raw);
  return `${url.origin}${url.pathname}`;
}

export function redactText(value) {
  return String(value)
    .replace(EMAIL, '[REDACTED_EMAIL]')
    .replace(BEARER, '[REDACTED_BEARER]')
    .replace(ALGOLIA_KEY, '[REDACTED_SECRET]');
}

export function allowlistedHeaders(headers = {}) {
  const safe = {};
  for (const [name, value] of Object.entries(headers)) {
    if (SECRET_NAME.test(name)) continue;
    const normalized = name.toLowerCase();
    if (!['content-type', 'content-length', 'retry-after', 'x-conversation-id', 'x-request-id'].includes(normalized)) continue;
    safe[normalized] = redactText(value);
  }
  return safe;
}

export function safeMetadata(value, { allowedKeys }) {
  const result = {};
  for (const key of allowedKeys) {
    if (!(key in value) || SECRET_NAME.test(key)) continue;
    const item = value[key];
    if (typeof item === 'string') result[key] = redactText(item);
    else if (typeof item === 'number' || typeof item === 'boolean' || item === null) result[key] = item;
  }
  return result;
}

export function runScopedDigest(secret, value) {
  if (!Buffer.isBuffer(secret) || secret.length < 16) throw new Error('Run-scoped HMAC secret is required');
  return createHmac('sha256', secret).update(String(value)).digest('hex');
}

export function containsSensitiveMaterial(serialized, seededSecrets = []) {
  const text = String(serialized);
  return seededSecrets.some((secret) => secret && text.includes(secret)) || EMAIL.test(text) || BEARER.test(text);
}
