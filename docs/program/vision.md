# Vision Manifesto: Algolia.com As A Search-Led Website

Date: 2026-08-05
Status: Vision draft v3

## The Big Idea

Algolia.com should not be a brochure about search.

Algolia.com should become the best public proof of Algolia's own product: a website where search is the primary engagement layer.

The first thing built is a website experience redesign. The agentic concierge is a second, conditional layer.

## Executive One-Page Pitch

Thesis: Algolia.com should move from brochure navigation to search-led discovery. The current site tells visitors Algolia is search. The proposed experience lets visitors use Algolia to discover Algolia.

Why now:

- Algolia already exposes search, AI prompts, source filters, and grouped results inside the current site search overlay.
- The current website still presents Algolia like a conventional SaaS company.
- A search-led experience would make the medium prove the message.

Build scope, not an approval request:

- Nobody at Algolia has seen this idea. There is no decision pending and nothing to approve. The work is to build it, show it, and prove it — a demo is the argument.
- Ask 1 and Ask 2 remain separate as *build scope*: the agentic layer must never block or delay the website demo.

First deliverable:

- A working search-led algolia.com at a shareable URL — two concept frames on a real Algolia index of real algolia.com content — plus a one-page concept frame covering current site, search takeover moment, search-first north star, the agentic layer, phased path, and top risks.
- The demo must be shareable without Arijit present, and every foreseeable objection (SEO, conversion, accessibility, latency, safety) must have a written answer on disk before it is shown.

Novelty caveat:

- The claim that no software company has done this remains unproven. Phase 0 must check prior attempts before the pitch frames this as category-first.

## The Strategic Shift

The first version of the idea was search-first navigation:

- replace or reduce traditional navigation
- make the search bar the primary interface
- map Products, Solutions, Pricing, Developers, Resources, Customer Stories, Contact Sales, and Login into search-led journeys

That is Ask 1. It must stand on its own.

Ask 1 experience:

- the homepage can keep enough traditional structure to orient a CMO and a first-time visitor
- the first meaningful click opens a search-led discovery layer
- current nav becomes intent chips, filters, answer panels, result groups, and next-step actions
- every non-negotiable journey still works: Products, Solutions, Pricing, Developers / Docs, Resources, Customer Stories, Contact Sales, and Login
- the future-state version can remove most navigation and make the search box the website's front door

The second version is agentic engagement:

- the first click becomes the moment of engagement
- search detects intent
- the right agent takes over
- the agent brings content, proof, answers, next actions, and specialist guidance
- the website becomes a white-glove service layer, not a static set of pages

That is Ask 2. It is a separate build phase, not a separate approval.

## Two Different Build Scopes

This work contains two related but different scopes. They are separated so the second cannot delay the first.

### Ask 1: Website IA And Engagement Redesign

What gets built and shown: a site model where search becomes the primary engagement layer.

Scope:

- current homepage and navigation audit
- search takeover concept
- search-first future-state concept
- IA-to-search mapping
- buyer journey prototype
- analytics-backed phased rollout idea

This is the demo that carries the brand and website argument.

### Ask 2: Public Agentic Engagement Product

What gets researched now and built only if capability allows: a public unauthenticated agentic layer on Algolia.com.

Scope:

- agent taxonomy
- Agent Studio / neural search feasibility
- prompt-injection and abuse controls
- latency architecture
- legal, security, sales, and brand governance
- agent quality evals
- production monitoring and rollback

This is not only a website redesign. It is a public AI product surface. Its risk, latency, and governance models are researched in full now, but it is built into the demo only if Agent Studio and neural search can credibly support it. If they cannot, it ships as a designed layer with an honest label — never as implied capability.

## The Experience

A visitor lands on Algolia.com.

In the CMO-adoptable concept, the first page can still feel familiar enough to build trust. But when the visitor clicks Products, Solutions, Developers, Resources, Pricing, or any major path, the site does not merely open a static page or mega-menu. It opens an intent-aware engagement layer.

In the future-state concept, the visitor begins directly in that engagement layer.

Either way, the website should feel like this:

> Tell us what you are trying to do. Algolia will guide you there.

## Ask 1 Experience Model

The visitor should not need to understand Algolia's sitemap before they can move.

Current navigation becomes a progressive search journey:

- visitor intent: explore products, solve a business problem, build with Algolia, compare pricing, learn from customers, get support, talk to sales
- role or audience: ecommerce leader, product manager, developer, merchandiser, marketer, enterprise buyer
- business context: ecommerce, B2B commerce, marketplaces, media, SaaS, higher education, grocery, fashion, auto parts
- product capability: Search, Recommendations, Personalization, Analytics, Browse, Agent Studio, Ask AI, Data Enrichment, Integrations, Security
- content type: product page, documentation, API guide, customer story, blog, webinar, academy, support article, tool, pricing
- action: get started, contact sales, view pricing, open docs, book demo, read case study, login

The wedge is simple: keep the front door familiar, then make every click prove Algolia.

## Ask 2 Conditional Agent Model

The agent model is not a peer of the website frame concepts. It is a capability layer that can sit on top of either frame if the Phase 0 kill-switch spikes pass.

If capability research supports it, the layer could route visitors to specialists:

- concierge for broad or ambiguous intent
- product specialist for capabilities and product combinations
- industry or use-case specialist for ecommerce, B2B commerce, marketplaces, media, SaaS, higher education, grocery, fashion, and auto parts
- developer or integration specialist for APIs, SDKs, docs, UI components, MCP, and implementation paths
- academy specialist for learning journeys
- support specialist for troubleshooting and existing-customer needs
- sales or solution consultant for pricing, enterprise readiness, procurement, demo, and contact-sales journeys

The full agent taxonomy belongs in the research artifacts (`docs/30-models/33-agent-taxonomy-and-routing.md`). The manifesto only needs the scope line: the agentic layer is researched now and built only after the search-led website demo stands on its own.

## Not Just Chat

This should not become a generic chatbot.

The engagement layer can include:

- answer panels
- source-backed content cards
- progressive filters
- journey chips
- specialist handoffs
- proof bundles
- implementation plans
- buyer guides
- interactive demos
- avatar or narrated moments
- sales handoff summaries

The interface should feel conversational, navigational, and visual at the same time.

## Conditional Content Requirements

Ask 1 needs a clean content model for current website pages, product pages, solutions, documentation, customer stories, pricing, resources, and conversion paths.

Ask 2 would need structured agent access to:

- current website pages
- product pages
- solution pages
- industry pages
- use-case pages
- customer stories
- documentation
- API references
- support knowledge base
- Academy content
- blog and resource center
- webinars and events
- demo videos
- pricing and packaging
- security and compliance
- integrations
- tools and assessments
- analytics-derived popular journeys and search queries

## Core Hypothesis

If Algolia.com becomes search-led, the website itself becomes a proof point for Algolia search and discovery.

If the agentic layer later passes safety, speed, governance, and eval bars, the website can also become a proof point for Agent Studio and neural search.

The strongest executive pitch is:

> Algolia should not ask visitors to read about discovery before they experience it.

## Ask 2 Trust Contract

The agentic layer only works if it is trusted as a public brand surface. A public homepage agent is not a private productivity assistant. It is exposed to anonymous visitors, competitors, bots, prompt-injection attempts, scraping, screenshots, and deliberate cost attacks.

The trust contract has five requirements:

- Fast by default: first useful response must feel instant, with search results and suggestions appearing before slower generated answers.
- Source-backed by default: important answers should show the content, pages, docs, customer stories, or approved sources behind them.
- Safe on a public surface: prompt injection, abuse, bot traffic, scraping, and cost attacks need rate limits, fallback modes, monitoring, and refusal rules.
- Governed for high-risk claims: pricing, security, compliance, roadmap, benchmarks, customer proof, and competitive claims need approved sources, owners, freshness rules, and human handoff paths.
- Continuously evaluated: agent quality needs golden conversations, adversarial tests, routing checks, citation faithfulness checks, transcript sampling, user feedback, and production monitoring.

Without this trust contract, Ask 2 is a compelling demo but not an executive-ready public product surface.

## What Could Break

- Marketing may resist losing control over carefully curated page journeys.
- SEO could suffer if crawlable landing pages are hidden behind dynamic interactions.
- Search takeover may make critical journeys slower or less findable than current navigation.
- Buyer-facing value may be weaker than the internal brand thesis.
- The first executive board may lack hard upside numbers until GA / Looker and implementation estimates are reviewed.
- The agentic experience may feel like a chatbot bolted onto a website.
- Visitors may not trust agent answers without citations and visible source content.
- Specialist handoffs may feel theatrical if they do not improve usefulness.
- Support and sales intent could blur if routing is weak.
- Agent Studio capabilities must be researched before the concept is positioned as directly shippable.
- Public prompt injection could make the homepage agent say something false, embarrassing, competitor-favorable, or off-brand.
- Anonymous bot traffic could turn the homepage into an LLM cost and abuse surface.
- Agentic latency could contradict Algolia's speed promise.
- AI-generated pricing, security, compliance, roadmap, benchmark, or customer-proof claims could create legal, sales, or brand exposure if they are wrong or stale.
- Without a continuous eval loop, there is no durable way to know whether agents are accurate, helpful, well-routed, and safe after launch.

## What We Need To Research

- How current Algolia.com content is structured.
- How current navigation maps to intent, audience, context, capability, content type, and action.
- How current site search is used and whether search users convert better.
- What GA / Looker says about journey friction.
- How real buyers, developers, sales reps, and solution consultants react to search-led navigation before the agentic layer is added.
- What the strongest argument is for keeping the current site model.
- What Agent Studio and neural search can credibly support today.
- What agent types are needed for the prototype.
- What content each agent needs access to.
- What engagement modes feel premium rather than generic.
- How to preserve SEO, accessibility, and trust.
- How to protect a public unauthenticated agent from prompt injection, abuse, scraping, and cost attacks.
- What latency budget is required so the experience reinforces Algolia's speed promise.
- Which answer categories require approved source-only responses and legal/brand/security governance.
- What agent-quality eval harness and transcript review loop would be required after launch.

## Product Direction

Build two website frame concepts:

- CMO-adoptable wedge: traditional frame, search takes over after the first meaningful click.
- Future-state provocation: Algolia.com becomes search-first from the first screen.

Evaluate one optional capability layer:

- Agentic concierge: only after Phase 0 safety, latency, governance, and eval checks pass.

Both website frames should prove the same underlying idea:

> Algolia.com is not a website you browse. It is a discovery experience that serves you.
