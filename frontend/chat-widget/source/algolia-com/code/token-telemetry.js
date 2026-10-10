/**
 * Primary-chat token telemetry observer.
 *
 * The orchestrator transport remains the only owner of the completion stream.
 * This module subscribes to its completed-turn lifecycle and performs one
 * independent, token-only Jahia lookup for each successful primary turn.
 * Release marker: formatted answer-footer token pill.
 */
(() => {
  "use strict";

  if (window.__algoliaTokenTelemetryInstalled) return;
  window.__algoliaTokenTelemetryInstalled = true;

  const CFG = window.ACS_TOKEN_TELEMETRY || {};
  const ACTION_PATH = "/sites/algolia-assets/home.algoliaTokenTelemetry.do";
  const MAX_ATTEMPTS = 3;
  const RETRY_DELAY_MS = 2000;
  const MAX_TRACKED_IDENTITIES = 500;
  const MAX_TRACKED_CONVERSATIONS = 200;
  const fallbackTelemetryFetch = window.fetch.bind(window);
  const usageState = (window.__algoliaChatUsage = window.__algoliaChatUsage || {});
  const usageByIdentity = new Map();
  const completedTurnsByIdentity = new Map();
  const turnTotals = new Map();
  const seenTurnKeys = new Set();
  const latestRevisionByLookup = new Map();
  let generation = 0;
  let unsubscribeCompletedTurns = null;
  let latestCompletedTurn = null;

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

  function completedTurnIdentityKey(detail) {
    const identityKey = answerIdentityKey(detail?.answerIdentity);
    if (identityKey) return identityKey;
    const widgetInstanceId = String(detail?.widgetInstanceId || "legacy").trim();
    const turnKey = String(detail?.turnKey || "").trim();
    return turnKey ? `${widgetInstanceId}\n${turnKey}` : "";
  }

  function conversationTotalsKey(completedTurn, conversationId) {
    const widgetInstanceId = String(
      completedTurn?.answerIdentity?.widgetInstanceId ||
      completedTurn?.widgetInstanceId ||
      "legacy"
    ).trim() || "legacy";
    const stableConversationId = String(conversationId || completedTurn?.conversationId || "").trim();
    return stableConversationId ? `${widgetInstanceId}\n${stableConversationId}` : "";
  }

  function actionUrl() {
    return `${window.__ALGOLIA_TOKEN_TELEMETRY_BASE__ || ""}${ACTION_PATH}`;
  }

  function sendTelemetry(input, init) {
    const nativeSender = window.algoliaContextCompiler?.fetchPrepared;
    return typeof nativeSender === "function"
      ? nativeSender.call(window.algoliaContextCompiler, input, init)
      : fallbackTelemetryFetch(input, init);
  }

  function updateLegacyUsageState(status, completedTurn = latestCompletedTurn, telemetry = null) {
    usageState.status = status;
    if (completedTurn?.conversationId) usageState.conversationId = completedTurn.conversationId;
    if (status === "ready") usageState.usage = telemetry;
    if (status === "loading" || status === "idle" || status === "unavailable") usageState.usage = null;
  }

  function publishUsageState(status, completedTurn = latestCompletedTurn, telemetry = null) {
    if (completedTurn?.identityKey) {
      usageByIdentity.set(completedTurn.identityKey, {
        status,
        usage: status === "ready" ? telemetry : null,
        completedTurn,
      });
    }
    if (!completedTurn || latestCompletedTurn?.identityKey === completedTurn.identityKey) {
      updateLegacyUsageState(status, completedTurn, telemetry);
    }
    const detail = {
      ...usageState,
      status,
      usage: status === "ready" ? telemetry : null,
      completedTurn: completedTurn || null,
      answerIdentity: completedTurn?.answerIdentity || null,
      widgetInstanceId: completedTurn?.answerIdentity?.widgetInstanceId || completedTurn?.widgetInstanceId || null,
    };
    window.dispatchEvent(new CustomEvent("algolia-usage-updated", { detail }));
    renderTelemetryForTurn(completedTurn, detail);
  }

  function notifyAnswerHarnessTelemetry(status, completedTurn = latestCompletedTurn, telemetryOverride = null) {
    const identity = completedTurn?.answerIdentity;
    const accept = window.algoliaAnswerHarness?.accept;
    const createTelemetryContribution = window.algoliaAnswerContributors?.createTelemetryContribution;
    if (!identity || typeof accept !== "function" || typeof createTelemetryContribution !== "function") return;
    const telemetry = status === "ready" ? (telemetryOverride || usageByIdentity.get(completedTurn.identityKey)?.usage || null) : null;
    try {
      accept(Object.freeze({
        eventName: "contribution",
        detail: Object.freeze({
          answerIdentity: identity,
          contribution: createTelemetryContribution({ identity, telemetry }),
        }),
      }));
    } catch {
      // Mirror mode must never affect the visible widget.
    }
  }

  function recomputeCumulative() {
    let inputTokens = 0;
    let outputTokens = 0;
    let totalTokens = 0;
    for (const totals of turnTotals.values()) {
      inputTokens += totals.inputTokens;
      outputTokens += totals.outputTokens;
      totalTokens += totals.totalTokens;
    }
    usageState.cumulativeUsage = { inputTokens, outputTokens, totalTokens, turns: seenTurnKeys.size };
  }

  function currentTurnUsage(previous, current) {
    if (!previous) return current;
    const inputTokens = current.inputTokens - previous.inputTokens;
    const outputTokens = current.outputTokens - previous.outputTokens;
    const totalTokens = current.totalTokens - previous.totalTokens;
    if (inputTokens < 0 || outputTokens < 0 || totalTokens < 0) return current;
    return { inputTokens, outputTokens, totalTokens };
  }

  function totalsMatch(left, right) {
    return !!left &&
      left.inputTokens === right.inputTokens &&
      left.outputTokens === right.outputTokens &&
      left.totalTokens === right.totalTokens;
  }

  function totalsWentBackwards(previous, current) {
    return !!previous && (
      current.inputTokens < previous.inputTokens ||
      current.outputTokens < previous.outputTokens ||
      current.totalTokens < previous.totalTokens
    );
  }

  function forgetIdentityKey(key, options = {}) {
    if (!key) return null;
    const completedTurn = completedTurnsByIdentity.get(key) || usageByIdentity.get(key)?.completedTurn || null;
    usageByIdentity.delete(key);
    completedTurnsByIdentity.delete(key);
    seenTurnKeys.delete(key);
    latestRevisionByLookup.delete(key);
    if (options.clearVisible && completedTurn) {
      renderTelemetryForTurn(completedTurn, { status: "idle", usage: null, completedTurn });
    }
    return completedTurn;
  }

  function pruneIdentityState() {
    while (seenTurnKeys.size > MAX_TRACKED_IDENTITIES) {
      forgetIdentityKey(seenTurnKeys.values().next().value);
    }
    while (usageByIdentity.size > MAX_TRACKED_IDENTITIES) {
      forgetIdentityKey(usageByIdentity.keys().next().value);
    }
    while (completedTurnsByIdentity.size > MAX_TRACKED_IDENTITIES) {
      forgetIdentityKey(completedTurnsByIdentity.keys().next().value);
    }
    while (latestRevisionByLookup.size > MAX_TRACKED_IDENTITIES) {
      forgetIdentityKey(latestRevisionByLookup.keys().next().value);
    }
  }

  function pruneTurnTotals() {
    while (turnTotals.size > MAX_TRACKED_CONVERSATIONS) {
      turnTotals.delete(turnTotals.keys().next().value);
    }
  }

  function resetUsage() {
    for (const entry of usageByIdentity.values()) {
      renderTelemetryForTurn(entry.completedTurn, { status: "idle", usage: null, completedTurn: entry.completedTurn });
    }
    generation += 1;
    turnTotals.clear();
    seenTurnKeys.clear();
    latestRevisionByLookup.clear();
    usageByIdentity.clear();
    completedTurnsByIdentity.clear();
    usageState.usage = null;
    usageState.cumulativeUsage = null;
    usageState.conversationId = null;
    latestCompletedTurn = null;
    publishUsageState("idle");
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

  function resetScopedUsage(widgetInstanceId) {
    if (!widgetInstanceId) return false;
    const prefix = `${widgetInstanceId}\n`;
    for (const key of [...usageByIdentity.keys()]) {
      if (!key.startsWith(prefix)) continue;
      forgetIdentityKey(key, { clearVisible: true });
    }
    for (const key of [...turnTotals.keys()]) {
      if (key.startsWith(prefix)) turnTotals.delete(key);
    }
    recomputeCumulative();
    if (latestCompletedTurn?.identityKey?.startsWith(prefix)) {
      const remaining = [...usageByIdentity.values()].at(-1) || null;
      latestCompletedTurn = remaining?.completedTurn || null;
      if (remaining) {
        updateLegacyUsageState(remaining.status, remaining.completedTurn, remaining.usage);
      } else {
        usageState.usage = null;
        usageState.conversationId = null;
        usageState.status = "idle";
      }
    }
    window.dispatchEvent(new CustomEvent("algolia-usage-updated", {
      detail: {
        ...usageState,
        status: "idle",
        usage: null,
        widgetInstanceId,
        scoped: true,
      },
    }));
    return true;
  }

  function disconnectScopedUsage(widgetInstanceId) {
    if (!widgetInstanceId) return false;
    const prefix = `${widgetInstanceId}\n`;
    for (const key of [...latestRevisionByLookup.keys()]) {
      if (key.startsWith(prefix)) latestRevisionByLookup.delete(key);
    }
    for (const [key, entry] of [...usageByIdentity.entries()]) {
      if (!key.startsWith(prefix) || entry.status === "ready") continue;
      forgetIdentityKey(key);
    }
    if (latestCompletedTurn?.identityKey?.startsWith(prefix) && !usageByIdentity.has(latestCompletedTurn.identityKey)) {
      const remaining = [...usageByIdentity.values()].at(-1) || null;
      latestCompletedTurn = remaining?.completedTurn || null;
      if (remaining) {
        updateLegacyUsageState(remaining.status, remaining.completedTurn, remaining.usage);
      } else {
        usageState.usage = null;
        usageState.conversationId = null;
        usageState.status = "idle";
      }
    }
    recomputeCumulative();
    return true;
  }

  function tokenCount(value) {
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  }

  function parseUsage(data) {
    const inputTokens = tokenCount(data?.inputTokens);
    const outputTokens = tokenCount(data?.outputTokens);
    const explicitTotal = tokenCount(data?.totalTokens);
    if (inputTokens === null || outputTokens === null) return null;
    return {
      inputTokens,
      outputTokens,
      totalTokens: explicitTotal ?? inputTokens + outputTokens,
    };
  }

  function isCurrentLookup(completedTurn, revision, expectedGeneration) {
    return (
      expectedGeneration === generation &&
      latestRevisionByLookup.get(completedTurn?.identityKey) === revision
    );
  }

  function scheduleRetry(completedTurn, conversationId, revision, attempt, expectedGeneration) {
    if (!isCurrentLookup(completedTurn, revision, expectedGeneration)) return;
    if (attempt + 1 >= MAX_ATTEMPTS) {
      publishUsageState("unavailable", completedTurn);
      notifyAnswerHarnessTelemetry("unavailable", completedTurn);
      return;
    }
    setTimeout(
      () => fetchUsage(completedTurn, conversationId, revision, attempt + 1, expectedGeneration),
      RETRY_DELAY_MS,
    );
  }

  async function fetchUsage(completedTurn, conversationId, revision, attempt, expectedGeneration) {
    if (!isCurrentLookup(completedTurn, revision, expectedGeneration)) return;
    try {
      const response = await sendTelemetry(actionUrl(), {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ conversationId }),
      });
      if (!isCurrentLookup(completedTurn, revision, expectedGeneration)) return;
      if (!response.ok) {
        scheduleRetry(completedTurn, conversationId, revision, attempt, expectedGeneration);
        return;
      }
      const totals = parseUsage(await response.json());
      if (!isCurrentLookup(completedTurn, revision, expectedGeneration)) return;
      if (!totals || totals.totalTokens === 0) {
        scheduleRetry(completedTurn, conversationId, revision, attempt, expectedGeneration);
        return;
      }
      const totalsKey = conversationTotalsKey(completedTurn, conversationId);
      const previous = totalsKey ? turnTotals.get(totalsKey) || null : null;
      // The conversation endpoint is eventually consistent. On later turns an
      // unchanged snapshot is stale, even though its totals are non-zero.
      if (totalsMatch(previous, totals)) {
        scheduleRetry(completedTurn, conversationId, revision, attempt, expectedGeneration);
        return;
      }
      // Agent Studio returns cumulative totals for one stable conversation ID.
      // Replace that widget+conversation snapshot after every distinct
      // completed turn; summing snapshots would double-count prior turns and
      // sharing by conversation alone would corrupt two embedded widgets.
      const regressedTotals = totalsWentBackwards(previous, totals);
      if (totalsKey && !regressedTotals) {
        turnTotals.set(totalsKey, totals);
        pruneTurnTotals();
      }
      const turnUsage = currentTurnUsage(previous, totals);
      recomputeCumulative();
      publishUsageState("ready", completedTurn, turnUsage);
      notifyAnswerHarnessTelemetry("ready", completedTurn, turnUsage);
    } catch (error) {
      console.warn("[token-usage] lookup failed", error);
      if (isCurrentLookup(completedTurn, revision, expectedGeneration)) {
        scheduleRetry(completedTurn, conversationId, revision, attempt, expectedGeneration);
      }
    }
  }

  function acceptCompletedTurn(detail) {
    const conversationId = String(detail?.conversationId || "");
    const turnKey = String(detail?.turnKey || "");
    const identityKey = completedTurnIdentityKey(detail);
    if (!conversationId || !turnKey || !identityKey || seenTurnKeys.has(identityKey)) return;
    seenTurnKeys.add(identityKey);
    latestCompletedTurn = {
      identityKey,
      turnKey,
      messageId: String(detail?.messageId || ""),
      question: String(detail?.question || ""),
      conversationId,
      widgetInstanceId: detail?.answerIdentity?.widgetInstanceId || detail?.widgetInstanceId || null,
      answerIdentity: detail?.answerIdentity || null,
    };
    completedTurnsByIdentity.set(identityKey, latestCompletedTurn);
    const revision = (latestRevisionByLookup.get(identityKey) || 0) + 1;
    latestRevisionByLookup.set(identityKey, revision);
    pruneIdentityState();
    publishUsageState("loading", latestCompletedTurn);
    fetchUsage(latestCompletedTurn, conversationId, revision, 0, generation);
  }

  function subscribeToCompletedTurns(attempt = 0) {
    if (unsubscribeCompletedTurns) return true;
    const subscribe = window.algoliaHandoffToOrchestrator?.subscribeCompletedTurn;
    if (typeof subscribe === "function") {
      unsubscribeCompletedTurns = subscribe(acceptCompletedTurn);
      return true;
    }
    if (attempt < 100) setTimeout(() => subscribeToCompletedTurns(attempt + 1), 50);
    return false;
  }

  function renderTelemetryForTurn(completedTurn, state = {}) {
    const renderTelemetry = window.algoliaHandoffToOrchestrator?.renderAnswerFooterTelemetry;
    if (typeof renderTelemetry !== "function" || !completedTurn) return false;
    const cached = usageByIdentity.get(completedTurn.identityKey);
    const hasUsage = Object.prototype.hasOwnProperty.call(state, "usage");
    return renderTelemetry(completedTurn, {
      status: state.status || cached?.status || usageState.status,
      usage: hasUsage ? state.usage : cached?.usage || null,
    });
  }

  document.addEventListener("algolia-visitor-state-reset", (event) => {
    const widgetInstanceId = widgetInstanceIdFromEvent(event);
    if (widgetInstanceId && resetScopedUsage(widgetInstanceId)) return;
    resetUsage();
  });
  document.addEventListener("algolia-chat-widget-disconnected", (event) => {
    disconnectScopedUsage(widgetInstanceIdFromEvent(event));
  });
  subscribeToCompletedTurns();
  publishUsageState("idle");

  if (CFG.exposeForTests) {
    window.__acsTokenTelemetry = {
      acceptCompletedTurn,
      parseUsage,
      resetUsage,
      resetScopedUsage,
      disconnectScopedUsage,
      trackedSizes() {
        return {
          usageByIdentity: usageByIdentity.size,
          completedTurnsByIdentity: completedTurnsByIdentity.size,
          turnTotals: turnTotals.size,
          seenTurnKeys: seenTurnKeys.size,
          latestRevisionByLookup: latestRevisionByLookup.size,
        };
      },
    };
  }
})();
