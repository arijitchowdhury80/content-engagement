#!/usr/bin/env python3
"""
canonicalise() must be idempotent, and the fold must not depend on markdown syntax.

THE DEFECT THIS LOCKS DOWN -- 2026-08-10
  The markdown-link branch emitted the label's characters RAW while the main loop folded them
  through `_FOLD`. So `don’t` inside `[...](url)` stayed U+2019 in the canonical BODY, while the
  same words canonicalised as a standalone SPAN became U+0027.

  `canon_contains` folds both sides before comparing, and the two sides took different paths. The
  result: three spans sliced verbatim out of a page reported as NOT GROUNDED. The text was
  faithful; the comparison was broken. This is the "re-canonicalising a stored span produces
  different text" lesson, with a located cause.

  The general property -- canonicalise(canonicalise(x)) == canonicalise(x) -- is what actually
  guarantees a stored span can be found in its own page, so it is asserted directly rather than
  only on the one example that failed.

    python3 -m pytest docs/70-enrichment/tests/test_canonicalise_idempotent.py -q
"""

import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from span_gate import canonicalise  # noqa: E402

CASES = [
    "Plain prose with a curly apostrophe: they don’t get it.",
    "A [link label with don’t inside](https://example.com/x) and trailing prose.",
    "An em dash — inside [a link — with one too](https://example.com/y).",
    "Curly “quotes” in prose and [curly “quotes” in a label](https://example.com/z).",
    "Mixed [don’t](https://example.com/a) and don’t outside the link.",
    # The SECOND divergence between the two loops, found the same way: the space-before-closing-
    # punctuation rule also fired on a LEADING dot, and also only outside link labels.
    "Algolia has a .NET API Client, and Unity supports C# as a scripting language.",
    "Algolia has a [.NET API Client](https://example.com/a), and Unity supports C#.",
    "percentage points , with users reaching results higher up the page.",
    "A [label with points , inside it](https://example.com/b) and more prose.",
    "Serve it on :8080 and query ?q=1 to get the result back.",
]


@pytest.mark.parametrize("text", CASES)
def test_canonicalise_is_idempotent(text):
    once = canonicalise(text).text
    twice = canonicalise(once).text
    assert once == twice, f"canonicalise is not idempotent:\n  {once!r}\n  {twice!r}"


@pytest.mark.parametrize("text", CASES)
def test_the_fold_reaches_inside_link_labels(text):
    out = canonicalise(text).text
    for curly in ("’", "‘", "“", "”", "—", "–"):
        assert curly not in out, f"{curly!r} survived canonicalisation of {text!r}"


def test_the_span_that_broke_the_repair_run_is_found_in_its_page():
    """The real record: en_850d5a52..., a highlight inside a markdown link."""
    body = ("Today’s customers expect brands to understand them on an individual level. "
            "In fact, [71% of consumers expect personalization, and if they don’t get it, "
            "76% switch to a competitor.](https://www.algolia.com/blog/ecommerce/x/) "
            "Personalization powered by AI allows businesses to understand their customers.")
    span = ("In fact, 71% of consumers expect personalization, and if they don’t get it, "
            "76% switch to a competitor.")
    assert canonicalise(span).text in canonicalise(body).text


def test_the_offset_map_stays_exact():
    """The fold is 1:1, so a canonical character must be its original or that original's fold.

    Whitespace is excluded: a collapsed run emits ONE space whose origin deliberately points at
    the next emitted character, so a synthesised space does not sit over a space in the source.
    That predates the fold and is not what this test is about.
    """
    from span_gate import _FOLD
    text = "A [label with don’t inside](https://example.com/x) then more “prose” here."
    canon = canonicalise(text)
    assert len(canon.origin) == len(canon.text)
    checked = 0
    for i, ch in enumerate(canon.text):
        origin = canon.origin[i]
        assert 0 <= origin < len(canon.original)
        if ch.isspace():
            continue
        checked += 1
        assert ch == canon.original[origin] or ch == _FOLD.get(canon.original[origin]), (
            f"canonical {ch!r} at {i} maps to original {canon.original[origin]!r}")
    assert checked > 30, "the case must actually exercise the map"


def test_a_leading_dot_keeps_its_space():
    """`.NET` is not trailing punctuation. Collapsing `a .NET` to `a.NET` corrupted two spans."""
    assert ".NET API Client" in canonicalise("Algolia has a .NET API Client today.").text
    assert "a.NET" not in canonicalise("Algolia has a .NET API Client today.").text


def test_a_trailing_comma_still_loses_its_space():
    """The original rule must survive the narrowing -- models silently fix `points , with`."""
    assert canonicalise("percentage points , with users").text == "percentage points, with users"


def test_the_link_label_and_the_main_loop_agree():
    """The class behind both bugs: two loops implementing the same rules differently."""
    inside = canonicalise("x [Algolia has a .NET client , here](https://e.com/a) y").text
    outside = canonicalise("x Algolia has a .NET client , here y").text
    assert "Algolia has a .NET client, here" in inside
    assert "Algolia has a .NET client, here" in outside
