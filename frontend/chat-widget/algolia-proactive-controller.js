(function () {
  "use strict";

  const LABEL = "[Algolia Proactive Controller]";
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

  const DEBUG = debugFlag("algoliaProactiveDebug");

  const STATE_KEY = "algolia_proactive_state";
  const TRACE_KEY = "algolia_proactive_debug_log";
  const SCHEMA = "AlgoliaProactiveDecision.v1";
  const STATE_SCHEMA = "AlgoliaProactiveState.v1";
  const GREETING_REQUEST_SCHEMA = "ProactiveGreetingRequest.v1";
  const GREETING_RESPONSE_SCHEMA = "ProactiveGreetingResponse.v1";
  const COMPLETIONS_COMPATIBILITY_MODE = "ai-sdk-5";
  const BANNED_GREETING_RE =
    /\b(I noticed|I saw|based on your browsing|based on your behavior|tracking|telemetry|localStorage|sessionStorage|clickstream|hidden prompt|Agent Studio configuration)\b/i;
  const UNSUPPORTED_CLAIM_RE =
    /\b\d+%|\$\d+|\broadmap\b|\bguarantee\b|customer quote|case study:|https?:\/\//i;
  const NON_VISIBLE_OPPORTUNITY_STATUSES = new Set([
    "qualified",
    "pending",
    "failed",
  ]);
  const VISIBLE_OPPORTUNITY_STATUSES = new Set([
    "shown",
    "engaged",
    "handed_off",
    "active",
  ]);
  const REPLACEABLE_OPPORTUNITY_STATUSES = new Set([
    ...NON_VISIBLE_OPPORTUNITY_STATUSES,
    "shown",
  ]);
  const EXPIRABLE_OPPORTUNITY_STATUSES = new Set(["qualified", "pending", "shown"]);

  const DEFAULTS = {
    enabled: true,
    maxOpportunitiesPerSession: 3,
    cooldownMs: 120000,
    opportunityTtlMs: 600000,
    productDwellMs: 5000,
    productScrollDepth: 25,
    solutionDwellMs: 5000,
    solutionScrollDepth: 25,
    documentationJourneyDwellMs: 5000,
    documentationJourneyScrollDepth: 25,
    proofJourneyDwellMs: 5000,
    proofJourneyScrollDepth: 25,
    implementationDwellMs: 5000,
    implementationScrollDepth: 25,
    resourceDwellMs: 5000,
    resourceScrollDepth: 25,
    compatibilityMode: COMPLETIONS_COMPATIBILITY_MODE,
    cache: false,
    memory: false,
  };

  let config = { ...DEFAULTS };
  let activeConversationRestored = false;

  function debug(...args) {
    if (DEBUG) console.log(LABEL, ...args);
  }

  function clip(value, maxLength = 240) {
    if (value === undefined || value === null) return value;
    const text = String(value);
    return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text;
  }

  function readTrace() {
    return readJson(TRACE_KEY, []);
  }

  function writeTrace(entries) {
    if (!DEBUG) return;
    writeJson(TRACE_KEY, Array.isArray(entries) ? entries.slice(-120) : []);
  }

  function trace(stage, detail = {}) {
    if (!DEBUG) return;
    const entry = {
      stage,
      at: Date.now(),
      path: location.pathname,
      detail,
    };
    const entries = readTrace();
    entries.push(entry);
    writeTrace(entries);
    window.__algoliaProactiveTrace = entries.slice(-120);
    debug(stage, detail);
  }

  function packetSummary(packet) {
    const page = currentPage(packet);
    const pages = sessionPages(packet);
    return {
      hasPacket: !!packet,
      currentPage: page
        ? {
            path: page.path,
            pageGroup: page.pageGroup,
            topic: page.topic,
            dwellMs: page.dwellMs,
            maxScrollDepth: page.maxScrollDepth,
            productFocusLabel: page.productFocusLabel,
            solutionFocusLabel: page.solutionFocusLabel,
          }
        : null,
      pageCount: pages.length,
      recentEventCount: recentEvents(packet).length,
      productTrail: uniqueProductTrail(pages).map((item) => item.label),
      solutionTrail: uniqueSolutionTrail(pages).map((item) => item.label),
    };
  }

  function decisionSummary(decision) {
    if (!decision) return null;
    return {
      engage: decision.engage,
      reason: decision.reason,
      moment: decision.moment,
      trigger: decision.trigger,
      priority: decision.priority,
      pagePath: decision.pagePath,
      reasonCodes: decision.reasonCodes,
      opportunityId: decision.opportunityId,
    };
  }

  function configure(nextConfig) {
    config = { ...config, ...(nextConfig || {}) };
    debug("configured", config);
    trace("configured", {
      enabled: config.enabled,
      productDwellMs: config.productDwellMs,
      productScrollDepth: config.productScrollDepth,
      solutionDwellMs: config.solutionDwellMs,
      solutionScrollDepth: config.solutionScrollDepth,
      hasAppId: !!config.appId,
      hasApiKey: !!(config.apiKey || config.searchKey),
      hasGreetingsAgentId: !!(config.greetingsAgentId || config.greetingAgentId),
    });
  }

  function readJson(key, fallback) {
    try {
      const raw = sessionStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }

  function writeJson(key, value) {
    try {
      sessionStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Proactive state should never break the host page.
    }
  }

  function readState() {
    const value = readJson(STATE_KEY, null);
    return {
      schema: STATE_SCHEMA,
      opportunities: Array.isArray(value?.opportunities) ? value.opportunities : [],
      lastOpportunityAt: Number.isFinite(value?.lastOpportunityAt) ? value.lastOpportunityAt : 0,
    };
  }

  function writeState(state) {
    writeJson(STATE_KEY, {
      schema: STATE_SCHEMA,
      opportunities: state.opportunities.slice(-20),
      lastOpportunityAt: state.lastOpportunityAt || 0,
    });
  }

  function updateOpportunity(opportunityId, patch, statePatch = null) {
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
    writeState({ ...state, ...(statePatch || {}) });
    return true;
  }

  function expireStaleOpportunities(state, now = Date.now()) {
    let changed = false;
    const opportunities = state.opportunities.map((opportunity) => {
      if (!EXPIRABLE_OPPORTUNITY_STATUSES.has(opportunity.status)) return opportunity;
      const anchor = Number(
        opportunity.updatedAt || opportunity.shownAt || opportunity.createdAt || 0
      );
      if (!anchor || now - anchor < config.opportunityTtlMs) return opportunity;
      const lifecycle = Array.isArray(opportunity.lifecycle)
        ? [...opportunity.lifecycle]
        : opportunity.status
          ? [opportunity.status]
          : [];
      if (lifecycle.at(-1) !== "expired") lifecycle.push("expired");
      changed = true;
      return {
        ...opportunity,
        status: "expired",
        lifecycle,
        expiredAt: now,
        updatedAt: now,
      };
    });
    if (!changed) return state;
    const nextState = { ...state, opportunities };
    writeState(nextState);
    return nextState;
  }

  function dismissShownOpportunity(event) {
    const state = readState();
    const requestedId = event?.detail?.opportunityId;
    const index = requestedId
      ? state.opportunities.findIndex(
          (opportunity) => opportunity.id === requestedId && opportunity.status === "shown"
        )
      : state.opportunities.findLastIndex((opportunity) => opportunity.status === "shown");
    if (index < 0) return false;
    const opportunity = state.opportunities[index];
    const lifecycle = Array.isArray(opportunity.lifecycle)
      ? [...opportunity.lifecycle]
      : ["shown"];
    if (lifecycle.at(-1) !== "dismissed") lifecycle.push("dismissed");
    state.opportunities[index] = {
      ...opportunity,
      status: "dismissed",
      lifecycle,
      dismissedAt: Date.now(),
      updatedAt: Date.now(),
    };
    writeState(state);
    trace("opportunity_dismissed", { opportunityId: opportunity.id });
    return true;
  }

  function compilerPacket() {
    const compiler = window.algoliaContextCompiler;
    if (!compiler || typeof compiler.compile !== "function") return null;
    return compiler.compile();
  }

  function compilerTurnContext() {
    const compiler = window.algoliaContextCompiler;
    if (!compiler || typeof compiler.compileTurnContext !== "function") return {};
    return compiler.compileTurnContext();
  }

  function currentPage(packet) {
    return packet?.currentPage || {};
  }

  function sessionPages(packet) {
    return Array.isArray(packet?.session?.pages)
      ? packet.session.pages
      : readJson("algolia_session", {}, sessionStorage).pages || [];
  }

  function recentEvents(packet) {
    return Array.isArray(packet?.recentEvents) ? packet.recentEvents : [];
  }

  function pageGroup(page) {
    return String(page?.pageGroup || "").toLowerCase();
  }

  function topic(page) {
    return String(page?.topic || "").toLowerCase();
  }

  function isProduct(page) {
    return pageGroup(page) === "product" || String(page?.path || "").includes("/products");
  }

  function isSolution(page) {
    const path = String(page?.path || "");
    return pageGroup(page) === "solution" || path.includes("/solutions") || path.includes("/industries");
  }

  function isDeveloper(page) {
    const group = pageGroup(page);
    const path = String(page?.path || "");
    return group === "developer" || group === "documentation" || path.includes("/developers") || path.includes("/doc/");
  }

  function isDocumentation(page) {
    const group = pageGroup(page);
    const path = String(page?.path || "");
    return group === "documentation" || path.includes("/doc/");
  }

  function isResource(page) {
    const group = pageGroup(page);
    const path = String(page?.path || "");
    return (
      group === "resource" ||
      /\/(resources|reports|guides|research|infographics)(\/|$)/.test(path)
    );
  }

  function isPricing(page) {
    const group = pageGroup(page);
    const path = String(page?.path || "").toLowerCase();
    return group === "pricing" || /(^|\/)pricing(?:\/|$)/.test(path);
  }

  function isCustomerStory(page) {
    return pageGroup(page) === "customer_story" || String(page?.path || "").includes("/customers/");
  }

  function qualifies(page, dwellMs, scrollDepth) {
    return (
      Number(page?.dwellMs || 0) >= dwellMs &&
      Number(page?.maxScrollDepth || 0) >= scrollDepth
    );
  }

  function hasRecentEvent(events, name) {
    return events.some((event) => event.name === name);
  }

  function chatIsOpen(events) {
    const latestChatIndex = events.findLastIndex((event) => event.name === "chat_open");
    if (latestChatIndex < 0) return false;
    const latestPageIndex = events.findLastIndex((event) => event.name === "page_view");
    if (latestPageIndex > latestChatIndex) return false;
    return events[latestChatIndex].props?.open !== false;
  }

  function conversationIsActive() {
    try {
      const snapshot = JSON.parse(sessionStorage.getItem("algolia-chat:conversation") || "null");
      return snapshot?.version === 1 && Array.isArray(snapshot.turns) && snapshot.turns.length > 0;
    } catch {
      return false;
    }
  }

  function latestChatOpenState(events) {
    const latest = [...events].reverse().find((event) => event.name === "chat_open");
    return latest ? latest.props?.open !== false : null;
  }

  function restoreActiveConversation(packet) {
    if (activeConversationRestored || !conversationIsActive()) return false;
    if (latestChatOpenState(recentEvents(packet)) !== true) return false;
    const widget = chatElement();
    if (!widget || typeof widget.open !== "function") return false;
    widget.open();
    activeConversationRestored = true;
    trace("active_conversation_restored", { path: location.pathname });
    return true;
  }

  function isJourneyTransition(decision) {
    return String(decision?.trigger || "").includes("_to_");
  }

  function hasCompletedHandoff(state) {
    return state.opportunities.some((item) =>
      item.status === "engaged" || item.status === "handed_off" || item.status === "active"
    );
  }

  function chatElement() {
    return document.querySelector("algolia-chat");
  }

  function attr(element, names) {
    for (const name of names) {
      const value = element?.getAttribute?.(name);
      if (value && String(value).trim()) return String(value).trim();
    }
    return null;
  }

  function credentials() {
    const search = document.querySelector("algolia-instant-search");
    const chat = chatElement();
    const engage = document.querySelector("algolia-chat-engage");
    const legacyEngageConfig =
      window.ALGOLIA_CONTEXT_ENGINE_CONFIG && typeof window.ALGOLIA_CONTEXT_ENGINE_CONFIG === "object"
        ? window.ALGOLIA_CONTEXT_ENGINE_CONFIG
        : {};
    const proactiveConfig =
      window.ALGOLIA_PROACTIVE_CONFIG && typeof window.ALGOLIA_PROACTIVE_CONFIG === "object"
        ? window.ALGOLIA_PROACTIVE_CONFIG
        : {};
    const appId =
      config.appId ||
      proactiveConfig.appId ||
      attr(search, ["app-id", "application-id"]) ||
      attr(chat, ["app-id", "application-id"]) ||
      null;
    const apiKey =
      config.apiKey ||
      config.searchKey ||
      proactiveConfig.apiKey ||
      proactiveConfig.searchKey ||
      attr(search, ["api-key", "search-api-key"]) ||
      attr(chat, ["api-key", "search-api-key"]) ||
      null;
    const engageGreetingAgentId = attr(engage, [
      "greetings-agent-id",
      "greeting-agent-id",
      "concierge-agent-id",
    ]);
    const greetingsAgentId =
      config.greetingsAgentId ||
      config.greetingAgentId ||
      proactiveConfig.greetingsAgentId ||
      proactiveConfig.greetingAgentId ||
      proactiveConfig.conciergeAgentId ||
      legacyEngageConfig.greetingsAgentId ||
      legacyEngageConfig.greetingAgentId ||
      legacyEngageConfig.conciergeAgentId ||
      engageGreetingAgentId ||
      null;
    return {
      appId,
      apiKey,
      greetingsAgentId,
      sources: {
        appId: config.appId || proactiveConfig.appId ? "config" : search ? "algolia-instant-search" : chat ? "algolia-chat" : null,
        apiKey:
          config.apiKey || config.searchKey || proactiveConfig.apiKey || proactiveConfig.searchKey
            ? "config"
            : search
              ? "algolia-instant-search"
              : chat
                ? "algolia-chat"
                : null,
        greetingsAgentId:
          config.greetingsAgentId ||
          config.greetingAgentId ||
          proactiveConfig.greetingsAgentId ||
          proactiveConfig.greetingAgentId ||
          proactiveConfig.conciergeAgentId
            ? "config"
            : legacyEngageConfig.greetingsAgentId ||
                legacyEngageConfig.greetingAgentId ||
                legacyEngageConfig.conciergeAgentId
              ? "ALGOLIA_CONTEXT_ENGINE_CONFIG"
              : engageGreetingAgentId
                ? "algolia-chat-engage"
                : null,
      },
    };
  }

  function agentCompletionUrl(agentId, appId) {
    const params = new URLSearchParams({
      compatibilityMode: config.compatibilityMode || COMPLETIONS_COMPATIBILITY_MODE,
      cache: String(config.cache === true),
      memory: String(config.memory === true),
    });
    return `https://${appId}.algolia.net/agent-studio/1/agents/${agentId}/completions?${params.toString()}`;
  }

  function priorPage(pages, predicate) {
    return [...pages].slice(0, -1).reverse().find(predicate) || null;
  }

  function visibleOpportunities(state) {
    return state.opportunities.filter((opportunity) =>
      VISIBLE_OPPORTUNITY_STATUSES.has(opportunity.status)
    );
  }

  function visibleOpportunityTime(opportunity) {
    return Number(opportunity?.shownAt || opportunity?.handoffAt || opportunity?.updatedAt || 0);
  }

  function lastVisibleOpportunityAt(state) {
    return visibleOpportunities(state).reduce(
      (latest, opportunity) => Math.max(latest, visibleOpportunityTime(opportunity)),
      0
    );
  }

  function replaceableOpportunity(opportunity, decision) {
    if (!opportunity || !decision) return false;
    if (!REPLACEABLE_OPPORTUNITY_STATUSES.has(opportunity.status)) return false;
    if (opportunity.pageId === decision.pageId) return false;
    return Number(decision.priority || 0) > Number(opportunity.priority || 0);
  }

  function latestVisibleOpportunity(state) {
    return visibleOpportunities(state).reduce((latest, opportunity) => {
      if (!latest) return opportunity;
      return visibleOpportunityTime(opportunity) >= visibleOpportunityTime(latest)
        ? opportunity
        : latest;
    }, null);
  }

  function canSupersedeRecentOpportunity(state, decision) {
    return replaceableOpportunity(latestVisibleOpportunity(state), decision);
  }

  function supersedeLowerPriorityOpportunities(state, decision) {
    if (!canSupersedeRecentOpportunity(state, decision)) return state;
    return {
      ...state,
      opportunities: state.opportunities.map((opportunity) =>
        replaceableOpportunity(opportunity, decision)
          ? {
              ...opportunity,
              status: "superseded",
              lifecycle: [
                ...(Array.isArray(opportunity.lifecycle)
                  ? opportunity.lifecycle
                  : opportunity.status
                    ? [opportunity.status]
                    : []),
                ...(opportunity.lifecycle?.at(-1) === "superseded" ? [] : ["superseded"]),
              ],
              supersededByTrigger: decision.trigger,
              updatedAt: Date.now(),
            }
          : opportunity
      ),
    };
  }

  function productFocus(page) {
    const value = String(page?.productFocus || "").trim();
    if (!value) return null;
    return {
      value,
      label: String(page?.productFocusLabel || value).trim(),
      state: "observed",
      source: isProduct(page) ? "current_product_page" : "prior_product_page",
      pagePath: page?.path || null,
      pageTitle: page?.title || null,
    };
  }

  function cleanFocusLabel(text) {
    const value = String(text || "")
      .replace(/^\/?(solutions|industries)\//i, "")
      .split(/[?#]/)[0]
      .split("/")
      .filter(Boolean)
      .at(-1);
    if (!value) return "";
    return value
      .replace(/[-_]+/g, " ")
      .replace(/\b\w/g, (char) => char.toUpperCase())
      .trim();
  }

  function solutionFocus(page) {
    const explicit = String(page?.solutionFocus || "").trim();
    if (!explicit && !isSolution(page)) return null;
    const label = String(page?.solutionFocusLabel || "").trim();
    const fallbackLabel = label || cleanFocusLabel(page?.title) || cleanFocusLabel(page?.path);
    const value = explicit || fallbackLabel.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
    if (!value || !fallbackLabel) return null;
    return {
      value,
      label: fallbackLabel,
      type: "solution",
      state: "observed",
      source: isSolution(page) ? "current_solution_page" : "prior_solution_page",
      pagePath: page?.path || null,
      pageTitle: page?.title || null,
    };
  }

  function contextualFocusFor(packet) {
    const page = currentPage(packet);
    const currentFocus = productFocus(page);
    if (currentFocus) return currentFocus;
    const currentSolutionFocus = solutionFocus(page);
    if (currentSolutionFocus) return currentSolutionFocus;
    const priorProduct = priorPage(sessionPages(packet), isProduct);
    const priorFocus = productFocus(priorProduct);
    if (priorFocus) return { ...priorFocus, source: "prior_product_page" };
    const priorSolution = priorPage(sessionPages(packet), isSolution);
    const priorSolutionFocus = solutionFocus(priorSolution);
    return priorSolutionFocus ? { ...priorSolutionFocus, source: "prior_solution_page" } : null;
  }

  function uniqueProductTrail(pages) {
    const seen = new Set();
    return pages
      .filter(isProduct)
      .map(productFocus)
      .filter(Boolean)
      .filter((focus) => {
        if (seen.has(focus.value)) return false;
        seen.add(focus.value);
        return true;
      })
      .map((focus) => ({
        value: focus.value,
        label: focus.label,
        pagePath: focus.pagePath,
        pageTitle: focus.pageTitle,
      }))
      .slice(-5);
  }

  function uniqueSolutionTrail(pages) {
    const seen = new Set();
    return pages
      .filter(isSolution)
      .map(solutionFocus)
      .filter(Boolean)
      .filter((focus) => {
        if (seen.has(focus.value)) return false;
        seen.add(focus.value);
        return true;
      })
      .map((focus) => ({
        value: focus.value,
        label: focus.label,
        pagePath: focus.pagePath,
        pageTitle: focus.pageTitle,
      }))
      .slice(-5);
  }

  function humanList(items) {
    const values = items.map((item) => item?.label || item?.value).filter(Boolean);
    if (values.length <= 1) return values[0] || "";
    if (values.length === 2) return `${values[0]} and ${values[1]}`;
    return `${values.slice(0, -1).join(", ")}, and ${values.at(-1)}`;
  }

  function journeySummaryFor(packet, fields) {
    const pages = sessionPages(packet);
    const productTrail = uniqueProductTrail(pages);
    const solutionTrail = uniqueSolutionTrail(pages);
    const currentTransition = fields.trigger || null;
    let storyHint = "";
    const productList = humanList(productTrail);
    const solutionList = humanList(solutionTrail);

    if (currentTransition === "product_to_pricing" && productTrail.length > 1) {
      storyHint = `The visitor explored ${productList} before pricing; frame this as a cost/value question across those capabilities.`;
    } else if (currentTransition === "product_to_pricing" && productTrail.length === 1) {
      storyHint = `The visitor moved from ${productList} into pricing; frame this as a ${productList} cost/value question.`;
    } else if (fields.trigger === "product_to_documentation" && productTrail.length) {
      storyHint = `The visitor moved from ${productList} into documentation; frame this as technical validation of that product interest.`;
    } else if (currentTransition === "solution_to_pricing" && solutionTrail.length > 1) {
      storyHint = `The visitor explored ${solutionList} before pricing; frame this as a commercial evaluation across those solution areas.`;
    } else if (currentTransition === "solution_to_pricing" && solutionTrail.length === 1) {
      storyHint = `The visitor moved from ${solutionList} into pricing; frame this as a ${solutionList} value and cost question.`;
    } else if (fields.trigger === "solution_to_customer_story" && solutionTrail.length) {
      storyHint = `The visitor moved from ${solutionList} to customer proof; connect proof back to that solution interest.`;
    }

    return {
      currentTransition,
      productTrail,
      solutionTrail,
      pageTrail: pages
        .map((item) => ({
          path: item.path,
          title: item.title,
          pageGroup: item.pageGroup,
          topic: item.topic,
          productFocusLabel: item.productFocusLabel,
          solutionFocusLabel: item.solutionFocusLabel,
        }))
        .slice(-6),
      storyHint,
    };
  }

  function baseDecision(packet, fields) {
    const page = currentPage(packet);
    const events = recentEvents(packet);
    return {
      schema: SCHEMA,
      engage: true,
      createdAt: Date.now(),
      pageId: page.pageId || null,
      pagePath: page.path || location.pathname,
      source: "browser_deterministic",
      reasonCodes: [],
      agentPromptPacket: {
        schema: GREETING_REQUEST_SCHEMA,
        moment: fields.moment,
        trigger: fields.trigger,
        priority: fields.priority,
        persona: packet?.profile?.persona || null,
        currentPage: page,
        contextualFocus: contextualFocusFor(packet),
        journeySummary: journeySummaryFor(packet, fields),
        journey: sessionPages(packet).map((item) => ({
          path: item.path,
          title: item.title,
          pageGroup: item.pageGroup,
          topic: item.topic,
          productFocus: item.productFocus,
          productFocusLabel: item.productFocusLabel,
          solutionFocus: item.solutionFocus,
          solutionFocusLabel: item.solutionFocusLabel,
          dwellMs: item.dwellMs,
          maxScrollDepth: item.maxScrollDepth,
        })),
        observedSignals: events.map((event) => ({
          name: event.name,
          path: event.path,
          props: event.props,
        })),
        inferredIntent: packet?.inferences?.intent || null,
        friction: packet?.inferences?.friction || null,
        messageGoal: fields.messageGoal,
        source: "browser_deterministic",
        tone: "sharp, useful, warm, lightly witty",
        constraints: {
          noTelemetryExposure: true,
          includeQuestionChips: true,
        },
      },
      ...fields,
    };
  }

  function withReasons(decision, reasonCodes) {
    return {
      ...decision,
      reasonCodes,
      agentPromptPacket: {
        ...decision.agentPromptPacket,
        reasonCodes,
      },
    };
  }

  function candidates(packet) {
    const page = currentPage(packet);
    const pages = sessionPages(packet);
    const result = [];
    const previousProduct = priorPage(
      pages,
      (item) => isProduct(item) && qualifies(item, config.productDwellMs, config.productScrollDepth)
    );
    const previousSolution = priorPage(
      pages,
      (item) => isSolution(item) && qualifies(item, config.solutionDwellMs, config.solutionScrollDepth)
    );
    const previousPricingSource = priorPage(
      pages,
      (item) =>
        (isProduct(item) && qualifies(item, config.productDwellMs, config.productScrollDepth)) ||
        (isSolution(item) && qualifies(item, config.solutionDwellMs, config.solutionScrollDepth))
    );

    if (isPricing(page) && previousPricingSource) {
      const fromProduct = isProduct(previousPricingSource);
      result.push(
        withReasons(
          baseDecision(packet, {
            moment: "commercial_evaluation",
            trigger: fromProduct ? "product_to_pricing" : "solution_to_pricing",
            priority: fromProduct ? 88 : 87,
            messageGoal: fromProduct ? "explain_cost_drivers" : "explain_solution_value_and_cost",
          }),
          [
            fromProduct ? "journey_product_to_pricing" : "journey_solution_to_pricing",
            "pricing_page_view",
          ]
        )
      );
    }

    if (
      isDocumentation(page) &&
      previousProduct &&
      qualifies(
        page,
        config.documentationJourneyDwellMs,
        config.documentationJourneyScrollDepth
      )
    ) {
      result.push(
        withReasons(
          baseDecision(packet, {
            moment: "implementation_research",
            trigger: "product_to_documentation",
            priority: 85,
            messageGoal: "connect_product_interest_to_implementation",
          }),
          ["journey_product_to_documentation", "documentation_depth"]
        )
      );
    }

    if (
      isCustomerStory(page) &&
      previousSolution &&
      qualifies(page, config.proofJourneyDwellMs, config.proofJourneyScrollDepth)
    ) {
      result.push(
        withReasons(
          baseDecision(packet, {
            moment: "customer_proof",
            trigger: "solution_to_customer_story",
            priority: 81,
            messageGoal: "surface_relevant_customer_proof",
          }),
          ["journey_solution_to_customer_story", "customer_story_page"]
        )
      );
    }

    if (
      isDeveloper(page) &&
      qualifies(page, config.implementationDwellMs, config.implementationScrollDepth)
    ) {
      result.push(
        withReasons(
          baseDecision(packet, {
            moment: "implementation_research",
            trigger: "developer_page_10s_50_scroll",
            priority: 76,
            messageGoal: "reduce_implementation_uncertainty",
          }),
          ["developer_page", "implementation_dwell", "implementation_scroll"]
        )
      );
    }

    if (
      isResource(page) &&
      qualifies(page, config.resourceDwellMs, config.resourceScrollDepth)
    ) {
      result.push(
        withReasons(
          baseDecision(packet, {
            moment: "resource_research",
            trigger: "resource_page_10s_50_scroll",
            priority: 75,
            messageGoal: "connect_resource_insight_to_next_step",
          }),
          ["resource_page", "resource_dwell", "resource_scroll"]
        )
      );
    }

    if (
      isProduct(page) &&
      Number(page.dwellMs || 0) >= config.productDwellMs &&
      Number(page.maxScrollDepth || 0) >= config.productScrollDepth
    ) {
      result.push(
        withReasons(
          baseDecision(packet, {
            moment: "product_research",
            trigger: "product_page_10s_50_scroll",
            priority: 66,
            messageGoal: "explain_product_fit",
          }),
          ["product_page", "product_dwell", "product_scroll"]
        )
      );
    }

    if (
      isSolution(page) &&
      Number(page.dwellMs || 0) >= config.solutionDwellMs &&
      Number(page.maxScrollDepth || 0) >= config.solutionScrollDepth
    ) {
      result.push(
        withReasons(
          baseDecision(packet, {
            moment: "solution_research",
            trigger: "solution_page_10s_50_scroll",
            priority: 65,
            messageGoal: "explain_solution_fit",
          }),
          ["solution_page", "solution_dwell", "solution_scroll"]
        )
      );
    }

    return result.sort((left, right) => right.priority - left.priority);
  }

  function suppressionReason(packet, decision, state) {
    if (!config.enabled) return "disabled";
    if (!packet) return "missing_context_packet";
    if (!decision) return "no_trigger_match";
    if (conversationIsActive()) return "conversation_already_active";
    const canReplaceOpenGreeting =
      isJourneyTransition(decision) && canSupersedeRecentOpportunity(state, decision);
    if (chatIsOpen(recentEvents(packet)) && !canReplaceOpenGreeting) return "chat_already_open";
    if (document.hidden) return "page_hidden";
    const widget = document.querySelector("algolia-chat");
    if (widget && widget.autoEngage === false) return "auto_engage_disabled";
    if (
      visibleOpportunities(state).length >= config.maxOpportunitiesPerSession &&
      !canSupersedeRecentOpportunity(state, decision)
    ) {
      return "session_cap_reached";
    }
    const lastVisibleAt = lastVisibleOpportunityAt(state);
    if (
      lastVisibleAt &&
      Date.now() - lastVisibleAt < config.cooldownMs &&
      !(isJourneyTransition(decision) && !hasCompletedHandoff(state))
    ) {
      return "cooldown_active";
    }
    const duplicate = state.opportunities.some(
      (item) =>
        item.pageId === decision.pageId &&
        item.moment === decision.moment &&
        !["failed", "expired", "superseded"].includes(item.status)
    );
    if (duplicate) return "already_eligible_for_page_moment";
    return null;
  }

  function empty(reason) {
    return {
      schema: SCHEMA,
      engage: false,
      reason,
      createdAt: Date.now(),
    };
  }

  function updateDebugStatus(message, detail) {
    if (!DEBUG) return;
    const status = {
      message,
      detail,
      at: Date.now(),
    };
    window.__algoliaProactiveLastStatus = status;
    try {
      if (!document.body || typeof document.createElement !== "function") return;
      let node = document.getElementById?.("algolia-proactive-debug-status");
      if (!node) {
        node = document.createElement("div");
        node.id = "algolia-proactive-debug-status";
        node.setAttribute("style", [
          "position:fixed",
          "left:12px",
          "bottom:12px",
          "z-index:2147483647",
          "max-width:420px",
          "padding:8px 10px",
          "border:1px solid #3157ff",
          "border-radius:8px",
          "background:#fff",
          "color:#1f2a44",
          "font:12px/1.35 system-ui,-apple-system,BlinkMacSystemFont,sans-serif",
          "box-shadow:0 8px 24px rgba(31,42,68,.18)",
        ].join(";"));
        document.body.appendChild(node);
      }
      node.textContent = message;
      node.title = JSON.stringify(detail || {}).slice(0, 900);
    } catch {
      // Debug UI is best effort; the window/event state above is the testable source.
    }
  }

  function recordSuppression(decision) {
    if (!DEBUG) return;
    window.__algoliaProactiveLastSuppression = {
      reason: decision?.reason || "unknown",
      pagePath: decision?.pagePath || location.pathname,
      createdAt: Date.now(),
      decision,
    };
    const latestVisible = readState().opportunities
      .filter((opportunity) => VISIBLE_OPPORTUNITY_STATUSES.has(opportunity.status))
      .at(-1);
    if (decision?.reason === "chat_already_open" && latestVisible?.status === "shown") {
      updateDebugStatus(`Proactive greeting active: ${latestVisible.trigger}`, {
        suppression: decision,
        activeOpportunity: latestVisible,
      });
    } else {
      updateDebugStatus(`Proactive suppressed: ${decision?.reason || "unknown"}`, decision);
    }
    try {
      document.dispatchEvent(
        new CustomEvent("algolia-proactive-suppressed", {
          detail: window.__algoliaProactiveLastSuppression,
        })
      );
    } catch {
      // ignore
    }
  }

  function evaluate({ reserve = false } = {}) {
    const packet = compilerPacket();
    const state = expireStaleOpportunities(readState());
    trace("context_compiled", packetSummary(packet));
    const candidateList = candidates(packet);
    trace("candidates_evaluated", {
      count: candidateList.length,
      candidates: candidateList.map(decisionSummary),
    });
    const decision = candidateList[0] || null;
    const reason = suppressionReason(packet, decision, state);
    if (reason) {
      trace("suppressed", { reason, decision: decisionSummary(decision) });
      return empty(reason);
    }
    if (!reserve) {
      trace("candidate_selected", decisionSummary(decision));
      return decision;
    }

    const retryable = state.opportunities.find(
      (item) =>
        item.pageId === decision.pageId &&
        item.moment === decision.moment &&
        item.status === "failed"
    );
    const opportunityId = retryable?.id ||
      `opp_${Date.now().toString(16)}_${Math.random().toString(16).slice(2, 8)}`;
    const requestPacket = {
      ...decision.agentPromptPacket,
      schema: GREETING_REQUEST_SCHEMA,
      opportunityId,
      createdAt: Date.now(),
      moment: decision.moment,
      trigger: decision.trigger,
      priority: decision.priority,
      messageGoal: decision.messageGoal,
      reasonCodes: decision.reasonCodes,
    };
    const opportunity = {
      id: opportunityId,
      status: "qualified",
      lifecycle: ["qualified"],
      pageId: decision.pageId,
      pagePath: decision.pagePath,
      moment: decision.moment,
      trigger: decision.trigger,
      priority: decision.priority,
      messageGoal: decision.messageGoal,
      reasonCodes: decision.reasonCodes,
      createdAt: Date.now(),
      requestPacket,
    };
    const nextState = supersedeLowerPriorityOpportunities(state, decision);
    if (retryable) {
      const index = nextState.opportunities.findIndex((item) => item.id === retryable.id);
      nextState.opportunities[index] = {
        ...retryable,
        requestPacket,
        failureReason: null,
        updatedAt: Date.now(),
      };
    } else {
      nextState.opportunities.push(opportunity);
    }
    writeState(nextState);
    trace("opportunity_reserved", {
      opportunityId,
      trigger: decision.trigger,
      moment: decision.moment,
      messageGoal: decision.messageGoal,
      pagePath: decision.pagePath,
    });
    return {
      ...decision,
      opportunityId: opportunity.id,
      agentPromptPacket: requestPacket,
    };
  }

  function textFromSse(raw) {
    if (!String(raw || "").includes("data:")) return raw;
    let text = "";
    for (const line of String(raw).split("\n")) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const event = JSON.parse(payload);
        if (event.type === "text-delta" && typeof event.delta === "string") text += event.delta;
        else if (event.type === "text" && typeof event.text === "string") text += event.text;
      } catch {
        // Non-JSON SSE data is ignored; we only trust structured text deltas.
      }
    }
    return text || raw;
  }

  function extractJsonObject(raw) {
    const text = String(textFromSse(raw) || "").trim();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
      if (!fenced) return null;
      try {
        return JSON.parse(fenced[1]);
      } catch {
        return null;
      }
    }
  }

  function wordCount(text) {
    return String(text || "").trim().split(/\s+/).filter(Boolean).length;
  }

  function sentenceCount(text) {
    const normalized = String(text || "").trim();
    if (!normalized) return 0;
    return normalized
      .split(/(?<=[.!?])\s+/)
      .map((sentence) => sentence.trim())
      .filter(Boolean).length;
  }

  function compactGreetingResponse(response) {
    if (!response || typeof response !== "object" || typeof response.greeting !== "string") {
      return { response, normalizationReason: null };
    }
    const sentences = response.greeting
      .trim()
      .split(/(?<=[.!?])\s+/)
      .map((sentence) => sentence.trim())
      .filter(Boolean);
    if (sentences.length <= 2) return { response, normalizationReason: null };
    return {
      response: { ...response, greeting: sentences.slice(0, 2).join(" ") },
      normalizationReason: "greeting_compacted_to_two_sentences",
    };
  }

  function sameHandoffSummary(response, decision) {
    const summary = response?.handoffSummary || {};
    return (
      summary.moment === decision.moment &&
      summary.trigger === decision.trigger &&
      summary.messageGoal === decision.messageGoal
    );
  }

  function validateGreetingResponse(response, decision) {
    if (!response || typeof response !== "object") return "invalid_json";
    if (response.schema !== GREETING_RESPONSE_SCHEMA) return "invalid_schema";
    if (response.opportunityId !== decision.opportunityId) return "opportunity_mismatch";
    if (!sameHandoffSummary(response, decision)) return "handoff_summary_mismatch";

    const greeting = typeof response.greeting === "string" ? response.greeting.trim() : "";
    if (!greeting) return "invalid_greeting";
    if (sentenceCount(greeting) > 2) return "greeting_too_many_sentences";
    if (BANNED_GREETING_RE.test(greeting)) return "telemetry_exposure";
    if (UNSUPPORTED_CLAIM_RE.test(greeting)) return "unsupported_claim";

    const chips = Array.isArray(response.chips) ? response.chips : [];
    if (chips.length > 3) return "too_many_chips";
    for (const chip of chips) {
      if (typeof chip !== "string" || !chip.trim()) return "invalid_chip";
      if (wordCount(chip) > 8) return "chip_too_long";
      if (BANNED_GREETING_RE.test(chip) || UNSUPPORTED_CLAIM_RE.test(chip)) return "invalid_chip";
    }
    return null;
  }

  function renderGreeting(response, decision) {
    const widget = chatElement();
    if (!widget || typeof widget.engage !== "function") {
      updateOpportunity(decision.opportunityId, {
        status: "failed",
        failureReason: "widget_unavailable",
      });
      trace("widget_unavailable", { opportunityId: decision.opportunityId });
      return false;
    }
    const chips = Array.isArray(response.chips)
      ? response.chips.map((chip) => chip.trim()).filter(Boolean)
      : [];
    const shown = widget.engage({
      greeting: response.greeting.trim(),
      suggestions: chips,
    });
    const shownAt = shown ? Date.now() : undefined;
    updateOpportunity(decision.opportunityId, {
      status: shown ? "shown" : "failed",
      failureReason: shown ? null : "render_refused",
      shownAt,
      greetingResponse: {
        schema: GREETING_RESPONSE_SCHEMA,
        opportunityId: response.opportunityId,
        greeting: response.greeting.trim(),
        chips,
        handoffSummary: response.handoffSummary,
      },
    }, shown ? { lastOpportunityAt: shownAt } : null);
    trace(shown ? "widget_rendered" : "render_refused", {
      opportunityId: decision.opportunityId,
      trigger: decision.trigger,
      chips: chips.length,
    });
    if (shown) {
      updateDebugStatus(`Proactive greeting shown: ${decision.trigger}`, {
        opportunityId: decision.opportunityId,
        trigger: decision.trigger,
        chips: chips.length,
      });
    }
    return !!shown;
  }

  async function requestGreeting(decision) {
    const { appId, apiKey, greetingsAgentId, sources } = credentials();
    trace("credentials_checked", {
      hasAppId: !!appId,
      hasApiKey: !!apiKey,
      hasGreetingsAgentId: !!greetingsAgentId,
      hasFetch: typeof fetch === "function",
      sources,
    });
    if (!appId || !apiKey || !greetingsAgentId || typeof fetch !== "function") {
      debug("greetings agent not configured; emitted opportunity only");
      trace("greeting_not_configured", {
        hasAppId: !!appId,
        hasApiKey: !!apiKey,
        hasGreetingsAgentId: !!greetingsAgentId,
        hasFetch: typeof fetch === "function",
        sources,
      });
      updateOpportunity(decision.opportunityId, {
        status: "failed",
        failureReason: "greeting_not_configured",
      });
      return false;
    }

    updateOpportunity(decision.opportunityId, { status: "pending" });
    trace("greeting_request_started", {
      opportunityId: decision.opportunityId,
      trigger: decision.trigger,
      moment: decision.moment,
      agentId: greetingsAgentId,
      appId,
    });
    const body = {
      id: `alg_cnv_proactive_${decision.opportunityId}`,
      messages: [
        {
          id: `alg_msg_proactive_${decision.opportunityId}`,
          role: "user",
          parts: [
            {
              type: "text",
              text: `PROACTIVE_GREETING_REQUEST\n${JSON.stringify(decision.agentPromptPacket)}`,
            },
          ],
          metadata: {
            turnContext: compilerTurnContext(),
          },
        },
      ],
    };

    try {
      const response = await fetch(agentCompletionUrl(greetingsAgentId, appId), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Algolia-Application-Id": appId,
          "X-Algolia-API-Key": apiKey,
        },
        body: JSON.stringify(body),
      });
      trace("greeting_response_http", {
        opportunityId: decision.opportunityId,
        ok: !!response.ok,
        status: response.status,
      });
      if (!response.ok) {
        updateOpportunity(decision.opportunityId, {
          status: "failed",
          failureReason: `http_${response.status}`,
        });
        return false;
      }

      const parsed = extractJsonObject(await response.text());
      trace("greeting_response_parsed", {
        opportunityId: decision.opportunityId,
        schema: parsed?.schema,
        responseOpportunityId: parsed?.opportunityId,
        greetingPreview: clip(parsed?.greeting, 180),
        chipCount: Array.isArray(parsed?.chips) ? parsed.chips.length : 0,
      });
      if (decision.pagePath && decision.pagePath !== location.pathname) {
        updateOpportunity(decision.opportunityId, {
          status: "superseded",
          failureReason: "page_changed_before_render",
        });
        return false;
      }
      const normalized = compactGreetingResponse(parsed);
      if (normalized.normalizationReason) {
        updateOpportunity(decision.opportunityId, {
          normalizationReason: normalized.normalizationReason,
          originalGreeting: parsed.greeting,
        });
        trace("greeting_response_normalized", {
          opportunityId: decision.opportunityId,
          normalizationReason: normalized.normalizationReason,
          originalSentenceCount: sentenceCount(parsed.greeting),
        });
      }
      const validationError = validateGreetingResponse(normalized.response, decision);
      if (validationError) {
        updateOpportunity(decision.opportunityId, {
          status: "failed",
          failureReason: validationError,
          rejectedGreetingResponse: parsed || null,
        });
        trace("greeting_response_rejected", {
          opportunityId: decision.opportunityId,
          validationError,
          parsed,
        });
        return false;
      }

      return renderGreeting(normalized.response, decision);
    } catch (error) {
      updateOpportunity(decision.opportunityId, {
        status: "failed",
        failureReason: error instanceof Error ? error.message : String(error),
      });
      trace("greeting_request_error", {
        opportunityId: decision.opportunityId,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  async function handleSignal(event) {
    const name = event?.detail?.name;
    if (!name || name === "nav_hover" || name === "hover") return;
    trace("signal_received", {
      name,
      path: event?.detail?.path || location.pathname,
      props: event?.detail?.props || null,
    });

    restoreActiveConversation(compilerPacket());
    const preview = evaluate();
    if (!preview.engage) {
      debug("no proactive opportunity", preview.reason);
      recordSuppression(preview);
      return;
    }

    const { appId, apiKey, greetingsAgentId, sources } = credentials();
    trace("pre_reserve_credentials_checked", {
      hasAppId: !!appId,
      hasApiKey: !!apiKey,
      hasGreetingsAgentId: !!greetingsAgentId,
      hasFetch: typeof fetch === "function",
      sources,
    });
    if (!appId || !apiKey || !greetingsAgentId || typeof fetch !== "function") {
      trace("pre_reserve_greeting_not_configured", {
        decision: decisionSummary(preview),
        hasAppId: !!appId,
        hasApiKey: !!apiKey,
        hasGreetingsAgentId: !!greetingsAgentId,
        hasFetch: typeof fetch === "function",
        sources,
      });
      return;
    }

    const decision = evaluate({ reserve: true });
    if (!decision.engage) {
      debug("no proactive opportunity after reserve check", decision.reason);
      recordSuppression(decision);
      return;
    }

    debug("proactive opportunity", decision);
    updateDebugStatus(`Proactive opportunity: ${decision.trigger}`, decision);
    document.dispatchEvent(
      new CustomEvent("algolia-proactive-opportunity", {
        detail: decision,
      })
    );
    await requestGreeting(decision);
  }

  function scheduleInitialEvaluation() {
    for (const delay of [0, 250, 1000, 2500]) {
      setTimeout(() => {
        trace("scheduled_initial_evaluation", { delay });
        handleSignal({ detail: { name: "controller_ready", delay } });
      }, delay);
    }
  }

  function debugState() {
    const creds = credentials();
    return {
      config,
      state: readState(),
      packet: compilerPacket(),
      decision: evaluate(),
      credentials: {
        hasAppId: !!creds.appId,
        hasApiKey: !!creds.apiKey,
        hasGreetingsAgentId: !!creds.greetingsAgentId,
        hasFetch: typeof fetch === "function",
        sources: creds.sources,
      },
      trace: readTrace(),
    };
  }

  function clearDebugTrace() {
    writeTrace([]);
    window.__algoliaProactiveTrace = [];
  }

  const root = window;
  if (!root.__algoliaProactiveControllerInstalled) {
    root.__algoliaProactiveControllerInstalled = true;
    const previous = root.ALGOLIA_PROACTIVE_CONFIG;
    if (previous && typeof previous === "object") configure(previous);
    document.addEventListener("algolia-engagement-signal", handleSignal);
    document.addEventListener("algolia-chat-engagement-dismissed", dismissShownOpportunity);
    document.addEventListener("algolia-chat-open-change", (event) => {
      if (event?.detail?.open === false) dismissShownOpportunity(event);
    });
    scheduleInitialEvaluation();
  }

  root.algoliaProactiveController = {
    configure,
    evaluate,
    debug: debugState,
    debugTrace: debugState,
    clearDebugTrace,
  };
  trace("controller_installed", {
    hasCompiler: !!window.algoliaContextCompiler,
    hasChat: !!chatElement(),
    hasEngageElement: !!document.querySelector("algolia-chat-engage"),
  });
})();
