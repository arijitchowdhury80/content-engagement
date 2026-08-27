# Judge Dimension-Independence Update

## Authorization

Arijit explicitly approved updating the existing three Agent Studio judge system prompts on 2026-08-27. No new judge agents, role-lens changes, runtime-packet changes, model changes, scoring-formula changes, widget changes, or Jahia changes are authorized.

## Scope

This is a narrow external-configuration change and therefore uses snapshot, dry-run, exact in-place mutation, readback, validation, and rollback evidence.

- Add one shared rubric section requiring Grounding, Completeness, Depth, and Relevance to be scored independently.
- Clarify that unsupported content affects Grounding and cannot automatically depress another dimension.
- Clarify that negotiated pricing is not shallow merely because no public fixed price exists; Depth evaluates the explanation, comparison method, variables, and constraints.
- Apply the same shared system prompt to the three locked OpenAI judges.
- Preserve each role's existing `instructions`, model, provider, tools, config, name, status, and ID.

## Risk And Recovery

The primary risk is overwriting concurrent Agent Studio changes or accidentally creating more judges. The updater is restricted to three locked IDs, permits only `GET` and `PATCH`, never calls agent creation or deletion endpoints, and compares every protected field before and after mutation. A dry-run snapshot is stored privately outside Git. If validation fails, stop and use the before-snapshot only during an exclusive recovery window; do not blindly overwrite concurrent drift.

## Validation

- Prompt contract tests pass.
- Updater unit tests prove that creation, deletion, role-instruction mutation, and non-target IDs are rejected.
- Dry-run confirms all three live agents exactly match the locked identity and pre-change hashes.
- Readback confirms only `systemPrompt` changed and all three agents received the identical hash.
- Agent inventory count and IDs remain unchanged.
- A direct completion test confirms each judge accepts the unchanged evaluation packet and returns the required four dimensions.
- The judge lock is resealed with the approved prompt and updater hashes.

The 2026-08-27 apply validation passed:

- Agent count remained `51`, with the same complete ID-set fingerprint before and after.
- Skeptic, Referee, and Advocate retained their IDs, names, published status, OpenAI provider, `gpt-5.4-mini` model, zero tools, role instructions, and configuration.
- All three received system-prompt hash `8f9eed3c12e5151c7ff4f27f92883a611d1910ac2be103d994c4e65923ef9e3c`.
- All three returned valid reports on the first attempt for a controlled pricing fixture containing both supported and unsupported claims.
- The controlled panel returned Grounding scores of `6`, `9`, and `4`, while independently returning Depth `8`, Completeness `8-9`, and Relevance `10`. This verifies that a grounding concern no longer automatically depresses the other dimensions.
- Focused prompt, updater, lock, and candidate-contract tests passed: `23/23`.
- Judge-refactor tests passed: `64/64`, plus `14/14` judge deployment tests.
- Deployment guard tests passed: `84/84`.
- After installing the repository's locked development dependencies in the isolated worktree, the complete chat-widget suite passed: `357/357`.
- Private snapshot, mutation plan, exact readback, and rollback material are stored under `/private/tmp/judge-dimension-independence-20260827T1900Z` and are intentionally excluded from Git.

No Jahia deployment was performed or required. The widget runtime, score aggregation, role lenses, evaluation packet, confidence presentation, and load order remain unchanged.

After Arijit's explicit follow-up approval, the stale internal contract label `ALGOLIA-JUDGE-V3.3` was corrected to `ALGOLIA-JUDGE-V3.8` in the same shared system prompt and the same three existing V3.8 agents. This label-only correction created no agents and changed no rubric behavior.

## Rollback

The private before-snapshot contains the exact prior system prompt for each locked ID. Rollback, if required, is an explicit in-place PATCH of only `systemPrompt`, followed by the same protected-field and inventory readback checks.
