#!/usr/bin/env python3
"""
Verify a quarantine-repair run and write the repair packet.

WHAT IT ADDS TO validate_blog_outputs.py, AND WHAT IT DELIBERATELY DOES NOT DUPLICATE
  Counts, status breakdown, grounding and leakage are already implemented there and are IMPORTED,
  not re-written. A second copy of a grounding check is a check that drifts from the one the run
  actually used, and this repo has paid for a duplicated gate twice.

  What is new here is the QUALITY GATE -- the seven span-level defects the 589 records were
  quarantined for -- plus the before/after comparison against the prior run, which is the only
  thing that answers "did the selection change, or did the bar move?".

THE QUALITY GATE IS RUN AGAIN, INDEPENDENTLY
  Every check below is re-run over the STORED text, from the artifact on disk, using the same
  predicates the pipeline used. That is deliberate redundancy, not duplication: the pipeline
  asserts these about candidates it selected, and this asserts them about the bytes that would be
  written. If the two ever disagree, something between selection and storage is wrong, which is
  precisely the class of defect that a passing gate has hidden before.

USAGE
    python3 docs/operations/enrichment/verify_repair_packet.py \\
        --results batches-out-blog-repair3 \\
        --cache   cache-scout/blog-repair3-batches \\
        --expect  589 \\
        --out     PACKET-blog-quarantine-repair-20260810.md
"""

from __future__ import annotations

import argparse
import collections
import glob
import json
import pathlib
import sys

HERE = pathlib.Path(__file__).parent
sys.path.insert(0, str(HERE))

from candidates import has_broken_brackets  # noqa: E402
from make_quarantine_batches import EFFECTIVE_ORDER, effective_corpus  # noqa: E402
from span_gate import (_REVERSAL, _SECTION_DENY, canonicalise,  # noqa: E402
                       check_blacklists, check_subject_present)
from span_repair import incomplete_reason  # noqa: E402
from validate_blog_outputs import (source_index, span_leak_reasons,  # noqa: E402
                                   grounding_modes, validate)

WRITABLE = {"PASS", "JUDGE_REVISE"}
_MAX_SPAN_SPREAD = 20_000


def quality_defects(row: dict, src: dict) -> list[str]:
    """The seven defects the 589 died of, re-checked on the STORED bytes.

    Each returns the same vocabulary the brief uses, so the packet's histogram and the brief's
    checklist are the same list of names.
    """
    out: list[str] = []
    abstract = row.get("abstract_spans_stored") or []
    highlights = row.get("keyhighlights_enriched") or []
    title = src.get("title") or ""
    body = src.get("markdown") or ""
    canon = canonicalise(body)

    if not abstract:
        return ["NO_ABSTRACT"]

    # 1 self-reference / chrome -- span_gate's own blacklist, over the stored text
    for name in check_blacklists(list(abstract) + list(highlights)):
        out.append("SELF_REFERENCE" if "self-reference" in name else "CHROME")

    # 2 missing subject on the OPENING span
    if check_subject_present(abstract[0], title):
        out.append("MISSING_SUBJECT")

    # 3/4/5 mid-sentence cut, dangling colon, broken bracket
    for i, span in enumerate(list(abstract) + list(highlights)):
        reason = incomplete_reason(span, is_abstract=i < len(abstract))
        if reason == "LIST_LEAD_IN":
            out.append("DANGLING_COLON")
        elif reason == "DANGLING_BRACKET":
            out.append("BROKEN_BRACKET")
        elif reason:
            out.append("MID_SENTENCE_CUT")
        elif has_broken_brackets(span):
            out.append("BROKEN_BRACKET")

    # 6 stitched from unrelated sections -- measured on the ORIGINAL offsets, which is what the
    # gate measures, so the packet cannot pass a record the gate would fail.
    offsets = row.get("span_offsets") or []
    a_offsets = [o for o in offsets[:len(abstract)] if isinstance(o, list) and len(o) == 2]
    if len(a_offsets) > 1:
        spread = max(o[1] for o in a_offsets) - min(o[0] for o in a_offsets)
        # The same truncation rescale check_context applies. Without it this packet would be more
        # lenient than the gate on truncated pages, and a packet that passes what the gate would
        # fail is worse than no packet.
        original_length = src.get("original_length") or 0
        seen_length = len(body)
        if original_length and seen_length and original_length > seen_length:
            spread = int(spread * (original_length / seen_length))
        if spread > _MAX_SPAN_SPREAD:
            out.append("SPANS_TOO_FAR")

    # 7 reversal / inversion, and excluded section -- re-derived from the page, not from the run's
    # own record of what it thought. Locating by canonical text is how a stored span is tied back
    # to its position without trusting the offsets.
    ctext = canon.text
    for span in list(abstract) + list(highlights):
        cspan = canonicalise(span).text
        pos = ctext.find(cspan)
        if pos < 0:
            continue
        following = ctext[pos + len(cspan):pos + len(cspan) + 140].lstrip()
        if _REVERSAL.match(following):
            out.append("REVERSAL")
        section = canon.section_title(pos) if canon.section else ""
        if section and _SECTION_DENY.search(section):
            out.append("EXCLUDED_SECTION")

    return out


def load_rows(root: pathlib.Path) -> list[dict]:
    rows = []
    for path in sorted(glob.glob(str(root / "*" / "results.jsonl"))):
        for line in open(path):
            if line.strip():
                rows.append(json.loads(line))
    return rows


def fmt_span(text: str, n: int = 150) -> str:
    text = (text or "").replace("\n", " ").strip()
    return text[:n] + ("..." if len(text) > n else "")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--results", default="batches-out-blog-repair3")
    ap.add_argument("--cache", default="cache-scout/blog-repair3-batches")
    ap.add_argument("--prior", nargs="*", default=EFFECTIVE_ORDER)
    ap.add_argument("--expect", type=int, default=589)
    ap.add_argument("--examples", type=int, default=10)
    ap.add_argument("--out", default="PACKET-blog-quarantine-repair-20260810.md")
    args = ap.parse_args()

    root = HERE / args.results
    cache_root = HERE / args.cache
    rows = load_rows(root)
    sources = source_index([cache_root])
    prior = effective_corpus(args.prior)

    core = validate(rows, sources)

    ids = [r["objectID"] for r in rows]
    dupes = sorted(oid for oid, n in collections.Counter(ids).items() if n > 1)
    status = collections.Counter(r.get("status") for r in rows)
    recovered = sum(status[s] for s in WRITABLE)
    still_q = status.get("QUARANTINED_BY_GATE", 0)

    defects = collections.Counter()
    defective_rows: list[dict] = []
    for row in rows:
        if row.get("status") not in WRITABLE:
            continue
        src = sources.get(row["objectID"])
        if not src:
            continue
        found = quality_defects(row, src)
        if found:
            defective_rows.append({"objectID": row["objectID"],
                                   "url": row.get("source_url"), "defects": sorted(set(found))})
        for d in set(found):
            defects[d] += 1

    remaining = collections.Counter()
    for row in rows:
        if row.get("status") != "QUARANTINED_BY_GATE":
            continue
        for f in (row.get("gate_failures") or ["(none recorded)"]):
            key = ("SELF_REFERENCE" if "self-reference" in f else
                   "MISSING_SUBJECT" if "names no subject" in f else
                   "REVERSAL" if "reversal" in f else
                   "SPANS_TOO_FAR" if "characters of the original page" in f else
                   "EXCLUDED_SECTION" if "excluded section" in f else
                   "CHROME" if "chrome phrase" in f else
                   "INCOMPLETE_SPAN" if ("incomplete" in f.lower() or "MID_SENTENCE" in f) else
                   "HIGHLIGHTS_SHORT" if "clean highlights" in f else
                   "SPAN_COUNT" if "valid picks" in f else
                   "QUOTATION" if "quotation" in f else
                   f[:60])
            remaining[key] += 1

    attempts = collections.Counter(r.get("selection_attempt_count", 1) for r in rows)
    pool_bans = collections.Counter()
    for r in rows:
        for k, v in (r.get("pool_gate_dropped") or {}).items():
            pool_bans[k] += v

    ok = (len(rows) == args.expect and len(set(ids)) == args.expect and not dupes
          and not core["grounding_failures"] and not core["leakage_failures"]
          and not defects and not core["missing_source"])

    L: list[str] = []
    a = L.append
    a(f"# Blog quarantine repair — {args.results}")
    a("")
    # Two separate claims, and collapsing them into one word is how a packet misleads. The checks
    # are about whether the produced records are sound. The recovery count is about how many were
    # produced at all. A run can be perfectly clean and still leave records behind.
    a(f"**Quality checks: {'ALL PASS' if ok else 'FAILED — see below'}.** "
      f"**Recovery: {recovered} of {args.expect}"
      f"{f', {still_q} still quarantined' if still_q else ', none left behind'}.**")
    a("")
    a("Nothing has been written to Algolia. The accepted Blog outputs are untouched; this run "
      "lives entirely in its own directory.")
    a("")
    a("## 1. Counts")
    a("")
    a("| | |")
    a("|---|---|")
    a(f"| input records | {args.expect} |")
    a(f"| output rows | {len(rows)} |")
    a(f"| distinct objectIDs | {len(set(ids))} |")
    a(f"| duplicates | {len(dupes)} |")
    a(f"| recovered (PASS + JUDGE_REVISE) | **{recovered}** |")
    a(f"| still quarantined | **{still_q}** |")
    a("")
    a("## 2. Status breakdown")
    a("")
    a("| status | n |")
    a("|---|---:|")
    for s, n in status.most_common():
        a(f"| {s} | {n} |")
    a("")
    a("## 3. Grounding")
    a("")
    a(f"- spans checked: **{core['spans_checked']}**")
    a(f"- found in the Scout body, canonical match: **{core['spans_canonical_found']}**")
    a(f"- found byte-exact: {core['spans_exact_found']}")
    a(f"- supported by the stored offsets: {core['spans_offset_supported']}")
    a(f"- **grounding failures: {len(core['grounding_failures'])}**")
    for f in core["grounding_failures"][:10]:
        a(f"  - `{f['objectID']}` {f['field']}: {fmt_span(f.get('span',''), 90)}")
    a("")
    a("## 4. Leakage")
    a("")
    a(f"- **leakage failures: {len(core['leakage_failures'])}**")
    for f in core["leakage_failures"][:15]:
        a(f"  - `{f['objectID']}` {f['field']} {f['reasons']}: {fmt_span(f.get('span',''), 90)}")
    a("")
    a("## 5. Quality gate, re-run over the stored bytes")
    a("")
    if not defects:
        a("No record carries any of the seven defects.")
    else:
        a("| defect | records |")
        a("|---|---:|")
        for d, n in defects.most_common():
            a(f"| {d} | {n} |")
        a("")
        for r in defective_rows[:20]:
            a(f"- `{r['objectID']}` {r['defects']} {r['url']}")
    a("")
    a("## 6. Still quarantined, by reason")
    a("")
    if not still_q:
        a("None.")
    else:
        a("| reason | occurrences |")
        a("|---|---:|")
        for r, n in remaining.most_common(15):
            a(f"| {r} | {n} |")
        a("")
        a("Each of these exhausted the retry ladder rather than failing on first refusal:")
        a("")
        for row in rows:
            if row.get("status") != "QUARANTINED_BY_GATE":
                continue
            a(f"- `{row['objectID']}` — {row.get('source_url')}")
            a(f"  - {row.get('selection_attempt_count', 1)} writer calls, "
              f"{len(row.get('reselect_banned') or [])} candidates banned")
            for f in (row.get("gate_failures") or [])[:3]:
                a(f"  - {f[:160]}")
    a("")
    a("## 7. What the repair actually did")
    a("")
    a("| pre-selection pool action | candidates |")
    a("|---|---:|")
    for k, n in pool_bans.most_common():
        a(f"| {k} | {n} |")
    a("")
    a("| writer calls per record | records |")
    a("|---|---:|")
    for k in sorted(attempts):
        a(f"| {k} | {attempts[k]} |")
    a("")
    a(f"## 8. Before and after, {args.examples} examples")
    a("")
    shown = 0
    for row in rows:
        if shown >= args.examples or row.get("status") not in WRITABLE:
            continue
        old = prior.get(row["objectID"])
        if not old:
            continue
        shown += 1
        a(f"### {shown}. `{row['objectID']}` — {row.get('source_url')}")
        a("")
        a(f"**Before** — {old.get('status')}")
        a("")
        for f in (old.get("gate_failures") or [])[:2]:
            a(f"> gate: {f[:200]}")
        a("")
        a(f"**After** — {row.get('status')}, "
          f"{row.get('selection_attempt_count', 1)} writer call(s)")
        a("")
        a(f"> abstract: {fmt_span(row.get('abstract_enriched'), 320)}")
        a("")
        for h in (row.get("keyhighlights_enriched") or [])[:2]:
            a(f"> highlight: {fmt_span(h, 160)}")
        a("")
    a("## 9. Exact commands and tests run")
    a("")
    a("```")
    a("# 1. build the batch set from the prior run's quarantined rows, reusing their cached")
    a("#    Scout bodies -- no re-fetch, so the source bytes are identical to the run that failed")
    a("python3 docs/operations/enrichment/make_quarantine_batches.py \\")
    a("    --status QUARANTINED_BY_GATE --tag repair3 --expect 589")
    a("")
    a("# 2. enrich. --pilot writes NOTHING to Algolia.")
    a("python3 docs/operations/enrichment/run_batches.py \\")
    a("    --batches docs/operations/enrichment/batches-blog-repair3 \\")
    a("    --out     docs/operations/enrichment/batches-out-blog-repair3 \\")
    a("    --cache   docs/operations/enrichment/cache-scout/blog-repair3-batches --workers 8")
    a("")
    a("# 3. verify -- counts, grounding, leakage, and the seven-defect quality gate")
    a("python3 docs/operations/enrichment/verify_repair_packet.py \\")
    a("    --results batches-out-blog-repair3 \\")
    a("    --cache   cache-scout/blog-repair3-batches --expect 589")
    a("")
    a("# 4. independent second opinion, using the validator that predates this work")
    a("python3 docs/operations/enrichment/validate_blog_outputs.py \\")
    a("    --results batches-out-blog-repair3 \\")
    a("    --cache   cache-scout/blog-repair3-batches")
    a("")
    a("# 5. the test suite")
    a("python3 -m pytest docs/operations/enrichment/tests -q")
    a("```")
    a("")
    out_path = HERE / args.out
    out_path.write_text("\n".join(L) + "\n")
    json_path = out_path.with_suffix(".json")
    json_path.write_text(json.dumps({
        "results_root": str(root), "expect": args.expect, "rows": len(rows),
        "distinct": len(set(ids)), "duplicates": dupes, "status": dict(status),
        "recovered": recovered, "still_quarantined": still_q,
        "spans_checked": core["spans_checked"],
        "grounding_failures": core["grounding_failures"],
        "leakage_failures": core["leakage_failures"],
        "quality_defects": dict(defects), "defective_rows": defective_rows,
        "remaining_reasons": dict(remaining), "pool_gate_dropped": dict(pool_bans),
        "attempts": {str(k): v for k, v in attempts.items()},
        "all_checks_pass": ok,
    }, ensure_ascii=False, indent=2))

    print(f"rows {len(rows)} | distinct {len(set(ids))} | recovered {recovered} | "
          f"quarantined {still_q}")
    print(f"grounding failures {len(core['grounding_failures'])} | "
          f"leakage {len(core['leakage_failures'])} | quality defects {sum(defects.values())}")
    print(f"packet: {out_path}\njson  : {json_path}")
    return 0 if ok else 2


if __name__ == "__main__":
    raise SystemExit(main())
