(function () {
  "use strict";

  const LABEL = "[Algolia Handoff To Orchestrator]";
  const DEBUG =
    new URLSearchParams(location.search).get("algoliaChatDebug") === "1" ||
    new URLSearchParams(location.search).get("algoliaHandoffDebug") === "1";

  const STATE_KEY = "algolia_proactive_state";
  const HANDOFF_SCHEMA = "ProactiveHandoffContext.v1";
  const TOOL_INPUT_SCHEMA = "ProactiveHandoffToolInput.v1";
  const TOOL_NAME = "handoff_to_orchestrator";
  const AGENT_STUDIO_RE = /\/agent-studio\/1\/agents\/([^/?#]+)\/completions/;

  let originalFetch = null;
  let patchedFetch = null;
  let config = {
    enabled: true,
    primaryAgentId: null,
    maxPacketChars: 6500,
  };

  function debug(...args) {
    if (DEBUG) console.log(LABEL, ...args);
  }

  function configure(nextConfig) {
    config = { ...config, ...(nextConfig || {}) };
    debug("configured", config);
  }

  function readJson(storage, key, fallback) {
    try {
      const raw = storage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }

  function writeJson(storage, key, value) {
    try {
      storage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  }

  function readState() {
    const state = readJson(sessionStorage, STATE_KEY, null);
    return {
      schema: "AlgoliaProactiveState.v1",
      opportunities: Array.isArray(state?.opportunities) ? state.opportunities : [],
      lastOpportunityAt: Number.isFinite(state?.lastOpportunityAt) ? state.lastOpportunityAt : 0,
    };
  }

  function writeState(state) {
    return writeJson(sessionStorage, STATE_KEY, {
      schema: state.schema || "AlgoliaProactiveState.v1",
      opportunities: state.opportunities.slice(-20),
      lastOpportunityAt: state.lastOpportunityAt || 0,
    });
  }

  function updateOpportunity(opportunityId, patch) {
    const state = readState();
    const index = state.opportunities.findIndex((item) => item.id === opportunityId);
    if (index === -1) return false;
    state.opportunities[index] = {
      ...state.opportunities[index],
      ...patch,
      updatedAt: Date.now(),
    };
    return writeState(state);
  }

  function primaryAgentId() {
    if (config.primaryAgentId) return config.primaryAgentId;
    const primary = document.querySelector('algolia-agent[role="primary"]');
    return primary?.getAttribute?.("agent-id") || null;
  }

  function agentIdFromUrl(input) {
    const url = typeof input === "string" ? input : input?.url || "";
    const match = AGENT_STUDIO_RE.exec(url);
    return match ? match[1] : null;
  }

  function latestShownOpportunity() {
    const state = readState();
    return [...state.opportunities]
      .reverse()
      .find((item) => item?.status === "shown" && item?.greetingResponse?.schema === "ProactiveGreetingResponse.v1");
  }

  function compilerPacket() {
    const compiler = window.algoliaContextCompiler;
    if (!compiler || typeof compiler.compile !== "function") return null;
    try {
      return compiler.compile();
    } catch {
      return null;
    }
  }

  function compilerTurnContext() {
    const compiler = window.algoliaContextCompiler;
    if (!compiler || typeof compiler.compileTurnContext !== "function") return {};
    try {
      return compiler.compileTurnContext();
    } catch {
      return {};
    }
  }

  function userTextFromPayload(payload) {
    const index = lastUserMessageIndex(payload);
    if (index === -1) return "";
    const part = payload.messages[index]?.parts?.find((item) => item?.type === "text" && typeof item.text === "string");
    return part?.text || "";
  }

  function lastUserMessageIndex(payload) {
    if (!Array.isArray(payload?.messages)) return -1;
    for (let index = payload.messages.length - 1; index >= 0; index -= 1) {
      if (payload.messages[index]?.role === "user") return index;
    }
    return -1;
  }

  function selectedChip(response, userResponse) {
    const text = String(userResponse || "").trim();
    const chips = Array.isArray(response?.chips) ? response.chips : [];
    return chips.find((chip) => chip === text) || null;
  }

  function clippedJson(value) {
    const text = JSON.stringify(value);
    const max = Number.isFinite(config.maxPacketChars) ? config.maxPacketChars : 6500;
    if (text.length <= max) return value;
    return {
      schema: value.schema,
      clipped: true,
      opportunityId: value.opportunityId,
      userResponse: value.userResponse,
      selectedChip: value.selectedChip,
      greeting: value.greeting,
      chips: value.chips,
      handoffSummary: value.handoffSummary,
      contextPacket: value.contextPacket
        ? {
            schema: value.contextPacket.schema,
            profile: value.contextPacket.profile,
            currentPage: value.contextPacket.currentPage,
            inferences: value.contextPacket.inferences,
          }
        : null,
    };
  }

  function buildHandoffPacket(opportunity, userResponse) {
    const response = opportunity.greetingResponse || {};
    const packet = {
      schema: HANDOFF_SCHEMA,
      opportunityId: opportunity.id,
      capturedAt: Date.now(),
      userResponse: String(userResponse || "").trim(),
      selectedChip: selectedChip(response, userResponse),
      greeting: response.greeting || "",
      chips: Array.isArray(response.chips) ? response.chips : [],
      handoffSummary: response.handoffSummary || null,
      requestPacket: opportunity.requestPacket || null,
      contextPacket: compilerPacket(),
      instruction:
        "This was a proactive engagement. Use the context softly, never expose telemetry, answer the user's response directly, then continue normal discovery.",
    };
    return clippedJson(packet);
  }

  function decorateBody(body) {
    if (!config.enabled || typeof body !== "string") return body;
    let payload;
    try {
      payload = JSON.parse(body);
    } catch {
      return body;
    }

    const opportunity = latestShownOpportunity();
    if (!opportunity) return body;

    const index = lastUserMessageIndex(payload);
    if (index === -1) return body;
    const parts = Array.isArray(payload.messages[index].parts) ? payload.messages[index].parts : [];
    const textPart = parts.find((part) => part?.type === "text" && typeof part.text === "string");
    if (!textPart || textPart.text.includes("PROACTIVE_HANDOFF_CONTEXT")) return body;

    const userResponse = userTextFromPayload(payload).trim();
    if (!userResponse) return body;

    const handoff = buildHandoffPacket(opportunity, userResponse);
    textPart.text = `${textPart.text}\n\nPROACTIVE_HANDOFF_CONTEXT\n${JSON.stringify(handoff)}`;
    payload.messages[index] = {
      ...payload.messages[index],
      metadata: {
        ...(payload.messages[index].metadata || {}),
        turnContext: {
          ...(payload.messages[index].metadata?.turnContext || {}),
          ...compilerTurnContext(),
        },
      },
    };

    updateOpportunity(opportunity.id, {
      status: "handoff_sent",
      handoffAt: Date.now(),
      userResponse,
      selectedChip: handoff.selectedChip,
      handoffSchema: HANDOFF_SCHEMA,
    });
    document.dispatchEvent(
      new CustomEvent("algolia-proactive-handoff", {
        bubbles: true,
        composed: true,
        detail: handoff,
      })
    );
    debug("attached proactive handoff", handoff);
    return JSON.stringify(payload);
  }

  async function handleHandoffTool(input = {}) {
    if (input.schema && input.schema !== TOOL_INPUT_SCHEMA) {
      return { success: false, error: { code: "INVALID_SCHEMA", message: "Invalid handoff tool schema." } };
    }
    const opportunityId = String(input.opportunityId || "").trim();
    if (!opportunityId) {
      return { success: false, error: { code: "MISSING_OPPORTUNITY", message: "Missing opportunityId." } };
    }
    const state = readState();
    const opportunity = state.opportunities.find((item) => item.id === opportunityId);
    if (!opportunity) {
      return { success: false, error: { code: "NOT_FOUND", message: "No matching proactive opportunity." } };
    }
    updateOpportunity(opportunityId, {
      status: "handoff_tool_called",
      toolCalledAt: Date.now(),
      greeting: input.greeting || opportunity.greetingResponse?.greeting || "",
      chips: Array.isArray(input.chips) ? input.chips : opportunity.greetingResponse?.chips || [],
      selectedChip: input.selectedChip || null,
      userResponse: input.userResponse || "",
    });
    return {
      success: true,
      opportunityId,
      message: "Handoff captured. The next orchestrator turn will receive the proactive context.",
    };
  }

  function installFetchInterceptor() {
    if (typeof window.fetch !== "function") return false;
    if (patchedFetch && window.fetch === patchedFetch) return false;
    originalFetch = window.fetch;
    patchedFetch = function algoliaHandoffFetch(input, init = {}) {
      const targetAgentId = agentIdFromUrl(input);
      const primary = primaryAgentId();
      if (targetAgentId && primary && targetAgentId === primary && init && typeof init.body === "string") {
        const nextInit = { ...(init || {}), body: decorateBody(init.body) };
        return originalFetch.call(this, input, nextInit);
      }
      return originalFetch.apply(this, arguments);
    };
    window.fetch = patchedFetch;
    return true;
  }

  function waitForToolRegistry() {
    const register = () => {
      if (!window.algoliaChat || typeof window.algoliaChat.registerTool !== "function") return false;
      window.algoliaChat.registerTool(TOOL_NAME, handleHandoffTool);
      debug(`registered tool '${TOOL_NAME}'`);
      return true;
    };
    if (register()) return;
    const interval = setInterval(() => {
      if (register()) clearInterval(interval);
    }, 100);
    setTimeout(() => clearInterval(interval), 15000);
  }

  if (!window.__algoliaHandoffToOrchestratorInstalled) {
    window.__algoliaHandoffToOrchestratorInstalled = true;
    if (window.ALGOLIA_HANDOFF_CONFIG && typeof window.ALGOLIA_HANDOFF_CONFIG === "object") {
      configure(window.ALGOLIA_HANDOFF_CONFIG);
    }
    installFetchInterceptor();
    waitForToolRegistry();
  }

  window.algoliaHandoffToOrchestrator = {
    configure,
    decorateBody,
    buildHandoffPacket,
    handleHandoffTool,
    installFetchInterceptor,
  };
})();
