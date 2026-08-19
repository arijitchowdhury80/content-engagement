#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const DEFAULT_BASE_URL = 'https://tmp-content-eng-algolia.cloud.jahia.com';
const JAHIA_ORIGIN = new URL(DEFAULT_BASE_URL).origin;
const DEFAULT_OUT_DIR =
  'docs/evidence/visitor-intelligence/2026-08-17-runtime-i-live-journeys';
const SENSITIVE_HEADER = /^(authorization|cookie|set-cookie|x-algolia-api-key)$/i;

export const JOURNEYS = [
  {
    id: 'T1',
    number: '01',
    trigger: 'product_page_10s_50_scroll',
    startPath: '/products/ai-search',
    response: 'How can a non-technical merchandising team operate AI Search day to day after implementation?',
    continuityPath: '/products/ai-recommendations',
    followUp: 'Now that I am looking at AI Recommendations too, how should the merchandising team divide its day-to-day work between Search and Recommendations?',
  },
  {
    id: 'T2',
    number: '02',
    trigger: 'product_to_documentation',
    sourceTrigger: 'product_page_10s_50_scroll',
    startPath: '/products/ai-search',
    targetPath: '/sites/www/doc/guides/building-search-ui/what-is-instantsearch/js',
    targetSelector: 'a[data-algolia-internal-doc-link="instantsearch-js"]',
    qualifyTarget: true,
    response: 'What should a credible React InstantSearch proof of concept include?',
    continuityPath: '/products/ai-search',
    followUp: 'Back on the product page, which proof-of-concept decision should I make first?',
  },
  {
    id: 'B1',
    number: '03',
    trigger: 'solution_page_10s_50_scroll',
    startPath: '/industries/grocery',
    response: 'Which grocery discovery problems usually create the largest commercial drag?',
    continuityPath: '/industries/ecommerce',
    followUp: 'How would those priorities change for a broader ecommerce business?',
  },
  {
    id: 'B2',
    number: '04',
    trigger: 'solution_to_customer_story',
    sourceTrigger: 'solution_page_10s_50_scroll',
    startPath: '/industries/grocery',
    targetPath: '/customers/h-e-b-mexico',
    targetSelector: 'a[href*="/customers/h-e-b-mexico"]',
    qualifyTarget: true,
    response: 'Which verified outcomes make this story relevant to another grocery business?',
    continuityPath: '/industries/grocery',
    followUp: 'Back on Grocery, which of those outcomes should an evaluation team validate first?',
  },
  {
    id: 'C1',
    number: '05',
    trigger: 'product_to_pricing',
    sourceTrigger: 'product_page_10s_50_scroll',
    startPath: '/products/ai-search',
    targetPath: '/pricing',
    targetSelector: 'a[href="/pricing"]',
    qualifyTarget: false,
    response: 'What drives AI Search cost, and how should I scope a realistic evaluation without overbuying?',
    continuityPath: '/products/ai-search',
    followUp: 'Back on AI Search, what implementation variable is most likely to change that estimate?',
  },
  {
    id: 'C2',
    number: '06',
    trigger: 'solution_to_pricing',
    sourceTrigger: 'solution_page_10s_50_scroll',
    startPath: '/industries/grocery',
    targetPath: '/pricing',
    targetSelector: 'a[href="/pricing"]',
    qualifyTarget: false,
    response: 'How should a grocery team connect cost to conversion, basket size, and operating effort?',
    continuityPath: '/industries/grocery',
    followUp: 'Back on Grocery, which business input should I quantify first?',
  },
  {
    id: 'S1',
    number: '07',
    trigger: 'developer_page_10s_50_scroll',
    specialistExpected: true,
    startPath: '/developers',
    response: 'How should I structure records, events, ranking, and frontend responsibilities for an implementation proof of concept?',
    continuityPath: '/products/features/ui-component-libraries',
    followUp: 'Now that I am looking at the UI libraries, how should that change the proof-of-concept boundary?',
  },
  {
    id: 'S2',
    number: '08',
    trigger: 'resource_page_10s_50_scroll',
    specialistExpected: true,
    startPath: '/resources/asset/infographic-unlock-the-power-of-agentic-ai',
    response: 'What is this resource’s business takeaway, what evidence supports it, and what should an evaluation team investigate next?',
    continuityPath: '/resources/asset/ebook-merchandising-edge-with-aws-and-algolia',
    followUp: 'How does this second resource sharpen the business case?',
  },
];

export const LOCAL_JOURNEY_OVERRIDES = Object.freeze({
  T1: {
    startPath: '/products/ai-search',
    continuityPath: '/products/ai-recommendations',
  },
  T2: {
    startPath: '/products/ai-search',
    targetPath: '/doc/guides/building-search-ui/what-is-instantsearch/js/',
    targetSelector: '#product-docs-cta',
    continuityPath: '/products/ai-search',
  },
  B1: {
    startPath: '/solutions/ecommerce',
    continuityPath: '/solutions/marketplace',
  },
  B2: {
    startPath: '/solutions/ecommerce',
    targetPath: '/customers/harry-rosen',
    targetSelector: 'a[href="/customers/harry-rosen"]',
    continuityPath: '/solutions/ecommerce',
  },
  C1: {
    startPath: '/products/ai-search',
    targetPath: '/pricing',
    targetSelector: 'a[href="/pricing"]',
    continuityPath: '/products/ai-search',
  },
  C2: {
    startPath: '/solutions/ecommerce',
    targetPath: '/pricing',
    targetSelector: 'a[href="/pricing"]',
    continuityPath: '/solutions/ecommerce',
  },
  S1: {
    startPath: '/developers',
    response: 'Bring in the Developer Specialist to help me scope a safe implementation proof of concept.',
    continuityPath: '/doc/guides/building-search-ui/what-is-instantsearch/js/',
  },
  S2: {
    startPath: '/resources',
    response: 'Bring in the Evidence Specialist to test the claims and evidence behind this resource.',
    continuityPath: '/products/ai-search',
  },
});

export function redactHeaders(headers = {}) {
  return Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [
      name,
      SENSITIVE_HEADER.test(name) ? '[REDACTED]' : value,
    ])
  );
}

function collectHits(value, hits = []) {
  if (!value || typeof value !== 'object') return hits;
  if (Array.isArray(value)) {
    value.forEach((item) => collectHits(item, hits));
    return hits;
  }
  if (Array.isArray(value.hits)) value.hits.forEach((hit) => hits.push(hit));
  for (const nested of Object.values(value)) {
    if (nested && typeof nested === 'object') collectHits(nested, hits);
  }
  return hits;
}

function normalizedAnswerText(value = '') {
  return value.replace(/\s+/g, ' ').trim().toLowerCase();
}

function specialistIsLimitation(value = '') {
  return /\b(?:cannot|can't|could not|couldn't|unable to|do not have|don't have|no (?:relevant|supporting|matching|grounded) (?:source|sources|evidence|result|results)|not enough (?:source|sources|evidence)|could not find|couldn't find|did not find|didn't find)\b/i.test(value);
}

const EVIDENCE_HIT_FIELDS = [
  'url', 'permalink', 'link', 'href', 'marketing_url', 'marketingUrl',
  'title', 'name', 'display_name', 'displayName', 'heading', 'label',
  'source', 'category', 'type',
  'body', 'content', 'text', 'snippet', 'summary', 'description', 'excerpt', 'abstract',
];

function isUsableEvidenceHit(hit) {
  return Boolean(
    hit &&
    typeof hit === 'object' &&
    !Array.isArray(hit) &&
    EVIDENCE_HIT_FIELDS.some((field) =>
      typeof hit[field] === 'string' && hit[field].trim()
    )
  );
}

function specialistAddsSourcedDepth(specialistResponse, primaryResponse) {
  const specialistText = specialistResponse?.parsedSse?.text || '';
  const primaryText = primaryResponse?.parsedSse?.text || '';
  const hits = collectHits(specialistResponse?.parsedSse?.toolOutputs || []);
  return Boolean(
    specialistText.trim() &&
    hits.some(isUsableEvidenceHit) &&
    !specialistIsLimitation(specialistText) &&
    normalizedAnswerText(specialistText) !== normalizedAnswerText(primaryText)
  );
}

export function parseAgentStudioSse(body = '') {
  const result = { text: '', toolCalls: [], toolOutputs: [], sourceCategories: [] };
  const categories = new Set();

  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) continue;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;

    let event;
    try {
      event = JSON.parse(payload);
    } catch {
      continue;
    }

    if (event.type === 'text-delta' && typeof event.delta === 'string') {
      result.text += event.delta;
    }
    if (event.type === 'tool-input-available') {
      result.toolCalls.push({
        toolCallId: event.toolCallId || '',
        toolName: event.toolName || '',
        input: event.input || {},
      });
    }
    if (event.type === 'tool-output-available') {
      result.toolOutputs.push({
        toolCallId: event.toolCallId || '',
        output: event.output,
      });
      for (const hit of collectHits(event.output)) {
        const category = hit?.source || hit?.category || hit?.type;
        if (typeof category === 'string' && category.trim()) categories.add(category.trim());
      }
    }
  }

  result.sourceCategories = [...categories].sort();
  return result;
}

function userMessageText(entry) {
  const messages = entry?.postData?.messages;
  if (!Array.isArray(messages)) return '';
  const userMessage = [...messages].reverse().find((message) => message?.role === 'user');
  return (userMessage?.parts || [])
    .filter((part) => part?.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('\n');
}

function greetingOpportunityId(entry) {
  const text = userMessageText(entry);
  if (!text.startsWith('PROACTIVE_GREETING_REQUEST\n')) return null;
  try {
    return JSON.parse(text.slice('PROACTIVE_GREETING_REQUEST\n'.length)).opportunityId || null;
  } catch {
    return null;
  }
}

function responseForRequest(network, request, boundaryId) {
  return network
    .filter((entry) =>
      entry.phase === 'response' &&
      entry.id > request.id &&
      entry.id <= boundaryId &&
      (entry.requestId === request.id || (
        entry.requestId == null &&
        entry.agentId === request.agentId &&
        entry.url === request.url
      ))
    )
    .sort((left, right) => left.id - right.id)[0] || null;
}

export function analyzeHostedCompletionTraffic(network = [], {
  orchestratorAgentId,
  specialistAgentIds = [],
  specialistExpected = false,
  specialistAction = 'accept',
  visitorResponseBoundaryId,
  firstTurnBoundaryId,
} = {}) {
  const errors = [];
  const requests = network.filter((entry) => entry?.phase === 'request');
  const greetings = requests
    .map((entry) => ({ entry, opportunityId: greetingOpportunityId(entry) }))
    .filter(({ opportunityId }) => opportunityId);
  const byOpportunity = {};
  for (const { opportunityId } of greetings) {
    byOpportunity[opportunityId] = (byOpportunity[opportunityId] || 0) + 1;
  }
  if (!greetings.length) errors.push('No greeting requests were captured');
  for (const [opportunityId, count] of Object.entries(byOpportunity)) {
    if (count !== 1) errors.push(`${opportunityId} emitted ${count} greeting requests; expected 1`);
  }

  const greetingsAfterVisitorResponse = greetings.filter(
    ({ entry }) => entry.id > visitorResponseBoundaryId
  ).length;
  if (greetingsAfterVisitorResponse) {
    errors.push(`${greetingsAfterVisitorResponse} greeting request(s) emitted after visitor response`);
  }

  const firstTurnRequests = requests.filter((entry) =>
    entry.agentId === orchestratorAgentId &&
    entry.id > visitorResponseBoundaryId &&
    entry.id <= firstTurnBoundaryId
  );
  const logicalVisitorTurns = new Set(firstTurnRequests.map(userMessageText).filter(Boolean));
  if (logicalVisitorTurns.size !== 1) {
    errors.push(
      `Configured orchestrator ${orchestratorAgentId || '(missing)'} received ` +
      `${logicalVisitorTurns.size} logical first turns across ${firstTurnRequests.length} HTTP requests; expected 1`
    );
  }
  const firstTurnRequest = firstTurnRequests[0] || null;
  const handoffBlocks = firstTurnRequest
    ? userMessageText(firstTurnRequest).split('PROACTIVE_HANDOFF_CONTEXT\n').length - 1
    : 0;
  if (handoffBlocks !== 1) {
    errors.push(`First-turn orchestrator request contained ${handoffBlocks} handoff blocks; expected 1`);
  }

  const firstTurnResponses = firstTurnRequests
    .map((request) => responseForRequest(network, request, firstTurnBoundaryId))
    .filter(Boolean);
  const firstTurnResponse = [...firstTurnResponses].reverse().find(
    (response) => (response.parsedSse?.text || '').trim()
  ) || firstTurnResponses.at(-1) || null;
  const orchestratorToolRouted = firstTurnResponses.some((response) => response?.parsedSse?.toolCalls?.some(
    (call) => call?.toolName === 'ask_specialist'
  ));
  const configuredSpecialistRequests = requests.filter((entry) =>
    specialistAgentIds.includes(entry.agentId) &&
    entry.id > (firstTurnRequest?.id || visitorResponseBoundaryId) &&
    entry.id <= firstTurnBoundaryId
  );
  const expectedSpecialistRequests = specialistExpected && specialistAction === 'accept' ? 1 : 0;
  if (configuredSpecialistRequests.length !== expectedSpecialistRequests) {
    errors.push(
      `Configured specialists received ${configuredSpecialistRequests.length} first-turn request(s); ` +
      `expected ${expectedSpecialistRequests}`
    );
  }
  const deterministicClientRouted = !orchestratorToolRouted && configuredSpecialistRequests.length > 0;
  const routedToSpecialist = orchestratorToolRouted || deterministicClientRouted;
  const routingMode = orchestratorToolRouted
    ? 'orchestrator_tool'
    : deterministicClientRouted
      ? 'deterministic_client'
      : null;
  const specialistRequest = configuredSpecialistRequests[0] || null;
  const specialistResponse = specialistRequest
    ? responseForRequest(network, specialistRequest, firstTurnBoundaryId)
    : null;
  if (specialistExpected && !routedToSpecialist) {
    errors.push('Expected specialist routing, but no orchestrator or deterministic client route was captured');
  }
  if (specialistExpected && specialistAction === 'decline' && configuredSpecialistRequests.length) {
    errors.push('Specialist was declined, but a configured specialist request was still sent');
  }
  const specialistOutcome = specialistResponse
    ? (specialistAddsSourcedDepth(specialistResponse, firstTurnResponse) ? 'additive' : 'demoted')
    : null;
  const authoritativeResponse = specialistOutcome === 'additive'
      ? specialistResponse
      : firstTurnResponse;
  const visibleResponses = specialistOutcome === 'additive'
    ? [firstTurnResponse, specialistResponse].filter(Boolean)
    : [authoritativeResponse].filter(Boolean);
  const visibleResponderAgentIds = [
    ...new Set(visibleResponses.map((response) => response.agentId).filter(Boolean)),
  ];
  const responseTextLength = visibleResponses.reduce(
    (length, response) => length + (response.parsedSse?.text || '').trim().length,
    0
  );
  if (!firstTurnResponse) {
    errors.push('First-turn orchestrator response was not captured');
  } else {
    if (firstTurnResponse.status !== 200) {
      errors.push(`First-turn orchestrator response returned status ${firstTurnResponse.status}`);
    }
    if (orchestratorToolRouted && specialistAction !== 'decline' && !specialistRequest) {
      errors.push('Orchestrator routed to a specialist, but no configured specialist request was captured');
    } else if (specialistResponse && specialistResponse.status !== 200) {
      errors.push(`First-turn specialist response returned status ${specialistResponse.status}`);
    }
    if (!responseTextLength) {
      errors.push('First-turn orchestrator response did not contain nonempty streamed text');
    }
  }

  const continuityRequests = requests.filter((entry) =>
    entry.agentId === orchestratorAgentId && entry.id > firstTurnBoundaryId
  );
  return {
    pass: errors.length === 0,
    errors,
    greetings: {
      requests: greetings.length,
      byOpportunity,
      afterVisitorResponse: greetingsAfterVisitorResponse,
    },
    firstTurn: {
      orchestratorAgentId: orchestratorAgentId || null,
      orchestratorRequests: firstTurnRequests.length,
      handoffBlocks,
      requestId: firstTurnRequest?.id || null,
      responseId: authoritativeResponse?.id || firstTurnResponse?.id || null,
      responseStatus: authoritativeResponse?.status ?? firstTurnResponse?.status ?? null,
      responseTextLength,
      routedToSpecialist,
      routingMode,
      specialistRequests: configuredSpecialistRequests.length,
      specialistAction: specialistExpected ? specialistAction : null,
      specialistOutcome,
      visibleResponderAgentIds,
      finalResponderAgentId: authoritativeResponse?.agentId || null,
    },
    continuity: {
      orchestratorRequests: continuityRequests.length,
    },
  };
}

export function analyzeLocalCompletionState({
  greetingRequests = [],
  orchestratorRequests = [],
  specialistRequests = [],
} = {}, {
  specialistExpected = false,
  expectedOrchestratorRequests = 1,
} = {}) {
  const errors = [];
  const byOpportunity = {};
  for (const request of greetingRequests) {
    const opportunityId = request?.opportunityId || '(missing)';
    byOpportunity[opportunityId] = (byOpportunity[opportunityId] || 0) + 1;
  }
  if (!greetingRequests.length) errors.push('No local greeting requests were recorded');
  for (const [opportunityId, count] of Object.entries(byOpportunity)) {
    if (count !== 1) errors.push(`${opportunityId} emitted ${count} local greeting requests; expected 1`);
  }
  if (orchestratorRequests.length !== expectedOrchestratorRequests) {
    errors.push(
      `Local orchestrator received ${orchestratorRequests.length} request(s); ` +
      `expected ${expectedOrchestratorRequests}`
    );
  }
  const firstRequest = orchestratorRequests[0] || null;
  const firstText = userMessageText({ postData: firstRequest });
  const handoffBlocks = firstText.split('PROACTIVE_HANDOFF_CONTEXT\n').length - 1;
  if (handoffBlocks !== 1) {
    errors.push(`Local first-turn request contained ${handoffBlocks} handoff blocks; expected 1`);
  }
  if (specialistExpected && specialistRequests.length !== 1) {
    errors.push(`Local specialist received ${specialistRequests.length} request(s); expected 1`);
  }
  if (!specialistExpected && specialistRequests.length) {
    errors.push(`Unexpected local specialist request count: ${specialistRequests.length}`);
  }
  return {
    pass: errors.length === 0,
    errors,
    greetings: { requests: greetingRequests.length, byOpportunity, afterVisitorResponse: 0 },
    firstTurn: {
      orchestratorRequests: orchestratorRequests.length,
      handoffBlocks,
      routedToSpecialist: specialistRequests.length > 0,
      routingMode: specialistRequests.length ? 'local_fixture' : null,
      specialistRequests: specialistRequests.length,
    },
    continuity: {
      orchestratorRequests: Math.max(0, orchestratorRequests.length - 1),
    },
  };
}

export function analyzeResetTransition(preseed = {}, post = {}) {
  const checks = {
    preseedCaptured: Boolean(
      preseed.profileVisitorId &&
      preseed.sessionId &&
      preseed.proactiveOpportunityId &&
      preseed.conversationId &&
      preseed.handoffOpportunityId
    ),
    freshProfile: Boolean(post.profileVisitorId && post.profileVisitorId !== preseed.profileVisitorId),
    freshSession: Boolean(post.sessionId && post.sessionId !== preseed.sessionId),
    eventsReset: Array.isArray(post.eventNames) &&
      post.eventNames.includes('page_view') &&
      !post.eventNames.includes('reset_probe_event'),
    proactiveCleared: post.proactiveOpportunityId == null,
    conversationCleared: post.conversationId == null,
    handoffCleared: post.handoffOpportunityId == null,
    unrelatedStatePreserved:
      post.unrelatedLocal === preseed.unrelatedLocal &&
      post.unrelatedSession === preseed.unrelatedSession,
  };
  const messages = {
    preseedCaptured: 'reset preseed state was not fully retained',
    freshProfile: 'profile visitor ID was not replaced',
    freshSession: 'session ID was not replaced',
    eventsReset: 'event state was not reset to a fresh page view',
    proactiveCleared: 'proactive state was not cleared',
    conversationCleared: 'conversation state was not cleared',
    handoffCleared: 'handoff state was not cleared',
    unrelatedStatePreserved: 'unrelated storage state was not preserved',
  };
  const errors = Object.entries(checks)
    .filter(([, passed]) => !passed)
    .map(([name]) => messages[name]);
  return { pass: errors.length === 0, errors, checks, preseed, post };
}

export function analyzeDiscoveryCardinality({
  visibleWraps = 0,
  visibleQuestions = 0,
  questions = [],
} = {}) {
  const normalizedQuestions = questions.map((question) => String(question).trim()).filter(Boolean);
  const errors = [];
  if (visibleWraps !== 1) {
    errors.push(`Rendered ${visibleWraps} visible discovery wrappers; expected exactly 1`);
  }
  if (visibleQuestions !== 1) {
    errors.push(`Rendered ${visibleQuestions} visible discovery questions; expected exactly 1`);
  }
  if (normalizedQuestions.length !== 1) {
    errors.push(`Found ${normalizedQuestions.length} nonempty discovery questions; expected exactly 1`);
  }
  return {
    pass: errors.length === 0,
    errors,
    visibleWraps,
    visibleQuestions,
    questions: normalizedQuestions,
  };
}

function requireVerification(report, label) {
  if (!report.pass) throw new Error(`${label} failed:\n- ${report.errors.join('\n- ')}`);
  return report;
}

export function parseArgs(argv) {
  const args = {
    baseUrl: DEFAULT_BASE_URL,
    outDir: DEFAULT_OUT_DIR,
    headed: true,
    slowMo: 80,
    journey: 'T1',
    specialistAction: 'accept',
    local: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--help' || value === '-h') args.help = true;
    else if (value === '--headless') args.headed = false;
    else if (value === '--local') args.local = true;
    else if (value === '--base-url') args.baseUrl = argv[++index];
    else if (value === '--out-dir') args.outDir = argv[++index];
    else if (value === '--slow-mo') args.slowMo = Number(argv[++index]);
    else if (value === '--journey') args.journey = argv[++index].toUpperCase();
    else if (value === '--response') args.response = argv[++index];
    else if (value === '--follow-up') args.followUp = argv[++index];
    else if (value === '--specialist-action') args.specialistAction = argv[++index].toLowerCase();
  }
  return args;
}

function printUsage() {
  console.log(`Usage: node tools/inspection/capture_hosted_journey.mjs [options]

Options:
  --journey ID       One of T1, T2, B1, B2, C1, C2, S1, S2 (default: T1)
  --base-url URL     Site origin (default: internal Jahia)
  --out-dir PATH     Evidence directory
  --slow-mo MS       Visible browser action delay (default: 80)
  --headless         Run without a visible browser
  --local            Verify the local parity fixture using its storage-backed call log
  --response TEXT    Override the journey's natural visitor response
  --follow-up TEXT   Override the continuity follow-up
  --specialist-action ACTION  Accept or decline a specialist offer (default: accept)
  -h, --help         Print this help without launching a browser`);
}

function isCapturedUrl(url) {
  return /agent-studio\/1\/agents\/[^/]+\/completions/i.test(url);
}

function agentIdFromUrl(url) {
  return url.match(/agent-studio\/1\/agents\/([^/]+)\/completions/i)?.[1] || null;
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function scrollToDepth(page, depth) {
  const target = await page.evaluate((requestedDepth) => {
    const max = Math.max(0, document.documentElement.scrollHeight - innerHeight);
    return Math.round(max * requestedDepth);
  }, depth);
  const current = await page.evaluate(() => scrollY);
  if (current > target) {
    await page.evaluate((targetY) => window.scrollTo(0, targetY), target);
    return;
  }
  const distance = target - current;
  const steps = 6;
  for (let step = 1; step <= steps; step += 1) {
    await page.mouse.wheel(0, Math.ceil(distance / steps));
    await page.waitForTimeout(180);
  }
}

async function waitForRuntime(page) {
  await page.waitForFunction(
    () =>
      Boolean(window.algoliaProactiveController) &&
      Boolean(window.algoliaContextCompiler) &&
      Boolean(document.querySelector('algolia-chat')),
    null,
    { timeout: 30_000 }
  );
}

async function seedResetProbe(page) {
  return page.evaluate(() => {
    const profileVisitorId = 'reset_probe_visitor';
    const sessionId = 'reset_probe_session';
    const opportunityId = 'reset_probe_opportunity';
    const conversationId = 'reset_probe_conversation';
    localStorage.setItem('algolia_profile', JSON.stringify({
      schema: 'AlgoliaEngagementProfile.v1',
      visitorId: profileVisitorId,
    }));
    localStorage.setItem('hosted_reset_probe_local', 'reset_probe_keep_local');
    sessionStorage.setItem('algolia_session', JSON.stringify({
      schema: 'AlgoliaEngagementSession.v1',
      sessionId,
      pages: [],
    }));
    sessionStorage.setItem('algolia_events', JSON.stringify({
      schema: 'AlgoliaEngagementEvents.v1',
      sessionId,
      events: [{ name: 'reset_probe_event' }],
    }));
    sessionStorage.setItem('algolia_proactive_state', JSON.stringify({
      schema: 'AlgoliaProactiveState.v1',
      opportunities: [{ id: opportunityId }],
    }));
    sessionStorage.setItem('algolia-chat:conversation', JSON.stringify({
      version: 1,
      conversationId,
      turns: [],
    }));
    sessionStorage.setItem('algolia-chat:handoff-context', JSON.stringify({
      schema: 'ProactiveHandoffContext.v1',
      opportunityId,
    }));
    sessionStorage.setItem('hosted_reset_probe_session', 'reset_probe_keep_session');
    return {
      profileVisitorId,
      sessionId,
      proactiveOpportunityId: opportunityId,
      conversationId,
      handoffOpportunityId: opportunityId,
      unrelatedLocal: localStorage.getItem('hosted_reset_probe_local'),
      unrelatedSession: sessionStorage.getItem('hosted_reset_probe_session'),
    };
  });
}

async function readResetProbe(page) {
  return page.evaluate(() => {
    const read = (storage, key) => {
      try {
        return JSON.parse(storage.getItem(key) || 'null');
      } catch {
        return null;
      }
    };
    const profile = read(localStorage, 'algolia_profile');
    const session = read(sessionStorage, 'algolia_session');
    const events = read(sessionStorage, 'algolia_events');
    const proactive = read(sessionStorage, 'algolia_proactive_state');
    const conversation = read(sessionStorage, 'algolia-chat:conversation');
    const handoff = read(sessionStorage, 'algolia-chat:handoff-context');
    return {
      profileVisitorId: profile?.visitorId || null,
      sessionId: session?.sessionId || null,
      eventNames: (events?.events || []).map((event) => event?.name).filter(Boolean),
      proactiveOpportunityId: proactive?.opportunities?.[0]?.id || null,
      conversationId: conversation?.conversationId || null,
      handoffOpportunityId: handoff?.opportunityId || null,
      unrelatedLocal: localStorage.getItem('hosted_reset_probe_local'),
      unrelatedSession: sessionStorage.getItem('hosted_reset_probe_session'),
    };
  });
}

async function resetThroughWidget(page) {
  const launcher = page.getByRole('button', { name: /open ai chat/i });
  if (await launcher.isVisible().catch(() => false)) {
    await launcher.click();
  }
  const reset = page.getByRole('button', { name: /reset conversation/i });
  await reset.waitFor({ state: 'visible', timeout: 20_000 });
  await reset.click();
  await page.waitForTimeout(700);
}

async function runtimeSnapshot(page) {
  return page.evaluate(() => {
    const read = (storage, key) => {
      const raw = storage.getItem(key);
      if (!raw) return null;
      try {
        return JSON.parse(raw);
      } catch {
        return raw;
      }
    };
    const controller = window.algoliaProactiveController?.debug?.() || null;
    return {
      url: location.href,
      title: document.title,
      controller,
      profile: read(localStorage, 'algolia_profile'),
      session: read(sessionStorage, 'algolia_session'),
      events: read(sessionStorage, 'algolia_events'),
      proactiveState: read(sessionStorage, 'algolia_proactive_state'),
      conversation: read(sessionStorage, 'algolia-chat:conversation'),
      bodyText: document.body.innerText,
    };
  });
}

async function waitForNetworkSettled(network, pendingResponses, {
  minimumRequests = 1,
  timeoutMs = 150_000,
} = {}) {
  const deadline = Date.now() + timeoutMs;
  let stableSince = 0;
  while (Date.now() < deadline) {
    const requests = network.filter((entry) => entry.phase === 'request');
    const responseRequestIds = new Set(
      network
        .filter((entry) => entry.phase === 'response' && entry.requestId)
        .map((entry) => entry.requestId)
    );
    const settled =
      requests.length >= minimumRequests &&
      requests.every((entry) => responseRequestIds.has(entry.id));
    if (settled) {
      if (!stableSince) stableSince = Date.now();
      if (Date.now() - stableSince >= 1500) return;
    } else {
      stableSince = 0;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  const requests = network.filter((entry) => entry.phase === 'request').length;
  const responses = network.filter((entry) => entry.phase === 'response').length;
  throw new Error(`Network did not settle: ${requests} completion request(s), ${responses} response(s)`);
}

async function openChatIfClosed(page) {
  const launcher = page.getByRole('button', { name: /open ai chat/i });
  if (await launcher.isVisible().catch(() => false)) await launcher.click();
}

async function waitForShownOpportunity(page, trigger, timeout = 45_000) {
  await page.waitForFunction(
    (expectedTrigger) => {
      const state = JSON.parse(sessionStorage.getItem('algolia_proactive_state') || '{}');
      return (state.opportunities || []).some(
        (item) => item.trigger === expectedTrigger && item.status === 'shown'
      );
    },
    trigger,
    { timeout }
  );
}

async function waitForVisibleOpportunity(page, trigger, timeout = 45_000) {
  await page.waitForFunction(
    (expectedTrigger) => {
      const state = JSON.parse(sessionStorage.getItem('algolia_proactive_state') || '{}');
      const opportunity = [...(state.opportunities || [])]
        .reverse()
        .find((item) => item.trigger === expectedTrigger && item.status === 'shown');
      const greeting = opportunity?.greetingResponse?.greeting?.trim();
      const widgetText = document.querySelector('algolia-chat')?.shadowRoot?.textContent || '';
      return Boolean(greeting && widgetText.includes(greeting));
    },
    trigger,
    { timeout }
  );
}

async function qualifyPage(page) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(5_500);
  await scrollToDepth(page, 0.3);
}

async function readLocalCompletionState(page) {
  return page.evaluate(() => {
    const read = (key) => {
      try {
        return JSON.parse(sessionStorage.getItem(key) || '[]');
      } catch {
        return [];
      }
    };
    return {
      greetingRequests: read('algolia-local-greeting-requests'),
      orchestratorRequests: read('algolia-local-orchestrator-requests'),
      specialistRequests: read('algolia-local-specialist-requests'),
    };
  });
}

async function waitForLocalCompletionState(page, {
  orchestratorRequests,
  specialistRequests = 0,
} = {}) {
  await page.waitForFunction(
    ({ expectedOrchestrator, expectedSpecialist }) => {
      const read = (key) => {
        try {
          return JSON.parse(sessionStorage.getItem(key) || '[]');
        } catch {
          return [];
        }
      };
      return read('algolia-local-orchestrator-requests').length >= expectedOrchestrator &&
        read('algolia-local-specialist-requests').length >= expectedSpecialist;
    },
    { expectedOrchestrator: orchestratorRequests, expectedSpecialist: specialistRequests },
    { timeout: 30_000 }
  );
}

async function acceptSpecialistOfferIfPresent(page, timeout = 45_000, action = 'accept') {
  if (!['accept', 'decline'].includes(action)) {
    throw new Error(`Unsupported specialist action: ${action}`);
  }
  const namedAccept = page.getByRole('button', { name: /go deeper|bring.*specialist/i });
  const namedDecline = page.getByRole('button', { name: /no thanks|not now|skip/i });
  const consentGroupAccept = page
    .getByRole('group', { name: /deep-dive offer/i })
    .getByRole('button')
    .first();
  const consentGroupDecline = page
    .getByRole('group', { name: /deep-dive offer/i })
    .getByRole('button')
    .last();
  // A deterministic specialist offer is evaluated after the complete primary
  // answer and judge cycle. Sources can render much earlier, so they are not a
  // valid boundary for ending this wait.
  await Promise.race([
    namedAccept.waitFor({ state: 'visible', timeout }),
    namedDecline.waitFor({ state: 'visible', timeout }),
    consentGroupAccept.waitFor({ state: 'visible', timeout }),
  ]).catch(() => {});
  const control = action === 'decline'
    ? ((await namedDecline.isVisible().catch(() => false)) ? namedDecline : consentGroupDecline)
    : ((await namedAccept.isVisible().catch(() => false)) ? namedAccept : consentGroupAccept);
  if (await control.isVisible().catch(() => false)) {
    await control.click({ timeout: 10_000 });
    return true;
  }
  console.warn(
    '[hosted-capture] Specialist offer was computed but no visible consent control was found.',
    await page.locator('button').allTextContents().catch(() => [])
  );
  return false;
}

async function followTransition(page, scenario, expectedOrigin) {
  const target = page.locator(`${scenario.targetSelector}:visible`).first();
  if (!(await target.count())) {
    const hiddenTarget = page.locator(scenario.targetSelector).first();
    const panelId = await hiddenTarget.evaluate(
      (element) => element.closest('.cmp-accordion__panel')?.id || null
    ).catch(() => null);
    if (panelId) {
      await page.locator(`button[aria-controls="${panelId}"]`).click();
    }
  }
  await target.waitFor({ state: 'visible', timeout: 20_000 });
  await Promise.all([
    page.waitForURL(
      (url) => url.origin === expectedOrigin && url.pathname === scenario.targetPath,
      { timeout: 60_000 }
    ),
    target.click(),
  ]);
  await waitForRuntime(page);
}

async function runJourney({
  baseUrl,
  outDir,
  headed,
  slowMo,
  journey,
  response,
  followUp,
  specialistAction = 'accept',
  local = false,
}) {
  const requestedOrigin = new URL(baseUrl).origin;
  if (!local && requestedOrigin !== JAHIA_ORIGIN) {
    throw new Error(`Hosted journey capture requires the internal Jahia origin ${JAHIA_ORIGIN}; received ${requestedOrigin}`);
  }
  if (local && requestedOrigin === JAHIA_ORIGIN) {
    throw new Error('Local fixture mode cannot run against the internal Jahia origin');
  }
  const registeredScenario = JOURNEYS.find((item) => item.id === journey);
  if (!registeredScenario) throw new Error(`Unknown journey ${journey}; expected ${JOURNEYS.map((item) => item.id).join(', ')}`);
  const scenario = {
    ...registeredScenario,
    ...(local ? LOCAL_JOURNEY_OVERRIDES[journey] : {}),
    ...(response ? { response } : {}),
    ...(followUp ? { followUp } : {}),
  };
  const evidenceDir = resolve(outDir);
  const manifestPath = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../../config/deployments/algolia-chat-stack.json'
  );
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const specialistAgentIds = (manifest.agentStudio?.orchestrator?.specialists || [])
    .map((specialist) => specialist.agentId)
    .filter(Boolean);
  await mkdir(evidenceDir, { recursive: true });
  const browser = await chromium.launch({ headless: !headed, slowMo });
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  const network = [];
  const requestIds = new WeakMap();
  const pendingResponses = new Set();
  let requestSequence = 0;
  let resetVerification = null;
  let firstTurnTrafficVerification = null;
  let trafficVerification = null;

  page.on('request', (request) => {
    if (!isCapturedUrl(request.url())) return;
    const id = ++requestSequence;
    requestIds.set(request, id);
    network.push({
      id,
      phase: 'request',
      timestamp: new Date().toISOString(),
      url: request.url(),
      agentId: agentIdFromUrl(request.url()),
      method: request.method(),
      headers: redactHeaders(request.headers()),
      postData: request.postDataJSON?.() || request.postData() || null,
    });
  });

  page.on('response', (response) => {
    if (!isCapturedUrl(response.url())) return;
    const capture = (async () => {
      let body = '';
      let bodyError = null;
      try {
        body = await response.text();
      } catch (error) {
        bodyError = String(error);
      }
      network.push({
        id: ++requestSequence,
        requestId: requestIds.get(response.request()) || null,
        phase: 'response',
        timestamp: new Date().toISOString(),
        url: response.url(),
        agentId: agentIdFromUrl(response.url()),
        status: response.status(),
        headers: redactHeaders(response.headers()),
        bodyError,
        parsedSse: parseAgentStudioSse(body),
      });
    })();
    pendingResponses.add(capture);
    capture.finally(() => pendingResponses.delete(capture));
  });

  const debugQuery = 'algoliaChatDebug=1&algoliaProactiveDebug=1&algoliaHandoffDebug=1';
  const captureKind = local ? 'local' : 'hosted';
  const url = `${baseUrl}${scenario.startPath}?${debugQuery}&cb=${captureKind}-${scenario.id.toLowerCase()}-capture`;
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await waitForRuntime(page);
    const resetPreseed = await seedResetProbe(page);
    await resetThroughWidget(page);
    const resetPost = await readResetProbe(page);
    resetVerification = analyzeResetTransition(resetPreseed, resetPost);
    await writeJson(
      resolve(evidenceDir, `${scenario.number}-reset-verification.json`),
      resetVerification
    );
    requireVerification(resetVerification, 'Hosted reset verification');
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
    await waitForRuntime(page);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: resolve(evidenceDir, `${scenario.number}-start.png`), fullPage: true });

    await qualifyPage(page);
    await waitForShownOpportunity(page, scenario.sourceTrigger || scenario.trigger);
    await waitForVisibleOpportunity(page, scenario.sourceTrigger || scenario.trigger);
    await page.screenshot({ path: resolve(evidenceDir, `${scenario.number}-source-qualified.png`), fullPage: true });

    if (scenario.targetPath) {
      await followTransition(page, scenario, requestedOrigin);
      await page.screenshot({ path: resolve(evidenceDir, `${scenario.number}-destination.png`), fullPage: true });
      if (scenario.qualifyTarget) await qualifyPage(page);
      await waitForShownOpportunity(page, scenario.trigger);
      await waitForVisibleOpportunity(page, scenario.trigger);
    }
    await page.screenshot({ path: resolve(evidenceDir, `${scenario.number}-greeting.png`), fullPage: true });

    const composer = page.getByPlaceholder('Ask a question...');
    await composer.waitFor({ state: 'visible', timeout: 20_000 });
    await composer.fill(scenario.response);
    const orchestratorAgentId = await page
      .locator('algolia-agent[role="primary"]')
      .getAttribute('agent-id');
    const visitorResponseBoundaryId = requestSequence;
    await page.getByRole('button', { name: /send message/i }).click();
    const specialistDecisionHandled = scenario.specialistExpected
      ? await acceptSpecialistOfferIfPresent(page, 60_000, specialistAction)
      : false;
    const specialistAccepted = specialistDecisionHandled && specialistAction === 'accept';
    const specialistDeclined = specialistDecisionHandled && specialistAction === 'decline';

    await page.waitForFunction(
      () => document.body.innerText.includes('SOURCES') || document.body.innerText.includes('Sources'),
      null,
      { timeout: 120_000 }
    );
    if (local) {
      await waitForLocalCompletionState(page, {
        orchestratorRequests: 1,
        specialistRequests: specialistAccepted ? 1 : 0,
      });
    } else {
      await waitForNetworkSettled(network, pendingResponses, { minimumRequests: 3 });
    }
    await page.screenshot({ path: resolve(evidenceDir, `${scenario.number}-answer.png`), fullPage: true });
    const discovery = analyzeDiscoveryCardinality({
      visibleWraps: await page.locator('.acs-followup-wrap:visible').count(),
      visibleQuestions: await page.locator('.acs-followup-card:visible').count(),
      questions: await page.locator('.acs-followup-card:visible').allTextContents(),
    });
    const specialistRoutingDebug = await page.evaluate(
      () => globalThis.__algoliaChatSpecialistDebug || null
    );

    const firstTurnBoundaryId = requestSequence;
    const firstTurnLocalState = local ? await readLocalCompletionState(page) : null;
    firstTurnTrafficVerification = local
      ? analyzeLocalCompletionState(firstTurnLocalState, {
        specialistExpected: scenario.specialistExpected,
        expectedOrchestratorRequests: 1,
      })
      : analyzeHostedCompletionTraffic(network, {
        orchestratorAgentId,
        specialistAgentIds,
        specialistExpected: scenario.specialistExpected,
        specialistAction,
        visitorResponseBoundaryId,
        firstTurnBoundaryId,
      });
    firstTurnTrafficVerification.discovery = discovery;
    if (!discovery.pass) {
      firstTurnTrafficVerification.pass = false;
      firstTurnTrafficVerification.errors.push(...discovery.errors);
    }
    firstTurnTrafficVerification.specialistRoutingDebug = specialistRoutingDebug;
    await writeJson(
      resolve(evidenceDir, `${scenario.number}-first-turn-verification.json`),
      firstTurnTrafficVerification
    );
    requireVerification(firstTurnTrafficVerification, 'Hosted first-turn completion verification');
    const firstTurn = await runtimeSnapshot(page);
    const conversationId = firstTurn.conversation?.conversationId;
    const firstTurnCount = firstTurn.conversation?.turns?.length || 0;

    await page.goto(
      `${baseUrl}${scenario.continuityPath}?${debugQuery}&cb=hosted-${scenario.id.toLowerCase()}-continuity`,
      { waitUntil: 'domcontentloaded', timeout: 60_000 }
    );
    await waitForRuntime(page);
    await openChatIfClosed(page);
    await page.getByText(scenario.response, { exact: true }).waitFor({ state: 'visible', timeout: 20_000 });
    const requestsBeforeFollowUp = local
      ? (await readLocalCompletionState(page)).orchestratorRequests.length
      : network.filter((entry) => entry.phase === 'request').length;
    const followUpComposer = page.getByPlaceholder('Ask a question...');
    await followUpComposer.fill(scenario.followUp);
    await page.getByRole('button', { name: /send message/i }).click();
    if (local) {
      await waitForLocalCompletionState(page, { orchestratorRequests: requestsBeforeFollowUp + 1 });
    } else {
      await waitForNetworkSettled(network, pendingResponses, {
        minimumRequests: requestsBeforeFollowUp + 1,
      });
    }
    await page.screenshot({ path: resolve(evidenceDir, `${scenario.number}-continuity.png`), fullPage: true });

    const trace = await runtimeSnapshot(page);
    if (!conversationId || trace.conversation?.conversationId !== conversationId) {
      throw new Error('Conversation ID did not survive same-origin product navigation');
    }
    if ((trace.conversation?.turns?.length || 0) < firstTurnCount + 1) {
      throw new Error('Follow-up turn was not persisted after same-origin navigation');
    }
    const finalLocalState = local ? await readLocalCompletionState(page) : null;
    trafficVerification = local
      ? analyzeLocalCompletionState(finalLocalState, {
        specialistExpected: scenario.specialistExpected,
        expectedOrchestratorRequests: 2,
      })
      : analyzeHostedCompletionTraffic(network, {
        orchestratorAgentId,
        specialistAgentIds,
        specialistExpected: scenario.specialistExpected,
        specialistAction,
        visitorResponseBoundaryId,
        firstTurnBoundaryId,
      });
    await writeJson(
      resolve(evidenceDir, `${scenario.number}-traffic-verification.json`),
      trafficVerification
    );
    requireVerification(trafficVerification, 'Hosted completion verification');
    trace.journey = scenario.id;
    trace.expectedTrigger = scenario.trigger;
    trace.visitorResponse = scenario.response;
    trace.specialistAccepted = specialistAccepted;
    trace.specialistDeclined = specialistDeclined;
    trace.specialistAction = scenario.specialistExpected ? specialistAction : null;
    trace.continuity = {
      sourcePath: scenario.targetPath || scenario.startPath,
      destinationPath: scenario.continuityPath,
      conversationIdBefore: conversationId,
      conversationIdAfter: trace.conversation?.conversationId || null,
      turnCountBefore: firstTurnCount,
      turnCountAfter: trace.conversation?.turns?.length || 0,
      restoredQueryVisible: true,
      followUp: scenario.followUp,
    };
    trace.verification = {
      boundaries: { visitorResponseBoundaryId, firstTurnBoundaryId },
      configuredOrchestratorAgentId: orchestratorAgentId,
      reset: resetVerification,
      firstTurnTraffic: firstTurnTrafficVerification,
      traffic: trafficVerification,
    };
    await writeJson(resolve(evidenceDir, `${scenario.number}-trace.json`), trace);
    await writeJson(resolve(evidenceDir, `${scenario.number}-network.json`), network);
    if (local) {
      await writeJson(resolve(evidenceDir, `${scenario.number}-local-traffic.json`), finalLocalState);
    }

    const completionRequests = network.filter((entry) => entry.phase === 'request');
    const completionResponses = network.filter((entry) => entry.phase === 'response');
    const summary = {
      journey: scenario.id,
      trigger: scenario.trigger,
      url,
      completionRequests: completionRequests.length,
      completionResponses: completionResponses.length,
      verification: {
        reset: resetVerification,
        firstTurnTraffic: firstTurnTrafficVerification,
        traffic: trafficVerification,
      },
      agents: [...new Set(completionRequests.map((entry) => entry.agentId).filter(Boolean))],
      sourceCategories: [
        ...new Set(
          completionResponses.flatMap((entry) => entry.parsedSse?.sourceCategories || [])
        ),
      ].sort(),
      toolCalls: completionResponses.flatMap((entry) => entry.parsedSse?.toolCalls || []),
    };
    console.log(JSON.stringify(summary, null, 2));
    return summary;
  } catch (error) {
    await Promise.allSettled([...pendingResponses]);
    await writeJson(resolve(evidenceDir, `${scenario.number}-network.json`), network);
    await writeJson(resolve(evidenceDir, `${scenario.number}-failure.json`), {
      journey: scenario.id,
      trigger: scenario.trigger,
      message: error instanceof Error ? error.message : String(error),
      reset: resetVerification,
      firstTurnTraffic: firstTurnTrafficVerification,
      traffic: trafficVerification,
    });
    throw error;
  } finally {
    await context.close();
    await browser.close();
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
  } else runJourney(args).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
