# Blog repair ready-to-write packet — Codex

Date: 2026-08-10

## Scope

Input precedence:

1. `docs/70-enrichment/batches-out-blog-repair`
2. `docs/70-enrichment/batches-out-blog-repair2` — last-wins by `objectID`

Ready artifact:

- `docs/70-enrichment/batches-out-blog-repair-ready-codex-20260810/ready/results.jsonl`

## Ready Set

| measure | count |
|---|---:|
| unique repair rows after precedence | 349 |
| ready rows | 310 |
| distinct ready objectIDs | 310 |
| duplicate ready objectIDs | 0 |
| excluded rows | 39 |
| ready `PASS` | 174 |
| ready `JUDGE_REVISE` | 136 |
| rows sourced from repair1 | 305 |
| rows sourced from repair2 | 5 |

The 39 excluded rows remain `QUARANTINED_BY_GATE`.

## Verification Before Write

| check | result |
|---|---:|
| rows | 310 |
| distinct objectIDs | 310 |
| duplicate IDs | 0 |
| writable rows | 310 |
| spans checked | 2,477 |
| grounding failures | 0 |
| leakage failures | 0 |
| dead writable rows | 0 |
| missing source bodies | 0 |
| non-Blog rows | 0 |
| writer dry-run payloads | 310 |
| full tests | 421 passed, 1 xfailed |

## Live Write

Algolia write was performed after validation.

| check | result |
|---|---:|
| payloads written | 310 |
| live readback exact matches | 310 |
| mismatches | 0 |
| missing records | 0 |
| live record count before/after | 12,036 / 12,036 |
| Blog records with both enrichment fields after write | 2,101 |
| all records with both enrichment fields after write | 2,345 |
| Blog `abstract_enriched` type | `list` |
| Blog `keyhighlights_enriched` type | `list` |

Write manifest:

- `docs/70-enrichment/reports/written-20260810-010846.json`
