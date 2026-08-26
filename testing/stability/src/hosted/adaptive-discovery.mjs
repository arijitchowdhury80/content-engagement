import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { chromium } from 'playwright';

import { REPOSITORY_ROOT, TARGET } from '../config/constants.mjs';
import { ensureSafeRawRoot, writePrivateFile } from '../config/artifact-paths.mjs';
import { createRunId, deriveSafeId } from '../config/run-ids.mjs';
import { loadAdaptiveDiscoveryDataset } from '../contracts/validate.mjs';
import { createPersonaDriver } from '../discovery/persona-driver.mjs';
import { AppendOnlyJsonlSpool } from '../observe/jsonl-spool.mjs';
import { BrowserRecorder } from '../observe/browser-recorder.mjs';
import { evaluateDiscoveryQuestion, evaluateFinalContinuity, evaluateProfileCompleteness, evaluateSubstantiveAnswerShape } from '../oracle/discovery.mjs';
import { evaluateMechanicalTurn } from '../oracle/mechanical.mjs';
import { inspectRuntimeIdentity } from '../preflight/runtime-identity.mjs';
import { createOperatorAgentFetcher } from '../preflight/operator-agent-client.mjs';
import { specialistRouteSatisfied } from './one-user-baseline.mjs';
import {
  completionTraffic,
  classifyCompletionFanout,
  isCompletion,
  isPrimaryCompletion,
  persistedState,
  runtimeCompletionRoles,
  turnObservation,
  waitForTurn,
} from './phase0-smoke.mjs';

const DATASET_PATH = path.join(REPOSITORY_ROOT, 'testing/stability/datasets/adaptive-discovery.v1.json');

export function selectAdaptiveCampaign(dataset, campaignId) {
  const campaign = dataset.campaigns.find((candidate) => candidate.id === campaignId);
  if (!campaign) throw new Error(`Unknown adaptive campaign: ${campaignId}`);
  return campaign;
}

export function visibleDiscoveryQuestions(turn) {
  const serverSuggestions = (turn?.segments ?? [])
    .flatMap((segment) => Array.isArray(segment.followUps) ? segment.followUps : [])
    .map((question) => String(question).trim())
    .filter(Boolean);
  if (serverSuggestions.length > 0) return serverSuggestions;

  const answerText = (turn?.segments ?? [])
    .map((segment) => String(segment.text ?? '').trim())
    .filter(Boolean)
    .join('\n\n');
  const questionParagraph = answerText
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter(Boolean)
    .reverse()
    .find((part) => part.endsWith('?')) ?? '';
  if (!questionParagraph) return [];
  const questionStart = Math.max(0, ...[
    ['. ', 2],
    ['! ', 2],
    ['\n', 1],
  ].map(([boundary, width]) => {
    const index = questionParagraph.lastIndexOf(boundary);
    return index < 0 ? 0 : index + width;
  }));
  const question = questionParagraph.slice(questionStart).replace(/^[-*#>\s]+/, '').trim();
  return question ? [question] : [];
}

function prohibitedRequest(request) {
  try {
    const url = new URL(request.url());
    const appId = request.headers()['x-algolia-application-id']?.toUpperCase();
    return appId === TARGET.productionAskAppId || url.hostname.toUpperCase().startsWith(`${TARGET.productionAskAppId}.`);
  } catch {
    return true;
  }
}

function requestBodyHash(request) {
  return createHash('sha256').update(request.postData() ?? '').digest('hex');
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

export async function runAdaptiveDiscovery({ rawRoot, campaignId = 'U2-AD1', headless = true } = {}) {
  const safeRoot = ensureSafeRawRoot(rawRoot);
  const dataset = loadAdaptiveDiscoveryDataset(DATASET_PATH);
  const campaign = selectAdaptiveCampaign(dataset, campaignId);
  const driver = createPersonaDriver(campaign);
  const identity = await inspectRuntimeIdentity({ fetchAgent: createOperatorAgentFetcher() });
  if (!identity.pass) throw new Error(`RUN_BLOCKED_TARGET_IDENTITY: ${identity.jahia.indexName}/${identity.browser.identity.indexName}`);

  const runId = createRunId();
  const contextId = deriveSafeId(runId, 'adaptive-context', 0, randomBytes(32));
  const spool = new AppendOnlyJsonlSpool(safeRoot, 'adaptive-discovery/observations.jsonl');
  const browser = await chromium.launch({ headless });
  const context = await browser.newContext();
  const recorder = new BrowserRecorder({
    spool,
    identity: { runId, stageId: 'adaptive-discovery', hostId: 'local', browserContextId: contextId, personaId: campaign.personaId },
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
    if (isPrimaryCompletion(request.url())) primaryRequests.push({ request, bodyHash: requestBodyHash(request), responseStatus: null });
    if (isCompletion(request.url())) completionRequests.push({ url: request.url() });
  });
  page.on('response', (response) => {
    const entry = primaryRequests.find((candidate) => candidate.request === response.request());
    if (entry) entry.responseStatus = response.status();
  });

  const turns = [];
  const submittedQueries = [];
  let userText = campaign.initialQuestion;
  let runError = null;
  let finalState = null;
  const totalTurns = campaign.discoveryResponseTurns + 2;
  try {
    await page.goto(`${TARGET.origin}/?adaptive_discovery=${runId}`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForFunction(() => customElements.get('algolia-chat') && document.querySelector('algolia-chat'), null, { timeout: 30_000 });
    const completionRoles = await runtimeCompletionRoles(page);
    for (let index = 0; index < totalTurns; index += 1) {
      const isFinal = index === totalTurns - 1;
      const primaryStart = primaryRequests.length;
      const completionStart = completionRequests.length;
      const startedAt = Date.now();
      submittedQueries.push(userText);
      await submitQuestion(page, userText, index === 0);
      const specialistRequested = /bring in (?:the )?.*specialist/i.test(userText);
      const result = await waitForTurn(page, index, { specialistAction: isFinal ? 'accept' : 'decline' });
      const traffic = completionTraffic(primaryRequests.slice(primaryStart));
      const fanout = classifyCompletionFanout(completionRequests.slice(completionStart), completionRoles);
      const backgroundCompletionAttempts = fanout.specialist + fanout.unknown;
      const observation = turnObservation({
        turn: result.turn,
        query: userText,
        traffic,
        backgroundCompletionAttempts,
        backgroundCompletionCeiling: result.consentActions.includes('accept') ? 1 : 0,
        pageCrashed,
      });
      const mechanical = evaluateMechanicalTurn(observation);
      const state = await persistedState(page);
      const transcriptContinuity = state?.turns?.length === index + 1 &&
        state.turns.every((turn, turnIndex) => turn.query === submittedQueries[turnIndex]);
      if (!transcriptContinuity) {
        mechanical.pass = false;
        mechanical.hardFailure = true;
        mechanical.failures.push('transcript-continuity');
      }

      const record = {
        turn: index + 1,
        userText,
        answerText: (result.turn?.segments ?? []).map((segment) => segment.text ?? '').filter(Boolean).join('\n\n'),
        latencyMs: Date.now() - startedAt,
        consentActions: result.consentActions,
        traffic,
        fanout,
        mechanical,
      };
      record.answerShape = evaluateSubstantiveAnswerShape(record.answerText);

      if (index < campaign.discoveryResponseTurns) {
        const questions = visibleDiscoveryQuestions(result.turn);
        const personaResponse = driver.answer(questions[0] ?? '');
        record.discoveryQuestions = questions;
        record.personaResponse = personaResponse;
        record.discovery = evaluateDiscoveryQuestion({
          campaign,
          question: questions[0] ?? '',
          matches: personaResponse.matches,
          repeated: personaResponse.repeated,
        });
        if (questions.length !== 1) {
          record.discovery.pass = false;
          record.discovery.failures.push(`discovery-cardinality-${questions.length}`);
        }
        userText = personaResponse.answer;
      } else if (!isFinal) {
        userText = campaign.finalDecisionPrompt;
      } else {
        record.profile = evaluateProfileCompleteness(campaign, driver.snapshot().confirmed);
        record.continuity = evaluateFinalContinuity({ campaign, answerText: record.answerText, confirmed: driver.snapshot().confirmed });
        record.specialistRoute = {
          pass: specialistRouteSatisfied({ requested: specialistRequested, consentActions: result.consentActions, backgroundCompletionAttempts: fanout.specialist, turn: result.turn }),
          requested: specialistRequested,
        };
      }

      turns.push(record);
      spool.append({ schema: 'AdaptiveDiscoveryTurn.v1', at: new Date().toISOString(), runId, campaignId, record });
      process.stdout.write(`${JSON.stringify({ progress: index + 1, turns: totalTurns, mechanical: mechanical.pass, discovery: record.discovery?.pass ?? null })}\n`);
      if (!mechanical.pass) throw new Error(`turn-${index + 1}:${mechanical.failures.join(',')}`);
    }
    if (prohibitedUrl) throw new Error('production-request');
  } catch (error) {
    runError = error instanceof Error ? error.message : String(error);
    await page.screenshot({ path: path.join(safeRoot, 'adaptive-discovery', 'failure.png'), fullPage: true }).catch(() => {});
  } finally {
    finalState = await persistedState(page).catch(() => null);
    await recorder.flush();
    await context.close();
    await browser.close();
    spool.close();
  }

  const finalTurn = turns.at(-1);
  const discoveryPass = turns.filter((turn) => turn.discovery).every((turn) => turn.discovery.pass);
  const pass = !runError && turns.length === totalTurns && turns.every((turn) => turn.mechanical.pass) &&
    turns.every((turn) => turn.answerShape.pass) && discoveryPass && finalTurn?.profile?.pass === true &&
    finalTurn?.continuity?.pass === true && finalTurn?.specialistRoute?.pass === true;
  const summary = {
    schema: 'AdaptiveDiscoverySummary.v1', runId, campaignId, personaId: campaign.personaId,
    pass, runError, totalTurns, turnsCompleted: turns.length, discoveryPass,
    profile: driver.snapshot(), finalState, turns,
  };
  const summaryPath = writePrivateFile(safeRoot, 'adaptive-discovery/summary.json', `${JSON.stringify(summary, null, 2)}\n`);
  return { ...summary, summaryPath };
}
