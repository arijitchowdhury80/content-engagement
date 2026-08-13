# Enrichment Operations

This folder is the active operating surface for corpus and index enrichment work.

Keep only:

- `plans/` - reviewed plans, approval packets, and operating decisions.
- `state/` - current corpus state and schema files needed by the enrichment skill.
- `prompts/` - enrichment and validation prompt templates.
- `incidents/` - incident notes and recovery records.

Do not commit generated batches, run directories, fetched caches, snapshots, quarantine payloads,
or work queues. The durable reviewed outputs from old runs now live under
`docs/evidence/enrichment/`.

Run the project-local enrichment CLI from the repository root:

```bash
PYTHONPATH=skills/algolia-data-enrichment/scripts \
python3 skills/algolia-data-enrichment/scripts/algolia_enrich.py <command> --workspace .
```
