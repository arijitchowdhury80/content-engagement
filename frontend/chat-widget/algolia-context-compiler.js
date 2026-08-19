(function () {
  "use strict";

  const LABEL = "[Algolia Context Compiler]";
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

  const DEBUG = debugFlag("algoliaContextDebug");

  const PROFILE_KEY = "algolia_profile";
  const SESSION_KEY = "algolia_session";
  const EVENTS_KEY = "algolia_events";
  const VALIDATION_ERROR_KEY = "algolia_context_validation_error";

  const PACKET_SCHEMA = "AlgoliaContextPacket.v1";
  const CANONICAL_JOURNEY_TRIGGERS = Object.freeze([
    "product_page_10s_50_scroll",
    "product_to_documentation",
    "solution_page_10s_50_scroll",
    "solution_to_customer_story",
    "product_to_pricing",
    "solution_to_pricing",
    "developer_page_10s_50_scroll",
    "resource_page_10s_50_scroll",
  ]);
  const MAX_RECENT_EVENTS = 15;
  const MAX_TURN_CONTEXT_KEYS = 32;
  const MAX_TURN_CONTEXT_BYTES = 4096;
  const MAX_TURN_CONTEXT_VALUE_BYTES = 1024;
  const JOURNEY_DWELL_MS = 5000;
  const JOURNEY_SCROLL_DEPTH = 25;
  const AGENT_STUDIO_COMPLETIONS_RE = /\/agent-studio\/1\/agents\/[^/]+\/completions/;
  const SENSITIVE_PROP_RE =
    /email|phone|password|passwd|token|secret|api[_-]?key|credential|name|company|value/i;
  const REDACT_EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
  const REDACT_PHONE_RE = /\b(?:\+?\d[\d .()/-]{7,}\d)\b/g;

  let config = {
    autoInstallFetchInterceptor: true,
    maxRecentEvents: MAX_RECENT_EVENTS,
  };
  let originalFetch = null;
  let patchedFetch = null;

  function debugLog(...args) {
    if (DEBUG) console.log(LABEL, ...args);
  }

  function configure(nextConfig) {
    config = { ...config, ...(nextConfig || {}) };
  }

  function readJson(storage, key, fallback) {
    try {
      const raw = storage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }

  function rawSnapshot() {
    return {
      profile: readJson(localStorage, PROFILE_KEY, null),
      session: readJson(sessionStorage, SESSION_KEY, null),
      eventsEnvelope: readJson(sessionStorage, EVENTS_KEY, { events: [] }),
    };
  }

  function byteLength(value) {
    const text = String(value);
    try {
      return new TextEncoder().encode(text).length;
    } catch {
      return text.length;
    }
  }

  function clampText(value, maxLength = 180) {
    if (value === undefined || value === null) return undefined;
    const clean = String(value)
      .replace(REDACT_EMAIL_RE, "[redacted-email]")
      .replace(REDACT_PHONE_RE, "[redacted-phone]")
      .replace(/\s+/g, " ")
      .trim();
    if (!clean) return undefined;
    return clean.length > maxLength ? `${clean.slice(0, maxLength - 1)}...` : clean;
  }

  function sanitizeProps(props) {
    const clean = {};
    for (const [key, value] of Object.entries(props || {})) {
      if (SENSITIVE_PROP_RE.test(key)) continue;
      if (value === undefined || value === null) continue;
      if (typeof value === "string") clean[key] = clampText(value);
      else if (typeof value === "number" || typeof value === "boolean") clean[key] = value;
      else if (Array.isArray(value)) clean[key] = value.slice(0, 8).map((item) => clampText(item));
      else if (typeof value === "object") clean[key] = sanitizeProps(value);
    }
    return clean;
  }

  function currentPath() {
    try {
      return location.pathname || "/";
    } catch {
      return "/";
    }
  }

  function normalizeEvents(eventsEnvelope) {
    const events = Array.isArray(eventsEnvelope?.events) ? eventsEnvelope.events : [];
    return events
      .filter((event) => event && event.name !== "nav_hover" && event.name !== "hover")
      .map((event) => ({
        eventId: clampText(event.eventId, 80),
        name: clampText(event.name, 80),
        ts: Number.isFinite(event.ts) ? event.ts : 0,
        pageId: clampText(event.pageId, 80),
        path: clampText(event.path, 160),
        source: event.source === "inferred" ? "inferred" : "observed",
        props: sanitizeProps(event.props),
      }))
      .filter((event) => event.name)
      .sort((a, b) => a.ts - b.ts);
  }

  function classifyPath(path = currentPath(), title = "") {
    const text = `${path} ${title}`.toLowerCase();
    if (text.includes("/pricing")) return { pageGroup: "pricing", topic: "pricing_and_usage" };
    if (text.includes("/demo") || text.includes("contact-sales")) {
      return { pageGroup: "conversion", topic: "demo_request" };
    }
    if (text.includes("/customers")) return { pageGroup: "customer_story", topic: topicFromText(text, "customer_proof") };
    if (text.includes("/doc/") || text.includes("/docs") || text.includes("/api")) {
      return { pageGroup: "documentation", topic: topicFromText(text, "implementation") };
    }
    if (text.includes("/developers") || text.includes("/developer")) {
      return { pageGroup: "developer", topic: topicFromText(text, "developer_experience") };
    }
    if (text.includes("/products")) {
      return {
        pageGroup: "product",
        topic: topicFromText(text, "product_research"),
        ...productFocusFromText(text),
      };
    }
    if (text.includes("/industries") || text.includes("/solutions")) {
      return {
        pageGroup: "solution",
        topic: topicFromText(text, "industry_solution"),
        ...solutionFocusFromText(text),
      };
    }
    if (text.includes("/blog") || text.includes("/resources")) return { pageGroup: "resource", topic: topicFromText(text, "education") };
    return { pageGroup: "other", topic: topicFromText(text, "general") };
  }

  function topicFromText(text, fallback) {
    if (/react[-\s]?instantsearch|instantsearch/.test(text)) return "instantsearch_implementation";
    if (/recommend|personalization|ai search|neural|semantic/.test(text)) return "ai_search";
    if (/api|sdk|integration|implementation|developer|doc/.test(text)) return "implementation";
    if (/pricing|cost|usage|rate|api call|request/.test(text)) return "pricing_and_usage";
    if (/fashion|retail|ecommerce|commerce|merchandising/.test(text)) return "commerce";
    if (/customer|case stud|roi|conversion|revenue/.test(text)) return "customer_proof";
    if (/marketplace/.test(text)) return "marketplace";
    return fallback;
  }

  function productFocusFromText(text) {
    if (/personalization|personalized/.test(text)) {
      return { productFocus: "personalization", productFocusLabel: "Personalization" };
    }
    if (/recommend|recommendations/.test(text)) {
      return { productFocus: "recommendations", productFocusLabel: "AI Recommendations" };
    }
    if (/neural|semantic/.test(text)) {
      return { productFocus: "neural_search", productFocusLabel: "Neural Search" };
    }
    if (/instantsearch/.test(text)) {
      return { productFocus: "instantsearch", productFocusLabel: "InstantSearch" };
    }
    if (/ai search/.test(text)) {
      return { productFocus: "ai_search", productFocusLabel: "AI Search" };
    }
    if (/\/products\/search|site search|\bsearch\b/.test(text)) {
      return { productFocus: "search", productFocusLabel: "Search" };
    }
    return {};
  }

  function solutionFocusFromText(text) {
    if (/fashion|retail|ecommerce|commerce|merchandising/.test(text)) {
      return { solutionFocus: "commerce", solutionFocusLabel: "Commerce" };
    }
    if (/marketplace/.test(text)) {
      return { solutionFocus: "marketplace", solutionFocusLabel: "Marketplace" };
    }
    if (/financial|bank|insurance|wealth|advisor/.test(text)) {
      return { solutionFocus: "financial_services", solutionFocusLabel: "Financial Services" };
    }
    if (/healthcare|patient|hospital|life[-\s]?science/.test(text)) {
      return { solutionFocus: "healthcare", solutionFocusLabel: "Healthcare" };
    }
    if (/media|publishing|news|content/.test(text)) {
      return { solutionFocus: "media", solutionFocusLabel: "Media" };
    }
    if (/b2b|manufacturer|industrial|distribution/.test(text)) {
      return { solutionFocus: "b2b", solutionFocusLabel: "B2B" };
    }
    if (/enterprise/.test(text)) {
      return { solutionFocus: "enterprise", solutionFocusLabel: "Enterprise" };
    }
    return {};
  }

  function pageWithClassification(page) {
    const classified = classifyPath(page?.path, page?.title);
    const merged = { ...classified, ...(page || {}) };
    if (!merged.productFocus && classified.productFocus) {
      merged.productFocus = classified.productFocus;
      merged.productFocusLabel = classified.productFocusLabel;
    }
    if (!merged.solutionFocus && classified.solutionFocus) {
      merged.solutionFocus = classified.solutionFocus;
      merged.solutionFocusLabel = classified.solutionFocusLabel;
    }
    return merged;
  }

  function findCurrentPage(session) {
    const pages = Array.isArray(session?.pages) ? session.pages : [];
    return (
      pages.find((page) => page.pageId && page.pageId === session?.currentPageId) ||
      [...pages].reverse().find((page) => page.path === currentPath()) ||
      pages.at(-1) ||
      {
        pageId: null,
        path: currentPath(),
        title: typeof document !== "undefined" ? document.title : "",
        pageGroup: classifyPath().pageGroup,
        topic: classifyPath().topic,
      }
    );
  }

  function scoreFromSignals({ currentPage, recentEvents }) {
    const text = [
      currentPage?.path,
      currentPage?.title,
      currentPage?.pageGroup,
      currentPage?.topic,
      ...recentEvents.map((event) => [
        event.name,
        event.path,
        event.props?.label,
        event.props?.query,
        event.props?.topic,
        event.props?.pageGroup,
      ].filter(Boolean).join(" ")),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    const recentNames = new Set(recentEvents.slice(-6).map((event) => event.name));
    const hasRecentDemoSignal =
      recentNames.has("cta_click") ||
      recentNames.has("form_attempt") ||
      recentNames.has("form_success") ||
      text.includes("contact sales") ||
      text.includes("demo");
    const currentPageGroup = currentPage?.pageGroup || classifyPath(currentPage?.path, currentPage?.title).pageGroup;
    const isCommercialPage = currentPageGroup === "pricing" || currentPageGroup === "conversion";

    if (/recommend|personalization|ai search|neural|semantic/.test(text) && !hasRecentDemoSignal && !isCommercialPage) {
      const pricingFriction = /pricing|cost|usage|api call|rate/.test(text);
      return {
        intent: {
          value: "ai_recommendations_evaluation",
          state: "inferred",
          confidence: 0.72,
          evidence: evidenceFor(recentEvents, currentPage, ["recommend", "personalization", "ai_search", "site_search", "nav_click"]),
        },
        friction: {
          value: pricingFriction ? "pricing_or_cost_unclear" : "fit_and_value_unclear",
          state: "inferred",
          confidence: pricingFriction ? 0.68 : 0.62,
          evidence: evidenceFor(recentEvents, currentPage, ["implementation", "api", "pricing", "cost", "site_search"]),
        },
        nextBestAction: {
          value: "explain_feature_fit_with_example",
          state: "inferred",
          confidence: 0.66,
        },
      };
    }

    if (hasRecentDemoSignal || isCommercialPage || /pricing|cost|usage|api call|rate/.test(text)) {
      return {
        intent: {
          value: "pricing_or_demo_evaluation",
          state: "inferred",
          confidence: 0.74,
          evidence: evidenceFor(recentEvents, currentPage, ["pricing", "cost", "demo", "cta_click", "site_search"]),
        },
        friction: {
          value: "pricing_or_cost_unclear",
          state: "inferred",
          confidence: 0.68,
          evidence: evidenceFor(recentEvents, currentPage, ["pricing", "cost", "api call", "rate", "site_search"]),
        },
        nextBestAction: {
          value: "answer_cost_or_route_to_demo",
          state: "inferred",
          confidence: 0.7,
        },
      };
    }

    if (/developer|implementation|instantsearch|api|sdk|doc/.test(text)) {
      return {
        intent: {
          value: "implementation_research",
          state: "inferred",
          confidence: 0.69,
          evidence: evidenceFor(recentEvents, currentPage, ["developer", "implementation", "instantsearch", "api", "sdk"]),
        },
        friction: {
          value: "development_effort_unclear",
          state: "inferred",
          confidence: 0.64,
          evidence: evidenceFor(recentEvents, currentPage, ["implementation", "api", "sdk", "doc"]),
        },
        nextBestAction: {
          value: "answer_implementation_path",
          state: "inferred",
          confidence: 0.66,
        },
      };
    }

    return {
      intent: {
        value: "general_algolia_research",
        state: "inferred",
        confidence: 0.45,
        evidence: evidenceFor(recentEvents, currentPage, []),
      },
      friction: {
        value: "question_behind_question_unknown",
        state: "inferred",
        confidence: 0.38,
        evidence: [],
      },
      nextBestAction: {
        value: "answer_then_ask_discovery_question",
        state: "inferred",
        confidence: 0.44,
      },
    };
  }

  function evidenceFor(events, currentPage, terms) {
    const evidence = [];
    const pageText = [currentPage?.title, currentPage?.path, currentPage?.topic].filter(Boolean).join(" ");
    if (pageText) evidence.push(`current_page:${clampText(pageText, 120)}`);
    const loweredTerms = terms.map((term) => term.toLowerCase());
    for (const event of [...events].reverse()) {
      const eventText = JSON.stringify({ name: event.name, path: event.path, props: event.props }).toLowerCase();
      if (!loweredTerms.length || loweredTerms.some((term) => eventText.includes(term))) {
        evidence.push(`${event.name}:${clampText(event.props?.label || event.props?.query || event.path, 120)}`);
      }
      if (evidence.length >= 4) break;
    }
    return evidence;
  }

  function inferPersona(profile, recentEvents, currentPage) {
    const confirmed = profile?.persona;
    if (confirmed?.value) {
      return {
        value: clampText(confirmed.value, 60),
        state: confirmed.state === "confirmed" ? "confirmed" : "observed",
        source: clampText(confirmed.source || "profile", 80),
      };
    }

    const text = [
      currentPage?.path,
      currentPage?.title,
      currentPage?.pageGroup,
      currentPage?.topic,
      ...recentEvents.map((event) => JSON.stringify({ name: event.name, props: event.props })),
    ].join(" ").toLowerCase();

    if (/developer|doc|api|sdk|implementation|instantsearch/.test(text)) {
      return { value: "developer", state: "inferred", confidence: 0.66, source: "behavior" };
    }
    if (/pricing|roi|customer|case stud|executive|value/.test(text)) {
      return { value: "executive", state: "inferred", confidence: 0.58, source: "behavior" };
    }
    if (/fashion|retail|merchandising|recommend|personalization|commerce/.test(text)) {
      return { value: "merchandiser", state: "inferred", confidence: 0.56, source: "behavior" };
    }
    return { value: "unknown", state: "unknown", confidence: 0, source: "insufficient_signal" };
  }

  function summarizeEvents(events) {
    const counts = {};
    for (const event of events) counts[event.name] = (counts[event.name] || 0) + 1;
    return counts;
  }

  function compile() {
    const raw = rawSnapshot();
    const profile = raw.profile || {};
    const session = raw.session || {};
    const events = normalizeEvents(raw.eventsEnvelope);
    const maxRecentEvents = Number.isFinite(config.maxRecentEvents)
      ? config.maxRecentEvents
      : MAX_RECENT_EVENTS;
    const recentEvents = events.slice(-maxRecentEvents);
    const currentPage = findCurrentPage(session);
    const classifiedPage = pageWithClassification(currentPage);
    const persona = inferPersona(profile, recentEvents, classifiedPage);
    const inferences = scoreFromSignals({ currentPage: classifiedPage, recentEvents });

    return {
      schema: PACKET_SCHEMA,
      compiledAt: Date.now(),
      profile: {
        visitorId: clampText(profile.visitorId, 80),
        visits: Number.isFinite(profile.visits) ? profile.visits : undefined,
        persona,
      },
      session: {
        sessionId: clampText(session.sessionId, 80),
        startedAt: session.startedAt,
        pageCount: Array.isArray(session.pages) ? session.pages.length : 0,
        engagementHistory: Array.isArray(session.engagementHistory)
          ? session.engagementHistory.slice(-5).map((item) => ({
              id: clampText(item.id, 80),
              messageGoal: clampText(item.messageGoal, 100),
              shownAt: item.shownAt,
              status: clampText(item.status, 80),
            }))
          : [],
      },
      currentPage: {
        pageId: clampText(classifiedPage.pageId, 80),
        path: clampText(classifiedPage.path || currentPath(), 160),
        title: clampText(classifiedPage.title, 160),
        pageGroup: clampText(classifiedPage.pageGroup, 80),
        topic: clampText(classifiedPage.topic, 80),
        productFocus: clampText(classifiedPage.productFocus, 80),
        productFocusLabel: clampText(classifiedPage.productFocusLabel, 80),
        solutionFocus: clampText(classifiedPage.solutionFocus, 80),
        solutionFocusLabel: clampText(classifiedPage.solutionFocusLabel, 80),
        dwellMs: Number.isFinite(classifiedPage.dwellMs) ? classifiedPage.dwellMs : 0,
        maxScrollDepth: Number.isFinite(classifiedPage.maxScrollDepth) ? classifiedPage.maxScrollDepth : 0,
      },
      observedSignals: {
        currentTopic: {
          value: clampText(classifiedPage.topic || "general", 80),
          state: "observed",
          source: "current_page",
        },
        currentProductFocus: classifiedPage.productFocus
          ? {
              value: clampText(classifiedPage.productFocus, 80),
              label: clampText(classifiedPage.productFocusLabel, 80),
              state: "observed",
              source: "current_page",
            }
          : undefined,
        currentSolutionFocus: classifiedPage.solutionFocus
          ? {
              value: clampText(classifiedPage.solutionFocus, 80),
              label: clampText(classifiedPage.solutionFocusLabel, 80),
              state: "observed",
              source: "current_page",
            }
          : undefined,
        eventCounts: summarizeEvents(events),
      },
      recentEvents,
      inferences: {
        persona,
        ...inferences,
      },
    };
  }

  function inferenceValue(signal) {
    if (!signal?.value) return undefined;
    if (signal.state === "inferred") {
      const confidence = Number.isFinite(signal.confidence)
        ? Math.round(signal.confidence * 100) / 100
        : 0;
      return `inferred:${signal.value}:${confidence}`;
    }
    return `${signal.state || "observed"}:${signal.value}`;
  }

  function qualifiedJourneySummary() {
    const session = rawSnapshot().session || {};
    const pages = Array.isArray(session.pages) ? session.pages : [];
    return pages
      .filter((page) => {
        const group = page.pageGroup || classifyPage(page).pageGroup;
        return (
          group === "pricing" ||
          (Number(page.dwellMs || 0) >= JOURNEY_DWELL_MS &&
            Number(page.maxScrollDepth || 0) >= JOURNEY_SCROLL_DEPTH)
        );
      })
      .slice(-6)
      .map((page) => {
        const classified = pageWithClassification(page);
        const focus =
          classified.productFocusLabel ||
          classified.solutionFocusLabel ||
          classified.topic ||
          classified.title ||
          "general";
        return `${classified.pageGroup || "page"}:${clampText(focus, 80)}:${clampText(classified.path, 160)}`;
      })
      .join(" > ");
  }

  function compileTurnContext() {
    const packet = compile();
    const priorEngagements = packet.session.engagementHistory
      .map((item) => `${item.messageGoal}:${item.status}`)
      .join(" | ");

    const context = {
      context_schema: "AlgoliaTurnContext.v1",
      persona: inferenceValue(packet.profile.persona),
      current_page: packet.currentPage.path,
      current_page_group: packet.currentPage.pageGroup,
      current_topic: inferenceValue(packet.observedSignals.currentTopic),
      current_product_focus: inferenceValue(packet.observedSignals.currentProductFocus),
      current_product_focus_label: packet.currentPage.productFocusLabel,
      current_solution_focus: inferenceValue(packet.observedSignals.currentSolutionFocus),
      current_solution_focus_label: packet.currentPage.solutionFocusLabel,
      session_page_count: String(packet.session.pageCount || 0),
      qualified_journey: qualifiedJourneySummary() || undefined,
      prior_engagements: priorEngagements || undefined,
      intent: inferenceValue(packet.inferences.intent),
      friction: inferenceValue(packet.inferences.friction),
      next_best_action: inferenceValue(packet.inferences.nextBestAction),
      instruction:
        "Use confirmed/observed context as context, phrase inferred context softly, never expose telemetry.",
    };

    return enforceTurnContextLimits(context);
  }

  function failTurnContext(code, field, actualBytes, limitBytes) {
    const error = new Error(
      `${code}: ${field || "turnContext"} is ${actualBytes} bytes; limit is ${limitBytes}`
    );
    error.name = "TurnContextValidationError";
    error.code = code;
    error.field = field || null;
    error.actualBytes = actualBytes;
    error.limitBytes = limitBytes;
    const record = {
      code,
      field: field || null,
      actualBytes,
      limitBytes,
      at: Date.now(),
      path: currentPath(),
    };
    try {
      sessionStorage.setItem(VALIDATION_ERROR_KEY, JSON.stringify(record));
    } catch {}
    debugLog("turnContext rejected", record);
    throw error;
  }

  function enforceTurnContextLimits(input) {
    const output = {};
    const entries = Object.entries(input || {}).filter(
      ([, value]) => value !== undefined && value !== null && String(value) !== ""
    );
    if (entries.length > MAX_TURN_CONTEXT_KEYS) {
      failTurnContext(
        "turn_context_too_many_keys",
        entries[MAX_TURN_CONTEXT_KEYS]?.[0] || null,
        entries.length,
        MAX_TURN_CONTEXT_KEYS
      );
    }
    for (const [key, value] of entries) {
      if (!/^[a-zA-Z0-9_.-]{1,64}$/.test(key)) {
        failTurnContext("turn_context_invalid_key", key, byteLength(key), 64);
      }
      if (value === undefined || value === null) continue;
      const text = String(value);
      if (!text) continue;
      const valueBytes = byteLength(text);
      if (valueBytes > MAX_TURN_CONTEXT_VALUE_BYTES) {
        failTurnContext(
          "turn_context_value_too_large",
          key,
          valueBytes,
          MAX_TURN_CONTEXT_VALUE_BYTES
        );
      }
      const candidate = { ...output, [key]: text };
      const totalBytes = byteLength(JSON.stringify(candidate));
      if (totalBytes > MAX_TURN_CONTEXT_BYTES) {
        failTurnContext(
          "turn_context_total_too_large",
          key,
          totalBytes,
          MAX_TURN_CONTEXT_BYTES
        );
      }
      output[key] = text;
    }
    try {
      sessionStorage.removeItem(VALIDATION_ERROR_KEY);
    } catch {}
    return output;
  }

  function mergeTurnContext(existing) {
    return enforceTurnContextLimits({
      ...(existing && typeof existing === "object" ? existing : {}),
      ...compileTurnContext(),
    });
  }

  function isAgentStudioCompletion(url) {
    try {
      const text = typeof url === "string" ? url : url?.url || "";
      return AGENT_STUDIO_COMPLETIONS_RE.test(text);
    } catch {
      return false;
    }
  }

  function injectTurnContextIntoBody(body) {
    if (typeof body !== "string") return body;
    let payload;
    try {
      payload = JSON.parse(body);
    } catch {
      return body;
    }
    if (!Array.isArray(payload.messages)) return body;

    const index = [...payload.messages].map((message, i) => ({ message, i }))
      .reverse()
      .find(({ message }) => message?.role === "user")?.i;
    if (index === undefined) return body;

    const turnContext = mergeTurnContext(payload.messages[index].metadata?.turnContext);
    payload.messages[index] = {
      ...payload.messages[index],
      metadata: {
        ...(payload.messages[index].metadata || {}),
        turnContext,
      },
    };
    debugLog("injected turnContext", turnContext);
    return JSON.stringify(payload);
  }

  function installFetchInterceptor() {
    if (typeof window.fetch !== "function") return false;
    if (patchedFetch && window.fetch === patchedFetch) return false;
    originalFetch = window.fetch;
    patchedFetch = function algoliaContextFetch(input, init = {}) {
      if (!isAgentStudioCompletion(input)) {
        return originalFetch.apply(this, arguments);
      }
      const nextInit = { ...(init || {}) };
      nextInit.body = injectTurnContextIntoBody(nextInit.body);
      return originalFetch.call(this, input, nextInit);
    };
    window.fetch = patchedFetch;
    return true;
  }

  function uninstallFetchInterceptor() {
    if (!originalFetch || !patchedFetch) return false;
    window.fetch = originalFetch;
    originalFetch = null;
    patchedFetch = null;
    return true;
  }

  function debug() {
    const raw = rawSnapshot();
    const compiled = compile();
    const turnContext = compileTurnContext();
    const result = { raw, compiled, turnContext };
    debugLog("debug", result);
    return result;
  }

  const api = {
    configure,
    compile,
    compileTurnContext,
    mergeTurnContext,
    debug,
    installFetchInterceptor,
    uninstallFetchInterceptor,
    injectTurnContextIntoBody,
    _injectTurnContextIntoBody: injectTurnContextIntoBody,
    _canonicalJourneyTriggers: CANONICAL_JOURNEY_TRIGGERS,
  };

  window.algoliaContextCompiler = api;

  if (config.autoInstallFetchInterceptor) {
    installFetchInterceptor();
  }
})();
