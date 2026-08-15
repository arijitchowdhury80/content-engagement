UI/UX constraints applied

The referenced global UIUX SOP file was unavailable at the expected local path, so this captures the applicable constraints for this widget change.

- Emphasis: answer remains primary; follow-up is secondary; source pills are supporting.
- Component choice: use a button-like tile for the follow-up because it is actionable. Use compact chips for sources because they are metadata filters/expanders.
- Responsive: follow-up tile must be full width and source pills must wrap at 375px, 768px, 1024px, and desktop widths.
- Accessibility: preserve button semantics, disabled state, focus-visible ring, and readable text contrast.
- Brand: use existing Algolia CSS variables where possible and add pastel accents through subtle gradients, not heavy saturated slabs.
- Motion: hover can lift the tile/pills; no animated attention grabber.
