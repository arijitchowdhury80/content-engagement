import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const sourcePath = new URL(
  '../../../backend/jahia-modules/algolia-token-telemetry/src/main/java/com/algolia/contentengagement/tokentelemetry/TokenTelemetryAction.java',
  import.meta.url,
);

/*
 * Scenario inventory:
 * - Browser callers cannot select appId or agentId.
 * - The action accepts POST only and enforces the configured Jahia origin.
 * - Secrets cannot be baked into the bundle.
 * - Successful responses contain token totals only, never raw conversations.
 * - Conversation ids use an allowlist and length bound.
 */
test('Jahia telemetry action is a fixed-target token-only proxy', () => {
  const source = fs.readFileSync(sourcePath, 'utf8');

  assert.equal(source.includes('singleParam(parameters, "appId")'), false);
  assert.equal(source.includes('singleParam(parameters, "agentId")'), false);
  assert.match(source, /setRequiredMethods\("POST"\)/);
  assert.equal(source.includes('ALLOWED_ORIGIN = "*"'), false);
  assert.equal(source.includes('BAKED_PROPERTIES_RESOURCE'), false);
  assert.equal(source.includes('return new ActionResult(status, null, json)'), false);
  assert.match(source, /inputTokens/);
  assert.match(source, /outputTokens/);
  assert.match(source, /totalTokens/);
  assert.match(source, /CONVERSATION_ID_MAX_LENGTH/);
});
