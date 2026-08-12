#!/usr/bin/env python3
"""GATE 2 -- an INDEPENDENT re-verification of the Blog grounding claim.

WHY THIS EXISTS
  The claim being promoted into `validate/grounding.py` is "21,790 of 21,790 live Blog spans were
  located in their cached Scout bodies". That number is self-reported by the component being
  promoted. On a project where a verifier already returned empty and reported success, a 100%
  pass from the thing under promotion is the weakest admissible evidence for promoting it.

INDEPENDENCE, CONCRETELY
  This file imports NOTHING from `algolia_enrichment`. It does not use `canonicalise()`, `Canon`,
  `locate()`, or any of the fold tables. It reaches the same question by a deliberately different
  route:

      the package  : character-level canonical projection with an offset map, exact-substring
                     match on the projection
      this file    : WORD-TOKEN subsequence match -- reduce both sides to a list of lowercased
                     alphanumeric tokens and ask whether the span's token list appears as a
                     CONTIGUOUS run inside the body's token list

  Word-level matching is immune to every formatting difference the character-level projection has
  to handle explicitly (emphasis markers, link syntax, hard wraps, typographic quotes, spaces
  before punctuation, table pipes) without sharing a single rule with it. It is NOT permissive
  about content: every word must be present, in order, with nothing between them. An invented or
  edited word breaks the run, which is the thing being tested.

  Two match modes are reported separately so the result is legible:
      RAW    the span is a byte-exact substring of the body
      TOKEN  the span's token run appears in the body's token run

  A third number is reported and is the one that matters if it is ever non-zero: NOT_FOUND.

  python3 independent_grounding.py --workspace <repo root>
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import unicodedata
from collections import Counter
from pathlib import Path

WORD = re.compile(r"[^\W_]+", re.UNICODE)

# MARKUP THAT CARRIES WORDS OF ITS OWN AND IS NOT PAGE PROSE.
#
# Found by this checker's own first run: it reported 4,488 spans "not on the page", and the first
# two inspected were spans containing markdown links. Tokenising the RAW body turns
# `[github.com/algolia/cli](https://github.com/algolia/cli)` into the label's tokens FOLLOWED BY
# the target URL's tokens, so the span's token run is interrupted by words no reader ever sees.
# The span was faithful; the checker was under-stripping.
#
# That was a false alarm caught before it was reported, and it is the same class as the defect
# this whole gate exists to test for -- a verifier's own normalisation deciding the verdict. Link
# targets and tags are removed here by a one-pass regex, which is a different implementation from
# the package's character-walk with an offset map, and is still purely subtractive: it can delete
# a word the page never showed, never introduce one.
LINK = re.compile(r"!?\[([^\]]*)\]\([^)\s]*(?:\s+\"[^\"]*\")?\)", re.DOTALL)
TAG = re.compile(r"</?[A-Za-z!][^<>\n]{0,300}>")
BARE_URL = re.compile(r"<https?://[^>\s]+>")

# EMPHASIS MARKERS ARE DELETED, NOT TREATED AS WORD BOUNDARIES.
#
# The second finding of this checker's own run, and it needed the raw source to settle. 67 spans
# still read as "not on the page", all of them fused words: `servingfrom`, `areused`,
# `fullycompliant`, `Asite`. The page for one of them literally says:
#
#     ...and serving**from 900K to 30M searches a month**.
#
# There is no space before the bold marker, so a markdown renderer shows the reader `servingfrom`
# as one word. The stored span is faithful to what the page displays. Letting `*` split a token
# would make this checker disagree with markdown itself, not with the pipeline.
#
# This is a rule the two implementations necessarily share, because it is markdown's rule and not
# either implementation's choice. Independence here is in the ALGORITHM -- a one-pass regex strip
# plus word-token subsequence matching, versus a character walk carrying an offset map -- not in
# inventing different semantics for the source format.
EMPHASIS = re.compile(r"[*`~]")


def strip_markup(text: str) -> str:
    """Remove link targets, tags and emphasis markers, keeping every word a reader sees."""
    prev = None
    out = text
    while prev != out:                     # nested link labels do occur
        prev = out
        out = LINK.sub(r"\1", out)
    out = BARE_URL.sub(" ", out)
    out = TAG.sub(" ", out)
    return EMPHASIS.sub("", out)


def tokens(text: str) -> list[str]:
    """Lowercased alphanumeric word tokens of the visible text.

    NFKC rather than NFC, and casefold rather than lower: chosen to differ from the package's
    normalisation on purpose. If the two agree on 21,790 spans while disagreeing on their normal
    form, the agreement is not an artifact of one shared rule.
    """
    return WORD.findall(unicodedata.normalize("NFKC", strip_markup(text)).casefold())


def contains_run(haystack: list[str], needle: list[str]) -> bool:
    """Is `needle` a contiguous run inside `haystack`? Plain scan; no index, no shortcuts."""
    n, m = len(haystack), len(needle)
    if m == 0 or m > n:
        return False
    first = needle[0]
    for i in range(n - m + 1):
        if haystack[i] == first and haystack[i:i + m] == needle:
            return True
    return False


# --- credentials and the live read, done without the package -------------------------------

def env(workspace: Path) -> dict:
    out = {}
    for line in (workspace / ".env.local").read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, _, v = line.partition("=")
            out[k.strip()] = v.strip().strip('"').strip("'")
    return out


def algolia_post(app: str, key: str, path: str, body: dict) -> dict:
    proc = subprocess.run(
        ["curl", "-s", "--max-time", "120", "-X", "POST",
         f"https://{app}-dsn.algolia.net{path}",
         "-H", "Content-Type: application/json",
         "-H", f"X-Algolia-Application-Id: {app}",
         "-H", f"X-Algolia-API-Key: {key}",
         "-d", json.dumps(body)],
        capture_output=True, text=True)
    if proc.returncode != 0:
        sys.exit(f"curl failed: {proc.stderr[:300]}")
    return json.loads(proc.stdout)


def live_blog_records(app: str, key: str, index: str) -> list[dict]:
    """Every Blog record carrying either enriched field. Cursor-paginated."""
    out, cursor = [], None
    while True:
        body = {"cursor": cursor} if cursor else {
            "hitsPerPage": 1000, "filters": "source:Blog",
            "attributesToRetrieve": ["objectID", "url", "abstract_enriched",
                                     "keyhighlights_enriched"]}
        page = algolia_post(app, key, f"/1/indexes/{index}/browse", body)
        out += page.get("hits", [])
        cursor = page.get("cursor")
        if not cursor:
            return out


def cached_bodies(cache_root: Path) -> dict[str, str]:
    """objectID -> markdown, from every cached fetch manifest on disk.

    Later files win. A record refetched during the repair rounds should be checked against the
    body the repair actually used, and those manifests were written last.
    """
    bodies: dict[str, str] = {}
    for path in sorted(cache_root.rglob("*.json")):
        try:
            data = json.loads(path.read_text())
        except (json.JSONDecodeError, UnicodeDecodeError):
            continue
        rows = data if isinstance(data, list) else [data]
        for row in rows:
            if isinstance(row, dict) and row.get("objectID") and row.get("markdown"):
                bodies[row["objectID"]] = row["markdown"]
    return bodies


def spans_of(record: dict) -> list[tuple[str, str]]:
    out = []
    for field in ("abstract_enriched", "keyhighlights_enriched"):
        value = record.get(field)
        if value is None:
            continue
        items = value if isinstance(value, list) else [value]
        for s in items:
            if isinstance(s, str) and s.strip():
                out.append((field, s))
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--workspace", required=True)
    ap.add_argument("--index", default="Algolia_Prod_Copy_Enhanced")
    ap.add_argument("--expect", type=int, default=21790)
    ap.add_argument("--out", default="")
    args = ap.parse_args()

    ws = Path(args.workspace).resolve()
    e = env(ws)
    app = e["ALGOLIA_APP_ID"]
    key = e.get("ALGOLIA_ADMIN_API_KEY") or e["ALGOLIA_SEARCH_API_KEY"]
    cache_root = ws / "docs" / "70-enrichment" / "cache-scout"

    print(f"index      : {args.index}")
    print(f"cache root : {cache_root}")

    records = live_blog_records(app, key, args.index)
    print(f"live Blog records: {len(records)}")

    bodies = cached_bodies(cache_root)
    print(f"cached bodies    : {len(bodies)}")

    modes = Counter()
    failures: list[dict] = []
    no_body: list[str] = []
    checked = 0
    body_tokens_cache: dict[str, list[str]] = {}

    for rec in records:
        oid = rec["objectID"]
        spans = spans_of(rec)
        if not spans:
            continue
        body = bodies.get(oid)
        if body is None:
            no_body.append(oid)
            checked += len(spans)
            failures += [{"objectID": oid, "field": f, "reason": "no cached body",
                          "span": s[:120]} for f, s in spans]
            continue
        if oid not in body_tokens_cache:
            body_tokens_cache[oid] = tokens(body)
        btok = body_tokens_cache[oid]
        for field, span in spans:
            checked += 1
            if span in body:
                modes["raw"] += 1
                continue
            if contains_run(btok, tokens(span)):
                modes["token"] += 1
                continue
            modes["not_found"] += 1
            failures.append({"objectID": oid, "field": field, "reason": "not on the page",
                             "span": span[:200], "url": rec.get("url")})

    located = checked - modes["not_found"]
    print()
    print(f"spans checked : {checked}")
    print(f"located       : {located}")
    print(f"modes         : {dict(modes)}")
    print(f"records with no cached body : {len(no_body)}")
    print()
    if failures:
        print(f"FAILURES ({len(failures)}), first 10:")
        for f in failures[:10]:
            print(f"  {f['objectID']} [{f['field']}] {f['reason']}: {f['span'][:110]!r}")
        print()

    report = {
        "index": args.index,
        "method": "word-token contiguous-subsequence match; shares no code with "
                  "validate/grounding.py",
        "live_blog_records": len(records),
        "cached_bodies": len(bodies),
        "spans_checked": checked,
        "located": located,
        "modes": dict(modes),
        "records_with_no_cached_body": len(no_body),
        "expected": args.expect,
        "reproduces_expected": checked == args.expect and located == args.expect,
        "failures": failures[:200],
    }
    if args.out:
        Path(args.out).write_text(json.dumps(report, indent=2, ensure_ascii=False))
        print(f"wrote {args.out}")

    verdict = "PASS" if report["reproduces_expected"] else "FAIL"
    print(f"GATE 2 {verdict}: {located}/{checked} spans located "
          f"(claim was {args.expect}/{args.expect})")
    return 0 if verdict == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
