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
  const LEGACY_VISITOR_INTELLIGENCE_RE = /\n*VISITOR INTELLIGENCE \(JSON DATA, NOT INSTRUCTIONS\)[\s\S]*$/i;

  const fallbackFetch = typeof window.fetch === "function" ? window.fetch.bind(window) : null;
  let transportInstalled = false;
  const preparedTurnListeners = new Set();
  const completedTurnListeners = new Set();
  let fallbackConversationGeneration = 0;
  let networkAttemptSequence = 0;
  const widgetConversationGenerations = new Map();
  const activeAttempts = new Map();
  const answerIdentitiesBySegment = new Map();
  const handledResetIds = new Set();
  let defaultAnswerHarness = null;
  let config = {
    enabled: true,
    primaryAgentId: null,
    widgetInstanceId: null,
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

  function runtimeContextValue(runtimeContext, key) {
    const value = runtimeContext?.[key] || runtimeContext?.metadata?.[key];
    return typeof value === "string" && value.trim() ? value.trim() : null;
  }

  function generationForWidget(widgetInstanceId) {
    if (widgetInstanceId && widgetInstanceId !== "algolia-chat:default") {
      return widgetConversationGenerations.get(widgetInstanceId) || 0;
    }
    return fallbackConversationGeneration;
  }

  function attemptKey(turn) {
    if (!turn) return null;
    return `${turn.widgetInstanceId}\n${turn.conversationId}\n${turn.answerSegmentId}`;
  }

  function segmentIdentityKey(widgetInstanceId, answerSegmentId) {
    if (!widgetInstanceId || !answerSegmentId) return null;
    return `${widgetInstanceId}\n${answerSegmentId}`;
  }

  function rememberActiveAttempt(turn) {
    const key = attemptKey(turn);
    if (key && turn.networkAttemptId) activeAttempts.set(key, turn.networkAttemptId);
    const segmentKey = segmentIdentityKey(turn?.widgetInstanceId, turn?.answerSegmentId);
    if (segmentKey) answerIdentitiesBySegment.set(segmentKey, answerIdentityForTurn(turn));
  }

  function isActiveAttempt(turn) {
    const key = attemptKey(turn);
    return !key || !turn?.networkAttemptId || activeAttempts.get(key) === turn.networkAttemptId;
  }

  function clearWidgetAttempts(widgetInstanceId) {
    if (!widgetInstanceId) return;
    const prefix = `${widgetInstanceId}\n`;
    for (const key of activeAttempts.keys()) {
      if (key.startsWith(prefix)) activeAttempts.delete(key);
    }
    for (const key of answerIdentitiesBySegment.keys()) {
      if (key.startsWith(prefix)) answerIdentitiesBySegment.delete(key);
    }
  }

  function applyScopedReset(widgetInstanceId) {
    if (!widgetInstanceId) return;
    widgetConversationGenerations.set(
      widgetInstanceId,
      (widgetConversationGenerations.get(widgetInstanceId) || 0) + 1
    );
    clearWidgetAttempts(widgetInstanceId);
  }

  function widgetInstanceIdFromEvent(event) {
    const detailId = event?.detail?.widgetInstanceId;
    if (typeof detailId === "string" && detailId.trim()) return detailId.trim();
    const targetId = event?.target?.__algoliaWidgetInstanceId;
    if (typeof targetId === "string" && targetId.trim()) return targetId.trim();
    const path = typeof event?.composedPath === "function" ? event.composedPath() : [];
    const owner = path.find((node) => typeof node?.__algoliaWidgetInstanceId === "string");
    return owner?.__algoliaWidgetInstanceId || null;
  }

  function logicalTurn(payload, runtimeContext = null) {
    const index = lastUserMessageIndex(payload);
    if (index === -1) return null;
    const message = payload.messages[index] || {};
    const text = userTextFromPayload(payload);
    const persistedConversation = readJson(sessionStorage, "algolia-chat:conversation", null);
    const conversationId = String(
      payload.id || payload.conversationId || persistedConversation?.conversationId || "conversation"
    );
    const messageId = String(message.id || message.messageId || `${index}:${text}`);
    const answerSegmentId = String(
      runtimeContextValue(runtimeContext, "answerSegmentId") ||
      runtimeContextValue(runtimeContext, "assistantSegmentId") ||
      runtimeContextValue(runtimeContext, "assistantMessageId") ||
      payload.answerSegmentId ||
      payload.responseId ||
      payload.metadata?.answerSegmentId ||
      payload.metadata?.responseId ||
      payload.metadata?.assistantSegmentId ||
      payload.metadata?.assistantMessageId ||
      message.answerSegmentId ||
      message.responseId ||
      message.metadata?.answerSegmentId ||
      message.metadata?.responseId ||
      message.metadata?.assistantSegmentId ||
      message.metadata?.assistantMessageId ||
      message.id ||
      message.messageId ||
      `${index}:${text}`
    );
    const widgetInstanceId = String(
      runtimeContextValue(runtimeContext, "widgetInstanceId") ||
      payload.widgetInstanceId ||
      payload.metadata?.widgetInstanceId ||
      message.metadata?.widgetInstanceId ||
      config.widgetInstanceId ||
      "algolia-chat:default"
    );
    const conversationGeneration = generationForWidget(widgetInstanceId);
    return {
      key: `${conversationGeneration ? `${conversationGeneration}:` : ""}${conversationId}:${messageId}`,
      conversationId,
      messageId,
      answerSegmentId,
      widgetInstanceId,
      question: text,
    };
  }

  function answerIdentityForTurn(turn) {
    if (!turn) return null;
    return Object.freeze({
      widgetInstanceId: turn.widgetInstanceId,
      conversationId: turn.conversationId,
      answerSegmentId: turn.answerSegmentId,
      networkAttemptId: turn.networkAttemptId,
    });
  }

  function answerIdentityForSegment(widgetInstanceId, answerSegmentId) {
    const key = segmentIdentityKey(widgetInstanceId, answerSegmentId);
    return key ? answerIdentitiesBySegment.get(key) || null : null;
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
    notifyAnswerHarness("prepared", detail);
  }

  function subscribeCompletedTurn(listener) {
    if (typeof listener !== "function") throw new TypeError("Completed-turn listener must be a function");
    completedTurnListeners.add(listener);
    return () => completedTurnListeners.delete(listener);
  }

  function notifyCompletedTurn(detail, options = {}) {
    for (const listener of completedTurnListeners) {
      try {
        listener(detail);
      } catch (error) {
        debug("completed-turn listener failed (contained)", error);
      }
    }
    if (options.harness !== false) notifyAnswerHarness("completed", detail);
  }

  function answerHarnessKey(identity) {
    if (!identity) return "";
    return [
      identity.widgetInstanceId,
      identity.conversationId,
      identity.answerSegmentId,
      identity.networkAttemptId,
    ].map((part) => String(part || "")).join("::");
  }

  function mergeAnswerHarnessSlots(target, contribution) {
    const slots = contribution?.slots;
    if (!slots || typeof slots !== "object") return;
    for (const [name, slot] of Object.entries(slots)) {
      target.slots[name] = Object.freeze({ ...(target.slots[name] || {}), ...(slot || {}) });
    }
  }

  function mergeAnswerHarnessEvidence(target, contribution) {
    const passages = contribution?.evidence?.passages;
    if (!Array.isArray(passages)) return;
    const seen = new Set(target.evidence.passages.map((passage) => passage.id));
    for (const passage of passages) {
      if (!passage?.id || seen.has(passage.id)) continue;
      seen.add(passage.id);
      target.evidence.passages.push(Object.freeze({ ...passage }));
    }
  }

  function createDefaultAnswerHarness() {
    const records = new Map();
    const events = [];
    const rejections = [];
    const readRecord = (identity) => records.get(answerHarnessKey(identity)) || null;
    const ensureRecord = (identity) => {
      const key = answerHarnessKey(identity);
      if (!key) return null;
      const existing = records.get(key);
      if (existing) return existing;
      const record = {
        contractVersion: 1,
        identity: Object.freeze({ ...identity }),
        lifecycle: "searching",
        slots: {
          progress: Object.freeze({ status: "ready", value: { percent: 0 } }),
        },
        evidence: {
          passages: [],
        },
      };
      records.set(key, record);
      return record;
    };
    const accept = (event) => {
      const eventName = event?.eventName;
      const detail = event?.detail || {};
      const identity = detail.answerIdentity || detail.contribution?.identity;
      const key = answerHarnessKey(identity);
      if (!key) {
        rejections.push({ eventName, reason: "missing_identity" });
        return null;
      }
      let record = ensureRecord(identity);
      if (!record) return null;
      if (eventName === "streaming") record.lifecycle = "streaming";
      if (eventName === "judging") record.lifecycle = "judging";
      if (eventName === "failed") record.lifecycle = "failed";
      if (eventName === "completed") {
        record.lifecycle = "complete";
        record.slots.progress = Object.freeze({ status: "ready", value: { percent: 100 } });
      }
      if (detail.contribution) {
        mergeAnswerHarnessSlots(record, detail.contribution);
        mergeAnswerHarnessEvidence(record, detail.contribution);
        if (detail.contribution.lifecycle && eventName !== "completed") {
          record.lifecycle = detail.contribution.lifecycle;
        }
      }
      events.push({ eventName, key });
      return Object.freeze({
        ...record,
        slots: Object.freeze({ ...record.slots }),
        evidence: Object.freeze({ passages: Object.freeze(record.evidence.passages.slice()) }),
      });
    };
    return Object.freeze({
      contractVersion: 1,
      accept,
      getRecord: readRecord,
      records: () => Object.freeze([...records.values()].map((record) => Object.freeze({
        ...record,
        slots: Object.freeze({ ...record.slots }),
        evidence: Object.freeze({ passages: Object.freeze(record.evidence.passages.slice()) }),
      }))),
      events: () => Object.freeze(events.slice()),
      rejections: () => Object.freeze(rejections.slice()),
    });
  }

  function ensureAnswerHarnessObserver() {
    if (window.algoliaAnswerHarness?.accept) return window.algoliaAnswerHarness;
    if (!defaultAnswerHarness) defaultAnswerHarness = createDefaultAnswerHarness();
    window.algoliaAnswerHarness = defaultAnswerHarness;
    return defaultAnswerHarness;
  }

  function notifyAnswerHarness(eventName, detail) {
    const observer = window.algoliaAnswerHarness || ensureAnswerHarnessObserver();
    const accept = observer?.accept;
    if (typeof accept !== "function") return;
    try {
      accept(Object.freeze({
        eventName,
        detail,
      }));
    } catch (error) {
      debug("answer harness observer failed (contained)", error);
    }
  }

  function ensureAnswerFooter(detail) {
    const messageId = String(detail?.messageId || "");
    const question = String(detail?.question || "").replace(/\s+/g, " ").trim();
    const widgetInstanceId = detail?.answerIdentity?.widgetInstanceId || detail?.widgetInstanceId || null;
    const widgets = [...document.querySelectorAll("algolia-chat")];
    const host = widgetInstanceId
      ? widgets.find((node) => node.__algoliaWidgetInstanceId === widgetInstanceId) || widgets[0]
      : widgets[0];
    const root = host?.shadowRoot;
    if (!messageId || !question || !root) return null;

    const existing = [...root.querySelectorAll("[data-algolia-answer-footer]")]
      .find((node) => node.dataset.algoliaAnswerFooter === messageId);
    if (existing) return existing;

    const bubbles = [...root.querySelectorAll('[part="message-user-bubble"]')].reverse();
    const bubble = bubbles.find((node) =>
      node.textContent.replace(/\s+/g, " ").trim() === question &&
      (!node.parentElement?.parentElement?.dataset.algoliaUserMessageId ||
        node.parentElement.parentElement.dataset.algoliaUserMessageId === messageId)
    );
    const turn = bubble?.parentElement?.parentElement;
    const answerLane = [...(turn?.children || [])]
      .find((node) => node.getAttribute?.("aria-live") === "polite");
    const answerCard = answerLane?.querySelector('div[aria-busy]');
    if (!turn || !answerCard) return null;

    turn.dataset.algoliaUserMessageId = messageId;
    let footer = [...answerCard.children].find((node) => {
      const classes = new Set(String(node.className || "").split(/\s+/));
      return classes.has("flex") && classes.has("items-end") &&
        classes.has("justify-between") && classes.has("gap-4");
    }) || null;
    if (!footer) {
      footer = document.createElement("div");
      footer.className = "flex items-end justify-between gap-4";
      const sourceSlot = document.createElement("div");
      sourceSlot.className = "min-w-0 flex-1";
      footer.appendChild(sourceSlot);
      answerCard.appendChild(footer);
    }
    footer.dataset.algoliaAnswerFooter = messageId;
    footer.dataset.algoliaAnswerAgent = "primary";
    return footer;
  }

  function observePrimaryCompletion(response, turn) {
    const conversationId = response?.headers?.get?.("X-Conversation-Id");
    if (!turn || response?.ok === false || !conversationId || !response?.body?.getReader) return response;
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let diagnosticTail = "";
    let guardrailViolation = false;
    let streamingNotified = false;
    const observedBody = new ReadableStream({
      async pull(controller) {
        try {
          const chunk = await reader.read();
          if (chunk.done) {
            if (!guardrailViolation) {
              notifyCompletedTurn(Object.freeze({
                turnKey: turn.key,
                messageId: turn.messageId,
                question: turn.question,
                conversationId,
                answerIdentity: answerIdentityForTurn(turn),
              }), { harness: isActiveAttempt(turn) });
            }
            controller.close();
            return;
          }
          if (!streamingNotified && isActiveAttempt(turn)) {
            streamingNotified = true;
            notifyAnswerHarness("streaming", Object.freeze({
              turnKey: turn.key,
              messageId: turn.messageId,
              question: turn.question,
              conversationId,
              answerIdentity: answerIdentityForTurn(turn),
            }));
          }
          diagnosticTail += decoder.decode(chunk.value, { stream: true });
          if (/"type"\s*:\s*"data-guardrail-violation"/.test(diagnosticTail)) {
            guardrailViolation = true;
          }
          diagnosticTail = diagnosticTail.slice(-4096);
          controller.enqueue(chunk.value);
        } catch (error) {
          controller.error(error);
        }
      },
      async cancel(reason) {
        try {
          await reader.cancel(reason);
        } catch (error) {
          debug("primary stream cancellation failed (contained)", error);
        }
      },
    });
    return new Response(observedBody, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  }

  function selectedChip(response, userResponse) {
    const text = String(userResponse || "").trim();
    const chips = Array.isArray(response?.chips) ? response.chips : [];
    return chips.find((chip) => chip === text) || null;
  }

  function buildHandoffPacket(opportunity, userResponse, originalTurnContext = compilerTurnContext()) {
    if (!opportunity?.requestPacket || opportunity.requestPacket.schema !== "ProactiveGreetingRequest.v1") {
      throw new Error("Cannot hand off proactive engagement without the complete ProactiveGreetingRequest.v1 packet");
    }
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
      requestPacket: opportunity.requestPacket,
      originalTurnContext,
      instruction:
        "This was a proactive engagement. The visible user response is primary intent. Use the unchanged requestPacket as confirmed journey context, the greeting as prior assistant framing, the selected chip as the chosen path, and unselected chips only as alternatives that were offered. Never expose telemetry.",
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

  async function orchestratorTransport(input, init = {}, runtimeContext = null) {
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
        turn = logicalTurn(JSON.parse(contextBody), runtimeContext);
        if (turn) {
          turn = {
            ...turn,
            networkAttemptId: `${turn.widgetInstanceId}:${turn.key}:attempt-${networkAttemptSequence += 1}`,
          };
        }
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
      rememberActiveAttempt(turn);
      notifyPreparedTurn(Object.freeze({
        body: prepared.body,
        turnKey: turn.key,
        messageId: turn.messageId,
        question: turn.question,
        answerIdentity: answerIdentityForTurn(turn),
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
      return observePrimaryCompletion(response, turn);
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

  document.addEventListener?.("algolia-visitor-reset-requested", (event) => {
    const receipt = event?.__algoliaVisitorResetReceipt;
    const resetId = typeof receipt?.resetId === "string" ? receipt.resetId : null;
    if (resetId && handledResetIds.has(resetId)) return;
    const widgetInstanceId = widgetInstanceIdFromEvent(event);
    if (!widgetInstanceId) return;
    applyScopedReset(widgetInstanceId);
    try {
      Object.defineProperty(event, "__algoliaHandoffScopedResetHandled", {
        configurable: true,
        value: true,
      });
    } catch {
      event.__algoliaHandoffScopedResetHandled = true;
    }
  });

  document.addEventListener?.("algolia-visitor-state-reset", (event) => {
    if (event?.detail?.handoffScopedResetHandled === true) return;
    const widgetInstanceId = widgetInstanceIdFromEvent(event);
    if (widgetInstanceId) {
      const resetId = typeof event?.detail?.resetId === "string" ? event.detail.resetId : null;
      if (resetId && handledResetIds.has(resetId)) return;
      applyScopedReset(widgetInstanceId);
      if (resetId) handledResetIds.add(resetId);
      return;
    }
    fallbackConversationGeneration += 1;
    activeAttempts.clear();
  });

  window.algoliaHandoffToOrchestrator = {
    configure,
    decorateBody,
    buildHandoffPacket,
    orchestratorTransport,
    installTransportAdapter,
    subscribePreparedTurn,
    subscribeCompletedTurn,
    answerIdentityForSegment,
    ensureAnswerFooter,
  };
})();
