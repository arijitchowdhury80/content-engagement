"""Leakage, chrome, duplicate-description, incomplete spans, and judge interpretation.

GROUNDING IS NOT QUALITY, AND THIS IS THE MODULE THAT SAYS SO.
  Every span here is already proven to be on the page. What is still open is whether it should
  have been chosen. The Blog run's own record: the judge asked for a revision on 56% of
  abstracts, and selection quality was self-rated 5/10 against a grounding guarantee rated
  10/10. The writer was not hallucinating; it was choosing true-but-worse sentences while better
  ones sat on the same page.

  Grounding is a guarantee. Quality is a judgement. A passing gate here is not a good abstract.

LEAKAGE IS A CORPUS FACT, NOT A SHAPE.
  "Your browser does not support the audio element." is a complete eight-word sentence with
  balanced brackets, and every shape test correctly says it is prose. Only knowing that it is
  furniture refutes it -- which is why the forbidden list lives in `filters.py` and both the
  menu builder and this validator read the same tuple. When they had separate copies, the
  validator named it as leakage while the filter left it in the menu, and a repair run promoted
  it into five highlights.
"""

from __future__ import annotations

from ..filters import FORBIDDEN_TEXT, overlap
from ..gates import check_blacklists, check_template_collision
from ..repair import incomplete_reason
from ..errors import ZeroWorkError
from .grounding import spans_of


def check_rows(rows: list[dict], min_information_gain_overlap: float = 0.85) -> dict:
    """Quality defects across a final artifact. Never raises on a defect -- it reports them, and
    `validate` decides which are fatal. Raises only on zero work."""
    leakage: list[dict] = []
    chrome: list[dict] = []
    incomplete: list[dict] = []
    duplicate_description: list[dict] = []
    checked = 0

    for row in rows:
        oid = row["objectID"]
        abstract_spans = row.get("abstract_spans_stored") or []
        for field, span in spans_of(row):
            checked += 1
            low = span.lower()
            if any(m in low for m in FORBIDDEN_TEXT):
                leakage.append({"objectID": oid, "field": field, "span": span[:120]})
            hits = check_blacklists([span])
            if hits:
                chrome.append({"objectID": oid, "field": field, "reason": hits[0]})
            reason = incomplete_reason(span, is_abstract=(field == "abstract_enriched"))
            if reason:
                incomplete.append({"objectID": oid, "field": field, "reason": reason,
                                   "span": span[-80:]})
        if abstract_spans:
            desc = row.get("description") or ""
            joined = " ".join(abstract_spans)
            if desc and overlap(joined, desc) >= min_information_gain_overlap:
                # The dominant case-study failure: a grounded, faithful abstract that restates
                # the description the record already has. Every other gate passes.
                duplicate_description.append({
                    "objectID": oid, "overlap": round(overlap(joined, desc), 3)})

    if checked == 0:
        raise ZeroWorkError("quality validation checked zero spans. Zero work is a failure.")

    templates = check_template_collision([" ".join(r.get("abstract_spans_stored") or [])
                                          for r in rows])
    return {
        "rows": len(rows),
        "spans_checked": checked,
        "leakage": leakage,
        "chrome": chrome,
        "incomplete_spans": incomplete,
        "duplicate_description": duplicate_description,
        "template_collisions": templates,
        "ok": not (leakage or chrome or incomplete),
    }


def quality_census(rows: list[dict]) -> dict:
    """Distributions a human needs to judge a slice, per language.

    A SYSTEMATIC SKEW BY LANGUAGE IS A DEFECT, NOT A CURIOSITY. 65% of the case-study slice is
    de/fr and that path had never run; one monolingual defect was already found by inspection
    (an ASCII-only sentence-start class that never split an accented sentence), so siblings
    should be assumed. Candidate counts and span-length distributions per language are how a
    sibling shows itself.
    """
    by_lang: dict[str, dict] = {}
    for row in rows:
        lang = row.get("language_code") or "?"
        b = by_lang.setdefault(lang, {"records": 0, "candidates": [], "abstract_chars": [],
                                      "highlight_chars": [], "abstract_spans": [],
                                      "highlights": [], "statuses": {}})
        b["records"] += 1
        b["statuses"][row.get("status", "?")] = b["statuses"].get(row.get("status", "?"), 0) + 1
        if row.get("candidates") is not None:
            b["candidates"].append(row["candidates"])
        spans = row.get("abstract_spans_stored") or []
        highs = row.get("keyhighlights_enriched") or []
        if spans:
            b["abstract_spans"].append(len(spans))
            b["abstract_chars"] += [len(s) for s in spans]
        if highs:
            b["highlights"].append(len(highs))
            b["highlight_chars"] += [len(s) for s in highs]

    def summarise(values: list[int]) -> dict:
        if not values:
            return {"n": 0}
        s = sorted(values)
        return {"n": len(s), "min": s[0], "p50": s[len(s) // 2], "max": s[-1],
                "mean": round(sum(s) / len(s), 1)}

    return {lang: {
        "records": b["records"],
        "statuses": b["statuses"],
        "candidates": summarise(b["candidates"]),
        "abstract_span_count": summarise(b["abstract_spans"]),
        "abstract_span_chars": summarise(b["abstract_chars"]),
        "highlight_count": summarise(b["highlights"]),
        "highlight_chars": summarise(b["highlight_chars"]),
    } for lang, b in sorted(by_lang.items())}
