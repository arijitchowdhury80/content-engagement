#!/usr/bin/env python3
"""
Is the writer actually reproducible?

Claimed, never tested. `claude -p` had no temperature control and the same page returned THIN on
one run and REAL on the next. glm-5.2 accepts temperature 0, so runs SHOULD be identical -- but
"should" is not evidence, and Chapter 4 depends on being able to re-run and get the same spans.

Runs the same records twice through the writer and diffs the selected spans.

  python3 docs/operations/enrichment/test_reproducibility.py --n 8
"""
import argparse, json, pathlib, sys
HERE = pathlib.Path(__file__).parent
sys.path.insert(0, str(HERE))
import enrich_run as er

ap = argparse.ArgumentParser(); ap.add_argument("--n", type=int, default=8)
args = ap.parse_args()

recs = [r for r in json.loads((HERE / "cache" / "pilot-manifest.json").read_text())
        if not r.get("fetch_error")][: args.n]
print(f"writer={er.WRITER} model={er.GLM_MODEL} temperature=0 · {len(recs)} records, twice\n")

same = diff = 0
for rec in recs:
    spec = er.FAMILIES[rec["family"]]
    lo, hi = spec.get("expected_span_count", [1, 4])
    prompt = er.WRITER_PROMPT.format(
        url=rec["source_url"], title=rec.get("title", ""), source=rec.get("source", ""),
        page_type=rec["page_type"], family=rec["family"], language_code=rec["language_code"],
        span_min=lo, span_max=hi, family_instruction=er.family_instruction(rec["family"]),
        markdown=rec["markdown"])
    a, _ = er.call_writer(prompt)
    b, _ = er.call_writer(prompt)
    ka = json.dumps({"v": (a or {}).get("verdict"), "s": (a or {}).get("abstract_spans")}, sort_keys=True)
    kb = json.dumps({"v": (b or {}).get("verdict"), "s": (b or {}).get("abstract_spans")}, sort_keys=True)
    ok = ka == kb
    same += ok; diff += (not ok)
    print(f"  {'IDENTICAL' if ok else 'DIFFERENT':10s} {(a or {}).get('verdict')} / {(b or {}).get('verdict')}  "
          f"{rec['source_url'][-46:]}")
    if not ok:
        print(f"     run1: {[s[:52] for s in ((a or {}).get('abstract_spans') or [])]}")
        print(f"     run2: {[s[:52] for s in ((b or {}).get('abstract_spans') or [])]}")

print(f"\nidentical {same}/{len(recs)} · different {diff}")
print("REPRODUCIBLE" if diff == 0 else
      "NOT FULLY REPRODUCIBLE -- record this honestly; Chapter 4 cannot assume identical re-runs")
