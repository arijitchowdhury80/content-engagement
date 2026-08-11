#!/usr/bin/env python3
"""
Validate Blog enrichment result artifacts against the E2E test plan.

This is intentionally artifact-first. `enrich_run.py` stores the display abstract as a joined
string and the source slices as `abstract_spans_stored`; `write_enrichment.py` writes the latter
as the live `abstract_enriched` array. So this script validates the source slices here and leaves
live-payload shape to the writer dry-run.
"""

from __future__ import annotations

import argparse
import collections
import json
import pathlib
import re
import sys

HERE = pathlib.Path(__file__).parent
sys.path.insert(0, str(HERE))

from span_gate import canonicalise  # noqa: E402
from candidates import has_broken_brackets  # noqa: E402
from pool_filters import overlap  # noqa: E402

WRITABLE = {"PASS", "JUDGE_REVISE"}
# Imported, not duplicated. Two copies of a chrome list drift, and while they drifted the pool
# filter shipped furniture the validator then flagged -- see the note in pool_filters.py.
from pool_filters import FORBIDDEN_TEXT  # noqa: E402
CHROME_ONLY = (
    "search algolia",
    "api status",
    "home page",
    "book a demo",
    "get a demo",
    "request demo",
    "get started",
    "support",
)
CODE_COMMENT = re.compile(r"^\s*(//|#\s|/\*|\*\s|--\s|<!--)")


def load_json(path: pathlib.Path):
    return json.loads(path.read_text())


def markdown_visible_text(markdown: str) -> str:
    """Best-effort visible text projection for Scout markdown.

    This is stricter than fuzzy matching and weaker than byte matching for a deliberate reason:
    Scout markdown inserts URLs inside sentences (`[label](url)`) while the enrichment fields store
    the visible page text. The URL is not visible content, so grounding should compare against the
    visible label, not the markdown transport syntax.
    """
    out: list[str] = []
    i = 0
    n = len(markdown)
    while i < n:
        if markdown[i] == "[":
            close = markdown.find("](", i + 1)
            if close != -1:
                label = markdown[i + 1:close]
                j = close + 2
                depth = 1
                while j < n and depth:
                    if markdown[j] == "(":
                        depth += 1
                    elif markdown[j] == ")":
                        depth -= 1
                    j += 1
                if depth == 0 and "\n\n" not in label:
                    out.append(label)
                    i = j
                    continue
        out.append(markdown[i])
        i += 1
    text = "".join(out)
    # Markdown markers are not visible text. Removing the markers is safe here because grounding is
    # still token-exact after canonicalisation; we are not adding or substituting facts.
    text = re.sub(r"`([^`]+)`", r"\1", text)
    text = text.replace("**", "").replace("__", "").replace("*", "")
    return text


def grounding_modes(body: str, span: str) -> dict[str, bool]:
    if not span or not str(span).strip():
        return {"exact": False, "canonical": False, "visible_markdown": False}
    return {
        "exact": span in body,
        "canonical": canon_contains(body, span),
        "visible_markdown": (
            canonicalise(span).text in canonicalise(markdown_visible_text(body)).text
        ),
    }


def load_results(root: pathlib.Path, cache_root: pathlib.Path, complete_only: bool) -> tuple[list[dict], dict]:
    rows: list[dict] = []
    batch_report: dict[str, dict] = {}
    for result_file in sorted(root.glob("*/results.jsonl")):
        batch = result_file.parent.name
        batch_rows = [json.loads(line) for line in result_file.open() if line.strip()]
        ids = [r.get("objectID") for r in batch_rows]
        cache_manifest = cache_root / batch / "pilot-manifest.json"
        expected = None
        if cache_manifest.exists():
            expected = sum(1 for r in load_json(cache_manifest) if not r.get("fetch_error"))
        complete = (
            expected is not None
            and len(batch_rows) == expected
            and len(ids) == len(set(ids))
        )
        batch_report[batch] = {
            "rows": len(batch_rows),
            "expected": expected,
            "complete": complete,
            "duplicates": len(ids) - len(set(ids)),
        }
        if complete_only and not complete:
            continue
        rows.extend(batch_rows)
    return rows, batch_report


def source_index(cache_roots: list[pathlib.Path]) -> dict[str, dict]:
    out: dict[str, dict] = {}
    for root in cache_roots:
        for manifest in sorted(root.glob("*/pilot-manifest.json")):
            for row in load_json(manifest):
                oid = row.get("objectID")
                if oid and not row.get("fetch_error"):
                    out.setdefault(oid, row)
    return out


def canon_contains(body: str, span: str) -> bool:
    return canonicalise(span).text in canonicalise(body).text


def span_leak_reasons(span: str, title: str, description: str) -> list[str]:
    text = (span or "").strip()
    low = text.casefold()
    reasons: list[str] = []
    if not text:
        reasons.append("EMPTY")
    for marker in FORBIDDEN_TEXT:
        if marker in low:
            reasons.append(f"FORBIDDEN:{marker}")
    for marker in CHROME_ONLY:
        # These words can be valid inside article prose ("current API status", "how to get
        # started"). They are chrome only when the whole short span is the nav/CTA label.
        if low == marker or (low.startswith(marker) and len(text) <= len(marker) + 20):
            reasons.append(f"CHROME_LABEL:{marker}")
    if CODE_COMMENT.match(text):
        reasons.append("CODE_COMMENT")
    if has_broken_brackets(text):
        reasons.append("BROKEN_MARKDOWN_LINK")
    if re.search(r"\bexpect\([^)]*\)\.[a-zA-Z_][\w.]*\(", text):
        reasons.append("CODE_EXPRESSION")
    if description and overlap(text, description) >= 0.70:
        reasons.append("DUPLICATE_DESCRIPTION_NEAR")
    if title and overlap(text, title) >= 0.70:
        reasons.append("DUPLICATE_TITLE_NEAR")
    return reasons


def validate(rows: list[dict], sources: dict[str, dict]) -> dict:
    status = collections.Counter(r.get("status") for r in rows)
    verdict = collections.Counter(r.get("verdict") for r in rows)
    ids = [r.get("objectID") for r in rows]
    duplicate_ids = sorted([oid for oid, n in collections.Counter(ids).items() if oid and n > 1])
    non_blog: list[str] = []
    missing_source: list[str] = []
    grounding_failures: list[dict] = []
    leakage_failures: list[dict] = []
    dead_writable: list[str] = []
    artifact_joined_abstract = 0
    spans_checked = 0
    spans_exact = 0
    spans_canon = 0
    spans_visible_markdown = 0
    spans_offset_supported = 0
    offset_mismatches: list[dict] = []
    writable_rows = 0

    for row in rows:
        oid = row.get("objectID", "")
        src = sources.get(oid)
        if not src:
            missing_source.append(oid)
            continue
        if src.get("source") != "Blog" or src.get("page_type") != "blog-post":
            non_blog.append(oid)
        if row.get("status") in WRITABLE:
            writable_rows += 1
            if isinstance(row.get("abstract_enriched"), str):
                artifact_joined_abstract += 1
            body = src.get("markdown") or ""
            title = src.get("title") or ""
            description = src.get("description") or ""
            abstract_spans = row.get("abstract_spans_stored") or []
            highlights = row.get("keyhighlights_enriched") or []
            offsets = row.get("span_offsets") or []
            if not isinstance(abstract_spans, list):
                grounding_failures.append({"objectID": oid, "field": "abstract_spans_stored", "reason": "not list"})
                abstract_spans = []
            if not isinstance(highlights, list):
                grounding_failures.append({"objectID": oid, "field": "keyhighlights_enriched", "reason": "not list"})
                highlights = []
            ordered_spans = [("abstract", span) for span in abstract_spans]
            ordered_spans += [("highlight", span) for span in highlights]
            for idx, (field, span) in enumerate(ordered_spans):
                    spans_checked += 1
                    modes = grounding_modes(body, span)
                    offset_supported = False
                    if idx < len(offsets):
                        try:
                            a, b = offsets[idx]
                            sliced = body[a:b]
                            offset_supported = overlap(span, sliced) >= 0.80
                        except (TypeError, ValueError):
                            offset_supported = False
                    spans_exact += int(modes["exact"])
                    spans_canon += int(modes["canonical"])
                    spans_visible_markdown += int(modes["visible_markdown"])
                    spans_offset_supported += int(offset_supported)
                    if not offset_supported:
                        offset_mismatches.append({
                            "objectID": oid,
                            "url": src.get("source_url") or row.get("source_url"),
                            "field": field,
                            "span": span,
                            "offset_index": idx,
                        })
                    if not any(modes.values()):
                        grounding_failures.append({
                            "objectID": oid,
                            "url": src.get("source_url") or row.get("source_url"),
                            "field": field,
                            "span": span,
                            "reason": "not found in source body",
                            "modes": modes,
                        })
                    leaks = span_leak_reasons(span, title, description)
                    if leaks:
                        leakage_failures.append({
                            "objectID": oid,
                            "url": src.get("source_url") or row.get("source_url"),
                            "field": field,
                            "span": span,
                            "reasons": leaks,
                        })
        if row.get("status") == "DEAD_PAGE":
            if row.get("abstract_spans_stored") or row.get("keyhighlights_enriched"):
                dead_writable.append(oid)

    return {
        "rows": len(rows),
        "distinct_ids": len(set(ids)),
        "duplicate_ids": duplicate_ids,
        "status": dict(status),
        "verdict": dict(verdict),
        "writable_rows": writable_rows,
        "language_mismatch": sum(1 for r in rows if r.get("language_mismatch")),
        "missing_source": missing_source,
        "non_blog": non_blog,
        "artifact_joined_abstract": artifact_joined_abstract,
        "spans_checked": spans_checked,
        "spans_exact_found": spans_exact,
        "spans_canonical_found": spans_canon,
        "spans_visible_markdown_found": spans_visible_markdown,
        "spans_offset_supported": spans_offset_supported,
        "offset_mismatches": offset_mismatches,
        "grounding_failures": grounding_failures,
        "leakage_failures": leakage_failures,
        "dead_writable": dead_writable,
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--results", default=str(HERE / "batches-out-blog"))
    ap.add_argument("--cache", action="append", default=[],
                    help="cache root containing <batch>/pilot-manifest.json; repeatable")
    ap.add_argument("--complete-only", action="store_true",
                    help="validate only result dirs whose row count matches the cache manifest")
    ap.add_argument("--out", default="")
    args = ap.parse_args()

    result_root = pathlib.Path(args.results)
    cache_roots = [pathlib.Path(p) for p in args.cache] or [HERE / "cache-scout" / "blog-batches"]
    rows, batches = load_results(result_root, cache_roots[0], args.complete_only)
    report = {
        "result_root": str(result_root),
        "cache_roots": [str(p) for p in cache_roots],
        "complete_only": args.complete_only,
        "batches": batches,
        "validation": validate(rows, source_index(cache_roots)),
    }
    text = json.dumps(report, indent=2, ensure_ascii=False)
    print(text)
    if args.out:
        pathlib.Path(args.out).write_text(text)

    v = report["validation"]
    hard_fail = (
        v["duplicate_ids"]
        or v["missing_source"]
        or v["non_blog"]
        or v["grounding_failures"]
        or v["leakage_failures"]
        or v["dead_writable"]
    )
    return 2 if hard_fail else 0


if __name__ == "__main__":
    raise SystemExit(main())
