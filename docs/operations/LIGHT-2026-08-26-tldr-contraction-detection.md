# Light change: preserve concierge TL;DR treatment in Compare

Date: 2026-08-26

## Intake

The first concierge answer can render as flat prose when its analogy begins with the contraction
`It's like ...`. Compare does not hide the TL;DR; the answer-layer classifier recognizes forms such
as `X is like ...` but misses this common equivalent. This is a LIGHT change: it alters no API,
schema, dependency, security boundary, Production answer, or Compare transport.

## Plan

Add a browser regression using the reported answer shape, prove it fails, then extend only the
concierge answer-layer analogy classifier. Validate the same primary-answer DOM in normal and
Compare views. Do not change Production rendering.

## UI contract

- The first primary concierge answer remains the only answer eligible for the elevated TL;DR tile.
- `It's like ...` is semantically equivalent to the already supported `X is like ...` form.
- The analogy and following direct-read paragraph stay together inside the TL;DR canvas.
- Remaining answer content stays under `Details`.
- Compare must not alter the primary answer's presentation.

## Risk and rollback

No new attack surface: this is a local text-classification regex used only for presentation.
False positives are constrained to a first prose block that explicitly begins with `It's like`.
Rollback: redeploy the preceding immutable chat asset; there is no data or configuration migration.

## Validation

- TDD RED: the reported `It's like ...` fixture failed with the TL;DR label absent while Compare
  was off, proving the fault was independent of Compare layout.
- TDD GREEN: the same browser regression passes with Compare off and on.
- Full chat-widget suite: 336/336 passed.
- JavaScript syntax and scoped `git diff --check`: passed.
- Root-cause sweep: one executable classifier owns this behavior; no duplicate classifier was
  found in the repository. Production rendering remains intentionally outside this change.
- Code validation: passed for the scoped backward-compatible regex change; no external API or
  dependency signature changed.
- Test validation: passed; the test was observed failing before the fix, exercises the public DOM,
  and covers both normal and Compare presentation.
- UI validation: passed for the scoped behavior; no style, layout, responsive, interaction, or
  accessibility rule changed. Existing glass TL;DR style assertions remain green.
- The external Coding, Testing, and UI/UX SOP files were unavailable at their configured local
  Google Drive path; validation used the repository contracts and the loaded validator checklists.
- Jahia immutable deployment/readback passed for
  `algolia-chat-stability-23d8061a99a7.js` (SHA-256
  `23d8061a99a73beff7002c454293477aa716e4fb0358cfef8cf6ffbc6359f632`). The
  custom-code block preserved all non-chat references, and a cache-busted hosted load confirmed
  that exact asset URL.
- Hosted verification used the reported NeuralSearch question. In normal mode, the concierge
  answer rendered the TL;DR canvas, direct-read short answer, Details, four source groups, and the
  Judge control. After activating Compare with Prod, the same concierge TL;DR, short answer,
  Details, and source groups remained present and visible. Production presentation was unchanged.

## Prevention heuristic

When a presentation layer depends on natural-language classification, test semantically equivalent
contractions and punctuation variants in every host mode; do not let one happy-path phrase stand in
for the classifier's actual input class.
