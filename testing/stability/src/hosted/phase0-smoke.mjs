import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { chromium } from 'playwright';

import { TARGET } from '../config/constants.mjs';
import { ensureSafeRawRoot, writePrivateFile } from '../config/artifact-paths.mjs';
import { createRunId, deriveSafeId } from '../config/run-ids.mjs';
import { AppendOnlyJsonlSpool } from '../observe/jsonl-spool.mjs';
import { BrowserRecorder } from '../observe/browser-recorder.mjs';
import { evaluateMechanicalTurn } from '../oracle/mechanical.mjs';
import { inspectRuntimeIdentity } from '../preflight/runtime-identity.mjs';
import { createOperatorAgentFetcher } from '../preflight/operator-agent-client.mjs';

export function isPrimaryCompletion(url) {
  return url.includes(`/agent-studio/1/agents/${TARGET.primaryAgentId}/completions`);
}

export function isCompletion(url) {
  return /\/agent-studio\/1\/agents\/[^/]+\/completions(?:[/?]|$)/.test(url);
}

export function completionAgentId(url) {
  return url.match(/\/agent-studio\/1\/agents\/([^/]+)\/completions(?:[/?]|$)/)?.[1] ?? null;
}

export function classifyCompletionFanout(requests, {
  primaryAgentId = TARGET.primaryAgentId,
  judgeAgentIds = [],
  specialistAgentIds = [],
} = {}) {
  const judges = new Set(judgeAgentIds);
  const specialists = new Set(specialistAgentIds);
  const counts = { primary: 0, judge: 0, specialist: 0, unknown: 0 };
  for (const request of requests) {
    const agentId = completionAgentId(request.url ?? '');
    if (agentId === primaryAgentId) counts.primary += 1;
    else if (judges.has(agentId)) counts.judge += 1;
    else if (specialists.has(agentId)) counts.specialist += 1;
    else counts.unknown += 1;
  }
  return counts;
}

export async function runtimeCompletionRoles(page) {
  return page.evaluate(() => {
    const judgeAgentIds = [];
    const specialistAgentIds = [];
    for (const agent of document.querySelectorAll('algolia-agent[agent-id]')) {
      const id = agent.getAttribute('agent-id')?.trim();
      if (!id) continue;
      if (agent.closest('algolia-chat-confidence')) judgeAgentIds.push(id);
      else if (agent.getAttribute('role') === 'specialist') specialistAgentIds.push(id);
    }
    return { judgeAgentIds: [...new Set(judgeAgentIds)], specialistAgentIds: [...new Set(specialistAgentIds)] };
  });
}

function prohibitedRequest(request) {
  try {
    const url = new URL(request.url());
    const appId = request.headers()['x-algolia-application-id']?.toUpperCase();
    const productionHost = url.hostname.toUpperCase().startsWith(`${TARGET.productionAskAppId}.`);
    return appId === TARGET.productionAskAppId || productionHost;
  } catch {
    return true;
  }
}

export async function persistedState(page) {
  return page.evaluate(() => {
    const raw = sessionStorage.getItem('algolia-chat:conversation');
    return raw ? JSON.parse(raw) : null;
  });
}

async function settleSpecialistConsent(page, action) {
  const consent = page.getByRole('group', { name: /^deep-dive offer$/i });
  const accept = consent.getByRole('button', { name: /^yes,\s*go deeper$/i });
  const decline = consent.getByRole('button', { name: /^no thanks$/i });
  const control = action === 'accept' ? accept : decline;
  if (!await control.isVisible().catch(() => false)) return false;
  await control.click({ timeout: 10_000 });
  return true;
}

export async function waitForTurn(page, turnIndex, { timeoutMs = 65_000, specialistAction = 'decline' } = {}) {
  const deadline = Date.now() + timeoutMs;
  const consentActions = [];
  while (Date.now() < deadline) {
    const state = await persistedState(page).catch(() => null);
    const turn = state?.turns?.[turnIndex] ?? null;
    if (turn && ['success', 'error'].includes(turn.segments?.[0]?.status)) {
      return { turn, consentActions };
    }
    if (consentActions.length === 0 && await settleSpecialistConsent(page, specialistAction)) {
      consentActions.push(specialistAction);
      continue;
    }
    await page.waitForTimeout(100);
  }
  const state = await persistedState(page).catch(() => null);
  return { turn: state?.turns?.[turnIndex] ?? null, consentActions };
}

export function hashRequestBody(request) {
  const body = request.postData() ?? '';
  return createHash('sha256').update(body).digest('hex');
}

function retryableStatus(status) {
  return status === 408 || status === 429 || status >= 500;
}

export function classifyTerminalError(error, responseStatuses = []) {
  const text = String(error ?? '').toLowerCase();
  const status = [...responseStatuses].reverse().find((value) => Number.isInteger(value) && value >= 400) ?? null;
  if (status === 429 || /too_many_requests|rate limit|rate-limit/.test(text)) return { category: 'rate-limited', status: status ?? 429 };
  if (status === 408 || /timed?\s*out|timeout/.test(text)) return { category: 'timeout', status: status ?? 408 };
  if ((status ?? 0) >= 500) return { category: 'service-unavailable', status };
  if (/guardrail/.test(text)) return { category: 'guardrail', status };
  if (/empty response|empty-response/.test(text)) return { category: 'empty-response', status };
  return error ? { category: 'completion-error', status } : { category: null, status };
}

export function completionTraffic(requests) {
  const groups = new Map();
  for (const [index, request] of requests.entries()) {
    const bodyHash = request.bodyHash ?? `unavailable-${index}`;
    const group = groups.get(bodyHash) ?? [];
    group.push(request);
    groups.set(bodyHash, group);
  }
  let retryAttempts = 0;
  let permittedRetryAttempts = 0;
  for (const group of groups.values()) {
    const retries = Math.max(0, group.length - 1);
    retryAttempts += retries;
    if (retries === 1 && retryableStatus(group[0]?.responseStatus)) permittedRetryAttempts += 1;
  }
  return {
    physicalCompletionRequests: requests.length,
    completionSteps: groups.size,
    responseStatuses: requests.map((request) => request.responseStatus).filter(Number.isInteger),
    retryAttempts,
    permittedRetryAttempts,
    unsafeRetry: retryAttempts > permittedRetryAttempts,
  };
}

export function turnObservation({ turn, query, traffic, backgroundCompletionAttempts = 0, backgroundCompletionCeiling = 0, pageCrashed, observerLost = false }) {
  const primary = turn?.segments?.[0];
  const terminalError = classifyTerminalError(primary?.error, traffic.responseStatuses);
  return {
    userMessageCount: turn?.query === query ? 1 : 0,
    terminalState: primary?.status ?? null,
    errorCategory: terminalError.category,
    responseStatus: terminalError.status,
    answerText: primary?.text ?? '',
    pageCrashed,
    observerLost,
    crossUserCanary: false,
    unsafeRetry: traffic.unsafeRetry,
    physicalCompletionRequests: traffic.physicalCompletionRequests,
    completionSteps: traffic.completionSteps,
    completionStepCeiling: 4,
    retryAttempts: traffic.retryAttempts,
    permittedRetryAttempts: traffic.permittedRetryAttempts,
    retryAttemptCeiling: 1,
    backgroundCompletionAttempts,
    backgroundCompletionCeiling,
    duplicateAnswer: false,
  };
}

export async function runPhase0Smoke({ rawRoot, repetitions = 20, headless = true } = {}) {
  if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 20) throw new Error('Phase 0 repetitions must be between 1 and 20');
  const safeRoot = ensureSafeRawRoot(rawRoot);
  const identity = await inspectRuntimeIdentity({ fetchAgent: createOperatorAgentFetcher() });
  if (!identity.pass) throw new Error(`RUN_BLOCKED_TARGET_IDENTITY: ${identity.jahia.indexName}/${identity.browser.identity.indexName}`);
  const expectedAsset = identity.assets.find((asset) => /algolia-chat-stability-[a-f0-9]{12}\.js/.test(asset.url));
  if (!expectedAsset) throw new Error('RUN_BLOCKED_TARGET_IDENTITY: stability chat asset is not live');

  const runId = createRunId();
  const secret = randomBytes(32);
  const spool = new AppendOnlyJsonlSpool(safeRoot, 'phase0/observations.jsonl');
  const browser = await chromium.launch({ headless });
  const results = [];
  try {
    for (let repetition = 0; repetition < repetitions; repetition += 1) {
      const contextId = deriveSafeId(runId, 'context', repetition, secret);
      const context = await browser.newContext();
      const recorder = new BrowserRecorder({ spool, identity: { runId, stageId: 'phase0', hostId: 'local', browserContextId: contextId } });
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
          at: Date.now(),
          request,
          bodyHash: hashRequestBody(request),
          responseStatus: null,
        });
        if (isCompletion(request.url())) completionRequests.push({ at: Date.now(), url: request.url() });
      });
      page.on('response', (response) => {
        const entry = primaryRequests.find((candidate) => candidate.request === response.request());
        if (entry) entry.responseStatus = response.status();
      });
      const journey = { repetition, contextId, turns: [], pass: false };
      try {
        await page.goto(`${TARGET.origin}/?stability_phase0=${runId}-${repetition}`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        await page.waitForFunction(() => customElements.get('algolia-chat') && document.querySelector('algolia-chat'), null, { timeout: 30_000 });
        const completionRoles = await runtimeCompletionRoles(page);
        const runtime = await page.evaluate(() => {
          const owner = document.querySelector('algolia-chat')?.closest('algolia-instant-search') ?? document.querySelector('algolia-chat');
          return { appId: owner?.getAttribute('app-id'), indexName: owner?.getAttribute('index-name') };
        });
        if (runtime.appId !== TARGET.appId || runtime.indexName !== TARGET.indexName) throw new Error(`wrong-target:${JSON.stringify(runtime)}`);

        const firstQuestion = 'Our search results suddenly return zero hits for queries that worked yesterday. Where should I start troubleshooting?';
        let start = primaryRequests.length;
        let completionStart = completionRequests.length;
        await page.evaluate((question) => {
          const chat = document.querySelector('algolia-chat');
          chat.open();
          chat.ask(question);
        }, firstQuestion);
        const firstResult = await waitForTurn(page, 0);
        const first = firstResult.turn;
        let traffic = completionTraffic(primaryRequests.slice(start));
        let fanout = classifyCompletionFanout(completionRequests.slice(completionStart), completionRoles);
        let backgroundCompletionAttempts = fanout.specialist + fanout.unknown;
        const firstObservation = turnObservation({ turn: first, query: firstQuestion, traffic, backgroundCompletionAttempts, pageCrashed });
        const firstVerdict = evaluateMechanicalTurn(firstObservation);
        journey.turns.push({ turn: 1, query: firstQuestion, consentActions: firstResult.consentActions, traffic, fanout, observation: firstObservation, verdict: firstVerdict });
        if (!firstVerdict.pass) throw new Error(`turn-1:${firstVerdict.failures.join(',')}`);

        const discoveryQuestion = await page.evaluate(() => {
          const root = document.querySelector('algolia-chat')?.shadowRoot;
          const button = root?.querySelector('.acs-followup-card');
          if (!button) return null;
          return button.textContent?.trim() ?? '';
        });
        if (!discoveryQuestion) throw new Error('missing-discovery-action');
        const discoveryAnswer = 'We use a custom Node.js reindexing script, and the zero-result problem started after its most recent deployment.';
        start = primaryRequests.length;
        completionStart = completionRequests.length;
        const composer = page.locator('algolia-chat').locator('#acs-composer-input');
        await composer.waitFor({ state: 'visible', timeout: 10_000 });
        await page.waitForFunction(() => {
          const input = document.querySelector('algolia-chat')?.shadowRoot?.querySelector('#acs-composer-input');
          return input && !input.disabled;
        }, null, { timeout: 10_000 });
        await composer.fill(discoveryAnswer);
        await composer.press('Enter');
        const secondResult = await waitForTurn(page, 1);
        const second = secondResult.turn;
        traffic = completionTraffic(primaryRequests.slice(start));
        fanout = classifyCompletionFanout(completionRequests.slice(completionStart), completionRoles);
        backgroundCompletionAttempts = fanout.specialist + fanout.unknown;
        const secondObservation = turnObservation({ turn: second, query: discoveryAnswer, traffic, backgroundCompletionAttempts, pageCrashed });
        const secondVerdict = evaluateMechanicalTurn(secondObservation);
        journey.turns.push({
          turn: 2,
          discoveryPrompt: discoveryQuestion,
          query: discoveryAnswer,
          consentActions: secondResult.consentActions,
          traffic,
          fanout,
          observation: secondObservation,
          verdict: secondVerdict,
        });
        if (!secondVerdict.pass) throw new Error(`turn-2:${secondVerdict.failures.join(',')}`);
        if (prohibitedUrl) throw new Error('production-request');
        journey.pass = true;
      } catch (error) {
        journey.error = error instanceof Error ? error.message : String(error);
        const screenshot = path.join(safeRoot, 'phase0', `failure-${String(repetition + 1).padStart(2, '0')}.png`);
        fs.mkdirSync(path.dirname(screenshot), { recursive: true, mode: 0o700 });
        await page.screenshot({ path: screenshot, fullPage: true }).catch(() => {});
      } finally {
        journey.finalState = await persistedState(page).catch(() => null);
        results.push(journey);
        spool.append({ schema: 'Phase0Journey.v1', at: new Date().toISOString(), runId, stageId: 'phase0', journey });
        await recorder.flush();
        await context.close();
      }
      process.stdout.write(`${JSON.stringify({ progress: repetition + 1, repetitions, pass: journey.pass, error: journey.error ?? null })}\n`);
      if (!journey.pass) break;
    }
  } finally {
    await browser.close();
    spool.close();
  }
  const completed = results.length;
  const passed = results.filter((result) => result.pass).length;
  const summary = {
    schema: 'Phase0SmokeSummary.v1',
    runId,
    target: TARGET.origin,
    indexName: TARGET.indexName,
    asset: expectedAsset,
    repetitionsRequested: repetitions,
    repetitionsCompleted: completed,
    journeysPassed: passed,
    turnsExpected: repetitions * 2,
    turnsPassed: results.flatMap((result) => result.turns).filter((turn) => turn.verdict.pass).length,
    pass: completed === repetitions && passed === repetitions,
    evidenceClass: 'CLIENT_OBSERVABLE',
    results,
  };
  const summaryPath = writePrivateFile(safeRoot, 'phase0/summary.json', `${JSON.stringify(summary, null, 2)}\n`);
  return { ...summary, summaryPath };
}

export { prohibitedRequest };
