"""Pick the enrichment method from the profile, then check the BODY agrees with that choice.

WHY THE LABEL IS A HINT AND NOT AN INSTRUCTION
  Every profile keys off `source/page_type`, and that taxonomy is applied but UNVALIDATED
  (CLAUDE.md). Label-only dispatch runs the wrong method whenever the classifier is wrong -- and
  every gate still passes, because the spans are perfectly grounded; they are just the wrong
  shape for the page. A docs_api abstract on an editorial page is faithful and useless.

  So the sniffer measures the body and disagreement is reported, not silently resolved. The
  reclassification report is also the cheapest taxonomy validation available: it is a by-product
  of work already being done.

WHAT A DISAGREEMENT DOES
  It WARNS and refuses to WRITE that record. It does not re-route: silently switching strategy on
  a sniffer's opinion would be the same mistake in the other direction. A slice whose
  disagreement rate exceeds the profile's threshold fails as a slice.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

_FENCE = re.compile(r"```.*?```", re.DOTALL)
_LINK_LINE = re.compile(r"^\s*[-*]?\s*\[[^\]]+\]\([^)]*\)\s*$", re.M)
_PARAM_ROW = re.compile(r"^\s*\|.*\|\s*$", re.M)
_ROUTE = re.compile(r"^\s*(GET|POST|PUT|DELETE|PATCH)\s+/", re.M)
_SENTENCE = re.compile(r"[.!?](\s|$)")


@dataclass(frozen=True)
class BodyShape:
    chars: int
    code_ratio: float
    sentence_density: float      # sentence ends per 1,000 chars of prose
    nav_link_ratio: float        # share of lines that are nothing but a link
    param_table_rows: int
    route_lines: int

    @property
    def sniffed(self) -> str:
        """The method the BODY looks like. Deliberately coarse -- it is a cross-check, not a
        classifier, and a confident wrong answer would be worse than a vague right one."""
        if self.nav_link_ratio > 0.5 and self.sentence_density < 3:
            return "no_abstract"
        if self.code_ratio > 0.45 and self.sentence_density < 6:
            return "developer_code"
        if self.route_lines >= 2 or (self.param_table_rows >= 6 and self.code_ratio > 0.15):
            return "docs_api"
        return "editorial"


def sniff(markdown: str) -> BodyShape:
    md = markdown or ""
    code = "".join(_FENCE.findall(md))
    prose = _FENCE.sub(" ", md)
    lines = [l for l in md.splitlines() if l.strip()]
    return BodyShape(
        chars=len(md),
        code_ratio=(len(code) / len(md)) if md else 0.0,
        sentence_density=(1000 * len(_SENTENCE.findall(prose)) / len(prose)) if prose else 0.0,
        nav_link_ratio=(len(_LINK_LINE.findall(md)) / len(lines)) if lines else 0.0,
        param_table_rows=len(_PARAM_ROW.findall(md)),
        route_lines=len(_ROUTE.findall(md)),
    )


# Which sniffed shapes are ACCEPTABLE for a declared strategy. Wider than equality on purpose:
# a case study and a blog post both sniff `editorial`, and they should -- the sniffer measures
# page shape, and those two have the same shape. It is there to catch a reference page declared
# editorial, not to re-derive the taxonomy.
COMPATIBLE = {
    "editorial": {"editorial"},
    "press_release": {"editorial"},
    "case_study": {"editorial"},
    "docs_api": {"docs_api", "developer_code", "editorial"},
    "developer_code": {"developer_code", "docs_api"},
    "no_abstract": {"no_abstract", "editorial", "docs_api", "developer_code"},
}


def route(declared: str, markdown: str) -> dict:
    shape = sniff(markdown)
    sniffed = shape.sniffed
    agrees = sniffed in COMPATIBLE.get(declared, {declared})
    return {
        "declared": declared,
        "sniffed": sniffed,
        "agrees": agrees,
        "shape": {
            "chars": shape.chars,
            "code_ratio": round(shape.code_ratio, 3),
            "sentence_density": round(shape.sentence_density, 2),
            "nav_link_ratio": round(shape.nav_link_ratio, 3),
            "param_table_rows": shape.param_table_rows,
            "route_lines": shape.route_lines,
        },
    }
