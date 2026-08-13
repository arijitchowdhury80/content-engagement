# Agent Checks

These are read-only Agent Studio diagnostics.

They can dump a live agent, ask a smoke-test question, or sweep a question set. They are not prompt
source, and they must not mutate Agent Studio configuration.

- `dump-agent.mjs` reads a live agent's current configuration into a file.
- `spotcheck-live.mjs` asks one live agent one question.
- `sweep-sample-questions.mjs` runs a question list and classifies the answers.
