import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const handoffPath = new URL('../handoff-to-orchestrator.js', import.meta.url);

class MemoryStorage {
  constructor(initial = {}) {
    this.store = new Map(Object.entries(initial));
  }

  getItem(key) {
    return this.store.has(key) ? this.store.get(key) : null;
  }

  setItem(key, value) {
    this.store.set(key, String(value));
  }

  removeItem(key) {
    this.store.delete(key);
  }
}

function createHarness({ proactiveState, compilerPacket, turnContext, primaryAgentId = 'orchestrator_123' } = {}) {
  const fetchCalls = [];
  const registeredTools = {};
  const sessionStorage = new MemoryStorage({
    ...(proactiveState ? { algolia_proactive_state: JSON.stringify(proactiveState) } : {}),
  });
  const localStorage = new MemoryStorage();
  const documentEvents = [];
  const context = {
    console,
    URL,
    URLSearchParams,
    TextEncoder,
    localStorage,
    sessionStorage,
    location: {
      href: 'https://tmp-content-eng-algolia.cloud.jahia.com/pricing',
      origin: 'https://tmp-content-eng-algolia.cloud.jahia.com',
      pathname: '/pricing',
      search: '',
    },
    CustomEvent: class CustomEvent {
      constructor(type, options = {}) {
        this.type = type;
        this.detail = options.detail;
      }
    },
    document: {
      querySelector(selector) {
        if (selector === 'algolia-agent[role="primary"]') {
          return {
            getAttribute(name) {
              return name === 'agent-id' ? primaryAgentId : null;
            },
          };
        }
        return null;
      },
      dispatchEvent(event) {
        documentEvents.push(event);
        return true;
      },
    },
    fetch: async (url, init = {}) => {
      fetchCalls.push({ url: String(url), init });
      return { ok: true, status: 200, text: async () => 'ok' };
    },
    algoliaChat: {
      registerTool(name, handler) {
        registeredTools[name] = handler;
      },
    },
    algoliaContextCompiler: {
      compile() {
        return compilerPacket || { schema: 'AlgoliaContextPacket.v1', currentPage: { path: '/pricing' } };
      },
      compileTurnContext() {
        return turnContext || { context_schema: 'AlgoliaTurnContext.v1', current_page: '/pricing' };
      },
    },
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(handoffPath, 'utf8'), context);
  return { context, fetchCalls, registeredTools, sessionStorage, documentEvents };
}

function stateWithShownOpportunity() {
  return {
    schema: 'AlgoliaProactiveState.v1',
    opportunities: [
      {
        id: 'opp_1',
        status: 'shown',
        requestPacket: {
          schema: 'ProactiveGreetingRequest.v1',
          opportunityId: 'opp_1',
          moment: 'commercial_evaluation',
          trigger: 'product_to_pricing',
          messageGoal: 'explain_cost_drivers',
        },
        greetingResponse: {
          schema: 'ProactiveGreetingResponse.v1',
          opportunityId: 'opp_1',
          greeting: 'Pricing pages are where good search ideas meet CFO gravity. Want the practical version?',
          chips: ['What drives cost?', 'API call counting', 'Which plan fits?'],
          handoffSummary: {
            moment: 'commercial_evaluation',
            trigger: 'product_to_pricing',
            messageGoal: 'explain_cost_drivers',
          },
        },
      },
    ],
    lastOpportunityAt: 1786750000000,
  };
}

test('registers the native handoff_to_orchestrator client-side tool', async () => {
  const { registeredTools, sessionStorage } = createHarness({ proactiveState: stateWithShownOpportunity() });

  assert.equal(typeof registeredTools.handoff_to_orchestrator, 'function');

  const result = await registeredTools.handoff_to_orchestrator({
    schema: 'ProactiveHandoffToolInput.v1',
    opportunityId: 'opp_1',
    greeting: 'Pricing pages are where good search ideas meet CFO gravity. Want the practical version?',
    chips: ['What drives cost?'],
    selectedChip: 'What drives cost?',
    userResponse: 'What drives cost?',
  });

  assert.equal(result.success, true);
  assert.equal(result.opportunityId, 'opp_1');
  const state = JSON.parse(sessionStorage.getItem('algolia_proactive_state'));
  assert.equal(state.opportunities[0].status, 'handoff_tool_called');
});

test('injects proactive handoff context into the next orchestrator turn', async () => {
  const { context, fetchCalls, sessionStorage, documentEvents } = createHarness({
    proactiveState: stateWithShownOpportunity(),
    primaryAgentId: 'orchestrator_123',
  });

  const body = {
    messages: [
      {
        role: 'user',
        parts: [{ type: 'text', text: 'What drives cost?' }],
      },
    ],
  };

  await context.fetch('https://0EXRPAXB56.algolia.net/agent-studio/1/agents/orchestrator_123/completions?compatibilityMode=ai-sdk-5', {
    method: 'POST',
    body: JSON.stringify(body),
  });

  assert.equal(fetchCalls.length, 1);
  const sent = JSON.parse(fetchCalls[0].init.body);
  const text = sent.messages[0].parts[0].text;
  assert.match(text, /^What drives cost\?\n\nPROACTIVE_HANDOFF_CONTEXT\n/);
  const packet = JSON.parse(text.split('PROACTIVE_HANDOFF_CONTEXT\n')[1]);
  assert.equal(packet.schema, 'ProactiveHandoffContext.v1');
  assert.equal(packet.opportunityId, 'opp_1');
  assert.equal(packet.selectedChip, 'What drives cost?');
  assert.equal(packet.userResponse, 'What drives cost?');
  assert.equal(packet.greeting, 'Pricing pages are where good search ideas meet CFO gravity. Want the practical version?');
  assert.equal(sent.messages[0].metadata.turnContext.context_schema, 'AlgoliaTurnContext.v1');

  const state = JSON.parse(sessionStorage.getItem('algolia_proactive_state'));
  assert.equal(state.opportunities[0].status, 'handoff_sent');
  assert.equal(documentEvents[0].type, 'algolia-proactive-handoff');
});

test('does not inject handoff context into non-orchestrator or already-sent turns', async () => {
  const state = stateWithShownOpportunity();
  state.opportunities[0].status = 'handoff_sent';
  const { context, fetchCalls } = createHarness({ proactiveState: state, primaryAgentId: 'orchestrator_123' });

  await context.fetch('https://0EXRPAXB56.algolia.net/agent-studio/1/agents/orchestrator_123/completions', {
    method: 'POST',
    body: JSON.stringify({
      messages: [{ role: 'user', parts: [{ type: 'text', text: 'normal question' }] }],
    }),
  });
  await context.fetch('https://0EXRPAXB56.algolia.net/agent-studio/1/agents/other_agent/completions', {
    method: 'POST',
    body: JSON.stringify({
      messages: [{ role: 'user', parts: [{ type: 'text', text: 'normal question' }] }],
    }),
  });

  for (const call of fetchCalls) {
    const sent = JSON.parse(call.init.body);
    assert.equal(sent.messages[0].parts[0].text, 'normal question');
  }
});
