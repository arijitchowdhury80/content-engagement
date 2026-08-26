import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { chromium } from 'playwright';

import { REPOSITORY_ROOT, TARGET } from '../config/constants.mjs';
import { ensureSafeRawRoot, writePrivateFile } from '../config/artifact-paths.mjs';
import { createRunId, deriveSafeId } from '../config/run-ids.mjs';
import { loadFrozenDataset } from '../contracts/validate.mjs';
import { AppendOnlyJsonlSpool } from '../observe/jsonl-spool.mjs';
import { BrowserRecorder } from '../observe/browser-recorder.mjs';
import { evaluateMechanicalTurn } from '../oracle/mechanical.mjs';
import { inspectRuntimeIdentity } from '../preflight/runtime-identity.mjs';
import { createOperatorAgentFetcher } from '../preflight/operator-agent-client.mjs';
import {
  completionTraffic,
  classifyCompletionFanout,
  hashRequestBody,
  isCompletion,
  isPrimaryCompletion,
  persistedState,
  prohibitedRequest,
  turnObservation,
  runtimeCompletionRoles,
  waitForTurn,
} from './phase0-smoke.mjs';

const DATASET_PATH = path.join(REPOSITORY_ROOT, 'testing/stability/datasets/reactive-conversations.v1.json');

export function selectCampaign(dataset, campaignId) {
  const campaign = dataset.campaigns.find((candidate) => candidate.id === campaignId);
  if (!campaign) throw new Error(`Unknown frozen campaign: ${campaignId}`);
  const persona = dataset.primaryPersonas.find((candidate) => candidate.id === campaign.personaId);
  if (!persona) throw new Error(`Campaign ${campaignId} has no frozen persona`);
  return { campaign, persona };
}

export function selectCampaignSequence(dataset, campaignIds) {
  if (!Array.isArray(campaignIds) || campaignIds.length < 1 || campaignIds.length > 2) {
    throw new Error('One-user sequence requires one or two campaign IDs');
  }
  const selected = campaignIds.map((campaignId) => selectCampaign(dataset, campaignId));
  if (new Set(selected.map(({ persona }) => persona.id)).size !== 1) {
    throw new Error('One-user sequence campaigns must belong to one persona');
  }
  if (!campaignIds[0].endsWith('-C1') || (campaignIds[1] && !campaignIds[1].endsWith('-C2'))) {
    throw new Error('One-user sequence must be C1 followed by optional C2');
  }
  return selected;
}

export function oneUserContextId(runId, secret) {
  return deriveSafeId(runId, 'context', 0, secret);
}

export function specialistRouteSatisfied({ requested, consentActions, backgroundCompletionAttempts, turn }) {
  if (!requested) return true;
  const accepted = consentActions.includes('accept');
  const additive = (turn?.segments?.length ?? 0) >= 2;
  const demoted = turn?.specialistLimitation?.agent === turn?.deepDiveSpecialist && Boolean(turn?.deepDiveSpecialist);
  return accepted && backgroundCompletionAttempts === 1 && (additive || demoted);
}

async function submitQuestion(page, question, firstTurn) {
  if (firstTurn) {
    await page.evaluate((text) => {
      const chat = document.querySelector('algolia-chat');
      chat.open();
      chat.ask(text);
    }, question);
    return;
  }
  const composer = page.locator('algolia-chat').locator('#acs-composer-input');
  await composer.waitFor({ state: 'visible', timeout: 10_000 });
  await page.waitForFunction(() => {
    const input = document.querySelector('algolia-chat')?.shadowRoot?.querySelector('#acs-composer-input');
    return input && !input.disabled;
  }, null, { timeout: 10_000 });
  await composer.fill(question);
  await composer.press('Enter');
}

export async function runOneUserBaseline({ rawRoot, campaignId = 'U5-C1', campaignIds, headless = true } = {}) {
  const safeRoot = ensureSafeRawRoot(rawRoot);
  const dataset = loadFrozenDataset(DATASET_PATH);
  const requestedCampaignIds = campaignIds ?? String(campaignId).split(',').map((value) => value.trim()).filter(Boolean);
  const selections = selectCampaignSequence(dataset, requestedCampaignIds);
  const persona = selections[0].persona;
  const script = selections.flatMap(({ campaign }) => campaign.questions.map((question, index) => ({
    campaignId: campaign.id,
    action: campaign.turnActions[index],
    question,
  })));
  const identity = await inspectRuntimeIdentity({ fetchAgent: createOperatorAgentFetcher() });
  if (!identity.pass) throw new Error(`RUN_BLOCKED_TARGET_IDENTITY: ${identity.jahia.indexName}/${identity.browser.identity.indexName}`);

  const runId = createRunId();
  const secret = randomBytes(32);
  const contextId = oneUserContextId(runId, secret);
  const spool = new AppendOnlyJsonlSpool(safeRoot, 'one-user/observations.jsonl');
  const browser = await chromium.launch({ headless });
  const context = await browser.newContext();
  const recorder = new BrowserRecorder({
    spool,
    identity: { runId, stageId: 'one-user-baseline', hostId: 'local', browserContextId: contextId, personaId: persona.id },
  });
  recorder.attach(context);
  let prohibitedUrl = null;
  await context.route('**/*', async (route) => {
    if (prohibitedRequest(route.request())) {
      prohibitedUrl = route.request().url();
      await route.abort('blockedbyclient');
      return;
    }
    await route.continue();
  });
  const page = await context.newPage();
  let pageCrashed = false;
  page.on('crash', () => { pageCrashed = true; });
  const primaryRequests = [];
  const completionRequests = [];
  page.on('request', (request) => {
    if (isPrimaryCompletion(request.url())) primaryRequests.push({
      at: Date.now(), request, bodyHash: hashRequestBody(request), responseStatus: null,
    });
    if (isCompletion(request.url())) completionRequests.push({ at: Date.now(), url: request.url() });
  });
  page.on('response', (response) => {
    const entry = primaryRequests.find((candidate) => candidate.request === response.request());
    if (entry) entry.responseStatus = response.status();
  });

  const turns = [];
  let runError = null;
  let finalState = null;
  const startedAt = new Date().toISOString();
  try {
    await page.goto(`${TARGET.origin}/?stability_baseline=${runId}`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForFunction(() => customElements.get('algolia-chat') && document.querySelector('algolia-chat'), null, { timeout: 30_000 });
    const completionRoles = await runtimeCompletionRoles(page);
    for (const [index, item] of script.entries()) {
      const primaryStart = primaryRequests.length;
      const completionStart = completionRequests.length;
      const turnStarted = Date.now();
      await submitQuestion(page, item.question, index === 0);
      const specialistRequested = /bring in (?:the )?.*specialist/i.test(item.question);
      const specialistAction = specialistRequested ? 'accept' : 'decline';
      const result = await waitForTurn(page, index, { specialistAction });
      const traffic = completionTraffic(primaryRequests.slice(primaryStart));
      const fanout = classifyCompletionFanout(completionRequests.slice(completionStart), completionRoles);
      const backgroundCompletionAttempts = fanout.specialist + fanout.unknown;
      const backgroundCompletionCeiling = result.consentActions.includes('accept') ? 1 : 0;
      const observation = turnObservation({
        turn: result.turn,
        query: item.question,
        traffic,
        backgroundCompletionAttempts,
        backgroundCompletionCeiling,
        pageCrashed,
      });
      const state = await persistedState(page);
      const continuityPass = state?.turns?.length === index + 1 &&
        state.turns.every((turn, turnIndex) => turn.query === script[turnIndex].question) &&
        state.turns.every((turn) => turn.segments.every((segment) => ['success', 'error'].includes(segment.status)));
      const specialistRoutePass = specialistRouteSatisfied({
        requested: specialistRequested,
        consentActions: result.consentActions,
        backgroundCompletionAttempts: fanout.specialist,
        turn: result.turn,
      });
      const verdict = evaluateMechanicalTurn(observation);
      if (!continuityPass) verdict.failures.push('transcript-continuity');
      if (!specialistRoutePass) verdict.failures.push('expected-specialist-route');
      if (!continuityPass || !specialistRoutePass) {
        verdict.pass = false;
        verdict.hardFailure = true;
      }
      const turnRecord = {
        turn: index + 1,
        campaignId: item.campaignId,
        action: item.action,
        query: item.question,
        responseMessageId: result.turn?.segments?.[0]?.messageId ?? null,
        latencyMs: Date.now() - turnStarted,
        consentActions: result.consentActions,
        traffic,
        fanout,
        continuityPass,
        specialistRoutePass,
        observation,
        verdict,
      };
      turns.push(turnRecord);
      spool.append({ schema: 'OneUserTurn.v1', at: new Date().toISOString(), runId, campaignId: item.campaignId, turn: turnRecord });
      process.stdout.write(`${JSON.stringify({ progress: index + 1, turns: script.length, campaignId: item.campaignId, pass: verdict.pass, failures: verdict.failures })}\n`);
      if (!verdict.pass) throw new Error(`turn-${index + 1}:${verdict.failures.join(',')}`);
    }
    if (prohibitedUrl) throw new Error('production-request');
  } catch (error) {
    runError = error instanceof Error ? error.message : String(error);
    const screenshot = path.join(safeRoot, 'one-user', 'failure.png');
    fs.mkdirSync(path.dirname(screenshot), { recursive: true, mode: 0o700 });
    await page.screenshot({ path: screenshot, fullPage: true }).catch(() => {});
  } finally {
    finalState = await persistedState(page).catch(() => null);
    await recorder.flush();
    await context.close();
    await browser.close();
    spool.close();
  }
  const summary = {
    schema: 'OneUserBaselineSummary.v1',
    runId,
    campaignIds: requestedCampaignIds,
    personaId: persona.id,
    personaRole: persona.role,
    startedAt,
    completedAt: new Date().toISOString(),
    pass: !runError && turns.length === script.length && turns.every((turn) => turn.verdict.pass),
    error: runError,
    turnsExpected: script.length,
    turnsCompleted: turns.length,
    evidenceClass: 'CLIENT_OBSERVABLE',
    finalState,
    turns,
  };
  const summaryPath = writePrivateFile(safeRoot, 'one-user/summary.json', `${JSON.stringify(summary, null, 2)}\n`);
  return { ...summary, summaryPath };
}
