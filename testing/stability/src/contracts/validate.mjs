import fs from 'node:fs';

const INTENTS = new Set([
  'resolve_support_problem',
  'support_and_documentation',
  'support',
  'evaluate_technical_fit',
  'evaluate_implementation_and_migration',
  'technical_documentation',
  'technical_evaluation',
  'evaluate_business_and_operational_fit',
  'evaluate_business_fit',
  'evaluate_merchandising_strategy',
  'business_discovery',
  'business_evaluation',
  'commercial_evaluation',
  'commercial_or_product_evaluation',
  'proof_and_commercial_evaluation',
  'learn',
  'learn_and_find_documentation',
  'learn_technical_concepts',
]);

function requireObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
}

function requireNonEmptyString(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string`);
}

function requireStringArray(value, label, { nonEmpty = false } = {}) {
  if (!Array.isArray(value) || (nonEmpty && value.length === 0)) throw new Error(`${label} must be an array`);
  value.forEach((item, index) => requireNonEmptyString(item, `${label}[${index}]`));
}

function assertUnique(values, label) {
  if (new Set(values).size !== values.length) throw new Error(`${label} contains duplicate values`);
}

export function validateReactiveDataset(dataset) {
  requireObject(dataset, 'dataset');
  if (dataset.schema !== 'ReactiveConversationDataset.v1') throw new Error('Unsupported dataset schema');
  if (dataset.status !== 'frozen-v1') throw new Error('Dataset must be frozen-v1 before execution');
  if (dataset.targetFlow !== 'reactive') throw new Error('Dataset targetFlow must be reactive');
  requireNonEmptyString(dataset.version, 'dataset.version');
  requireStringArray(dataset.globalOracles, 'dataset.globalOracles', { nonEmpty: true });
  if (!Array.isArray(dataset.primaryPersonas) || dataset.primaryPersonas.length !== 5) {
    throw new Error('Dataset must contain exactly five primary personas');
  }
  if (!Array.isArray(dataset.campaigns) || dataset.campaigns.length !== 20) {
    throw new Error('Dataset must contain exactly twenty primary campaigns');
  }
  if (!Array.isArray(dataset.breakpointProbePersonas) || dataset.breakpointProbePersonas.length !== 15) {
    throw new Error('Dataset must contain exactly fifteen breakpoint personas');
  }
  const personaIds = dataset.primaryPersonas.map((persona, index) => {
    requireObject(persona, `primaryPersonas[${index}]`);
    requireNonEmptyString(persona.id, `primaryPersonas[${index}].id`);
    requireNonEmptyString(persona.role, `primaryPersonas[${index}].role`);
    requireStringArray(persona.discoveryAllowed, `primaryPersonas[${index}].discoveryAllowed`);
    requireStringArray(persona.discoveryForbidden, `primaryPersonas[${index}].discoveryForbidden`);
    return persona.id;
  });
  assertUnique(personaIds, 'primary persona IDs');
  const campaignIds = [];
  let turnCount = 0;
  for (const [index, campaign] of dataset.campaigns.entries()) {
    requireObject(campaign, `campaigns[${index}]`);
    requireNonEmptyString(campaign.id, `campaigns[${index}].id`);
    campaignIds.push(campaign.id);
    if (!personaIds.includes(campaign.personaId)) throw new Error(`Unknown personaId in campaign ${campaign.id}`);
    requireNonEmptyString(campaign.expectedIntent, `${campaign.id}.expectedIntent`);
    if (!INTENTS.has(campaign.expectedIntent)) throw new Error(`Unrecognized expected intent in ${campaign.id}`);
    requireNonEmptyString(campaign.expectedRoute, `${campaign.id}.expectedRoute`);
    requireStringArray(campaign.factsToRemember, `${campaign.id}.factsToRemember`);
    requireStringArray(campaign.turnActions, `${campaign.id}.turnActions`, { nonEmpty: true });
    requireStringArray(campaign.questions, `${campaign.id}.questions`, { nonEmpty: true });
    if (campaign.questions.length !== 6 || campaign.turnActions.length !== 6) {
      throw new Error(`Campaign ${campaign.id} must contain six questions and six actions`);
    }
    turnCount += campaign.questions.length;
  }
  assertUnique(campaignIds, 'campaign IDs');
  if (turnCount !== 120) throw new Error(`Primary dataset must contain 120 turns; found ${turnCount}`);
  const breakpointIds = [];
  for (const [index, persona] of dataset.breakpointProbePersonas.entries()) {
    requireObject(persona, `breakpointProbePersonas[${index}]`);
    requireNonEmptyString(persona.id, `breakpointProbePersonas[${index}].id`);
    requireNonEmptyString(persona.role, `breakpointProbePersonas[${index}].role`);
    requireStringArray(persona.turns, `breakpointProbePersonas[${index}].turns`, { nonEmpty: true });
    breakpointIds.push(persona.id);
  }
  assertUnique([...personaIds, ...breakpointIds], 'all persona IDs');
  requireStringArray(dataset.mutationVariants, 'dataset.mutationVariants', { nonEmpty: true });
  assertUnique(dataset.mutationVariants, 'mutation variants');
  return { personaCount: personaIds.length, campaignCount: campaignIds.length, turnCount, breakpointPersonaCount: breakpointIds.length };
}

export function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

export function loadFrozenDataset(filePath) {
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  validateReactiveDataset(parsed);
  return deepFreeze(parsed);
}

export function validateAdaptiveDiscoveryDataset(dataset) {
  requireObject(dataset, 'dataset');
  if (dataset.schema !== 'AdaptiveDiscoveryDataset.v1') throw new Error('Unsupported adaptive dataset schema');
  if (dataset.status !== 'frozen-v1') throw new Error('Adaptive dataset must be frozen-v1 before execution');
  if (dataset.targetFlow !== 'reactive_adaptive_discovery') throw new Error('Adaptive dataset targetFlow is invalid');
  requireNonEmptyString(dataset.version, 'dataset.version');
  if (!Array.isArray(dataset.campaigns) || dataset.campaigns.length < 1) throw new Error('Adaptive dataset requires campaigns');
  const ids = [];
  for (const [index, campaign] of dataset.campaigns.entries()) {
    const label = `campaigns[${index}]`;
    requireObject(campaign, label);
    requireNonEmptyString(campaign.id, `${label}.id`);
    requireNonEmptyString(campaign.personaId, `${label}.personaId`);
    requireNonEmptyString(campaign.role, `${label}.role`);
    requireNonEmptyString(campaign.intent, `${label}.intent`);
    requireNonEmptyString(campaign.initialQuestion, `${label}.initialQuestion`);
    requireNonEmptyString(campaign.finalDecisionPrompt, `${label}.finalDecisionPrompt`);
    requireNonEmptyString(campaign.fallbackAnswer, `${label}.fallbackAnswer`);
    requireNonEmptyString(campaign.repeatAnswerPrefix, `${label}.repeatAnswerPrefix`);
    requireNonEmptyString(campaign.expectedRoute, `${label}.expectedRoute`);
    if (!Number.isInteger(campaign.discoveryResponseTurns) || campaign.discoveryResponseTurns < 1 || campaign.discoveryResponseTurns > 8) {
      throw new Error(`${label}.discoveryResponseTurns must be between 1 and 8`);
    }
    requireStringArray(campaign.requiredSlots, `${label}.requiredSlots`, { nonEmpty: true });
    requireStringArray(campaign.forbiddenQuestionPatterns, `${label}.forbiddenQuestionPatterns`);
    requireStringArray(campaign.expectedFactMentions, `${label}.expectedFactMentions`, { nonEmpty: true });
    if (!Array.isArray(campaign.responses) || campaign.responses.length < 1) throw new Error(`${label}.responses must be nonempty`);
    const slots = [];
    for (const [responseIndex, response] of campaign.responses.entries()) {
      const responseLabel = `${label}.responses[${responseIndex}]`;
      requireObject(response, responseLabel);
      requireNonEmptyString(response.slot, `${responseLabel}.slot`);
      requireStringArray(response.questionPatterns, `${responseLabel}.questionPatterns`, { nonEmpty: true });
      requireNonEmptyString(response.answer, `${responseLabel}.answer`);
      requireObject(response.reveals, `${responseLabel}.reveals`);
      if (Object.keys(response.reveals).length === 0) throw new Error(`${responseLabel}.reveals must be nonempty`);
      slots.push(response.slot);
    }
    assertUnique(slots, `${campaign.id} response slots`);
    ids.push(campaign.id);
  }
  assertUnique(ids, 'adaptive campaign IDs');
  return { campaignCount: ids.length };
}

export function loadAdaptiveDiscoveryDataset(filePath) {
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  validateAdaptiveDiscoveryDataset(parsed);
  return deepFreeze(parsed);
}

const CONTRACT_REQUIRED = Object.freeze({
  'RunManifest.v1': ['schema', 'runId', 'createdAt', 'faultOrigin', 'target', 'runtime', 'inputs', 'execution', 'thresholds', 'trafficBudget', 'evaluator', 'host', 'permissions', 'hashes'],
  'TestTurn.v1': ['schema', 'personaId', 'campaignId', 'turnId', 'exactUserText', 'intent', 'factsAlreadyConfirmed', 'factsToRemember', 'explicitCorrections', 'expectedRoute', 'acceptableAnswerBehaviors', 'prohibitedClaims', 'expectedDiscoveryBehavior', 'beforeAction', 'turnAction', 'afterAction', 'timeoutPolicy'],
  'ObservationEvent.v1': ['schema', 'eventId', 'at', 'monotonicMs', 'runId', 'stageId', 'hostId', 'browserContextId', 'personaId', 'conversationId', 'turnId', 'attemptId', 'source', 'type', 'classification', 'safePayload', 'payloadHash'],
  'CompletionEnvelope.v1': ['schema', 'conversationId', 'messages', 'callRole', 'parentTurnId', 'logicalStep', 'physicalAttempt'],
  'TurnExecutionContext.v1': ['schema', 'turnId', 'deadlineAt', 'generation', 'primaryRetryBudget', 'sideEffectState', 'physicalAttemptLedger', 'abortState'],
  'AgentCallBudget.v1': ['schema', 'roles', 'stagePhysicalCeiling'],
  'SupervisorState.v1': ['schema', 'state', 'epoch', 'abortLatched', 'leasesIssued', 'leasesActive'],
  'RuntimeIdentity.v1': ['schema', 'origin', 'jahia', 'browser', 'agentStudio', 'assets', 'checkedAt'],
  'EvidenceRetention.v1': ['schema', 'rawRoot', 'rawCaptureEnabled', 'retentionDays', 'deleteAfter', 'incidentExtension'],
});

export function validateContract(value) {
  requireObject(value, 'contract');
  const required = CONTRACT_REQUIRED[value.schema];
  if (!required) throw new Error(`Unsupported contract schema: ${value.schema}`);
  for (const field of required) if (!(field in value)) throw new Error(`${value.schema} is missing required field ${field}`);
  if ('faultOrigin' in value && !['NATURAL', 'INJECTED'].includes(value.faultOrigin)) throw new Error('faultOrigin must be NATURAL or INJECTED');
  return true;
}
