# Jahia Release Sync Evidence - 2026-08-12

## Scope

This record proves what the Jahia development page served during the repository synchronization
audit. It does not claim that the current uncommitted widget source tree is published.

## Page Readback

- Page: `https://tmp-content-eng-algolia.cloud.jahia.com/cms/render/live/en/sites/www/home.html?widgetFinal=20260812&syncAudit=20260812`
- Read at: 2026-08-12
- Release marker: `enhanced-local-visual-parity-20260812`
- Required widget elements present: `algolia-chat-embed`, `algolia-chat-visitor`,
  `algolia-chat-engage`, `algolia-chat-person`, `algolia-chat-confidence`, and `algolia-chat`.

## Asset Hash Comparison

Each live Jahia file matched the same-named local release reference in
`.tmp-jahia-upload/local-reference-20260812/`. That directory is intentionally ignored because it
is a local deployment artifact, not the widget source repository.

| Asset | SHA-256 | Result |
|---|---|---|
| `algolia-chat-theme-algolia.js` | `4f2734c6b0bca1002dc8f93ba30866af103e4652abd0411246442e830e8cb99f` | Match |
| `algolia-confidence-badge.js` | `d96c375bd984fda272fa818538458c0d509f51154277c27dff56c607dd155d41` | Match |
| `algolia-chat.js` | `3245c1af263deca4650ce6a7f518b4b382de88628ad9c0cd470acab295f71929` | Match |
| `algolia-chat-tracker.js` | `a2cb623181c51ac31acc64f71a2177c3ab6df44576f27c8c52293a491c4e3cbd` | Match |
| `algolia-chat-engage.js` | `cdcc6185c4462eef3254e9c326363b640326509c6b8e3aed8ba69611e704991c` | Match |
| `algolia-chat-form-tool.js` | `9a4efbdb1e5314fc0c85307bd7726c6803aa5bbc2b1440ef89fd689d5dd321d8` | Match |

## Boundary And Remaining Proof

- The public project repository is `arijitchowdhury80/content-engagement`.
- The widget implementation repository is
  [`smomin/algolia-central-chat-widget`](https://github.com/smomin/algolia-central-chat-widget).
- The static prototype in `frontend/search-first-demo/` is not the Jahia widget source.
- The comparison above proves Jahia equals the local release reference. It does **not** prove a
  particular widget-repository commit produced those files, because the current widget worktree
  has uncommitted changes.

Before the next widget publish, commit the widget source, record its commit SHA and build command,
compare the resulting asset hashes with Jahia, and add a new evidence record.
