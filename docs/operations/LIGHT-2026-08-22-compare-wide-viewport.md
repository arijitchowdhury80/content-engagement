# Compare toggle on wide viewports

## Classification

Light path. This is a reproduced presentation-state defect in the existing
Compare companion. It changes no API, schema, dependency, credential handling,
or production data flow.

## Reproduction

On the Jahia browser surface the normal centered chat measured 1080px inside a
2266px viewport. The old `panelWidth >= viewportWidth * 0.6` check classified
that usable chat as collapsed, so the Compare toggle never mounted.

## Change and validation

Treat the chat as expanded when it is at least 60% of the viewport or 720px,
whichever is smaller. The docked panel remains below that threshold. A
regression reproduces the exact 1080/2266 geometry and then verifies that a
docked-width transition still removes the toggle.

Focused widget and deployment suites must pass before the immutable Compare
assets are redeployed. Browser acceptance must then prove two turns,
collapse/reopen preservation, and reset behavior on the Jahia surface.

## Risk and rollback

The only functional risk is showing Compare in a genuinely docked panel wider
than 720px. The shipped widget's docked panel is narrower; the regression also
checks the docked transition. Rollback is the existing exact-CAS Compare
deployment rollback, or redeployment of the previously validated immutable
asset set and block hash.

## Review

The change is confined to the expansion predicate and one geometry regression.
No Critical or Important issue was found in the local review. Production
deployment remains blocked until the regression and deployment suites pass.
