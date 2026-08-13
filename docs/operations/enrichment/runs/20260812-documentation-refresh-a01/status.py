"""Full-dimension status for the Documentation refresh.

Reports every field the refresh is responsible for, not just the two that are easy to count.
It builds real records from whatever is cached so far and checks them, so the number shown is
measured rather than assumed.
"""
import glob
import json
import os
import sys

sys.path.insert(0, "skills/algolia-data-enrichment/scripts")
from pathlib import Path  # noqa: E402

from algolia_enrichment import docmerge, docrefresh, seed, taxonomy  # noqa: E402
from algolia_enrichment import taxonomy_correctness as tc  # noqa: E402
from algolia_enrichment.api import AlgoliaClient  # noqa: E402
from algolia_enrichment.errors import EnrichmentError  # noqa: E402

RUN = Path("docs/operations/enrichment/runs/20260812-documentation-refresh-a01")
TOTAL = 1934
SCHEMA = taxonomy.load_schema(
    Path("skills/algolia-data-enrichment/references/taxonomy-schema.algolia-com.json"))
COMPILED = tc.compile_rules(SCHEMA)
AXES = ("page_type", "feature", "product", "language_platform", "integration_platform")


def main() -> int:
    files = sorted(glob.glob(str(RUN / "cache-scout" / "*.json")))
    n = len(files)
    if not n:
        print("0/1934 — nothing fetched yet")
        return 0

    stamps = sorted(os.path.getmtime(f) for f in files)
    span = stamps[-1] - stamps[0]
    rate = (n - 1) / span * 60 if span > 0 else 0
    left = (TOTAL - n) / rate if rate else 0

    client = AlgoliaClient.from_env(Path("."))
    existing = {seed.canonical_key(r.get("url") or ""): r
                for r in client.browse("Algolia_Prod_Copy_Enhanced")
                if r.get("source") == "Documentation"}

    built, fetch_err, build_err, lost = [], 0, 0, 0
    for path in files:
        got = json.loads(Path(path).read_text())
        if got.get("fetch_error") or got.get("redirect_mismatch"):
            fetch_err += 1
            continue
        try:
            record = docrefresh.build_record(
                got.get("url") or got.get("key"), got.get("markdown") or "", SCHEMA, COMPILED,
                metadata={"title": got.get("page_title"),
                          "description": got.get("page_description")})
        except EnrichmentError:
            build_err += 1
            continue
        record.pop("needs_title", None)
        record.pop("needs_description", None)
        prior = existing.get(seed.canonical_key(record["url"]))
        merged = docmerge.fill_required_axes(docmerge.merge_record(prior, record), SCHEMA)
        if prior:
            try:
                docmerge.assert_no_field_lost(prior, merged)
            except EnrichmentError:
                lost += 1
        built.append(merged)

    b = len(built)
    conformance = taxonomy.validate_records(built, SCHEMA) if built else {"violation_count": 0}
    full_url = sum(1 for r in built if str(r.get("url") or "").startswith("https://www.algolia.com/"))
    axis_counts = {a: sum(1 for r in built if r.get(a)) for a in AXES}
    unresolved = sum(1 for r in built
                     for p in (r.get("taxonomy_provenance") or {}).values()
                     if p == "unresolved-no-rule")

    print(
        f"{n}/{TOTAL} fetched | {rate:.0f}/min | ~{left:.0f} min left | "
        f"fetch_err {fetch_err} build_err {build_err}\n"
        f"    title {sum(1 for r in built if str(r.get('title') or '').strip())}/{b} | "
        f"desc {sum(1 for r in built if str(r.get('description') or '').strip())}/{b} | "
        f"body {sum(1 for r in built if str(r.get('body') or '').strip())}/{b} | "
        f"FULL URL {full_url}/{b}\n"
        f"    TAXONOMY violations {conformance['violation_count']} | "
        f"page_type {axis_counts['page_type']}/{b} | feature {axis_counts['feature']}/{b} | "
        f"product {axis_counts['product']} | lang_platform {axis_counts['language_platform']} | "
        f"integ_platform {axis_counts['integration_platform']}\n"
        f"    unresolved axes {unresolved} | fields lost in merge {lost} | "
        f"abstract preserved {sum(1 for r in built if str(r.get('abstract') or '').strip())}",
        flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
