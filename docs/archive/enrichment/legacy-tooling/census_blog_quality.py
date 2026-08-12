#!/usr/bin/env python3
"""
Full-corpus census: is EVERY enriched blog record grounded, leak-free and defect-free?

WHY A WHOLE-CORPUS PASS AND NOT THE PER-RUN PACKETS
  Each run validated its own output. That is not the same claim as "the corpus is sound", for two
  reasons. First, the effective corpus is six output folders superseding each other by objectID, so
  no single packet ever saw the set that would actually be written. Second, `canonicalise()` was
  fixed on 2026-08-10 -- the accepted 2,026 records were produced and validated under the OLD
  canonicaliser, and a grounding verdict computed with a different comparison function is not
  evidence about this one.

  So every enriched record is re-checked against its cached Scout body, with the code as it stands.

NO SAMPLING. Arijit's standing rule: one record at a time, full census, never an estimate
presented as the answer.

PERFORMANCE NOTE
  The naive version canonicalises the page body once per span -- roughly 4,800 times over ~2,700
  pages -- and does not finish. `canonicalise` is pure, so the projection is cached per objectID.
  Same numbers, and it runs in a couple of minutes.

    python3 docs/70-enrichment/census_blog_quality.py --out reports/blog-corpus-census-20260810.json
"""

from __future__ import annotations

import argparse
import collections
import glob
import json
import pathlib
import sys
import time

HERE = pathlib.Path(__file__).parent
sys.path.insert(0, str(HERE))

from make_quarantine_batches import EFFECTIVE_ORDER, effective_corpus  # noqa: E402
from span_gate import canonicalise  # noqa: E402
from validate_blog_outputs import (markdown_visible_text, overlap,  # noqa: E402
                                   span_leak_reasons)
from verify_repair_packet import quality_defects  # noqa: E402

# Precedence comes from make_quarantine_batches.EFFECTIVE_ORDER -- ONE definition, imported, never
# re-typed. A second copy is how a census ends up measuring a different corpus than the one that
# would be written.
ORDER = list(EFFECTIVE_ORDER)
WRITABLE = {"PASS", "JUDGE_REVISE"}


class BodyCache:
    """canonicalise() is pure, so cache its result per page. This is the whole speed-up."""

    def __init__(self) -> None:
        self.canon: dict[str, str] = {}
        self.visible: dict[str, str] = {}

    def canonical(self, oid: str, body: str) -> str:
        if oid not in self.canon:
            self.canon[oid] = canonicalise(body).text
        return self.canon[oid]

    def visible_canonical(self, oid: str, body: str) -> str:
        if oid not in self.visible:
            self.visible[oid] = canonicalise(markdown_visible_text(body)).text
        return self.visible[oid]


def grounded(cache: BodyCache, oid: str, body: str, span: str) -> str | None:
    """The mode that found this span, or None. Same three modes validate_blog_outputs uses."""
    if not span or not str(span).strip():
        return None
    if span in body:
        return "exact"
    cspan = canonicalise(span).text
    if cspan in cache.canonical(oid, body):
        return "canonical"
    if cspan in cache.visible_canonical(oid, body):
        return "visible_markdown"
    return None


def load_bodies() -> dict[str, dict]:
    """objectID -> cached fetch row. FIRST win, and rows with a fetch_error are never eligible."""
    bodies: dict[str, dict] = {}
    for path in sorted(glob.glob(str(HERE / "cache-scout" / "*" / "*" / "pilot-manifest.json"))):
        try:
            rows = json.loads(pathlib.Path(path).read_text())
        except (json.JSONDecodeError, OSError):
            continue
        for row in rows:
            if row.get("fetch_error") or not row.get("markdown"):
                continue
            bodies.setdefault(row["objectID"], row)
    return bodies


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--results", nargs="*", default=ORDER)
    ap.add_argument("--out", default=str(HERE / "reports" / "blog-corpus-census-20260810.json"))
    args = ap.parse_args()

    started = time.time()
    eff = effective_corpus(args.results)
    prov: dict[str, str] = {}
    for root in args.results:
        for path in sorted(glob.glob(str(HERE / root / "*" / "results.jsonl"))):
            for line in open(path):
                if line.strip():
                    prov[json.loads(line)["objectID"]] = root

    bodies = load_bodies()
    cache = BodyCache()

    status = collections.Counter(r.get("status") for r in eff.values())
    enriched = [oid for oid, r in eff.items() if r.get("status") in WRITABLE]

    spans = 0
    modes = collections.Counter()
    ground_fail: list[dict] = []
    leak: list[dict] = []
    defects = collections.Counter()
    defect_rows: list[dict] = []
    missing_body: list[str] = []
    no_spans: list[str] = []

    for n, oid in enumerate(enriched, 1):
        row = eff[oid]
        src = bodies.get(oid)
        if not src:
            missing_body.append(oid)
            continue
        body = src["markdown"]
        title = src.get("title") or ""
        desc = src.get("description") or ""
        abstract = row.get("abstract_spans_stored") or []
        highlights = row.get("keyhighlights_enriched") or []
        if not abstract:
            no_spans.append(oid)
        for field, vals in (("abstract", abstract), ("highlight", highlights)):
            for span in vals:
                spans += 1
                mode = grounded(cache, oid, body, span)
                modes[mode or "NOT_FOUND"] += 1
                if mode is None:
                    ground_fail.append({"objectID": oid, "from": prov[oid], "field": field,
                                        "span": span[:200],
                                        "url": src.get("source_url")})
                reasons = span_leak_reasons(span, title, desc)
                if reasons:
                    leak.append({"objectID": oid, "from": prov[oid], "field": field,
                                 "reasons": reasons, "span": span[:200]})
        found = quality_defects(row, src)
        if found:
            defect_rows.append({"objectID": oid, "from": prov[oid],
                                "defects": sorted(set(found)),
                                "url": src.get("source_url")})
            for d in set(found):
                defects[d] += 1
        if n % 250 == 0:
            print(f"  {n}/{len(enriched)} ... {int(time.time()-started)}s", flush=True)

    report = {
        "results_roots": args.results,
        "effective_records": len(eff),
        "status": dict(status),
        "enriched_records": len(enriched),
        "not_enriched": {k: v for k, v in status.items() if k not in WRITABLE},
        "provenance_of_enriched": dict(collections.Counter(prov[o] for o in enriched)),
        "spans_checked": spans,
        "grounding_modes": dict(modes),
        "grounding_failures": ground_fail,
        "leakage_failures": leak,
        "quality_defects_by_class": dict(defects),
        "quality_defect_records": defect_rows,
        "records_missing_cached_body": missing_body,
        "enriched_rows_with_no_abstract": no_spans,
        "elapsed_seconds": round(time.time() - started, 1),
    }
    clean = (not ground_fail and not leak and not defect_rows
             and not missing_body and not no_spans)
    report["all_clean"] = clean

    out = pathlib.Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2))

    print(f"\neffective records   : {len(eff)}")
    print(f"enriched            : {len(enriched)}")
    print(f"not enriched        : {report['not_enriched']}")
    print(f"spans checked       : {spans}")
    print(f"grounding modes     : {dict(modes)}")
    print(f"grounding failures  : {len(ground_fail)}")
    print(f"leakage failures    : {len(leak)}")
    print(f"quality defect rows : {len(defect_rows)} {dict(defects)}")
    print(f"missing cached body : {len(missing_body)}")
    print(f"\nALL CLEAN: {clean}")
    print(f"report: {out}")
    return 0 if clean else 2


if __name__ == "__main__":
    raise SystemExit(main())
