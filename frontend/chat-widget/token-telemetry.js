/**
 * Primary-chat token telemetry observer.
 *
 * The orchestrator transport remains the only owner of the completion stream.
 * This module subscribes to its completed-turn lifecycle and performs one
 * independent, token-only Jahia lookup for each successful primary turn.
 */
(() => {
  "use strict";

  if (window.__algoliaTokenTelemetryInstalled) return;
  window.__algoliaTokenTelemetryInstalled = true;

  const CFG = window.ACS_TOKEN_TELEMETRY || {};
  const ACTION_PATH = "/sites/algolia-assets/home.algoliaTokenTelemetry.do";
  const MAX_ATTEMPTS = 3;
  const RETRY_DELAY_MS = 2000;
  const fallbackTelemetryFetch = window.fetch.bind(window);
  const usageState = (window.__algoliaChatUsage = window.__algoliaChatUsage || {});
  const turnTotals = new Map();
  const seenConversationIds = new Set();
  let generation = 0;
  let unsubscribeCompletedTurns = null;

  function actionUrl() {
    return `${window.__ALGOLIA_TOKEN_TELEMETRY_BASE__ || ""}${ACTION_PATH}`;
  }

  function sendTelemetry(input, init) {
    const nativeSender = window.algoliaContextCompiler?.fetchPrepared;
    return typeof nativeSender === "function"
      ? nativeSender.call(window.algoliaContextCompiler, input, init)
      : fallbackTelemetryFetch(input, init);
  }

  function publishUsageState(status) {
    usageState.status = status;
    window.dispatchEvent(new CustomEvent("algolia-usage-updated", { detail: usageState }));
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
    usageState.usage = { inputTokens, outputTokens, totalTokens, turns: turnTotals.size };
    publishUsageState("ready");
  }

  function resetUsage() {
    generation += 1;
    turnTotals.clear();
    seenConversationIds.clear();
    usageState.usage = null;
    usageState.conversationId = null;
    publishUsageState("idle");
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

  function scheduleRetry(conversationId, attempt, expectedGeneration) {
    if (attempt + 1 >= MAX_ATTEMPTS || expectedGeneration !== generation) {
      publishUsageState("unavailable");
      return;
    }
    setTimeout(
      () => fetchUsage(conversationId, attempt + 1, expectedGeneration),
      RETRY_DELAY_MS,
    );
  }

  async function fetchUsage(conversationId, attempt, expectedGeneration) {
    try {
      const response = await sendTelemetry(actionUrl(), {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ conversationId }),
      });
      if (expectedGeneration !== generation) return;
      if (!response.ok) {
        scheduleRetry(conversationId, attempt, expectedGeneration);
        return;
      }
      const totals = parseUsage(await response.json());
      if (!totals || totals.totalTokens === 0) {
        scheduleRetry(conversationId, attempt, expectedGeneration);
        return;
      }
      turnTotals.set(conversationId, totals);
      usageState.conversationId = conversationId;
      recomputeCumulative();
    } catch (error) {
      console.warn("[token-usage] lookup failed", error);
      if (expectedGeneration === generation) {
        scheduleRetry(conversationId, attempt, expectedGeneration);
      }
    }
  }

  function acceptCompletedTurn(detail) {
    const conversationId = String(detail?.conversationId || "");
    if (!conversationId || seenConversationIds.has(conversationId)) return;
    seenConversationIds.add(conversationId);
    publishUsageState("loading");
    fetchUsage(conversationId, 0, generation);
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

  const PILL_CLASS = "algolia-usage-pill";
  const HEADER_PILL_CLASS = "algolia-usage-pill--header";
  const PILL_STYLE_ID = "algolia-usage-pill-style";
  const PILL_CSS = `.${PILL_CLASS}{display:inline-flex;align-items:center;width:fit-content;margin-right:6px;border-radius:var(--algolia-radius-full,9999px);border:1px solid var(--algolia-border,#e0e0e0);background:var(--algolia-surface-2,#f0f0f0);color:var(--algolia-text-muted,#5f6368);padding:4px 12px;font-size:var(--algolia-fs-xs,12px);font-weight:var(--algolia-fw-medium,500);font-family:var(--algolia-font-sans,system-ui,sans-serif);line-height:1.4;white-space:nowrap;box-sizing:border-box}`;

  function renderPill(root, container, anchor = null, extraClass = "") {
    if (!root || !container) return;
    let pill = container.querySelector(`.${PILL_CLASS}`);
    if (usageState.status === "idle" && !usageState.usage) {
      pill?.remove();
      return;
    }
    if (!root.querySelector(`#${PILL_STYLE_ID}`)) {
      const style = document.createElement("style");
      style.id = PILL_STYLE_ID;
      style.textContent = PILL_CSS;
      root.prepend(style);
    }
    if (!pill) {
      pill = document.createElement("span");
      pill.className = `${PILL_CLASS}${extraClass ? ` ${extraClass}` : ""}`;
      pill.setAttribute("aria-live", "polite");
      anchor ? container.insertBefore(pill, anchor) : container.appendChild(pill);
    }
    if (usageState.status === "loading") {
      pill.textContent = "Calculating tokens…";
      pill.title = "Token usage is being calculated";
      return;
    }
    if (usageState.status === "unavailable" && !usageState.usage) {
      pill.textContent = "Tokens unavailable";
      pill.title = "Token usage could not be loaded; the answer is unaffected";
      return;
    }
    const totals = usageState.usage;
    if (!totals) return;
    pill.textContent = `${totals.totalTokens} tokens`;
    pill.title = `Input ${totals.inputTokens} / Output ${totals.outputTokens} tokens`;
  }

  function renderPillInto(badge) {
    const root = badge?.shadowRoot;
    if (!root) return;
    renderPill(root, root, root.querySelector(".badge"));
  }

  function renderHeaderPill(shadowRoot) {
    const header = shadowRoot.querySelector("header, [role='banner'], [part='header']");
    renderPill(shadowRoot, header, header?.lastElementChild || null, HEADER_PILL_CLASS);
  }

  function renderLatestPill(shadowRoot) {
    const badges = [...shadowRoot.querySelectorAll("algolia-confidence-badge")];
    const latestBadge = badges[badges.length - 1];
    if (usageState.status === "idle" && !usageState.usage) {
      shadowRoot.querySelector(`.${HEADER_PILL_CLASS}`)?.remove();
      for (const badge of badges) badge.shadowRoot?.querySelector(`.${PILL_CLASS}`)?.remove();
      return;
    }
    if (latestBadge) {
      shadowRoot.querySelector(`.${HEADER_PILL_CLASS}`)?.remove();
      for (const badge of badges.slice(0, -1)) {
        badge.shadowRoot?.querySelector(`.${PILL_CLASS}`)?.remove();
      }
      renderPillInto(latestBadge);
      return;
    }
    // Confidence judging can be disabled on the live widget. Token telemetry is
    // independent, so keep it visible in the conversation header in that mode.
    renderHeaderPill(shadowRoot);
  }

  function whenChatShadowReady(callback) {
    const tryNow = () => {
      const shadowRoot = document.querySelector("algolia-chat")?.shadowRoot;
      if (!shadowRoot) return false;
      callback(shadowRoot);
      return true;
    };
    if (tryNow()) return;
    const intervalId = setInterval(() => tryNow() && clearInterval(intervalId), 300);
  }

  document.addEventListener("algolia-visitor-state-reset", resetUsage);
  window.addEventListener("algolia-usage-updated", () => {
    const shadowRoot = document.querySelector("algolia-chat")?.shadowRoot;
    if (shadowRoot) renderLatestPill(shadowRoot);
  });
  whenChatShadowReady((shadowRoot) => {
    new MutationObserver(() => renderLatestPill(shadowRoot)).observe(shadowRoot, {
      childList: true,
      subtree: true,
    });
    renderLatestPill(shadowRoot);
  });
  subscribeToCompletedTurns();
  publishUsageState("idle");

  if (CFG.exposeForTests) {
    window.__acsTokenTelemetry = { acceptCompletedTurn, parseUsage, resetUsage };
  }
})();
