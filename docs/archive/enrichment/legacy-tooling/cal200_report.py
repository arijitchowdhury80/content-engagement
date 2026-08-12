#!/usr/bin/env python3
"""
Aggregate a multi-batch calibration into one verdict, with an honest confidence interval.

WHY A CI AND NOT JUST A PERCENTAGE
  The 50-record gate produced 58% finished against a 60% bar -- a ONE RECORD gap, inside the
  measured +/-2-record run-to-run noise floor. That is not a result, it is a coin flip, and this
  project has already reversed two decisions on sub-noise deltas.

  So the question this run answers is not "what is the number" but "is the true rate above or below
  60%, outside noise". A Wilson score interval answers that and degrades honestly: if the interval
  straddles 60%, the run says SO rather than pretending.

  Be warned before reading the output: distinguishing 58% from 60% with 95% confidence needs N in
  the thousands. N=200 can only resolve a clearly-below or clearly-above result. A straddle is the
  expected outcome if the true rate really is near the bar, and it is a legitimate finding -- it
  means the bar cannot be adjudicated by more sampling at this scale.

    python3 docs/70-enrichment/cal200_report.py --out-dir <dir> --batches <dir> --cache <dir>
"""

from __future__ import annotations

import argparse
import collections
import glob
import json
import math
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from leakage_audit import (audit_record, build_corpus_frequency,  # noqa: E402
                           cache_name, load_cache)
from phase1_packet import classify  # noqa: E402

WRITABLE = {"PASS", "JUDGE_REVISE"}
BAR = 0.60


def wilson(k: int, n: int, z: float = 1.96) -> tuple[float, float]:
    """Wilson score interval. Correct near 0 and 1, unlike the normal approximation."""
    if n == 0:
        return (0.0, 0.0)
    p = k / n
    d = 1 + z * z / n
    centre = (p + z * z / (2 * n)) / d
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return (max(0.0, centre - half), min(1.0, centre + half))


def verdict(lo: float, hi: float) -> str:
    if lo > BAR:
        return f"ABOVE {BAR:.0%} — the whole interval clears the bar"
    if hi < BAR:
        return f"BELOW {BAR:.0%} — the whole interval misses the bar"
    return (f"STRADDLES {BAR:.0%} — not resolvable at this sample size; "
            f"more records of this kind will not settle it")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out-dir", required=True)
    ap.add_argument("--batches", required=True)
    ap.add_argument("--cache", required=True)
    ap.add_argument("--expect", type=int)
    args = ap.parse_args()

    rows = []
    for p in sorted(glob.glob(os.path.join(args.out_dir, "*", "results.jsonl"))):
        rows += [json.loads(l) for l in Path(p).read_text().splitlines() if l.strip()]

    ids = [r["objectID"] for r in rows]
    dupes = len(ids) - len(set(ids))
    if dupes:
        print(f"REFUSING: {dupes} duplicate objectIDs across {len(rows)} rows", file=sys.stderr)
        return 2
    if args.expect and len(rows) != args.expect:
        print(f"REFUSING: {len(rows)} rows, expected {args.expect}", file=sys.stderr)
        return 2

    src = {}
    for p in sorted(glob.glob(os.path.join(args.batches, "*.json"))):
        d = json.loads(Path(p).read_text())
        d = d.get("records", d) if isinstance(d, dict) else d
        for r in d:
            src[r["objectID"]] = r

    pages = load_cache(Path(args.cache)) if os.path.isdir(args.cache) else {}
    for sub in sorted(glob.glob(os.path.join(args.cache, "*"))):
        if os.path.isdir(sub):
            pages.update(load_cache(Path(sub)))
    freq = build_corpus_frequency(pages)

    kinds = collections.Counter()
    leak_classes = collections.Counter()
    dup_desc = 0
    n = len(rows)
    for r in rows:
        md = pages.get(cache_name(r["source_url"]))
        kind, audit, _ = classify(r, src.get(r["objectID"]), md, freq)
        kinds[kind] += 1
        if audit and audit.get("leaks"):
            for lk in audit["leaks"]:
                leak_classes[lk] += 1
        if kind == "ENRICHED":
            a = (r.get("abstract_enriched") or "").lower()
            d = (src.get(r["objectID"], {}).get("description") or "").strip().rstrip(".").lower()
            if d and len(d) > 25 and d[:60] in a:
                dup_desc += 1

    w = sum(1 for r in rows if r["status"] in WRITABLE)
    finished = kinds["ENRICHED"] - dup_desc + kinds["HONEST_THIN"]

    print(f"## Calibration — {n} records, {len(set(ids))} distinct, {dupes} duplicates\n")
    print("| metric | n | % | 95% CI (Wilson) | vs 60% bar |")
    print("|---|---|---|---|---|")
    for label, k in (("raw writable (gate metric)", w),
                     ("quality-adjusted finished", finished)):
        lo, hi = wilson(k, n)
        print(f"| {label} | {k}/{n} | **{100*k/n:.1f}%** | {100*lo:.1f}–{100*hi:.1f}% | "
              f"{verdict(lo, hi)} |")

    print("\n### Outcome taxonomy\n")
    print("| outcome | n | % |")
    print("|---|---|---|")
    for key in ("ENRICHED", "HONEST_THIN", "DUPLICATE", "LEAKED", "UNRESOLVED_THIN", "FAILED"):
        print(f"| {key} | {kinds[key]} | {100*kinds[key]/n:.1f}% |")
    print(f"\n- abstracts restating the indexed `description`: **{dup_desc}**")
    print(f"- `UNRESOLVED_THIN` (usable facts existed, model returned THIN): **{kinds['UNRESOLVED_THIN']}**")

    print("\n### Leak classes\n")
    if leak_classes:
        print("| class | n |")
        print("|---|---|")
        for k2, v in leak_classes.most_common():
            print(f"| {k2} | {v} |")
    else:
        print("none")

    causes = collections.Counter()
    for r in rows:
        for g in (r.get("gate_failures") or []):
            import re
            causes[re.sub(r"~?\d+", "N", g)[:70]] += 1
        if r["status"] == "NO_ABSTRACT_THIN":
            causes[f"THIN: {r.get('insufficient_reason')}"] += 1
    print("\n### Failure causes\n")
    print("| n | cause |")
    print("|---|---|")
    for k2, v in causes.most_common(12):
        print(f"| {v} | `{k2}` |")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
