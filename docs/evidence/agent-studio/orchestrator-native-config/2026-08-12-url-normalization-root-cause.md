# Orchestrator URL Normalization Root Cause

Date: 2026-08-12

## Finding

The prompt-level rule that tells the agent to rewrite relative Markdown links is a symptom fix. The root cause is that `Algolia_Prod_Copy_Enhanced` stores mixed URL shapes in the `url` field, and Agent Studio passes those raw records to the model.

## Evidence

Direct census of `Algolia_Prod_Copy_Enhanced`:

| Measure | Count |
|---|---:|
| Total records | 11,928 |
| Relative `url` values | 10,091 |
| Absolute `url` values | 1,837 |
| Empty or malformed `url` values | 0 |

Breakdown by source:

| Source | Total | Relative | Absolute |
|---|---:|---:|---:|
| Website | 1,123 | 1,123 | 0 |
| Resources | 835 | 835 | 0 |
| Blog | 2,694 | 2,694 | 0 |
| Customer Stories | 237 | 237 | 0 |
| Documentation | 4,337 | 4,337 | 0 |
| Developers | 865 | 865 | 0 |
| Support | 1,695 | 0 | 1,695 |
| Academy | 142 | 0 | 142 |

Sample direct query results:

- `Pricing`: `url: "/pricing"`, source `Website`.
- `Pricing and promotions`: `url: "/doc/integration/salesforce-commerce-cloud-b2c/guides/pricing-and-promotions"`, source `Documentation`.
- `Understand Pricing Options`: `url: "https://academy.algolia.com/training/0193317e-ee1f-7f33-9e13-dc76b28ef36e"`, source `Academy`.
- `How and why events drive search ROI`: `url: "/blog/product/how-and-why-events-drive-search-roi"`, source `Blog`.

Current `www Chat - Orchestrator` Agent Studio retrieval tool:

- Tool: `algolia_search_index`.
- Index: `Algolia_Prod_Copy_Enhanced`.
- `attributesToRetrieve: null`.
- No URL mapping or transform field is configured on the tool.

Runtime evidence:

- The bundled chat runtime reads `canonical-base-url` into `canonicalBaseUrl`.
- Runtime source extraction resolves relative record URLs with `new URL(relativeUrl, canonicalBaseUrl)`.
- This protects rendered source-card/fallback links, but it does not rewrite URLs inside model-authored Markdown before the answer is generated.

Repo contradiction found:

- `docs/design/search-experience/discovery-engagement/OPERATING-CONTRACT.md` says relative record paths must resolve against `https://www.algolia.com`.
- `agents/definitions/_shared_grounding_algolia.md` says URLs should be copied exactly as stored and not normalized.

## Root Cause

The public-answer contract requires live Algolia-owned URLs, but the retrieval record contract gives the model relative paths for most records. The prompt was asked to compensate for that mismatch.

## Correct Fix Direction

Fix URL shape at the data/tool boundary:

1. Add an absolute, public URL field to every record, or normalize `url` itself in the dev retrieval index.
2. Prefer a deterministic rule:
   - If `url` already starts with `http://` or `https://`, keep it.
   - If `url` starts with `/`, resolve it against `https://www.algolia.com`.
   - Preserve locale paths such as `/de/...` and `/fr/...`.
3. Configure Agent Studio to retrieve the absolute field if a field mapping is supported. If not, normalize `url` in the dev index.
4. Keep runtime `canonicalBaseUrl` as defense-in-depth for rendered source cards.
5. Remove the mechanical prompt rewrite rule after the data/tool layer is fixed. The prompt should only say to link retrieved evidence inline using retrieved public URLs.

## Do Not Do

Do not rely on a final prompt scan as the primary enforcement mechanism for URL correctness.
