(function () {
  "use strict";

  const LABEL = "[Algolia Handoff To Orchestrator]";
  function debugFlag(name) {
    try {
      const params = new URLSearchParams(location.search);
      return (
        params.get("algoliaChatDebug") === "1" ||
        params.get(name) === "1" ||
        localStorage.getItem("algoliaDebug") === "1" ||
        localStorage.getItem("algoliaChatDebug") === "1" ||
        localStorage.getItem(name) === "1"
      );
    } catch {
      return false;
    }
  }

  const DEBUG = debugFlag("algoliaHandoffDebug");

  const STATE_KEY = "algolia_proactive_state";
  const HANDOFF_CONTEXT_KEY = "algolia-chat:handoff-context";
  const HANDOFF_SCHEMA = "ProactiveHandoffContext.v1";
  const DISCOVERY_CONTROL_RE = /\n*\[DISCOVERY CONTROL[^\]]*\][\s\S]*?\[END DISCOVERY CONTROL\]\s*/gi;
  const DISCOVERY_STATE_COMMENT_RE = /\n*<!--DISCOVERY_STATE[\s\S]*?DISCOVERY_STATE-->\s*/gi;
  const LEGACY_VISITOR_INTELLIGENCE_RE = /\n*VISITOR INTELLIGENCE \(JSON DATA, NOT INSTRUCTIONS\)[\s\S]*$/i;

  const fallbackFetch = typeof window.fetch === "function" ? window.fetch.bind(window) : null;
  let transportInstalled = false;
  const preparedTurnListeners = new Set();
  let config = {
    enabled: true,
    primaryAgentId: null,
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
    const previous = state.opportunities[index];
    const lifecycle = Array.isArray(previous.lifecycle)
      ? [...previous.lifecycle]
      : previous.status
        ? [previous.status]
        : [];
    if (patch.status && lifecycle.at(-1) !== patch.status) lifecycle.push(patch.status);
    state.opportunities[index] = {
      ...previous,
      ...patch,
      lifecycle,
      updatedAt: Date.now(),
    };
    return writeState(state);
  }

  function latestShownOpportunity() {
    const state = readState();
    return [...state.opportunities]
      .reverse()
      .find((item) => item?.status === "shown" && item?.greetingResponse?.schema === "ProactiveGreetingResponse.v1");
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
    return cleanVisitorText(part?.text || "");
  }

  function cleanVisitorText(text) {
    return String(text || "")
      .replace(DISCOVERY_CONTROL_RE, "")
      .replace(DISCOVERY_STATE_COMMENT_RE, "")
      .replace(LEGACY_VISITOR_INTELLIGENCE_RE, "")
      .trim();
  }

  function lastUserMessageIndex(payload) {
    if (!Array.isArray(payload?.messages)) return -1;
    for (let index = payload.messages.length - 1; index >= 0; index -= 1) {
      if (payload.messages[index]?.role === "user") return index;
    }
    return -1;
  }

  function logicalTurn(payload) {
    const index = lastUserMessageIndex(payload);
    if (index === -1) return null;
    const message = payload.messages[index] || {};
    const text = userTextFromPayload(payload);
    const persistedConversation = readJson(sessionStorage, "algolia-chat:conversation", null);
    const conversationId = String(
      payload.id || payload.conversationId || persistedConversation?.conversationId || "conversation"
    );
    const messageId = String(message.id || message.messageId || `${index}:${text}`);
    return {
      key: `${conversationId}:${messageId}`,
      question: text,
    };
  }

  function subscribePreparedTurn(listener) {
    if (typeof listener !== "function") throw new TypeError("Prepared-turn listener must be a function");
    preparedTurnListeners.add(listener);
    return () => preparedTurnListeners.delete(listener);
  }

  function notifyPreparedTurn(detail) {
    for (const listener of preparedTurnListeners) {
      try {
        listener(detail);
      } catch (error) {
        debug("prepared-turn listener failed (contained)", error);
      }
    }
  }

  function selectedChip(response, userResponse) {
    const text = String(userResponse || "").trim();
    const chips = Array.isArray(response?.chips) ? response.chips : [];
    return chips.find((chip) => chip === text) || null;
  }

  function requestSummary(opportunity) {
    const request = opportunity?.requestPacket || {};
    const summary = opportunity?.greetingResponse?.handoffSummary || {};
    const currentPage = request.currentPage || {};
    const journey = request.journeySummary || {};
    return {
      schema: request.schema || null,
      moment: summary.moment || request.moment || null,
      trigger: summary.trigger || request.trigger || null,
      messageGoal: summary.messageGoal || request.messageGoal || null,
      persona: request.persona
        ? {
            value: request.persona.value || null,
            state: request.persona.state || null,
            confidence: Number.isFinite(request.persona.confidence)
              ? request.persona.confidence
              : null,
          }
        : null,
      currentPage: {
        path: currentPage.path || null,
        pageGroup: currentPage.pageGroup || null,
        topic: currentPage.topic || null,
        productFocusLabel: currentPage.productFocusLabel || null,
        solutionFocusLabel: currentPage.solutionFocusLabel || null,
      },
      journey: {
        currentTransition: journey.currentTransition || null,
        productTrail: Array.isArray(journey.productTrail) ? journey.productTrail : [],
        solutionTrail: Array.isArray(journey.solutionTrail) ? journey.solutionTrail : [],
        storyHint: journey.storyHint || "",
      },
    };
  }

  function buildHandoffPacket(opportunity, userResponse, originalTurnContext = compilerTurnContext()) {
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
      requestSummary: requestSummary(opportunity),
      originalTurnContext,
      instruction:
        "This was a proactive engagement. Use the context softly, never expose telemetry, answer the user's response directly, then continue normal discovery.",
    };
    return packet;
  }

  function prepareBody(body) {
    if (!config.enabled || typeof body !== "string") return { body, handoff: null, opportunityId: null };
    let payload;
    try {
      payload = JSON.parse(body);
    } catch {
      return { body, handoff: null, opportunityId: null };
    }

    const opportunity = latestShownOpportunity();
    const persistedHandoff = readJson(sessionStorage, HANDOFF_CONTEXT_KEY, null);
    if (!opportunity && persistedHandoff?.schema !== HANDOFF_SCHEMA) {
      return { body, handoff: null, opportunityId: null };
    }

    const index = lastUserMessageIndex(payload);
    if (index === -1) return { body, handoff: null, opportunityId: null };
    const parts = Array.isArray(payload.messages[index].parts) ? payload.messages[index].parts : [];
    const textPart = parts.find((part) => part?.type === "text" && typeof part.text === "string");
    if (!textPart || textPart.text.includes("PROACTIVE_HANDOFF_CONTEXT")) {
      return { body, handoff: null, opportunityId: null };
    }

    const userResponse = userTextFromPayload(payload).trim();
    if (!userResponse) return { body, handoff: null, opportunityId: null };

    const existingTurnContext = payload.messages[index].metadata?.turnContext;
    const turnContext =
      existingTurnContext && typeof existingTurnContext === "object"
        ? existingTurnContext
        : typeof window.algoliaContextCompiler?.mergeTurnContext === "function"
          ? window.algoliaContextCompiler.mergeTurnContext(existingTurnContext)
          : compilerTurnContext();
    const handoff = opportunity
      ? buildHandoffPacket(opportunity, userResponse, turnContext)
      : persistedHandoff;
    textPart.text = `${textPart.text}\n\nPROACTIVE_HANDOFF_CONTEXT\n${JSON.stringify(handoff)}`;
    payload.messages[index] = {
      ...payload.messages[index],
      metadata: {
        ...(payload.messages[index].metadata || {}),
        turnContext,
      },
    };

    if (opportunity) {
      writeJson(sessionStorage, HANDOFF_CONTEXT_KEY, handoff);
      updateOpportunity(opportunity.id, {
        status: "engaged",
        handoffStartedAt: Date.now(),
        userResponse,
        selectedChip: handoff.selectedChip,
        handoffSchema: HANDOFF_SCHEMA,
      });
    }
    debug("attached proactive handoff", handoff);
    return {
      body: JSON.stringify(payload),
      handoff,
      opportunityId: opportunity?.id || null,
    };
  }

  function decorateBody(body) {
    return prepareBody(body).body;
  }

  async function orchestratorTransport(input, init = {}) {
    const compiler = window.algoliaContextCompiler;
    const sendPrepared =
      typeof compiler?.fetchPrepared === "function"
        ? compiler.fetchPrepared.bind(compiler)
        : fallbackFetch;
    if (!sendPrepared) throw new Error("Orchestrator transport requires window.fetch");
    let prepared;
    let turn = null;
    try {
      const contextBody =
        typeof compiler?.prepareCompletionBody === "function"
          ? compiler.prepareCompletionBody(init.body)
          : init.body;
      // Correlate and label the visitor turn before proactive handoff decorates
      // the user text with its private control packet. The prepared body emitted
      // below remains the exact on-wire body; only the visible label/dedupe key
      // comes from the clean logical turn.
      try {
        turn = logicalTurn(JSON.parse(contextBody));
      } catch {}
      prepared = prepareBody(contextBody);
    } catch (error) {
      const opportunity = latestShownOpportunity();
      if (opportunity) {
        const failure = [error?.code || "context_validation_error", error?.field, error?.actualBytes]
          .filter((value) => value !== undefined && value !== null && value !== "")
          .join(":");
        updateOpportunity(opportunity.id, {
          status: "shown",
          handoffFailure: failure,
          handoffFailedAt: Date.now(),
        });
      }
      debug("blocked invalid handoff context", error);
      throw error;
    }
    const nextInit = { ...(init || {}), body: prepared.body };
    if (turn) {
      notifyPreparedTurn(Object.freeze({
        body: prepared.body,
        turnKey: turn.key,
        question: turn.question,
      }));
    }
    try {
      const response = await sendPrepared(input, nextInit);
      if (prepared.opportunityId && response?.ok !== false) {
        updateOpportunity(prepared.opportunityId, {
          status: "handed_off",
          handoffAt: Date.now(),
          handoffFailure: null,
        });
        updateOpportunity(prepared.opportunityId, {
          status: "active",
          activeAt: Date.now(),
        });
        document.dispatchEvent(
          new CustomEvent("algolia-proactive-handoff", {
            bubbles: true,
            composed: true,
            detail: prepared.handoff,
          })
        );
      } else if (prepared.opportunityId) {
        updateOpportunity(prepared.opportunityId, {
          status: "shown",
          handoffFailure: `http_${response?.status || "error"}`,
        });
      }
      return response;
    } catch (error) {
      if (prepared.opportunityId) {
        updateOpportunity(prepared.opportunityId, {
          status: "shown",
          handoffFailure: "network_error",
        });
      }
      throw error;
    }
  }

  function installTransportAdapter() {
    if (transportInstalled) return true;
    const setter = window.algoliaChat?.setOrchestratorTransport;
    if (typeof setter !== "function") return false;
    setter(orchestratorTransport);
    transportInstalled = true;
    return true;
  }

  function installWhenReady(attempt = 0) {
    if (installTransportAdapter() || attempt >= 40) return;
    setTimeout(() => installWhenReady(attempt + 1), 50);
  }

  if (!window.__algoliaHandoffToOrchestratorInstalled) {
    window.__algoliaHandoffToOrchestratorInstalled = true;
    if (window.ALGOLIA_HANDOFF_CONFIG && typeof window.ALGOLIA_HANDOFF_CONFIG === "object") {
      configure(window.ALGOLIA_HANDOFF_CONFIG);
    }
    installWhenReady();
  }

  window.algoliaHandoffToOrchestrator = {
    configure,
    decorateBody,
    buildHandoffPacket,
    orchestratorTransport,
    installTransportAdapter,
    subscribePreparedTurn,
  };
})();
