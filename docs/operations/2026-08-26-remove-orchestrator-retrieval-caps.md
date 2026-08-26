# Remove Orchestrator retrieval caps

Date: 2026-08-26
Target: `www Chat - Orchestrator` in app `0EXRPAXB56`
Index: `Algolia_Prod_Copy_Vanilla`

## Root cause

Commit `4580663` added `hitsPerPage: 5`, a five-field projection, and
`description:80` to reduce duplicated retrieval payload during a stability
investigation. The deployment manifest and its tests then made that temporary
mitigation authoritative. Later prompt and runtime deployments preserved it.

These were project-created restrictions, not Algolia platform requirements.
They traded answer evidence and depth for smaller tool payloads without an
approved product-quality contract.

## Class-level correction

The manifest now explicitly sets `hitsPerPage`, `attributesToRetrieve`, and
`attributesToSnippet` to `null`. Explicit nulls are required because the
deployer merges declared search parameters into the live tool; merely deleting
the keys from the manifest would leave the previous live values in place.

The production-content and English-language filter remains unchanged.

## Verification

- Focused deployment tests: 8/8 passed.
- Reviewed private dry-run: passed.
- Tool-only Agent Studio apply: passed.
- Live readback:
  - `hitsPerPage: null`
  - `attributesToRetrieve: null`
  - `attributesToSnippet: null`
  - index remains `Algolia_Prod_Copy_Vanilla`
  - filter remains `environment:"prod20260722" AND language_code:"en" AND NOT is404:true`

## Prevention heuristic

Do not make a temporary cost or stability cap authoritative without a paired
answer-quality evaluation and an explicit product decision. Any retrieval
projection must prove both payload reduction and no regression in grounding,
completeness, depth, and latency before deployment.
