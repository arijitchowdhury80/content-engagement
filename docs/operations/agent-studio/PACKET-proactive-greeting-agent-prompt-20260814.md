# Proactive Greeting Agent Prompt Packet

## Status

Proposed. Do not apply until Arijit approves the Agent Studio mutation.

## Target

- App: `0EXRPAXB56`
- Agent: `www Chat – Proactive Concierge`
- Agent ID: `0f290529-629a-48fe-9424-f93e5894d8f3`
- Runtime role: one-shot proactive greeting generator for `algolia-proactive-controller.js`

## Current State

Snapshot:
`docs/evidence/agent-studio/proactive-greeting-20260814/current-www-chat-proactive-concierge.json`

- Status: `published`
- Provider: `0c6a0843-caf0-4246-b2a1-7cc08d06a7db`
- Model: `medium`
- Instructions length: `4002` characters
- Instructions SHA-256: `e1d54c3ee5e21a9f2b684c505010392852d4caf2923736f74a6ccce7a944e8e8`
- Tools: one `algolia_search_index` tool over `Algolia_Prod_Copy_Vanilla`, `hitsPerPage: 3`
- Config keys: `enableAlgoliaMcp`

## Intended State

Patch payload:
`docs/evidence/agent-studio/proactive-greeting-20260814/intended-prompt-patch.json`

- Keep provider unchanged: `0c6a0843-caf0-4246-b2a1-7cc08d06a7db`
- Keep model unchanged: `medium`
- Replace instructions with:
  `agents/prompts/instructions_algolia_proactive_greeting.md`
- Intended instructions length: `8431` characters
- Intended instructions SHA-256: `79e7c2ca46824b5a4c1b4efb22566d015ee69134330d14aae9103715660068e6`
- Remove all tools: `tools: []`
- Set config:

```json
{
  "enableAlgoliaMcp": false,
  "useCache": false,
  "suggestions": { "enabled": false }
}
```

## Reason

The v1 controller calls this agent as a direct completion and validates strict `ProactiveGreetingResponse.v1` JSON. The agent should not retrieve, answer, call specialists, or continue a conversation. It should convert the controller's qualified opportunity packet into a concise greeting and chips only.

Removing the search tool is intentional. Customer names, metrics, pricing, implementation facts, and case studies should not appear in a proactive greeting unless the controller packet already contains them. The main orchestrator owns factual answers after the visitor engages.

## Rollback

Rollback source:
`docs/evidence/agent-studio/proactive-greeting-20260814/current-www-chat-proactive-concierge.json`

Rollback body restores:

- current instructions;
- current provider/model;
- current `algolia_search_index` tool;
- current config.

## Validation

After applying:

1. GET the agent and verify:
   - same agent ID;
   - provider is unchanged;
   - model is unchanged;
   - instructions hash equals the intended hash;
   - `tools.length === 0`;
   - `config.enableAlgoliaMcp === false`;
   - `config.useCache === false`;
   - `config.suggestions.enabled === false`.
2. POST a sample `ProactiveGreetingRequest.v1` with `cache=false&memory=false`.
3. Verify the response:
   - parses as JSON;
   - `schema === "ProactiveGreetingResponse.v1"`;
   - `opportunityId` matches;
   - greeting is 12-34 words;
   - chips count is 0-3;
   - every chip is 8 words or fewer;
   - no markdown, telemetry wording, hidden-instruction wording, customer metrics, pricing values, or unsupported claims.
4. Verify from the Jahia page:
   - `algolia-proactive-controller.js?proactive=20260814c` is loaded;
   - controller can resolve `ALGOLIA_CONTEXT_ENGINE_CONFIG.conciergeAgentId`;
   - a valid greeting opens the widget;
   - invalid greeting JSON fails closed.

## References

- Agent configuration API: https://www.algolia.com/doc/guides/algolia-ai/agent-studio/how-to/agent-configuration
- Client-side tools: https://www.algolia.com/doc/guides/algolia-ai/agent-studio/how-to/tools/client-side-tools
- Caching behavior: https://www.algolia.com/doc/guides/algolia-ai/agent-studio/how-to/caching
