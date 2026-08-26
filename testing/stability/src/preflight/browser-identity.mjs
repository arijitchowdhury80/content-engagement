import { chromium } from 'playwright';

import { TARGET } from '../config/constants.mjs';

export async function readBrowserIdentity({ browserType = chromium, origin = TARGET.origin } = {}) {
  const browser = await browserType.launch({ headless: true });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`${origin}/?stability_identity=${Date.now().toString(36)}`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('algolia-chat', { state: 'attached', timeout: 15_000 });
    return await page.locator('algolia-chat').evaluate((element) => ({
      count: document.querySelectorAll('algolia-chat').length,
      credentialOwner: element.closest('algolia-instant-search')?.tagName.toLowerCase() ?? 'algolia-chat',
      appId: (element.closest('algolia-instant-search') ?? element).getAttribute('app-id'),
      indexName: (element.closest('algolia-instant-search') ?? element).getAttribute('index-name'),
      confidenceCount: document.querySelectorAll('algolia-chat-confidence').length,
      confidenceMode: document.querySelector('algolia-chat-confidence')?.getAttribute('mode'),
      agentIds: [...element.querySelectorAll('algolia-agent[agent-id]')].map((agent) => ({
        role: agent.getAttribute('role') || agent.getAttribute('key') || 'unknown',
        id: agent.getAttribute('agent-id'),
      })),
      loadedScripts: [...document.scripts].map((script) => script.src).filter(Boolean),
    }));
  } finally {
    await browser.close();
  }
}

export function validateBrowserIdentity(identity) {
  const errors = [];
  if (identity.count !== 1) errors.push(`expected one algolia-chat element; found ${identity.count}`);
  if (identity.appId !== TARGET.appId) errors.push(`unexpected app ${identity.appId}`);
  if (identity.indexName !== TARGET.indexName) errors.push(`unexpected index ${identity.indexName}`);
  if (identity.confidenceCount !== 1) errors.push(`expected one algolia-chat-confidence element; found ${identity.confidenceCount}`);
  if (identity.confidenceMode !== 'algolia') errors.push(`single-panel browser confidence mode must be algolia; found ${identity.confidenceMode}`);
  return { pass: errors.length === 0, errors, identity };
}
