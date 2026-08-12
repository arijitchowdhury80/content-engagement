#!/usr/bin/env python3
"""
Tests for the LEDE fix — a whole block with no full stop is a sentence, not a fragment.

WHY THIS EXISTS
  Phase 1 calibration on the `reference` family scored 36% writable against a 60% bar. The
  largest single cause was not the model. On 18 of 50 pages the page's own one-line description
  of itself — "The Algolia Search API lets you search, configure, and manage your indices and
  records" — was marked [FRAGMENT] purely because the markdown lede carries no terminal period.

  The `reference` family instruction asks the abstract to lead with "what the endpoint DOES, in
  the page's own words". That IS this sentence. The prompt then says "Use UNMARKED entries only."
  The prompt demanded the one sentence the classifier forbade, so the model returned THIN.

WHAT IS BEING GUARANTEED
  The distinguishing mark of a real fragment is that it was CHOPPED, or that it dangles into a
  continuation. Not that it lacks a period. A block that produced exactly one chunk is a whole
  standalone unit by block boundary — a structural fact, not a punctuation shape, so it holds in
  en/de/fr/es/it/pt alike (see the monolingual-regex lesson: capital-start + period-end defeats
  every shape check).

  Fixtures are copied from docs/70-enrichment/cache-batches/doc-md-twin-reference-001/.

    python3 -m pytest docs/70-enrichment/tests/test_candidates_lede.py -q
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest  # noqa: E402

from candidates import (  # noqa: E402
    KIND_FRAGMENT,
    KIND_NONPROSE,
    KIND_PROSE,
    KIND_UI,
    MAX_CHARS,
    split_candidates,
)


def kinds_by_text(markdown):
    cands, _ = split_candidates(markdown)
    return {c.text: c.kind for c in cands}


def only(markdown):
    """The single candidate a one-block page produces."""
    cands, _ = split_candidates(markdown)
    assert len(cands) == 1, [c.text for c in cands]
    return cands[0]


# --------------------------------------------------------------------------
# the defect itself
# --------------------------------------------------------------------------

# Verbatim from cache-batches/.../https:__www.algolia.com_doc_rest-api_search.json
LEDE_SEARCH = "The Algolia Search API lets you search, configure, and manage your indices and records"

LEDES = [
    LEDE_SEARCH,
    "The Algolia A/B Testing API lets you manage your Algolia A/B tests to optimize your search experience",
    "The Analytics API gives you access to metrics related to your Algolia search experience",
    "The Crawler API lets you manage and run your crawlers",
    "The Monitoring API lets you check the status of your Algolia infrastructure",
    "Configurable options for the Search API and index settings, grouped by when and how they take effect",
]


@pytest.mark.parametrize("lede", LEDES)
def test_periodless_lede_block_is_prose(lede):
    """The regression that cost 18 of 50 reference pages their abstract."""
    c = only(f"# Search API\n\n{lede}\n")
    assert c.kind == KIND_PROSE, f"{lede!r} was marked {c.kind}"
    assert c.sentence_complete is True


def test_periodless_lede_is_selectable_in_the_menu():
    """A [FRAGMENT] label is what the prompt bans, so the label is the whole bug."""
    from candidates import render_menu

    cands, _ = split_candidates(f"# Search API\n\n{LEDE_SEARCH}\n")
    menu = render_menu(cands)
    assert "[FRAGMENT]" not in menu
    assert LEDE_SEARCH in menu


# --------------------------------------------------------------------------
# what must NOT be relaxed by the same change
# --------------------------------------------------------------------------

def test_dangling_comma_stays_a_fragment():
    """Verbatim from doc/glossary — a genuinely truncated clause, sole chunk in its block."""
    text = ("Certain Algolia Services with an ability to train or adapt via use, "
            "such as NeuralSearch,")
    c = only(f"# Glossary\n\n{text}\n")
    assert c.kind == KIND_FRAGMENT


@pytest.mark.parametrize("tail", [",", ";", "-", "/"])
def test_continuation_punctuation_is_never_prose(tail):
    """A dangling clause must stay out of the abstract. Which non-prose label it earns is an
    implementation detail — a trailing ';' is already caught as nonprose by _CODE_ISH."""
    text = "Use the Algolia API clients to integrate search into your application" + tail
    assert only(f"# Clients\n\n{text}\n").kind != KIND_PROSE


def test_chopped_pieces_are_never_prose():
    """A MAX_CHARS chop is a fragment by construction, period or not. The final short piece is
    claimed by the UI shape test first, which is why this asserts 'not prose' and not 'fragment'."""
    long_block = ("integration " * 400).strip()
    cands, _ = split_candidates(f"# Long\n\n{long_block}\n")
    assert len(cands) > 1
    assert all(c.kind != KIND_PROSE for c in cands), [c.kind for c in cands]
    assert all(len(c.text) <= MAX_CHARS for c in cands)


def test_short_nav_label_stays_ui():
    """_is_ui keys off `complete`; the fix must not leak short chrome into prose."""
    c = only("# Nav\n\nGet started with the Algolia Crawler\n")
    assert c.kind == KIND_UI


def test_all_caps_banner_stays_ui():
    c = only("# Promo\n\nCLAIM YOUR SPOT AT ALGOLIA DEVCON\n")
    assert c.kind == KIND_UI


@pytest.mark.parametrize("line", [
    "https://analytics.algolia.com (routes requests to the closest of the above servers)",
    "https//insights.algolia.io (routes requests to the closest of the above servers)",
])
def test_url_leading_line_is_nonprose(line):
    """These are endpoint rows. Only the [FRAGMENT] label was holding them out of the abstract,
    so unlocking fragments must be paired with a structural URL test."""
    assert only(f"# Base URLs\n\n{line}\n").kind == KIND_NONPROSE


# The six lines that leaked into the prose pool when standalone blocks were released without the
# uppercase disqualifier. Five are code the _CODE_ISH pattern does not match; one is a truncated
# clause. Every one begins lowercase, which is what now holds them back.
LEAKED_WHEN_UNGUARDED = [
    "we are using this as opposed to a based selector so that",
    "claude plugin marketplace add algolia/skills claude plugin install algolia-quickstart@algolia-skills",
    'client.execute { index into "index1" objects Seq( Contact("myID1", "Jimmie", "Barninger") )}',
    "algolia objects update INDEX_NAME -F records.ndjson --dry-run --output json",
]


@pytest.mark.parametrize("line", LEAKED_WHEN_UNGUARDED)
def test_lowercase_standalone_block_is_never_promoted_to_prose(line):
    assert only(f"# Example\n\n{line}\n").kind != KIND_PROSE


def test_uppercase_test_only_ever_holds_back_never_promotes():
    """It is a disqualifier on the relaxed path. A properly punctuated sentence that happens to
    start lowercase must still be prose, exactly as it was before the lede fix."""
    text = "iOS and Android clients both support offline search out of the box."
    assert only(f"# SDKs\n\n{text}\n").kind == KIND_PROSE


def test_ordinary_sentence_is_unaffected():
    text = "Use Algolia's API clients and libraries to reliably integrate Algolia's APIs with your apps."
    assert only(f"# Client libraries\n\n{text}\n").kind == KIND_PROSE


def test_second_sentence_in_a_multi_sentence_block_is_not_promoted():
    """Standalone means the block yielded ONE chunk. Two sentences means neither is standalone,
    so a trailing period-less tail stays a fragment."""
    tail = "Randomize this list of fallback servers to ensure an even load across all three"
    md = f"# Notes\n\nAll requests must use HTTPS. {tail}\n"
    kinds = kinds_by_text(md)
    assert kinds["All requests must use HTTPS."] == KIND_PROSE
    assert kinds[tail] == KIND_FRAGMENT
