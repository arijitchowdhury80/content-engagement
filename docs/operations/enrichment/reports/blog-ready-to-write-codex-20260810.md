# Blog ready-to-write packet — Codex

Date: 2026-08-10

## Scope

Input artifacts:

- `docs/70-enrichment/batches-out-blog`
- `docs/70-enrichment/batches-out-blog-r2`

Ready artifact:

- `docs/70-enrichment/batches-out-blog-ready-codex-20260810/ready/results.jsonl`

Algolia write was performed after Arijit's approval on 2026-08-10.

## Ready Set

| measure | count |
|---|---:|
| input result rows | 2,715 |
| ready rows | 1,706 |
| distinct ready objectIDs | 1,706 |
| duplicate ready objectIDs | 0 |
| excluded rows | 1,009 |
| ready `PASS` | 1,521 |
| ready `JUDGE_REVISE` | 185 |

Exclusions:

| reason | count |
|---|---:|
| `NOT_WRITABLE_PAYLOAD` | 650 |
| `INCOMPLETE_HIGHLIGHT_SPAN` | 282 |
| `INCOMPLETE_ABSTRACT_SPAN` | 67 |
| `LEAKAGE_FAILURE` | 9 |
| `TOO_FEW_HIGHLIGHTS` | 1 |

## Verification

`validate_blog_outputs.py` over the ready artifact:

| check | result |
|---|---:|
| rows | 1,706 |
| distinct objectIDs | 1,706 |
| duplicate IDs | 0 |
| writable rows | 1,706 |
| spans checked | 13,743 |
| grounding failures | 0 |
| leakage failures | 0 |
| dead writable rows | 0 |
| missing source bodies | 0 |
| non-Blog rows | 0 |

Incomplete-span scan:

| check | result |
|---|---:|
| ready rows scanned | 1,706 |
| incomplete abstract/highlight spans | 0 |

Writer dry-run:

| check | result |
|---|---:|
| results loaded | 1,706 |
| writable payloads | 1,706 |
| skip IDs hit | 0 of 85 |
| fields added | `abstract_enriched`, `keyhighlights_enriched` |
| protected fields touched | none |
| live records at dry-run | 12,036 |
| snapshot count | 12,036 |
| Algolia write | performed |

Live write verification:

| check | result |
|---|---:|
| payloads written | 1,706 |
| live readback exact matches | 1,706 |
| mismatches | 0 |
| missing records | 0 |
| live record count before/after verification | 12,036 / 12,036 |
| Blog records with both enrichment fields after write | 1,791 |
| all records with both enrichment fields after write | 2,035 |
| Blog `abstract_enriched` type | `list` |
| Blog `keyhighlights_enriched` type | `list` |

Test suite:

```text
420 passed, 1 xfailed in 2.05s
```

## Dry-Run Command Used

```bash
python3 docs/70-enrichment/write_enrichment.py \
  --results docs/70-enrichment/batches-out-blog-ready-codex-20260810/ready \
  --skip-ids docs/70-enrichment/reports/blog-skip-ids.json
```

## Apply Command, If Arijit Approves

```bash
python3 docs/70-enrichment/write_enrichment.py \
  --results docs/70-enrichment/batches-out-blog-ready-codex-20260810/ready \
  --skip-ids docs/70-enrichment/reports/blog-skip-ids.json \
  --apply --yes
```

Do not use the original `batches-out-blog*` roots as write input for another push. They still
contain records with known publishability defects. Use this ready artifact, or a newly generated
ready artifact after the repair path finishes.
