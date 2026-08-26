# Reactive Stability — One-User Adversarial Execution

Date: 2026-08-25
Target: `https://tmp-content-eng-algolia.cloud.jahia.com/`
Verdict: **MECHANICAL SURVIVAL; READINESS GATE FAILED**

## Executive result

The corrected system completed the final 12-turn accumulated-state conversation without a blank
reply, generic error, page crash, retry, duplicate submission, guardrail rejection, or routing
failure. That is a meaningful mechanical result, but it is not a readiness pass: final-response p95
was 46.936 seconds against the 30-second test gate, the orchestrator consumed 419,726 model tokens,
the separately invoked Developer Specialist consumed another 28,869 tokens,
and semantic quality was not independently certified. Multi-user pressure therefore remains blocked.

This report covers the reactive flow through the client, orchestrator, retrieval, client-side
specialist consent, specialist continuation, and Agent Studio persistence. It does not certify the
proactive greeting/controller flow, combined reactive/proactive races, concurrent-user capacity, or
production capacity. Production Ask Algolia was not mutated or load tested.

## Frozen execution identity

- App: `0EXRPAXB56`.
- Agent: `www Chat - Orchestrator` (`e2c8596a-4420-41d2-80bb-5cd4aaeffda6`).
- Index: `Algolia_Prod_Copy_Vanilla` only.
- Chat asset: `algolia-chat-stability-bdde7a55d6ff.js`.
- Asset SHA-256: `bdde7a55d6ff788e8af1df789de21f382379cb6b1bd784dfd6eb8afa23cc30fc`.
- Production endpoint deny rule: active.

## Failures found while reaching the final run

### Guardrail false positive

An identical U2-C1 journey first passed and later failed on turn six. The response stream contained
a guardrail event with category `prompt_injection_or_secrets`, but no answer text. The client had
previously collapsed this into an apparent empty response.

Corrections:

- The browser recorder now preserves a safe guardrail-event summary.
- The widget converts a guardrail event into a specific, classified visitor message.
- The orchestrator guardrail description now explicitly permits configured specialist routing; the
  guardrail remains enabled.
- Snapshot, dry run, exact patch, readback, and protected-field comparisons passed.

The failure did not recur in the later qualification runs, but the available repetitions are not
enough to claim that all guardrail false positives are eliminated.

### Natural provider rate limit

A later six-turn U2-C1 replication received HTTP 429 with `Retry-After: 60` on turn five. The widget
displayed the specific rate-limit state, preserved the conversation, and sent no automatic retry. A
fresh two-turn recovery sentinel then passed after cooldown.

This is the observed natural breakpoint in the one-user investigation. The configured Agent Studio
request counters were not exhausted; the evidence is consistent with upstream model/token pressure.
It is not attributed more narrowly because no infrastructure exception trace was available.

After a temporary explicit-only specialist-routing experiment was deployed, a fresh U2-C1 confirmation again hit HTTP 429,
this time immediately on turn two after a 33.231-second successful first turn. The response carried
`Retry-After: 60`; the client made no retry. This second observation confirms that the rate limit is
not caused by specialist consent or the designed contextual specialist-offer logic. The explicit-only
experiment was later reverted after product clarification that contextual specialist escalation is
intentional behavior.

### Retrieval payload amplification

The search tool returned large article bodies, including substantially duplicated text fields. The
live Vanilla search-tool contract was narrowed to five hits and projected fields:

- `objectID`
- `title`
- `url`
- `source`
- `category`
- `description:80` as a snippet

The deployer now requires an exact reviewed dry-run evidence packet for apply and rejects target or
patch drift. Live readback matched the supported projection exactly.

### Explicit specialist request not reliably routed

The model sometimes ignored an explicit request to bring in a named specialist. The client now has
a deterministic named-specialist fallback that still requires human consent before the specialist
is called. The final runs correctly completed the explicit developer-specialist route.

The same investigation found contextual deterministic specialist offers on later developer-context
turns. Product clarification confirmed that those offers are intentional: the client may offer a
specialist when accumulated journey/context signals meet the designed threshold, while actual
specialist invocation still requires human consent. The temporary explicit-only client change was
therefore reverted. Duplicate offers, poorly timed offers, incorrect specialist selection, or loss
of conversational context across the handoff remain defects; specialist entry itself does not.

## Final 12-turn result

Run ID: `stab-20260825t224305176z-0136447fba1c88984c6cdf2b739962ea`
Conversation: `alg_cnv_46f91481cfb14eb3bc62b92a8f1e54cd`

| Measure | Result | Gate |
|---|---:|---|
| Logical user turns | 12/12 completed | Pass |
| Mechanical turn failures | 0 | Pass |
| Blank replies | 0 | Pass |
| Generic errors | 0 | Pass |
| Page/browser crashes | 0 | Pass |
| Guardrail rejections | 0 | Pass |
| HTTP 429 responses | 0 | Pass for this run |
| Automatic retries | 0 | Pass |
| Primary completion POSTs | 15 | Observed |
| Distinct completion steps | 15 | Observed |
| Specialist background calls | 1 | Expected explicit route |
| p50 final latency | 19.668 s | Recorded |
| p90 final latency | 44.099 s | Recorded |
| p95 final latency | 46.936 s | **Fail: >30 s** |
| Maximum final latency | 46.936 s | Pass: <60 s |
| Mean final latency | 24.453 s | Recorded |
| Orchestrator input tokens | 409,789 | Risk |
| Orchestrator output tokens | 9,937 | Recorded |
| Orchestrator total tokens | 419,726 | Risk |
| Developer Specialist total tokens | 28,869 | Additional physical work |
| Full observed Agent Studio tokens | 448,595 | **Risk** |
| Independent semantic verdict | Unavailable | **Not certified** |

Input-token detail from the non-degraded Agent Studio exports:

- Orchestrator cache-read input: 351,584 tokens.
- Orchestrator non-cache-read input: 58,205 tokens.
- Developer Specialist cache-read input: 7,616 tokens.
- Developer Specialist non-cache-read input: 20,585 tokens.
- Full observed input: 437,990 tokens, of which 359,200 were reported as cache reads.
- Full observed output: 10,605 tokens.

These figures measure logical model-token throughput, not dollar expense. Provider token details
classify 359,200 input tokens as prompt-cache reads, while the message-level Agent Studio response
cache flag remained false. In other words, the LLM was still called, but it reused provider-cached
prompt prefixes. The configured `algolia-inference` provider exposes only the model alias `medium`,
not the resolved underlying model or a price schedule. Actual cost therefore cannot be derived from
this conversation export. It requires the provider's uncached-input, cached-input, and output rates,
plus separately observable guardrail and Search usage.

The active orchestrator's fixed server-side input contains 26,287 instruction characters, 11,626
system-prompt characters, and 10,566 serialized tool-definition characters before conversation
history, per-turn context, retrieved results, or tool continuations. The first three user turns and
turn six each executed three internal model steps: one malformed search-tool input, one successful
search, and one answer step. Each step can process the fixed context again. Agent Studio does not
expose the final provider request envelope, so the precise token-to-field partition is unavailable;
the prompt sources, tool definitions, conversation messages, per-turn context, step counts, and
token accounting are the exact observable inputs.

The 15 completion POSTs are not eight retries per question. Twelve were initial logical-turn calls;
three were distinct consent/decline continuation steps. Request-body identity confirmed zero retries.
The remaining amplification comes from large repeated prompts, conversation history, retrieval/tool
outputs, and iterative tool/model steps.

At the observed shape, five simultaneous 12-turn conversations would represent approximately 2.24
million model tokens. That is a workload extrapolation, not a tested capacity claim, and it is why
five-user execution is not authorized yet.

## Semantic and experience findings

- Mechanical completion does not prove that answers were correct, grounded, or human-like.
- No calibrated independent evaluator was available, so the required 95% semantic gate cannot be
  evaluated and is failed closed.
- Several turns completed without new search evidence despite the current search-first instruction.
- Three designed contextual specialist offers were declined after the one explicit specialist
  acceptance; their presence is not graded as a failure.
- Invalid tool-input attempts appeared in stream telemetry on some turns and caused extra loops.
- The combined orchestrator instruction/system text is approximately 38 KB and is reprocessed across
  model/tool iterations.
- Current live `thread_depth.max_messages` is 100, beyond the currently documented 1–50 range; it is
  recorded as a configuration risk and was not changed speculatively during the evidence run.

## Corrections deployed and verified

- Exact specialist-consent selectors replace broad card selectors in both hosted runners.
- Safe SSE guardrail classification and specific visitor-facing error handling.
- Vanilla-only retrieval projection with bounded hits and snippets.
- Explicit named-specialist fallback through human consent.
- Restoration of designed contextual specialist offers after product clarification; explicit and
  contextual offers continue to require human consent before invocation.
- Dry-run evidence binding for search-tool deployment.
- Operator conversation reconciliation using the existing logs-capable operator/admin credential;
  there is no separate credential type called an “Algolia Logs API key.”

Final post-run verification:

- Live identity preflight passed across public HTML, browser DOM, and Agent Studio.
- Public and browser runtime both report `Algolia_Prod_Copy_Vanilla`.
- Current chat asset: `algolia-chat-stability-bdde7a55d6ff.js`.
- Current chat asset SHA-256:
  `bdde7a55d6ff788e8af1df789de21f382379cb6b1bd784dfd6eb8afa23cc30fc`.
- The current asset passed exact EDIT, LIVE, public reference, and public SHA-256 readback.
- Inline confidence remains off for stability qualification.
- Stability harness: 63/63 tests passed.
- Chat-stack deployment safety: 8/8 tests passed.
- Guardrail mutation contract: 2/2 tests passed.
- The complete widget suite passed 318/318 after the named-specialist change.

## Claim and stopping decision

The fixed-question campaigns in this report certify mechanical transcript survival only. A later
adaptive U2 campaign answered the assistant's actual discovery questions and failed progressive
discovery due to repeated slots, missing profile fields, and a truncated apparent success. See
`2026-08-25-adaptive-discovery-execution.md`.

Allowed claim: **`ONE_USER_MECHANICAL_SURVIVED_12_TURNS`**.

Current readiness verdict: **`NO-GO_FOR_CONCURRENCY`**.

The authoritative plan requires the lower-pressure envelope to pass before two- and five-user runs.
The one-user envelope failed latency and semantic gates and exposed rate-limit/token amplification.
Escalating now would create an expensive collapse without distinguishing a new concurrency bug from
the already-proven single-user bottleneck.

## Required remediation before the next hosted pressure run

1. Freeze Discovery Protocol v1 and define the correctness criteria for specialist timing,
   selection, consent, handoff continuity, and repeat-offer suppression.
2. Install and calibrate an independent semantic evaluator on human-scored artifacts.
3. Reduce repeated prompt/history/tool payload while preserving required behavior.
4. Correct invalid tool-input loops and safely constrain model/tool iterations.
5. Set a documented thread-depth policy with explicit long-conversation continuity tests.
6. Rerun the exact 12-turn conversation until latency and semantic gates pass.
7. Repeat the clean six-turn and 24-turn accumulated-state envelope.
8. Only then advance to synchronized two-user and five-user campaigns.

## Private raw evidence

Raw browser, network, screenshots, and Agent Studio records remain outside the repository with
owner-only permissions:

- Guardrail failure: `/private/tmp/algolia-stability-u2c1-guardrail-fix-r1-Ujt1KD/`
- Rate-limit recovery: `/private/tmp/algolia-stability-rate-limit-recovery-2vEPj6/`
- First projected six-turn run: `/private/tmp/algolia-stability-u2c1-searchcap-r1-eyvmYk/`
- Passing combined-fix six-turn run: `/private/tmp/algolia-stability-u2c1-projection-routing-r1-a763cu/`
- Final passing 12-turn mechanics: `/private/tmp/algolia-stability-u2c1c2-combined-fix-kWmnrT/`
- Search projection deployment: `/private/tmp/algolia-orchestrator-search-projection-supported-XmL5AH/`
- Current immutable chat deployment: `/private/tmp/algolia-stability-explicit-specialist-deploy-qRxwoX/`
- Explicit-only specialist deployment:
  `/private/tmp/algolia-stability-explicit-only-specialist-20260825/`
- Post-correction natural 429:
  `/private/tmp/algolia-stability-u2c1-explicit-only-20260825/`
- Designed specialist-routing restoration:
  `/private/tmp/algolia-stability-restore-designed-specialist-r2-20260825/`
