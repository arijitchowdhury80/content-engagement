# Landing Page Options Design

## Source

- Figma URL: https://www.figma.com/design/5DkPHASwX5HwFgG0WFEDhS/Landing-Page-options?node-id=0-1&p=f&t=0ERmiu2HIJ2SMpku-0
- Figma file key: `5DkPHASwX5HwFgG0WFEDhS`
- Figma file name reported by the page bootstrap: `Landing Page options`
- Node requested: `0:1`
- Access status on 2026-08-17: blocked. Anonymous fetches reach Figma, but the file requires view permission.

## Access Evidence

Direct page fetch returned the Figma permissions-request shell:

```text
<meta name="entrypoint_variant" content="request_permissions" />
request_view_permissions.page_type = "design"
request_view_permissions.file_name = "Landing Page options"
request_view_permissions.file_key = "5DkPHASwX5HwFgG0WFEDhS"
```

Direct file API fetch returned:

```text
403: You don't have permission to view this file.
```

The oEmbed endpoint returned:

```text
404: Not found.
```

## Current Design Brief

Create a landing-page design system direction for the Algolia Content Engagement work, grounded in the referenced Figma file once view access is available.

Until the Figma frames can be inspected, this document is only the intake shell and evidence record. Do not treat it as a visual spec.

## Repo Context

The current product surface is an Algolia.com discovery concierge:

- `frontend/chat-widget/algolia-chat-theme-algolia.js` owns the current chat widget Algolia theme.
- `testing/team-uat/styles.css` owns the branded UAT presentation surface.
- `local-sites/algolia-com-parity/index.html` is the local parity harness for Algolia.com content and chat testing.

Existing visual constants already in the repo:

- Primary Algolia/Xenon blue: `#003dff`
- Core text: `#23263b` in the widget theme; `#021046` / `#2f3447` in the UAT deck.
- Fonts: `Sora` for primary UI, `JetBrains Mono` for technical labels.
- Radius: chat widget uses an 8-24px scale; UAT deck uses 6-16px depending on surface.
- The widget theme cites `@algolia/satellite@2.14.0` color sources.

## Figma Capture Checklist

When view access is available, capture the following before implementation:

1. Frames and options: list every landing-page option, frame name, viewport size, and intended use.
2. Layout system: page grid, max widths, breakpoints, section rhythm, spacing scale.
3. Typography: font family, sizes, weights, line heights, and heading hierarchy.
4. Color tokens: backgrounds, text, borders, accents, semantic states, gradients if any.
5. Components: navigation, hero, CTA buttons, cards, testimonial/proof blocks, forms, footers, chat/concierge placement.
6. Imagery: required assets, crops, alt intent, and whether assets are inspectable or need export.
7. Interaction states: hover, focus, active, disabled, responsive behavior, reduced-motion behavior.
8. Content model: headlines, supporting copy, CTAs, proof points, and which text is placeholder.
9. Implementation delta: what can reuse existing repo tokens/components, what needs new shared tokens, and what should stay local to the landing page.

## Proposed Design-System Direction

Use the Figma file as the visual source, but normalize it into repo-owned primitives:

- `tokens`: color, type, spacing, radius, shadow, motion, and z-index decisions shared by landing page, chat widget, and UAT surfaces.
- `components`: repeatable landing-page parts with clear state contracts.
- `patterns`: section-level recipes such as hero, proof band, feature comparison, conversion CTA, and embedded concierge prompt.
- `governance`: source provenance, screenshot evidence, accessibility checks, and update rules when Figma changes.

## Open Blocker

The Figma file must be shared with view access, or exported as screenshots/PDF/assets, before this design can become implementation-ready.
