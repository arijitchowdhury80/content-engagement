# UI/UX constraints

- Use native buttons, existing widget tokens, and the existing header/pill visual language.
- Supporting telemetry must never compete visually with either answer.
- A disabled control must explain why and how to recover; use `aria-label` and `title`.
- Keyboard focus must remain visible and Enter/Space must activate the Compare control before it
  locks.
- Token updates use an `aria-live="polite"` supporting status.
- Interactive targets must be at least 24×24 CSS pixels; 44×44 is preferred where header space
  permits.
- Verify 375, 768, 1024, and 1280 pixel widths. The existing stacked Compare breakpoint remains.
- Use text plus state—not color alone. Respect reduced motion; no new animation is required.
- Never insert unescaped question, answer, error, or upstream content with `innerHTML`.
- Contrast must meet WCAG 2.2 AA using existing Algolia widget variables.
