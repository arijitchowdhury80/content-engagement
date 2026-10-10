(function () {
  "use strict";

  const LABEL = "[Algolia Engagement Tracker]";
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

  const DEBUG = debugFlag("algoliaEngagementDebug");

  const PROFILE_KEY = "algolia_profile";
  const SESSION_KEY = "algolia_session";
  const EVENTS_KEY = "algolia_events";
  const PROACTIVE_STATE_KEY = "algolia_proactive_state";
  const PENDING_GREETING_KEY = "algolia_pending_greeting";
  const PROACTIVE_DEBUG_KEY = "algolia_proactive_debug_log";
  const CONTEXT_VALIDATION_ERROR_KEY = "algolia_context_validation_error";
  const CONVERSATION_KEY = "algolia-chat:conversation";
  const CONVERSATION_UI_KEY = "algolia-chat:conversation-ui";
  const HANDOFF_CONTEXT_KEY = "algolia-chat:handoff-context";
  const TOKEN_KEY = "algolia_token";
  const SESSION_STATE_KEYS = [
    SESSION_KEY,
    EVENTS_KEY,
    TOKEN_KEY,
    PROACTIVE_STATE_KEY,
    PENDING_GREETING_KEY,
    PROACTIVE_DEBUG_KEY,
    CONTEXT_VALIDATION_ERROR_KEY,
    CONVERSATION_KEY,
    CONVERSATION_UI_KEY,
    HANDOFF_CONTEXT_KEY,
  ];
  const LEGACY_VISITOR_STATE_KEYS = [
    "acs_profile",
    "acs_session",
    "acs_events",
    "acs_pending_greeting",
    "acs_token",
    "acs_user_token",
  ];
  const RESET_QUERY_PARAM = "algoliaProactiveReset";
  const RESET_DEDUPE_MS = 1000;

  const PROFILE_SCHEMA = "AlgoliaEngagementProfile.v1";
  const SESSION_SCHEMA = "AlgoliaEngagementSession.v1";
  const EVENTS_SCHEMA = "AlgoliaEngagementEvents.v1";

  const SESSION_TTL_MS = 30 * 60 * 1000;
  const MAX_EVENTS = 100;
  const MAX_PAGES = 40;
  const MAX_ENGAGEMENTS = 20;
  const MAX_TEXT = 120;
  const DWELL_MILESTONES_MS = [3000, 10000, 15000];
  const SCROLL_MILESTONES = [30, 50, 75, 100];
  const SAFE_UTM_KEYS = [
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_content",
    "utm_term",
  ];
  const REDACTED_PROP_PATTERN =
    /email|phone|password|passwd|token|secret|api[_-]?key|credential|name|company|value/i;

  let config = {};
  let consentAdapter = null;
  let session = null;
  let currentPageId = null;
  let currentPageStartedAt = Date.now();
  let currentPageVisibleStartedAt = null;
  let currentPageVisibleDwellMs = 0;
  let dwellMilestoneTimers = [];
  let reachedDwellMilestones = new Set();
  let currentScrollMilestone = 0;
  let routeWatchInstalled = false;
  let clickWatchInstalled = false;
  let formWatchInstalled = false;
  let searchWatchInstalled = false;
  let chatWatchInstalled = false;
  let explicitUserToken = null;
  let lastResetAt = 0;
  let lastResetReceipt = null;

  function debug(...args) {
    if (DEBUG) console.log(LABEL, ...args);
  }

  function readWindowConfig() {
    try {
      const value = window.ALGOLIA_VISITOR_CONFIG;
      return value && typeof value === "object" ? value : {};
    } catch {
      return {};
    }
  }

  function configure(nextConfig) {
    config = { ...config, ...(nextConfig || {}) };
    debug("configured", {
      ...config,
      dwellMilestonesMs: [...DWELL_MILESTONES_MS],
      scrollMilestones: [...SCROLL_MILESTONES],
    });
  }

  function isAllowed() {
    if (!consentAdapter) return true;
    try {
      return consentAdapter.isAllowed();
    } catch {
      return false;
    }
  }

  function setConsentAdapter(adapter) {
    consentAdapter = adapter;
    if (adapter && typeof adapter.onConsentChange === "function") {
      adapter.onConsentChange(() => {
        if (!isAllowed()) return;
        initializeState();
        track("consent_change", { allowed: true, source: "adapter" });
      });
    }
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
    if (!isAllowed()) return;
    try {
      if (value === null) storage.removeItem(key);
      else storage.setItem(key, JSON.stringify(value));
    } catch {
      // Storage can be unavailable in private modes; the tracker must not break the page.
    }
  }

  function readProfile() {
    return readJson(localStorage, PROFILE_KEY, null) || {
      schema: PROFILE_SCHEMA,
      visitorId: null,
      userToken: null,
      tokenSource: null,
      firstSeenAt: null,
      lastSeenAt: null,
      visits: 0,
      persona: null,
    };
  }

  function writeProfile(profile) {
    writeJson(localStorage, PROFILE_KEY, profile);
  }

  function readEventsEnvelope() {
    const fallback = { schema: EVENTS_SCHEMA, sessionId: null, events: [] };
    const value = readJson(sessionStorage, EVENTS_KEY, fallback);
    return {
      schema: value.schema || EVENTS_SCHEMA,
      sessionId: value.sessionId || session?.sessionId || null,
      events: Array.isArray(value.events) ? value.events : [],
    };
  }

  function writeEventsEnvelope(envelope) {
    writeJson(sessionStorage, EVENTS_KEY, {
      schema: EVENTS_SCHEMA,
      sessionId: envelope.sessionId || session?.sessionId || null,
      events: (envelope.events || []).slice(-MAX_EVENTS),
    });
  }

  function readSession() {
    return readJson(sessionStorage, SESSION_KEY, null);
  }

  function writeSession(nextSession) {
    session = {
      ...nextSession,
      schema: SESSION_SCHEMA,
      lastSeenAt: Date.now(),
    };
    writeJson(sessionStorage, SESSION_KEY, session);
  }

  function getCookie(name) {
    try {
      const entry = document.cookie
        .split(";")
        .find((part) => part.trim().startsWith(`${name}=`));
      return entry ? decodeURIComponent(entry.trim().slice(name.length + 1)) : null;
    } catch {
      return null;
    }
  }

  function id(prefix) {
    try {
      const array = new Uint8Array(12);
      crypto.getRandomValues(array);
      return `${prefix}_${Array.from(array, (byte) =>
        byte.toString(16).padStart(2, "0")
      ).join("")}`;
    } catch {
      return `${prefix}_${Math.random().toString(16).slice(2)}${Date.now().toString(16)}`;
    }
  }

  function getUserToken() {
    if (explicitUserToken) return { token: explicitUserToken, source: "override" };
    if (config.cookieName) {
      const token = getCookie(config.cookieName);
      if (token) return { token, source: "cookie" };
    }

    let token = null;
    try {
      token = sessionStorage.getItem(TOKEN_KEY);
      if (!token) {
        token = id("tok");
        sessionStorage.setItem(TOKEN_KEY, token);
      }
    } catch {
      token = id("tok");
    }
    return { token, source: "ephemeral" };
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function truncate(value, maxLength = MAX_TEXT) {
    if (value === undefined || value === null) return undefined;
    const text = redactSensitiveText(String(value).replace(/\s+/g, " ").trim());
    if (!text) return undefined;
    return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text;
  }

  function redactSensitiveText(value) {
    return String(value)
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]")
      .replace(/\b(?:\+?\d[\d .()/-]{7,}\d)\b/g, "[redacted-phone]")
      .replace(/\b(?:sk|key|token|secret)[_-]?[A-Z0-9_-]{12,}\b/gi, "[redacted-secret]");
  }

  function safeUrl(value) {
    if (!value) return undefined;
    try {
      const url = new URL(value, location.origin);
      return `${url.origin}${url.pathname}`;
    } catch {
      return undefined;
    }
  }

  function safeHrefFromElement(element) {
    const href = element?.getAttribute?.("href") || element?.href;
    return safeUrl(href);
  }

  function currentUrl() {
    return safeUrl(location.href);
  }

  function currentUtm() {
    const search = new URLSearchParams(location.search || "");
    const utm = {};
    for (const key of SAFE_UTM_KEYS) {
      const value = truncate(search.get(key), 80);
      if (value) utm[key] = value;
    }
    return Object.keys(utm).length ? utm : undefined;
  }

  function sanitizeProps(props) {
    const clean = {};
    for (const [key, value] of Object.entries(props || {})) {
      if (REDACTED_PROP_PATTERN.test(key)) continue;
      if (value === undefined || value === null) continue;
      if (typeof value === "string") clean[key] = truncate(value);
      else if (typeof value === "number" || typeof value === "boolean") clean[key] = value;
      else if (Array.isArray(value)) clean[key] = value.slice(0, 10).map((item) => truncate(item));
      else if (typeof value === "object") clean[key] = sanitizeProps(value);
    }
    return clean;
  }

  function explicitPageClassification() {
    const metadata = {
      ...(document.documentElement?.dataset || {}),
      ...(document.body?.dataset || {}),
    };
    const pageGroup = truncate(metadata.algoliaPageGroup, 40);
    const topic = truncate(metadata.algoliaTopic, 80);
    if (!pageGroup || !topic) return null;

    const classification = { pageGroup, topic };
    const productFocus = truncate(metadata.algoliaProductFocus, 80);
    const productFocusLabel = truncate(metadata.algoliaProductFocusLabel, 120);
    const solutionFocus = truncate(metadata.algoliaSolutionFocus, 80);
    const solutionFocusLabel = truncate(metadata.algoliaSolutionFocusLabel, 120);
    if (productFocus) classification.productFocus = productFocus;
    if (productFocusLabel) classification.productFocusLabel = productFocusLabel;
    if (solutionFocus) classification.solutionFocus = solutionFocus;
    if (solutionFocusLabel) classification.solutionFocusLabel = solutionFocusLabel;
    return classification;
  }

  function pageClassification(pathname = location.pathname) {
    const explicit = explicitPageClassification();
    if (explicit) return explicit;

    const path = pathname.toLowerCase();
    const text = `${path} ${document.title || ""}`.toLowerCase();

    if (path === "/" || path === "") return { pageGroup: "home", topic: "homepage" };
    if (path.includes("/pricing")) return { pageGroup: "pricing", topic: "pricing" };
    if (path.includes("/demo") || path.includes("contact-sales")) {
      return { pageGroup: "conversion", topic: "demo_request" };
    }
    if (path.includes("/customers")) {
      return { pageGroup: "customer_story", topic: topicFromText(text, "customer_proof") };
    }
    if (path.includes("/doc/") || path.includes("/docs") || path.includes("/api")) {
      return { pageGroup: "documentation", topic: topicFromText(text, "implementation") };
    }
    if (path.includes("/developers") || path.includes("/developer")) {
      return { pageGroup: "developer", topic: topicFromText(text, "developer_experience") };
    }
    if (path.includes("/products")) {
      return {
        pageGroup: "product",
        topic: topicFromText(text, "product_research"),
        ...productFocusFromText(text),
      };
    }
    if (path.includes("/industries") || path.includes("/solutions") || path.includes("/use-cases")) {
      return {
        pageGroup: "solution",
        topic: topicFromText(text, "industry_solution"),
        ...solutionFocusFromText(text),
      };
    }
    if (path.includes("/blog")) return { pageGroup: "blog", topic: topicFromText(text, "education") };
    if (path.includes("/resources")) {
      return { pageGroup: "resource", topic: topicFromText(text, "education") };
    }
    return { pageGroup: "other", topic: topicFromText(text, "general") };
  }

  function topicFromText(text, fallback) {
    if (/react[-\s]?instantsearch|instantsearch/.test(text)) return "instantsearch_implementation";
    if (/api|sdk|integration|implementation|developer/.test(text)) return "implementation";
    if (/pricing|cost|usage|rate|request|api call/.test(text)) return "pricing_and_usage";
    if (/fashion|retail|ecommerce|commerce|merchandising/.test(text)) return "commerce";
    if (/marketplace/.test(text)) return "marketplace";
    if (/ai search|neural|recommend|personalization|semantic/.test(text)) return "ai_search";
    if (/customer|case stud|roi|conversion|revenue/.test(text)) return "customer_proof";
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

  function resetSessionForDemoIfRequested() {
    try {
      if (new URLSearchParams(location.search).get(RESET_QUERY_PARAM) !== "1") return;
      clearAlgoliaSessionState();
      session = null;
      currentPageId = null;
      debug("reset Algolia session and chat state from query parameter");
    } catch {
      // Demo reset is best effort and must never break the page.
    }
  }

  function clearAlgoliaSessionState() {
    for (const key of SESSION_STATE_KEYS) sessionStorage.removeItem(key);
  }

  function initializeProfile() {
    const { token, source } = getUserToken();
    const profile = readProfile();
    const ts = Date.now();
    const nextProfile = {
      schema: PROFILE_SCHEMA,
      visitorId: profile.visitorId || id("visitor"),
      userToken: profile.userToken || token,
      tokenSource: profile.tokenSource || source,
      firstSeenAt: profile.firstSeenAt || ts,
      lastSeenAt: ts,
      visits: (profile.visits || 0) + 1,
      persona: profile.persona || null,
      traits: profile.traits && typeof profile.traits === "object" ? profile.traits : {},
    };
    writeProfile(nextProfile);
    return nextProfile;
  }

  function initializeSession() {
    const existing = readSession();
    const ts = Date.now();
    const expired =
      !existing?.sessionId || !existing?.lastSeenAt || ts - existing.lastSeenAt > SESSION_TTL_MS;

    const nextSession = expired
      ? {
          schema: SESSION_SCHEMA,
          sessionId: id("sess"),
          startedAt: ts,
          lastSeenAt: ts,
          currentPageId: null,
          pages: [],
          engagementHistory: [],
        }
      : {
          schema: SESSION_SCHEMA,
          sessionId: existing.sessionId,
          startedAt: existing.startedAt || ts,
          lastSeenAt: ts,
          currentPageId: existing.currentPageId || null,
          pages: Array.isArray(existing.pages) ? existing.pages : [],
          engagementHistory: Array.isArray(existing.engagementHistory)
            ? existing.engagementHistory
            : [],
        };

    writeSession(nextSession);

    const events = readEventsEnvelope();
    if (events.sessionId !== nextSession.sessionId) {
      writeEventsEnvelope({ schema: EVENTS_SCHEMA, sessionId: nextSession.sessionId, events: [] });
    }

    return nextSession;
  }

  function initializeState() {
    if (!isAllowed()) return;
    initializeProfile();
    initializeSession();
  }

  function currentPage() {
    return session?.pages?.find((page) => page.pageId === currentPageId) || null;
  }

  function upsertCurrentPage(overrides) {
    if (!session) initializeSession();

    const existingIndex = session.pages.findIndex((page) => page.pageId === currentPageId);
    const nextPage =
      existingIndex >= 0
        ? { ...session.pages[existingIndex], ...overrides }
        : { pageId: currentPageId || id("page"), ...overrides };

    if (!currentPageId) currentPageId = nextPage.pageId;
    nextPage.pageId = currentPageId;

    const pages = [...session.pages];
    if (existingIndex >= 0) pages[existingIndex] = nextPage;
    else pages.push(nextPage);

    writeSession({
      ...session,
      currentPageId,
      pages: pages.slice(-MAX_PAGES),
    });
    return nextPage;
  }

  function track(name, props) {
    if (!isAllowed()) return null;
    if (!session) initializeSession();

    const envelope = readEventsEnvelope();
    const event = {
      eventId: id("evt"),
      name,
      ts: Date.now(),
      isoTime: nowIso(),
      sessionId: session.sessionId,
      pageId: currentPageId,
      path: location.pathname,
      source: "observed",
      props: sanitizeProps(props),
    };

    envelope.events.push(event);
    writeEventsEnvelope(envelope);
    writeSession(session);
    debug("event", name, event.props);
    emitEngagementSignal(event);
    return event;
  }

  function emitEngagementSignal(event) {
    try {
      document.dispatchEvent(
        new CustomEvent("algolia-engagement-signal", {
          detail: {
            eventId: event.eventId,
            name: event.name,
            ts: event.ts,
            pageId: event.pageId,
            path: event.path,
            props: event.props,
          },
        })
      );
    } catch {
      // The storage write is the source of truth; visual listeners are best effort.
    }
  }

  function browserNavigationType() {
    try {
      const type = performance.getEntriesByType?.("navigation")?.[0]?.type;
      if (type === "reload" || type === "back_forward") return type;
    } catch {
      // Navigation timing is optional; a normal navigation is the safe fallback.
    }
    return "navigate";
  }

  function trackPageView(navigationTypeOverride) {
    if (!isAllowed()) return;
    session = readSession() || session;
    const sourcePageId = session?.currentPageId || null;
    const sourcePage = sourcePageId
      ? session?.pages?.find((page) => page.pageId === sourcePageId) || null
      : null;
    flushPageDwell();
    clearDwellMilestoneTimers();

    currentPageId = id("page");
    currentPageStartedAt = Date.now();
    currentPageVisibleStartedAt = document.hidden ? null : currentPageStartedAt;
    currentPageVisibleDwellMs = 0;
    reachedDwellMilestones = new Set();
    currentScrollMilestone = 0;

    const navigationType = sourcePage
      ? navigationTypeOverride || browserNavigationType()
      : "initial";
    const sourcePath = sourcePage?.path || null;
    const destinationPath = location.pathname;
    const edgeId = sourcePageId ? `${sourcePageId}->${currentPageId}` : null;

    const classification = pageClassification();
    const page = upsertCurrentPage({
      pageId: currentPageId,
      path: location.pathname,
      url: currentUrl(),
      title: truncate(document.title, 160),
      referrer: safeUrl(document.referrer),
      enteredAt: currentPageStartedAt,
      dwellMs: 0,
      maxScrollDepth: 0,
      pageGroup: classification.pageGroup,
      topic: classification.topic,
      productFocus: classification.productFocus,
      productFocusLabel: classification.productFocusLabel,
      solutionFocus: classification.solutionFocus,
      solutionFocusLabel: classification.solutionFocusLabel,
      navigationType,
      sourcePageId,
      sourcePath,
      destinationPageId: currentPageId,
      destinationPath,
      edgeId,
    });

    track("page_view", {
      url: page.url,
      title: page.title,
      referrer: page.referrer,
      pageGroup: page.pageGroup,
      topic: page.topic,
      productFocus: page.productFocus,
      productFocusLabel: page.productFocusLabel,
      solutionFocus: page.solutionFocus,
      solutionFocusLabel: page.solutionFocusLabel,
      navigationType: page.navigationType,
      sourcePageId: page.sourcePageId,
      sourcePath: page.sourcePath,
      destinationPageId: page.destinationPageId,
      destinationPath: page.destinationPath,
      edgeId: page.edgeId,
      utm: currentUtm(),
    });

    scheduleDwellMilestones(page);
  }

  function visibleDwellMs(now = Date.now()) {
    if (currentPageVisibleStartedAt === null) return currentPageVisibleDwellMs;
    return currentPageVisibleDwellMs + Math.max(0, now - currentPageVisibleStartedAt);
  }

  function clearDwellMilestoneTimers() {
    for (const timer of dwellMilestoneTimers) clearTimeout(timer);
    dwellMilestoneTimers = [];
  }

  function recordDwellMilestone(page, milestone) {
    if (currentPageId !== page.pageId || reachedDwellMilestones.has(milestone)) return;
    if (visibleDwellMs() < milestone) return;
    reachedDwellMilestones.add(milestone);
    updatePageDwell();
    track("page_dwell", {
      dwellSeconds: Math.round(milestone / 1000),
      pageGroup: page.pageGroup,
      topic: page.topic,
      productFocus: page.productFocus,
      productFocusLabel: page.productFocusLabel,
      solutionFocus: page.solutionFocus,
      solutionFocusLabel: page.solutionFocusLabel,
    });
  }

  function scheduleDwellMilestones(page = currentPage()) {
    clearDwellMilestoneTimers();
    if (!page || currentPageVisibleStartedAt === null) return;
    const elapsed = visibleDwellMs();
    for (const milestone of DWELL_MILESTONES_MS) {
      if (reachedDwellMilestones.has(milestone)) continue;
      const remaining = milestone - elapsed;
      if (remaining <= 0) recordDwellMilestone(page, milestone);
      else {
        dwellMilestoneTimers.push(
          setTimeout(() => recordDwellMilestone(page, milestone), remaining)
        );
      }
    }
  }

  function updatePageDwell() {
    const page = currentPage();
    if (!page) return;
    upsertCurrentPage({ dwellMs: visibleDwellMs() });
  }

  function flushPageDwell() {
    if (!currentPageId) return;
    updatePageDwell();
  }

  function pausePageDwell() {
    if (currentPageVisibleStartedAt === null) return;
    currentPageVisibleDwellMs = visibleDwellMs();
    currentPageVisibleStartedAt = null;
    clearDwellMilestoneTimers();
    updatePageDwell();
  }

  function resumePageDwell() {
    if (!currentPageId || currentPageVisibleStartedAt !== null || document.hidden) return;
    currentPageVisibleStartedAt = Date.now();
    scheduleDwellMilestones();
  }

  function scrollPercent() {
    const bodyHeight = document.body?.scrollHeight || 0;
    const docHeight = document.documentElement?.scrollHeight || 0;
    const height = Math.max(1, bodyHeight, docHeight);
    return Math.min(100, Math.round(((window.scrollY + window.innerHeight) / height) * 100));
  }

  function handleScroll() {
    const percent = scrollPercent();
    for (const milestone of SCROLL_MILESTONES) {
      if (percent >= milestone && currentScrollMilestone < milestone) {
        currentScrollMilestone = milestone;
        const page = currentPage();
        upsertCurrentPage({ maxScrollDepth: milestone });
        track("scroll_depth", {
          depth: milestone,
          pageGroup: page?.pageGroup,
          topic: page?.topic,
          productFocus: page?.productFocus,
          productFocusLabel: page?.productFocusLabel,
          solutionFocus: page?.solutionFocus,
          solutionFocusLabel: page?.solutionFocusLabel,
        });
      }
    }
  }

  function closestElement(target, selector) {
    try {
      return target?.closest?.(selector) || null;
    } catch {
      return null;
    }
  }

  function elementLabel(element) {
    return (
      truncate(element?.getAttribute?.("aria-label")) ||
      truncate(element?.getAttribute?.("title")) ||
      truncate(element?.textContent)
    );
  }

  function isNavigationClick(anchor) {
    if (!anchor) return false;
    return !!closestElement(anchor, "nav, header, [role='navigation'], [data-nav]");
  }

  function classifyCta(anchor) {
    const href = anchor?.getAttribute?.("href") || "";
    const dataCta = anchor?.getAttribute?.("data-cta");
    if (dataCta) return dataCta;
    if (/demo|contact|sales/i.test(href)) return "demo_or_contact";
    if (/pricing/i.test(href)) return "pricing";
    if (/signup|start|trial/i.test(href)) return "trial_or_signup";
    if (/\/doc\/|\/docs|developer/i.test(href)) return "documentation";
    return null;
  }

  function handleClick(event) {
    const path = typeof event.composedPath === "function" ? event.composedPath() : [];
    const resetButton = path.find((node) =>
      /reset conversation/i.test(node?.getAttribute?.("aria-label") || "")
    );
    const chat = document.querySelector?.("algolia-chat");
    if (resetButton && chat?.hasAttribute?.("reset-visitor-state-on-logo")) {
      const logo = resetButton.querySelector?.('img[alt*="Algolia" i], img, svg');
      logo?.animate?.(
        [{ transform: "rotate(0deg)" }, { transform: "rotate(360deg)" }],
        { duration: 650, easing: "cubic-bezier(.2,.8,.2,1)" }
      );
      reset({ source: "assistant_logo" });
      return;
    }

    const target = event.target || path[0];
    const anchor = closestElement(target, "a, button, [role='button'], [data-cta], [data-nav]");
    if (!anchor) return;

    const label = elementLabel(anchor);
    const href = safeHrefFromElement(anchor);

    if (isNavigationClick(anchor)) {
      track("nav_click", {
        label,
        href,
        navGroup: truncate(anchor.getAttribute?.("data-nav") || anchor.closest?.("[data-nav]")?.getAttribute?.("data-nav")),
      });
    }

    const ctaType = classifyCta(anchor);
    if (ctaType) {
      track("cta_click", {
        ctaType,
        label,
        href,
      });
    }

    if (closestElement(anchor, "[data-search-result], .ais-Hits, .ais-InfiniteHits")) {
      track("search_result_click", {
        label,
        href,
      });
    }
  }

  function searchInputSelector() {
    return [
      "input[type='search']",
      "input[aria-label*='search' i]",
      "input[placeholder*='search' i]",
      "[role='searchbox']",
    ].join(",");
  }

  function handleSearchEvent(event) {
    const input = closestElement(event.target, searchInputSelector());
    if (!input) return;
    if (event.type === "keydown" && event.key !== "Enter") return;
    const query = truncate(input.value || input.textContent, 120);
    if (!query) return;
    track("site_search", {
      query,
      trigger: event.type === "keydown" ? "enter" : event.type,
    });
  }

  function formId(form) {
    return (
      truncate(form?.getAttribute?.("data-form")) ||
      truncate(form?.getAttribute?.("id")) ||
      "form"
    );
  }

  function fieldCategory(element) {
    const type = element?.getAttribute?.("type") || element?.tagName || "field";
    return truncate(String(type).toLowerCase(), 40);
  }

  function handleFormFocus(event) {
    const form = closestElement(event.target, "form");
    if (!form || form.__algoliaEngagementStarted) return;
    if (!form.__algoliaEngagementViewed) {
      form.__algoliaEngagementViewed = true;
      track("form_view", { formId: formId(form) });
    }
    form.__algoliaEngagementStarted = true;
    track("form_start", { formId: formId(form), fieldCategory: fieldCategory(event.target) });
  }

  function handleFormSubmit(event) {
    const form = event.target;
    if (!form?.matches?.("form")) return;
    track("form_submit", { formId: formId(form) });
  }

  function handleFormInvalid(event) {
    const form = closestElement(event.target, "form");
    if (!form) return;
    track("form_error", {
      formId: formId(form),
      fieldCategory: fieldCategory(event.target),
      errorCategory: "validation",
    });
  }

  function recordEngagement(input) {
    if (!isAllowed()) return null;
    if (!session) initializeSession();

    const engagement = {
      id: id("eng"),
      pageId: currentPageId,
      messageGoal: truncate(input?.messageGoal || input?.goal || "concierge_engagement", 80),
      shownAt: Date.now(),
      status: truncate(input?.status || "shown", 60),
    };

    const engagementHistory = [...(session.engagementHistory || []), engagement].slice(
      -MAX_ENGAGEMENTS
    );
    writeSession({ ...session, engagementHistory });

    const eventName =
      engagement.status === "dismissed"
        ? "engagement_dismissed"
        : engagement.status === "clicked"
          ? "engagement_clicked"
          : "engagement_exposed";

    track(eventName, {
      engagementId: engagement.id,
      messageGoal: engagement.messageGoal,
      status: engagement.status,
    });

    return engagement;
  }

  function setPersona(personaId) {
    const value = truncate(personaId, 60);
    if (!value) return null;
    const profile = readProfile();
    const persona = {
      value,
      state: "confirmed",
      source: "demo_selector",
      updatedAt: Date.now(),
    };
    writeProfile({ ...profile, persona, lastSeenAt: Date.now() });
    return track("persona_select", { persona: value });
  }

  function identify(userToken) {
    const value = truncate(userToken, 160);
    if (!value) return;
    explicitUserToken = value;
    const profile = readProfile();
    writeProfile({
      ...profile,
      userToken: value,
      tokenSource: "override",
      lastSeenAt: Date.now(),
    });
    debug("identified");
  }

  function snapshot() {
    const profile = readProfile();
    const currentSession = readSession() || session || {};
    const eventsEnvelope = readEventsEnvelope();
    return {
      profile,
      session: currentSession,
      events: eventsEnvelope.events,
    };
  }

  function reset(options = {}) {
    const source = options?.source || "api";
    const widgetInstanceId =
      typeof options?.widgetInstanceId === "string" && options.widgetInstanceId.trim()
        ? options.widgetInstanceId.trim()
        : null;
    const resetAt = Date.now();
    if (lastResetReceipt && resetAt - lastResetAt < RESET_DEDUPE_MS) {
      debug("duplicate reset ignored", { source, resetId: lastResetReceipt.resetId });
      return lastResetReceipt;
    }

    const previous = snapshot();
    lastResetAt = resetAt;
    writeJson(localStorage, PROFILE_KEY, null);
    try {
      clearAlgoliaSessionState();
      for (const key of LEGACY_VISITOR_STATE_KEYS) {
        localStorage.removeItem(key);
        sessionStorage.removeItem(key);
      }
    } catch {
      // ignore
    }
    clearDwellMilestoneTimers();
    session = null;
    currentPageId = null;
    currentPageStartedAt = resetAt;
    currentPageVisibleStartedAt = null;
    currentPageVisibleDwellMs = 0;
    reachedDwellMilestones = new Set();
    currentScrollMilestone = 0;
    explicitUserToken = null;
    initializeState();
    trackPageView();
    const fresh = snapshot();
    const receipt = {
      schema: "AlgoliaVisitorResetReceipt.v1",
      resetId: id("reset"),
      source,
      at: resetAt,
      origin: location.origin,
      path: location.pathname,
      previousVisitorId: previous.profile?.visitorId || null,
      previousSessionId: previous.session?.sessionId || null,
      visitorId: fresh.profile?.visitorId || null,
      sessionId: fresh.session?.sessionId || null,
      pageCount: fresh.session?.pages?.length || 0,
      eventCount: fresh.events?.length || 0,
      conversationCleared: !sessionStorage.getItem(CONVERSATION_KEY),
      handoffContextCleared: !sessionStorage.getItem(HANDOFF_CONTEXT_KEY),
    };
    if (widgetInstanceId) {
      receipt.widgetInstanceId = widgetInstanceId;
    }
    if (options?.handoffScopedResetHandled === true) {
      receipt.handoffScopedResetHandled = true;
    }
    lastResetReceipt = receipt;
    window.__algoliaVisitorResetReceipt = receipt;
    try {
      document.dispatchEvent(new CustomEvent("algolia-visitor-state-reset", {
        detail: receipt,
      }));
    } catch {
      // The reset is complete even when custom events are unavailable.
    }
    debug("visitor state reset", receipt);
    return receipt;
  }

  function registerWithChatWidget() {
    const source = {
      getProfile() {
        return readProfile();
      },
      getEvents() {
        return readEventsEnvelope().events.slice(-20);
      },
      getSessionPages() {
        return (readSession()?.pages || []).slice(-MAX_PAGES);
      },
      getSession() {
        return readSession() || {};
      },
      snapshot,
    };

    const widget = window.algoliaChat;
    if (typeof widget?.setVisitorDataSource === "function") {
      widget.setVisitorDataSource(source);
      debug("registered with window.algoliaChat");
    }

    const element = document.querySelector?.("algolia-chat");
    if (typeof element?.setVisitorDataSource === "function") {
      element.setVisitorDataSource(source);
      debug("registered with <algolia-chat>");
    }
  }

  function installRouteWatcher() {
    if (routeWatchInstalled) return;
    routeWatchInstalled = true;
    const originalPushState = history.pushState?.bind(history);
    if (originalPushState) {
      history.pushState = function (...args) {
        const result = originalPushState(...args);
        setTimeout(() => trackPageView("spa_push"), 0);
        return result;
      };
    }
    window.addEventListener("popstate", () => setTimeout(() => trackPageView("spa_pop"), 0));
    window.addEventListener("beforeunload", flushPageDwell);
    window.addEventListener("pagehide", pausePageDwell);
    window.addEventListener("pageshow", (event) => {
      if (event?.persisted) trackPageView("back_forward");
      else resumePageDwell();
    });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) pausePageDwell();
      else resumePageDwell();
    });
  }

  function installClickWatcher() {
    if (clickWatchInstalled) return;
    clickWatchInstalled = true;
    document.addEventListener("click", handleClick, true);
    window.addEventListener("scroll", handleScroll, { passive: true });
  }

  function installSearchWatcher() {
    if (searchWatchInstalled) return;
    searchWatchInstalled = true;
    document.addEventListener("change", handleSearchEvent, true);
    document.addEventListener("keydown", handleSearchEvent, true);
  }

  function installFormWatcher() {
    if (formWatchInstalled) return;
    formWatchInstalled = true;
    document.addEventListener("focusin", handleFormFocus, true);
    document.addEventListener("submit", handleFormSubmit, true);
    document.addEventListener("invalid", handleFormInvalid, true);
  }

  function installChatWatcher() {
    if (chatWatchInstalled) return;
    chatWatchInstalled = true;
    document.addEventListener("algolia-visitor-reset-requested", (event) => {
      const detailId = event?.detail?.widgetInstanceId;
      const targetId = event?.target?.__algoliaWidgetInstanceId;
      const path = typeof event?.composedPath === "function" ? event.composedPath() : [];
      const owner = path.find((node) => typeof node?.__algoliaWidgetInstanceId === "string");
      const receipt = reset({
        source: event?.detail?.source || "chat_widget",
        widgetInstanceId: typeof detailId === "string" && detailId.trim()
          ? detailId.trim()
          : typeof targetId === "string" && targetId.trim()
            ? targetId.trim()
            : owner?.__algoliaWidgetInstanceId || null,
        handoffScopedResetHandled: event?.__algoliaHandoffScopedResetHandled === true,
      });
      try {
        Object.defineProperty(event, "__algoliaVisitorResetReceipt", {
          configurable: true,
          value: receipt,
        });
      } catch {
        event.__algoliaVisitorResetReceipt = receipt;
      }
    });
    document.addEventListener("algolia-chat-open-change", (event) => {
      track("chat_open", { open: !!event.detail?.open });
    });
    document.addEventListener("algolia-chat-question", (event) => {
      track("chat_question", { source: event.detail?.source || "chat" });
    });
    document.addEventListener("algolia-chat-engaged", (event) => {
      recordEngagement({
        messageGoal: event.detail?.messageGoal || "proactive_concierge",
        status: "shown",
      });
    });
    document.addEventListener("algolia-chat-engagement-dismissed", (event) => {
      recordEngagement({
        messageGoal: event.detail?.messageGoal || "proactive_concierge",
        status: "dismissed",
      });
    });
    document.addEventListener("algolia-chat-engagement-clicked", (event) => {
      recordEngagement({
        messageGoal: event.detail?.messageGoal || "proactive_concierge",
        status: "clicked",
      });
    });
    document.addEventListener("algolia-chat:lead", () => {
      track("form_success", { formId: "lead_form" });
    });
  }

  function processQueue(existingApi) {
    if (!Array.isArray(existingApi?._queue)) return;
    for (const item of existingApi._queue) {
      const [method, args = []] = Array.isArray(item) ? item : [];
      if (method === "configure") configure(...args);
      else if (method === "identify") identify(...args);
      else if (method === "setPersona") setPersona(...args);
      else if (method === "track" || method === "trackEvent") track(...args);
      else if (method === "recordEngagement") recordEngagement(...args);
      else if (method === "setConsentAdapter") setConsentAdapter(...args);
    }
  }

  function install() {
    const root = window;
    if (root.__algoliaEngagementTrackerInstalled) return;
    root.__algoliaEngagementTrackerInstalled = true;

    const previousEngagementApi = root.algoliaEngagementTracker;
    const previousLegacyApi = root.algoliaTracker;

    configure(readWindowConfig());
    initializeState();

    const api = {
      configure,
      identify,
      setPersona,
      track,
      trackEvent: track,
      recordEngagement,
      setConsentAdapter,
      refreshProfile: readProfile,
      snapshot,
      reset,
    };

    root.algoliaEngagementTracker = api;
    root.algoliaTracker = api;

    processQueue(previousEngagementApi);
    processQueue(previousLegacyApi);

    resetSessionForDemoIfRequested();
    trackPageView();
    installRouteWatcher();
    installClickWatcher();
    installSearchWatcher();
    installFormWatcher();
    installChatWatcher();
    registerWithChatWidget();
  }

  install();
})();
