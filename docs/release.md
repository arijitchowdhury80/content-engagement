# Content Engagement local build and release

## Build

```bash
npm install --prefix frontend/chat-widget
npm run typecheck
npm test
npm run build:verify
```

`build:verify` performs two clean builds, requires identical JavaScript and source-map hashes, and writes an ignored local `dist/` containing:

- `content-engagement.<hash>.js` — the authoritative single customer artifact;
- `content-engagement.<hash>.js.map` — debugging/source provenance;
- `content-engagement.js` and `.map` — temporary compatibility aliases with identical hashes;
- `release-manifest.json` — source commit, contract versions, hashes, and rollback baseline.

## Publication gate

A local build is not a deployment authorization. Before any Jahia publication:

1. require the complete compatibility, browser, UI, accessibility, judge, telemetry, proactive, specialist, multi-instance, and rollback gates;
2. snapshot the active Jahia block and referenced immutable assets;
3. produce and inspect a mutation allowlist/dry-run;
4. obtain explicit user approval;
5. publish to a new immutable content-addressed path;
6. read back edit, live, public asset hashes, load order, and a real hosted lifecycle;
7. restore the previous block reference immediately on any hard-gate failure.

Git push, public release, Agent Studio changes, index changes, and Jahia changes each require separate authorization.

## Customer-distribution boundary

This public repository contains product source, product tests, and deterministic build tooling. Private operational tooling consumes its release manifest from a separate repository. The customer distribution contains only the generated self-contained JavaScript and its release record. It never contains:

- Jahia modules, deployment scripts, environment configuration, or live-system checks;
- Agent Studio administration scripts, dumps, snapshots, generated payloads, or live identifiers;
- research, comparison captures, evidence screenshots, local parity sites, caches, or agent instructions;
- enrichment tools or unrelated project/customer material;
- excluded third-party brand source, assets, tokens, configuration, screenshots, documentation, or generated code.

The flat compatibility JavaScript remains temporarily while current hosts still need the existing filenames. Its immutable rollback point is the manifest's baseline commit. Compatibility files cannot become the source of new 2.0 changes.
