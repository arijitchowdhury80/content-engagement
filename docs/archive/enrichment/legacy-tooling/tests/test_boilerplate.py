#!/usr/bin/env python3
"""
Tests for G8 — corpus-wide boilerplate detection.

WHAT G8 IS FOR
  After the v1.2 menu fix, 4 of the 9 remaining judge-REVISE records were one class: a shared
  site-wide promotional block ("Recognized by IDC, Gartner, Forrester, and Paradigm B2B, Algolia
  helps enterprises turn search into a growth engine...") selected instead of the page's own
  content. It is complete, specific, grammatical prose, so no shape-based check can reject it --
  it is simply not about the page it is on. The only signal that separates it from real content is
  that it appears on MANY pages, which is invisible from inside a single record.

THE TRAP THIS ENCODES, measured on the 50 cached pages
  Counting raw URLs, 166 prose sentences appeared on 3+ pages and looked like boilerplate. They
  were not: algolia.com serves UNTRANSLATED English content at /de/ and /fr/ paths, so one article
  yields byte-identical text at three URLs. Stripping the locale prefix collapses those to one
  path and the 166 drop to 11. Counting URLs instead of paths would have quarantined real content.

  And the threshold must be a FRACTION of the corpus, not a count. At 29 canonical paths the
  boilerplate sat at 9-12 paths and legitimate shared REST-API text ("All requests must use
  HTTPS.") sat at 3. An absolute threshold of 9 works there and is badly wrong at 6,000 paths,
  where 9 pages is 0.15% -- a shared section, not site-wide furniture.

    python3 -m pytest docs/operations/enrichment/tests/test_boilerplate.py -q
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest  # noqa: E402

from boilerplate import (  # noqa: E402
    MIN_PATHS_TO_JUDGE,
    build_map,
    canonical_path,
    norm_key,
)
from candidates import split_candidates  # noqa: E402

# The real block, verbatim from /resources/asset/infographic-unlock-the-power-of-agentic-ai.
PROMO = (
    "Recognized by IDC, Gartner, Forrester, and Paradigm B2B, Algolia helps enterprises turn "
    "search into a growth engine for AI-native experiences."
)
# Real per-page content, from the same corpus.
UNIQUE_A = "Crocs transformed product discovery across its global sites with Algolia."
UNIQUE_B = "Dawn Foods moved from greenfield to a MACH architecture with Algolia Search."
# Legitimately shared REST-API text. The judge ASKED for the HTTPS line as a missing highlight,
# so this must survive on 3-of-30 pages.
SHARED_DOC = "All requests must use HTTPS."


def page(path, *sentences):
    return path, "\n\n".join(s if s.endswith(".") else s + "." for s in sentences)


def corpus_of(n_unique, promo_on, shared_on):
    """n_unique filler paths; PROMO on the first `promo_on`; SHARED_DOC on the first `shared_on`."""
    out = []
    for i in range(n_unique):
        sents = [f"Page {i} describes a distinct Algolia capability in its own words here."]
        if i < promo_on:
            sents.append(PROMO)
        if i < shared_on:
            sents.append(SHARED_DOC)
        out.append(page(f"/page-{i}", *sents))
    return out


# ---------------------------------------------------------------------------
# locale collapsing — the trap
# ---------------------------------------------------------------------------

def test_locale_prefix_is_stripped():
    assert canonical_path("/de/customers/crocs") == "/customers/crocs"
    assert canonical_path("/fr/customers/crocs") == "/customers/crocs"
    assert canonical_path("/customers/crocs") == "/customers/crocs"
    assert canonical_path("/pt-br/blog/x") == "/blog/x"


def test_a_locale_prefix_is_not_stripped_from_a_content_slug():
    """'/definitions/...' starts with 'de' but is not a locale. A prefix match without the
    boundary would silently rewrite real paths."""
    assert canonical_path("/definitions/search") == "/definitions/search"
    assert canonical_path("/de") == "/de"


def test_untranslated_content_across_locales_is_not_boilerplate():
    """The 166-sentence false positive, as a test. One article, three locale URLs, same text."""
    pages = [("/de/blog/world-cup", UNIQUE_A), ("/fr/blog/world-cup", UNIQUE_A),
             ("/blog/world-cup", UNIQUE_A)]
    pages += corpus_of(MIN_PATHS_TO_JUDGE, 0, 0)
    bp = build_map(pages)
    assert norm_key(UNIQUE_A) not in bp, "untranslated content flagged as boilerplate"


# ---------------------------------------------------------------------------
# the detection itself
# ---------------------------------------------------------------------------

def test_site_wide_promo_block_is_detected():
    n = 30
    bp = build_map(corpus_of(n, promo_on=int(n * 0.5), shared_on=0))
    assert norm_key(PROMO) in bp


def test_per_page_content_is_never_detected():
    bp = build_map(corpus_of(30, promo_on=15, shared_on=0) + [page("/x", UNIQUE_B)])
    assert norm_key(UNIQUE_B) not in bp


def test_legitimately_shared_doc_text_survives_a_small_share():
    """'All requests must use HTTPS.' on 3 of 30 paths must NOT be called boilerplate.

    Run1's judge named this exact line as a highlight the extraction had wrongly omitted.
    """
    bp = build_map(corpus_of(30, promo_on=15, shared_on=3))
    assert norm_key(SHARED_DOC) not in bp
    assert norm_key(PROMO) in bp, "...while the real boilerplate on the same corpus IS caught"


def test_threshold_is_a_fraction_not_a_count():
    """Same absolute count, different corpus size -> different verdict. This is the whole point."""
    small = build_map(corpus_of(30, promo_on=9, shared_on=0))
    large = build_map(corpus_of(300, promo_on=9, shared_on=0))
    assert norm_key(PROMO) in small, "9 of 30 paths is site-wide furniture"
    assert norm_key(PROMO) not in large, "9 of 300 paths is a shared section, not furniture"


def test_map_refuses_to_judge_a_corpus_too_small_to_judge():
    """With a handful of pages, 'appears on half of them' means nothing. Fail safe: flag nothing."""
    bp = build_map(corpus_of(4, promo_on=4, shared_on=0))
    assert bp == {}, bp


# ---------------------------------------------------------------------------
# wiring into the menu
# ---------------------------------------------------------------------------

def test_candidate_is_labelled_boilerplate_when_the_map_says_so():
    text = f"{UNIQUE_A}\n\n{PROMO}\n"
    plain, _ = split_candidates(text)
    assert [c.kind for c in plain] == ["prose", "prose"], "no map -> shape only"

    flagged, _ = split_candidates(text, boilerplate={norm_key(PROMO)})
    kinds = {c.text[:20]: c.kind for c in flagged}
    assert kinds[UNIQUE_A[:20]] == "prose"
    assert kinds[PROMO[:20]] == "boilerplate"


def test_boilerplate_is_labelled_in_the_menu_not_removed():
    """Same principle as [UI]: label it, never silently drop it. A page that is ALL boilerplate
    must still produce a menu, so the model can honestly return THIN."""
    from candidates import render_menu
    cands, _ = split_candidates(f"{UNIQUE_A}\n\n{PROMO}\n", boilerplate={norm_key(PROMO)})
    menu = render_menu(cands)
    assert "[BOILERPLATE]" in menu
    assert PROMO[:40] in menu, "the text is still shown, just marked"


# ---------------------------------------------------------------------------
# the real corpus
# ---------------------------------------------------------------------------

CACHE = os.path.join(os.path.dirname(__file__), "..", "cache-fresh50")


@pytest.mark.skipif(not os.path.isdir(CACHE), reason="cache-fresh50 is gitignored")
def test_real_corpus_flags_the_furniture_and_spares_the_content():
    import glob
    import json

    pages = []
    for path in sorted(glob.glob(os.path.join(CACHE, "*.json"))):
        with open(path) as fh:
            rec = json.load(fh)
        if isinstance(rec, dict) and len(rec.get("markdown") or "") >= 200:
            pages.append((rec["url"], rec["markdown"]))
    assert len(pages) == 50
    bp = build_map(pages)

    joined = " || ".join(bp)
    # the four furniture families that dominate the >=9-path band, in three languages
    for must in ["gartner", "cookies", "assistance", "forrester"]:
        assert must in joined, f"{must!r} boilerplate not detected; got {len(bp)} entries"
    # and it must stay small -- this is furniture, not content
    assert len(bp) < 60, f"{len(bp)} entries flagged; that is too many to be furniture"
