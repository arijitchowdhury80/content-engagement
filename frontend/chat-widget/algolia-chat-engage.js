(function () {
  "use strict";

  const LABEL = "[Algolia Chat – Engage]";
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

  const DEBUG = debugFlag("algoliaEngageDebug");

  const PROFILE_KEY = "algolia_profile";
  const EVENTS_KEY = "algolia_events";
  const SESSION_KEY = "algolia_session";
  const DEFAULT_SIGNAL_PULSE_MS = 900;

  let config = {
    widgetTimeoutMs: 25000,
    signalPulseMs: DEFAULT_SIGNAL_PULSE_MS,
  };

  let signalPulseTimer = null;

  function debug(...args) {
    if (DEBUG) console.log(LABEL, ...args);
  }

  function readWindowConfig() {
    try {
      const value = window.ALGOLIA_CONTEXT_ENGINE_CONFIG;
      return value && typeof value === "object" ? value : {};
    } catch {
      return {};
    }
  }

  function parseNumber(value) {
    if (!value) return undefined;
    const number = Number(value);
    return Number.isFinite(number) ? number : undefined;
  }

  function readQueryConfig() {
    try {
      const params = new URLSearchParams(location.search);
      const next = {};
      const conciergeAgentId = params.get("concierge") ?? params.get("conciergeAgentId");
      if (conciergeAgentId) next.conciergeAgentId = conciergeAgentId;

      const minPages = parseNumber(params.get("minPages"));
      if (minPages !== undefined) next.minPages = minPages;

      const minEvents = parseNumber(params.get("minEvents"));
      if (minEvents !== undefined) next.minEvents = minEvents;

      const analysisDelayMs = parseNumber(params.get("delayMs") ?? params.get("analysisDelayMs"));
      if (analysisDelayMs !== undefined) next.analysisDelayMs = analysisDelayMs;

      return next;
    } catch {
      return {};
    }
  }

  function configure(nextConfig) {
    config = { ...config, ...(nextConfig || {}) };
    debug("configured", config);
  }

  function readJson(key, fallback, storage = localStorage) {
    try {
      const value = storage.getItem(key);
      return value ? JSON.parse(value) : fallback;
    } catch {
      return fallback;
    }
  }

  function writeJson(key, value) {
    try {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Best effort only; pending greetings should never break the host page.
    }
  }

  function chatElement() {
    return document.querySelector("algolia-chat");
  }

  function normalizeInternalJahiaDocLinks(root = document) {
    const anchors = root.querySelectorAll?.(
      'a[data-finalurl][data-is-internal="true"]'
    );
    if (!anchors) return;

    for (const anchor of anchors) {
      const href = anchor.getAttribute?.("href") || "";
      if (!href.startsWith("/sites/www/doc/")) continue;

      try {
        const finalUrl = new URL(anchor.dataset?.finalurl || "", location.origin);
        if (
          finalUrl.origin === location.origin &&
          finalUrl.pathname.startsWith("/cms/render/") &&
          finalUrl.pathname.includes("/sites/www/home/doc/")
        ) {
          anchor.setAttribute("href", finalUrl.href);
          debug("repaired internal documentation href", {
            from: href,
            to: finalUrl.href,
          });
        }
      } catch {
        // Leave malformed host-page links untouched.
      }
    }
  }

  function trackerVisitorDataSource() {
    return {
      getProfile() {
        return readJson(PROFILE_KEY, {});
      },
      getEvents() {
        const envelope = readJson(EVENTS_KEY, {}, sessionStorage);
        const events = Array.isArray(envelope)
          ? envelope
          : Array.isArray(envelope?.events)
            ? envelope.events
            : [];
        return events.slice(-20);
      },
      getSessionPages() {
        const session = readJson(SESSION_KEY, {}, sessionStorage);
        return Array.isArray(session?.pages) ? session.pages : [];
      },
      getSession() {
        return readJson(SESSION_KEY, {}, sessionStorage);
      },
    };
  }

  function connectTrackerToChat() {
    const widget = chatElement();
    if (!widget || typeof widget.setVisitorDataSource !== "function") return false;
    widget.setVisitorDataSource(trackerVisitorDataSource());
    debug("connected canonical tracker stores to reactive chat context");
    return true;
  }

  function setAnalyzing(value) {
    chatElement()?.setAnalyzing?.(value);
  }

  function waitForWidget(timeoutMs) {
    const current = chatElement();
    if (current && typeof current.engage === "function") return Promise.resolve(true);

    return new Promise((resolve) => {
      const deadline = Date.now() + timeoutMs;
      const interval = setInterval(() => {
        const next = chatElement();
        if (next && typeof next.engage === "function") {
          clearInterval(interval);
          resolve(true);
        } else if (Date.now() > deadline) {
          clearInterval(interval);
          resolve(false);
        }
      }, 250);
    });
  }

  function pulseLauncher() {
    const widget = chatElement();
    if (!widget || widget.autoEngage === false) return;

    setAnalyzing(true);
    if (signalPulseTimer !== null) clearTimeout(signalPulseTimer);
    signalPulseTimer = setTimeout(() => {
      signalPulseTimer = null;
      setAnalyzing(false);
    }, config.signalPulseMs ?? DEFAULT_SIGNAL_PULSE_MS);
  }

  function handleEngagementSignal(event) {
    const name = event?.detail?.name;
    if (!name) return;

    pulseLauncher();
  }

  async function init() {
    const { widgetTimeoutMs = 25000 } = config;
    if (!(await waitForWidget(widgetTimeoutMs))) {
      debug(`<algolia-chat> never became ready within ${widgetTimeoutMs}ms`);
      return;
    }

    connectTrackerToChat();
  }

  const root = window;
  if (!root.__algoliaChat_engageInstalled) {
    root.__algoliaChat_engageInstalled = true;
    configure(readQueryConfig());
    configure(readWindowConfig());
    normalizeInternalJahiaDocLinks();

    const previous = root.algoliaEngage;
    root.algoliaEngage = { configure };
    if (Array.isArray(previous?._queue)) {
      for (const [nextConfig] of previous._queue) configure(nextConfig);
    }

    document.addEventListener("algolia-engagement-signal", handleEngagementSignal);
    init().catch((error) => {
      console.warn(LABEL, "init failed:", error instanceof Error ? error.message : error);
    });
  }
})();
