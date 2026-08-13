"""pool_filters — what reaches the model, and what cannot.

Both Scout probes showed the model is not the problem: the Documentation Index sentence is
well-formed prose that every shape test correctly accepts, and it was in the pool on 10/10 and
23/23 pages. These tests fix the removals in place, and — just as important — fix in place the
things that must NOT be removed, because over-filtering turns a sparse page into a false THIN.
"""

from __future__ import annotations

import pathlib
import sys
from dataclasses import dataclass

import pytest

HERE = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HERE))

import pool_filters as pf  # noqa: E402


@dataclass
class FakeCandidate:
    index: int = 1
    text: str = ""
    original: str = ""
    kind: str = "prose"
    is_already_indexed: bool = False

    def __post_init__(self):
        self.original = self.original or self.text


def c(text, **kw):
    return FakeCandidate(text=text, **kw)


# --- removed ---------------------------------------------------------------

@pytest.mark.parametrize("text,reason", [
    ("Use this file to discover all available pages before exploring further.", "DOC_INDEX"),
    ("Fetch the complete documentation index at: /llms.txt for more pages.", "DOC_INDEX"),
    ("Skip to main content and start reading the documentation here.", "CHROME_SKIP_LINK"),
    ("© 2026 Algolia. All rights reserved worldwide and in every territory.", "CHROME_LEGAL"),
    ("Cookie preferences can be changed at any time from this settings panel.", "CHROME_COOKIE"),
    ("Book a demo with our team to see how search can work for you.", "CHROME_CTA"),
    ("// The client can fail to initialize if you pass an invalid parameter.", "CODE_COMMENT"),
    ("# Initialize the client before making any API calls to the service.", "CODE_COMMENT"),
    ("short", "TOO_SHORT"),
])
def test_furniture_and_chrome_are_dropped(text, reason):
    assert pf.drop_reason(c(text)) == reason


def test_corpus_boilerplate_is_dropped():
    assert pf.drop_reason(c("A perfectly well-formed sentence on eleven other pages.",
                            kind="boilerplate")) == "BOILERPLATE"


def test_exact_and_near_duplicates_of_the_description_are_dropped():
    desc = "The Algolia Search API lets you search and configure your indices."
    assert pf.drop_reason(c(desc, is_already_indexed=True), desc) == "DUPLICATE_DESC_EXACT"
    near = desc + " It is available in every region."
    assert pf.drop_reason(c(near), desc) == "DUPLICATE_DESC_NEAR"


def test_a_candidate_restating_the_title_is_dropped():
    title = "Configure index settings with the Algolia API"
    cand = c("Configure index settings with the Algolia API.")
    assert pf.drop_reason(cand, description="", title=title) == "DUPLICATE_TITLE"


# --- deliberately kept -----------------------------------------------------

@pytest.mark.parametrize("text", [
    "The Algolia Search API lets you search, configure, and manage your indices and records.",
    "Permissions are controlled through access control lists and access restrictions.",
    "Records are limited to 100 KB each on the Standard plan.",
    "Ce point de terminaison renvoie les rEsultats classEs pour une requEte donnEe.",
])
def test_real_page_prose_survives(text):
    assert pf.drop_reason(c(text)) is None


def test_a_url_inside_a_sentence_is_not_a_code_comment():
    """`//` anywhere would match; the pattern is anchored for exactly this case."""
    assert pf.drop_reason(c("Send requests to https://api.algolia.com to reach the service.")) is None


def test_a_sentence_merely_mentioning_cookies_is_kept():
    """CHROME_COOKIE must match the consent banner, not a page about cookie-based personalization."""
    assert pf.drop_reason(c("Personalization can use a cookie to identify a returning user.")) is None


def test_partial_overlap_with_the_description_is_kept():
    desc = "The Algolia Search API lets you search and configure your indices."
    assert pf.drop_reason(c("Rate limits apply per application and are enforced per second."),
                          desc) is None


# --- the pool contract -----------------------------------------------------

def test_filter_pool_counts_every_drop_by_reason():
    pool = [c("Use this file to discover all available pages before exploring further."),
            c("// a code comment that is long enough to be a candidate otherwise"),
            c("The Search API lets you configure ranking and relevance for an index.")]
    for i, cand in enumerate(pool, 1):
        cand.index = i
    kept, counts, dropped = pf.filter_pool(pool)
    assert len(kept) == 1
    assert counts == {"DOC_INDEX": 1, "CODE_COMMENT": 1}
    assert len(dropped) == 2


def test_original_indices_survive_filtering():
    """THE contract. `render_menu` prints `c.index` and `resolve_selection` keys on it, so a kept
    candidate must carry the number it always had. Renumbering here would silently re-point every
    span the model picks."""
    pool = [c("Use this file to discover all available pages before exploring further."),
            c("The Search API lets you configure ranking and relevance for an index."),
            c("Records are limited to 100 KB each on the Standard plan today.")]
    for i, cand in enumerate(pool, 1):
        cand.index = i
    kept, _, _ = pf.filter_pool(pool)
    assert [k.index for k in kept] == [2, 3]


def test_an_empty_pool_is_returned_empty_not_refilled():
    kept, counts, _ = pf.filter_pool([c("Skip to main content and read the documentation.")])
    assert kept == []
    assert sum(counts.values()) == 1


def test_overlap_is_symmetric_and_bounded():
    assert pf.overlap("", "anything") == 0.0
    assert pf.overlap("same words here", "same words here") == pytest.approx(1.0)
    assert pf.overlap("a b", "b a") == pf.overlap("b a", "a b")
