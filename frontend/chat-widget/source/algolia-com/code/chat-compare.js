/**
 * algolia-chat-compare.js — Compare-with-production companion.
 *
 * Adds one "Compare with Prod" toggle beside the latest answer's Sources
 * and Judge controls. It appears only when there is an answer to compare. The
 * latest finalized request is replayed byte-for-byte to live algolia.com Ask AI.
 *
 * Ownership boundaries (deliberate):
 *   - This module owns ONLY the production side. The concierge/left side keeps
 *     whatever agent and index the host page already configured on <algolia-chat>;
 *     nothing here reads, overrides or hardcodes it.
 *   - It does NOT modify algolia-chat.js and does NOT patch window.fetch.
 *     handoff-to-orchestrator.js remains the sole transport owner and publishes
 *     the already-finalized request body to this companion.
 *   - Every production failure is contained: the concierge answer path is never
 *     touched, so a 403/429/500/malformed stream degrades only this column.
 *
 * Production endpoint, in priority order:
 *   1. window.ACS_COMPARE.prod = { appId, apiKey, agentId }  → direct call.
 *      Used where the page origin is on the agent's approved-domains list
 *      (the Jahia surface is).
 *   2. window.ACS_COMPARE.prod = { proxyPath: "/__compare/production" } → POST to
 *      the local parity server, which holds the key and injects the Origin.
 *   3. No config → disabled; the toggle never appears.
 */
(function () {
  "use strict";

  // ---------------------------------------------------------------- config ---
  const CFG = (typeof window !== "undefined" && window.ACS_COMPARE) || {};
  const PROD = CFG.prod || null;
  const DEBUG = new URLSearchParams(location.search).get("algoliaCompareDebug") === "1";
  const log = (...a) => { if (DEBUG) console.log("[compare]", ...a); };

  function prodEndpoint() {
    if (!PROD) return null;
    if (PROD.appId && PROD.agentId) {
      return {
        url: `https://${PROD.appId}.algolia.net/agent-studio/1/agents/${PROD.agentId}/completions?stream=true&compatibilityMode=ai-sdk-5`,
        headers: {
          "content-type": "application/json",
          "x-algolia-application-id": PROD.appId,
          "x-algolia-api-key": PROD.apiKey || "",
        },
      };
    }
    if (PROD.proxyPath) {
      return { url: PROD.proxyPath, headers: { "content-type": "application/json" } };
    }
    return null;
  }
  const ENDPOINT_OK = !!prodEndpoint();

  // ------------------------------------------------------- widget accessors ---
  function hosts() {
    if (typeof document.querySelectorAll === "function") {
      return [...document.querySelectorAll("algolia-chat")];
    }
    const single = typeof document.querySelector === "function"
      ? document.querySelector("algolia-chat")
      : null;
    return single ? [single] : [];
  }
  function widgetIdForHost(widget) {
    return String(widget?.__algoliaWidgetInstanceId || widget?.getAttribute?.("data-algolia-widget-instance-id") || "").trim();
  }
  function hostForWidgetId(widgetInstanceId, options = {}) {
    const id = String(widgetInstanceId || "").trim();
    const allowUnidentifiedFallback = options.allowUnidentifiedFallback === true;
    const mounted = hosts();
    if (!id) return mounted.length === 1 ? mounted[0] : null;
    const match = mounted.find((widget) => widgetIdForHost(widget) === id) || null;
    if (match) return match;
    if (id === "algolia-chat:default" && mounted.length === 1 && !widgetIdForHost(mounted[0])) return mounted[0];
    return allowUnidentifiedFallback && mounted.length === 1 && !widgetIdForHost(mounted[0]) ? mounted[0] : null;
  }
  function hostForTurn(turn) {
    const widgetInstanceId = turn?.answerIdentity?.widgetInstanceId || turn?.widgetInstanceId || "";
    const hasExplicitWidget = Boolean(turn?.answerIdentity?.widgetInstanceId || turn?.widgetInstanceId);
    return hostForWidgetId(widgetInstanceId, { allowUnidentifiedFallback: !hasExplicitWidget });
  }
  function srootForHost(widget) {
    return widget?.shadowRoot || null;
  }
  function q(widget, sel) {
    return srootForHost(widget)?.querySelector(sel) || null;
  }

  // "Expanded" = the panel fills most of the viewport. The widget has three size
  // modes (docked / normal / maximized) and the expand control goes docked→normal,
  // a large CENTERED card — so a strict "maximized" check would miss it.
  function isExpanded(widget) {
    const p = q(widget, '[part="panel"]');
    if (!p) return false;
    // The widget's normal centered panel is capped at 1080px. Comparing only
    // against a viewport percentage therefore misclassifies it as collapsed on
    // wide monitors (for example 1080px / 2266px). A real comparison workspace
    // is either at least 60% of the viewport or at least 720px wide; the docked
    // panel is smaller than both thresholds.
    const expandedWidth = Math.min(720, window.innerWidth * 0.6);
    return p.getBoundingClientRect().width >= expandedWidth;
  }

  // ------------------------------------------------------------ turn state ---
  let compareOn = false;
  const acceptedAttemptsByWidget = new Map();
  const retiredAttemptsByWidget = new Map();
  const latestAttemptOrdinalByWidget = new Map();
  const resetGenerationFloorByWidget = new Map();
  const resetAttemptOrdinalFloorByWidget = new Map();
  const legacyAcceptedTurnKeysByWidget = new Map();
  const legacyRetiredTurnKeysByWidget = new Map();
  const legacyResetGenerationFloorByWidget = new Map();
  const legacyResetAttemptOrdinalFloorByWidget = new Map();
  const latestLegacyAttemptOrdinalByWidget = new Map();
  const mirroredTurnDiagnostics = new Set();
  const productionTurnResultsByWidget = new Map();
  const preparedTurnHistoryByWidget = new Map();
  let latestPreparedTurn = null;
  const latestPreparedTurnByWidget = new Map();
  let generation = 0;          // bumped on global reset; older generations are discarded
  let latestRuntimeAttemptOrdinal = 0;
  let latestLegacyAttemptOrdinal = 0;
  const generationByWidget = new Map();
  const activeControllers = new Map();
  const completedTurnKeysByWidget = new Map();
  const MAX_WIDGET_STATE = 1000;
  const MAX_TURN_STATE = 500;
  let mirroredTurns = 0;
  let unsubscribePreparedTurns = null;
  let unsubscribeCompletedTurns = null;
  let subscribedHandoffApi = null;
  let subscribedValidateTurnEvent = null;
  const attachedRoots = new WeakSet();
  let attachedResetListener = false;
  let attachedDisconnectListener = false;
  let attachedDocumentObserver = false;
  let attachedResizeListener = false;
  const SPLIT = 0.5;              // even 50/50 of the conversation area
  const STACK_BELOW = 720;        // px of chat width below which we stack
  let panel = null;
  let activePanelHost = null;
  let activeCompareIdentityKey = "";
  let panelWidgetKey = "";

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

  function widgetKeyForIdentity(identity) {
    return String(identity?.widgetInstanceId || "legacy").trim() || "legacy";
  }

  function widgetKeyForDetail(detail) {
    return String(detail?.answerIdentity?.widgetInstanceId || detail?.widgetInstanceId || "legacy").trim() || "legacy";
  }

  function widgetKeyForTurn(turn) {
    return String(turn?.answerIdentity?.widgetInstanceId || turn?.widgetInstanceId || "legacy").trim() || "legacy";
  }

  function segmentKeyForIdentity(identity) {
    if (!identity || typeof identity !== "object") return "";
    const parts = [
      identity.widgetInstanceId,
      identity.conversationId,
      identity.answerSegmentId,
    ].map((value) => String(value || "").trim());
    return parts.every(Boolean) ? parts.join("\n") : "";
  }

  function numericDetailValue(value) {
    const number = Number(value);
    return Number.isSafeInteger(number) && number >= 0 ? number : null;
  }

  function attemptOrdinalForDetail(detail, identity) {
    return numericDetailValue(detail?.networkAttemptOrdinal ?? detail?.attemptOrdinal);
  }

  function legacyAttemptOrdinalForDetail(detail) {
    return numericDetailValue(detail?.networkAttemptOrdinal ?? detail?.attemptOrdinal);
  }

  function generationForDetail(detail) {
    const explicit = numericDetailValue(detail?.conversationGeneration);
    if (explicit !== null) return explicit;
    const turnKey = String(detail?.turnKey || "");
    const match = turnKey.match(/^(\d+):/);
    return match ? numericDetailValue(match[1]) ?? 0 : 0;
  }

  function generationForWidget(widgetKey) {
    return generation + (generationByWidget.get(widgetKey || "legacy") || 0);
  }

  function hasCanonicalMetadata(detail) {
    return numericDetailValue(detail?.conversationGeneration) !== null &&
      numericDetailValue(detail?.networkAttemptOrdinal ?? detail?.attemptOrdinal) !== null;
  }

  function validateCanonicalTurnEvent(detail, identityKey) {
    if (!identityKey || !hasCanonicalMetadata(detail)) return false;
    const generation = numericDetailValue(detail?.conversationGeneration);
    const turnKey = String(detail?.turnKey || "");
    if (generation > 0 && !turnKey.startsWith(`${generation}:`)) return false;
    if (!subscribedValidateTurnEvent) captureHandoffApi();
    const validator = subscribedValidateTurnEvent;
    if (typeof validator !== "function") return false;
    try {
      return validator(detail) === true;
    } catch {
      return false;
    }
  }

  function captureHandoffApi() {
    if (subscribedHandoffApi) return subscribedHandoffApi;
    const api = window.algoliaHandoffToOrchestrator;
    if (!api || typeof api !== "object") return null;
    subscribedHandoffApi = api;
    subscribedValidateTurnEvent = typeof api.validateTurnEvent === "function"
      ? api.validateTurnEvent.bind(api)
      : null;
    return subscribedHandoffApi;
  }

  function trimMap(map, limit = MAX_WIDGET_STATE) {
    while (map.size > limit) map.delete(map.keys().next().value);
  }

  function trimSet(set, limit = MAX_TURN_STATE) {
    while (set.size > limit) set.delete(set.values().next().value);
  }

  function mountedWidgetKeys() {
    return new Set(hosts().map(widgetIdForHost).filter(Boolean));
  }

  function trimOuterWidgetMap(map, limit = MAX_WIDGET_STATE) {
    if (map.size <= limit) return;
    const mounted = mountedWidgetKeys();
    for (const key of [...map.keys()]) {
      if (map.size <= limit) return;
      if (!mounted.has(key)) map.delete(key);
    }
    while (map.size > limit) map.delete(map.keys().next().value);
  }

  function widgetSet(store, widgetKey) {
    const key = widgetKey || "legacy";
    let set = store.get(key);
    if (!set) {
      set = new Set();
      store.set(key, set);
      trimOuterWidgetMap(store);
    }
    return set;
  }

  function widgetMap(store, widgetKey) {
    const key = widgetKey || "legacy";
    let map = store.get(key);
    if (!map) {
      map = new Map();
      store.set(key, map);
      trimOuterWidgetMap(store);
    }
    return map;
  }

  function widgetSetCount(store) {
    let count = 0;
    for (const set of store.values()) count += set.size;
    return count;
  }

  function widgetMapCount(store) {
    let count = 0;
    for (const map of store.values()) count += map.size;
    return count;
  }

  function trimWidgetSet(store, widgetKey, limit = MAX_TURN_STATE) {
    const key = widgetKey || "legacy";
    const set = store.get(key);
    if (!set) return;
    trimSet(set, limit);
    if (!set.size) store.delete(key);
    trimOuterWidgetMap(store);
  }

  function trimWidgetMap(store, widgetKey, limit = MAX_TURN_STATE) {
    const key = widgetKey || "legacy";
    const map = store.get(key);
    if (!map) return;
    trimMap(map, limit);
    if (!map.size) store.delete(key);
    trimOuterWidgetMap(store);
  }

  function legacyWidgetKeyForIdentityKey(identityKey) {
    return String(identityKey || "").split("\n")[0] || "legacy";
  }

  function acceptedAttemptsForWidget(widgetKey) {
    const key = widgetKey || "legacy";
    let map = acceptedAttemptsByWidget.get(key);
    if (!map) {
      map = new Map();
      acceptedAttemptsByWidget.set(key, map);
      trimAcceptedAttemptsOuter();
    }
    return map;
  }

  function acceptedAttemptCount() {
    return widgetMapCount(acceptedAttemptsByWidget);
  }

  function trimAcceptedAttemptsForWidget(widgetKey) {
    const key = widgetKey || "legacy";
    const map = acceptedAttemptsByWidget.get(key);
    if (!map) return;
    while (map.size > MAX_TURN_STATE) {
      const segmentKey = map.keys().next().value;
      const value = map.get(segmentKey);
      rememberRetiredAttempt(key, segmentKey, value);
      map.delete(segmentKey);
    }
    if (!map.size) acceptedAttemptsByWidget.delete(key);
    trimAcceptedAttemptsOuter();
  }

  function retiredAttemptsForWidget(widgetKey) {
    return widgetMap(retiredAttemptsByWidget, widgetKey);
  }

  function retiredAttemptCount() {
    return widgetMapCount(retiredAttemptsByWidget);
  }

  function trimRetiredAttemptsForWidget(widgetKey) {
    trimWidgetMap(retiredAttemptsByWidget, widgetKey);
  }

  function rememberRetiredLegacy(identityKey) {
    if (!identityKey) return;
    const widgetKey = legacyWidgetKeyForIdentityKey(identityKey);
    const retired = widgetSet(legacyRetiredTurnKeysByWidget, widgetKey);
    retired.add(identityKey);
    trimWidgetSet(legacyRetiredTurnKeysByWidget, widgetKey);
  }

  function rememberRetiredAttempt(widgetKey, segmentKey, value) {
    if (!segmentKey || !value?.identityKey) return;
    const attempts = retiredAttemptsForWidget(widgetKey);
    attempts.set(value.identityKey, {
      segmentKey,
      attemptOrdinal: value.attemptOrdinal ?? null,
    });
    trimRetiredAttemptsForWidget(widgetKey);
  }

  function retireAcceptedAttemptMap(widgetKey, attempts) {
    if (!attempts) return;
    for (const [segmentKey, value] of attempts.entries()) {
      rememberRetiredAttempt(widgetKey, segmentKey, value);
    }
  }

  function trimAcceptedAttemptsOuter(limit = MAX_WIDGET_STATE) {
    if (acceptedAttemptsByWidget.size <= limit) return;
    const mounted = mountedWidgetKeys();
    for (const key of [...acceptedAttemptsByWidget.keys()]) {
      if (acceptedAttemptsByWidget.size <= limit) return;
      if (mounted.has(key)) continue;
      retireAcceptedAttemptMap(key, acceptedAttemptsByWidget.get(key));
      acceptedAttemptsByWidget.delete(key);
    }
    while (acceptedAttemptsByWidget.size > limit) {
      const key = acceptedAttemptsByWidget.keys().next().value;
      retireAcceptedAttemptMap(key, acceptedAttemptsByWidget.get(key));
      acceptedAttemptsByWidget.delete(key);
    }
  }

  function retireAcceptedAttemptsForWidget(widgetKey) {
    const attempts = acceptedAttemptsByWidget.get(widgetKey);
    if (!attempts) return;
    retireAcceptedAttemptMap(widgetKey, attempts);
    acceptedAttemptsByWidget.delete(widgetKey);
  }

  function retireAllAcceptedAttempts() {
    for (const widgetKey of [...acceptedAttemptsByWidget.keys()]) {
      retireAcceptedAttemptsForWidget(widgetKey);
    }
  }

  function rememberResetGuards(widgetKey, { generationFloor = true } = {}) {
    const key = widgetKey || "legacy";
    if (!hasWidgetTurnState(key)) return;
    if (generationFloor) {
      resetGenerationFloorByWidget.set(key, generationForWidget(key));
      legacyResetGenerationFloorByWidget.set(key, generationForWidget(key));
    }
    const latestAttemptOrdinal = latestAttemptOrdinalByWidget.get(key);
    if (latestAttemptOrdinal !== undefined) resetAttemptOrdinalFloorByWidget.set(key, latestAttemptOrdinal);
    const latestLegacyAttemptOrdinal = latestLegacyAttemptOrdinalByWidget.get(key);
    if (latestLegacyAttemptOrdinal !== undefined) legacyResetAttemptOrdinalFloorByWidget.set(key, latestLegacyAttemptOrdinal);
    trimMap(resetGenerationFloorByWidget);
    trimMap(legacyResetGenerationFloorByWidget);
    trimMap(resetAttemptOrdinalFloorByWidget);
    trimMap(legacyResetAttemptOrdinalFloorByWidget);
  }

  function hasWidgetTurnState(widgetKey) {
    const key = widgetKey || "legacy";
    if (acceptedAttemptsByWidget.get(key)?.size) return true;
    if (retiredAttemptsByWidget.get(key)?.size) return true;
    if (legacyAcceptedTurnKeysByWidget.get(key)?.size) return true;
    if (legacyRetiredTurnKeysByWidget.get(key)?.size) return true;
    if (latestPreparedTurnByWidget.has(key)) return true;
    if (preparedTurnHistoryByWidget.get(key)?.length) return true;
    if (completedTurnKeysByWidget.get(key)?.size) return true;
    if (productionTurnResultsByWidget.get(key)?.size) return true;
    for (const identityKey of activeControllers.keys()) {
      if (identityKey.startsWith(`${key}\n`)) return true;
    }
    return false;
  }

  function isGenerationStale(detail, store, widgetKey) {
    const floor = store.get(widgetKey || "legacy");
    return floor !== undefined && generationForDetail(detail) < floor;
  }

  function isAttemptOrdinalStale(detail, store, widgetKey, ordinal) {
    const floor = store.get(widgetKey || "legacy");
    return ordinal !== null && floor !== undefined && ordinal <= floor;
  }

  function hasFreshAttemptAfterFloor(store, widgetKey, ordinal) {
    const floor = store.get(widgetKey || "legacy");
    return ordinal !== null && floor !== undefined && ordinal > floor;
  }

  function acceptLegacyTurnIdentity(identityKey, detail = {}) {
    const widgetKey = legacyWidgetKeyForIdentityKey(identityKey);
    const attemptOrdinal = legacyAttemptOrdinalForDetail(detail);
    if (legacyResetGenerationFloorByWidget.has(widgetKey) && attemptOrdinal === null) return false;
    if (
      isGenerationStale(detail, legacyResetGenerationFloorByWidget, widgetKey) &&
      !hasFreshAttemptAfterFloor(legacyResetAttemptOrdinalFloorByWidget, widgetKey, attemptOrdinal)
    ) {
      return false;
    }
    if (isAttemptOrdinalStale(detail, legacyResetAttemptOrdinalFloorByWidget, widgetKey, attemptOrdinal)) return false;
    const retired = legacyRetiredTurnKeysByWidget.get(widgetKey);
    if (retired?.has(identityKey)) return false;
    const accepted = legacyAcceptedTurnsForWidget(widgetKey);
    if (accepted.has(identityKey)) return false;
    const latestOrdinal = latestLegacyAttemptOrdinalByWidget.get(widgetKey);
    if (attemptOrdinal !== null && latestOrdinal !== undefined && attemptOrdinal <= latestOrdinal - MAX_TURN_STATE) {
      return false;
    }
    if (attemptOrdinal !== null && attemptOrdinal <= latestLegacyAttemptOrdinal - MAX_TURN_STATE) {
      return false;
    }
    if (attemptOrdinal !== null && (latestOrdinal === undefined || attemptOrdinal > latestOrdinal)) {
      latestLegacyAttemptOrdinalByWidget.set(widgetKey, attemptOrdinal);
      trimMap(latestLegacyAttemptOrdinalByWidget);
    }
    if (attemptOrdinal !== null && attemptOrdinal > latestLegacyAttemptOrdinal) {
      latestLegacyAttemptOrdinal = attemptOrdinal;
    }
    accepted.add(identityKey);
    while (accepted.size > MAX_TURN_STATE) {
      const oldest = accepted.values().next().value;
      rememberRetiredLegacy(oldest);
      accepted.delete(oldest);
    }
    trimLegacyAcceptedOuter();
    return true;
  }

  function legacyAcceptedTurnsForWidget(widgetKey) {
    const key = widgetKey || "legacy";
    let accepted = legacyAcceptedTurnKeysByWidget.get(key);
    if (!accepted) {
      accepted = new Set();
      legacyAcceptedTurnKeysByWidget.set(key, accepted);
      trimLegacyAcceptedOuter();
    }
    return accepted;
  }

  function retireLegacyAcceptedSet(accepted) {
    if (!accepted) return;
    for (const identityKey of accepted) rememberRetiredLegacy(identityKey);
  }

  function trimLegacyAcceptedOuter(limit = MAX_WIDGET_STATE) {
    if (legacyAcceptedTurnKeysByWidget.size <= limit) return;
    const mounted = mountedWidgetKeys();
    for (const key of [...legacyAcceptedTurnKeysByWidget.keys()]) {
      if (legacyAcceptedTurnKeysByWidget.size <= limit) return;
      if (mounted.has(key)) continue;
      retireLegacyAcceptedSet(legacyAcceptedTurnKeysByWidget.get(key));
      legacyAcceptedTurnKeysByWidget.delete(key);
    }
    while (legacyAcceptedTurnKeysByWidget.size > limit) {
      const key = legacyAcceptedTurnKeysByWidget.keys().next().value;
      retireLegacyAcceptedSet(legacyAcceptedTurnKeysByWidget.get(key));
      legacyAcceptedTurnKeysByWidget.delete(key);
    }
  }

  function retireLegacyTurnsForWidget(widgetKey) {
    const accepted = legacyAcceptedTurnKeysByWidget.get(widgetKey);
    if (!accepted) return;
    for (const identityKey of accepted) {
      rememberRetiredLegacy(identityKey);
    }
    legacyAcceptedTurnKeysByWidget.delete(widgetKey);
  }

  function retireAllLegacyTurns() {
    for (const widgetKey of [...legacyAcceptedTurnKeysByWidget.keys()]) {
      retireLegacyTurnsForWidget(widgetKey);
    }
  }

  function completedTurnsForWidget(widgetKey) {
    return widgetSet(completedTurnKeysByWidget, widgetKey);
  }

  function completedTurnCount() {
    return widgetSetCount(completedTurnKeysByWidget);
  }

  function rememberCompletedTurn(identityKey) {
    const widgetKey = legacyWidgetKeyForIdentityKey(identityKey);
    const completed = completedTurnsForWidget(widgetKey);
    completed.add(identityKey);
    trimWidgetSet(completedTurnKeysByWidget, widgetKey);
  }

  function isTurnComplete(turn) {
    return Boolean(turn?.identityKey && completedTurnKeysByWidget.get(widgetKeyForTurn(turn))?.has(turn.identityKey));
  }

  function resultsForWidget(widgetKey) {
    return widgetMap(productionTurnResultsByWidget, widgetKey);
  }

  function resultForTurn(turn) {
    return turn?.identityKey ? productionTurnResultsByWidget.get(widgetKeyForTurn(turn))?.get(turn.identityKey) || null : null;
  }

  function rememberProductionTurnResult(turn, state) {
    if (!turn?.identityKey) return;
    const results = resultsForWidget(widgetKeyForTurn(turn));
    results.set(turn.identityKey, state);
    trimWidgetMap(productionTurnResultsByWidget, widgetKeyForTurn(turn));
  }

  function productionTurnResultCount() {
    return widgetMapCount(productionTurnResultsByWidget);
  }

  function knownWidgetKeys() {
    const keys = new Set(["legacy"]);
    for (const key of mountedWidgetKeys()) keys.add(key);
    for (const store of [
      acceptedAttemptsByWidget,
      retiredAttemptsByWidget,
      latestAttemptOrdinalByWidget,
      resetGenerationFloorByWidget,
      resetAttemptOrdinalFloorByWidget,
      legacyAcceptedTurnKeysByWidget,
      legacyRetiredTurnKeysByWidget,
      legacyResetGenerationFloorByWidget,
      legacyResetAttemptOrdinalFloorByWidget,
      latestLegacyAttemptOrdinalByWidget,
      latestPreparedTurnByWidget,
      preparedTurnHistoryByWidget,
      productionTurnResultsByWidget,
      completedTurnKeysByWidget,
    ]) {
      for (const key of store.keys()) keys.add(key);
    }
    return keys;
  }

  function deleteWidgetRuntimeState(widgetKey, { retireAttempts = true, retireLegacy = true } = {}) {
    if (retireAttempts) retireAcceptedAttemptsForWidget(widgetKey);
    else acceptedAttemptsByWidget.delete(widgetKey);
    if (retireLegacy) retireLegacyTurnsForWidget(widgetKey);
    else legacyAcceptedTurnKeysByWidget.delete(widgetKey);
    latestPreparedTurnByWidget.delete(widgetKey);
    preparedTurnHistoryByWidget.delete(widgetKey);
    completedTurnKeysByWidget.delete(widgetKey);
    productionTurnResultsByWidget.delete(widgetKey);
    for (const key of [...mirroredTurnDiagnostics]) {
      if (key.startsWith(`${widgetKey}\n`)) mirroredTurnDiagnostics.delete(key);
    }
  }

  function turnIdentityKey(detail) {
    const identityKey = answerIdentityKey(detail?.answerIdentity);
    if (Object.prototype.hasOwnProperty.call(detail || {}, "answerIdentity") && !identityKey) return "";
    if (identityKey) {
      return hostForWidgetId(detail.answerIdentity.widgetInstanceId) ? identityKey : "";
    }
    const hasTopLevelWidget = typeof detail?.widgetInstanceId === "string" && detail.widgetInstanceId.trim();
    const widgetInstanceId = String(detail?.widgetInstanceId || "").trim();
    if (hasTopLevelWidget && !hostForWidgetId(widgetInstanceId)) return "";
    const turnKey = String(detail?.turnKey || "").trim();
    if (turnKey && latestPreparedTurn?.turnKey === turnKey) {
      if (!detail?.answerIdentity && !detail?.widgetInstanceId && hosts().length === 1) return latestPreparedTurn.identityKey;
      if (widgetKeyForTurn(latestPreparedTurn) === widgetInstanceId) return latestPreparedTurn.identityKey;
    }
    if (!hasTopLevelWidget && hosts().length !== 1) return "";
    return turnKey ? `${widgetInstanceId || "legacy"}\n${turnKey}` : "";
  }

  function resolveIdentityForAcceptedTurn(identityKey, detail) {
    if (answerIdentityKey(detail?.answerIdentity) === identityKey) return detail.answerIdentity;
    if (latestPreparedTurn?.identityKey === identityKey && answerIdentityKey(latestPreparedTurn.answerIdentity) === identityKey) {
      return latestPreparedTurn.answerIdentity;
    }
    for (const turn of latestPreparedTurnByWidget.values()) {
      if (turn?.identityKey === identityKey && answerIdentityKey(turn.answerIdentity) === identityKey) {
        return turn.answerIdentity;
      }
    }
    return null;
  }

  function acceptTurnIdentity(identityKey, detail) {
    const identity = resolveIdentityForAcceptedTurn(identityKey, detail);
    if (!identity) {
      return acceptLegacyTurnIdentity(identityKey, detail);
    }
    if (!validateCanonicalTurnEvent(detail, identityKey)) return false;
    const segmentKey = segmentKeyForIdentity(identity);
    if (!segmentKey) return false;
    const widgetKey = widgetKeyForIdentity(identity);
    const attemptOrdinal = attemptOrdinalForDetail(detail, identity);
    if (
      isGenerationStale(detail, resetGenerationFloorByWidget, widgetKey) &&
      !hasFreshAttemptAfterFloor(resetAttemptOrdinalFloorByWidget, widgetKey, attemptOrdinal)
    ) {
      return false;
    }
    if (isAttemptOrdinalStale(detail, resetAttemptOrdinalFloorByWidget, widgetKey, attemptOrdinal)) return false;
    if (retiredAttemptsByWidget.get(widgetKey)?.has(identityKey)) return false;
    const latestOrdinal = latestAttemptOrdinalByWidget.get(widgetKey);
    if (attemptOrdinal !== null && latestOrdinal !== undefined && attemptOrdinal <= latestOrdinal - MAX_TURN_STATE) {
      return false;
    }
    if (attemptOrdinal !== null && attemptOrdinal <= latestRuntimeAttemptOrdinal - MAX_TURN_STATE) {
      return false;
    }
    const attempts = acceptedAttemptsForWidget(widgetKey);
    const previous = attempts.get(segmentKey);
    if (previous) {
      if (attemptOrdinal !== null && previous.attemptOrdinal !== null) {
        if (attemptOrdinal <= previous.attemptOrdinal) return false;
      } else if (previous.identityKey === identityKey) {
        return false;
      }
      rememberRetiredAttempt(widgetKey, segmentKey, previous);
    }
    if (attemptOrdinal !== null && (latestOrdinal === undefined || attemptOrdinal > latestOrdinal)) {
      latestAttemptOrdinalByWidget.set(widgetKey, attemptOrdinal);
      trimMap(latestAttemptOrdinalByWidget);
    }
    if (attemptOrdinal !== null && attemptOrdinal > latestRuntimeAttemptOrdinal) {
      latestRuntimeAttemptOrdinal = attemptOrdinal;
    }
    attempts.set(segmentKey, {
      identityKey,
      attemptOrdinal,
      conversationGeneration: generationForDetail(detail),
      turnKey: String(detail?.turnKey || ""),
      messageId: String(detail?.messageId || ""),
    });
    trimAcceptedAttemptsForWidget(widgetKey);
    return true;
  }

  function acceptedPreparedRecordForTurn(turn) {
    if (!turn?.answerIdentity || !turn?.identityKey) return null;
    const segmentKey = segmentKeyForIdentity(turn.answerIdentity);
    if (!segmentKey) return null;
    const record = acceptedAttemptsByWidget.get(widgetKeyForTurn(turn))?.get(segmentKey) || null;
    return record?.identityKey === turn.identityKey ? record : null;
  }

  function findPreparedTurn(identityKey) {
    if (latestPreparedTurn?.identityKey === identityKey) return latestPreparedTurn;
    for (const turn of latestPreparedTurnByWidget.values()) {
      if (turn?.identityKey === identityKey) return turn;
    }
    for (const history of preparedTurnHistoryByWidget.values()) {
      const found = history.find((turn) => turn?.identityKey === identityKey);
      if (found) return found;
    }
    return null;
  }

  function completedMatchesPreparedRecord(detail, identityKey) {
    const turn = findPreparedTurn(identityKey);
    if (!turn) return false;
    const detailGeneration = numericDetailValue(detail?.conversationGeneration);
    const detailOrdinal = numericDetailValue(detail?.networkAttemptOrdinal ?? detail?.attemptOrdinal);
    if (turn.answerIdentity) {
      const record = acceptedPreparedRecordForTurn(turn);
      if (!record) return false;
      if (!validateCanonicalTurnEvent(detail, identityKey)) return false;
      if (detailGeneration !== record.conversationGeneration) return false;
      if (detailOrdinal !== record.attemptOrdinal) return false;
    } else {
      const accepted = legacyAcceptedTurnKeysByWidget.get(widgetKeyForTurn(turn));
      if (!accepted?.has(identityKey)) return false;
      if (legacyResetGenerationFloorByWidget.has(widgetKeyForTurn(turn)) && detailOrdinal === null) return false;
      if (detailOrdinal !== null && turn.networkAttemptOrdinal !== null && detailOrdinal !== turn.networkAttemptOrdinal) return false;
      if (detailGeneration !== null && turn.conversationGeneration !== null && detailGeneration !== turn.conversationGeneration) return false;
    }
    if (String(detail?.turnKey || "") !== turn.turnKey) return false;
    if (String(detail?.messageId || "") !== turn.messageId) return false;
    return true;
  }

  function rememberPreparedTurn(turn) {
    const widgetKey = widgetKeyForTurn(turn);
    const history = preparedTurnHistoryByWidget.get(widgetKey) || [];
    const existingIndex = history.findIndex((item) => item.identityKey === turn.identityKey);
    if (existingIndex >= 0) history[existingIndex] = turn;
    else history.push(turn);
    while (history.length > MAX_TURN_STATE) history.shift();
    preparedTurnHistoryByWidget.set(widgetKey, history);
    trimMap(preparedTurnHistoryByWidget);
  }

  function renderCachedWidgetResults(widgetKey) {
    const history = preparedTurnHistoryByWidget.get(widgetKey) || [];
    const cachedTurns = history
      .map((turn) => ({ turn, cached: resultForTurn(turn) }))
      .filter((entry) => entry.cached);
    if (!cachedTurns.length) return false;
    clearLog();
    for (const { turn, cached } of cachedTurns) {
      const row = appendTurn(cached.question || turn.question || "Question");
      renderTurn(row, cached);
    }
    return true;
  }

  function clearWidgetInset(widget) {
    setContentInset(false, false, 0, widget);
  }

  function retireActiveCompare(reason, { abort = true, clear = false } = {}) {
    const previousHost = activePanelHost;
    const previousIdentityKey = activeCompareIdentityKey;
    if (abort && previousIdentityKey) {
      const controller = activeControllers.get(previousIdentityKey);
      if (controller) {
        try { controller.abort(); } catch { /* already settled */ }
        activeControllers.delete(previousIdentityKey);
      }
    }
    if (previousHost) clearWidgetInset(previousHost);
    compareOn = false;
    activeCompareIdentityKey = "";
    activePanelHost = null;
    if (panel) {
      panel.style.display = "none";
      if (clear) clearLog();
    }
    log("compare retired:", reason);
  }

  function isActiveTurn(turn) {
    return !!turn?.identityKey && compareOn && turn.identityKey === activeCompareIdentityKey;
  }

  function isActiveProductionTurn(turn) {
    return isActiveTurn(turn) && hostForTurn(turn) === activePanelHost;
  }

  function resetConversation(reason, widgetInstanceId = "") {
    const scopedWidgetKey = String(widgetInstanceId || "").trim();
    if (scopedWidgetKey) {
      const scopedHost = hostForWidgetId(scopedWidgetKey);
      if (activePanelHost && widgetIdForHost(activePanelHost) === scopedWidgetKey) {
        retireActiveCompare(reason, { abort: true, clear: true });
      }
      generationByWidget.set(scopedWidgetKey, (generationByWidget.get(scopedWidgetKey) || 0) + 1);
      trimMap(generationByWidget);
      rememberResetGuards(scopedWidgetKey);
      for (const [identityKey, controller] of activeControllers.entries()) {
        if (!identityKey.startsWith(`${scopedWidgetKey}\n`)) continue;
        try { controller.abort(); } catch { /* already settled */ }
        activeControllers.delete(identityKey);
      }
      latestPreparedTurnByWidget.delete(scopedWidgetKey);
      preparedTurnHistoryByWidget.delete(scopedWidgetKey);
      if (widgetKeyForTurn(latestPreparedTurn) === scopedWidgetKey) {
        latestPreparedTurn = [...latestPreparedTurnByWidget.values()].at(-1) || null;
      }
      q(scopedHost, `#${TOGGLE_ID}`)?.remove();
      deleteWidgetRuntimeState(scopedWidgetKey, { retireAttempts: true, retireLegacy: true });
      reconcile();
      log("scoped reset:", reason, scopedWidgetKey, "gen", generationForWidget(scopedWidgetKey));
      return;
    }
    const resetWidgetKeys = knownWidgetKeys();
    generation += 1;
    generationByWidget.clear();
    for (const widgetKey of resetWidgetKeys) rememberResetGuards(widgetKey);
    retireActiveCompare(reason, { abort: true, clear: true });
    for (const controller of activeControllers.values()) {
      try { controller.abort(); } catch { /* already settled */ }
    }
    activeControllers.clear();
    mirroredTurns = 0;
    compareOn = false;
    latestPreparedTurn = null;
    latestPreparedTurnByWidget.clear();
    retireAllAcceptedAttempts();
    retireAllLegacyTurns();
    mirroredTurnDiagnostics.clear();
    productionTurnResultsByWidget.clear();
    preparedTurnHistoryByWidget.clear();
    completedTurnKeysByWidget.clear();
    clearLog();
    // A reset removes the answer-scoped control immediately; a later completed
    // answer will cause reconcile() to create the next one.
    reconcile();
    log("reset:", reason, "gen", generation);
  }

  // --------------------------------------------------------- SSE + sources ---
  const BASE = "https://www.algolia.com";

  // Only http/https survive. Returns an absolute href string or null.
  function safeHref(raw) {
    if (typeof raw !== "string" || !raw) return null;
    let u;
    try { u = new URL(raw, BASE); } catch { return null; }
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.href;
  }

  function harvestSources(obj, into) {
    const visit = (v) => {
      if (!v || typeof v !== "object") return;
      if (Array.isArray(v)) return v.forEach(visit);
      const href = safeHref(v.url);
      if (href) {
        const key = href.split("#")[0];
        if (!into.some((s) => s.url === key)) {
          into.push({ url: key, title: typeof v.title === "string" ? v.title : key });
        }
      }
      Object.values(v).forEach(visit);
    };
    visit(obj);
  }

  function preparedFetch(input, init) {
    const sender = window.algoliaContextCompiler?.fetchPrepared;
    return typeof sender === "function" ? sender(input, init) : fetch(input, init);
  }

  async function askProd(body, signal, onUpdate) {
    const ep = prodEndpoint();
    if (!ep) throw new Error("Compare is not configured.");
    const res = await preparedFetch(ep.url, {
      method: "POST", headers: ep.headers, signal,
      body,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Production returned HTTP ${res.status}${detail ? `: ${detail.slice(0, 120)}` : ""}`);
    }
    if (!res.body) throw new Error("Production returned no stream.");
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "", out = "";
    const sources = [];
    const consumeLine = (rawLine) => {
      const line = rawLine.trim();
      if (!line.startsWith("data:")) return;
      let o;
      try { o = JSON.parse(line.slice(5).trim()); } catch { return; }
      if (o.type === "text-delta") out += (o.delta ?? o.text ?? "");
      else if (o.type === "tool-output-available" || o.type === "data-tool-output-metadata") harvestSources(o, sources);
      onUpdate(out, sources);
    };
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        consumeLine(line);
      }
    }
    buf += dec.decode();
    if (buf.trim()) consumeLine(buf);
    return { text: out, sources };
  }

  // ------------------------------------------------------- prepared turns ---
  function acceptPreparedTurn(detail) {
    const turnKey = String(detail?.turnKey || "");
    const identityKey = turnIdentityKey(detail);
    const body = typeof detail?.body === "string" ? detail.body : "";
    if (!turnKey || !identityKey || !body || !acceptTurnIdentity(identityKey, detail)) return false;
    latestPreparedTurn = {
      identityKey,
      body,
      turnKey,
      conversationGeneration: generationForDetail(detail),
      networkAttemptOrdinal: legacyAttemptOrdinalForDetail(detail),
      messageId: String(detail?.messageId || ""),
      question: String(detail?.question || ""),
      answerIdentity: detail?.answerIdentity || null,
      widgetInstanceId: detail?.answerIdentity?.widgetInstanceId || detail?.widgetInstanceId || "",
    };
    latestPreparedTurnByWidget.set(widgetKeyForDetail(detail), latestPreparedTurn);
    trimMap(latestPreparedTurnByWidget);
    rememberPreparedTurn(latestPreparedTurn);
    const widget = hostForTurn(latestPreparedTurn);
    const toggle = q(widget, `#${TOGGLE_ID}`);
    if (toggle) paintToggle(toggle, latestPreparedTurn);
    if (!compareOn || !ENDPOINT_OK) return true;
    if (activePanelHost && widget !== activePanelHost) return true;
    if (!activePanelHost && widget) activePanelHost = widget;
    panelWidgetKey = widgetKeyForDetail(detail);
    if (activeCompareIdentityKey && activeCompareIdentityKey !== identityKey) {
      const controller = activeControllers.get(activeCompareIdentityKey);
      if (controller) {
        try { controller.abort(); } catch { /* already settled */ }
        activeControllers.delete(activeCompareIdentityKey);
      }
    }
    activeCompareIdentityKey = identityKey;
    const gen = generationForWidget(widgetKeyForDetail(detail));
    mirrorPreparedTurn(latestPreparedTurn, gen)
      .catch((error) => log("production turn failed (contained)", error));
    return true;
  }

  function acceptCompletedTurn(detail) {
    const turnKey = String(detail?.turnKey || "");
    const identityKey = turnIdentityKey(detail);
    if (!turnKey || !identityKey || !completedMatchesPreparedRecord(detail, identityKey)) return false;
    rememberCompletedTurn(identityKey);
    reconcile();
    return true;
  }

  function mirrorPreparedTurn(detail, gen) {
    if (!detail) return Promise.resolve();
    const widgetKey = widgetKeyForTurn(detail);
    const cached = resultForTurn(detail);
    if (cached) {
      renderCachedWidgetResults(widgetKey);
      return Promise.resolve();
    }
    if (activeControllers.has(detail.identityKey)) return Promise.resolve();
    renderCachedWidgetResults(widgetKey);
    mirroredTurnDiagnostics.add(detail.identityKey);
    trimSet(mirroredTurnDiagnostics);
    return runPreparedTurn(detail, gen);
  }

  async function runPreparedTurn(detail, gen) {
    const widgetKey = widgetKeyForTurn(detail);
    if (gen !== generationForWidget(widgetKey)) return;
    if (!isActiveProductionTurn(detail)) return;
    const turn = appendTurn(detail.question || "Question");
    renderTurn(turn, { status: "thinking" });
    const controller = new AbortController();
    activeControllers.set(detail.identityKey, controller);
    try {
      const r = await askProd(detail.body, controller.signal, (t, s) => {
        if (gen !== generationForWidget(widgetKey)) return;
        if (!isActiveProductionTurn(detail)) return;
        renderTurn(turn, { status: "streaming", text: t, sources: s });
      });
      if (gen !== generationForWidget(widgetKey)) return;
      if (!isActiveProductionTurn(detail)) return;
      mirroredTurns += 1;
      const doneState = { status: "done", text: r.text, sources: r.sources, question: detail.question || "Question" };
      rememberProductionTurnResult(detail, doneState);
      renderTurn(turn, doneState);
    } catch (e) {
      if (gen !== generationForWidget(widgetKey) || e?.name === "AbortError") return;
      // Contained: production failed, the concierge column is unaffected.
      const errorState = {
        status: "error",
        text: e?.message || "Production request failed.",
        question: detail.question || "Question",
      };
      rememberProductionTurnResult(detail, errorState);
      renderTurn(turn, errorState);
    } finally {
      if (activeControllers.get(detail.identityKey) === controller) activeControllers.delete(detail.identityKey);
    }
  }

  function subscribeToPreparedTurns(attempt = 0) {
    if (unsubscribePreparedTurns) return true;
    const api = captureHandoffApi();
    const subscribe = api?.subscribePreparedTurn;
    if (typeof subscribe === "function") {
      unsubscribePreparedTurns = subscribe.call(api, acceptPreparedTurn);
      return true;
    }
    if (attempt < 100) setTimeout(() => subscribeToPreparedTurns(attempt + 1), 50);
    return false;
  }

  function subscribeToCompletedTurns(attempt = 0) {
    if (unsubscribeCompletedTurns) return true;
    const api = captureHandoffApi();
    const subscribe = api?.subscribeCompletedTurn;
    if (typeof subscribe === "function") {
      unsubscribeCompletedTurns = subscribe.call(api, acceptCompletedTurn);
      return true;
    }
    if (attempt < 100) setTimeout(() => subscribeToCompletedTurns(attempt + 1), 50);
    return false;
  }

  // -------------------------------------------------------- answer toggle ---
  const TOGGLE_ID = "acs-compare-toggle";
  const TOGGLE_CSS = `
#${TOGGLE_ID}{
  all: unset;
  box-sizing: border-box;
  display: inline-flex !important;
  align-items: center; gap: 6px;
  width: auto !important; height: auto !important;
  min-width: 0 !important; min-height: 0 !important;
  flex: 0 0 auto !important;
  white-space: nowrap;
  font: 600 12px/1 system-ui, -apple-system, sans-serif;
  padding: 7px 13px !important;
  border-radius: 999px;
  border: 1px solid var(--algolia-border, #e1e4ec) !important;
  cursor: pointer;
  transition: background .15s ease, color .15s ease, border-color .15s ease;
}
#${TOGGLE_ID}:focus-visible{
  outline: 2px solid var(--algolia-accent, #003DFF) !important;
  outline-offset: 2px !important;
}
#${TOGGLE_ID}[aria-pressed="false"]{ background: transparent !important; color: var(--algolia-text, #021046) !important; }
#${TOGGLE_ID}[aria-pressed="false"]:hover:not([aria-disabled="true"]){ background: var(--algolia-surface-2, #eef1f7) !important; }
#${TOGGLE_ID}[aria-pressed="true"]{ background: var(--algolia-accent, #003DFF) !important; color: #fff !important; border-color: transparent !important; }
#${TOGGLE_ID}[aria-disabled="true"]{ opacity: .55; cursor: default; }
@media (prefers-reduced-motion: reduce){ #${TOGGLE_ID}{ transition: none; } }`;

  function ensureToggleStyle(root) {
    if (!root || root.querySelector("#acs-compare-toggle-style")) return;
    const st = document.createElement("style");
    st.id = "acs-compare-toggle-style";
    st.textContent = TOGGLE_CSS;
    root.appendChild(st);
  }

  function paintToggle(t, turn = latestPreparedTurn) {
    const active = turnHostIsActive(turn);
    t.textContent = "Compare with Prod";
    t.setAttribute("aria-pressed", active ? "true" : "false");
    t.removeAttribute("aria-disabled");
    t.setAttribute(
      "aria-label",
      active
        ? "Stop comparing answer with production"
        : "Compare answer with production"
    );
    t.title = turn && !active
      ? "Send the latest answer's exact finalized request to live algolia.com Ask AI"
      : "Send the same finalized request, including current session and page context, to the live algolia.com Ask AI";
  }

  function notifyAnswerHarnessCompareAction(turn = latestPreparedTurn) {
    const identity = turn?.answerIdentity;
    const accept = window.algoliaAnswerHarness?.accept;
    const createOpaqueActionContribution = window.algoliaAnswerContributors?.createOpaqueActionContribution;
    if (!identity || typeof accept !== "function" || typeof createOpaqueActionContribution !== "function") return;
    const action = {
      label: "Compare with Prod",
      pressed: turnHostIsActive(turn),
      available: true,
    };
    const current = window.algoliaAnswerHarness?.getRecord?.(identity)?.slots?.actions;
    if (
      current?.status === "ready" &&
      current.value?.label === action.label &&
      current.value?.pressed === action.pressed &&
      current.value?.available === action.available
    ) {
      return;
    }
    try {
      accept(Object.freeze({
        eventName: "contribution",
        detail: Object.freeze({
          answerIdentity: identity,
          contribution: createOpaqueActionContribution({
            identity,
            action,
          }),
        }),
      }));
    } catch {
      // Mirror mode must never affect the live widget.
    }
  }

  function footerIsPostAnswerReady(footer) {
    if (!footer) return false;
    if (footer.querySelector(".algolia-usage-pill")) return true;
    if (footer.querySelector("algolia-confidence-badge")) return true;
    return false;
  }

  function turnHostIsActive(turn) {
    return isActiveProductionTurn(turn);
  }

  function ensureToggleForTurn(turn) {
    if (!ENDPOINT_OK) return;                             // unconfigured → no UI
    const widget = hostForTurn(turn);
    const root = srootForHost(widget);
    if (!root) return;
    let toggle = root.querySelector(`#${TOGGLE_ID}`) || null;
    const turnComplete = isTurnComplete(turn);
    const candidateFooter = turnComplete
      ? window.algoliaHandoffToOrchestrator?.ensureAnswerFooter?.(turn) || null
      : null;
    const migratedFooter = window.algoliaAnswerFooterRenderer;
    if (turnComplete && migratedFooter?.isEnabled?.()) {
      notifyAnswerHarnessCompareAction(turn);
    }
    const answerFooter = migratedFooter?.isEnabled?.()
      ? candidateFooter
      : footerIsPostAnswerReady(candidateFooter) ? candidateFooter : null;
    if (answerFooter && migratedFooter?.isEnabled?.()) {
      ensureToggleStyle(root);
      if (migratedFooter.registerPlacement?.(turn)) {
        const current = root.querySelector(`#${TOGGLE_ID}`);
        if (current) {
          paintToggle(current, turn);
          log("toggle mounted by answer renderer");
        }
        return;
      }
    }
    if (answerFooter && !toggle) {
      ensureToggleStyle(root);
      toggle = document.createElement("button");
      toggle.id = TOGGLE_ID;
      toggle.type = "button";
      paintToggle(toggle, turn);
      answerFooter.appendChild(toggle);
      notifyAnswerHarnessCompareAction(turn);
      log("toggle mounted");
    } else if (!answerFooter && toggle) {
      toggle.remove();
    } else if (toggle) {
      if (toggle.parentElement !== answerFooter) {
        answerFooter.appendChild(toggle);
      }
      paintToggle(toggle, turn);
      notifyAnswerHarnessCompareAction(turn);
    }
  }

  function ensureToggle() {
    if (latestPreparedTurnByWidget.size) {
      for (const turn of latestPreparedTurnByWidget.values()) ensureToggleForTurn(turn);
      return;
    }
    ensureToggleForTurn(latestPreparedTurn);
  }

  // ------------------------------------------------------------- reconcile ---
  // Coalesce WITHOUT cancelling: the widget mutates continuously, and a
  // cancel-then-reschedule loop starves the callback so it never runs.
  let pending = false;
  function reconcile() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      try {
        const panelHost = activePanelHost || hostForTurn(latestPreparedTurn);
        const expanded = isExpanded(panelHost);
        ensureToggle();
        updatePanelVisibility(compareOn && expanded, panelHost);
      } catch (e) {
        log("reconcile error (contained)", e);            // never break the widget
      }
    });
  }

  function attach() {
    let foundRoot = false;
    for (const widget of hosts()) {
      const root = srootForHost(widget);
      if (!root) continue;
      foundRoot = true;
      if (attachedRoots.has(root)) continue;
      attachedRoots.add(root);

      // Delegated: React re-renders the header and clones our button, which drops
      // per-node listeners and leaves a dead toggle behind.
      root.addEventListener("click", (e) => {
        const path = e.composedPath ? e.composedPath() : [];
        if (!path.some((n) => n && n.id === TOGGLE_ID)) return;
        const widgetKey = widgetKeyForIdentity({ widgetInstanceId: widgetIdForHost(widget) });
        const turn = latestPreparedTurnByWidget.get(widgetKey) || latestPreparedTurn;
        const wasActive = turnHostIsActive(turn);
        if (wasActive) {
          retireActiveCompare("toggle-off", { abort: true, clear: false });
          reconcile();
          return;
        }
        if (activePanelHost && activePanelHost !== widget) {
          retireActiveCompare("switch-widget", { abort: true, clear: true });
        } else {
          clearWidgetInset(widget);
        }
        compareOn = true;
        activePanelHost = widget;
        activeCompareIdentityKey = turn?.identityKey || "";
        if (panelWidgetKey && panelWidgetKey !== widgetKey && panel) clearLog();
        panelWidgetKey = widgetKey;
        if (turn) {
          mirrorPreparedTurn(turn, generationForWidget(widgetKey))
            .catch((error) => log("production replay failed (contained)", error));
        }
        reconcile();
      });

      new MutationObserver(reconcile).observe(root, {
        childList: true, subtree: true, attributes: true,
        attributeFilter: ["style", "class", "part"],
      });
    }
    if (!attachedResizeListener) {
      attachedResizeListener = true;
      window.addEventListener("resize", reconcile);
    }
    const documentRoot = document.documentElement || document.body || null;
    if (!attachedDocumentObserver && documentRoot) {
      attachedDocumentObserver = true;
      new MutationObserver(() => {
        attach();
        reconcile();
      }).observe(documentRoot, { childList: true, subtree: true });
    }

    // Primary reset signal, dispatched by algolia-engagement-tracker.js.
    if (!attachedResetListener) {
      attachedResetListener = true;
      document.addEventListener("algolia-visitor-state-reset", (event) =>
        resetConversation("event", event?.detail?.widgetInstanceId || "")
      );
    }
    if (!attachedDisconnectListener) {
      attachedDisconnectListener = true;
      document.addEventListener("algolia-chat-widget-disconnected", (event) =>
        resetConversation("disconnected", event?.detail?.widgetInstanceId || "")
      );
    }

    reconcile();
    log("attached");
    return foundRoot;
  }

  subscribeToPreparedTurns();
  subscribeToCompletedTurns();

  (function waitForWidget(tries = 0) {
    if (!ENDPOINT_OK) return log("no production config; compare disabled");
    if (attach()) return;
    if (tries > 100) return log("gave up waiting for <algolia-chat>");
    setTimeout(() => waitForWidget(tries + 1), 100);
  })();

  // ------------------------------------------------------- production panel ---
  function mount() {
    if (panel) return panel;
    panel = document.createElement("div");
    panel.id = "acs-compare-panel";
    panel.setAttribute("role", "region");
    panel.setAttribute("aria-label", "Production Ask AI answer");
    Object.assign(panel.style, {
      position: "absolute", background: "#fff", boxShadow: "none",
      padding: "20px 24px", overflow: "auto", zIndex: "5",
      font: "15px/1.55 system-ui, sans-serif", color: "#021046",
      display: "none", boxSizing: "border-box",
    });
    const empty = document.createElement("div");
    empty.id = "acs-compare-empty";
    empty.style.cssText = [
      "min-height:180px",
      "display:flex",
      "flex-direction:column",
      "align-items:center",
      "justify-content:flex-start",
      "text-align:center",
      "padding:8px 24px 0",
      "box-sizing:border-box",
    ].join(";");

    const head = document.createElement("div");
    head.style.cssText = "display:flex;align-items:center;justify-content:center;gap:7px;margin-bottom:12px";
    const dot = document.createElement("span");
    dot.style.cssText = "width:7px;height:7px;border-radius:50%;background:#8a4fff;display:inline-block";
    const title = document.createElement("span");
    title.style.cssText = "font:700 12px/1 system-ui,-apple-system,sans-serif;letter-spacing:.12em;text-transform:uppercase;color:#8a4fff";
    title.textContent = "Production · live Ask AI";
    head.append(dot, title);

    const prompt = document.createElement("div");
    prompt.style.cssText = "font:800 36px/1.05 system-ui,-apple-system,sans-serif;letter-spacing:0;color:#23263b;margin:0 0 14px";
    prompt.textContent = "Ask about";

    const sub = document.createElement("div");
    sub.style.cssText = "max-width:360px;font:600 13px/1.45 system-ui,-apple-system,sans-serif;color:#8b93b8";
    sub.textContent = "The same request and current context go to live algolia.com.";

    const logEl = document.createElement("div");
    logEl.id = "acs-compare-log";
    empty.append(head, prompt, sub);
    panel.append(logEl, empty);
    return panel;
  }

  // Parent to the widget's own chat-content so the column lives INSIDE the
  // rounded container. chat-content is position:relative, so absolute offsets
  // anchor here. Re-parent if the host node is swapped.
  function ensureMounted() {
    const p = mount();
    const widget = activePanelHost || hostForTurn(latestPreparedTurn) || hosts()[0] || null;
    const cc = q(widget, '[part="chat-content"]');
    if (cc && p.parentElement !== cc) cc.appendChild(p);
    return !!cc;
  }

  function positionPanel() {
    if (!ensureMounted()) return;
    const p = mount();
    const widget = activePanelHost || hostForTurn(latestPreparedTurn) || hosts()[0] || null;
    const cc = q(widget, '[part="chat-content"]');
    const header = q(widget, '[part="header"]');
    const composer = q(widget, '[part="composer"]');
    const ccr = cc.getBoundingClientRect();
    const top = header ? Math.round(header.getBoundingClientRect().bottom - ccr.top) : 60;
    const bottomInset = composer
      ? Math.max(0, Math.round(ccr.bottom - composer.getBoundingClientRect().top))
      : 80;
    const stacked = ccr.width < STACK_BELOW;
    if (stacked) {
      // Narrow: production takes the lower half, full width.
      const usable = Math.max(0, ccr.height - top - bottomInset);
      const panelHeight = Math.round(usable * SPLIT);
      Object.assign(p.style, {
        left: "0px", right: "0px", width: "auto",
        top: Math.round(top + usable - panelHeight) + "px",
        bottom: bottomInset + "px", height: "auto",
        borderLeft: "none", borderTop: "1px solid #e6e8ef",
      });
      setContentInset(true, true, panelHeight);
    } else {
      Object.assign(p.style, {
        left: "auto", right: "0px", width: Math.round(SPLIT * 100) + "%",
        top: top + "px", bottom: bottomInset + "px", height: "auto",
        borderLeft: "1px solid #e6e8ef", borderTop: "none",
      });
      setContentInset(true, false, 0);
    }
  }

  // Inset ONLY the messages scroller. Padding [part="chat-content"] would shrink
  // the header and the composer too, since it is the column that contains them.
  function setContentInset(active, stacked, stackedInset = 0, widget = activePanelHost || hostForTurn(latestPreparedTurn) || hosts()[0] || null) {
    const root = srootForHost(widget);
    if (!root) return;
    let style = root.querySelector("#acs-compare-style");
    if (!active) { style?.remove(); return; }
    if (!style) {
      style = document.createElement("style");
      style.id = "acs-compare-style";
      root.appendChild(style);
    }
    const pct = Math.round(SPLIT * 100);
    style.textContent = stacked
      ? `[part="chat-content"] .overflow-y-auto{ padding-bottom: ${stackedInset + 20}px !important; }`
      : `[part="chat-content"] .overflow-y-auto{ padding-right: calc(${pct}% + 20px) !important; }
         [data-algolia-answer-footer]{ flex-wrap: wrap !important; }
         [data-algolia-answer-footer] > .min-w-0.flex-1{ flex: 1 1 100% !important; }
         [data-algolia-rendered-answer-footer]{ margin-left: 0 !important; }
         [data-algolia-rendered-answer-footer] .algolia-usage-pill{ padding-left: 7px !important; padding-right: 7px !important; font-size: 10px !important; }
         [data-algolia-rendered-answer-footer] #acs-compare-toggle{ padding: 6px 9px !important; font-size: 10px !important; }`;
  }

  function updatePanelVisibility(show, widget = hostForTurn(latestPreparedTurn)) {
    const targetWidget = widget || activePanelHost;
    if (show && targetWidget) activePanelHost = targetWidget;
    mount().style.display = show ? "block" : "none";
    if (show) positionPanel();
    else setContentInset(false, false, 0, targetWidget);
  }

  // ------------------------------------------------------------- rendering ---
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  // Minimal markdown. Text is escaped first; links are rebuilt only when the URL
  // passes the http/https check, otherwise the label is emitted as plain text.
  function md(src) {
    let s = esc(src).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, label, rawUrl) => {
      const href = safeHref(rawUrl.replace(/&amp;/g, "&"));
      return href ? `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${label}</a>` : label;
    });
    return s.split(/\n{2,}/).map((p) => `<p style="margin:0 0 10px">${p.replace(/\n/g, "<br>")}</p>`).join("");
  }

  function clearLog() {
    const l = mount().querySelector("#acs-compare-log");
    if (l) l.replaceChildren();
    const e = mount().querySelector("#acs-compare-empty");
    if (e) e.style.display = "";
  }

  function appendTurn(question) {
    const logEl = mount().querySelector("#acs-compare-log");
    mount().querySelector("#acs-compare-empty").style.display = "none";
    const turn = document.createElement("div");
    turn.style.cssText = "margin:0 0 20px;padding:0 0 18px;border-bottom:1px solid #f0f1f5";
    const qRow = document.createElement("div");
    qRow.style.cssText = "display:flex;justify-content:flex-end;margin-bottom:10px";
    const qBubble = document.createElement("div");
    qBubble.style.cssText = "background:#003DFF;color:#fff;font-size:13.5px;border-radius:14px 14px 4px 14px;padding:8px 12px;max-width:85%";
    qBubble.textContent = question;               // text node, never markup
    qRow.appendChild(qBubble);
    const answerEl = document.createElement("div");
    answerEl.style.color = "#021046";
    const srcEl = document.createElement("div");
    turn.append(qRow, answerEl, srcEl);
    logEl.appendChild(turn);
    const p = mount(); p.scrollTop = p.scrollHeight;
    return { answerEl, srcEl };
  }

  // Source chips are built with DOM properties — no URL is ever interpolated
  // into innerHTML.
  function renderSources(srcEl, sources) {
    srcEl.replaceChildren();
    if (!sources.length) return;
    const wrap = document.createElement("div");
    wrap.style.cssText = "margin-top:12px;border-top:1px solid #eef0f5;padding-top:10px";
    const lbl = document.createElement("div");
    lbl.style.cssText = "font-size:11px;text-transform:uppercase;color:#8b93a6;margin-bottom:6px";
    lbl.textContent = "Sources";
    wrap.appendChild(lbl);
    sources.slice(0, 6).forEach((s) => {
      const href = safeHref(s.url);
      if (!href) return;
      const a = document.createElement("a");
      a.href = href;                                       // property, not markup
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.title = href;
      a.textContent = s.title || href;
      a.style.cssText = "display:inline-block;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;vertical-align:bottom;font-size:12px;background:#eef1f7;border-radius:999px;padding:4px 10px;margin:0 6px 6px 0;color:#021046;text-decoration:none";
      wrap.appendChild(a);
    });
    srcEl.appendChild(wrap);
  }

  function renderTurn(turn, state) {
    if (!turn?.answerEl) return;
    if (state.status === "thinking") {
      turn.answerEl.replaceChildren();
      const s = document.createElement("span");
      s.style.color = "#8b93a6"; s.textContent = "Thinking…";
      turn.answerEl.appendChild(s);
      return;
    }
    if (state.status === "error") {
      turn.answerEl.replaceChildren();
      const s = document.createElement("span");
      s.style.color = "#b4232c";
      s.textContent = state.text;                          // text node
      turn.answerEl.appendChild(s);
      turn.srcEl.replaceChildren();
      return;
    }
    turn.answerEl.innerHTML = state.text ? md(state.text) : "";
    renderSources(turn.srcEl, state.sources || []);
    if (state.status === "streaming") { const p = mount(); p.scrollTop = p.scrollHeight; }
  }

  // Test seam: exposed only when explicitly requested by a test harness.
  if (CFG.exposeForTests) {
    window.__acsCompare = {
      safeHref, md,
      state: () => ({
        compareOn,
        hasPreparedTurn: !!latestPreparedTurn,
        generation,
        mirroredTurns,
        activeCompareIdentityKey,
        activeWidgetInstanceId: widgetIdForHost(activePanelHost),
        activeTurns: activeControllers.size,
        latestRuntimeAttemptOrdinal,
        latestLegacyAttemptOrdinal,
        completedTurns: completedTurnCount(),
        acceptedTurns: acceptedAttemptCount() + widgetSetCount(legacyAcceptedTurnKeysByWidget),
        acceptedAttemptSegments: acceptedAttemptCount(),
        acceptedAttemptWidgets: acceptedAttemptsByWidget.size,
        retiredAttemptSegments: retiredAttemptCount(),
        retiredAttemptWidgets: retiredAttemptsByWidget.size,
        latestAttemptOrdinals: latestAttemptOrdinalByWidget.size,
        resetGenerationFloors: resetGenerationFloorByWidget.size,
        resetAttemptOrdinalFloors: resetAttemptOrdinalFloorByWidget.size,
        legacyAcceptedTurns: widgetSetCount(legacyAcceptedTurnKeysByWidget),
        legacyRetiredTurns: widgetSetCount(legacyRetiredTurnKeysByWidget),
        legacyResetGenerationFloors: legacyResetGenerationFloorByWidget.size,
        legacyResetAttemptOrdinalFloors: legacyResetAttemptOrdinalFloorByWidget.size,
        mirroredTurnDiagnostics: mirroredTurnDiagnostics.size,
        productionTurnResults: productionTurnResultCount(),
        preparedTurnHistory: [...preparedTurnHistoryByWidget.values()].reduce((sum, history) => sum + history.length, 0),
      }),
      reset: resetConversation,
      acceptPreparedTurn,
      acceptCompletedTurn,
      askProdForTest: askProd,
      rememberProductionTurnResultForTest: rememberProductionTurnResult,
    };
  }
})();
