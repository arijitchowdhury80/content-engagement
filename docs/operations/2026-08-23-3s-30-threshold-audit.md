# 3-Second / 30% Proactive Threshold Audit

## Decision

The current proactive qualification contract is **3 seconds of visible dwell and 30% maximum scroll depth** across every supported singleton and transition family. The canonical singleton identifiers are:

- `product_page_3s_30_scroll`
- `solution_page_3s_30_scroll`
- `developer_page_3s_30_scroll`
- `resource_page_3s_30_scroll`

Transition identifiers do not encode the threshold, but their qualifying source and destination pages use the same contract where required by the journey grammar.

## Audit Scope And Result

| Surface | Local/current result | Published result at audit time |
| --- | --- | --- |
| Tracker, compiler, controller | 3 seconds / 30%; boundary tests present | Jahia compiler/controller still served 5 seconds / 25% |
| Greetings Agent instructions | Local prompt uses `3s_30` identifiers | Published instructions still used `5s_25` identifiers |
| Orchestrator instructions and system prompt | Local prompts use `3s_30` identifiers | Published instructions and system prompt differed from local; instructions still used `5s_25` identifiers |
| Team UAT cases and HTML presentation | Local artifacts use 3+ seconds / 30% | Hosted UAT artifact still used 5+ seconds / 25% |
| Current customer and operations documentation | 3 seconds / 30% | Not independently published outside the repository |
| Asana tracker task | Current gate not recorded | Existing task text contains historical 5/10-second and 50/75/100 milestone-validation language |
| Durable project memory | Current operations contract records 3 seconds / 30% | Older dated Codex plans retain the threshold that was current when they were written |

The local implementation was aligned, but the release was **not globally complete** at audit time because Jahia, Agent Studio, hosted UAT, and the Asana record had not all been updated and read back.

## Approved Remediation And Readback

The user explicitly approved the release-wide 3-second/30% alignment on 2026-08-23. The scoped mutations were then applied using the repository deployment tools and their required snapshot, dry-run, apply, readback, and evidence controls.

| Surface | Applied result |
| --- | --- |
| Jahia tracker | EDIT and LIVE match the local source at SHA-256 `1216fd8ea8d2416322125e30a4086fcad43f84f9587cdeb1279f09ed0cbc8a8e` |
| Jahia context compiler | EDIT and LIVE match the local source at SHA-256 `491aaa9b7c0c1cda6ae762dfc9500e8e8b0c9281b91acda143f1add9292052f5` |
| Jahia proactive controller | EDIT and LIVE match the local source at SHA-256 `f0fa09548f18a74be93b214fedef8490d6f8cf7ceb426352c2070969754aa315` |
| Hosted Team UAT | LIVE matches the local canonical HTML at SHA-256 `365cfaffdad4cda9b91c895a4fb156fe7bd8ee5bae9ff5131f77c47efc742e2e` |
| Greetings Agent | Instructions and system prompt hashes match the local canonical files; provider, model, tools, and unrelated configuration were preserved |
| Orchestrator Agent | Instructions and system prompt hashes match the local canonical files; provider, model, tools, and unrelated configuration were preserved |

Saved mutation evidence:

- `docs/evidence/deployments/2026-08-23-threshold-3s-30-applied/deployment-validation.json`
- `docs/evidence/agent-studio/chat-stack-deploy-20260823T213245Z/greetings/validation.json`
- `docs/evidence/agent-studio/chat-stack-deploy-20260823T213256Z/orchestrator/validation.json`

The Asana task description remains historical. A clarification must be added as a dated activity update rather than rewriting the original tracker-validation record.

## Intentional Historical And Telemetry Exceptions

These values must not be mistaken for active qualification rules:

- Historical evidence, archived artifacts, and dated incident reports preserve the old release state.
- The tracker still records later telemetry milestones at 10 and 15 seconds and 50%, 75%, and 100% scroll. The first qualifying milestones are 3 seconds and 30%.
- Tests may use 10-second / 50% page data as an unambiguously above-threshold fixture. Boundary tests prove that 2,999 ms / 29% fails and 3,000 ms / 30% passes.
- Old Codex plans remain historical records. This audit and `2026-08-23-proactive-threshold-3s-30.md` are the current durable project memory.

## Prevention

`frontend/chat-widget/tests/proactive-journey-contract-consistency.test.mjs` is the release guard. It checks runtime constants, all current prompt surfaces, the UAT artifacts, current customer documentation, the operations contract, and deployment metadata. It fails if a superseded `5s_25` or `10s_50` trigger returns, or if current surfaces present 5/25 or 10/50 as the active gate.

## Validation Evidence

- `npm run test:chat-widget`: 298/298 passing.
- Focused tracker/compiler/controller/contract suite: 110/110 passing.
- Local parity validator: passing with the current page recorded at exactly 3,000 ms and 30%.
- Local eight-journey validator: 8/8 passing.
- Local transition-navigation validator: all four transition families passing with session continuity.
- Team UAT suite before deployment: 23/25 passing. The two failures correctly identified stale hosted UAT bytes and old `10s_50` hosted evidence.
- Team UAT suite after deployment: 24/25 passing. Hosted UAT bytes now match the local canonical artifact. The sole remaining failure is the intentionally preserved old `10s_50` hosted journey capture, which requires a fresh eight-journey evidence run rather than rewriting historical evidence.
- Jahia authenticated access check: EDIT and LIVE reads passing for `/sites/www/home/drift/custom-code-block`.
- Jahia scoped journey-runtime dry-run: passing; no mutation applied.
- Agent Studio Greetings, Orchestrator, and Developer Specialist dry-run: passing; no mutation applied.
- Post-deployment live Jahia smoke test: `/products/ai-search` remained suppressed below 30% scroll, then opened the proactive greeting after the 3-second dwell and 30% scroll boundary with active trigger `product_page_3s_30_scroll`.

### Live readback at audit time

- Jahia `algolia-context-compiler.js`: `JOURNEY_DWELL_MS = 5000`, `JOURNEY_SCROLL_DEPTH = 25`, and `5s_25` singleton identifiers.
- Jahia `algolia-proactive-controller.js`: all six journey-family defaults still 5,000 ms / 25%, with `5s_25` singleton identifiers.
- Jahia `algolia-engagement-tracker.js`: live hash differs from the current local tracker.
- Hosted `content-engagement-team-uat.html`: live hash differs from local and contains `10s_50` singleton identifiers.
- Published Greetings Agent: system prompt matches local; instruction prompt differs and contains `5s_25` identifiers.
- Published Orchestrator: system and instruction prompts differ from local; instructions contain `5s_25` identifiers.
- Asana task `1.1.1 Build Algolia engagement tracker`: its description contains historical 5/10-second and 50/75/100 tracker milestone validation. It does not yet record the current 3-second/30% proactive gate.

## External Mutation Gate

Jahia, Agent Studio, and Asana changes require their normal controls. For Jahia and Agent Studio: snapshot, dry-run, explicit approval, apply, readback, and saved evidence. For Asana: explicitly approved representational update and readback. Until those steps pass, local validation must not be reported as a live deployment.
