# Judge release authority

## Root cause

An unrelated UI deployment republished `algolia-chat.js` and the Jahia custom-code block from stale repository logic. That stale release restored `<algolia-chat-confidence mode="off">`, Compare-owned judge-mode changes, a single-attempt role path, and a destructive shared panel deadline. The prior repair existed only in a different worktree and had not become the release authority.

## Ownership contract

- The chat judge runtime is the only owner of browser judge execution.
- The Jahia block contains one `<algolia-chat-confidence>` element with no `mode` attribute.
- Compare cannot read or mutate judge state or presentation.
- All three Agent Studio roles start in parallel against the same evaluation package.
- A role may retry its own invalid response against that unchanged package.
- There is no shared panel deadline that discards valid role work.
- UI-only and Compare-only work cannot alter judge runtime or configuration.

## Enforcement

`tools/deployment/judge_release_guard.py` validates the block, chat runtime, and Compare runtime. The shared `set_block_html` writer validates every Jahia HTML mutation. Deployment-specific scripts validate chat assets before publication. Contract tests reject any return of the mode switch, Compare ownership, missing panel roles, single-attempt validation, or shared panel deadline.

`AGENTS.md` records the ownership boundary so new Codex tasks receive it before working in this repository.

## Release sequence

1. Build and test from a clean worktree based on current `origin/main`.
2. Merge the guarded source before deploying it.
3. Dry-run the exact committed release and record hashes.
4. Publish and read back the Jahia block and immutable assets.
5. Verify the live block has no confidence mode and the live Compare asset has no judge control.
6. Exercise a normal answer and confirm all three judge roles are represented.

## Rollback

Rollback is the previous complete release only if it passes the current guard. A snapshot containing a confidence mode switch or Compare judge control is not a valid rollback target.

## Remaining authority boundary

Repository guards protect every deployment path in this repository. An external stale checkout holding unrestricted Jahia mutation credentials can bypass repository code. Eliminating that final bypass requires restricting those credentials to a single protected deployment identity or service.
