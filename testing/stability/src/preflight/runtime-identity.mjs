import { createHash } from 'node:crypto';

import { TARGET } from '../config/constants.mjs';
import { fetchPublicJahiaIdentity } from './jahia-identity.mjs';
import { readBrowserIdentity, validateBrowserIdentity } from './browser-identity.mjs';
import { fetchAgentStudioIdentity } from './agent-studio-identity.mjs';

async function assetIdentity(urls, fetchImpl) {
  const candidates = [...new Set(urls)].filter((url) => {
    const parsed = new URL(url);
    return parsed.origin === TARGET.origin && /\/files\/live\/sites\/www\/files\/.*(?:algolia|handoff)/i.test(parsed.pathname);
  });
  const assets = [];
  for (const url of candidates) {
    const parsed = new URL(url);
    const response = await fetchImpl(url, { headers: { 'cache-control': 'no-cache' } });
    if (!response.ok) throw new Error(`Asset identity read failed for ${parsed.pathname}: HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    assets.push({
      url: parsed.origin + parsed.pathname,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      bytes: bytes.length,
    });
  }
  return assets;
}

export async function inspectRuntimeIdentity({ fetchAgent, fetchImpl = fetch, browserType } = {}) {
  const [jahia, browserRaw, agentStudio] = await Promise.all([
    fetchPublicJahiaIdentity({ fetchImpl }),
    readBrowserIdentity({ browserType }),
    fetchAgentStudioIdentity({ fetchAgent }),
  ]);
  const browser = validateBrowserIdentity(browserRaw);
  const identity = {
    schema: 'RuntimeIdentity.v1',
    origin: TARGET.origin,
    jahia,
    browser: { ...browser, identity: { ...browserRaw, loadedScripts: undefined } },
    agentStudio,
    assets: await assetIdentity(browserRaw.loadedScripts, fetchImpl),
    checkedAt: new Date().toISOString(),
  };
  return { ...identity, pass: jahia.vanillaOnly && jahia.confidenceModeAttributeAbsent && browser.pass && agentStudio.pass };
}
