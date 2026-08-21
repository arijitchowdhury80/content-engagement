# Design thinking

## Mental model

The artifact is a CEO demo script and story board. Arijit should be able to scan it like a runbook, then read it like a narrative. The confusing version would be an eight-test checklist pretending to be an executive story, or a narrow three-path story that sounds like the runtime only supports those three routes.

## Information architecture

- Hero: The thesis, audience, and 10-minute promise.
- Primary: Three evening-demo use cases, each with timing, click path, screens, presenter language, expected system behavior, value, evidence, and fallback.
- Secondary: Proof boundaries, Ask AI comparison, and UAT matrix reconciliation.
- Supporting: File links, trigger names, environment caveats, and historical evidence labels.

## Interaction flow

1. Read the thesis and bar.
2. Review the three-use-case timeline.
3. Open each act and inspect the click path, screen pulls, and speaker language.
4. Use the backup section to decide what needs runtime or demo-room prep.

Empty state does not apply. Loading and error states are represented as backup demo paths.

## Cognitive load budget

The first viewport has four visible chunks: thesis, audience, stakes, and timeline. Detail is moved into sections and compact grids so the review page does not become a wall of copy.

## Emotional journey

- Opening: Raise the stakes and frame Content Engagement as strategic.
- Act 1: Show on-page intent recognition for Product and Solution pages as one capability.
- Act 2: Show proof progression from Grocery to H-E-B.
- Act 3: Show commercial evaluation from Enterprise Search to Pricing.
- Evidence cutaway: Show this can scale as an Algolia use case without implying only three paths work.
- Close: Ask for permission to package and prove it, not for blind belief.

## Design pre-mortem

- Risk: Looks like a generic AI deck. Mitigation: Algolia tokens, concrete routes, and evidence pulls.
- Risk: Overclaims current runtime. Mitigation: implemented, controlled-demo-only, and roadmap labels.
- Risk: Competes with Ask AI in a defensive way. Mitigation: position Content Engagement as a use case that uses existing Algolia capabilities in a new light.
- Risk: Canonical demo routes sound like hardcoded limits. Mitigation: describe them as selected reliable showcase paths through a broader category-driven journey graph.
- Risk: Too much technical machinery. Mitigation: technical flow appears only where it strengthens the business story.
