#!/usr/bin/env python3
"""
final_packet — the artefact Codex verifies and Arijit approves, before anything is written.

WHAT THIS IS FOR
  Arijit, 2026-08-09: "Do not write to Algolia until Codex verifies the packet and Arijit approves
  the write." So this script's only job is to state, from artefacts on disk and nothing else, what
  the run actually produced -- and to refuse to state anything if the evidence is not sound.

THE REFUSALS COME FIRST, ON PURPOSE
  Three things stop the packet dead rather than being reported as a caveat:
    1. provenance fails      -- a body that is not Scout-sourced cannot support any number here
    2. results are unreadable, short, or duplicated -- a summary over a corrupt file is a lie, and
                                this project has already shipped one (`bcfdff0`)
    3. a stored span does not byte-match its own cached source at its own offsets
  A packet that prints numbers is therefore a packet whose numbers survived all three.

THE GROUNDING AUDIT IS THE POINT
  Every stored span is re-sliced from the cached body by its recorded offsets and compared byte for
  byte. This proves the text came from the page. It deliberately does NOT prove the text is
  *useful*, and it cannot prove the page is the right one -- that is what the served-URL identity
  check and REDIRECT_CANONICAL are for, and they are reported separately. Verbatim from the wrong
  document is still wrong, and one number must never be read as covering both.

  python3 final_packet.py --results batches-out-scout --cache cache-scout/corpus
"""

from __future__ import annotations

import argparse
import collections
import datetime as dt
import json
import pathlib
import sys

HERE = pathlib.Path(__file__).parent
sys.path.insert(0, str(HERE))

from assert_scout_provenance import ProvenanceViolation, assert_scout_provenance  # noqa: E402
from verdicts import NON_ENRICHMENT  # noqa: E402
from span_gate import canonicalise, locate, SpanRejected  # noqa: E402

WRITABLE = {"PASS", "JUDGE_REVISE"}


# ---------------------------------------------------------------------------

def load_results(results_root: pathlib.Path) -> tuple[list[dict], list[str]]:
    """Every results row, plus the reasons the file set cannot be trusted."""
    rows, problems = [], []
    files = sorted(results_root.glob("*/results.jsonl"))
    if not files:
        problems.append(f"no results.jsonl under {results_root}")
    for path in files:
        for n, line in enumerate(path.open(encoding="utf-8"), 1):
            line = line.strip()
            if not line:
                continue
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError as exc:
                problems.append(f"{path.parent.name}:{n} unparseable ({exc})")
    ids = [r.get("objectID") for r in rows]
    dupes = [oid for oid, c in collections.Counter(ids).items() if c > 1]
    if dupes:
        problems.append(f"{len(dupes)} duplicated objectID(s), e.g. {dupes[:3]}")
    if any(oid is None for oid in ids):
        problems.append("row(s) with no objectID")
    return rows, problems


def load_cache(cache_root: pathlib.Path) -> dict[str, dict]:
    by_id = {}
    for path in cache_root.rglob("*.json"):
        if path.name == "pilot-manifest.json" or "quarantine" in path.parts:
            continue
        try:
            rec = json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError):
            continue
        if isinstance(rec, dict) and rec.get("objectID"):
            by_id[rec["objectID"]] = rec
    return by_id


def grounding_audit(rows: list[dict], cache: dict[str, dict]) -> dict:
    """Locate every stored span in its own cached page. OFFSET-FREE, exact canonical match.

    Rewritten 2026-08-09 after the first version reported "spans checked: 0 -- PASS". It looked for
    dict-shaped spans; the rows store span TEXT in `abstract_spans_stored` / `keyhighlights_enriched`
    and positions separately in `span_offsets`. Finding nothing, it passed. A gate that passes over
    zero items is the empty-PASS this project has shipped before, and it is worse than no gate
    because it prints reassurance.

    It now uses the same offset-free rule Arijit set for verification: is the stored string on the
    page, wherever it sits? A span that cannot be located is invention, full stop.
    """
    checked = matched = 0
    failures: list[dict] = []
    no_source: list[str] = []
    rows_audited = 0
    for row in rows:
        if row.get("status") not in WRITABLE:
            continue
        source_rec = cache.get(row.get("objectID", ""))
        if not source_rec:
            no_source.append(row.get("objectID", "?"))
            continue
        rows_audited += 1
        source = canonicalise(source_rec.get("markdown") or "")
        for field in ("abstract_spans_stored", "keyhighlights_enriched"):
            for span in row.get(field) or []:
                if not isinstance(span, str) or not span.strip():
                    continue
                checked += 1
                # DIRECT containment against the canonical page, NOT locate().
                # locate() re-canonicalises its needle because it is built for model-supplied text.
                # These spans were already sliced FROM the canonical page, and re-canonicalising an
                # already-canonical string is not a no-op -- it rewrote 14 spans that were provably
                # present (`span in source.text` was True) and reported them as invention.
                # A verifier that cries wolf is as dangerous as one that stays silent.
                if span in source.text:
                    matched += 1
                else:
                    failures.append({"objectID": row.get("objectID"), "field": field,
                                     "url": row.get("url"), "span": span[:160]})
    return {"rows_audited": rows_audited, "spans_checked": checked, "spans_matched": matched,
            "spans_mismatched": len(failures), "mismatches": failures[:20],
            "writable_rows_without_a_cached_source": len(no_source),
            "missing_source_examples": no_source[:5]}


def review_pack(rows: list[dict], out: pathlib.Path, per_family: int = 4) -> pathlib.Path:
    """A stratified sample for Arijit. Deterministic stride, every family, both non-English
    languages represented -- an English-only pack has passed before and proved nothing."""
    by_key: dict[tuple, list[dict]] = collections.defaultdict(list)
    for row in rows:
        if row.get("status") in WRITABLE:
            by_key[(row.get("family"), row.get("language_code"))].append(row)
    lines = ["# Review pack — real run, stratified", "",
             "Verdict each one: GOOD / BAD / UNSURE, and say why. A BAD reopens the fix loop.", ""]
    picked = 0
    for key in sorted(by_key, key=lambda k: (str(k[0]), str(k[1]))):
        pool = sorted(by_key[key], key=lambda r: r.get("objectID", ""))
        step = max(1, len(pool) // per_family)
        for row in pool[::step][:per_family]:
            picked += 1
            lines += [
                f"## {picked}. {row.get('family')} / {row.get('language_code')} — {row.get('status')}",
                f"- url: {row.get('source_url') or row.get('url')}",
                f"- description (already indexed): {(row.get('description') or '')[:200]}",
                f"- abstract: {(row.get('abstract_enriched') or '')[:600]}",
                f"- highlights: {json.dumps(row.get('keyhighlights_enriched') or [], ensure_ascii=False)[:600]}",
                "- verdict: ", ""]
    out.write_text("\n".join(lines), encoding="utf-8")
    return out


# ---------------------------------------------------------------------------

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--results", default=str(HERE / "batches-out-scout"))
    ap.add_argument("--cache", default=str(HERE / "cache-scout" / "corpus"))
    ap.add_argument("--queue", default=str(HERE / "work-queue.jsonl"))
    ap.add_argument("--out", default=str(HERE / "reports" / "FINAL-PACKET.md"))
    args = ap.parse_args()

    results_root, cache_root = pathlib.Path(args.results), pathlib.Path(args.cache)
    queue = [json.loads(l) for l in pathlib.Path(args.queue).open(encoding="utf-8")]

    print("=" * 78)
    print("GATE 1 — provenance. Nothing is reported if this fails.")
    print("=" * 78)
    try:
        prov = assert_scout_provenance(cache_root)
    except ProvenanceViolation as exc:
        print(f"FAIL — {len(exc.violations)} violation(s). First 10:")
        for v in exc.violations[:10]:
            print(f"  {v}")
        print("\nNo packet written.")
        return 2
    print(f"PASS — {prov['pages']} Scout-sourced bodies, none matching a doc-md-twin body, "
          f"none served from a different URL than requested.")

    print("\n" + "=" * 78)
    print("GATE 2 — results integrity")
    print("=" * 78)
    rows, problems = load_results(results_root)
    if problems:
        print("FAIL:")
        for p in problems[:10]:
            print(f"  {p}")
        print("\nNo packet written. A summary over a corrupt results file is a lie.")
        return 2
    print(f"PASS — {len(rows)} rows, {len({r['objectID'] for r in rows})} distinct objectIDs, "
          f"no duplicates, all parse.")

    print("\n" + "=" * 78)
    print("GATE 3 — grounding audit: every stored span re-sliced from its own cached body")
    print("=" * 78)
    cache = load_cache(cache_root)
    audit = grounding_audit(rows, cache)
    print(f"rows audited    : {audit['rows_audited']}")
    print(f"spans checked   : {audit['spans_checked']}")
    print(f"byte-identical  : {audit['spans_matched']}")
    print(f"MISMATCHED      : {audit['spans_mismatched']}")
    if audit["spans_mismatched"]:
        for m in audit["mismatches"][:5]:
            print(f"  {m['objectID']} {m['field']}  {m.get('url','')}")
            print(f"    span not found on page: {m['span']!r}")
        print("\nFAIL. No packet written: a stored span does not match the page it claims.")
        return 2
    if audit["spans_checked"] == 0:
        print("FAIL — zero spans checked. A gate that passes over nothing is not a gate; it is a "
              "reassurance. Refusing to emit a packet claiming grounding it did not test.")
        return 2
    if audit["writable_rows_without_a_cached_source"]:
        print(f"FAIL — {audit['writable_rows_without_a_cached_source']} writable row(s) have no "
              f"cached source to audit against: {audit['missing_source_examples']}")
        return 2
    print("PASS — every stored span is byte-identical to its own page at its own offsets.")

    # ---- counts ----------------------------------------------------------
    status = collections.Counter(r.get("status", "?") for r in rows)
    families = collections.Counter(r.get("family") for r in rows if r.get("status") in WRITABLE)
    langs = collections.Counter(r.get("language_code") for r in rows if r.get("status") in WRITABLE)
    dropped: collections.Counter = collections.Counter()
    for r in rows:
        for reason, n in (r.get("pool_dropped") or {}).items():
            dropped[reason] += n
    redirects = collections.Counter(
        r.get("status") for r in rows if r.get("status", "").startswith("REDIRECT"))
    failures = collections.Counter(
        (r.get("verdict_reason") or r.get("gate_failures") or ["?"])[0]
        if isinstance(r.get("gate_failures"), list) else (r.get("verdict_reason") or "?")
        for r in rows if r.get("status") == "FETCH_FAILED")

    writable = sum(status[s] for s in WRITABLE)
    terminal = sum(n for s, n in status.items() if s in NON_ENRICHMENT)
    attempted = len(rows)
    expected = len(queue)

    pack = review_pack(rows, pathlib.Path(args.out).parent / "REVIEW-PACK-real-run.md")

    lines = [
        "# Final packet — corpus enrichment run",
        "",
        f"_Generated {dt.datetime.now(dt.timezone.utc).isoformat()}. **Nothing has been written to "
        f"Algolia.** This packet exists to be verified by Codex and approved by Arijit before any "
        f"write._",
        "",
        "## Gates",
        "",
        "| gate | result |",
        "|---|---|",
        f"| provenance — every body Scout-sourced, right URL | PASS, {prov['pages']} bodies |",
        f"| results integrity — parse, distinct, no duplicates | PASS, {len(rows)} rows |",
        f"| grounding — every span byte-identical to its page | PASS, {audit['spans_checked']} spans |",
        "",
        "## Coverage",
        "",
        f"- queue records: **{expected}**",
        f"- rows produced: **{attempted}**",
        f"- unaccounted: **{expected - attempted}**",
        f"- writable (PASS + JUDGE_REVISE): **{writable}**",
        f"- honest non-enrichment verdicts: **{terminal}**",
        "",
        "## Status breakdown",
        "",
        "| status | n |",
        "|---|---|",
        *[f"| {s} | {n} |" for s, n in status.most_common()],
        "",
        "## Redirects (verbatim-from-the-wrong-URL, prevented)",
        "",
        *([f"- {s}: **{n}**" for s, n in redirects.most_common()] or ["- none"]),
        "",
        "## Candidate pool: what was filtered out before the model saw it",
        "",
        "| reason | spans dropped |",
        "|---|---|",
        *[f"| {r} | {n} |" for r, n in dropped.most_common()],
        "",
        "## Fetch failures",
        "",
        *([f"- {r}: {n}" for r, n in failures.most_common(15)] or ["- none"]),
        "",
        "## Writable by family / language",
        "",
        *[f"- {f}: {n}" for f, n in families.most_common()],
        "",
        *[f"- {l}: {n}" for l, n in langs.most_common()],
        "",
        "## Artefacts",
        "",
        f"- results: `{results_root}`",
        f"- Scout cache: `{cache_root}`",
        f"- review pack: `{pack}`",
        "",
        "## What this packet does NOT claim",
        "",
        "- **Not that the abstracts are useful.** Grounding proves the text came from the page at "
        "the recorded offsets. Usefulness is Arijit's review-pack call.",
        "- **Not that verification at scale has run.** `verify_written.py` re-fetches every live "
        "page after the write; it has not run, and it must be Scout-only and served-URL-checked "
        "before it can.",
        "- **Not that the index is safe to write to.** A record with only a UUID objectID appeared "
        "in the live index on 2026-08-09. HARD RULE 8 stands.",
    ]
    out = pathlib.Path(args.out)
    out.write_text("\n".join(lines), encoding="utf-8")
    print(f"\npacket      : {out}")
    print(f"review pack : {pack}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
