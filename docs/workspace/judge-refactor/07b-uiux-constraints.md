# Judge Refactor UI Constraints

The external UIUX SOP path referenced by the frontend workflow was searched and is unavailable. These repository-aligned constraints govern the implementation:

- One prominent verdict per evaluated answer.
- Four dimension rows are primary; panel and findings are secondary/collapsible.
- Support loading, final, provisional, needs-review, unsupported, incomplete, and unavailable states.
- Preserve the existing Algolia typography, spacing, colors, and maximum 8px card radius.
- Never use color alone; include text and an icon for every status.
- Keep keyboard operation, visible focus, accessible names, and 44px touch targets.
- Wrap long claims and source excerpts without horizontal overflow.
- Validate at 375, 768, 1024, and 1280px widths.
- The judge UI never covers, removes, or rewrites answer content.
