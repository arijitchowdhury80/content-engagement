# Release and Rollback Design

Status: proposed for Gate G approval

## Two-manifest composition

`ReleaseManifest.v1` belongs to the central source repository and identifies the central commit, lockfiles/build environment, commands, compatibility versions, artifact graph, hashes, sizes, MIME types, source maps, script order, CSP requirements, and previous compatible release.

`AlgoliaDeploymentManifest.v1` belongs to `algolia-com`. It pins exactly one central manifest hash plus the Algolia policy, browser, presentation, composition, and Jahia inputs. It records their source commit, output hashes, combined load order, expected Jahia paths, storage compatibility, and previous composite release.

The chain is:

```text
central source commit -> deterministic central artifacts -> ReleaseManifest.v1
algolia-com commit + central manifest -> composed Algolia artifacts -> AlgoliaDeploymentManifest.v1
approved manifest -> Jahia dry-run -> publish -> live readback hashes
```

## Build acceptance

- Clean disposable build from pinned lockfiles.
- Two independent builds yield identical allowed artifact hashes.
- Source maps are present and excluded secrets/source policies pass.
- No unlisted artifact may enter a deployment.
- Bundle/startup regression is no worse than 10% unless an ADR amendment accepts it.

## Rollback

Before mutation, snapshot the current Jahia block and referenced assets with hashes. Dry-run must show only allowlisted asset/reference changes. The deployment record identifies the exact prior composite manifest and restoration command. After apply, edit and live views are read back and asset hashes/load order are compared with the approved manifest.

Any behavioral, privacy, accessibility, artifact-identity, or readback hard-gate failure triggers immediate restoration to the prior pinned manifest followed by readback verification. Production Ask Algolia remains read-only evidence. No deployment, push, publication, Agent Studio/index mutation, or Spectrum production change is authorized by this document.
