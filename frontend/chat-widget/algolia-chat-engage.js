(function () {
  "use strict";

  const LABEL = "[Algolia Chat – Engage]";
  const DEBUG = new URLSearchParams(location.search).get("algoliaChatDebug") === "1";

  const PROFILE_KEY = "algolia_profile";
  const EVENTS_KEY = "algolia_events";
  const SESSION_KEY = "algolia_session";
  const PENDING_GREETING_KEY = "algolia_pending_greeting";

  const DEFAULT_GREETING_TTL_MS = 600 * 1000;
  const DEFAULT_SIGNAL_PULSE_MS = 900;
  const DEFAULT_SIGNAL_DEBOUNCE_MS = 700;
  const DEFAULT_MIN_ANALYSIS_INTERVAL_MS = 5000;

  let config = {
    minPages: 2,
    minEvents: 3,
    analysisDelayMs: 3000,
    widgetTimeoutMs: 25000,
    greetingTtlMs: DEFAULT_GREETING_TTL_MS,
    signalPulseMs: DEFAULT_SIGNAL_PULSE_MS,
    signalDebounceMs: DEFAULT_SIGNAL_DEBOUNCE_MS,
    minAnalysisIntervalMs: DEFAULT_MIN_ANALYSIS_INTERVAL_MS,
    enableProactiveAnalysis: false,
  };

  let engaged = false;
  let analysisInFlight = false;
  let signalAnalysisTimer = null;
  let signalPulseTimer = null;
  let lastAnalysisAt = 0;

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

  function buildContext() {
    const profile = readJson(PROFILE_KEY, {});
    const session = readJson(SESSION_KEY, {}, sessionStorage);
    const eventEnvelope = readJson(EVENTS_KEY, {}, sessionStorage);
    const pages = Array.isArray(session.pages) ? session.pages : [];
    const events = Array.isArray(eventEnvelope)
      ? eventEnvelope
      : Array.isArray(eventEnvelope.events)
        ? eventEnvelope.events
        : [];

    const context = {
      currentPage: { path: location.pathname, title: document.title },
      pagesViewed: pages.map((page) => ({
        path: page.path,
        title: page.title,
        dwellMs: page.dwellMs,
      })),
      pageCount: pages.length,
      sessionDurationMs: session.startedAt ? Date.now() - session.startedAt : 0,
      events: events.slice(-15),
      affinities: Array.isArray(profile.topAffinities) ? profile.topAffinities : [],
      affinitySource: profile.tokenSource || "none",
    };

    return config.enrichContext ? config.enrichContext(context) : context;
  }

  function hasEnoughSignals(context) {
    const { minPages = 2, minEvents = 3 } = config;
    if (context.pageCount === 0 && context.events.length === 0) {
      debug("no visitor data — is algolia-engagement-tracker.js installed?");
      return false;
    }

    const enough = context.pageCount >= minPages || context.events.length >= minEvents;
    debug(
      `signal check → ${enough ? "ENOUGH" : "not enough"} | pages=${context.pageCount} (min ${minPages}) events=${context.events.length}`
    );
    return enough;
  }

  function chatElement() {
    return document.querySelector("algolia-chat");
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

  function parseSseTextDelta(line) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) return "";
    const payload = trimmed.slice(5).trim();
    if (!payload) return "";

    try {
      const event = JSON.parse(payload);
      return event.type === "text-delta" && typeof event.delta === "string" ? event.delta : "";
    } catch {
      return "";
    }
  }

  async function readSseText(stream) {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let text = "";

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) text += parseSseTextDelta(line);
    }

    return text;
  }

  function credentials() {
    const search = document.querySelector("algolia-instant-search");
    return {
      appId: config.appId ?? search?.getAttribute("app-id") ?? null,
      apiKey: config.apiKey ?? search?.getAttribute("api-key") ?? null,
    };
  }

  async function callConcierge(prompt) {
    const { appId, apiKey } = credentials();
    if (!appId || !apiKey) throw new Error("no Algolia credentials found on the page");

    const agentId = config.conciergeAgentId;
    if (!agentId) throw new Error("no conciergeAgentId configured");

    const url = `https://${appId}.algolia.net/agent-studio/1/agents/${agentId}/completions?compatibilityMode=ai-sdk-5`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Algolia-Application-Id": appId,
        "X-Algolia-API-Key": apiKey,
      },
      body: JSON.stringify({
        messages: [{ role: "user", parts: [{ type: "text", text: prompt }] }],
      }),
    });

    if (!response.ok) throw new Error(`concierge call failed: ${response.status}`);
    return readSseText(response.body);
  }

  function extractJsonObject(text) {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end === -1) return null;

    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      return null;
    }
  }

  function showPendingGreeting() {
    const pending = readJson(PENDING_GREETING_KEY, null);
    if (!pending) return false;

    const ttlMs = config.greetingTtlMs ?? DEFAULT_GREETING_TTL_MS;
    if (Date.now() - pending.ts > ttlMs) {
      writeJson(PENDING_GREETING_KEY, null);
      return false;
    }

    writeJson(PENDING_GREETING_KEY, null);
    debug("showing greeting cached by previous page");
    return showGreeting(pending.greeting, pending.suggestions ?? []);
  }

  function showGreeting(greeting, suggestions) {
    const widget = chatElement();
    if (!widget || typeof widget.engage !== "function") return false;

    const shown = widget.engage({ greeting, suggestions });
    engaged = !!shown;
    debug(shown ? "engaged" : "engage() refused — auto-engage is off");
    return engaged;
  }

  function canAnalyze(context) {
    if (engaged) {
      debug("already engaged on this page");
      return false;
    }

    const widget = chatElement();
    if (!widget) {
      debug("no <algolia-chat> on the page");
      return false;
    }

    if (widget.autoEngage === false) {
      debug("visitor switched auto-engage off");
      return false;
    }

    const ttlMs = config.greetingTtlMs ?? DEFAULT_GREETING_TTL_MS;
    const pending = readJson(PENDING_GREETING_KEY, null);
    if (pending && Date.now() - pending.ts < ttlMs) {
      debug("greeting already pending");
      return false;
    }

    if (!config.conciergeAgentId) {
      console.warn(
        LABEL,
        'no conciergeAgentId — the chat stays click-to-open. Set <algolia-chat-engage concierge-agent-id="...">'
      );
      return false;
    }

    return hasEnoughSignals(context);
  }

  function applyDecision(decision) {
    if (!decision?.engage) {
      debug("concierge decided not to engage", decision ?? "(unparseable response)");
      setAnalyzing(false);
      return;
    }

    const greeting = (typeof decision.greeting === "string" ? decision.greeting : "").trim();
    if (!greeting) {
      debug("engage:true but empty greeting — ignoring");
      setAnalyzing(false);
      return;
    }

    const suggestions = Array.isArray(decision.suggestions)
      ? decision.suggestions.filter((suggestion) => typeof suggestion === "string" && !!suggestion.trim())
      : [];

    if (document.hidden) {
      debug("page hidden — caching greeting for next page");
      writeJson(PENDING_GREETING_KEY, { greeting, suggestions, ts: Date.now() });
      setAnalyzing(false);
      return;
    }

    showGreeting(greeting, suggestions);
  }

  async function analyze() {
    const context = buildContext();
    if (!canAnalyze(context)) return;

    debug("calling concierge with context", context);
    analysisInFlight = true;
    lastAnalysisAt = Date.now();
    setAnalyzing(true);

    try {
      const raw = await callConcierge(`CONTEXT:\n${JSON.stringify(context, null, 2)}`);
      debug("concierge raw response:", raw.slice(0, 500));
      applyDecision(extractJsonObject(raw));
    } catch (error) {
      console.warn(LABEL, "proactive analysis failed:", error instanceof Error ? error.message : error);
      setAnalyzing(false);
    } finally {
      analysisInFlight = false;
    }
  }

  function pulseLauncher() {
    const widget = chatElement();
    if (!widget || widget.autoEngage === false || engaged) return;

    setAnalyzing(true);
    if (signalPulseTimer !== null) clearTimeout(signalPulseTimer);
    signalPulseTimer = setTimeout(() => {
      signalPulseTimer = null;
      if (!analysisInFlight) setAnalyzing(false);
    }, config.signalPulseMs ?? DEFAULT_SIGNAL_PULSE_MS);
  }

  function scheduleSignalAnalysis() {
    if (engaged || analysisInFlight) return;

    const minIntervalMs = config.minAnalysisIntervalMs ?? DEFAULT_MIN_ANALYSIS_INTERVAL_MS;
    if (Date.now() - lastAnalysisAt < minIntervalMs) return;

    if (signalAnalysisTimer !== null) clearTimeout(signalAnalysisTimer);
    signalAnalysisTimer = setTimeout(() => {
      signalAnalysisTimer = null;
      analyze().catch((error) => {
        console.warn(LABEL, "signal analysis failed:", error instanceof Error ? error.message : error);
        setAnalyzing(false);
      });
    }, config.signalDebounceMs ?? DEFAULT_SIGNAL_DEBOUNCE_MS);
  }

  function handleEngagementSignal(event) {
    const name = event?.detail?.name;
    if (!name) return;

    pulseLauncher();
    if (config.enableProactiveAnalysis) scheduleSignalAnalysis();
  }

  async function init() {
    const { widgetTimeoutMs = 25000, analysisDelayMs = 3000 } = config;
    if (!(await waitForWidget(widgetTimeoutMs))) {
      debug(`<algolia-chat> never became ready within ${widgetTimeoutMs}ms`);
      return;
    }

    if (config.enableProactiveAnalysis && !showPendingGreeting()) {
      await new Promise((resolve) => setTimeout(resolve, analysisDelayMs));
      await analyze();
    }
  }

  const root = window;
  if (!root.__algoliaChat_engageInstalled) {
    root.__algoliaChat_engageInstalled = true;
    configure(readQueryConfig());
    configure(readWindowConfig());

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
