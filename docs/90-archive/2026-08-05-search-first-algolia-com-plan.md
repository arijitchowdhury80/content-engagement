# Search-First Algolia.com Exploration

> **ARCHIVED 2026-08-05 — SUPERSEDED, RETAINED AS REASONING REFERENCE.**
>
> This file is no longer the working plan. It remains the source of record for the
> research substance: 86 research tasks, 54 named outputs, 29 metrics, 10 riskiest
> assumptions, the 6-level nav→search mapping, the 7-agent taxonomy, and the
> precommitted kill criteria. Later work units cite it by line number.
>
> Two things in it are known wrong and are not carried forward:
>
> 1. **The approval premise.** "Leadership Ask Boundary" (lines 237–288) and the
>    sprint gates assume a decision is pending. Nobody at Algolia has seen this idea,
>    so there is nothing to approve. Ask 1 / Ask 2 survives only as a *build-scope*
>    boundary — keep agentic complexity from blocking the website demo.
> 2. **The mock prototype.** Lines 1229 and 1237 spec "mock data" and a "mock data
>    schema." The prototype is built on a real Algolia index of real algolia.com
>    content instead. Fixtures fail acceptance criterion 1.
>
> Working set: `docs/00-vision-manifesto.md`, `docs/10-decision-brief.md`,
> `docs/20-research/`, `docs/30-models/`, `docs/40-concepts/`, `docs/50-prototype/`,
> `docs/60-show/`. Execution tracker: Asana project `Search-First Algolia.com`.

Date: 2026-08-05
Status: ARCHIVED. Superseded by the 21-work-unit plan tracked in Asana.
Owner: Arijit Chowdhury

## Core Thesis

Algolia sells search and discovery, but Algolia.com currently behaves like a conventional SaaS brochure site. This exploration asks whether Algolia.com should become the strongest live demonstration of Algolia itself: a website whose primary interface is search, with navigation, taxonomy, content discovery, conversion paths, and education expressed through a rich search box and results experience.

The provocative version is: Google.com is a search bar because Google is search. Algolia.com should be a search bar because Algolia is search and discovery.

## Locked Strategic Constraints

Audience: Algolia leadership, especially CMO and CEO.

Ambition level: two concepts in parallel. One concept is radical but CMO-adoptable: the site can still open with recognizable page structure and traditional orientation, but once a user engages, search and content discovery take over. The second concept is the future-state "search is the website" version. Both must be jaw-dropping, grounded, and phase-shippable.

Navigation stance: do not force a single answer too early. Explore two lanes:

- Lane 1: traditional frame, search takeover after engagement. The homepage and/or top-level structure can reassure today's CMO, but the first meaningful click opens a search-led discovery layer that becomes the main experience.
- Lane 2: search-first future state. Top navigation is conceptually replaced by search, with only minimal utility escape hatches if research shows they are needed for trust, accessibility, or account access.

Homepage stance: split by lane. Lane 1 can begin with a more traditional Algolia.com page outline, but search becomes dominant the moment the user clicks, searches, selects a prompt, opens a nav item, or expresses intent. Lane 2 begins intentionally minimal with a giant search bar, where the user has to engage.

Search behavior: the search box must do all three jobs:

- navigate users to pages
- answer questions like AI search
- guide people through buyer journeys

Non-negotiable journeys:

- Products
- Solutions
- Pricing
- Developers / Docs
- Resources
- Customer Stories
- Contact Sales
- Login

Strategic bar: the concept must be jaw-dropping, but the argument cannot rely on spectacle alone. It must prove that a search-first Algolia.com can still perform every serious SaaS website job: orientation, education, trust, segmentation, conversion, support, documentation discovery, SEO-sensible landing paths, and account access.

Adoption strategy: the work should gradually morph leadership toward the radical idea. The CMO-adoptable lane should show that search-led engagement can improve the current site without asking stakeholders to delete the familiar website model on day one. The future-state lane should show where the strategy can go once trust is earned.

## Operational Project Plan

Purpose: make one fundable decision first: should Algolia invest in an Ask 1 search-led website concept? Ask 2 remains a conditional future layer unless it clears separate safety, latency, governance, and eval bars.

### Operating Model

DRI: Arijit, interim.

Decision owner to secure: CMO or delegated web / digital leader.

Required reviewers:

- Web / digital: current site constraints and implementation reality.
- Product marketing: message, journey, page taxonomy, and positioning.
- Analytics: GA / Looker extracts and interpretation.
- Sales / solution consulting: buyer journey and objection reality.
- Brand / design: executive concept quality.
- Security / legal: only if Ask 2 appears in anything beyond future-state vision.

Primary decision artifacts:

- Hypothesis board v0: a fast, clearly labeled concept board with assumptions.
- Evidence pack: analytics, novelty, buyer, IA, and dissent notes.
- Executive board v1: the board worth showing to CMO / CEO.
- Prototype brief: only after v1 board and Ask 1 gate pass.

### Sprint 0: Hypothesis Board And Workstream Setup

Timing: 1 to 2 days.

Owner: Arijit.

Tasks:

- Draft one-page hypothesis board v0: current problem, CMO wedge, search-first north star, Ask 2 conditional layer, open risks.
- Confirm Ask 1 and Ask 2 are separate decisions.
- Confirm kill criteria before evidence work begins.
- Request GA / Looker export.
- Identify 2 to 3 sales / solution consulting inputs.
- Create prior-attempts search list.

Outputs:

- Hypothesis board v0, labeled "not yet evidence-backed."
- Data request list.
- Reviewer / input list.
- Confirmed kill criteria.

Dependencies:

- Current manifesto and plan.
- Current Algolia.com screenshots and live access.

Gate:

- Go if the board can explain the idea in under two minutes.
- Rework if the board still reads as "build a public AI agent" instead of "search-led website first."

### Sprint 1: Evidence Pack

Timing: 5 business days after analytics access or export.

Owner: Arijit.

Parallel workstreams:

- Analytics: search usage, nav clicks, first-click paths, conversion paths, time to pricing/docs/contact sales, top landing pages, SEO-critical pages.
- Novelty: identify B2B SaaS / enterprise software prior attempts, adjacent examples, failed attempts, and why conventional guidance avoids search-only marketing sites.
- Buyer reality: collect 3 to 5 inputs from sales, solution consulting, win/loss notes, or buyer-call excerpts.
- IA reality: map current nav, mega menus, footer, search overlay, source filters, and non-negotiable journeys.
- Dissent: write strongest case for keeping current site navigation.
- Ask 2 screen: test whether agentic layer can be mentioned as vision-only, conditional prototype, or not at all.

Outputs:

- Analytics note with numbers, gaps, and caveats.
- Novelty / prior-attempts note.
- Buyer-premise note.
- IA and search-overlay map.
- Strongest-case-against note.
- Ask 2 scope recommendation.

Dependencies:

- GA / Looker access or export.
- Sales / solution consulting availability.
- Live Algolia.com access.
- Security reviewer only if Ask 2 may be shown beyond vision.

Gate:

- Go if Ask 1 has credible evidence that search-led takeover can improve or at least preserve core journeys.
- Reframe if analytics shows traditional nav is the dominant conversion mechanism and search cannot replace it.
- Kill or park Ask 2 if public safety, latency, cost, governance, or eval ownership is not credible.

### Sprint 2: Concept Architecture

Timing: 3 to 5 business days.

Owner: Arijit with web/design and product marketing review.

Tasks:

- Define Website Frame 1: CMO Wedge, Search Takeover.
- Define Website Frame 2: Search-First North Star.
- Map Products, Solutions, Pricing, Developers / Docs, Resources, Customer Stories, Contact Sales, and Login into both frames.
- Define pre-query, click/takeover, autocomplete, results, refinement, zero-result, and conversion states.
- Define fallback nav and SEO-safe landing-page strategy.
- If Ask 2 is allowed, define only prototype-safe agentic moments.

Outputs:

- Concept architecture.
- Journey flow map.
- IA-to-search mapping table.
- Prototype scope recommendation.
- Ask 1 recommendation: wedge only, north star only, or both.

Dependencies:

- Sprint 1 evidence pack.
- Product marketing and web/design review.

Gate:

- Go if every non-negotiable journey has a credible path in the selected frame.
- Cut the search-first north star if it weakens trust, orientation, or conversion.
- Keep Ask 2 out of prototype if it cannot be represented without implying launch readiness.

### Sprint 3: Executive Board V1

Timing: 2 to 3 business days.

Owner: Arijit with brand/design review.

Tasks:

- Convert Sprint 1 and Sprint 2 findings into one CEO / CMO board.
- Include numbers where available: current search usage, nav reliance, journey friction, conversion dependency, effort band, and phased rollout.
- State the strongest case against on the board or appendix.
- Show Ask 1 as the decision and Ask 2 as conditional.

Outputs:

- Executive board v1.
- Five-minute talk track.
- Appendix with evidence and caveats.

Dependencies:

- Sprint 1 evidence pack.
- Sprint 2 concept architecture.

Gate:

- Go to prototype if the board has a clear decision ask, credible evidence, and no buried Ask 2 dependency.
- Rework if the board still relies on taste, novelty claims, or future agentic magic.

### Sprint 4: Prototype Brief And Build

Timing: 5 to 10 business days after board approval.

Owner: Arijit with design/build support.

Tasks:

- Write prototype build brief.
- Build functional HTML prototype for approved frame.
- Validate non-negotiable journeys.
- Capture desktop and mobile walkthrough.
- Prepare executive demo script.

Outputs:

- Prototype brief.
- Functional HTML prototype.
- Journey validation checklist.
- CEO / CMO demo script.

Dependencies:

- Executive board v1 approval.
- Approved Ask 1 scope.
- Ask 2 scope decision if any agentic layer appears.

Gate:

- Go to executive demo if prototype proves the selected frame and preserves all non-negotiable journeys.
- Do not describe Ask 2 as shippable unless its controls, owners, and eval loop exist.

## Leadership Ask Boundary

This project has two related but separate asks. They should not share one budget, one timeline, or one approval decision.

### Ask 1: Website IA And Search Engagement Redesign

Question for leadership: should Algolia.com explore a website model where search becomes the primary engagement layer?

Deliverables:

- executive one-page concept board
- current IA and search overlay audit
- navigation-to-search mapping
- CMO-adoptable search takeover concept
- future-state search-first concept
- clickable prototype for core journeys
- phased rollout recommendation

Primary owners likely needed:

- CMO
- web marketing
- brand/design
- product marketing
- web analytics

### Ask 2: Public Agentic Engagement Product

Question for leadership: should Algolia invest in a public unauthenticated agentic content-engagement layer on Algolia.com?

Deliverables:

- agent taxonomy
- Agent Studio / neural search feasibility
- public safety and abuse model
- latency budget
- regulated-claim governance model
- agent eval loop
- operating model for launch and rollback

Primary owners likely needed:

- product
- security
- legal
- brand
- sales / solution consulting
- support
- web platform
- analytics

Decision rule: Ask 1 can proceed as a website concept even if Ask 2 remains unapproved. Ask 2 needs its own go/no-go because it is a public AI product surface, not just a redesign.

## Executive Concept Board

Do not enter the room with this research backlog. Enter with a one-page executive concept board once Phase 0 has produced enough evidence to avoid overclaiming.

The board should be created after the Phase 0 kill-switch spikes, or it must mark Ask 2 as conditional. The board cannot present the public agentic layer as a committed north star until safety and latency clear the precommitted bar.

The board should show:

- the current problem: Algolia sells search but looks like a conventional SaaS site
- the wedge: traditional frame, search takeover after first click
- the north star: search-first website experience
- the proof: current Algolia search overlay already contains the raw ingredients
- the conditional layer: agentic engagement only if Phase 0 passes
- the phased path: site search takeover first, agentic engagement as a separate Ask 2 decision
- the trust bar: speed, source backing, public safety, governed claims, continuous eval
- early upside and cost ranges, sourced from GA / Looker, web analytics, and implementation estimates when available

This artifact should be readable by a CEO or CMO in under two minutes.

## Novelty Claim Status

The claim "no software company has done this" is not yet proven. Treat it as a hypothesis until Phase 0 finishes a prior-attempts check.

Quick desk-research signal:

- B2B SaaS website guidance still overwhelmingly recommends clear value proposition, social proof, CTAs, pricing/demo paths, and buyer-journey navigation rather than search-only homepages.
- Complex SaaS navigation guidance still favors hybrid navigation, mega menus, persona/use-case grouping, and persistent Pricing / Demo CTAs.
- Command palettes and search-first patterns appear mostly inside products, apps, docs, support centers, and knowledge bases. They are not yet visible as the dominant public marketing-site architecture in the quick scan.
- Algolia's own current overlay is therefore a stronger immediate precedent than most external SaaS examples: it already has source filters, AI prompts, grouped results, suggestions, thumbnails, and expansion behavior.

Phase 0 must turn this into evidence: examples found, examples not found, known attempts, public outcomes, and implications for the pitch.

Early sources to inspect further:

- [Best navigation for complex SaaS websites](https://www.wearespoton.com/blog/what-is-the-best-navigation-for-a-complex-saas-website)
- [SaaS navigation architecture for multi-persona sites](https://razegrowth.com/blog/saas-navigation-architecture-design)
- [B2B SaaS website navigation](https://nerdcow.co.uk/blog/b2b-saas-website-navigation/)
- [Command palette navigation and search pattern](https://mobbin.com/glossary/command-palette)
- [Algolia current site search overlay](https://www.algolia.com/)

## Strategic Validation Lens

This idea should be evaluated as a strategic hypothesis, not just a design concept.

### Unique Value Proposition

Algolia.com should not merely explain search and discovery. It should let visitors use search-led discovery to find the right page, answer, proof, or next action.

If Ask 2 later passes its kill criteria, the same foundation can become a white-glove content concierge.

### Unfair Advantage

Algolia can credibly turn its website into a live demonstration of the product because search, relevance, facets, recommendations, analytics, and guided discovery are the product.

Agent Studio and neural search become part of the unfair advantage only if Ask 2 passes safety, latency, governance, and eval thresholds.

Risk: if the experience feels like a clever overlay instead of a better customer journey, the advantage collapses into design novelty.

### Value Signals

The concept creates value if it:

- differentiates Algolia's brand
- improves visitor intent routing
- increases product proof on the website
- raises search engagement
- improves content engagement quality
- improves conversion to pricing, docs, demos, get started, and contact sales
- gives leadership a phased path from conventional site to search-led experience

### Cost And Complexity Signals

Ask 1 implementation complexity:

- search index strategy
- content modeling
- analytics instrumentation
- accessibility work
- SEO-safe landing page architecture
- content governance
- experimentation rollout

Ask 2 adds product-surface complexity:

- agent taxonomy and routing logic
- source citation and answer governance
- abuse prevention and rate limiting
- latency engineering and fallback design
- legal, security, and brand approval workflow for high-risk answer categories
- agent quality eval harness

### Metrics To Investigate

Potential north-star metric:

- percentage of qualified visitors who reach a relevant next action through search-led discovery

Activation metrics:

- search open rate
- query start rate
- prompt click rate
- filter use rate
- result click-through rate
- AI answer engagement
- specialist handoff engagement
- content bundle engagement
- clarifying-question completion rate

Journey metrics:

- time to pricing
- time to docs
- time to relevant product page
- contact-sales conversion
- get-started conversion
- case-study engagement

Risk metrics:

- homepage bounce rate
- zero-result rate
- query reformulation rate
- search abandonment
- accessibility task failure
- organic landing page performance
- public prompt-injection success rate
- abuse and bot traffic rate
- LLM cost per anonymous session
- first useful response latency
- high-risk claim accuracy
- citation faithfulness
- agent routing accuracy

### Precommitted Kill Criteria

These thresholds should be set before the Phase 0 spikes. They prevent the team from rationalizing weak results after the fact.

#### Ask 1: Search-Led Website Experience

Pass bar:

- Search takeover still gives users a visible route to all non-negotiable journeys within one interaction.
- Early user tests show at least 4 of 5 participants can reach Pricing, Docs, Product pages, Customer Stories, and Contact Sales without traditional mega-menu guidance.
- GA / Looker does not show that the removed or deemphasized navigation path is a dominant conversion path that search cannot replace.
- The prototype does not make critical journeys slower or less findable than current navigation in early tasks. This is a task-success bar, not a production latency bar.

No-go or redesign bar:

- Search takeover makes critical journeys slower or less findable than current navigation in early tasks.
- The concept depends on hiding SEO-critical pages behind non-crawlable dynamic experiences.
- Search results cannot preserve the current site's major conversion paths.

#### Ask 2: Public Agentic Engagement Layer

Pass bar:

- First useful non-generated response appears in under 300 ms at p95.
- Generated answer begins streaming in under 1.5 seconds at p95 for common journeys.
- Generated answer completes or hands off within 5 seconds at p95 for common journeys.
- Phase 0 screening has zero known critical failures across at least 100 adversarial prompts. This is not a launch pass. Public pilot readiness requires a larger adversarial suite, target 1,000+ prompts, plus continuous production monitoring. Critical means false pricing, security, compliance, roadmap, benchmark, customer-proof, competitor-favorable, confidential-sounding, or off-brand claims.
- High-risk answer categories are extractive and source-backed only.
- Anonymous generated-answer usage has unit and absolute exposure controls. Provisional unit bar: target under $0.01 per anonymous generated session, hard no-go above $0.05 without authentication or throttling. Provisional exposure bar: per-IP daily caps, anonymous daily spend cap, monthly pilot spend ceiling, and automatic circuit breaker before public demo.
- Public abuse controls exist: rate limits, bot controls, caching, fallback to search-only, monitoring, and rollback.
- An eval loop exists before launch: golden conversations, adversarial tests, routing tests, citation faithfulness, latency checks, transcript sampling, and incident response.

No-go or future-only bar:

- Any critical prompt-injection success in the adversarial suite.
- No credible way to keep first useful response fast.
- No owner for high-risk claim approval and freshness.
- No credible anonymous cost control, absolute spend ceiling, or circuit breaker.
- No continuous eval plan.

### Riskiest Assumptions

1. Leadership will value brand differentiation enough to consider changing website architecture.
   - Confidence: medium
   - Validation: show two concepts side by side and test which feels bold but credible.
2. Users will engage with search when it becomes the dominant interaction.
   - Confidence: medium
   - Validation: analyze current site search usage, query behavior, and post-search conversion in GA / Looker.
3. Current nav categories can be translated into progressive search facets without confusing users.
   - Confidence: medium
   - Validation: create IA-to-search mapping and test prototype tasks across all non-negotiable journeys.
4. The concept can preserve SEO and content discoverability.
   - Confidence: low to medium
   - Validation: identify SEO-critical landing pages and design search-led entry paths without removing crawlable content.
5. A traditional frame with search takeover can move the CMO toward the search-only future state.
   - Confidence: medium
   - Validation: frame the first concept as a phased wedge and compare it against the radical concept in executive-style review.
6. Agentic engagement will feel premium and useful, not like a generic chatbot.
   - Confidence: medium
   - Validation: prototype multiple engagement modes: chat plus cards, specialist handoff, proof bundle, implementation plan, and sales handoff summary.
7. Algolia Agent Studio and neural search can credibly support the proposed story.
   - Confidence: unknown
   - Validation: research current product capabilities and avoid unsupported claims in the executive concept.
8. A public unauthenticated agentic homepage can be made safe against prompt injection, abuse, and cost attacks.
   - Confidence: low until researched
   - Validation: create a threat model, abuse model, rate-limit plan, and adversarial eval suite.
9. The agentic experience can be fast enough to reinforce Algolia's brand promise.
   - Confidence: unknown
   - Validation: define latency budget and prototype instant search-first response with progressive generation.
10. High-risk generated answers can be governed without making the experience useless.
   - Confidence: medium
   - Validation: define claim taxonomy, approved sources, extraction-only categories, and human handoff rules.

## Working Principle

The goal is not to remove information architecture. The goal is to make information architecture discoverable, conversational, faceted, personalized, and action-oriented inside a search-led interface.

The current Algolia.com search overlay is an important baseline. It already contains many of the pieces this exploration would elevate:

- a prominent "Search Algolia or Ask AI" input
- an AI mode toggle
- source filters with counts: Documentation, Support, Blog, Website, Developers, Resources, Academy, Customer Stories
- AI-style suggested questions
- conventional query suggestions
- grouped "Products & Resources" results
- thumbnails and page metadata
- a "Show more results" expansion path

This means the concept is not a from-scratch invention. It is a question of architectural promotion: can the current overlay pattern become the primary website experience instead of a secondary layer on top of a conventional SaaS site?

The current navigation screenshots add another key constraint. Algolia has at least three overlapping taxonomies today:

- source taxonomy from search: Documentation, Support, Blog, Website, Developers, Resources, Academy, Customer Stories
- site navigation taxonomy: Products, Solutions, Pricing, Developers, Resources, Company, Partners, Support
- mega-menu taxonomy: product families, industries, use cases, departments, integrations, developer paths, customer/resource/tool groupings

The redesign must not naively show all of these as parallel filters. The work is to progressively translate them into an evolving journey system: broad intent first, then audience/use case, then content type, then product capability, then action.

Current navigation should not disappear. It should be translated into:

- query suggestions
- intent shortcuts
- facets and filters
- promoted answers
- role-based paths
- content cards
- comparison modules
- demo actions
- recent searches
- popular journeys
- autocomplete categories
- "I want to..." commands
- navigational results
- answer panels
- guided refinements
- saved or shared search journeys

## Six-Level Navigation-To-Search Mapping Hypothesis

Current nav should become progressive search guidance, not a flat list of filters.

### Level 1: Visitor Intent

Purpose: help the user say what job they came to do.

Potential filters/chips:

- Explore products
- Solve a business problem
- Build with Algolia
- Compare pricing
- Learn from customers
- Find resources
- Get support
- Talk to sales

Current nav sources:

- Products
- Solutions
- Pricing
- Developers
- Resources
- Support
- Login / Get started / Fix your search

### Level 2: Audience Or Role

Purpose: adapt the journey to the user's mental model.

Potential filters/chips:

- Ecommerce leader
- Product manager
- Developer
- Search architect
- Merchandiser
- Marketing leader
- Enterprise buyer
- Partner

Current nav sources:

- Departments: Digital Experience, Ecommerce, Engineering, Merchandising, Product Management
- Developers menu
- Partner / Company / Support utilities

### Level 3: Business Context

Purpose: translate "Solutions" into guided discovery.

Potential filters/chips:

- Ecommerce
- B2B Commerce
- Marketplaces
- Media
- SaaS
- Higher Education
- Grocery
- Fashion
- Auto Parts

Current nav sources:

- Solutions > Industries
- Solutions > Use Cases
- Solutions > Integrations

### Level 4: Product Capability

Purpose: expose Algolia product architecture only after the visitor's intent is clearer.

Potential filters/chips:

- Search
- Recommendations
- Personalization
- Analytics
- Browse
- Agent Studio
- Generative Experiences
- Ask AI
- MCP Server
- Data Enrichment
- Data Transformation
- Integrations
- Data Centers
- Security & Compliance

Current nav sources:

- Products mega-menu
- AI Search & Retrieval
- Artificial Intelligence
- Intelligent Data Kit
- Infrastructure

### Level 5: Content Type

Purpose: let users choose the kind of evidence or destination they need.

Potential filters/chips:

- Product page
- Documentation
- API guide
- Customer story
- Blog
- Webinar
- Academy
- Support article
- Tool
- Integration
- Pricing

Current nav sources:

- current search source filters
- Resources mega-menu
- Developers mega-menu
- Customer Stories

### Level 6: Conversion Action

Purpose: help the journey end somewhere useful.

Potential actions:

- Get started
- Contact sales
- Fix your search
- View pricing
- Open docs
- Book demo
- Read case study
- Compare products
- Login

Current nav sources:

- CTA buttons
- Pricing
- Contact sales / Get started paths
- Login

### Progressive Journey Example

Query: "I want better ecommerce search"

1. Detect intent: solve a business problem.
2. Offer business context facets: Ecommerce, B2B Commerce, Marketplaces, Fashion, Grocery.
3. Offer capability refinements: Search, Recommendations, Personalization, Merchandising Studio, Analytics.
4. Offer content types: product overview, customer story, pricing, docs, demo.
5. Present answer panel: what Algolia can do, why it matters, relevant proof.
6. Present conversion actions: "Explore ecommerce search," "See retail customer stories," "Estimate impact," "Contact sales."

This is the core UX idea: each click narrows the journey while showing Algolia's discovery capabilities in action.

## Agentic Content Engagement Layer

The next layer is not just search and not just chat. The end vision is a conversational, navigational, white-glove, concierge-like content engagement experience powered by an Algolia agentic framework and supported by Algolia neural search.

Search detects intent. Agents engage the visitor.

The website should behave less like a static site and more like a staffed executive briefing room: a general concierge greets the visitor, understands their intent, brings in the right specialist, assembles the right content, and guides the visitor toward the next useful action.

### Core Principle

The first click or first query is the point of engagement. From that moment, the site should stop behaving like a brochure and start behaving like a guided service.

This does not mean a one-dimensional chatbot. The engagement layer can include:

- conversational answers
- guided content cards
- faceted refinements
- specialist agent handoffs
- curated proof bundles
- customer examples
- implementation paths
- product comparisons
- pricing guidance
- support triage
- suggested next questions
- inline demos
- video or avatar moments
- "build me a plan" outputs
- handoff to sales, docs, support, or academy

### Agent Taxonomy Hypothesis

#### 1. Concierge Agent

Role: first interface for ambiguous or broad visitor intent.

When it appears:

- first search
- first nav click in the takeover concept
- vague questions like "What does Algolia do?" or "Can Algolia help us?"

Content access:

- high-level website pages
- product overview pages
- solution pages
- customer stories
- pricing overview
- resource center
- popular journeys
- analytics-derived popular questions

Jobs:

- classify intent
- ask one useful clarifying question if needed
- route to the right specialist
- assemble a short answer with next-step options
- avoid overwhelming the visitor with the full sitemap

#### 2. Product Specialist Agent

Role: explain Algolia capabilities and map them to the visitor's business problem.

When it appears:

- user asks about Search, Recommendations, Personalization, Browse, Analytics, Agent Studio, Ask AI, MCP Server, Generative Experiences, Data Enrichment, Data Transformation, Integrations, Infrastructure, Security, or Compliance
- user is comparing capabilities
- user wants to know "which product do I need?"

Content access:

- product pages
- capability documentation
- demo videos
- product release notes
- implementation guides
- architecture diagrams
- customer proof by product
- competitive/comparison pages if available

Jobs:

- explain what the product does
- recommend capability combinations
- show relevant proof
- route developers to docs
- route buyers to business outcomes and sales CTAs

#### 3. Industry / Use-Case Specialist Agent

Role: translate Algolia into the visitor's business context.

When it appears:

- user mentions Ecommerce, B2B Commerce, Marketplaces, Media, SaaS, Higher Education, Grocery, Fashion, Auto Parts, or another industry
- user asks outcome questions like "increase conversion," "improve product discovery," "reduce zero results," or "scale search"

Content access:

- industry pages
- use-case pages
- customer stories
- benchmarks and proof points
- best-practice resources
- relevant product capability pages
- ROI / impact tools if available

Jobs:

- explain best practices for the business context
- bring up relevant customer examples
- connect use case to product capabilities
- suggest a buyer journey path
- guide to contact sales or impact estimation

Example:

If the visitor says "We are B2B commerce and our buyers cannot find parts," the concierge should hand off to an industry/use-case specialist that can discuss B2B commerce search, catalog complexity, synonyms, part numbers, merchandising, recommendations, implementation patterns, and customer references.

#### 4. Developer / Integration Agent

Role: help technical visitors evaluate and implement.

When it appears:

- user asks about API integration, SDKs, React InstantSearch, UI components, MCP, integrations, data ingestion, indexing, front-end implementation, or architecture
- user selects Developers / Docs

Content access:

- documentation
- API references
- code examples
- quick-start guides
- integrations
- UI components
- status pages
- support docs
- GitHub / Code Exchange resources if available

Jobs:

- answer implementation questions
- recommend docs by stack
- provide quick-start paths
- explain integration trade-offs
- escalate to support when needed

#### 5. Academy / Education Agent

Role: teach visitors who are not ready to buy or implement yet.

When it appears:

- user asks "how does this work?"
- user wants learning resources
- user is exploring concepts like neural search, personalization, RAG, merchandising, or relevance
- user chooses Academy, webinars, guides, or resource center paths

Content access:

- Academy
- webinars
- blog explainers
- whitepapers
- demo videos
- tutorials
- conceptual docs

Jobs:

- recommend learning paths
- sequence content from beginner to advanced
- create a short curriculum
- route to product or developer specialists when readiness increases

#### 6. Support Agent

Role: handle existing-customer or technical issue intent.

When it appears:

- user asks for troubleshooting, account help, integration errors, API issues, indexing problems, ranking problems, or support
- user selects Support

Content access:

- support knowledge base
- documentation
- status pages
- known issues
- troubleshooting guides
- contact support paths

Jobs:

- triage issue type
- offer likely fixes
- route to docs or support ticket
- avoid mixing support content into buyer journeys unless the intent is clearly support

#### 7. Sales / Solution Consultant Agent

Role: guide high-intent business visitors toward a commercial conversation.

When it appears:

- user asks about pricing, enterprise plan, migration, business impact, ROI, security review, procurement, or "talk to someone"
- user has progressed through enough buyer intent signals

Content access:

- pricing pages
- packaging and plan information
- security/compliance pages
- customer stories
- ROI tools
- comparison pages
- sales handoff forms
- demo scheduling paths

Jobs:

- summarize fit
- identify missing qualification context
- propose next best action
- prepare a sales handoff summary
- preserve user context when handing to human sales

### Agent Orchestration Hypothesis

The system should not expose every agent at once. The visitor should experience one coherent concierge, while the underlying system routes to specialists.

Suggested orchestration:

1. Detect intent from query, click, source page, referrer, account status, and GA / Looker segment if available.
2. Classify the journey by intent, role, business context, product capability, content type, and conversion readiness.
3. Select a lead agent.
4. Retrieve content from the appropriate corpus.
5. Produce an answer plus a visible content bundle.
6. Offer progressive next actions.
7. Handoff to another specialist when intent deepens or changes.
8. Preserve the journey as context for sales, docs, support, or login.

### Engagement Modes To Explore

The agentic layer should not be limited to chat. Possible engagement modes:

- Chat plus cards: answer on the left, curated content and actions on the right.
- Guided search journey: every answer becomes filters, result modules, and next-step chips.
- Executive concierge: a polished brief with recommended path, proof, and CTAs.
- Specialist handoff: "I am bringing in the B2B commerce specialist."
- Avatar moment: used sparingly for high-level welcome, demo narration, or guided explanation.
- Interactive workbench: user can build a custom evaluation plan, implementation plan, or search improvement plan.
- Proof bundle: agent assembles customer stories, product pages, docs, and ROI materials into a shareable package.
- Sales handoff summary: agent captures context and creates a concise briefing for the sales team.

### Key Design Risk

If the agent layer becomes "chatbot on top of website," the idea is not radical enough and may feel generic. The winning version is an agentic content engagement system where conversation, search, navigation, proof, and conversion are one experience.

The strategic question is: what should Algolia.com feel like if every visitor had a white-glove search and discovery specialist guiding them?

### Public Agent Risk Surface

This is a public unauthenticated marketing surface, not a logged-in product surface. That changes the risk profile. Anyone can interact with the agent layer: prospects, customers, competitors, bots, scrapers, prompt-injection testers, and people deliberately trying to create embarrassing screenshots.

The concept cannot be considered executive-ready unless it addresses these launch blockers:

- Prompt injection and public embarrassment: the agent may be manipulated into saying false, off-brand, competitor-favorable, confidential-sounding, or screenshot-worthy claims.
- Abuse and cost attacks: an open homepage agent can create unlimited LLM/retrieval calls unless rate limits, bot controls, quotas, caching, and degradation paths exist.
- Latency contradiction: Algolia's brand promise is speed. If intent detection, agent routing, retrieval, and generation make the homepage feel slower than a brochure page, the experience undermines the pitch.
- Legal and brand exposure: pricing, security, compliance, enterprise terms, performance claims, and roadmap answers need stricter approval and freshness controls than general marketing content.
- Continuous quality: agent behavior cannot be trusted by design intent alone. It needs ongoing evaluation, transcript sampling, automated tests, human review, and production feedback loops.

These are not reasons to abandon the concept. They are reasons the research plan needs a safety, performance, governance, and evaluation track before prototype claims become executive claims.

## Interview Focus Areas

Keep live interviews short. Use them to resolve decisions, not to admire the problem.

Ask 1 focus:

- What must the leadership artifact prove in two minutes?
- Which journeys cannot get worse: pricing, docs, products, solutions, customer stories, contact sales, login?
- Which current navigation paths drive real conversion or trust?
- Where does current site search already outperform browsing?
- What would make a CMO reject search takeover?
- What GA / Looker numbers define upside, risk, timing, and rollout priority?

Ask 2 conditional focus:

- Does Phase 0 keep the public agentic layer in scope?
- If yes, who owns safety, latency, high-risk claims, abuse controls, and evals?
- Which agentic flows can be shown as vision without implying launch readiness?

## Supporting Research Backlog

Use this section as detail behind the sprint plan above. It is not a second project plan.

### Backlog: Kill-Switch Spikes And Executive Framing

Objective: test the assumptions that could kill the agentic layer early, collect enough directional evidence for Ask 1, then create the CEO/CMO-ready pitch frame.

Owner and timing:

- Interim owner: Arijit until an Algolia-side owner is assigned.
- Required Phase 0 inputs: web analytics, web/design, product marketing, and a security reviewer if Ask 2 remains in scope.
- Target duration: 5 business days after analytics access and reviewer availability are confirmed.

Research tasks:

- Confirm the precommitted safety and latency thresholds.
- Run a novelty / prior-attempts desk check: identify whether any B2B SaaS or enterprise software company has tried search-led marketing-site navigation, what pattern they used, and whether public evidence shows success, retreat, or failure.
- Run a public-agent safety spike: prompt injection, screenshot attack, anonymous abuse, scraping, LLM cost attack, and fallback requirements.
- Run a latency spike: target first useful response time, instant search-first response model, progressive generation model, and fallback states.
- Run a lightweight buyer-premise check before the full crawl: 3 to 5 quick reactions from sales, solution consulting, or recent buyer-call notes.
- Pull directional GA / Looker numbers if available: search usage rate, search-to-conversion comparison, top nav clicks, homepage first-click paths, time to pricing/docs/contact sales, and top landing pages.
- Write the strongest case against the concept from the perspective of a CMO who prefers the current site model.
- Separate Ask 1 and Ask 2 in the narrative, budget logic, and phased roadmap.
- Decide whether the agentic layer can remain in the prototype as a vision layer, a bounded demo, or only a future-state appendix.
- Produce the one-page executive concept board after the above checks. If checks are incomplete, label Ask 2 conditional on the board.

Outputs:

- Ask 1 / Ask 2 decision frame
- Novelty / prior-attempts note
- Public safety go/no-go note
- Latency go/no-go note
- Buyer-premise note
- Directional analytics note
- Strongest-case-against note
- Updated scope recommendation
- Executive one-page concept board

### Backlog: Current Algolia.com IA Audit

Objective: understand everything the current site is doing before replacing its interface model.

Research tasks:

- Crawl current Algolia.com navigation, footer, sitemap, key landing pages, and conversion flows.
- Audit the current Algolia.com search overlay, including filters, source counts, AI-mode prompts, suggestions, result groupings, result metadata, and expansion paths.
- Build a complete taxonomy of top-level nav, subnav, page types, CTAs, audiences, use cases, product concepts, and resource types.
- Identify repeated IA patterns: product pages, solution pages, industry pages, comparison pages, docs paths, pricing paths, contact sales paths, customer proof, resources, partners, company pages.
- Map each page to likely user intent.
- Identify which pages are SEO acquisition pages versus conversion pages versus trust-building pages.
- Compare the explicit website nav taxonomy against the implicit search-source taxonomy.
- Extract every mega-menu item from Products, Solutions, Developers, and Resources.
- Classify every item by visitor intent, audience, business context, product capability, content type, and conversion action.

Outputs:

- Current IA map
- Sitemap inventory
- Content-type taxonomy
- User-intent matrix
- "Must preserve" destination list
- Current search overlay teardown
- Explicit nav versus search-source taxonomy comparison
- Navigation-to-search mapping table

### Backlog: Search Pattern And Buyer Research

Objective: study search-led navigation patterns and validate the idea against real buyer and developer behavior.

Research tasks:

- Analyze the provided Eyebuydirect and Lacoste examples as search-plus-navigation hybrids.
- Find additional best-in-class examples of search-dominant ecommerce and content discovery interfaces.
- Study command palettes in modern SaaS tools.
- Study developer documentation search patterns.
- Study AI answer/search hybrids such as answer panels, prompt chips, citations, refinements, and recommended next actions.
- Compare homepage search patterns from Google, Perplexity, Stripe docs, Vercel docs, AWS, Shopify, ecommerce leaders, and marketplace sites.
- Interview 2 to 3 Algolia sales or solution consulting stakeholders about common buyer paths, objections, and discovery needs.
- Review win/loss notes, call snippets, or sales discovery summaries if accessible.
- Usability-test early journey sketches with at least 5 participants total across buyer, developer, and existing-customer/support-oriented users. Treat this as directional evidence, not statistically valid proof.

Outputs:

- Pattern library
- Interaction pattern scorecard
- Search component inventory
- Screenshot board with annotations
- Buyer journey evidence notes
- Sales / solution consulting input summary
- Early usability findings, explicitly labeled directional unless sample size grows

### Backlog: IA Translation Model

Objective: translate current Algolia.com navigation into search-native UI components.

Research tasks:

- Convert each top-level nav category into candidate search affordances.
- Convert current search overlay elements into candidate homepage-level architecture.
- Identify which IA elements should become facets, chips, promoted modules, suggestions, result categories, answer panels, or persistent utility links.
- Define the homepage pre-query state.
- Define the autocomplete state.
- Define the post-query result state.
- Define the navigational query state.
- Define the zero-result and ambiguous-intent states.

Outputs:

- IA-to-search translation table
- Query intent taxonomy
- Component model
- State model

### Backlog: Agentic Engagement Model

Objective: define the agent framework that sits on top of search-led IA and turns discovery into white-glove content engagement. Proceed deeply only if Phase 0 safety and latency spikes support keeping the agentic layer in scope.

Research tasks:

- Define agent taxonomy: concierge, product specialist, industry/use-case specialist, developer/integration, academy/education, support, sales/solution consultant.
- Define routing logic: what intent, role, query, click, or behavioral signal activates each agent.
- Define content access by agent: website pages, product pages, docs, support, blog, academy, customer stories, tools, pricing, security, integrations, events, demo videos.
- Define answer formats: chat response, content cards, guided facets, recommended journey, proof bundle, implementation plan, sales handoff summary.
- Define specialist handoff rules: when to stay generalist, when to bring in a specialist, when to offer human contact.
- Define trust guardrails: citations, source visibility, confidence, escalation, compliance boundaries, support boundaries.
- Research current Algolia Agent Studio and neural search capabilities to avoid proposing a concept that cannot be credibly connected to the product.
- Map each non-negotiable journey to the likely agent flow.

Outputs:

- Agent taxonomy and responsibilities
- Agent-content access matrix
- Agent routing model
- Agent interaction state model
- Prototype agent scripts and sample conversations
- Guardrails and feasibility notes

### Backlog: Public Agent Risk And Governance Model

Objective: define what must be true for a public unauthenticated agentic homepage to be safe, fast, governable, and executive-demo-ready. Treat this as a separate Ask 2 workstream, not a design detail inside Ask 1.

Research tasks:

- Threat-model prompt injection, jailbreaks, competitor manipulation, false public claims, screenshot attacks, scraping, bot abuse, and deliberate LLM cost attacks.
- Define anonymous usage controls: rate limiting, quotas, bot detection, WAF/CDN controls, abuse monitoring, caching, and graceful degradation.
- Define latency budgets for each layer: search suggestions, intent detection, agent routing, retrieval, generation, specialist handoff, and full answer rendering.
- Define fallback UX for slow or unavailable agentic responses: instant search results first, streaming answer second, cached answer, curated links, or static landing page fallback.
- Define regulated or high-risk answer categories: pricing, security, compliance, legal terms, roadmap, customer claims, benchmark claims, competitive claims, and procurement.
- Define source-of-truth and approval workflow by answer category.
- Define what the agent can generate freely, what must be extractive/cited, what must route to approved pages, and what must hand off to humans.
- Define eval harness requirements: golden conversations, adversarial prompts, claim accuracy tests, routing tests, latency tests, refusal tests, and regression checks.
- Define ongoing quality loop: transcript sampling, thumbs up/down, conversion outcomes, human review queue, incident reporting, rollback controls, and content freshness checks.

Outputs:

- Public agent threat model
- Abuse and cost-control requirements
- Latency budget and fallback model
- Regulated-claim governance matrix
- Agent quality eval plan
- Public launch readiness checklist

### Backlog: Strategic Feasibility And Critique

Objective: test whether the concept is useful, credible, and defensible.

Research tasks:

- Evaluate buyer comprehension risk.
- Evaluate SEO implications.
- Evaluate accessibility implications.
- Evaluate stakeholder routing and enterprise trust needs.
- Evaluate brand distinctiveness.
- Evaluate how much conventional navigation must remain.
- Compare radical, balanced, and conservative versions of the concept.
- Evaluate whether GA and Looker data supports "search takeover after engagement" as a phased strategy.
- Identify which questions require named stakeholder input from Legal, Security, Sales Ops, Support, Brand, Product Marketing, and Web Platform.
- Conduct targeted stakeholder interviews for ownership questions that cannot be answered by the design exploration alone.

Outputs:

- Argument for the concept
- Argument against the concept
- Mitigation strategy
- Recommended design stance
- Analytics-informed adoption argument
- Stakeholder dependency map
- Ownership and approval open-questions list

### Backlog: GA And Looker Analysis

Objective: use behavioral data to understand where current navigation works, where users already search, and where a search-led journey could improve engagement and conversion.

Requested data:

- Top landing pages by sessions, engaged sessions, conversion rate, and source/medium.
- Top navigation clicks by menu item, CTA, page, device, and visitor type if tracked.
- Site search usage rate: percentage of sessions that open search, type a query, select a suggestion, select a filter, click a result, or click "show more results."
- Search query report: top queries, zero-result queries, reformulated queries, AI-mode prompts, clicked results, and conversion after search.
- Search source filter usage: Documentation, Support, Blog, Website, Developers, Resources, Academy, Customer Stories.
- Path exploration from homepage and top landing pages: first click, second click, exit points, loops, and dead ends.
- Conversion path analysis for non-negotiable journeys: Products, Solutions, Pricing, Developers / Docs, Resources, Customer Stories, Contact Sales, Login.
- Segment analysis: new vs returning, known account vs anonymous, paid vs organic, direct vs referral, geography, device, and industry/account segment if available.
- Internal search to conversion: sessions with search versus sessions without search, measured against CTA clicks, form starts, form submits, pricing views, docs engagement, and login.
- Page depth and time-to-destination: how many clicks users need today to reach pricing, docs, product pages, customer stories, and contact sales.
- Content engagement: scroll depth, video plays, resource downloads, webinar registrations, demo tool usage, and case-study engagement.
- SEO dependency: organic entrances by page type and query theme, so the concept does not accidentally damage acquisition pages.

Why this matters:

- It shows whether users already prefer search when intent is high.
- It identifies which nav categories deserve first-class search facets.
- It tells us which journeys are fragile and must be preserved.
- It reveals confusing taxonomy through repeated searches, loops, exits, and reformulations.
- It helps decide whether "traditional frame, search takeover" is a better CMO adoption path than full search-only.
- It lets the executive pitch use evidence instead of taste: the site can evolve toward search where behavior already points that way.

### Backlog: Concept Architecture

Objective: define the mockup before visual design.

Research tasks:

- Define 2 website frame concepts and 1 optional capability layer.
- For each website frame, define homepage, search expansion, results page, product page, pricing path, developer path, and contact-sales path.
- For the optional agentic layer, define only the flows that Phase 0 permits.
- Specify functional flows for the HTML prototype.
- Define required data model for mocked results.
- Define what must be clickable and what can be illustrative.

Outputs:

- Concept sketches
- Flow map
- Prototype scope
- Mock data schema

### Backlog: Prototype Prompt And Build Plan

Objective: create the final prompt and build plan for the HTML mockup.

Research tasks:

- Convert research findings into visual and interaction requirements.
- Define final prototype routes and states.
- Define content copy and sample queries.
- Define success criteria for the prototype.
- Define validation checklist for usability, responsiveness, and narrative clarity.

Outputs:

- Final build prompt
- Prototype implementation plan
- Validation checklist

## Early Concept Directions

### Website Frame 1: CMO Wedge, Search Takeover

The page initially looks close enough to a modern SaaS homepage for a CMO to feel oriented: brand, positioning, proof, high-level paths, and conversion cues are visible. But every meaningful interaction routes into a search-led discovery experience. Clicking Products, Solutions, Pricing, Developers, Resources, or Customer Stories does not open a static mega-menu or brochure page first; it opens an intent-aware search layer with suggestions, facets, promoted answers, relevant pages, buyer journeys, and AI guidance.

This concept should reuse and promote the current Algolia search overlay where appropriate: source filters, AI prompts, suggestions, grouped results, thumbnails, and "show more" behavior become the raw material for the takeover layer.

Best for: executive adoption, because it preserves familiar homepage confidence while demonstrating that Algolia can own the engagement layer.

Risk: if the traditional frame is too strong, the idea may look like a better site search overlay rather than a category-changing website model.

Suggested pitch: "We do not need to ask the market to understand the future immediately. We can keep the front door familiar, then make every click prove Algolia."

### Website Frame 2: Search-First North Star

Almost all chrome is removed. The homepage is a large Algolia search box with dynamic prompt chips such as "Compare Algolia plans," "Build ecommerce search," "Find AI search docs," and "See customer stories for retail."

The search box handles navigation, AI answers, and guided buyer journeys. Current top-level navigation becomes facets, intent chips, result categories, and utility fallbacks.

Best for: executive wow, category-defining future-state pitch.

Risk: can underserve users who need orientation before they know what to ask.

### Conditional Capability Layer: Agentic Concierge

The site becomes a guided concierge. The visitor asks a question or clicks a path, then the system detects intent, retrieves source-backed content, and brings in the right specialist: product, industry/use-case, developer, academy, support, or sales.

This concept can include command-palette behavior, live product demonstration, specialist handoff, proof bundles, implementation plans, and sales handoff summaries.

Best for: long-term differentiation and Agent Studio / neural search proof.

Risk: this is a separate public AI product surface. It needs safety, latency, governance, and eval approval before it can be pitched as shippable.

## Immediate Next Step

Confirm the precommitted kill criteria, run the Phase 0 safety and latency spikes, pull directional buyer and analytics evidence, write the strongest case against, then create the executive one-page concept board. Only after that should the work proceed into the full IA crawl, pattern research, agent modeling, and prototype scope.
