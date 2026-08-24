# Journey Prompt Examples Light Change

## Classification

Light path. This change edits existing Agent Studio prompt artifacts and adds a
prompt-contract test. It does not change runtime schemas, JavaScript, agent IDs,
tools, credentials, or deployment configuration.

## Plan

1. Reorganize the existing aRRIe system-prompt voice examples around the four
   canonical journey categories and eight flows.
2. Replace the Greetings Agent's stale few-shot examples with eight
   packet-to-greeting examples aligned to those flows.
3. Add eight proactive-handoff examples to the existing v010 orchestrator
   instructions.
4. Preserve model judgment by making the examples demonstrations rather than
   scripts: required context and safety remain fixed; wording, humor, analogy,
   chips, retrieval, specialist routing, and discovery adapt to the live turn.
5. Add and run a regression test that requires all eight flows and the
   anti-copying instructions in both prompt layers.

## Risk And Rollback

Primary risk: excessive examples could cause mechanical imitation or prompt
bloat. Countermeasure: one compact example per flow, explicit variation rules,
and no factual sample answer that could be mistaken for retrieved evidence.

Rollback: revert the three prompt files and the prompt-contract test. No runtime
or Agent Studio deployment is part of this change.
