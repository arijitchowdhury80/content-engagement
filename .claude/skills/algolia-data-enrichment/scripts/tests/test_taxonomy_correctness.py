"""Correctness of rule-derived taxonomy values.

`taxonomy.py` proves the CONTRACT and says so in its own docstring: "verifies conformance, not
semantic correctness". It never reads a URL. This module answers the other question -- is the
stored value the value the rule predicts -- and these tests exist mostly to prove it can FAIL,
plus to pin the two traps that made the first version of it report nonsense.
"""
from __future__ import annotations

import pytest

from algolia_enrichment.errors import ZeroWorkError
from algolia_enrichment.taxonomy_correctness import check_records, match_rule, compile_rules

SCHEMA = {
    "version": "v1",
    "axes": [
        {"name": "page_type", "required_on": ["*"]},
        {"name": "feature", "required_on": ["doc-sdk"], "opportunistic_on": []},
        {"name": "product", "required_on": ["product-page"], "opportunistic_on": ["blog-post"]},
    ],
    "vocabularies": {},
    "url_rules": [
        {"host": "www.algolia.com", "path": r"^/doc/libraries/(?P<x>[\w-]+)/methods/search",
         "page_type": "doc-sdk", "feature": ["search"], "product": ["ai-search"]},
        {"host": "academy.algolia.com", "path": r"^/training", "page_type": "academy-training"},
        {"host": "www.algolia.com", "path": r"^/blog/", "page_type": "blog-post"},
    ],
}


def _rec(oid, url, **axes):
    return {"objectID": oid, "url": url, **axes}


# --- the trap that produced 142 phantom mismatches ---------------------------------------------

def test_host_is_part_of_the_rule_not_just_the_path():
    """Ignoring `host` matched academy.algolia.com URLs against www.algolia.com rules and
    produced 142 phantom page_type mismatches on the real corpus."""
    compiled = compile_rules(SCHEMA)
    rule, _ = match_rule(compiled, "academy.algolia.com", "/training/abc")
    assert rule["page_type"] == "academy-training"
    rule2, _ = match_rule(compiled, "www.algolia.com", "/blog/x")
    assert rule2["page_type"] == "blog-post"


def test_academy_urls_do_not_produce_a_www_verdict():
    recs = [_rec("a", "https://academy.algolia.com/training/x", page_type="academy-training")]
    out = check_records(recs, SCHEMA)
    assert out["mismatch"] == 0 and out["ok"] is True


# --- the trap that produced 726 false "missing" ------------------------------------------------

def test_a_rule_naming_an_axis_that_does_not_apply_is_NOT_a_data_defect():
    """doc-sdk is in neither required_on nor opportunistic_on for `product`, so the record is
    RIGHT to omit it. Counting that as missing produced 726 false defects on the real corpus.
    It is reported separately as a schema inconsistency."""
    recs = [_rec("a", "https://www.algolia.com/doc/libraries/csharp/methods/search/get-api-key",
                 page_type="doc-sdk", feature=["search"])]        # no product, deliberately
    out = check_records(recs, SCHEMA)
    assert out["missing"] == 0, "product must not be counted as missing on doc-sdk"
    assert out["ok"] is True
    assert len(out["rule_contradicts_applicability"]) == 1
    assert out["rule_contradicts_applicability"][0]["axis"] == "product"


# --- it must actually be able to fail ----------------------------------------------------------

def test_a_stored_value_that_disagrees_with_its_rule_FAILS():
    recs = [_rec("a", "https://www.algolia.com/blog/x", page_type="case-study")]
    out = check_records(recs, SCHEMA)
    assert out["mismatch"] == 1 and out["ok"] is False
    assert out["mismatches"][0]["expected"] == ["blog-post"]
    assert out["mismatches"][0]["stored"] == ["case-study"]


def test_a_required_axis_the_rule_predicts_but_the_record_lacks_FAILS():
    recs = [_rec("a", "https://www.algolia.com/doc/libraries/csharp/methods/search/x",
                 page_type="doc-sdk")]                            # feature IS required on doc-sdk
    out = check_records(recs, SCHEMA)
    assert out["missing"] == 1 and out["ok"] is False


def test_a_matching_value_passes():
    recs = [_rec("a", "https://www.algolia.com/blog/x", page_type="blog-post")]
    assert check_records(recs, SCHEMA)["ok"] is True


# --- zero work must never read as success ------------------------------------------------------

def test_zero_records_raises():
    with pytest.raises(ZeroWorkError):
        check_records([], SCHEMA)


def test_records_that_no_rule_predicts_raise_rather_than_report_a_vacuous_pass():
    """A checker that compared nothing and printed PASS is the most expensive kind of green."""
    recs = [_rec("a", "https://elsewhere.example.com/nothing", page_type="blog-post")]
    with pytest.raises(ZeroWorkError, match="compares nothing"):
        check_records(recs, SCHEMA)


# --- locale prefixes are not part of the rule surface ------------------------------------------

def test_locale_prefixed_urls_resolve_to_the_same_rule():
    recs = [_rec("a", "https://www.algolia.com/de/blog/x", page_type="blog-post"),
            _rec("b", "https://www.algolia.com/fr/blog/y", page_type="blog-post")]
    out = check_records(recs, SCHEMA)
    assert out["checked"] == 2 and out["ok"] is True


# --- the span-distance retry must be satisfiable ------------------------------------------------

def test_the_span_distance_ban_measures_what_the_gate_measures():
    """A retry handed a menu with no legal answer quarantines a healthy page forever.

    The gate computes max(end) - min(start). The ban filtered on c.start, so a candidate STARTING
    one character inside the window survived the ban while ENDING past it. Measured on
    /customers/donorschoose: the retry banned 52 candidates, kept 62, and still produced a spread
    of 8,111 against a limit of 8,000 -- exactly the length of the closing span.
    """
    from algolia_enrichment.gates import retry_constraints

    class C:
        def __init__(self, index, start, end):
            self.index, self.start, self.end = index, start, end
            self.text, self.is_quoted, self.section = "x", False, ""

    class Sel:
        pass

    limit = 8000
    anchor = 0
    # starts INSIDE the window, ends 111 past it -- the exact donorschoose shape
    straddler = C(2, anchor + limit - 50, anchor + limit + 111)
    cands = [C(1, anchor, anchor + 100), straddler]
    sel = Sel()
    sel.abstract = [cands[0]]
    sel.highlights = []
    ban, _reason = retry_constraints(
        ["abstract spans span ~8111 characters of the original page (limit 8000)"],
        sel, cands, title="", ineligible=set(), max_span_distance=limit)
    assert straddler.index in ban, (
        "a candidate ending past the window must be banned; banning only on `start` leaves the "
        "retry no legal answer")
