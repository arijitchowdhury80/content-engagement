import { createHash } from 'node:crypto';

import { TARGET } from '../config/constants.mjs';

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function extractChatIndex(html) {
  if (typeof html !== 'string') throw new Error('Jahia HTML must be a string');
  const tags = [...html.matchAll(/<(?:algolia-chat|algolia-instant-search)(?=[\s>])[^>]*>/gi)].map((match) => match[0]);
  const owners = tags.flatMap((tag) => [...tag.matchAll(/\bindex-name\s*=\s*(["'])(.*?)\1/gi)]);
  if (owners.length !== 1) throw new Error(`Expected exactly one credential-owning index-name attribute; found ${owners.length}`);
  return owners[0][2];
}

export function extractConfidenceMode(html) {
  if (typeof html !== 'string') throw new Error('Jahia HTML must be a string');
  const tags = [...html.matchAll(/<algolia-chat-confidence(?=[\s>])[^>]*>/gi)].map((match) => match[0]);
  if (tags.length !== 1) throw new Error(`Expected exactly one algolia-chat-confidence element; found ${tags.length}`);
  const modes = [...tags[0].matchAll(/\bmode\s*=\s*(["'])(.*?)\1/gi)];
  if (modes.length > 1) throw new Error(`Expected at most one confidence mode attribute; found ${modes.length}`);
  return modes.length === 0 ? null : modes[0][2].toLowerCase();
}

export function inspectJahiaHtml(html, surface) {
  const indexName = extractChatIndex(html);
  const confidenceMode = extractConfidenceMode(html);
  return Object.freeze({
    surface,
    htmlSha256: sha256(html),
    htmlBytes: Buffer.byteLength(html),
    indexName,
    confidenceMode,
    vanillaOnly: indexName === TARGET.indexName && !html.includes('Algolia_Prod_Copy_Enhanced'),
    confidenceModeAttributeAbsent: confidenceMode === null,
  });
}

export async function fetchPublicJahiaIdentity({ fetchImpl = fetch, cacheBust = Date.now().toString(36) } = {}) {
  const url = `${TARGET.origin}/?stability_identity=${encodeURIComponent(cacheBust)}`;
  const response = await fetchImpl(url, { headers: { 'cache-control': 'no-cache' } });
  if (!response.ok) throw new Error(`Public Jahia identity read failed with HTTP ${response.status}`);
  const html = await response.text();
  return inspectJahiaHtml(html, 'public-html');
}
