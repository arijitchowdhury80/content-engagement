# Repeatable Content Engagement E2E Testing System

**Status:** Parked for later execution
**Created:** 2026-08-19
**Purpose:** Preserve the complete implementation scope, operating lessons, and resume contract for converting the completed eight-journey validation into a one-command testing system.

## Decision

Build one project-local skill and one deterministic CLI first. Do not package a plugin until the runner has proved reusable in this project and at least one additional project.

The future system must validate observable contracts rather than assume a fixed number of agents, JavaScript files, or runtime components. The architecture may change; the acceptance behavior must remain configurable and testable.

## Implementation Prompt

```xml
<context>
The Content Engagement runtime now has eight hosted Jahia journeys validated end to end.
The first complete validation took too long because environment selection, journey execution,
failure classification, evidence collection, remediation, deployment verification, and final
reporting were discovered incrementally.

The runtime architecture may evolve. Testing must therefore validate observable contracts,
not assume fixed numbers of agents, JavaScript files, or internal components.
</context>

<task>
Build a repeatable Content Engagement end-to-end testing system that runs from one command,
validates all configured journeys on the intended environment, diagnoses failures by pipeline
stage, captures compact evidence, and produces an authoritative release verdict.
</task>

<requirements>
1. Create one canonical, declarative journey manifest containing:
   - journey ID and category
   - starting and destination URLs
   - visitor actions, dwell thresholds, and scroll thresholds
   - expected trigger
   - whether source greetings should be replaced
   - required handoff behavior
   - specialist requirement
   - grounding, discovery, continuity, and error expectations

2. Provide one command:
   npm run test:e2e -- --target jahia --headed

3. Add mandatory preflight checks:
   - exact target origin
   - deployed runtime marker and asset hashes
   - endpoint availability
   - required browser capabilities
   - journey routes and selectors
   - clean test identity and storage isolation
   - prompt/config checksums
   - explicit rejection of localhost evidence for hosted acceptance

4. Run cheap checks before browser journeys:
   - unit tests
   - journey-contract consistency
   - trigger grammar validation
   - packet and handoff schemas
   - specialist-routing rules
   - discovery cardinality
   - deployment configuration consistency

5. Execute journeys in parallel only after shared preflight passes.
   Each journey receives an isolated browser context and records:
   - reset
   - source action
   - destination action when applicable
   - trigger and greeting
   - visitor response
   - handoff
   - orchestrator response
   - specialist routing
   - grounding
   - exactly one discovery question
   - conversation continuity
   - service errors

6. Diagnose failures by pipeline stage:
   tracker -> compiler -> controller -> trigger -> greeting request -> rendering ->
   visitor response -> handoff -> orchestrator -> specialist -> grounding ->
   discovery -> continuity.

7. Map every failure to a stable diagnostic code, probable causes, evidence, and next checks.
   Do not patch symptoms automatically.

8. Separate deterministic acceptance from subjective evaluation:
   - automated contract verdict
   - AI-judge quality evaluation
   - human review of tone, factual accuracy, business usefulness, and experience

9. Generate one compact run directory:
   - summary.json
   - completion-matrix.md
   - failure-report.md when needed
   - screenshots only at meaningful checkpoints
   - redacted traces
   Never commit raw network payloads, secrets, retries, or temporary browser state.

10. Add resumability:
    - rerun one journey
    - rerun only failed journeys
    - resume after a runtime fix
    - preserve the relationship between a failed run and its successful retry

11. Add strict release gates:
    - all required journeys pass
    - no service errors
    - one logical handoff per engagement
    - no Greetings Agent request after visitor response
    - exactly one discovery question
    - required specialist routing proven
    - continuity proven
    - deployed readback matches the tested asset

12. Create a project-local skill that teaches Codex how to:
    - run the system
    - interpret failures
    - remediate by root-cause class
    - redeploy safely
    - rerun only affected journeys
    - publish the final verdict

13. Record the operational lessons and architecture decision in the project knowledge base.

14. Add regression tests for the runner itself.
</requirements>

<constraints>
- Do not change Agent Studio prompts, runtime behavior, Jahia, or index configuration while
  building the test framework without explicit approval.
- Hosted acceptance evidence must come only from the configured Jahia origin.
- Keep environment-specific URLs, selectors, storage keys, agents, and trigger names in
  configuration rather than embedding them in the runner.
- Parallel journey workers may collect evidence concurrently, but runtime remediation and
  deployment use one controlled writer lane.
- A failed readiness check must produce a precise blocked verdict, not silently skip a journey.
</constraints>

<deliverables>
1. testing/e2e/journeys.json
2. testing/e2e/config/*.json
3. testing/e2e/run-e2e.mjs
4. testing/e2e/diagnostics.json
5. testing/e2e/tests/
6. skills/content-engagement-e2e/SKILL.md
7. One-command package.json entry
8. Testing runbook and failure taxonomy
9. Knowledge-base ADR and development record
10. A dry run proving the framework can validate the existing eight journeys
</deliverables>

<out_of_scope>
- Changing production Algolia.com
- Automatically mutating Agent Studio or prompts
- Automatically deploying a proposed fix
- Replacing human review of tone, usefulness, or factual claims
- Creating a distributable plugin before the project-local runner is proven
</out_of_scope>

<assumptions>
- The existing eight-journey hosted Jahia acceptance matrix is the baseline contract.
- The runner must remain adaptable if code moves between browser JavaScript and Agent Studio.
- Browser journeys run in parallel only after shared preflight succeeds.
- Remediation and deployment remain controlled, explicit write operations.
</assumptions>
</task>
```

## Stable Lessons To Encode

1. Prove the environment first. Never accept localhost as hosted Jahia evidence.
2. Test observable contracts, not today's internal architecture.
3. Run cheap static and unit gates before browser journeys.
4. Parallelize isolated journey execution, not shared runtime mutations.
5. Diagnose failures at the pipeline boundary instead of patching the visible symptom.
6. Never consume an engagement opportunity before successful rendering.
7. Correlate request IDs and logical turns; transport retries are not automatically duplicate conversations.
8. Treat specialist routing, specialist grounding, and specialist presentation as separate contracts.
9. Enforce one user action at a time: specialist interaction and discovery must not compete.
10. Verify deployments using live readback and content hashes.
11. Keep deterministic acceptance separate from subjective quality review.
12. Rerun affected journeys after a fix instead of restarting the complete suite.
13. Retain one authoritative successful retry and explicitly supersede pre-remediation evidence.
14. Reject readiness failures explicitly; never silently skip a required journey.

## Recommended Capability Shape

### Phase 1: Project-local system

- One declarative journey manifest.
- One CLI entry point.
- One project-local `content-engagement-e2e` skill.
- One failure taxonomy shared by automation and human reviewers.

### Phase 2: Plugin, after reuse is proven

1. **Journey Runner** - executes configured browser journeys.
2. **Failure Triage** - identifies the first broken pipeline boundary and recommends evidence-led checks.
3. **Release Gate** - consolidates evidence and issues the final verdict.

## Resume Instructions

When this work resumes:

1. Read this file first.
2. Read the authoritative baseline at `docs/evidence/visitor-intelligence/2026-08-19-jahia-authoritative-final/`.
3. Inventory the existing scripts before creating replacements.
4. Reuse proven capture, deployment-readback, reset, and UAT utilities where their contracts remain valid.
5. Build the manifest and preflight layer before adding orchestration.
6. Do not modify prompts or hosted runtime behavior without separate explicit approval.
7. Validate the runner against all eight existing journeys before considering plugin packaging.

## Manual UAT Finding Recorded After Parking

### Post-stream grounding replacement

During manual Product Journey testing, the proactive greeting and handoff worked, but the orchestrator's answer streamed visibly and was then replaced with:

> The retrieved material does not verify the specific details requested, so I cannot present those claims as confirmed.

This is not a scroll or rendering-position defect. The current widget streams the unadmitted answer first, runs `__arrieAdmitAnswer` after completion, and replaces the streamed answer when the admission gate rejects it. The sources and discovery question remain visible.

The confidence presentation compounds the problem: it evaluates the replacement sentence instead of exposing the original admission verdict, so the UI can display `Grounding - nothing to verify` immediately after rejecting a substantive answer. That label is misleading.

Future automated testing must explicitly detect and fail:

- a substantive streamed answer disappearing or being replaced after completion;
- the generic grounding-admission refusal becoming the final answer for an otherwise successful journey;
- a grounding badge that evaluates the fallback rather than reporting the original admission decision;
- a runtime chain that passes technically while the final answer is unusable;
- relevant retrieved evidence being discarded because deterministic phrase matching is stricter than semantic support.

The recommended repair is a focused grounding-admission redesign, not a prompt change: validate before presenting a final answer, retry once with a grounded rewrite when admission rejects, preserve the rejection reason for diagnostics, and render an accurate admission state. Do not modify Agent Studio prompts as part of this repair without explicit approval.

## Original Request

> Is there anything here to record, learn, and implement or fix and patch as a skill or learning, so that in the future, when we run this kind of similar automated testing again, we know exactly what to fix? We don't take 24 hours to complete this. We take much less time because you've done it before and you have learned from it.
>
> What are the things for us to learn and check the next time? Learn so that we don't repeat the same mistakes next time and we can patch ourselves and improve for next time.
>
> Can we convert this whole thing into a repeatable process, automated testing, and a skill or a plugin, or a series of skills into a plugin? In the future, the code will also change. I will change the architecture. I might simplify things. I might have more agents and less code, or less agents and more code. I don't know. Things will change, and you would have to run automated testing every single time, right? I cannot afford 24 hours every single time to complete a goal of automated testing end to end.
>
> How do we now, now that we have done this, take this and create a process for our automated testing that we can just invoke in one command? It will know exactly what all the things are to verify and validate, run it, test it, and not have to do this trial and error that you did this time. We don't have to do that.
