# Compare with Production: Selective Merge Plan

Status: ready for implementation
PR: `arijitchowdhury80/content-engagement#4`
Feature head reviewed: `0e91f11a7bf2cb3f1e8d979acc5a8a0069c5b762`
Current `origin/main`: `dcc3e4a036c6322ff926e549f33ae3e7c7c2859f`

## Decision

Do not merge PR #4 directly and do not run its default Jahia deployment path.

Integrate the feature on a new branch created from current `origin/main`. Preserve current main and the current Jahia runtime as the receiving system. Port the Compare capability into that system, resolve the one real source conflict deliberately, add a Compare-only deployment path, validate the integrated result, and then merge the integration PR.

This is a selective feature integration, not a replacement of the chat stack.

## What actually happened

Aadhar did use this repository. His branch descends from main commit `76f3a0bb3399a92822a397978e5e2aeb14c1aa39` and contains nine feature commits. It was not random, unrelated code.

Two kinds of drift then accumulated:

1. Repository drift: `origin/main` advanced by six commits while the feature branch remained on `76f3a0b`.
2. Runtime drift: Jahia received newer chat/runtime assets and release markers that were not represented by the feature branch's deployment baseline.

Git can three-way merge committed source. It cannot protect us from overwriting live changes that were never represented in the branch's base, and it cannot decide whether a broad deployment script is semantically safe merely because its text merges.

The verified three-way merge has one textual conflict:

```text
tools/deployment/deploy_jahia_engagement_tracker.py
```

`.gitignore`, `local-sites/algolia-com-parity/index.html`, and the other feature files merge textually. They still require tests because a clean textual merge does not prove behavioral compatibility.

## Source-of-truth order for this integration

Use this precedence when resolving differences:

1. Current `origin/main` source and its current contracts.
2. The approved current Jahia read-only manifest and asset hashes.
3. PR #4 as the donor implementation of Compare.
4. Historical PR evidence only as background; it is not a current runtime baseline.

If current main and the live manifest disagree, stop before deployment and reconcile the discrepancy explicitly. Never resolve that disagreement by silently taking the PR version or silently taking the live version.

## Integration branch

Create a clean branch from current main:

```bash
git fetch origin
git switch --create codex/integrate-compare-with-production origin/main
```

Record these inputs in the integration PR:

```text
receiving main SHA: dcc3e4a036c6322ff926e549f33ae3e7c7c2859f
donor PR SHA:       0e91f11a7bf2cb3f1e8d979acc5a8a0069c5b762
common ancestor:    76f3a0bb3399a92822a397978e5e2aeb14c1aa39
```

Do not develop or resolve the merge in the dirty primary worktree. Use a clean worktree or disposable clone.

## Selective file disposition

| PR content | Integration action | Reason |
|---|---|---|
| `frontend/chat-widget/algolia-chat-compare.js` | Port, then test against current main | This is the feature implementation and does not replace `algolia-chat.js`. |
| `frontend/chat-widget/tests/algolia-chat-compare.test.mjs` | Port and extend | Retains the validated behavior tests; add deployment, cache, evidence, and proxy-origin regressions. |
| `local-sites/algolia-com-parity/index.html` | Merge into the current file | Current main owns the parity surface; add only Compare configuration and script loading. |
| `tools/local_chat_parity_server.py` | Port the production comparison route, then harden it | Keep loopback binding and add strict local Host/Origin validation before forwarding. |
| `config/deployments/algolia-chat-stack.json` | Add a corrected Compare entry | Record Compare as an additive asset. Do not reassert stale runtime markers. |
| `.env.example` | Bring in only accurate `PROD_ASKAI_*` documentation | Correct stale references to the deleted `proxy.mjs`; never include a real key. |
| `.gitignore` | Keep the automatic merge if it preserves both sides | No architectural conflict was detected. |
| Historical Compare evidence | Keep as historical evidence or supersede it | It documents development, not the final integrated/live release. |
| `tools/deployment/deploy_jahia_engagement_tracker.py` | Keep current main, then implement Compare support manually | This is the only textual conflict and the highest-risk integration surface. Never take the PR file wholesale. |

## Required code corrections during integration

### 1. Build a narrow Compare-only deployment mode

Add `--compare-only` to the current main deployment script. It must:

- snapshot only the current EDIT/LIVE custom-code block and Compare asset;
- calculate and record their hashes;
- create a dry-run plan containing an explicit mutation allowlist;
- add or update only `window.ACS_COMPARE` and the `algolia-chat-compare.js` script reference;
- upload and publish only `/sites/www/files/algolia-chat-compare.js`;
- version and publish only `/sites/www/home/drift/custom-code-block`;
- never upload another chat/runtime file;
- never publish `/sites/www/files` or `/sites/www/home/drift` recursively;
- require the approved pre-apply block hash and fail closed if EDIT changed after approval;
- validate exact Compare source and block HTML in EDIT and LIVE;
- provide a rollback that restores only the previous Compare asset/reference state.

The Compare HTML transform must preserve every unrelated byte of the current block except the two owned Compare tags.

### 2. Make the Compare asset content-addressed

Generate the `?compare=` value from the reviewed Compare file hash, rather than the shared `20260819-runtime-z` constant. The deployment plan, emitted script URL, asset readback, and browser evidence must all identify the same hash.

### 3. Separate rollback material from publishable evidence

The deployed block necessarily contains the browser search key. Therefore:

- store the complete rollback snapshot in a gitignored operator-only location with restricted permissions;
- redact `ACS_COMPARE.prod.apiKey` from every file written under `docs/evidence/`;
- never print the key;
- retain redacted HTML, hashes, versions, presence checks, and mutation results as durable evidence;
- add a sentinel test proving the key is absent from stdout and publishable evidence.

### 4. Close the local proxy's browser-origin boundary

The proxy must reject a foreign `Host` or `Origin` before reading or forwarding the body. Its accepted values must match the loopback address and active local port printed by the server. Add tests proving that hostile Host/Origin requests produce a rejection and never invoke the upstream client.

## Merge sequence

1. Create the clean integration branch from current `origin/main`.
2. Start a real, uncommitted merge so the donor ancestry and attribution are preserved:

   ```bash
   git merge --no-ff --no-commit 0e91f11a7bf2cb3f1e8d979acc5a8a0069c5b762
   ```

3. Confirm that Git reports only the expected deployment-script conflict. Stop if the conflict set differs from the reviewed merge simulation.
4. Restore the current-main deployment script as the receiving version, then manually implement the narrow Compare adapter described above:

   ```bash
   git restore --source=HEAD --staged --worktree -- tools/deployment/deploy_jahia_engagement_tracker.py
   ```

5. Review every automatically merged file for semantic compatibility, not only textual compatibility.
6. Run secret scanning and confirm no generated snapshots, run payloads, caches, or credentials are staged.
7. Run the complete local gate before committing the merge.
8. Commit the resolved merge, push the integration branch, and open an integration PR that references and credits PR #4.
9. Require the integration PR to be current with main and rerun all checks at its final SHA.
10. Merge the integration PR only after the code gates pass. Merging source does not authorize deployment.
11. An authorized Jahia operator captures the live baseline, produces a Compare-only dry run, and obtains approval.
12. Apply the exact reviewed integration SHA using `--compare-only`.
13. Read back EDIT/LIVE assets and HTML, then run the browser acceptance matrix.
14. If any invariant fails, run the narrow rollback and verify the restored hashes.
15. Confirm that GitHub recognizes PR #4's commits as merged through the integration commit. If it does not, close PR #4 with a link to the integration PR and preserve Aadhar's attribution.

## Local merge gate

At minimum, the final integration SHA must pass:

```bash
npm ci --ignore-scripts
npm run test:chat-widget
npm run test:local-chat-parity
npm run test:team-uat
python3 -m unittest discover -s tools/deployment/tests -p 'test_*.py'
python3 -m py_compile tools/local_chat_parity_server.py tools/deployment/deploy_jahia_engagement_tracker.py
git diff --check origin/main...HEAD
```

Required adversarial regressions:

- Compare off -> question one -> locked off -> reset -> selectable.
- Compare on -> two turns -> production turn two contains turn-one history.
- Collapse/reopen preserves Compare state and history.
- Production failure affects only the Compare column.
- Compare-only dry run changes only the Compare asset and its two block tags.
- Drift between approved dry run and apply aborts without mutation.
- A sentinel key appears nowhere in durable evidence or stdout.
- Foreign Host/Origin requests never reach the upstream production client.
- A Compare source change produces a different `?compare=` URL.

## Live acceptance gate

Before deployment, record the current live script inventory, order, release markers, index, agent IDs, and asset hashes. The current observed index is `Algolia_Prod_Copy_Enhanced`, while the repository runtime contract says `Algolia_Prod_Copy_Vanilla`; that mismatch must be resolved or explicitly accepted before the run can be called canonical.

After deployment, prove:

- every pre-existing live asset and hash is unchanged;
- exactly one new Compare asset/reference is present;
- the left side remains the current concierge;
- the right side is production Ask Algolia and remains read-only;
- two-turn history works;
- collapse/reopen works;
- reset creates a new comparison conversation;
- production failure is isolated;
- rollback restores the exact prior state.

## Ownership

- Feature implementation and local tests: donor developer or integration engineer.
- Merge resolution and adaptation to current main: integration owner.
- Jahia snapshot, approval, apply, rollback, and browser evidence: authorized Jahia operator.
- Final merge authorization: repository owner after automated and human review.

No developer without Jahia access is responsible for producing authenticated live evidence.
