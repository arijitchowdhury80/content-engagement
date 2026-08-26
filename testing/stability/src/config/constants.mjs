import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const STABILITY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const REPOSITORY_ROOT = path.resolve(STABILITY_ROOT, '../..');

export const TARGET = Object.freeze({
  origin: 'https://tmp-content-eng-algolia.cloud.jahia.com',
  appId: '0EXRPAXB56',
  primaryAgentId: 'e2c8596a-4420-41d2-80bb-5cd4aaeffda6',
  productionAskAppId: '1QDAWL72TQ',
  primaryAgentName: 'www Chat - Orchestrator',
  indexName: 'Algolia_Prod_Copy_Vanilla',
  jahiaBlockPath: '/sites/www/home/drift/custom-code-block',
});

export const PROHIBITED_TARGET_PATTERNS = Object.freeze([
  /ask[.-]?algolia/i,
  /production[.-]?ask/i,
  /algolia\.com$/i,
  /www\.algolia\.com$/i,
]);

export function assertCanonicalTarget(identity) {
  if (!identity || typeof identity !== 'object') throw new Error('Target identity is required');
  const origin = new URL(identity.origin).origin;
  if (origin !== TARGET.origin) throw new Error(`Hosted target is not allowlisted: ${origin}`);
  if (PROHIBITED_TARGET_PATTERNS.some((pattern) => pattern.test(new URL(origin).hostname))) {
    throw new Error(`Production target is prohibited: ${origin}`);
  }
  if (identity.appId !== TARGET.appId) throw new Error(`Unexpected Algolia app: ${identity.appId}`);
  if (identity.primaryAgentName !== TARGET.primaryAgentName) {
    throw new Error(`Unexpected primary agent: ${identity.primaryAgentName}`);
  }
  if (identity.indexName !== TARGET.indexName) {
    throw new Error(`Only ${TARGET.indexName} is permitted; received ${identity.indexName}`);
  }
  return Object.freeze({ ...identity, origin });
}
