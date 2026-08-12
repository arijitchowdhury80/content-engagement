# Blog Dead Pages — Scout Recheck

Date: 2026-08-10

## Scope

Effective Blog artifact rows were reconstructed with last-wins precedence:

1. `batches-out-blog`
2. `batches-out-blog-r2`
3. `batches-out-blog-repair`
4. `batches-out-blog-repair2`

The effective artifact set contains **104** rows with `status: DEAD_PAGE`.

Arijit asked about 109; I found 104 in the current effective artifact set. This report covers all
104 detected dead Blog rows.

## Method

Every URL was re-fetched with Scout only.

Evidence:

- JSON summary: `reports/blog-dead-pages-scout-recheck-20260810.json`
- Per-record Scout evidence: `cache-scout/dead-blog-check-20260810/`

## Result

| measure | count |
|---|---:|
| dead Blog rows rechecked | 104 |
| Scout checks completed | 104 |
| still `DEAD_PAGE` | 104 |
| revived / alive articles | 0 |
| fetch exceptions | 0 |
| redirect mismatch | 0 |
| unique URLs | 104 |
| unique paths after removing `/de` and `/fr` locale prefix | 38 |

HTTP status split:

| HTTP status | count |
|---|---:|
| 301 | 66 |
| 404 | 38 |

The status code is not the truth source. All 104 bodies open with:

```text
#  Page not found
```

and were classified as:

```text
body opens with a not-found stub ('page not found' in the first 200 chars); the article has been deleted or moved
```

## Interpretation

These records point to Blog URLs that are still in the index, but the website no longer serves the
article body for those URLs. They should not receive enrichment because there is no article content
to ground against.

For search quality, the better fix is not enrichment. It is one of:

1. remove these stale records from the enhanced index;
2. mark them out of the searchable production surface with a non-indexed operational artifact;
3. map them to replacement canonical URLs if content owners provide redirects or replacements.

Do not synthesize abstracts for these pages.
