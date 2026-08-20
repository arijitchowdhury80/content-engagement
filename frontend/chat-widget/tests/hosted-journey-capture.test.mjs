import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  JOURNEYS,
  LOCAL_JOURNEY_OVERRIDES,
  analyzeLocalCompletionState,
  analyzeHostedCompletionTraffic,
  analyzeDiscoveryCardinality,
  analyzeResetTransition,
  parseArgs,
  parseAgentStudioSse,
  redactHeaders,
} from '../../../tools/inspection/capture_hosted_journey.mjs';

const captureSource = await readFile(
  new URL('../../../tools/inspection/capture_hosted_journey.mjs', import.meta.url),
  'utf8'
);

test('hosted specialist capture checks native consent before deterministic debug state', () => {
  const helperStart = captureSource.indexOf('async function acceptSpecialistOfferIfPresent');
  const helperEnd = captureSource.indexOf('\nasync function followTransition', helperStart);
  const helper = captureSource.slice(helperStart, helperEnd);

  assert.ok(helperStart >= 0 && helperEnd > helperStart, 'specialist consent helper must exist');
  assert.doesNotMatch(helper, /waitForFunction\([\s\S]*__algoliaChatSpecialistDebug/);
  assert.match(helper, /deep-dive offer/i);
  assert.match(helper, /go deeper|bring.*specialist/i);
});

test('discovery cardinality accepts exactly one visible nonempty question', () => {
  assert.deepEqual(
    analyzeDiscoveryCardinality({
      visibleWraps: 1,
      visibleQuestions: 1,
      questions: ['What outcome matters most for this evaluation?'],
    }),
    {
      pass: true,
      errors: [],
      visibleWraps: 1,
      visibleQuestions: 1,
      questions: ['What outcome matters most for this evaluation?'],
    }
  );
});

test('discovery cardinality rejects a missing question', () => {
  const report = analyzeDiscoveryCardinality({
    visibleWraps: 0,
    visibleQuestions: 0,
    questions: [],
  });
  assert.equal(report.pass, false);
  assert.match(report.errors.join('\n'), /expected exactly 1/i);
});

test('discovery cardinality rejects duplicate questions', () => {
  const report = analyzeDiscoveryCardinality({
    visibleWraps: 2,
    visibleQuestions: 2,
    questions: ['First?', 'Second?'],
  });
  assert.equal(report.pass, false);
  assert.match(report.errors.join('\n'), /rendered 2 visible discovery questions/i);
});

const GREETINGS_AGENT_ID = 'greetings-agent';
const ORCHESTRATOR_AGENT_ID = 'orchestrator-agent';
const TECH_SPECIALIST_AGENT_ID = 'tech-specialist-agent';

function completionRequest({ id, agentId, text, turnContext = {} }) {
  return {
    id,
    phase: 'request',
    agentId,
    url: `https://example.algolia.net/agent-studio/1/agents/${agentId}/completions`,
    postData: {
      messages: [{
        role: 'user',
        parts: [{ type: 'text', text }],
        metadata: { turnContext },
      }],
    },
  };
}

function completionResponse({
  id,
  agentId,
  status = 200,
  text = 'A useful answer.',
  hits = [],
}) {
  return {
    id,
    phase: 'response',
    agentId,
    url: `https://example.algolia.net/agent-studio/1/agents/${agentId}/completions`,
    status,
    bodyError: null,
    parsedSse: {
      text,
      toolCalls: [],
      toolOutputs: hits.length ? [{ toolCallId: 'search', output: { hits } }] : [],
      sourceCategories: [],
    },
  };
}

function greetingText(opportunityId) {
  return `PROACTIVE_GREETING_REQUEST\n${JSON.stringify({
    schema: 'ProactiveGreetingRequest.v1',
    opportunityId,
  })}`;
}

function handoffText(question, opportunityId = 'opp_destination') {
  return `${question}\n\nPROACTIVE_HANDOFF_CONTEXT\n${JSON.stringify({
    schema: 'ProactiveHandoffContext.v1',
    opportunityId,
  })}`;
}

function validCompletionTraffic() {
  return [
    completionRequest({ id: 1, agentId: GREETINGS_AGENT_ID, text: greetingText('opp_source') }),
    completionResponse({ id: 2, agentId: GREETINGS_AGENT_ID, text: '{"greeting":"Source"}' }),
    completionRequest({ id: 3, agentId: GREETINGS_AGENT_ID, text: greetingText('opp_destination') }),
    completionResponse({ id: 4, agentId: GREETINGS_AGENT_ID, text: '{"greeting":"Destination"}' }),
    completionRequest({
      id: 5,
      agentId: ORCHESTRATOR_AGENT_ID,
      text: handoffText('What should I evaluate?'),
    }),
    completionResponse({ id: 6, agentId: ORCHESTRATOR_AGENT_ID }),
  ];
}

test('hosted capture registry covers the eight canonical journeys exactly once', () => {
  assert.deepEqual(
    JOURNEYS.map((journey) => journey.id),
    ['T1', 'T2', 'B1', 'B2', 'C1', 'C2', 'S1', 'S2']
  );
  assert.equal(new Set(JOURNEYS.map((journey) => journey.trigger)).size, 8);
});

test('local capture registry maps every canonical journey to a usable parity route', () => {
  assert.deepEqual(Object.keys(LOCAL_JOURNEY_OVERRIDES).sort(),
    ['B1', 'B2', 'C1', 'C2', 'S1', 'S2', 'T1', 'T2']);
  assert.equal(LOCAL_JOURNEY_OVERRIDES.T2.targetPath,
    '/doc/guides/building-search-ui/what-is-instantsearch/js/');
  assert.equal(LOCAL_JOURNEY_OVERRIDES.B1.startPath, '/solutions/ecommerce');
  assert.equal(LOCAL_JOURNEY_OVERRIDES.B2.targetPath, '/customers/harry-rosen');
  assert.equal(LOCAL_JOURNEY_OVERRIDES.S2.startPath, '/resources');
});

test('B1 continuity uses the verified same-origin ecommerce solution route', () => {
  const journey = JOURNEYS.find(({ id }) => id === 'B1');
  assert.equal(journey.continuityPath, '/industries/ecommerce');
  assert.match(journey.followUp, /ecommerce/i);
});

test('parseArgs supports diagnostic response overrides without changing the journey registry', () => {
  const args = parseArgs([
    '--journey',
    't2',
    '--response',
    'Please bring in the Developer Specialist.',
    '--follow-up',
    'Continue with the specialist recommendation.',
  ]);

  assert.equal(args.journey, 'T2');
  assert.equal(args.response, 'Please bring in the Developer Specialist.');
  assert.equal(args.followUp, 'Continue with the specialist recommendation.');
  assert.equal(JOURNEYS.find((journey) => journey.id === 'T2').response,
    'What should a credible React InstantSearch proof of concept include?');
});

test('parseArgs supports explicit specialist accept and decline evidence runs', () => {
  assert.equal(parseArgs(['--specialist-action', 'accept']).specialistAction, 'accept');
  assert.equal(parseArgs(['--specialist-action', 'decline']).specialistAction, 'decline');
});

test('parseArgs supports explicit local fixture evidence mode', () => {
  const args = parseArgs(['--local', '--base-url', 'http://127.0.0.1:5177']);
  assert.equal(args.local, true);
  assert.equal(args.baseUrl, 'http://127.0.0.1:5177');
});

test('local completion analyzer proves one greeting, one handoff, and optional specialist routing', () => {
  const baseState = {
    greetingRequests: [{ opportunityId: 'opp_local' }],
    orchestratorRequests: [{
      messages: [{
        role: 'user',
        parts: [{ type: 'text', text: 'Question\n\nPROACTIVE_HANDOFF_CONTEXT\n{}' }],
      }],
    }],
    specialistRequests: [],
  };
  const direct = analyzeLocalCompletionState(baseState);
  assert.equal(direct.pass, true, direct.errors.join('\n'));
  assert.equal(direct.firstTurn.handoffBlocks, 1);

  const specialist = analyzeLocalCompletionState({
    ...baseState,
    specialistRequests: [{ specialistKey: 'tech', agentId: 'local_tech_agent' }],
  }, { specialistExpected: true });
  assert.equal(specialist.pass, true, specialist.errors.join('\n'));
  assert.equal(specialist.firstTurn.routedToSpecialist, true);
});

test('parseArgs marks help requests so the CLI can exit without launching a browser', () => {
  assert.equal(parseArgs(['--help']).help, true);
  assert.equal(parseArgs(['-h']).help, true);
});

test('redactHeaders removes API credentials while retaining diagnostic headers', () => {
  assert.deepEqual(
    redactHeaders({
      'content-type': 'application/json',
      'x-algolia-api-key': 'secret-key',
      'x-algolia-application-id': 'APP123',
      authorization: 'Bearer secret',
    }),
    {
      'content-type': 'application/json',
      'x-algolia-api-key': '[REDACTED]',
      'x-algolia-application-id': 'APP123',
      authorization: '[REDACTED]',
    }
  );
});

test('parseAgentStudioSse extracts text, tool calls, tool outputs, and source categories', () => {
  const body = [
    'data: {"type":"text-delta","delta":"A grounded answer."}',
    'data: {"type":"tool-input-available","toolCallId":"call_1","toolName":"search","input":{"query":"AI Search cost"}}',
    'data: {"type":"tool-output-available","toolCallId":"call_1","output":{"hits":[{"title":"Pricing","source":"Website"},{"title":"API limits","source":"Documentation"}]}}',
    'data: {"type":"tool-input-available","toolCallId":"call_2","toolName":"ask_specialist","input":{"specialist":"sales_concierge"}}',
  ].join('\n\n');

  assert.deepEqual(parseAgentStudioSse(body), {
    text: 'A grounded answer.',
    toolCalls: [
      {
        toolCallId: 'call_1',
        toolName: 'search',
        input: { query: 'AI Search cost' },
      },
      {
        toolCallId: 'call_2',
        toolName: 'ask_specialist',
        input: { specialist: 'sales_concierge' },
      },
    ],
    toolOutputs: [
      {
        toolCallId: 'call_1',
        output: {
          hits: [
            { title: 'Pricing', source: 'Website' },
            { title: 'API limits', source: 'Documentation' },
          ],
        },
      },
    ],
    sourceCategories: ['Documentation', 'Website'],
  });
});

test('completion analyzer accepts one greeting per distinct opportunity and one first-turn handoff', () => {
  const report = analyzeHostedCompletionTraffic(validCompletionTraffic(), {
    orchestratorAgentId: ORCHESTRATOR_AGENT_ID,
    visitorResponseBoundaryId: 4,
    firstTurnBoundaryId: 6,
  });

  assert.equal(report.pass, true, report.errors.join('\n'));
  assert.deepEqual(report.greetings.byOpportunity, {
    opp_source: 1,
    opp_destination: 1,
  });
  assert.equal(report.greetings.afterVisitorResponse, 0);
  assert.equal(report.firstTurn.orchestratorRequests, 1);
  assert.equal(report.firstTurn.handoffBlocks, 1);
  assert.equal(report.firstTurn.responseStatus, 200);
  assert.equal(report.firstTurn.responseTextLength, 'A useful answer.'.length);
});

test('completion analyzer classifies sourced specialist depth as additive to the primary answer', () => {
  const network = validCompletionTraffic();
  network[5] = {
    ...completionResponse({ id: 6, agentId: ORCHESTRATOR_AGENT_ID, text: 'A concise orchestrator answer.' }),
    parsedSse: {
      text: 'A concise orchestrator answer.',
      toolCalls: [{
        toolCallId: 'call_specialist',
        toolName: 'ask_specialist',
        input: { specialist_key: 'tech', question: 'Give me the implementation depth.' },
      }],
      toolOutputs: [],
      sourceCategories: [],
    },
  };
  network.push(
    completionRequest({
      id: 7,
      agentId: TECH_SPECIALIST_AGENT_ID,
      text: 'Give me the implementation depth.',
    }),
    completionResponse({
      id: 8,
      agentId: TECH_SPECIALIST_AGENT_ID,
      text: 'A grounded specialist answer.',
      hits: [{ title: 'Implementation guide', source: 'Documentation' }],
    }),
  );

  const report = analyzeHostedCompletionTraffic(network, {
    orchestratorAgentId: ORCHESTRATOR_AGENT_ID,
    specialistAgentIds: [TECH_SPECIALIST_AGENT_ID],
    specialistExpected: true,
    visitorResponseBoundaryId: 4,
    firstTurnBoundaryId: 8,
  });

  assert.equal(report.pass, true, report.errors.join('\n'));
  assert.equal(report.firstTurn.specialistRequests, 1);
  assert.equal(report.firstTurn.finalResponderAgentId, TECH_SPECIALIST_AGENT_ID);
  assert.equal(report.firstTurn.routedToSpecialist, true);
  assert.equal(report.firstTurn.specialistOutcome, 'additive');
  assert.deepEqual(report.firstTurn.visibleResponderAgentIds, [
    ORCHESTRATOR_AGENT_ID,
    TECH_SPECIALIST_AGENT_ID,
  ]);
  assert.equal(
    report.firstTurn.responseTextLength,
    'A concise orchestrator answer.'.length + 'A grounded specialist answer.'.length,
  );
});

test('completion analyzer demotes zero-hit, empty-object-hit, or limitation specialist output', () => {
  const cases = [
    {
      label: 'zero hits',
      text: 'Here is a distinct implementation recommendation.',
      hits: [],
    },
    {
      label: 'empty object hits',
      text: 'Here is a distinct implementation recommendation.',
      hits: [{}],
    },
    {
      label: 'limitation text',
      text: 'I could not find matching evidence for that exact request.',
      hits: [{ title: 'Tangential result', source: 'Documentation' }],
    },
  ];

  for (const specialist of cases) {
    const network = validCompletionTraffic();
    network[5] = {
      ...completionResponse({ id: 6, agentId: ORCHESTRATOR_AGENT_ID, text: 'The grounded primary answer.' }),
      parsedSse: {
        text: 'The grounded primary answer.',
        toolCalls: [{
          toolCallId: 'call_specialist',
          toolName: 'ask_specialist',
          input: { specialist_key: 'tech', question: 'Find implementation evidence.' },
        }],
        toolOutputs: [],
        sourceCategories: [],
      },
    };
    network.push(
      completionRequest({
        id: 7,
        agentId: TECH_SPECIALIST_AGENT_ID,
        text: 'Find implementation evidence.',
      }),
      completionResponse({
        id: 8,
        agentId: TECH_SPECIALIST_AGENT_ID,
        text: specialist.text,
        hits: specialist.hits,
      }),
    );

    const report = analyzeHostedCompletionTraffic(network, {
      orchestratorAgentId: ORCHESTRATOR_AGENT_ID,
      specialistAgentIds: [TECH_SPECIALIST_AGENT_ID],
      specialistExpected: true,
      visitorResponseBoundaryId: 4,
      firstTurnBoundaryId: 8,
    });

    assert.equal(report.pass, true, `${specialist.label}: ${report.errors.join('\n')}`);
    assert.equal(report.firstTurn.specialistOutcome, 'demoted', specialist.label);
    assert.equal(report.firstTurn.finalResponderAgentId, ORCHESTRATOR_AGENT_ID, specialist.label);
    assert.deepEqual(
      report.firstTurn.visibleResponderAgentIds,
      [ORCHESTRATOR_AGENT_ID],
      specialist.label,
    );
    assert.equal(report.firstTurn.responseId, 6, specialist.label);
    assert.equal(
      report.firstTurn.responseTextLength,
      'The grounded primary answer.'.length,
      specialist.label,
    );
  }
});

test('completion analyzer accepts one declined native specialist offer followed by one answer', () => {
  const network = validCompletionTraffic();
  network[5] = {
    ...completionResponse({ id: 6, agentId: ORCHESTRATOR_AGENT_ID, text: '' }),
    parsedSse: {
      text: '',
      toolCalls: [{
        toolCallId: 'offer_specialist',
        toolName: 'ask_specialist',
        input: { specialist_key: 'tech' },
      }],
      toolOutputs: [],
      sourceCategories: [],
    },
  };
  network.push(
    completionRequest({ id: 7, agentId: ORCHESTRATOR_AGENT_ID, text: '' }),
    completionResponse({
      id: 8,
      agentId: ORCHESTRATOR_AGENT_ID,
      text: 'A useful answer after the visitor declined.',
    }),
  );

  const report = analyzeHostedCompletionTraffic(network, {
    orchestratorAgentId: ORCHESTRATOR_AGENT_ID,
    specialistAgentIds: [TECH_SPECIALIST_AGENT_ID],
    specialistExpected: true,
    specialistAction: 'decline',
    visitorResponseBoundaryId: 4,
    firstTurnBoundaryId: 8,
  });

  assert.equal(report.pass, true, report.errors.join('\n'));
  assert.equal(report.firstTurn.orchestratorRequests, 2);
  assert.equal(report.firstTurn.specialistRequests, 0);
  assert.equal(report.firstTurn.specialistAction, 'decline');
  assert.equal(
    report.firstTurn.responseTextLength,
    'A useful answer after the visitor declined.'.length,
  );
});

test('completion analyzer accepts deterministic client routing to the same configured specialist', () => {
  const network = validCompletionTraffic();
  network.push(
    completionRequest({
      id: 7,
      agentId: TECH_SPECIALIST_AGENT_ID,
      text: 'Give me the implementation depth.',
    }),
    completionResponse({
      id: 8,
      agentId: TECH_SPECIALIST_AGENT_ID,
      text: 'A grounded deterministic specialist answer.',
      hits: [{ title: 'React guide', source: 'Documentation' }],
    }),
  );

  const report = analyzeHostedCompletionTraffic(network, {
    orchestratorAgentId: ORCHESTRATOR_AGENT_ID,
    specialistAgentIds: [TECH_SPECIALIST_AGENT_ID],
    specialistExpected: true,
    visitorResponseBoundaryId: 4,
    firstTurnBoundaryId: 8,
  });

  assert.equal(report.pass, true, report.errors.join('\n'));
  assert.equal(report.firstTurn.finalResponderAgentId, TECH_SPECIALIST_AGENT_ID);
  assert.equal(report.firstTurn.routedToSpecialist, true);
  assert.equal(report.firstTurn.routingMode, 'deterministic_client');
  assert.equal(report.firstTurn.specialistOutcome, 'additive');
  assert.deepEqual(report.firstTurn.visibleResponderAgentIds, [
    ORCHESTRATOR_AGENT_ID,
    TECH_SPECIALIST_AGENT_ID,
  ]);
  assert.equal(
    report.firstTurn.responseTextLength,
    'A useful answer.'.length + 'A grounded deterministic specialist answer.'.length,
  );
});

test('completion analyzer rejects a journey that requires specialist routing when no specialist is captured', () => {
  const report = analyzeHostedCompletionTraffic(validCompletionTraffic(), {
    orchestratorAgentId: ORCHESTRATOR_AGENT_ID,
    specialistAgentIds: [TECH_SPECIALIST_AGENT_ID],
    specialistExpected: true,
    visitorResponseBoundaryId: 4,
    firstTurnBoundaryId: 6,
  });

  assert.equal(report.pass, false);
  assert.match(report.errors.join('\n'), /expected specialist routing/i);
  assert.match(report.errors.join('\n'), /received 0 first-turn request\(s\); expected 1/i);
});

test('completion analyzer rejects duplicate specialist requests for an accepted specialist journey', () => {
  const network = validCompletionTraffic();
  network.push(
    completionRequest({ id: 7, agentId: TECH_SPECIALIST_AGENT_ID, text: 'First specialist request.' }),
    completionResponse({
      id: 8,
      agentId: TECH_SPECIALIST_AGENT_ID,
      text: 'First grounded specialist answer.',
      hits: [{ title: 'Implementation guide', source: 'Documentation' }],
    }),
    completionRequest({ id: 9, agentId: TECH_SPECIALIST_AGENT_ID, text: 'Duplicate specialist request.' }),
    completionResponse({
      id: 10,
      agentId: TECH_SPECIALIST_AGENT_ID,
      text: 'Duplicate grounded specialist answer.',
      hits: [{ title: 'API guide', source: 'Documentation' }],
    }),
  );

  const report = analyzeHostedCompletionTraffic(network, {
    orchestratorAgentId: ORCHESTRATOR_AGENT_ID,
    specialistAgentIds: [TECH_SPECIALIST_AGENT_ID],
    specialistExpected: true,
    visitorResponseBoundaryId: 4,
    firstTurnBoundaryId: 10,
  });

  assert.equal(report.pass, false);
  assert.equal(report.firstTurn.specialistRequests, 2);
  assert.match(report.errors.join('\n'), /received 2 first-turn request\(s\); expected 1/i);
});

test('completion analyzer rejects an unexpected specialist request for an ordinary journey', () => {
  const network = validCompletionTraffic();
  network.push(
    completionRequest({ id: 7, agentId: TECH_SPECIALIST_AGENT_ID, text: 'Unexpected specialist request.' }),
    completionResponse({
      id: 8,
      agentId: TECH_SPECIALIST_AGENT_ID,
      text: 'Unexpected specialist answer.',
      hits: [{ title: 'Implementation guide', source: 'Documentation' }],
    }),
  );

  const report = analyzeHostedCompletionTraffic(network, {
    orchestratorAgentId: ORCHESTRATOR_AGENT_ID,
    specialistAgentIds: [TECH_SPECIALIST_AGENT_ID],
    visitorResponseBoundaryId: 4,
    firstTurnBoundaryId: 8,
  });

  assert.equal(report.pass, false);
  assert.equal(report.firstTurn.specialistRequests, 1);
  assert.match(report.errors.join('\n'), /received 1 first-turn request\(s\); expected 0/i);
});

test('completion analyzer rejects duplicate greetings for the same opportunity', () => {
  const network = validCompletionTraffic();
  network.splice(
    4,
    0,
    completionRequest({ id: 7, agentId: GREETINGS_AGENT_ID, text: greetingText('opp_destination') }),
  );

  const report = analyzeHostedCompletionTraffic(network, {
    orchestratorAgentId: ORCHESTRATOR_AGENT_ID,
    visitorResponseBoundaryId: 4,
    firstTurnBoundaryId: 7,
  });

  assert.equal(report.pass, false);
  assert.match(report.errors.join('\n'), /opp_destination.*2 greeting requests/i);
});

test('completion analyzer rejects a hosted proactive turn with no recognizable greeting request', () => {
  const network = validCompletionTraffic().slice(4);

  const report = analyzeHostedCompletionTraffic(network, {
    orchestratorAgentId: ORCHESTRATOR_AGENT_ID,
    visitorResponseBoundaryId: 4,
    firstTurnBoundaryId: 6,
  });

  assert.equal(report.pass, false);
  assert.match(report.errors.join('\n'), /no greeting requests were captured/i);
});

test('completion analyzer rejects greetings emitted after the visitor response', () => {
  const network = validCompletionTraffic();
  network.push(completionRequest({
    id: 7,
    agentId: GREETINGS_AGENT_ID,
    text: greetingText('opp_late'),
  }));

  const report = analyzeHostedCompletionTraffic(network, {
    orchestratorAgentId: ORCHESTRATOR_AGENT_ID,
    visitorResponseBoundaryId: 4,
    firstTurnBoundaryId: 6,
  });

  assert.equal(report.pass, false);
  assert.match(report.errors.join('\n'), /1 greeting request.*after visitor response/i);
});

test('completion analyzer excludes the intentional continuity turn from first-turn cardinality', () => {
  const network = validCompletionTraffic();
  network.push(
    completionRequest({
      id: 7,
      agentId: ORCHESTRATOR_AGENT_ID,
      text: handoffText('What changes on this page?'),
    }),
    completionResponse({ id: 8, agentId: ORCHESTRATOR_AGENT_ID, text: 'Continuity answer.' }),
  );

  const report = analyzeHostedCompletionTraffic(network, {
    orchestratorAgentId: ORCHESTRATOR_AGENT_ID,
    visitorResponseBoundaryId: 4,
    firstTurnBoundaryId: 6,
  });

  assert.equal(report.pass, true, report.errors.join('\n'));
  assert.equal(report.firstTurn.orchestratorRequests, 1);
  assert.equal(report.continuity.orchestratorRequests, 1);
});

test('completion analyzer rejects duplicate orchestrator requests inside the first-turn boundary', () => {
  const network = validCompletionTraffic();
  network.push(completionRequest({
    id: 7,
    agentId: ORCHESTRATOR_AGENT_ID,
    text: handoffText('Duplicate first-turn request'),
  }));

  const report = analyzeHostedCompletionTraffic(network, {
    orchestratorAgentId: ORCHESTRATOR_AGENT_ID,
    visitorResponseBoundaryId: 4,
    firstTurnBoundaryId: 7,
  });

  assert.equal(report.pass, false);
  assert.match(
    report.errors.join('\n'),
    /received 2 logical first turns across 2 HTTP requests; expected 1/i,
  );
});

test('completion analyzer treats an identical empty retry as one logical visitor turn', () => {
  const network = validCompletionTraffic();
  network.push(completionRequest({
    id: 7,
    agentId: ORCHESTRATOR_AGENT_ID,
    text: handoffText('What should I evaluate?'),
  }));

  const report = analyzeHostedCompletionTraffic(network, {
    orchestratorAgentId: ORCHESTRATOR_AGENT_ID,
    visitorResponseBoundaryId: 4,
    firstTurnBoundaryId: 7,
  });

  assert.equal(report.pass, true, report.errors.join('\n'));
  assert.equal(report.firstTurn.orchestratorRequests, 2);
});

test('completion analyzer requires the configured orchestrator, status 200, and nonempty text', () => {
  const wrongAgent = analyzeHostedCompletionTraffic(validCompletionTraffic(), {
    orchestratorAgentId: 'different-orchestrator',
    visitorResponseBoundaryId: 4,
    firstTurnBoundaryId: 6,
  });
  const failedResponse = validCompletionTraffic();
  failedResponse[5] = completionResponse({
    id: 6,
    agentId: ORCHESTRATOR_AGENT_ID,
    status: 503,
    text: '',
  });
  const failedReport = analyzeHostedCompletionTraffic(failedResponse, {
    orchestratorAgentId: ORCHESTRATOR_AGENT_ID,
    visitorResponseBoundaryId: 4,
    firstTurnBoundaryId: 6,
  });

  assert.match(wrongAgent.errors.join('\n'), /configured orchestrator.*different-orchestrator/i);
  assert.match(failedReport.errors.join('\n'), /status 503/i);
  assert.match(failedReport.errors.join('\n'), /nonempty streamed text/i);
});

test('reset analyzer proves seeded Algolia state was cleared while unrelated state survived', () => {
  const preseed = {
    profileVisitorId: 'reset_probe_visitor',
    sessionId: 'reset_probe_session',
    proactiveOpportunityId: 'reset_probe_opportunity',
    conversationId: 'reset_probe_conversation',
    handoffOpportunityId: 'reset_probe_opportunity',
    unrelatedLocal: 'reset_probe_keep_local',
    unrelatedSession: 'reset_probe_keep_session',
  };
  const post = {
    profileVisitorId: 'fresh_visitor',
    sessionId: 'fresh_session',
    eventNames: ['page_view'],
    proactiveOpportunityId: null,
    conversationId: null,
    handoffOpportunityId: null,
    unrelatedLocal: 'reset_probe_keep_local',
    unrelatedSession: 'reset_probe_keep_session',
  };

  const report = analyzeResetTransition(preseed, post);

  assert.equal(report.pass, true, report.errors.join('\n'));
  assert.equal(report.checks.freshProfile, true);
  assert.equal(report.checks.freshSession, true);
  assert.equal(report.checks.unrelatedStatePreserved, true);
});

test('reset analyzer rejects stale conversation and visitor state', () => {
  const preseed = {
    profileVisitorId: 'stale_visitor',
    sessionId: 'stale_session',
    proactiveOpportunityId: 'stale_opportunity',
    conversationId: 'stale_conversation',
    handoffOpportunityId: 'stale_opportunity',
    unrelatedLocal: 'keep_local',
    unrelatedSession: 'keep_session',
  };
  const report = analyzeResetTransition(preseed, {
    ...preseed,
    eventNames: ['chat_open'],
  });

  assert.equal(report.pass, false);
  assert.match(report.errors.join('\n'), /profile visitor ID was not replaced/i);
  assert.match(report.errors.join('\n'), /conversation state was not cleared/i);
});
