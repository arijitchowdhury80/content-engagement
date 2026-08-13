#!/usr/bin/env python3
"""
Build a HUMAN-readable review pack.

Arijit rejected the first validation pack, correctly, for three reasons:
  1. too many German and French pages he cannot verify
  2. character offsets printed as bare numbers -- not human readable
  3. key highlights shown with no way to check them

This version fixes all three:
  * English records only (--lang)
  * NO offsets anywhere. Instead, each stored sentence is shown INSIDE the surrounding page
    text with >>> markers around it, so verification is visual: read the page excerpt, see the
    sentence sitting in it. That is the same proof the offsets carried, without the arithmetic.
  * every key highlight gets the same treatment as the abstract

  python3 docs/operations/enrichment/make_review_pack.py
"""

from __future__ import annotations

import argparse
import json
import pathlib
import sys

HERE = pathlib.Path(__file__).parent
sys.path.insert(0, str(HERE))
from span_gate import canonicalise  # noqa: E402

CONTEXT = 190   # characters of page shown either side of the sentence


def excerpt(span: str, page_canon: str) -> str:
    """The page text around `span`, with the span itself marked. This IS the evidence."""
    needle = canonicalise(span).text.strip()
    pos = page_canon.find(needle)
    if pos == -1:
        return "!! NOT FOUND ON PAGE -- this should be impossible, flag it"
    before = page_canon[max(0, pos - CONTEXT): pos]
    after = page_canon[pos + len(needle): pos + len(needle) + CONTEXT]
    if pos - CONTEXT > 0:
        before = "…" + before
    if pos + len(needle) + CONTEXT < len(page_canon):
        after = after + "…"
    return f"{before}>>> {needle} <<<{after}"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--lang", default="en")
    ap.add_argument("--runs", nargs="+",
                    default=["docs/operations/enrichment/reports/glm-30a",
                             "docs/operations/enrichment/reports/glm-30b"])
    ap.add_argument("--caches", nargs="+",
                    default=["docs/operations/enrichment/cache/pilot-manifest.json",
                             "docs/operations/enrichment/cache2/pilot-manifest.json"])
    ap.add_argument("--out", default="docs/operations/enrichment/reports/REVIEW-english.md")
    args = ap.parse_args()

    cache: dict[str, dict] = {}
    for c in args.caches:
        for rec in json.loads(pathlib.Path(c).read_text()):
            cache[rec["objectID"]] = rec

    rows: list[dict] = []
    seen: set[str] = set()
    for run in args.runs:
        for line in (pathlib.Path(run) / "results.jsonl").open():
            r = json.loads(line)
            if (r.get("abstract_enriched") and r.get("language_code") == args.lang
                    and r["objectID"] not in seen):
                seen.add(r["objectID"])
                rows.append(r)

    out = [
        "# Review pack — English pages only",
        "",
        f"**{len(rows)} records.** Everything below was produced by the pipeline. Nothing here was",
        "written by a model: each sentence was *copied out of the live page*.",
        "",
        "## How to check a record in 20 seconds",
        "",
        "Under every sentence there is a **PAGE** line showing that sentence sitting inside the",
        "real page text, wrapped in `>>>` and `<<<`. Read the surrounding words. If the sentence is",
        "genuinely part of that page and the surrounding text does not change its meaning, it is good.",
        "",
        "You are **not** checking whether the words are invented — that is machine-proved and the",
        "`>>>` markers are the proof. You are checking two human questions:",
        "",
        "1. **Does the summary describe what this page is about?**",
        "2. **Are the key points genuinely useful if someone saw them in a search result?**",
        "",
        "Mark each record on its `VERDICT:` line. If any sentence looks invented, write",
        "**HALLUCINATION** and stop — that stops the whole project.",
        "",
        "---",
        "",
    ]

    for n, r in enumerate(rows, 1):
        page = canonicalise(cache[r["objectID"]]["markdown"]).text
        out += [
            f"# {n}. {r['title'] if r.get('title') else r['page_type']}",
            "",
            f"**Page:** <{r['source_url']}>",
            f"**Type:** {r['page_type']} · {r['family']} family",
            "",
            "## Summary it would store",
            "",
            f"> {r['abstract_enriched']}",
            "",
            "**Where each sentence came from:**",
            "",
        ]
        # Use the STORED component spans. Splitting the joined abstract on ". " looked fine and
        # then failed on 4 records whose spans joined without a full stop.
        sentences = r.get("abstract_spans_stored") or [r["abstract_enriched"]]
        for s in sentences:
            out += [f"- `{s.strip()[:110]}`", f"  - PAGE: {excerpt(s, page)}", ""]

        highs = r.get("keyhighlights_enriched") or []
        out += [f"## Key points it would store ({len(highs)})", ""]
        if not highs:
            out.append("_none — the page had no concrete specifics to pull._")
        for i, h in enumerate(highs, 1):
            out += [f"**{i}.** {h}", f"  - PAGE: {excerpt(h, page)}", ""]

        j = r.get("judge") or {}
        if j:
            verdict = "looks good" if j.get("verdict") == "ACCEPT" else "wants a better sentence"
            out += [
                "## Second opinion (a different AI, from Google, checking quality only)",
                "",
                f"- Does the summary represent the page? **{j.get('representativeness')} out of 5**",
                f"- Is it specific enough to be useful? **{j.get('specificity')} out of 5**",
                f"- Do the sentences mislead when read together? **{j.get('juxtaposition')} out of 5** "
                f"(5 = no, they read honestly)",
                f"- Overall: **{verdict}**",
                "",
            ]
        out += ["```", "VERDICT:  good / not good / HALLUCINATION", "notes:", "```", "", "---", ""]

    pathlib.Path(args.out).write_text("\n".join(out))
    print(f"wrote {args.out}  ({len(rows)} English records)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
