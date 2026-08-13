"""The page's main-content RANGE: where scoping starts, and where the boilerplate begins.

Both ends are POSITIONAL, computed on the raw markdown before anything is split, and both were
found by measuring the full 690-record Website/press-release run rather than by reading code.

Every fixture in this file is the SHAPE of a real page in the corpus, not an invented one. The
false-positive cases matter more than the true ones: the phrases that open a boilerplate block
are also ordinary German and French prepositions, and a rule that cannot tell them apart deletes
articles.
"""
from __future__ import annotations

import re

from algolia_enrichment.candidates import (KIND_PROSE, boilerplate_block_start,
                                           main_content_start, split_candidates)
from algolia_enrichment.profiles import build_profile

OPENERS = tuple(re.compile(p) for p in (
    r"About\s+", r"A propos d[e’']\s*", r"À propos d[e’']\s*", r"Uber\s+", r"Über\s+",
    r"(Media|Press) (Contact|Inquiries)", r"Forward[- ]looking statements",
    r"Zukunftsgerichtete Aussagen", r"SOURCE Algolia"))


# --- where the main content starts -----------------------------------------------------------

def test_h2_headline_is_the_content_start_because_press_releases_have_no_h1():
    """754 of 780 cached press releases head their page with an H2, not an H1.

    The detector accepted only H1, so it returned 0 -- and 0 means no scoping at all, which put
    the nav, the cookie banner and the Ask-AI overlay into the candidate menu. 34 records of the
    real run stored the overlay's own sample questions as enrichment.
    """
    md = ("[ Brand guidelines ](https://algolia.frontify.com/)\n"
          "✨ How will Algolia improve our search experience and conversions?\n"
          "##  Algolia Named a Leader in the G2 Grid Report\n"
          "SAN FRANCISCO, May 8 -- Algolia today announced the results.\n")
    start = main_content_start(md)
    assert md[start:].startswith("##  Algolia Named a Leader")
    assert "Brand guidelines" not in md[start:]
    assert "✨ How will Algolia" not in md[start:]


def test_end_of_release_marker_is_not_a_heading():
    """`# # #` is the traditional END-OF-RELEASE marker and it sits AFTER the article.

    It matched the old `^#[ \\t]+\\S` detector on 12 real pages, so content_start landed past the
    whole body and the only prose left in the menu was the boilerplate. A heading has to contain
    at least one word character of its own.
    """
    md = ("##  Algolia CEO Wins STEVIE Award\n"
          "The award recognises outstanding achievement in business leadership.\n"
          "# # #\n"
          "Note to editors\n")
    start = main_content_start(md)
    assert md[start:].startswith("##  Algolia CEO Wins")


def test_h1_still_wins_when_the_page_has_one():
    """Blog and customer-stories pages lead with a real H1 and must be untouched by the H2
    relaxation -- measured unchanged across all 426 blog and 278 case-study cached pages."""
    md = "site furniture\n#  A Real Blog Title\n## A subheading\nBody text follows here.\n"
    assert md[main_content_start(md):].startswith("#  A Real Blog Title")


def test_a_hash_inside_fenced_code_is_not_a_heading():
    md = "intro line\n```\n# not a heading, a shell comment\n```\n## The Real Heading\nbody\n"
    assert md[main_content_start(md):].startswith("## The Real Heading")


# --- where the boilerplate block starts ------------------------------------------------------

def test_bold_label_opens_the_block_even_though_it_is_not_a_heading():
    """`**Über Algolia**` is bold emphasis, so the splitter never opens a section there and
    `cand.section` returns the ARTICLE'S headline. That is why this test is positional."""
    md = ("##  Algolia gewinnt den Award\n"
          "Die Auszeichnung wurde gestern verliehen.\n"
          "**Über Algolia**\nAlgolia ist ein führender Anbieter von KI-Suchlösungen.\n")
    hit = boilerplate_block_start(md, OPENERS)
    assert hit is not None
    assert md[hit[0]:].startswith("Über Algolia**")
    assert hit[1] == "bold-close"


def test_label_fused_onto_the_previous_paragraph_is_still_found():
    """The raw markdown fuses the label onto the end of the preceding sentence, so the
    boilerplate is never at position 0 of its candidate and a `^`-anchored pattern can never
    match it. Requiring the label to open its line rejected 36 real boilerplate blocks."""
    md = ("##  Headline\n"
          "For more information visit https://example.com/partners About Algolia: Algolia is "
          "the leading AI Search and Retrieval platform.\n")
    hit = boilerplate_block_start(md, OPENERS)
    assert hit is not None
    assert md[hit[0]:].startswith("About Algolia:")


def test_the_block_restating_its_own_name_is_evidence():
    """"About Algolia Algolia is..." -- the label, then the block's first sentence naming the
    company again. The name reader must stop at the repeat instead of swallowing it."""
    md = "##  Headline\nBody.\nAbout Algolia Algolia is the leading AI Search platform.\n"
    hit = boilerplate_block_start(md, OPENERS)
    assert hit is not None and hit[1] == "name-repeat"
    assert md[hit[0]:].startswith("About Algolia Algolia is")


def test_multiword_company_name_is_labelled():
    md = "##  Headline\nBody.\n**About JD Sports** Established in 1981 with a single store.\n"
    hit = boilerplate_block_start(md, OPENERS)
    assert hit is not None
    assert md[hit[0]:].startswith("About JD Sports**")


def test_german_preposition_in_a_headline_is_not_boilerplate():
    """THE case that makes the evidence requirement necessary.

    "Über Modell-Benchmarks hinaus:" is a real page's own headline, 20% into the document. A
    phrase-only rule cuts 79% of that article away. `hinaus` sits between the capitalised token
    and the colon, so there is no label evidence and the phrase is correctly ignored.
    """
    md = ("##  Über Modell-Benchmarks hinaus: Xavier Grand nimmt am AI Day France teil\n"
          "Auf dem AI Day 2026 nimmt Grand gemeinsam mit Datenwissenschaftlern teil.\n")
    assert boilerplate_block_start(md, OPENERS) is None


def test_the_ride_company_in_a_biography_is_not_boilerplate():
    """"Uber für 3,1 Milliarden Dollar" -- a real sentence in a real executive biography."""
    md = ("##  Algolia Appoints Peter Minev\n"
          "Er leitete die Übernahme, die Uber für 3,1 Milliarden Dollar beitrug.\n")
    assert boilerplate_block_start(md, OPENERS) is None


def test_ordinary_german_uber_prose_is_not_boilerplate():
    md = ("##  Headline\n"
          "Über ein Drittel der Befragten gab an, dass sie personalisierte Angebote wollen.\n")
    assert boilerplate_block_start(md, OPENERS) is None


def test_earliest_qualifying_label_wins_so_customer_blocks_go_too():
    """A release carries the customer's boilerplate before Algolia's. Both must leave."""
    md = ("##  Headline\nBody sentence.\n"
          "**About Breville** Since its inception 90 years ago, Breville has grown.\n"
          "**About Algolia** Algolia is the leading AI Search platform.\n")
    hit = boilerplate_block_start(md, OPENERS)
    assert md[hit[0]:].startswith("About Breville**")


def test_no_openers_means_no_exclusion():
    """Every profile except press-release supplies an empty list and must be unaffected."""
    md = "##  Headline\nBody.\n**About Algolia** Algolia is the leading AI Search platform.\n"
    assert boilerplate_block_start(md, ()) is None


# --- the two ends, wired into the splitter ---------------------------------------------------

def test_split_candidates_drops_the_shell_and_the_boilerplate_but_keeps_the_article():
    md = ("[ Download logo pack ](https://www.algolia.com/algolia-logo-pack.zip)\n"
          "✨ How will Algolia improve our search experience and conversions?\n"
          "##  Algolia Brings Agentic Commerce to the Modern Storefront\n"
          "SAN FRANCISCO, May 8 -- Algolia today announced a new context layer for "
          "intelligent agents on platforms such as Salesforce and Adobe.\n"
          "The company said the layer is available to all customers from today onwards.\n"
          "**About Algolia** Algolia is the leading AI Search and Retrieval platform, "
          "powering 1.75 trillion searches a year for more than 18,000 businesses.\n")
    start = main_content_start(md)
    end = boilerplate_block_start(md, OPENERS)[0]
    cands, _ = split_candidates(md, content_start=start, content_end=end)
    texts = " ".join(c.text for c in cands)

    assert "context layer for intelligent agents" in texts
    assert "available to all customers" in texts
    assert "Download logo pack" not in texts
    assert "How will Algolia improve" not in texts
    assert "1.75 trillion searches" not in texts
    assert "leading AI Search and Retrieval platform" not in texts


def test_boilerplate_sentences_carrying_no_trigger_phrase_are_excluded_too():
    """The whole point. This sentence names no company and is flawless prose, so no pattern
    matched against the candidate itself can ever refute it -- only its position can."""
    md = ("##  Headline\n"
          "Algolia today announced the results of its annual ecommerce search report.\n"
          "**About Algolia** Algolia is a leading provider of AI search solutions. "
          "Renowned for its user-friendly API-First platform and the fastest AI search "
          "technology, Algolia is the largest hosted search engine.\n")
    end = boilerplate_block_start(md, OPENERS)[0]
    cands, _ = split_candidates(md, content_start=main_content_start(md), content_end=end)
    prose = [c.text for c in cands if c.kind == KIND_PROSE]
    assert any("annual ecommerce search report" in t for t in prose)
    assert not any("Renowned for its user-friendly" in t for t in prose)


def test_content_end_none_leaves_the_page_whole():
    md = "##  Headline\nA sentence that is comfortably longer than the minimum candidate size.\n"
    a, _ = split_candidates(md, content_start=main_content_start(md), content_end=None)
    b, _ = split_candidates(md, content_start=main_content_start(md))
    assert [c.text for c in a] == [c.text for c in b]


def test_a_banned_word_in_the_headline_does_not_kill_the_whole_page():
    """The regression that shipped green because nothing drove this shape.

    `forbidden_patterns` were briefly matched against `cand.section` as well as `cand.text`.
    `section` is the article's own headline, so a real German page headed "Über Modell-Benchmarks
    hinaus: ..." matched the "Über" ban on every candidate it had and lost all 14 -- an entire
    page deleted for a preposition. Patterns match the candidate's own text, and nothing else.
    """
    from algolia_enrichment.filters import filter_pool
    md = ("##  Über Modell-Benchmarks hinaus: Xavier Grand nimmt am AI Day France teil\n"
          "Auf dem AI Day 2026 nimmt Grand gemeinsam mit Datenwissenschaftlern von Mirakl teil.\n"
          "Grands Vortrag findet von 12:20 bis 12:35 Uhr im Workshop-Bereich statt.\n")
    bans = (re.compile(r"Über [A-Z][\w&.-]{1,40}"),)
    cands, _ = split_candidates(md, content_start=main_content_start(md))
    kept, _, _ = filter_pool(cands, extra_patterns=bans)
    assert [c.text for c in kept if c.kind == KIND_PROSE], "the article's own body was deleted"


# --- the profile carries the list ------------------------------------------------------------

def _profile(**extra):
    data = {
        "source": "Website", "page_type": "press-release", "strategy": "press_release",
        "abstract_shape": "announcement_summary", "language_policy": "must_match_record",
        "min_body_chars": 700, "abstract_span_count": [2, 3], "highlight_count": [3, 5],
        "duplicate_description_policy": "ban", "judge_required": True,
        "coverage_target_pct": 0.85, "max_human_review_open_pct": 0.05,
        "human_review_after_attempts": 2, "minimum_review_sample": 20,
        "allowed_terminal_verdicts": ["REAL"],
    }
    data.update(extra)
    return build_profile(data)


def test_profile_compiles_its_block_openers():
    prof = _profile(boilerplate_block_openers=["About\\s+", "Über\\s+"])
    assert [p.pattern for p in prof.compiled_block_openers] == ["About\\s+", "Über\\s+"]


def test_profile_defaults_to_no_block_openers():
    assert _profile().compiled_block_openers == ()


def test_a_bad_block_opener_regex_is_refused_at_load_time():
    import pytest
    from algolia_enrichment.profiles import ProfileError
    with pytest.raises(ProfileError, match="boilerplate_block_openers"):
        _profile(boilerplate_block_openers=["About(\\s+"])
