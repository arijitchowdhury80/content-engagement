# Orchestrator Native Config Validation Report

Captured: 2026-08-12

## Correction

Superseded on 2026-08-12: this first validation pass incorrectly treated native Agent Studio prompt suggestions as desirable. That was wrong for the discovery concierge. Native suggestions were later disabled and revalidated.

Correct behavior: no native follow-up prompt-suggestion chips. Discovery should happen through the agent asking at most one grounded, useful follow-up inside the answer.

## Target

- App: `0EXRPAXB56`
- Agent: `www Chat – Orchestrator`
- Agent ID: `e2c8596a-4420-41d2-80bb-5cd4aaeffda6`

## Raw Snapshots

These files are gitignored because they include full internal prompt/config payloads:

- Before: `docs/research/search-experience/workstream-1-agent-studio-orchestrator-before-2026-08-12T19-30-52-355Z.json`
- After: `docs/research/search-experience/workstream-1-agent-studio-orchestrator-after-2026-08-12T19-35-06-541Z.json`

## Mutation Results

- Agent PATCH: HTTP `200`
- Approved-domain bulk insert: HTTP `201`
- Publish call: HTTP `409`, message indicated the agent is already published

Repo-local Agent Studio notes already warned that patching existing published agents is live and `POST /publish` can return `409 already published`. The readback confirmed the patched agent remains `published`.

## Readback Summary

- Provider: `0c6a0843-caf0-4246-b2a1-7cc08d06a7db`
- Model: `medium`
- Instructions length: `2764`
- Config keys:
  - `enableAlgoliaMcp`
  - `guardrail`
  - `max_iterations`
  - `max_tokens`
  - `memory`
  - `rate_limit`
  - `suggestions`
  - `thread_depth`
- Native follow-up prompt suggestions: superseded in this report; corrected value is `enabled: false`
- Guardrail enabled: `true`
- Guardrail required: `false`
- Guardrail categories:
  - `off_topic_content`
  - `silly_requests`
  - `prompt_injection_or_secrets`
  - `unsafe_or_adult_content`
  - `unsupported_business_claims`
- Approved domains:
  - `*.algolia.com`
  - `*.cloud.jahia.com`
  - `temp-production-algolia.cloud.jahia.com`

## API Smoke Tests

All completion prompts used fresh wording to avoid exact-query cache reuse.

| Test | Origin | HTTP | Result |
|---|---|---:|---|
| No-origin domain check | none | `403` | Blocked by approved domains |
| Algolia overview | `https://www.algolia.com` | `200` | Answer returned, 2 retrieved hits; native suggestion result superseded |
| InstantSearch implementation | `https://www.algolia.com` | `200` | Answer returned, 15 retrieved hits; native suggestion result superseded |
| Pricing/demo route | `https://www.algolia.com` | `200` | Answer returned, 21 retrieved hits; native suggestion result superseded |
| Prompt-reveal attack | `https://www.algolia.com` | `200` | Blocked with `finishReason: content-filter` |
| Unrelated product search | `https://www.algolia.com` | `200` | Blocked with `finishReason: content-filter` |
| Jahia dev origin | `https://tmp-content-eng-algolia.cloud.jahia.com` | `200` | Answer returned from approved dev origin |
| Disallowed origin | `https://example.com` | `403` | Blocked by approved domains |

## Browser Surface Check

Playwright loaded the Jahia dev page:

- URL: `https://tmp-content-eng-algolia.cloud.jahia.com/cms/render/live/en/sites/www/home.html?widgetFinal=20260812`
- Title: `The AI search and retrieval platform - Agentic | Generative | Search`
- DOM contained the dev orchestrator ID `e2c8596a-4420-41d2-80bb-5cd4aaeffda6`
- DOM exposed AI mode, chat textarea, new chat, back-to-results, send controls, and the legacy prompt-suggestion surface from the page markup

The Playwright form-submit attempt reloaded the page instead of producing a stable chat answer, so browser-widget answer submission is not counted as fully validated in this report. The Jahia-origin API smoke test did validate that the approved-domain configuration allows calls from the dev site origin.

## Follow-Up Risks

- The guardrail fallback text returned by Agent Studio was shorter than the configured category fallback for blocked cases. Behavior blocked correctly, but fallback rendering needs browser-level confirmation.
- Pricing/demo answer used retrieved evidence, but answer copy should be reviewed for exact source-link quality before this prompt style is rolled to specialists.
- The legacy prompt-suggestion UI surface needs a separate browser check to confirm disabled native suggestions do not render chips.
- Browser-widget submission still needs an interaction-level validation pass with a more robust Playwright script or manual check.
