# Index URL Normalization Mutation Packet

Date: 2026-08-12

## Target

- Algolia app: `0EXRPAXB56`.
- Index: `Algolia_Prod_Copy_Enhanced`.
- Agent affected first: `www Chat - Orchestrator` (`e2c8596a-4420-41d2-80bb-5cd4aaeffda6`).
- Production Ask AI: read-only, not touched.

## Current Value

`Algolia_Prod_Copy_Enhanced` has mixed `url` shapes:

- 10,091 records use relative paths such as `/pricing`, `/doc/...`, `/blog/...`, `/customers/...`.
- 1,837 records already use absolute URLs.
- 0 records have empty or malformed URLs.

Current Agent Studio tool config retrieves from the index with `attributesToRetrieve: null` and no URL transform. The model therefore receives the mixed raw `url` field.

## Intended Value

Normalize `url` in the dev retrieval index so every record exposes a public, absolute, Algolia-owned URL:

- Existing absolute `https://academy.algolia.com/...` and `https://support.algolia.com/...` URLs stay unchanged.
- Existing relative paths resolve to `https://www.algolia.com${url}`.
- Locale paths such as `/de/...` and `/fr/...` stay in the path.

Examples:

| Current `url` | Intended `url` |
|---|---|
| `/pricing` | `https://www.algolia.com/pricing` |
| `/doc/value-engineering` | `https://www.algolia.com/doc/value-engineering` |
| `/de/blog/product/dynamic-facets` | `https://www.algolia.com/de/blog/product/dynamic-facets` |
| `https://support.algolia.com/hc/en-us/articles/...` | unchanged |
| `https://academy.algolia.com/training/...` | unchanged |

## Rollback

Before mutation:

1. Browse all records and write a rollback JSONL containing `objectID` and original `url`.
2. Record index settings for `attributeForDistinct`, `distinct`, `searchableAttributes`, and `attributesToRetrieve`.

Rollback operation:

1. Batch partial-update each affected `objectID` back to its original `url`.
2. Re-run the URL-shape census and representative searches.
3. Confirm the original relative/absolute counts are restored.

## Validation

After mutation:

1. Browse all records and assert:
   - total records unchanged;
   - `relative: 0`;
   - `empty: 0`;
   - only allowed hosts appear: `www.algolia.com`, `support.algolia.com`, `academy.algolia.com`.
2. Direct-query representative topics:
   - pricing;
   - Salesforce Commerce Cloud pricing and promotions;
   - `How and why events drive search ROI`;
   - InstantSearch;
   - Dynamic Re-Ranking;
   - customer case studies.
3. Confirm retrieved hit `url` values are absolute.
4. Run orchestrator smoke tests from an approved origin and assert Markdown links are absolute without prompt-level relative-link rewrite language.
5. Keep runtime `canonicalBaseUrl` as a fallback for source-card rendering only.
6. Remove the mechanical prompt rewrite rule from the orchestrator prompt and replace it with a high-level instruction to link retrieved public evidence inline.

## Approval Needed

This is not an Agent Studio configuration mutation, but it changes the shared dev retrieval index used by the `www` agents. Apply only after Arijit approves this packet.
