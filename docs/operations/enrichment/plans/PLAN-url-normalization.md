# Canonical URL Normalization

Date: 2026-08-12

## Purpose

Normalize the `url` field in `Algolia_Prod_Copy_Enhanced` so Agent Studio, source cards, and
non-browser consumers receive absolute public URLs directly from the index.

This is data enrichment, not prompt engineering. The browser widget can resolve relative links at
render time, but the retrieval record still carries the raw `url` value. The index should carry
the canonical URL so prompts do not need mechanical link-rewrite rules.

## Deterministic Tooling

Tool:

```bash
PYTHONPATH=skills/algolia-data-enrichment/scripts \
python3 skills/algolia-data-enrichment/scripts/url_normalize.py <mode> \
  --workspace . \
  --index Algolia_Prod_Copy_Enhanced \
  --out-dir docs/operations/enrichment/runs/20260812-url-normalization-a01 \
  --expected-total 11928
```

Modes:

- `audit` browses the full index, exports a full snapshot, records settings, hashes every record
  excluding `url`, and creates the candidate URL plan.
- `verify-http` performs live HTTP resolution for every planned URL, follows redirects, records
  the final effective URL, and creates payload plus rollback files only when coverage is 100%.
- `apply` writes only `{ objectID, url }` with `partialUpdateObjectNoCreate`, and requires
  `approvals/url-normalization-approved.json`.
- `verify-readback` browses the full index after write and proves every non-URL record hash is
  unchanged.

## Current Audit Evidence

Run directory:

```text
docs/operations/enrichment/runs/20260812-url-normalization-a01
```

Read-only audit command completed with:

```json
{"mode":"audit","ok":true,"plan_hash":"f937f92545768d89f6a2b099d234b740d7f7f6437ed3f515abe2b8d0a68862b3","rows":11928}
```

Audit summary:

- Total records checked: `11,928/11,928`
- Relative URLs: `10,091`
- Absolute URLs: `1,837`
- Candidate changes: `10,091`
- Raw count: `11,928`
- Distinct count: `11,928`
- Candidate hosts:
  - `www.algolia.com`: `10,091`
  - `support.algolia.com`: `1,695`
  - `academy.algolia.com`: `142`

Artifacts:

- `snapshot.jsonl` — full pre-write record export.
- `settings-before.json` — pre-write index settings.
- `url-normalization-plan.jsonl` — one deterministic row per record.
- `audit-summary.json` — count, host, source, and plan-hash summary.

## First Full HTTP Verification Attempt

Command:

```bash
PYTHONPATH=skills/algolia-data-enrichment/scripts \
python3 skills/algolia-data-enrichment/scripts/url_normalize.py verify-http \
  --workspace . \
  --index Algolia_Prod_Copy_Enhanced \
  --out-dir docs/operations/enrichment/runs/20260812-url-normalization-a01 \
  --expected-total 11928 \
  --workers 12 \
  --http-timeout 25
```

Result: **failed closed after checking `11,928/11,928` URLs.** No payload approval packet was
created.

Summary from `http-results.json` and `http-exceptions.json`:

- HTTP results recorded: `11,928`
- OK results: `8,258`
- Exceptions: `3,674`
- HTTP failures: `3,670`
- Unsupported final hosts despite HTTP 200: `4`
- Failure statuses:
  - status `0`: `3,107`
  - status `403`: `390`
  - status `404`: `173`
- Exception sources:
  - Documentation: `1,780`
  - Support: `1,695`
  - Academy: `128`
  - Website: `30`
  - Blog: `14`
  - Resources: `12`
  - Customer Stories: `9`
  - Developers: `6`

This means the URL mutation is **not approval-ready**. The next pass needs a retry/backoff policy
for transient connection failures and an explicit policy for authenticated Academy URLs,
Support verification behavior, 404 records, and redirects to `dashboard.algolia.com`,
`trust.algolia.com`, or `changelog.algolia.com`.

## Safety Contract

No Algolia write may happen unless:

- The audit row count equals the live raw record count.
- HTTP verification covers every one of the `11,928` rows.
- Any redirect to Support or Academy is captured as the final URL.
- Any redirect to an unsupported host fails the run.
- Any HTTP failure, soft missing document, malformed URL, or collision fails the run.
- `payloads.jsonl` contains only `objectID` and `url`.
- `rollback.jsonl` exists before `apply`.
- The approval file matches target index, expected total, expected write count, and plan hash.

The guarantee against content/URL mismatches is mechanical: writes are keyed by existing
`objectID`, payloads contain no content fields, and post-write readback hashes every full record
excluding only `url`.

## Approval File Shape

```json
{
  "target_index": "Algolia_Prod_Copy_Enhanced",
  "expected_total_records": 11928,
  "expected_write_count": 10091,
  "plan_hash": "<hash from verified HTTP plan>",
  "approved_by": "arijit"
}
```

The hash used for approval must be the `verify-http` hash, not the initial audit hash.
