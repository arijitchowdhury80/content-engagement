Follow-up Split Regression

Root cause:
The UI had a dedicated follow-up tile, but the answer post-processor did not reliably move the visible discovery question out of the answer body. Marker-backed follow-ups were passed through as `followUp` while still remaining in `text`; markerless trailing discovery questions remained ordinary answer prose.

Fix:
Split one visible discovery-style follow-up question at the final answer post-processing boundary. The flat answer stays focused on the answer. The extracted question is handed to the existing follow-up tile before sources.

Guardrail:
`frontend/chat-widget/tests/algolia-chat-followup-source-tiles.test.mjs` now covers both marker-backed and markerless trailing discovery questions.
