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
  const activeAttemptMetadataByIdentity = new Map();
  const answerIdentitiesBySegment = new Map();
  const answerIdentitiesByRuntimeTurn = new Map();
  const pendingTelemetryPlacements = new Map();
  const handledResetIds = new Set();
  const MAX_HANDLED_RESET_IDS = 100;
  const TELEMETRY_PLACEMENT_TIMEOUT_MS = 30000;
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

  function answerIdentityKey(identity) {
    if (!identity || typeof identity !== "object") return "";
    const parts = [
      identity.widgetInstanceId,
      identity.conversationId,
      identity.answerSegmentId,
      identity.networkAttemptId,
    ].map((value) => String(value || "").trim());
    return parts.every(Boolean) ? parts.join("\n") : "";
  }

  function segmentIdentityKey(widgetInstanceId, answerSegmentId) {
    if (!widgetInstanceId || !answerSegmentId) return null;
    return `${widgetInstanceId}\n${answerSegmentId}`;
  }

  function runtimeTurnIdentityKey(widgetInstanceId, runtimeTurnId) {
    if (!widgetInstanceId || !runtimeTurnId) return null;
    return `${widgetInstanceId}\n${runtimeTurnId}`;
  }

  function rememberActiveAttempt(turn) {
    const key = attemptKey(turn);
    const identityKey = answerIdentityKey(answerIdentityForTurn(turn));
    const segmentKey = segmentIdentityKey(turn?.widgetInstanceId, turn?.answerSegmentId);
    const runtimeTurnKey = runtimeTurnIdentityKey(turn?.widgetInstanceId, turn?.runtimeTurnId);
    if (key && turn.networkAttemptId) {
      activeAttempts.delete(key);
      activeAttempts.set(key, turn.networkAttemptId);
    }
    if (segmentKey) {
      const previousIdentityKey = answerIdentityKey(answerIdentitiesBySegment.get(segmentKey));
      if (previousIdentityKey && previousIdentityKey !== identityKey) {
        activeAttemptMetadataByIdentity.delete(previousIdentityKey);
      }
      answerIdentitiesBySegment.delete(segmentKey);
      answerIdentitiesBySegment.set(segmentKey, answerIdentityForTurn(turn));
    }
    if (runtimeTurnKey) {
      answerIdentitiesByRuntimeTurn.delete(runtimeTurnKey);
      answerIdentitiesByRuntimeTurn.set(runtimeTurnKey, answerIdentityForTurn(turn));
    }
    if (identityKey) {
      activeAttemptMetadataByIdentity.delete(identityKey);
      activeAttemptMetadataByIdentity.set(identityKey, {
        turnKey: turn.key,
        conversationGeneration: turn.conversationGeneration,
        networkAttemptOrdinal: turn.networkAttemptOrdinal,
        messageId: turn.messageId,
      });
    }
  }

  function retireActiveAttempt(turnOrDetail, eventName = null) {
    const identity = turnOrDetail?.answerIdentity || answerIdentityForTurn(turnOrDetail);
    const identityKey = answerIdentityKey(identity);
    const key = activeAttemptKeyFromIdentity(identity);
    const networkAttemptId = String(identity?.networkAttemptId || "").trim();
    const segmentKey = segmentIdentityKey(identity?.widgetInstanceId, identity?.answerSegmentId);
    if (eventName && identityKey) {
      notifyAnswerHarness(eventName, Object.freeze({
        answerIdentity: identity,
        widgetInstanceId: identity.widgetInstanceId,
      }));
    }
    if (identityKey) activeAttemptMetadataByIdentity.delete(identityKey);
    if (key && networkAttemptId && activeAttempts.get(key) === networkAttemptId) {
      activeAttempts.delete(key);
    }
  }

  function isActiveAttempt(turn) {
    const key = attemptKey(turn);
    return !key || !turn?.networkAttemptId || activeAttempts.get(key) === turn.networkAttemptId;
  }

  function numericMetadata(value) {
    const number = Number(value);
    return Number.isSafeInteger(number) && number >= 0 ? number : null;
  }

  function validateTurnEvent(detail) {
    const identity = detail?.answerIdentity;
    const identityKey = answerIdentityKey(identity);
    if (!identityKey) return false;
    const record = activeAttemptMetadataByIdentity.get(identityKey);
    if (!record) return false;
    const key = activeAttemptKeyFromIdentity(identity);
    if (!key || activeAttempts.get(key) !== String(identity.networkAttemptId || "").trim()) return false;
    const generation = numericMetadata(detail?.conversationGeneration);
    const ordinal = numericMetadata(detail?.networkAttemptOrdinal);
    if (generation === null || ordinal === null) return false;
    if (generation !== record.conversationGeneration) return false;
    if (ordinal !== record.networkAttemptOrdinal) return false;
    if (String(detail?.turnKey || "") !== record.turnKey) return false;
    if (String(detail?.messageId || "") !== record.messageId) return false;
    return true;
  }

  function activeAttemptKeyFromIdentity(identity) {
    if (!identity) return null;
    const parts = [
      identity.widgetInstanceId,
      identity.conversationId,
      identity.answerSegmentId,
    ].map((value) => String(value || "").trim());
    return parts.every(Boolean) ? parts.join("\n") : null;
  }

  function isActiveTelemetryDetail(detail) {
    const identity = detail?.answerIdentity;
    const key = activeAttemptKeyFromIdentity(identity);
    const networkAttemptId = String(identity?.networkAttemptId || "").trim();
    const segmentKey = segmentIdentityKey(identity?.widgetInstanceId, identity?.answerSegmentId);
    const latestIdentityKey = answerIdentityKey(answerIdentitiesBySegment.get(segmentKey));
    const currentIdentityKey = answerIdentityKey(identity);
    if (latestIdentityKey && currentIdentityKey && latestIdentityKey !== currentIdentityKey) return false;
    if (!key || !networkAttemptId) return true;
    return !activeAttempts.has(key) || activeAttempts.get(key) === networkAttemptId;
  }

  function notifyClosedWidgetAttempts(widgetInstanceId, eventName) {
    if (!widgetInstanceId) return;
    const prefix = `${widgetInstanceId}\n`;
    for (const [key, identity] of answerIdentitiesBySegment.entries()) {
      if (!key.startsWith(prefix)) continue;
      notifyAnswerHarness(eventName, Object.freeze({
        answerIdentity: identity,
        widgetInstanceId,
      }));
    }
  }

  function notifyClosedAnswerHarnessAttempts(eventName) {
    for (const identity of answerIdentitiesBySegment.values()) {
      notifyAnswerHarness(eventName, Object.freeze({
        answerIdentity: identity,
        widgetInstanceId: identity.widgetInstanceId,
      }));
    }
  }

  function clearWidgetAttempts(widgetInstanceId, eventName = null) {
    if (!widgetInstanceId) return;
    if (eventName) notifyClosedWidgetAttempts(widgetInstanceId, eventName);
    const prefix = `${widgetInstanceId}\n`;
    for (const key of activeAttempts.keys()) {
      if (key.startsWith(prefix)) activeAttempts.delete(key);
    }
    for (const key of activeAttemptMetadataByIdentity.keys()) {
      if (key.startsWith(prefix)) activeAttemptMetadataByIdentity.delete(key);
    }
    for (const key of answerIdentitiesBySegment.keys()) {
      if (key.startsWith(prefix)) answerIdentitiesBySegment.delete(key);
    }
    for (const key of answerIdentitiesByRuntimeTurn.keys()) {
      if (key.startsWith(prefix)) answerIdentitiesByRuntimeTurn.delete(key);
    }
    clearPendingTelemetryPlacements(widgetInstanceId);
  }

  function applyScopedReset(widgetInstanceId) {
    if (!widgetInstanceId) return;
    widgetConversationGenerations.set(
      widgetInstanceId,
      (widgetConversationGenerations.get(widgetInstanceId) || 0) + 1
    );
    clearWidgetAttempts(widgetInstanceId, "reset");
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

  function rememberHandledResetId(resetId) {
    if (!resetId) return;
    handledResetIds.add(resetId);
    while (handledResetIds.size > MAX_HANDLED_RESET_IDS) {
      handledResetIds.delete(handledResetIds.values().next().value);
    }
  }

  function logicalTurn(payload, runtimeContext = null) {
    const index = lastUserMessageIndex(payload);
    if (index === -1) return null;
    const message = payload.messages[index] || {};
    const text = userTextFromPayload(payload);
    const persistedConversation = readJson(sessionStorage, "algolia-chat:conversation", null);
    const conversationId = String(
      runtimeContextValue(runtimeContext, "conversationId") ||
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
      conversationGeneration,
      messageId,
      answerSegmentId,
      runtimeTurnId: runtimeContextValue(runtimeContext, "turnId"),
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
    if (key) return answerIdentitiesBySegment.get(key) || null;
    if (!widgetInstanceId) return null;
    const matches = [];
    for (const [segmentKey, identity] of answerIdentitiesBySegment.entries()) {
      if (segmentKey.startsWith(`${widgetInstanceId}\n`)) matches.push(identity);
    }
    return matches.length === 1 ? matches[0] : null;
  }

  function answerIdentityForRuntimeTurn(widgetInstanceId, runtimeTurnId) {
    const key = runtimeTurnIdentityKey(widgetInstanceId, runtimeTurnId);
    return key ? answerIdentitiesByRuntimeTurn.get(key) || null : null;
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

  function notifyAnswerHarness(eventName, detail) {
    const accept = window.algoliaAnswerHarness?.accept;
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
    const runtimeTurnId = String(detail?.runtimeTurnId || "").trim();
    const question = String(detail?.question || "").replace(/\s+/g, " ").trim();
    const widgetInstanceId = detail?.answerIdentity?.widgetInstanceId || detail?.widgetInstanceId || null;
    const widgets = [...document.querySelectorAll("algolia-chat")];
    let host = null;
    if (widgetInstanceId) {
      host = widgets.find((node) => node.__algoliaWidgetInstanceId === widgetInstanceId) || null;
      if (!host && widgets.length === 1 && !widgets[0].__algoliaWidgetInstanceId) host = widgets[0];
    } else {
      host = widgets[0] || null;
    }
    const root = host?.shadowRoot;
    if (!messageId || !question || !root) return null;

    const tagFooterTurn = (footer) => {
      if (!footer) return null;
      const answerCard = footer.parentElement;
      const answerLane = answerCard?.parentElement;
      const turn = answerLane?.parentElement;
      if (runtimeTurnId && turn) turn.dataset.algoliaRuntimeTurnId = runtimeTurnId;
      footer.dataset.algoliaAnswerFooter = messageId;
      footer.dataset.algoliaAnswerAgent = "primary";
      return footer;
    };

    const runtimeTurn = runtimeTurnId
      ? [...root.querySelectorAll("[data-algolia-runtime-turn-id]")]
        .find((node) => node.dataset.algoliaRuntimeTurnId === runtimeTurnId) || null
      : null;
    const existingFooters = [...root.querySelectorAll("[data-algolia-answer-footer]")]
      .filter((node) =>
        node.dataset.algoliaAnswerFooter === messageId ||
        (runtimeTurn && runtimeTurn.contains(node))
      );
    const existingReadyFooter = existingFooters.find((node) =>
      node.querySelector?.(".acs-source-section, algolia-confidence-badge")
    );
    if (existingReadyFooter) return tagFooterTurn(existingReadyFooter);
    if (existingFooters.length === 1) return tagFooterTurn(existingFooters[0]);

    const bubbles = [...root.querySelectorAll('[part="message-user-bubble"]')].reverse();
    const questionMatches = runtimeTurn ? [] : bubbles.filter((node) =>
      node.textContent.replace(/\s+/g, " ").trim() === question
    );
    const bubble = runtimeTurn ? null : questionMatches.find((node) =>
      !node.parentElement?.parentElement?.dataset.algoliaUserMessageId ||
      node.parentElement.parentElement.dataset.algoliaUserMessageId === messageId
    ) || (questionMatches.length === 1 ? questionMatches[0] : null);
    const turn = runtimeTurn || bubble?.parentElement?.parentElement;
    const answerLane = [...(turn?.children || [])]
      .find((node) => node.getAttribute?.("aria-live") === "polite");
    const answerCard = answerLane?.querySelector('div[aria-busy]');
    if (!turn || !answerCard) return null;

    turn.dataset.algoliaUserMessageId = messageId;
    if (runtimeTurnId) turn.dataset.algoliaRuntimeTurnId = runtimeTurnId;
    const footerCandidates = [...answerCard.children].filter((node) => {
      const classes = new Set(String(node.className || "").split(/\s+/));
      return classes.has("flex") && classes.has("items-end") &&
        classes.has("justify-between") && classes.has("gap-4");
    });
    let footer = footerCandidates.find((node) =>
      node.querySelector?.(".acs-source-section, algolia-confidence-badge")
    ) || footerCandidates.at(-1) || null;
    if (!footer) {
      footer = document.createElement("div");
      footer.className = "flex items-end justify-between gap-4";
      const sourceSlot = document.createElement("div");
      sourceSlot.className = "min-w-0 flex-1";
      footer.appendChild(sourceSlot);
      answerCard.appendChild(footer);
    }
    return tagFooterTurn(footer);
  }

  const TELEMETRY_PILL_CLASS = "algolia-usage-pill";

  function formatTokenNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n.toLocaleString("en-US") : String(value ?? "");
  }

  function telemetryPillPart(className, text) {
    const span = document.createElement("span");
    span.className = className;
    span.textContent = text;
    return span;
  }

  function updateTelemetryPillText(pill, text, title) {
    pill.dataset.usageText = "";
    if (pill.textContent !== text) pill.textContent = text;
    if (pill.title !== title) pill.title = title;
  }

  function updateTelemetryPillUsage(pill, totals) {
    const inputTokens = formatTokenNumber(totals.inputTokens);
    const outputTokens = formatTokenNumber(totals.outputTokens);
    const text = `In ${inputTokens} / ${outputTokens} Out`;
    const title = `Current response: ${inputTokens} input tokens and ${outputTokens} output tokens`;
    if (pill.dataset.usageText !== text) {
      pill.replaceChildren(
        telemetryPillPart(`${TELEMETRY_PILL_CLASS}__in`, `In ${inputTokens}`),
        telemetryPillPart(`${TELEMETRY_PILL_CLASS}__divider`, " / "),
        telemetryPillPart(`${TELEMETRY_PILL_CLASS}__out`, `${outputTokens} Out`),
      );
      pill.dataset.usageText = text;
    }
    if (pill.title !== title) pill.title = title;
  }

  function renderTelemetryPill(root, container, state = {}, key = "") {
    if (!root || !container) return false;
    let pill = container.querySelector(`.${TELEMETRY_PILL_CLASS}`);
    if (state.status === "idle" && !state.usage) {
      pill?.remove();
      return true;
    }
    if (!pill) {
      pill = document.createElement("span");
      pill.className = TELEMETRY_PILL_CLASS;
      pill.setAttribute("aria-live", "polite");
      container.appendChild(pill);
    }
    if (key) pill.dataset.algoliaTelemetryKey = key;
    if (state.status === "loading") {
      updateTelemetryPillText(pill, "Calculating tokens…", "Token usage is being calculated");
      return true;
    }
    if (state.status === "unavailable" && !state.usage) {
      updateTelemetryPillText(
        pill,
        "Tokens unavailable",
        "Token usage could not be loaded; the answer is unaffected",
      );
      return true;
    }
    if (state.usage) updateTelemetryPillUsage(pill, state.usage);
    return true;
  }

  function removeDuplicateTelemetryPills(root, footer, key) {
    if (!key || !root?.querySelectorAll || !footer) return;
    for (const pill of root.querySelectorAll(`.${TELEMETRY_PILL_CLASS}`)) {
      if (pill.parentElement !== footer && pill.dataset?.algoliaTelemetryKey === key) pill.remove();
    }
  }

  function telemetryPlacementKey(detail) {
    const identity = detail?.answerIdentity || {};
    const parts = [
      identity.widgetInstanceId || detail?.widgetInstanceId,
      identity.conversationId || detail?.conversationId,
      identity.answerSegmentId || detail?.messageId,
      identity.networkAttemptId || detail?.turnKey,
    ].map((value) => String(value || "").trim());
    return parts.every(Boolean) ? parts.join("\n") : "";
  }

  function widgetHostForTelemetry(detail) {
    const widgets = [...document.querySelectorAll?.("algolia-chat") || []];
    const widgetInstanceId = detail?.answerIdentity?.widgetInstanceId || detail?.widgetInstanceId || null;
    if (widgetInstanceId) {
      const exact = widgets.find((node) => node.__algoliaWidgetInstanceId === widgetInstanceId) || null;
      if (exact) return exact;
      if (widgets.length === 1 && !widgets[0].__algoliaWidgetInstanceId) return widgets[0];
      return null;
    }
    return widgets[0] || null;
  }

  function cancelPendingTelemetryPlacement(key) {
    const pending = pendingTelemetryPlacements.get(key);
    pending?.observer?.disconnect?.();
    if (pending?.timeoutId && typeof clearTimeout === "function") clearTimeout(pending.timeoutId);
    if (key) pendingTelemetryPlacements.delete(key);
  }

  function clearPendingTelemetryPlacements(widgetInstanceId) {
    if (!widgetInstanceId) return;
    for (const [key, pending] of pendingTelemetryPlacements.entries()) {
      if (pending.widgetInstanceId !== widgetInstanceId) continue;
      pending.observer?.disconnect?.();
      if (pending.timeoutId && typeof clearTimeout === "function") clearTimeout(pending.timeoutId);
      pendingTelemetryPlacements.delete(key);
    }
  }

  function observeTelemetryPlacement(detail, state) {
    const key = telemetryPlacementKey(detail);
    const host = widgetHostForTelemetry(detail);
    const root = host?.shadowRoot;
    if (!key || !root || typeof MutationObserver !== "function" || !isActiveTelemetryDetail(detail)) return false;
    const existing = pendingTelemetryPlacements.get(key);
    if (existing) {
      existing.state = { ...(state || {}) };
      return false;
    }
    const widgetInstanceId = detail?.answerIdentity?.widgetInstanceId || detail?.widgetInstanceId || null;
    const observer = new MutationObserver(() => {
      if (!isActiveTelemetryDetail(detail)) {
        cancelPendingTelemetryPlacement(key);
        return;
      }
      const footer = ensureAnswerFooter(detail);
      const footerRoot = footer?.getRootNode?.() || null;
      if (!footer || !footerRoot?.querySelectorAll) return;
      const pending = pendingTelemetryPlacements.get(key);
      if (!pending) return;
      const latest = pending.state || state;
      cancelPendingTelemetryPlacement(key);
      renderTelemetryPill(footerRoot, footer, latest, key);
    });
    observer.observe(root, { childList: true, subtree: true });
    const timeoutId = typeof setTimeout === "function"
      ? setTimeout(() => cancelPendingTelemetryPlacement(key), TELEMETRY_PLACEMENT_TIMEOUT_MS)
      : null;
    pendingTelemetryPlacements.set(key, { observer, widgetInstanceId, state: { ...(state || {}) }, timeoutId });
    return false;
  }

  function renderAnswerFooterTelemetry(detail, state = {}) {
    const key = telemetryPlacementKey(detail);
    if (key && !isActiveTelemetryDetail(detail)) {
      cancelPendingTelemetryPlacement(key);
      return false;
    }
    const migratedFooter = window.algoliaAnswerFooterRenderer;
    if (migratedFooter?.isEnabled?.() && detail && state.status !== "idle") {
      const registered = migratedFooter.registerPlacement?.(detail);
      if (registered) return true;
    }
    const footer = detail ? ensureAnswerFooter(detail) : null;
    const root = footer?.getRootNode?.() || null;

    if (state.status === "idle" && !state.usage) {
      cancelPendingTelemetryPlacement(key);
      if (!footer || !root?.querySelectorAll) return false;
      return renderTelemetryPill(root, footer, state, key);
    }
    if (!footer || !root?.querySelectorAll) return observeTelemetryPlacement(detail, state);
    cancelPendingTelemetryPlacement(key);
    removeDuplicateTelemetryPills(root, footer, key);
    return renderTelemetryPill(root, footer, state, key);
  }

  function observePrimaryCompletion(response, turn) {
    const conversationId = response?.headers?.get?.("X-Conversation-Id");
    if (!turn) return response;
    if (response?.ok === false || !conversationId || !response?.body?.getReader) {
      retireActiveAttempt(turn, response?.ok === false ? "failed" : null);
      return response;
    }
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
            try {
              if (!guardrailViolation) {
                notifyCompletedTurn(Object.freeze({
                  turnKey: turn.key,
                  conversationGeneration: turn.conversationGeneration,
                  networkAttemptOrdinal: turn.networkAttemptOrdinal,
                  ...(turn.runtimeTurnId ? { runtimeTurnId: turn.runtimeTurnId } : {}),
                  messageId: turn.messageId,
                  question: turn.question,
                  conversationId,
                  answerIdentity: answerIdentityForTurn(turn),
                }), { harness: isActiveAttempt(turn) });
              }
            } finally {
              retireActiveAttempt(turn, guardrailViolation ? "failed" : null);
            }
            controller.close();
            return;
          }
          if (!streamingNotified && isActiveAttempt(turn)) {
            streamingNotified = true;
            notifyAnswerHarness("streaming", Object.freeze({
              turnKey: turn.key,
              conversationGeneration: turn.conversationGeneration,
              networkAttemptOrdinal: turn.networkAttemptOrdinal,
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
          retireActiveAttempt(turn, "failed");
          controller.error(error);
        }
      },
      async cancel(reason) {
        try {
          await reader.cancel(reason);
        } catch (error) {
          debug("primary stream cancellation failed (contained)", error);
        } finally {
          retireActiveAttempt(turn, "aborted");
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
          const networkAttemptOrdinal = networkAttemptSequence += 1;
          turn = {
            ...turn,
            networkAttemptOrdinal,
            networkAttemptId: `${turn.widgetInstanceId}:${turn.key}:attempt-${networkAttemptOrdinal}`,
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
        conversationGeneration: turn.conversationGeneration,
        networkAttemptOrdinal: turn.networkAttemptOrdinal,
        runtimeTurnId: turn.runtimeTurnId,
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
      if (turn) retireActiveAttempt(turn, "failed");
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
    rememberHandledResetId(resetId);
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
      rememberHandledResetId(resetId);
      return;
    }
    notifyClosedAnswerHarnessAttempts("reset");
    fallbackConversationGeneration += 1;
    activeAttempts.clear();
    activeAttemptMetadataByIdentity.clear();
    answerIdentitiesBySegment.clear();
    answerIdentitiesByRuntimeTurn.clear();
  });

  document.addEventListener?.("algolia-chat-widget-disconnected", (event) => {
    const widgetInstanceId = widgetInstanceIdFromEvent(event);
    if (widgetInstanceId) clearWidgetAttempts(widgetInstanceId, "disconnected");
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
    answerIdentityForRuntimeTurn,
    validateTurnEvent,
    ensureAnswerFooter,
    renderAnswerFooterTelemetry,
  };
})();
