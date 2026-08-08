#!/usr/bin/env python3
"""
G8 — corpus-wide boilerplate detection. The check that cannot be made from inside one record.

WHY IT EXISTS
  The v1.2 menu fix (block-aware splitting + candidate classification) took judge coherence from
  2.88 to 4.62 and PASS from 15/50 to 25/50. It could not touch one class, and that class was 4 of
  the 9 records still drawing a REVISE:

      "Recognized by IDC, Gartner, Forrester, and Paradigm B2B, Algolia helps enterprises turn
       search into a growth engine for AI-native experiences."

  That is a shared site-wide promotional block. It is complete, specific, grammatical prose, so
  every shape-based heuristic is RIGHT to call it prose. It is simply not about the page it sits
  on. The judge's words: "The abstract and highlights are entirely about general analyst
  recognition for Algolia. They completely fail to represent the page's main topic."

  The only signal that separates furniture from content is how many DIFFERENT pages carry it, and
  no single-record gate can see that. Hence a corpus pass.

PREVENTION, NOT POST-MORTEM
  `span_gate.check_template_collision` already existed for G8 and was never called. It hashes the
  first 8 tokens of STORED abstracts and quarantines clusters over 20. Two problems: it only fires
  after 20+ records have already been spoiled, and its remedy is to discard them rather than to
  pick better text. This module runs BEFORE selection instead: the boilerplate sentence is marked
  in the numbered menu, so the model never picks it and the record keeps a good abstract.
  Both are kept -- this one prevents, that one is the safety net on the run's output.

TWO THINGS MEASURED THE HARD WAY, both encoded in tests

  1. COUNT PATHS, NOT URLS. algolia.com serves UNTRANSLATED English content at /de/ and /fr/
     paths, so one article appears as byte-identical text at three URLs. Counting URLs, 166 prose
     sentences on the 50 cached pages looked like boilerplate; stripping the locale prefix
     collapses them to 11. Counting URLs would have quarantined real content -- the exact failure
     Arijit ruled out ("I need every single record to be enriched").

  2. THE THRESHOLD IS A FRACTION, NOT A COUNT. Measured over 29 canonical paths, furniture sat at
     9-12 paths and legitimately shared REST-API text sat at 3:

         12 paths  "hi there 👋 need assistance?"                     <- furniture
         11 paths  "recognized by idc, gartner, forrester..."          <- furniture
         10 paths  "klicken sie hier;), um funktionale cookies..."     <- furniture
          3 paths  "all requests must use https."                      <- REAL, and run1's judge
          3 paths  "successful responses return 2xx statuses."            named the HTTPS line as
          3 paths  "your algolia application id."                         a MISSING highlight

     There is a clean empty gap between 5 and 9. An absolute threshold of 9 fits it and is badly
     wrong at full scale, where 9 of ~6,000 paths is 0.15% -- a shared section, not furniture.
     Site-wide furniture appears on a large SHARE of pages at any corpus size, so the rule is a
     share.
"""

from __future__ import annotations

import json
import pathlib
import re
import sys

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from candidates import split_candidates  # noqa: E402

# Locale prefixes actually present in Algolia_Prod_Copy_Enhanced.
# The `(?=/|$)` boundary is load-bearing: without it, "/definitions/search" has its "de" stripped
# and becomes "finitions/search", silently merging unrelated pages into one path.
_LOCALE = re.compile(r"^/(?:de|fr|es|it|pt-br|pt|ja|ko|zh)(?=/|$)")

# Below this many distinct canonical paths, "appears on a third of the corpus" carries no
# information -- with 4 pages it means 2. Fail safe: flag nothing.
MIN_PATHS_TO_JUDGE = 20

# Share of canonical paths a sentence must appear on to count as site-wide furniture.
# 0.20 sits inside the measured 5-to-9-of-29 gap (0.17 - 0.31) and leaves real shared doc text
# (3/29 = 0.10) well clear.
BOILERPLATE_SHARE = 0.20


def canonical_path(url: str) -> str:
    """URL -> path with the locale prefix removed, so locale variants collapse to one page."""
    return _LOCALE.sub("", url or "") or url


def norm_key(text: str) -> str:
    """The identity of a sentence for counting: lowercased, whitespace collapsed."""
    return " ".join((text or "").lower().split())


def build_map(pages, share: float = BOILERPLATE_SHARE,
              min_paths: int = MIN_PATHS_TO_JUDGE) -> dict[str, int]:
    """(url, markdown) pairs -> {normalised sentence: number of canonical paths carrying it}.

    Only PROSE candidates are counted. Chrome is already handled by classification, and counting
    it here would bloat the map with things the menu never offers anyway.
    """
    seen: dict[str, set[str]] = {}
    paths: set[str] = set()
    for url, markdown in pages:
        if not markdown:
            continue
        # No minimum-length filter here on purpose. It lived here once and made the RESULT depend
        # on page length invisibly: short pages were dropped, the path count fell under
        # min_paths, and the function returned {} -- "no boilerplate found" -- for a corpus that
        # was full of it. Deciding which pages count is the caller's job; see _pages_from_cache.
        path = canonical_path(url)
        paths.add(path)
        cands, _ = split_candidates(markdown)
        for cand in cands:
            if cand.kind != "prose":
                continue
            seen.setdefault(norm_key(cand.text), set()).add(path)

    if len(paths) < min_paths:
        return {}
    cutoff = len(paths) * share
    return {key: len(hits) for key, hits in seen.items() if len(hits) > cutoff}


def save(bp: dict[str, int], path: pathlib.Path, n_paths: int) -> None:
    path.write_text(json.dumps(
        {"_meta": {"canonical_paths": n_paths, "share": BOILERPLATE_SHARE,
                   "entries": len(bp)}, "sentences": bp},
        indent=1, ensure_ascii=False))


def load(path: pathlib.Path) -> set[str]:
    """The set the runner passes to split_candidates. Missing file -> empty set, never an error:
    G8 degrades to 'not applied', it does not take the pipeline down."""
    if not path.exists():
        return set()
    return set(json.loads(path.read_text()).get("sentences", {}))


MIN_PAGE_CHARS = 200   # below this a fetch is broken or empty, not a page


def _pages_from_cache(cache_dir: pathlib.Path):
    """The input boundary, and the only place a page is judged too small to count."""
    for f in sorted(cache_dir.glob("*.json")):
        rec = json.loads(f.read_text())
        if not isinstance(rec, dict):
            continue                      # manifests are lists; skip them
        md = rec.get("markdown") or ""
        if len(md) >= MIN_PAGE_CHARS:
            yield rec["url"], md


if __name__ == "__main__":
    import argparse

    ap = argparse.ArgumentParser(description="Build the G8 boilerplate map from fetched pages.")
    ap.add_argument("--cache", required=True, help="directory of fetched page JSON")
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    cache = pathlib.Path(args.cache)
    pages = list(_pages_from_cache(cache))
    n_paths = len({canonical_path(u) for u, m in pages if m and len(m) >= 200})
    bp = build_map(pages)
    save(bp, pathlib.Path(args.out), n_paths)

    print(f"pages {len(pages)} | canonical paths {n_paths} | "
          f"threshold >{n_paths * BOILERPLATE_SHARE:.1f} paths")
    if n_paths < MIN_PATHS_TO_JUDGE:
        print(f"CORPUS TOO SMALL (<{MIN_PATHS_TO_JUDGE} paths) -- flagged nothing, by design")
    print(f"boilerplate sentences: {len(bp)}")
    for key, count in sorted(bp.items(), key=lambda kv: -kv[1])[:25]:
        print(f"  {count:4} paths | {key[:96]}")
