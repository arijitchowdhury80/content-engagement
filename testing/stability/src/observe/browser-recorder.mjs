import { randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';

import { allowlistedHeaders, redactText, runScopedDigest, safeUrl } from './redaction.mjs';

function requestKind(url) {
  const pathname = new URL(url).pathname;
  if (/\/completions(?:\/|$)/.test(pathname)) return 'completion';
  if (/\/queries(?:\/|$)/.test(pathname)) return 'search';
  if (/\/conversations(?:\/|$)/.test(pathname)) return 'conversation';
  return 'asset-or-navigation';
}

function completionIdentity(request) {
  if (requestKind(request.url()) !== 'completion') return {};
  try {
    const body = request.postDataJSON();
    return {
      conversationId: typeof body?.id === 'string' ? body.id : null,
      messageIds: Array.isArray(body?.messages) ? body.messages.map((message) => message?.id).filter(Boolean) : [],
      messageRoles: Array.isArray(body?.messages) ? body.messages.map((message) => message?.role).filter(Boolean) : [],
    };
  } catch {
    return { conversationId: null, messageIds: [], messageRoles: [] };
  }
}

export function summarizeSse(body) {
  const eventTypes = {};
  const toolNames = new Set();
  const guardrailEvents = [];
  let textDeltaChars = 0;
  let malformedEvents = 0;
  for (const line of String(body ?? '').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) continue;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;
    try {
      const event = JSON.parse(payload);
      const type = typeof event?.type === 'string' ? event.type : 'unknown';
      eventTypes[type] = (eventTypes[type] ?? 0) + 1;
      if (type === 'text-delta' && typeof event.delta === 'string') textDeltaChars += event.delta.length;
      if (typeof event?.toolName === 'string') toolNames.add(redactText(event.toolName).slice(0, 80));
      if (type === 'data-guardrail-violation') {
        const data = event?.data && typeof event.data === 'object' ? event.data : {};
        guardrailEvents.push({
          eventKeys: Object.keys(event).sort().slice(0, 20),
          dataKeys: Object.keys(data).sort().slice(0, 20),
          category: typeof data.category === 'string' ? redactText(data.category).slice(0, 120) : null,
          type: typeof data.type === 'string' ? redactText(data.type).slice(0, 120) : null,
          reason: typeof data.reason === 'string' ? redactText(data.reason).slice(0, 120) : null,
        });
      }
    } catch {
      malformedEvents += 1;
    }
  }
  return {
    bodyBytes: Buffer.byteLength(String(body ?? ''), 'utf8'),
    eventTypes,
    textDeltaChars,
    malformedEvents,
    toolNames: [...toolNames].sort(),
    guardrailEvents,
  };
}

export class BrowserRecorder {
  constructor({ spool, identity, hmacSecret = randomBytes(32) }) {
    if (!spool?.append) throw new Error('Browser recorder requires an append-only spool');
    this.spool = spool;
    this.identity = Object.freeze({ ...identity });
    this.hmacSecret = hmacSecret;
    this.startedAt = performance.now();
    this.requestIds = new WeakMap();
    this.pending = new Set();
    this.asyncErrors = [];
  }

  track(task) {
    const guarded = Promise.resolve(task)
      .catch((error) => { this.asyncErrors.push(error); })
      .finally(() => { this.pending.delete(guarded); });
    this.pending.add(guarded);
  }

  async flush() {
    while (this.pending.size > 0) await Promise.allSettled([...this.pending]);
    if (this.asyncErrors.length > 0) {
      const errors = this.asyncErrors.splice(0);
      throw new AggregateError(errors, 'Browser recorder failed to persist asynchronous observations');
    }
  }

  event(source, type, classification, safePayload = {}) {
    return this.spool.append({
      schema: 'ObservationEvent.v1',
      at: new Date().toISOString(),
      monotonicMs: performance.now() - this.startedAt,
      ...this.identity,
      source,
      type,
      classification,
      safePayload,
    });
  }

  attach(context) {
    context.on('page', (page) => this.attachPage(page));
    context.on('request', (request) => {
      const id = runScopedDigest(this.hmacSecret, `${request.method()}\0${request.url()}\0${performance.now()}`);
      this.requestIds.set(request, id);
      this.event('network', 'request_started', requestKind(request.url()), {
        requestId: id,
        method: request.method(),
        url: safeUrl(request.url()),
        resourceType: request.resourceType(),
        ...completionIdentity(request),
      });
    });
    context.on('response', (response) => {
      this.track((async () => {
        const request = response.request();
        const classification = requestKind(response.url());
        let errorBody = null;
        if (classification === 'completion' && response.status() >= 400) {
          errorBody = redactText((await response.text().catch(() => '')).slice(0, 500));
        }
        this.event('network', 'response_received', classification, {
          requestId: this.requestIds.get(request) ?? null,
          status: response.status(),
          url: safeUrl(response.url()),
          headers: allowlistedHeaders(await response.allHeaders().catch(() => ({}))),
          errorBody: errorBody || null,
        });
        if (classification === 'completion' && response.status() < 400) {
          const body = await response.text().catch(() => null);
          this.event('sse', 'stream_summary', 'completion', body === null
            ? { bodyAvailable: false }
            : { bodyAvailable: true, ...summarizeSse(body) });
        }
      })());
    });
    context.on('requestfailed', (request) => {
      this.event('network', 'request_failed', requestKind(request.url()), {
        requestId: this.requestIds.get(request) ?? null,
        method: request.method(),
        url: safeUrl(request.url()),
        failure: request.failure()?.errorText?.slice(0, 120) ?? 'unknown',
      });
    });
    for (const page of context.pages()) this.attachPage(page);
  }

  attachPage(page) {
    if (page.__stabilityRecorderAttached) return;
    page.__stabilityRecorderAttached = true;
    page.on('console', (message) => {
      this.event('browser', 'console', message.type(), { type: message.type(), textLength: message.text().length });
    });
    page.on('pageerror', (error) => {
      this.event('browser', 'page_error', 'error', { name: error.name, messageLength: error.message.length });
    });
    page.on('crash', () => this.event('browser', 'page_crash', 'crash'));
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) this.event('browser', 'navigation', 'main-frame', { url: safeUrl(frame.url()) });
    });
  }
}
