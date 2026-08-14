(function () {
  "use strict";

  const LABEL = "[Algolia Proactive Controller]";
  const DEBUG =
    new URLSearchParams(location.search).get("algoliaChatDebug") === "1" ||
    new URLSearchParams(location.search).get("algoliaProactiveDebug") === "1";

  const STATE_KEY = "algolia_proactive_state";
  const SCHEMA = "AlgoliaProactiveDecision.v1";
  const STATE_SCHEMA = "AlgoliaProactiveState.v1";

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

  function compilerPacket() {
    const compiler = window.algoliaContextCompiler;
    if (!compiler || typeof compiler.compile !== "function") return null;
    return compiler.compile();
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
        moment: fields.moment,
        trigger: fields.trigger,
        persona: packet?.profile?.persona || null,
        currentPage: page,
        journey: sessionPages(packet).map((item) => ({
          path: item.path,
          pageGroup: item.pageGroup,
          topic: item.topic,
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
    if (state.opportunities.length >= config.maxOpportunitiesPerSession) return "session_cap_reached";
    if (Date.now() - state.lastOpportunityAt < config.cooldownMs) return "cooldown_active";
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

  function evaluate({ reserve = false } = {}) {
    const packet = compilerPacket();
    const state = readState();
    const decision = candidates(packet)[0] || null;
    const reason = suppressionReason(packet, decision, state);
    if (reason) return empty(reason);
    if (!reserve) return decision;

    const opportunity = {
      id: `opp_${Date.now().toString(16)}_${Math.random().toString(16).slice(2, 8)}`,
      status: "eligible",
      pageId: decision.pageId,
      pagePath: decision.pagePath,
      moment: decision.moment,
      trigger: decision.trigger,
      priority: decision.priority,
      messageGoal: decision.messageGoal,
      reasonCodes: decision.reasonCodes,
      createdAt: Date.now(),
    };
    state.opportunities.push(opportunity);
    state.lastOpportunityAt = opportunity.createdAt;
    writeState(state);
    return { ...decision, opportunityId: opportunity.id };
  }

  function handleSignal(event) {
    const name = event?.detail?.name;
    if (!name || name === "nav_hover" || name === "hover") return;

    const decision = evaluate({ reserve: true });
    if (!decision.engage) {
      debug("no proactive opportunity", decision.reason);
      return;
    }

    debug("proactive opportunity", decision);
    document.dispatchEvent(
      new CustomEvent("algolia-proactive-opportunity", {
        detail: decision,
      })
    );
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
  }

  root.algoliaProactiveController = {
    configure,
    evaluate,
    debug: debugState,
  };
})();
