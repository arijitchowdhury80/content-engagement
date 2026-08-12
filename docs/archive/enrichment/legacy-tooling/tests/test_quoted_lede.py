#!/usr/bin/env python3
"""
The [QUOTED] label does two jobs on a `doc-md-twin` page. Exactly one of them is wrong.

WHAT WENT WRONG
  That fetch path -- 4,337 of the 10,198 enrichable records -- wraps TWO different things in
  markdown blockquotes:

      > ## Documentation Index                     <- site-wide furniture, ABOVE the H1
      > Fetch the complete documentation index at: https://algolia.com/llms.txt
      > Use this file to discover all available pages before exploring further.

      # API clients                                <- the page

      > The API client libraries let you use Algolia's APIs in the programming language of
      > your choice.                               <- the page's OWN description, BELOW the H1

  `canonicalise()` records both as quoted, the menu labels both [QUOTED], and SELECT_PROMPT says
  "Do NOT pick a [QUOTED] sentence unless the family is evidence: it is someone else speaking."
  Measured on the calibration cache: 50 of 50 reference pages carry an H1-adjacent description and
  49 of 50 had it labelled, so the page's own summary was unpickable on essentially every page.

WHY THE OBVIOUS FIX IS WRONG
  The tempting fix is to label [QUOTED] only when the span is real speech, matching what the G10
  gate already does -- its own comment reads "A blockquoted lede is the page's own voice." Measured
  before writing it: that releases "Use this file to discover all available pages before exploring
  further." into the abstract pool on all 4,337 pages. It is boilerplate, it is above the H1 on
  every page, and G8 corpus-wide boilerplate detection is currently OFF, so nothing else would stop
  it. That is the /fr/awards failure again -- pages described in terms of furniture.

  So the fix is positional, not semantic: only the blockquote IMMEDIATELY FOLLOWING THE H1 is the
  page's own voice. Everything else keeps the label. Real speech keeps the label even in the lede
  slot, which is why `is_speech` is shared with G10 rather than duplicated.

    python3 -m pytest docs/70-enrichment/tests/test_quoted_lede.py -q
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest  # noqa: E402

from candidates import page_lede_quote_range, render_menu, split_candidates  # noqa: E402
from span_gate import is_speech  # noqa: E402


DOC_MD_TWIN = (
    "> ## Documentation Index\n"
    "> Fetch the complete documentation index at: https://algolia.com/llms.txt\n"
    "> Use this file to discover all available pages before exploring further.\n"
    "\n"
    "# API clients\n"
    "\n"
    "> The API client libraries let you use Algolia's APIs in the programming language of your choice.\n"
    "\n"
    "This page lists the latest major versions of Algolia's API clients, labeled current.\n"
)

QUOTED_LEDE_IS_SPEECH = (
    "# Customer story\n"
    "\n"
    '> "Algolia cut our search latency by an order of magnitude." - Jane Doe, CTO\n'
)

MID_PAGE_QUOTE = (
    "# Case study\n"
    "\n"
    "The team replaced three separate systems with one search index in under a quarter.\n"
    "\n"
    "> “We replaced three systems with one and never looked back.”\n"
)


def line_for(menu, needle):
    hits = [ln for ln in menu.splitlines() if needle in ln]
    assert hits, f"{needle!r} not in menu:\n{menu}"
    return hits[0]


# --------------------------------------------------------------------------
# the shared predicate
# --------------------------------------------------------------------------

@pytest.mark.parametrize("text", [
    "The API client libraries let you use Algolia's APIs in the programming language of your choice.",
    "List of all search API parameters.",
    "Terms used at Algolia and their definitions.",
    "The Crawler API lets you manage and run your crawlers",
])
def test_a_page_description_is_not_speech(text):
    assert is_speech(text) is False


@pytest.mark.parametrize("text", [
    '"Algolia cut our search latency by an order of magnitude."',
    "“We replaced three systems with one.”",
    "Algolia cut our latency by an order of magnitude — Jane Doe",
])
def test_quotation_marks_and_attribution_are_speech(text):
    assert is_speech(text) is True


# --------------------------------------------------------------------------
# locating the page's own description
# --------------------------------------------------------------------------

def test_lede_range_finds_the_blockquote_under_the_h1():
    lo, hi = page_lede_quote_range(DOC_MD_TWIN)
    assert "The API client libraries" in DOC_MD_TWIN[lo:hi]


def test_lede_range_never_captures_the_furniture_above_the_h1():
    """The whole reason this is positional and not semantic."""
    lo, hi = page_lede_quote_range(DOC_MD_TWIN)
    captured = DOC_MD_TWIN[lo:hi]
    assert "Documentation Index" not in captured
    assert "llms.txt" not in captured
    assert "discover all available pages" not in captured


def test_lede_range_is_none_when_no_blockquote_follows_the_h1():
    assert page_lede_quote_range("# Plain page\n\nJust a sentence about the subject.\n") is None


# --------------------------------------------------------------------------
# the label
# --------------------------------------------------------------------------

def test_page_description_loses_the_quoted_label():
    """The regression. 49 of 50 calibration pages hit this."""
    cands, _ = split_candidates(DOC_MD_TWIN)
    menu = render_menu(cands)
    assert "[QUOTED]" not in line_for(menu, "The API client libraries")


def test_the_structural_fact_is_preserved_only_the_label_changes():
    cands, _ = split_candidates(DOC_MD_TWIN)
    lede = [c for c in cands if "The API client libraries" in c.text][0]
    assert lede.is_quoted is True, "canonicalise must still record that it came from a blockquote"
    assert lede.is_page_lede is True


def test_documentation_index_furniture_keeps_the_quoted_label():
    """Releasing this would have put site-wide boilerplate into 4,337 abstracts, with G8 off."""
    cands, _ = split_candidates(DOC_MD_TWIN)
    menu = render_menu(cands)
    assert "[QUOTED]" in line_for(menu, "discover all available pages")


def test_a_speech_lede_keeps_the_label_even_in_the_lede_slot():
    cands, _ = split_candidates(QUOTED_LEDE_IS_SPEECH)
    menu = render_menu(cands)
    assert "[QUOTED]" in line_for(menu, "cut our search latency")


def test_a_mid_page_quotation_keeps_the_label():
    cands, _ = split_candidates(MID_PAGE_QUOTE)
    menu = render_menu(cands)
    assert "[QUOTED]" in line_for(menu, "replaced three systems")


def test_unquoted_body_prose_is_never_labelled():
    cands, _ = split_candidates(DOC_MD_TWIN)
    menu = render_menu(cands)
    assert "[QUOTED]" not in line_for(menu, "This page lists the latest")


# --------------------------------------------------------------------------
# label and gate must not drift apart again
# --------------------------------------------------------------------------

def test_the_menu_label_and_the_g10_gate_share_one_speech_predicate():
    """Two opinions about what counts as speech is what caused this. There must be exactly one."""
    import inspect

    import candidates
    import span_gate

    assert "is_speech" in inspect.getsource(candidates.render_menu), \
        "render_menu must decide the [QUOTED] label with the shared is_speech()"
    assert "is_speech" in inspect.getsource(span_gate.check_context), \
        "G10 must decide quotation with the same is_speech()"
