(function () {
  "use strict";

  const LABEL = "[Algolia Proactive Controller]";
  const DEBUG =
    new URLSearchParams(location.search).get("algoliaChatDebug") === "1" ||
    new URLSearchParams(location.search).get("algoliaProactiveDebug") === "1";

  const STATE_KEY = "algolia_proactive_state";
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
    "eligible",
    "greeting_requested",
    "greeting_failed",
    "greeting_rejected",
    "widget_unavailable",
    "render_refused",
  ]);
  const VISIBLE_OPPORTUNITY_STATUSES = new Set([
    "shown",
    "handoff_tool_called",
    "handoff_sent",
  ]);

  const DEFAULTS = {
    enabled: true,
    maxOpportunitiesPerSession: 3,
    cooldownMs: 120000,
    productDwellMs: 10000,
    productScrollDepth: 50,
    implementationDwellMs: 15000,
    implementationScrollDepth: 60,
    pricingDwellMs: 8000,
    customerProofDwellMs: 12000,
    customerProofScrollDepth: 60,
    compatibilityMode: COMPLETIONS_COMPATIBILITY_MODE,
    cache: false,
    memory: false,
  };

  let config = { ...DEFAULTS };

  function debug(...args) {
    if (DEBUG) console.log(LABEL, ...args);
  }

  function configure(nextConfig) {
    config = { ...config, ...(nextConfig || {}) };
    debug("configured", config);
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
    state.opportunities[index] = {
      ...state.opportunities[index],
      ...patch,
      updatedAt: Date.now(),
    };
    writeState({ ...state, ...(statePatch || {}) });
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

  function isDeveloper(page) {
    const group = pageGroup(page);
    const path = String(page?.path || "");
    return group === "developer" || group === "documentation" || path.includes("/developers") || path.includes("/doc/");
  }

  function isPricing(page) {
    const group = pageGroup(page);
    const path = String(page?.path || "");
    return group === "pricing" || group === "conversion" || path.includes("/pricing") || path.includes("/demo") || path.includes("contact-sales");
  }

  function isCustomerStory(page) {
    return pageGroup(page) === "customer_story" || String(page?.path || "").includes("/customers/");
  }

  function hasRecentEvent(events, name) {
    return events.some((event) => event.name === name);
  }

  function chatElement() {
    return document.querySelector("algolia-chat");
  }

  function credentials() {
    const search = document.querySelector("algolia-instant-search");
    const legacyEngageConfig =
      window.ALGOLIA_CONTEXT_ENGINE_CONFIG && typeof window.ALGOLIA_CONTEXT_ENGINE_CONFIG === "object"
        ? window.ALGOLIA_CONTEXT_ENGINE_CONFIG
        : {};
    return {
      appId: config.appId || search?.getAttribute?.("app-id") || null,
      apiKey: config.apiKey || config.searchKey || search?.getAttribute?.("api-key") || null,
      greetingsAgentId:
        config.greetingsAgentId ||
        config.greetingAgentId ||
        legacyEngageConfig.greetingsAgentId ||
        legacyEngageConfig.greetingAgentId ||
        legacyEngageConfig.conciergeAgentId ||
        null,
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

  function hasSearchWithTerms(events, terms) {
    return events.some((event) => {
      if (event.name !== "site_search") return false;
      const query = JSON.stringify(event.props || {}).toLowerCase();
      return terms.some((term) => query.includes(term));
    });
  }

  function priorPage(pages, predicate) {
    return [...pages].slice(0, -1).reverse().find(predicate) || null;
  }

  function countPages(pages, predicate) {
    return pages.filter(predicate).length;
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
    if (!NON_VISIBLE_OPPORTUNITY_STATUSES.has(opportunity.status)) return false;
    if (opportunity.pageId === decision.pageId) return false;
    return Number(decision.priority || 0) > Number(opportunity.priority || 0);
  }

  function canSupersedeRecentOpportunity(state, decision) {
    return replaceableOpportunity(state.opportunities.at(-1), decision);
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

  function contextualFocusFor(packet) {
    const page = currentPage(packet);
    const currentFocus = productFocus(page);
    if (currentFocus) return currentFocus;
    const priorProduct = priorPage(sessionPages(packet), isProduct);
    const priorFocus = productFocus(priorProduct);
    return priorFocus ? { ...priorFocus, source: "prior_product_page" } : null;
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

  function humanList(items) {
    const values = items.map((item) => item?.label || item?.value).filter(Boolean);
    if (values.length <= 1) return values[0] || "";
    if (values.length === 2) return `${values[0]} and ${values[1]}`;
    return `${values.slice(0, -1).join(", ")}, and ${values.at(-1)}`;
  }

  function journeySummaryFor(packet, fields) {
    const pages = sessionPages(packet);
    const productTrail = uniqueProductTrail(pages);
    const currentTransition = fields.trigger || null;
    let storyHint = "";
    const productList = humanList(productTrail);

    if (currentTransition === "product_to_pricing" && productTrail.length > 1) {
      storyHint = `The visitor explored ${productList} before pricing; frame this as a cost/value question across those capabilities.`;
    } else if (currentTransition === "product_to_pricing" && productTrail.length === 1) {
      storyHint = `The visitor moved from ${productList} into pricing; frame this as a ${productList} cost/value question.`;
    } else if (fields.trigger === "multiple_product_pages" && productTrail.length > 1) {
      storyHint = `The visitor is comparing ${productList}; help turn the capability spread into a clearer decision.`;
    } else if (fields.trigger === "product_to_customer_story" && productTrail.length) {
      storyHint = `The visitor moved from ${productList} to customer proof; connect proof back to that product interest.`;
    }

    return {
      currentTransition,
      productTrail,
      pageTrail: pages
        .map((item) => ({
          path: item.path,
          title: item.title,
          pageGroup: item.pageGroup,
          topic: item.topic,
          productFocusLabel: item.productFocusLabel,
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
          maxWords: 34,
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
    const events = recentEvents(packet);
    const result = [];
    const previousProduct = priorPage(pages, isProduct);
    const previousDeveloper = priorPage(pages, isDeveloper);
    const previousPricing = priorPage(pages, isPricing);

    if (isPricing(page) && previousProduct) {
      result.push(
        withReasons(
          baseDecision(packet, {
            moment: "commercial_evaluation",
            trigger: "product_to_pricing",
            priority: 88,
            messageGoal: "explain_cost_drivers",
          }),
          ["journey_product_to_pricing", "pricing_page_view"]
        )
      );
    }

    if (isPricing(page) && previousDeveloper) {
      result.push(
        withReasons(
          baseDecision(packet, {
            moment: "commercial_evaluation",
            trigger: "implementation_to_pricing",
            priority: 86,
            messageGoal: "connect_implementation_effort_to_cost",
          }),
          ["journey_implementation_to_pricing", "pricing_page_view"]
        )
      );
    }

    if (isDeveloper(page) && previousPricing) {
      result.push(
        withReasons(
          baseDecision(packet, {
            moment: "implementation_research",
            trigger: "pricing_to_implementation",
            priority: 84,
            messageGoal: "reduce_implementation_uncertainty",
          }),
          ["journey_pricing_to_implementation", "developer_page_view"]
        )
      );
    }

    if (isCustomerStory(page) && previousProduct) {
      result.push(
        withReasons(
          baseDecision(packet, {
            moment: "customer_proof",
            trigger: "product_to_customer_story",
            priority: 82,
            messageGoal: "surface_relevant_customer_proof",
          }),
          ["journey_product_to_customer_story", "customer_story_page"]
        )
      );
    }

    if (isDeveloper(page) && hasSearchWithTerms(events, ["api", "sdk", "react", "instantsearch", "implementation", "integrat"])) {
      result.push(
        withReasons(
          baseDecision(packet, {
            moment: "implementation_research",
            trigger: "search_to_docs",
            priority: 80,
            messageGoal: "answer_implementation_path",
          }),
          ["site_search_implementation_terms", "developer_page_view"]
        )
      );
    }

    if (isPricing(page) && Number(page.dwellMs || 0) >= config.pricingDwellMs) {
      result.push(
        withReasons(
          baseDecision(packet, {
            moment: "commercial_evaluation",
            trigger: "pricing_8s_dwell",
            priority: 78,
            messageGoal: "explain_cost_drivers",
          }),
          ["pricing_page", "pricing_dwell"]
        )
      );
    }

    if (isDeveloper(page) && Number(page.dwellMs || 0) >= config.implementationDwellMs) {
      result.push(
        withReasons(
          baseDecision(packet, {
            moment: "implementation_research",
            trigger: "developer_page_15s_dwell",
            priority: 76,
            messageGoal: "reduce_implementation_uncertainty",
          }),
          ["developer_page", "implementation_dwell"]
        )
      );
    }

    if (isDeveloper(page) && Number(page.maxScrollDepth || 0) >= config.implementationScrollDepth) {
      result.push(
        withReasons(
          baseDecision(packet, {
            moment: "implementation_research",
            trigger: "developer_page_60_scroll",
            priority: 74,
            messageGoal: "reduce_implementation_uncertainty",
          }),
          ["developer_page", "implementation_scroll"]
        )
      );
    }

    if (isCustomerStory(page) && Number(page.dwellMs || 0) >= config.customerProofDwellMs) {
      result.push(
        withReasons(
          baseDecision(packet, {
            moment: "customer_proof",
            trigger: "customer_story_12s_dwell",
            priority: 72,
            messageGoal: "surface_relevant_customer_proof",
          }),
          ["customer_story_page", "customer_story_dwell"]
        )
      );
    }

    if (isCustomerStory(page) && Number(page.maxScrollDepth || 0) >= config.customerProofScrollDepth) {
      result.push(
        withReasons(
          baseDecision(packet, {
            moment: "customer_proof",
            trigger: "customer_story_60_scroll",
            priority: 70,
            messageGoal: "surface_relevant_customer_proof",
          }),
          ["customer_story_page", "customer_story_scroll"]
        )
      );
    }

    if (isProduct(page) && Number(page.dwellMs || 0) >= config.productDwellMs) {
      result.push(
        withReasons(
          baseDecision(packet, {
            moment: "product_research",
            trigger: "product_page_10s_dwell",
            priority: 66,
            messageGoal: "explain_product_fit",
          }),
          ["product_page", "product_dwell"]
        )
      );
    }

    if (isProduct(page) && Number(page.maxScrollDepth || 0) >= config.productScrollDepth) {
      result.push(
        withReasons(
          baseDecision(packet, {
            moment: "product_research",
            trigger: "product_page_50_scroll",
            priority: 64,
            messageGoal: "explain_product_fit",
          }),
          ["product_page", "product_scroll"]
        )
      );
    }

    if (isProduct(page) && countPages(pages, isProduct) >= 2) {
      result.push(
        withReasons(
          baseDecision(packet, {
            moment: "journey_shift",
            trigger: "multiple_product_pages",
            priority: 62,
            messageGoal: "help_compare_capabilities",
          }),
          ["multiple_product_pages"]
        )
      );
    }

    return result.sort((left, right) => right.priority - left.priority);
  }

  function suppressionReason(packet, decision, state) {
    if (!config.enabled) return "disabled";
    if (!packet) return "missing_context_packet";
    if (!decision) return "no_trigger_match";
    if (hasRecentEvent(recentEvents(packet), "chat_open")) return "chat_already_open";
    if (document.hidden) return "page_hidden";
    const widget = document.querySelector("algolia-chat");
    if (widget && widget.autoEngage === false) return "auto_engage_disabled";
    if (visibleOpportunities(state).length >= config.maxOpportunitiesPerSession) {
      return "session_cap_reached";
    }
    const lastVisibleAt = lastVisibleOpportunityAt(state);
    if (lastVisibleAt && Date.now() - lastVisibleAt < config.cooldownMs) {
      return "cooldown_active";
    }
    const duplicate = state.opportunities.some(
      (item) =>
        item.pageId === decision.pageId &&
        item.moment === decision.moment &&
        item.status !== "expired"
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
    updateDebugStatus(`Proactive suppressed: ${decision?.reason || "unknown"}`, decision);
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
    const state = readState();
    const decision = candidates(packet)[0] || null;
    const reason = suppressionReason(packet, decision, state);
    if (reason) return empty(reason);
    if (!reserve) return decision;

    const opportunityId = `opp_${Date.now().toString(16)}_${Math.random().toString(16).slice(2, 8)}`;
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
      status: "eligible",
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
    nextState.opportunities.push(opportunity);
    writeState(nextState);
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
    const text = textFromSse(raw);
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      const start = text.indexOf("{");
      const end = text.lastIndexOf("}");
      if (start === -1 || end === -1 || end <= start) return null;
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch {
        return null;
      }
    }
  }

  function wordCount(text) {
    return String(text || "").trim().split(/\s+/).filter(Boolean).length;
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
    const greetingWords = wordCount(greeting);
    if (greetingWords < 12 || greetingWords > 34) return "invalid_greeting_length";
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
      updateOpportunity(decision.opportunityId, { status: "widget_unavailable" });
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
      status: shown ? "shown" : "render_refused",
      shownAt,
      greetingResponse: {
        schema: GREETING_RESPONSE_SCHEMA,
        opportunityId: response.opportunityId,
        greeting: response.greeting.trim(),
        chips,
        handoffSummary: response.handoffSummary,
      },
    }, shown ? { lastOpportunityAt: shownAt } : null);
    return !!shown;
  }

  async function requestGreeting(decision) {
    const { appId, apiKey, greetingsAgentId } = credentials();
    if (!appId || !apiKey || !greetingsAgentId || typeof fetch !== "function") {
      debug("greetings agent not configured; emitted opportunity only");
      return false;
    }

    updateOpportunity(decision.opportunityId, { status: "greeting_requested" });
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
      if (!response.ok) {
        updateOpportunity(decision.opportunityId, {
          status: "greeting_failed",
          failureReason: `http_${response.status}`,
        });
        return false;
      }

      const parsed = extractJsonObject(await response.text());
      if (decision.pagePath && decision.pagePath !== location.pathname) {
        updateOpportunity(decision.opportunityId, {
          status: "superseded",
          failureReason: "page_changed_before_render",
        });
        return false;
      }
      const validationError = validateGreetingResponse(parsed, decision);
      if (validationError) {
        updateOpportunity(decision.opportunityId, {
          status: "greeting_rejected",
          failureReason: validationError,
          rejectedGreetingResponse: parsed || null,
        });
        return false;
      }

      return renderGreeting(parsed, decision);
    } catch (error) {
      updateOpportunity(decision.opportunityId, {
        status: "greeting_failed",
        failureReason: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  async function handleSignal(event) {
    const name = event?.detail?.name;
    if (!name || name === "nav_hover" || name === "hover") return;

    const decision = evaluate({ reserve: true });
    if (!decision.engage) {
      debug("no proactive opportunity", decision.reason);
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
    const { appId, apiKey, greetingsAgentId } = credentials();
    if (!appId || !apiKey || !greetingsAgentId) return;
    setTimeout(() => {
      handleSignal({ detail: { name: "controller_ready" } });
    }, 0);
  }

  function debugState() {
    return {
      config,
      state: readState(),
      packet: compilerPacket(),
      decision: evaluate(),
    };
  }

  const root = window;
  if (!root.__algoliaProactiveControllerInstalled) {
    root.__algoliaProactiveControllerInstalled = true;
    const previous = root.ALGOLIA_PROACTIVE_CONFIG;
    if (previous && typeof previous === "object") configure(previous);
    document.addEventListener("algolia-engagement-signal", handleSignal);
    scheduleInitialEvaluation();
  }

  root.algoliaProactiveController = {
    configure,
    evaluate,
    debug: debugState,
  };
})();
