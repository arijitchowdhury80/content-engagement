import fs from 'node:fs';
import path from 'node:path';

import { REPOSITORY_ROOT, TARGET } from '../config/constants.mjs';

export function loadDeploymentManifest(manifestPath = path.join(REPOSITORY_ROOT, 'config/deployments/algolia-chat-stack.json')) {
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
}

function allIndexNames(tools) {
  return (tools ?? []).flatMap((tool) => (tool.indices ?? []).map((index) => index.index).filter(Boolean));
}

export function inspectAgent(agent, expected, { requireNamedSearchTool = false } = {}) {
  const errors = [];
  const warnings = [];
  if (agent.id && agent.id !== expected.agentId) errors.push(`agent ID mismatch for ${expected.name}`);
  if (agent.name !== expected.name) warnings.push(`agent name metadata differs: expected ${expected.name}; received ${agent.name}`);
  const tools = agent.tools ?? [];
  const indices = allIndexNames(tools);
  const nonVanilla = indices.filter((name) => name !== TARGET.indexName);
  if (nonVanilla.length) errors.push(`non-Vanilla indices: ${nonVanilla.join(', ')}`);
  if (requireNamedSearchTool) {
    const named = tools.filter((tool) => tool.name === expected.searchToolPatch.toolName);
    if (named.length !== 1) errors.push(`expected exactly one ${expected.searchToolPatch.toolName} tool; found ${named.length}`);
    const matching = named.flatMap((tool) => tool.indices ?? []).filter((index) => index.index === TARGET.indexName);
    if (matching.length !== 1) errors.push(`expected exactly one ${TARGET.indexName} index in orchestrator Search tool; found ${matching.length}`);
  }
  return {
    agentId: expected.agentId,
    expectedName: expected.name,
    observedName: agent.name ?? null,
    toolCount: tools.length,
    indexNames: indices,
    pass: errors.length === 0,
    errors,
    warnings,
  };
}

export async function fetchAgentStudioIdentity({ fetchAgent, manifest = loadDeploymentManifest() }) {
  if (typeof fetchAgent !== 'function') throw new Error('fetchAgent dependency is required');
  const expected = manifest.agentStudio;
  const specs = [
    { key: 'orchestrator', spec: expected.orchestrator, requireNamedSearchTool: true },
    { key: 'greetings', spec: expected.greetings },
    { key: 'developerSpecialist', spec: expected.developerSpecialist },
    ...(expected.orchestrator.specialists ?? [])
      .filter((item) => item.agentId !== expected.developerSpecialist.agentId)
      .map((item) => ({ key: `specialist:${item.key}`, spec: item })),
  ];
  const agents = [];
  for (const entry of specs) {
    const live = await fetchAgent(entry.spec.agentId);
    agents.push({ key: entry.key, ...inspectAgent(live, entry.spec, entry) });
  }
  return {
    appId: TARGET.appId,
    agents,
    pass: agents.every((agent) => agent.pass),
  };
}
