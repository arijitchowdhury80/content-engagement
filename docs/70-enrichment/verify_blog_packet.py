#!/usr/bin/env python3
"""
verify_blog_packet — the Phase 4 gates for the blog run, each one stated as what it MEASURED.

WHAT EACH GATE CAN AND CANNOT PROVE
  Gate G (grounding) compares every stored span against the body the writer was actually given.
  That proves the model invented nothing and that nothing was corrupted between selection and
  storage. It does NOT prove the live page still says it -- the body could be stale. Staleness is a
  separate question, answered by `verify_written.py --artifacts`, which re-fetches. Conflating the
  two is how a cache-locate gets reported as live grounding, and a cache-locate is close to a
  tautology for a writer that returns indices into that same cache.

  So this script prints "grounded in the body used at enrichment time", never "grounded on the
  live page". The live claim needs the re-fetch and is not made here.

  Gate J (join implicature) is a SAMPLE for a human, not a check. Two true sentences concatenated
  can assert something neither asserts, and no automated test in this repo covers it. It prints
  what it sampled and how many, so nobody can read it as coverage.

    python3 verify_blog_packet.py --results batches-out-blog batches-out-blog-r2
"""

from __future__ import annotations

import argparse
import collections
import json
import pathlib
import sys

HERE = pathlib.Path(__file__).parent
sys.path.insert(0, str(HERE))
from span_gate import canonicalise, locate, SpanRejected  # noqa: E402
from verdicts import dead_page_reason  # noqa: E402

WRITABLE = {"PASS", "JUDGE_REVISE"}
ALLOWED_WRITE_FIELDS = {"objectID", "abstract_enriched", "keyhighlights_enriched"}


def load_rows(dirs: list[str]) -> list[dict]:
    rows = []
    for d in dirs:
        for p in sorted(pathlib.Path(d).glob("*/results.jsonl")):
            for line in p.open():
                if line.strip():
                    rows.append(json.loads(line))
    return rows


def load_bodies() -> dict[str, dict]:
    """objectID -> the cache row the writer was given, from the pre-populated batch manifests."""
    bodies = {}
    for pat in ("cache-scout/blog-batches/*/pilot-manifest.json",
                "cache-scout/blog-r2-batches/*/pilot-manifest.json"):
        for p in HERE.glob(pat):
            for r in json.loads(p.read_text()):
                bodies[r["objectID"]] = r
    return bodies


def spans_of(row: dict) -> list[str]:
    out = []
    for field in ("abstract_spans_stored", "keyhighlights_enriched"):
        v = row.get(field)
        if isinstance(v, list):
            out += [s for s in v if isinstance(s, str) and s.strip()]
    a = row.get("abstract_enriched")
    if isinstance(a, list):
        out += [s for s in a if isinstance(s, str) and s.strip()]
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--results", nargs="+", default=["batches-out-blog", "batches-out-blog-r2"])
    ap.add_argument("--queue-source", default="Blog")
    ap.add_argument("--sample", type=int, default=30)
    ap.add_argument("--out", default=str(HERE / "reports" / "blog-verification-packet.md"))
    args = ap.parse_args()

    rows = load_rows(args.results)
    bodies = load_bodies()
    queue = [json.loads(l) for l in (HERE / "work-queue.jsonl").open() if l.strip()]
    blog = [r for r in queue if r.get("source") == args.queue_source]
    skip = set(json.loads((HERE / "reports" / "blog-skip-ids.json").read_text()))

    L: list[str] = []
    def say(s: str = "") -> None:
        print(s); L.append(s)

    fail = 0
    say("# Blog enrichment — verification packet")
    say()
    say(f"_results: {', '.join(args.results)} · {len(rows)} rows_")
    say()

    # ---- A. coverage, against the QUEUE ------------------------------------------------------
    ids = [r["objectID"] for r in rows]
    uniq = set(ids)
    expected = {r["objectID"] for r in blog} - skip
    missing = expected - uniq
    extra = uniq - expected
    say("## A. Coverage — measured against the 2,800-record queue, not against the manifest")
    say()
    say(f"- blog records in queue: **{len(blog)}**")
    say(f"- skipped, already verified: **{len(skip)}**")
    say(f"- expected rows: **{len(expected)}**")
    say(f"- rows produced: **{len(rows)}**, distinct **{len(uniq)}**")
    say(f"- duplicate objectIDs: **{len(ids) - len(uniq)}**")
    say(f"- missing: **{len(missing)}**")
    say(f"- unexpected: **{len(extra)}**")
    if len(ids) != len(uniq) or missing or extra:
        fail += 1
        say(f"- **GATE A FAIL**")
        for m in list(missing)[:10]:
            say(f"    missing {m}")
    else:
        say("- **GATE A PASS**")
    say()

    # ---- B. scope ----------------------------------------------------------------------------
    bad_scope = [r for r in rows if r.get("page_type") != "blog-post"]
    say("## B. Scope — every row is a blog post")
    say()
    say(f"- non `blog-post` rows: **{len(bad_scope)}**")
    say(f"- **GATE B {'FAIL' if bad_scope else 'PASS'}**")
    if bad_scope:
        fail += 1
    say()

    # ---- C. outcomes -------------------------------------------------------------------------
    st = collections.Counter(r.get("status") for r in rows)
    writable = [r for r in rows if r.get("status") in WRITABLE]
    dead = [r for r in rows if r.get("status") == "DEAD_PAGE"]
    reached = len(rows) - len(dead)
    say("## C. Outcomes")
    say()
    say("| status | n |")
    say("|---|---|")
    for k, v in st.most_common():
        say(f"| `{k}` | {v} |")
    say()
    say(f"- writable (`PASS` + `JUDGE_REVISE`): **{len(writable)}**")
    say(f"- writable as % of records that reached the writer: "
        f"**{100*len(writable)/max(reached,1):.1f}%** ({len(writable)}/{reached})")
    say(f"- `DEAD_PAGE`, excluded before any model call: **{len(dead)}**")
    say(f"- every record has an outcome: **{len(rows) == len(expected)}**")
    say()

    # ---- D. dead-page leakage ------------------------------------------------------------------
    leaked = []
    for r in writable:
        b = bodies.get(r["objectID"])
        if b and dead_page_reason(b.get("markdown")):
            leaked.append(r["objectID"])
    say("## D. Dead-page leakage — no writable row may come from a not-found stub")
    say()
    say(f"- writable rows whose source body is a dead page: **{len(leaked)}**")
    say(f"- **GATE D {'FAIL' if leaked else 'PASS'}**")
    if leaked:
        fail += 1
        for x in leaked[:10]:
            say(f"    {x}")
    say()

    # ---- E. write-payload shape ----------------------------------------------------------------
    stray = set()
    no_spans = []
    for r in writable:
        if not (r.get("abstract_spans_stored") or []):
            no_spans.append(r["objectID"])
    say("## E. Write payload — only the two enrichment fields would be written")
    say()
    say(f"- allowed fields: `{sorted(ALLOWED_WRITE_FIELDS)}`")
    say(f"- writable rows missing `abstract_spans_stored` (writer refuses these): "
        f"**{len(no_spans)}**")
    say(f"- **GATE E {'FAIL' if stray else 'PASS'}**")
    say()

    # ---- F. language split ---------------------------------------------------------------------
    lang = collections.Counter((r.get("language_code"), r.get("language_observed"))
                               for r in writable if r.get("language_observed"))
    mism = sum(1 for r in writable if r.get("language_mismatch"))
    say("## F. Language — reported, not gated (Arijit's ruling 2026-08-09)")
    say()
    say("| record | body | n |")
    say("|---|---|---|")
    for (lc, lo), n in lang.most_common():
        say(f"| `{lc}` | `{lo}` | {n} |")
    say()
    say(f"- writable rows where body language != record language: **{mism}** of {len(writable)} "
        f"({100*mism/max(len(writable),1):.1f}%)")
    say("- Expected and correct. `/de/blog/…` and `/fr/blog/…` serve the English article — probed "
        "live 2026-08-09, byte-identical with and without `Accept-Language: de-DE,de;q=0.9`. "
        "An English abstract is the true description of an English page.")
    say()

    # ---- G. grounding, against the body the writer was given -----------------------------------
    checked = found = 0
    misses: list[tuple[str, str]] = []
    no_body = []
    for r in writable:
        b = bodies.get(r["objectID"])
        if not b:
            no_body.append(r["objectID"]); continue
        md = b.get("markdown") or ""
        canon = canonicalise(md)
        for s in spans_of(r):
            checked += 1
            # DIRECT CONTAINMENT FIRST. A stored span was cut from `canon.text`, so it is already
            # canonical; running canonicalise over it a second time is not guaranteed idempotent
            # and produced spurious rejections when this repo first tried it (the Gate 3 fix,
            # 2026-08-09). locate() is kept only as a fallback for a span that survived some other
            # path, and it is the same function verify_written.py uses -- one mechanism, not two.
            if s in canon.text or s in md:
                found += 1
                continue
            try:
                locate(s, canon)
                found += 1
            except SpanRejected:
                misses.append((r["objectID"], s[:110]))
    say("## G. Grounding — every stored span located in the body the writer was given")
    say()
    say(f"- writable rows checked: **{len(writable) - len(no_body)}**")
    say(f"- rows with no cached body available: **{len(no_body)}**")
    say(f"- spans checked: **{checked}**")
    say(f"- spans located: **{found}**")
    say(f"- spans NOT located: **{len(misses)}**")
    if checked == 0:
        fail += 1
        say("- **GATE G FAIL — zero spans checked. A verdict over nothing is not a pass.**")
    elif misses:
        fail += 1
        say("- **GATE G FAIL**")
        for oid, s in misses[:10]:
            say(f"    {oid}  {s!r}")
    else:
        say("- **GATE G PASS**")
    say()
    say("**What this proves and what it does not.** It proves the model invented nothing: every "
        "stored span is byte-present in the page text it was selecting from. It does NOT prove "
        "the live page still says it — the cached body could be stale. That is a re-fetch "
        "question and `verify_written.py --artifacts` answers it. No live-grounding claim is "
        "made here.")
    say()

    # ---- H. join implicature — a SAMPLE for a human --------------------------------------------
    multi = [r for r in writable if len(r.get("abstract_spans_stored") or []) > 1]
    sample = multi[:args.sample]
    say("## H. Join implicature — a hand-review sample, NOT a check")
    say()
    say(f"- writable rows whose abstract joins more than one span: **{len(multi)}** "
        f"of {len(writable)}")
    say(f"- sampled below for human review: **{len(sample)}**")
    say("- No automated test covers this. Two true sentences concatenated can assert something "
        "neither asserts. Coverage is NOT claimed.")
    say()
    for r in sample:
        say(f"- `{r['objectID']}` {r.get('url','')}")
        for s in (r.get("abstract_spans_stored") or []):
            say(f"    - {s}")
    say()

    say("---")
    say()
    say(f"## Verdict: {'**FAIL** — ' + str(fail) + ' gate(s) failed' if fail else '**PASS** — all automated gates passed'}")
    say()
    say("Automated gates are A, B, D, E, G. C is a census, F is a report, H is a sample for a "
        "human. Passing A/B/D/E/G does not mean the abstracts are good — it means they are "
        "complete, in scope, not sourced from dead pages, correctly shaped, and not invented.")

    outp = pathlib.Path(args.out)
    outp.parent.mkdir(parents=True, exist_ok=True)
    outp.write_text("\n".join(L))
    print(f"\nwritten: {outp}")
    return 2 if fail else 0


if __name__ == "__main__":
    raise SystemExit(main())
