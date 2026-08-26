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
  const seenTurnKeys = new Set();
  const latestRevisionByConversation = new Map();
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

  function resetUsage() {
    generation += 1;
    turnTotals.clear();
    seenTurnKeys.clear();
    latestRevisionByConversation.clear();
    usageState.usage = null;
    usageState.cumulativeUsage = null;
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

  function isCurrentLookup(conversationId, revision, expectedGeneration) {
    return (
      expectedGeneration === generation &&
      latestRevisionByConversation.get(conversationId) === revision
    );
  }

  function scheduleRetry(conversationId, turnKey, revision, attempt, expectedGeneration) {
    if (!isCurrentLookup(conversationId, revision, expectedGeneration)) return;
    if (attempt + 1 >= MAX_ATTEMPTS) {
      publishUsageState("unavailable");
      return;
    }
    setTimeout(
      () => fetchUsage(conversationId, turnKey, revision, attempt + 1, expectedGeneration),
      RETRY_DELAY_MS,
    );
  }

  async function fetchUsage(conversationId, turnKey, revision, attempt, expectedGeneration) {
    if (!isCurrentLookup(conversationId, revision, expectedGeneration)) return;
    try {
      const response = await sendTelemetry(actionUrl(), {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ conversationId }),
      });
      if (!isCurrentLookup(conversationId, revision, expectedGeneration)) return;
      if (!response.ok) {
        scheduleRetry(conversationId, turnKey, revision, attempt, expectedGeneration);
        return;
      }
      const totals = parseUsage(await response.json());
      if (!isCurrentLookup(conversationId, revision, expectedGeneration)) return;
      if (!totals || totals.totalTokens === 0) {
        scheduleRetry(conversationId, turnKey, revision, attempt, expectedGeneration);
        return;
      }
      const previous = turnTotals.get(conversationId) || null;
      // The conversation endpoint is eventually consistent. On later turns an
      // unchanged snapshot is stale, even though its totals are non-zero.
      if (totalsMatch(previous, totals)) {
        scheduleRetry(conversationId, turnKey, revision, attempt, expectedGeneration);
        return;
      }
      // Agent Studio returns cumulative totals for one stable conversation ID.
      // Replace that conversation's snapshot after every distinct completed
      // turn; summing snapshots would double-count prior turns.
      turnTotals.set(conversationId, totals);
      usageState.conversationId = conversationId;
      usageState.usage = currentTurnUsage(previous, totals);
      recomputeCumulative();
      publishUsageState("ready");
    } catch (error) {
      console.warn("[token-usage] lookup failed", error);
      if (isCurrentLookup(conversationId, revision, expectedGeneration)) {
        scheduleRetry(conversationId, turnKey, revision, attempt, expectedGeneration);
      }
    }
  }

  function acceptCompletedTurn(detail) {
    const conversationId = String(detail?.conversationId || "");
    const turnKey = String(detail?.turnKey || "");
    if (!conversationId || !turnKey || seenTurnKeys.has(turnKey)) return;
    seenTurnKeys.add(turnKey);
    const revision = (latestRevisionByConversation.get(conversationId) || 0) + 1;
    latestRevisionByConversation.set(conversationId, revision);
    usageState.usage = null;
    publishUsageState("loading");
    fetchUsage(conversationId, turnKey, revision, 0, generation);
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
  const PILL_STYLE_ID = "algolia-usage-pill-style";
  const PILL_CSS = `.${PILL_CLASS}{display:inline-flex;align-items:center;width:fit-content;margin-right:6px;border-radius:var(--algolia-radius-full,9999px);border:1px solid var(--algolia-border,#e0e0e0);background:var(--algolia-surface-2,#f0f0f0);color:var(--algolia-text-muted,#5f6368);padding:4px 12px;font-size:var(--algolia-fs-xs,12px);font-weight:var(--algolia-fw-medium,500);font-family:var(--algolia-font-sans,system-ui,sans-serif);line-height:1.4;white-space:nowrap;box-sizing:border-box}`;

  function updatePill(pill, text, title) {
    // Rewriting identical text would retrigger the chat MutationObserver
    // forever, so DOM writes must be idempotent.
    if (pill.textContent !== text) pill.textContent = text;
    if (pill.title !== title) pill.title = title;
  }

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
      updatePill(pill, "Calculating tokens…", "Token usage is being calculated");
      return;
    }
    if (usageState.status === "unavailable" && !usageState.usage) {
      updatePill(
        pill,
        "Tokens unavailable",
        "Token usage could not be loaded; the answer is unaffected",
      );
      return;
    }
    const totals = usageState.usage;
    if (!totals) return;
    updatePill(
      pill,
      `In ${totals.inputTokens} / ${totals.outputTokens} Out`,
      `Current response: ${totals.inputTokens} input tokens and ${totals.outputTokens} output tokens`,
    );
  }

  function latestAnswerFooter(shadowRoot) {
    const sections = [...shadowRoot.querySelectorAll('[aria-label="Grounded sources"]')];
    const latest = sections[sections.length - 1];
    return latest?.parentElement?.parentElement || null;
  }

  function renderLatestPill(shadowRoot) {
    const stalePills = [...shadowRoot.querySelectorAll(`.${PILL_CLASS}`)];
    const footer = latestAnswerFooter(shadowRoot);
    if (usageState.status === "idle" && !usageState.usage) {
      for (const pill of stalePills) pill.remove();
      return;
    }
    for (const pill of stalePills) {
      if (pill.parentElement !== footer) pill.remove();
    }
    if (footer) renderPill(shadowRoot, footer);
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
