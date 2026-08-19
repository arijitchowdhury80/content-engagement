# Algolia Team Demo and UAT

Open `index.html` in a browser to present the eight-slide Algolia Content Engagement team briefing. Use the left and right arrow keys, Page Up and Page Down, Space, Home, End, or the on-screen controls.

The verified 8/8 closeout deck is published to the internal Jahia app at this unlisted manual URL:

`https://tmp-content-eng-algolia.cloud.jahia.com/files/live/sites/www/files/content-engagement-team-uat.html`

The hosted route is intentionally absent from website navigation and carries `noindex, nofollow` headers.

The canonical written source is `content-engagement-demo-uat-test-cases.md`.

The standalone HTML embeds the written guide and readable previews from the final authoritative evidence set, so the briefing remains useful when opened offline. Each evidence preview opens directly from the standalone file without depending on a repository-relative image path.

The evidence baseline is `docs/evidence/visitor-intelligence/2026-08-19-jahia-headed-final/`. It is one fresh, headed browser capture set against the internal Jahia surface for all eight journeys. `S1-retry` is the authoritative S1 capture and replaces the earlier failed S1 attempt.

The baseline verdict is 8/8 validated journeys. Every capture proves reset isolation, the expected trigger and greeting cardinality, one handoff, a successful orchestrator response, grounded source presentation, exactly one discovery question, and conversation continuity. S1 and S2 also prove deterministic specialist routing; when specialist output did not satisfy the evidence gate, it was demoted and the grounded orchestrator answer remained visible.

The fixed scenario set is:

1. T1 Individual Product Engagement
2. T2 Product To Documentation
3. B1 Explore A Business Priority
4. B2 See How Another Brand Solved It
5. C1 Product To Pricing
6. C2 Solution To Pricing
7. S1 Developer And Implementation Depth
8. S2 Resource And Research Depth

Testers do not follow a scripted question or answer. After the proactive greeting, they choose any relevant chip or type whatever response they naturally want to give. The system must preserve the journey and work intelligently with that response.

Every scenario tests the complete chain: Reset, Browse, Track, Compile context, Trigger, Personalized greeting, Natural tester response, Handoff, Orchestrator, Specialist when appropriate, Grounded answer, and Discovery question.

Before each scenario, click the Assistant logo to clear Algolia-owned profile, session, event, opportunity, greeting, and chat state.
