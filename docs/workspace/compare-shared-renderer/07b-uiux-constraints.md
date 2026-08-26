# UI/UX constraints — answer evidence controls

- Sources, Judge, current-response token telemetry, and Compare are Supporting-tier pills in one answer footer.
- Keep exactly one Compare control. It is absent until an answer exists and must preserve pressed state, keyboard focusability, and accessible label.
- Never place Compare or token telemetry in the application header.
- Native `<button>`, visible 2px focus indicator, at least 24px target height, and text plus color for state.
- Preserve Algolia theme variables and existing typography; do not introduce a new aesthetic.
- At 375px and 768px the footer may wrap without overlapping sources or the judge badge.
- At 1024px and 1280px the controls remain on the same footer row where space permits.
- Loading, success, and contained production error states remain visible in the production panel.
- Reduced-motion behavior remains in place for the button transition.
