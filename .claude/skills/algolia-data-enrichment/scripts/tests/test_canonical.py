"""Properties of `canonicalise()`. Both Blog grounding failures were violations of these two.

The failures were NOT bad spans. They were two code paths inside one function normalising the
same characters differently -- the markdown-link branch skipped the typographic fold and the
space-before-punctuation rule that the main loop applied. A span sliced verbatim out of a page
then reported as ungrounded, three times in one repair run, all on one article.

IDEMPOTENCE IS THE CHECK THAT WOULD HAVE CAUGHT IT, and it is asserted directly rather than
inferred from a passing pipeline.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from algolia_enrichment.canonical import (Canon, canon_contains, canon_text, canonical_version,
                                          canonicalise, detect_language, is_speech, prose_chars)

SAMPLES = [
    "Plain prose with nothing special in it at all.",
    "**Bold** and `code` and ~strike~ markers are dropped.",
    "A [link label](https://example.com/x) inside a sentence.",
    "A [label with don’t and a comma , inside](https://x.y) plus trailing prose.",
    "# Heading\n\n> A blockquote lede under the H1.\n\nBody text follows here.",
    "| name | required |\n| --- | --- |\n| query | yes |",
    "Algolia has a .NET API Client and a :8080 port and a ?q=1 query.",
    "percentage points , with a space before the comma.",
    "Der Umsatz stieg. Über 40 Prozent mehr Conversions in Europa.",
    "Les ventes ont augmenté. À partir de 2024, tout a changé pour eux.",
    "<section><Card title=\"x\" /></section> Real prose after markup.",
    "if count < 5 and total > 3 then the comparison must survive.",
    "3,1 Mio. US-Dollar erzielte das Team im ersten Quartal.",
    "A label wrapped\nacross a newline [inside\n  a link](https://x.y) still works.",
]


@pytest.mark.parametrize("text", SAMPLES)
def test_canonicalise_is_idempotent(text):
    """canonicalise(canonicalise(x).text).text == canonicalise(x).text

    If this fails, a span sliced from the canonical body cannot be found in the canonical body,
    and grounding reports a fabrication that did not happen.
    """
    once = canonicalise(text).text
    twice = canonicalise(once).text
    assert once == twice, f"not idempotent:\n  once={once!r}\n  twice={twice!r}"


@pytest.mark.parametrize("text", SAMPLES)
def test_origin_map_stays_exact(text):
    """Every canonical character maps to a real offset in the original, in order.

    The fold table must be strictly 1:1 for this to hold -- that is why `…` is deliberately not
    folded to "...", which would need one character to become three.
    """
    c = canonicalise(text)
    assert len(c.origin) == len(c.text)
    assert all(0 <= o < len(c.original) for o in c.origin)
    assert c.origin == sorted(c.origin), "origin offsets are not monotonic"


@pytest.mark.parametrize("label,plain", [
    ("don’t stop , now", "don’t stop , now"),
    ("a .NET client", "a .NET client"),
    ("spaced , comma", "spaced , comma"),
    ("trailing dot .", "trailing dot ."),
])
def test_link_branch_matches_plain_branch(label, plain):
    """The markdown-link branch and the main loop must normalise identically.

    THE EXACT DIVERGENCE THAT BROKE GROUNDING TWICE. Inside `[label](url)` the historical code
    emitted characters raw while the main loop folded them, so the same words canonicalised two
    different ways depending on whether they happened to sit inside a link.
    """
    via_link = canon_text(f"[{label}](https://example.com)")
    via_plain = canon_text(plain)
    assert via_link == via_plain, f"branch divergence: link={via_link!r} plain={via_plain!r}"


def test_a_span_sliced_from_the_page_is_found_in_the_page():
    """The whole guarantee, in one assertion, over every sample."""
    for text in SAMPLES:
        c = canonicalise(text)
        if len(c.text) < 12:
            continue
        mid = c.text[3:len(c.text) - 3]
        assert canon_contains(c.text, mid), f"slice not findable in its own source: {mid!r}"


def test_slice_original_returns_the_pages_own_characters():
    c = canonicalise("**Algolia** is [fast](/doc) and reliable.")
    start = c.text.index("fast")
    original, o_start, o_end = c.slice_original(start, start + 4)
    assert original == "fast"
    assert c.original[o_start:o_end] == "fast"


def test_tag_stripping_does_not_eat_a_comparison():
    """`x < 5 and y > 3` is prose, not a tag. Caught by test, not by review."""
    assert "count < 5 and total > 3" in canon_text("if count < 5 and total > 3 then")


def test_leading_dot_keeps_its_space():
    """`a .NET` must not collapse to `a.NET`. A mark followed by a letter is OPENING something."""
    assert canon_text("Algolia has a .NET API Client") == "Algolia has a .NET API Client"


def test_space_before_closing_punctuation_is_dropped():
    assert canon_text("percentage points , with") == "percentage points, with"


def test_blockquote_and_heading_structure_survives_canonicalisation():
    c = canonicalise("# Usage API\n\n> The Usage API lets you retrieve statistics.\n\nBody.")
    quoted_at = c.text.index("The Usage API")
    assert c.quoted[quoted_at] is True
    assert c.section_title(quoted_at) == "Usage API"


def test_block_ids_separate_a_heading_from_the_prose_under_it():
    c = canonicalise("## Entwickeln Sie mit Algolia\n\nAlgolia bietet Ihnen alles.")
    head = c.text.index("Entwickeln")
    body = c.text.index("Algolia bietet")
    assert c.block[head] != c.block[body], "heading merged into the prose under it"


def test_is_speech_is_the_one_definition():
    assert is_speech('"We rebuilt search," said the CTO.')
    assert is_speech("Great results — Jane Doe")
    assert not is_speech("The Usage API lets you retrieve various usage statistics.")


def test_detect_language_flags_a_mix_and_is_silent_without_signal():
    assert detect_language("the search and the results for you") == "en"
    assert detect_language("der Umsatz und die Ergebnisse für Sie") == "de"
    assert detect_language("XYZ 123") == "?"


def test_prose_chars_ignores_code_and_furniture():
    md = "# T\n\n```\ncode code code code code\n```\n\nReal prose that runs on for a while here."
    assert prose_chars(md) < len(md)
    assert prose_chars(md) > 20


def test_canonical_version_is_stable_and_short():
    assert canonical_version() == canonical_version()
    assert len(canonical_version()) == 16
