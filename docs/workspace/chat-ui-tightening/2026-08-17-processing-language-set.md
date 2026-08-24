# Processing Language Set

## Decision

The processing journey copy should rotate through English, French, and Spanish only.

French and Spanish copy must use the correct Latin-script text with accents and punctuation, for example `búsqueda`, `señal`, `evidencia`, `français`, `réponse`, and `Et voilà`.

## Rationale

- The wait-state is supporting context, not the answer itself.
- The copy can feel alive, but it must stay source-honest and culturally coherent.
- Removing Hindi/Bengali transliteration and Italian avoids a grab-bag feel while preserving variety.
- The current UI font stack already supports French and Spanish Latin glyphs, so adding another font would add payload without solving a real rendering problem.

## Guardrail

`frontend/chat-widget/tests/judge-chief-prompt.test.mjs` now checks that the shipped bundle includes French/Spanish accented markers and excludes the removed transliterated/Italian phrases.
