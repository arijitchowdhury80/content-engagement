#!/usr/bin/env python3
"""
Tests for span_gate — the zero-hallucination guarantee.

The important tests are the ADVERSARIAL ones: a paraphrase, an invented number, an
invented customer name. Those must be impossible to get through, and the test suite is
the only thing that proves the claim rather than asserting it.

    python3 -m pytest docs/operations/enrichment/tests/test_span_gate.py -q
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest  # noqa: E402

from span_gate import (  # noqa: E402
    SpanRejected,
    canonicalise,
    check_information_gain,
    check_integrity,
    check_no_fabricated_tokens,
    check_subject_present,
    locate,
    prose_chars,
    run_gates,
)

# A realistic page: markdown emphasis, a link, a hard-wrapped sentence, a code fence.
PAGE = """# Value Engineering

Value Engineering is a **free service** for qualifying Algolia ecommerce
customers. It helps you estimate the [business impact](/doc/impact) of search
before you commit.

## Requirements

- You must have at least 90 days of click and conversion events.
- Available in English only.

```python
client.get_impact(index="products")
```

Teams typically see a 12% lift in conversion after the first review.
"""

TITLE = "Value Engineering"
DESCRIPTION = "Estimate the business impact of Algolia using your product and event data."


# ---------------------------------------------------------------------------
# canonicalisation
# ---------------------------------------------------------------------------

def test_canonicalise_strips_emphasis_but_keeps_words():
    c = canonicalise("**NeuralSearch** is `fast`")
    assert c.text == "NeuralSearch is fast"


def test_canonicalise_keeps_underscores_for_snake_case_identifiers():
    # 4,392 reference records depend on identifiers surviving intact
    c = canonicalise("Set `attributes_to_retrieve` to control the payload.")
    assert "attributes_to_retrieve" in c.text


def test_canonicalise_unwraps_links_to_label_only():
    c = canonicalise("see the [business impact](/doc/impact) report")
    assert c.text == "see the business impact report"


def test_canonicalise_collapses_hard_wraps():
    c = canonicalise("one\ntwo   three\n\nfour")
    assert c.text == "one two three four"


def test_canonicalise_strips_furniture_on_every_line_not_just_the_first():
    """REGRESSION. A live algolia.com /doc page exposed this: the furniture regex was
    `^`-anchored, so it fired on line 1 and silently never again, leaving `>` and `##`
    inside stored abstracts. Found on real data after 31 fixture tests passed."""
    src = "> ## Documentation Index\n> Fetch the index at /llms.txt\n> Use this file first.\n"
    c = canonicalise(src)
    assert "#" not in c.text
    assert ">" not in c.text
    assert c.text == "Documentation Index Fetch the index at /llms.txt Use this file first."


def test_canonicalise_strips_stacked_furniture_and_table_pipes():
    c = canonicalise("| name | required |\n- item one\n1. step one\n")
    assert "|" not in c.text
    assert not c.text.startswith("-")
    assert "item one" in c.text and "step one" in c.text
    # cells must not fuse into a false compound word
    assert "name required" in c.text and "namerequired" not in c.text


def test_canonicalise_keeps_hyphens_and_dashes_inside_a_sentence():
    c = canonicalise("Use server-side rendering for first-paint speed.")
    assert c.text == "Use server-side rendering for first-paint speed."


def test_canonicalise_offsets_map_back_to_original():
    c = canonicalise("**Algolia** is fast")
    pos = c.text.find("Algolia")
    stored, start, end = c.slice_original(pos, pos + len("Algolia"))
    assert stored == "Algolia"
    assert PAGE[0:0] == ""  # sanity, no accidental global state


# ---------------------------------------------------------------------------
# G1 — the guarantee
# ---------------------------------------------------------------------------

def test_locate_accepts_span_whose_whitespace_differs_from_source():
    """The source hard-wraps mid-sentence; the model writes it with a single space.
    This is faithful and MUST be accepted, or most of the corpus is quarantined."""
    source = canonicalise(PAGE)
    span = "Value Engineering is a free service for qualifying Algolia ecommerce customers."
    got = locate(span, source)
    assert got.stored_text.startswith("Value Engineering is a free service")


def test_locate_returns_text_sliced_from_source_not_from_model():
    """The stored value must come out of the page. The model's string is discarded."""
    source = canonicalise(PAGE)
    # model drops the markdown emphasis, as every model will
    span = "Value Engineering is a free service for qualifying Algolia ecommerce customers."
    got = locate(span, source)
    assert got.original_text in PAGE  # provably lifted from the page
    assert PAGE[got.start:got.end] == got.original_text


def test_locate_rejects_a_paraphrase():
    """Same meaning, different words. This is the whole point."""
    source = canonicalise(PAGE)
    with pytest.raises(SpanRejected):
        locate("Value Engineering is a complimentary offering for Algolia retail clients.", source)


def test_locate_rejects_an_invented_sentence():
    source = canonicalise(PAGE)
    with pytest.raises(SpanRejected):
        locate("Value Engineering is available in twelve languages worldwide.", source)


def test_locate_rejects_a_real_sentence_with_one_word_changed():
    source = canonicalise(PAGE)
    with pytest.raises(SpanRejected):
        locate("Value Engineering is a paid service for qualifying Algolia ecommerce customers.", source)


def test_locate_rejects_text_from_a_different_page():
    source = canonicalise(PAGE)
    with pytest.raises(SpanRejected):
        locate("Algolia Recommend surfaces related products on your PDP.", source)


def test_locate_reports_multiple_occurrences():
    source = canonicalise("Alpha beta. Gamma. Alpha beta.")
    got = locate("Alpha beta", source)
    assert got.occurrences == 2


# ---------------------------------------------------------------------------
# G2 — fabricated numbers and entities
# ---------------------------------------------------------------------------

def test_g2_passes_when_numbers_are_from_the_page():
    source = canonicalise(PAGE)
    assert check_no_fabricated_tokens(["Teams typically see a 12% lift in conversion"], source) == []


def test_g2_catches_a_number_not_on_the_page():
    source = canonicalise(PAGE)
    bad = check_no_fabricated_tokens(["Teams typically see a 40% lift in conversion"], source)
    assert any("40" in b for b in bad)


def test_g2_catches_an_invented_customer_name():
    source = canonicalise(PAGE)
    bad = check_no_fabricated_tokens(["Used by Lacoste and Gymshark"], source)
    assert "Lacoste" in bad or "Gymshark" in bad


# ---------------------------------------------------------------------------
# G3 / G4 / G6 / G7
# ---------------------------------------------------------------------------

def test_g3_rejects_a_span_nested_in_another():
    errs = check_integrity(["Algolia is fast and reliable."], ["Algolia is fast"], (1, 3))
    assert any("nested" in e for e in errs)


def test_g3_rejects_duplicates():
    errs = check_integrity(["Algolia is fast."], ["Algolia is fast."], (1, 3))
    assert any("duplicate" in e for e in errs)


def test_g3_enforces_family_span_range():
    errs = check_integrity(["a", "b", "c", "d"], [], (1, 3))
    assert any("outside family range" in e for e in errs)


def test_g4_rejects_a_context_free_opener():
    errs = check_subject_present("It also supports faceting and filtering.", TITLE)
    assert errs


def test_g4_accepts_a_span_naming_its_subject():
    assert check_subject_present("Value Engineering is a free service.", TITLE) == []


def test_g6_rejects_chrome_and_self_reference():
    from span_gate import check_blacklists
    assert check_blacklists(["We use cookies to improve your experience."])
    assert check_blacklists(["In this guide we will configure faceting."])


def test_g7_rejects_an_abstract_that_only_restates_the_description():
    """3,340 records in this index already have abstract == description byte-for-byte."""
    errs = check_information_gain(DESCRIPTION, TITLE, DESCRIPTION)
    assert errs


def test_g7_accepts_an_abstract_that_adds_substance():
    text = ("Value Engineering is a free service for qualifying Algolia ecommerce customers. "
            "You must have at least 90 days of click and conversion events.")
    assert check_information_gain(text, TITLE, DESCRIPTION) == []


# ---------------------------------------------------------------------------
# prose measurement — the THIN decision, made by script not by the model
# ---------------------------------------------------------------------------

def test_prose_chars_excludes_code_fences():
    with_code = prose_chars(PAGE)
    assert "client.get_impact" not in canonicalise(PAGE).text[:0] + ""
    assert with_code > 100
    code_only = "```python\n" + ("x = 1\n" * 200) + "```"
    assert prose_chars(code_only) == 0


def test_prose_chars_ignores_link_only_hub_pages():
    hub = "\n".join(f"- [Section {i}](/s/{i})" for i in range(40))
    assert prose_chars(hub) == 0


# ---------------------------------------------------------------------------
# end to end
# ---------------------------------------------------------------------------

def _llm(**over):
    base = {
        "verdict": "REAL",
        "verdict_evidence": "Value Engineering is a free service for qualifying Algolia ecommerce customers.",
        "abstract_spans": [
            "Value Engineering is a free service for qualifying Algolia ecommerce customers.",
            "It helps you estimate the business impact of search before you commit.",
        ],
        "keyhighlights_spans": [
            "You must have at least 90 days of click and conversion events.",
            "Teams typically see a 12% lift in conversion after the first review.",
        ],
        "language_observed": "en",
        "insufficient_reason": None,
    }
    base.update(over)
    return base


def test_end_to_end_pass_writes_text_lifted_from_the_page():
    r = run_gates(
        llm_output=_llm(),
        page_markdown=PAGE,
        title=TITLE,
        description=DESCRIPTION,
        family_span_range=(2, 4),
    )
    assert r.passed, r.failures
    # every stored word is on the page
    src = canonicalise(PAGE).text
    for word in r.abstract_enriched.split():
        assert word in src
    assert r.span_offsets and all(0 <= s < e <= len(PAGE) for s, e in r.span_offsets)
    assert len(r.content_hash) == 64


def test_end_to_end_quarantines_a_hallucinated_span():
    r = run_gates(
        llm_output=_llm(abstract_spans=[
            "Value Engineering is a free service for qualifying Algolia ecommerce customers.",
            "It is used by over 17,000 enterprise customers in 40 countries.",
        ]),
        page_markdown=PAGE,
        title=TITLE,
        description=DESCRIPTION,
        family_span_range=(2, 4),
    )
    assert not r.passed
    assert any("G1" in f for f in r.failures)


def test_end_to_end_dead_verdict_is_a_pass_with_no_text():
    r = run_gates(
        llm_output={
            "verdict": "DEAD",
            "verdict_evidence": "Value Engineering",
            "abstract_spans": [],
            "keyhighlights_spans": [],
            "language_observed": "en",
            "insufficient_reason": "ERROR_PAGE",
        },
        page_markdown=PAGE,
        title=TITLE,
        description=DESCRIPTION,
        family_span_range=(2, 4),
    )
    assert r.passed
    assert r.abstract_enriched == ""


def test_end_to_end_dead_verdict_with_spans_is_rejected():
    r = run_gates(
        llm_output={
            "verdict": "THIN",
            "verdict_evidence": "Value Engineering",
            "abstract_spans": ["Value Engineering is a free service for qualifying Algolia ecommerce customers."],
            "keyhighlights_spans": [],
            "language_observed": "en",
            "insufficient_reason": "NO_PROSE",
        },
        page_markdown=PAGE,
        title=TITLE,
        description=DESCRIPTION,
        family_span_range=(2, 4),
    )
    assert not r.passed


def test_end_to_end_rejects_an_invented_insufficient_reason():
    r = run_gates(
        llm_output={
            "verdict": "THIN",
            "verdict_evidence": "Value Engineering",
            "abstract_spans": [],
            "keyhighlights_spans": [],
            "language_observed": "en",
            "insufficient_reason": "PAGE_WAS_BORING",
        },
        page_markdown=PAGE,
        title=TITLE,
        description=DESCRIPTION,
        family_span_range=(2, 4),
    )
    assert not r.passed


def test_french_page_cannot_yield_english_text():
    """Locale leakage is impossible: spans can only come from the page in front of it."""
    fr = ("# Facettes dynamiques\n\nLes facettes dynamiques rearrangent les filtres selon "
          "l'intention de recherche de l'utilisateur.\n")
    source = canonicalise(fr)
    with pytest.raises(SpanRejected):
        locate("Dynamic facets reorder filters based on the user's search intent.", source)


def test_canonicalise_strips_html_and_jsx_tags():
    """algolia.com doc markdown embeds <section> and <Card title="..." /> blocks.
    Found on the live /doc/guides/getting-started/quick-start.md page."""
    c = canonicalise('<section>\n  <Card title="API reference" href="/doc/rest-api" />\n  Real prose here.\n</section>')
    assert "<" not in c.text and ">" not in c.text
    assert "Real prose here." in c.text


def test_canonicalise_does_not_swallow_a_comparison_in_prose():
    c = canonicalise("Fails when count < 5 and total > 3 on the same request.")
    assert c.text == "Fails when count < 5 and total > 3 on the same request."


def test_canonicalise_page_starting_with_a_link_does_not_split_first_word():
    """REGRESSION, same class as the tag bug: pending_space must clear even when the
    output buffer is still empty, or leading markup defers a space onto character 2."""
    c = canonicalise("[Skip to content](#main)\n\nRealtime search is enabled.")
    assert "R ealtime" not in c.text
    assert "Realtime search is enabled." in c.text


# ---------------------------------------------------------------------------
# G10 — misleading selection. Every case here is VERBATIM and still wrong.
# Found by adversarial probe after G1-G7 were passing. Build log D-011.
# ---------------------------------------------------------------------------

ADVERSARIAL = """# Algolia vs Coveo

Algolia delivers median search latency of 12ms across 1.7 trillion queries.

## What customers tell us

> "Coveo's relevance tuning took our team nine months." — VP Engineering, Acme Corp

## Common mistakes when migrating

Teams often assume vector search alone improves relevance. It does not.

## Deprecated: Enterprise Search

Enterprise Search is no longer available for new customers.

## Pricing

The Grow plan starts at $49 per month.
"""

LEAD = "Algolia delivers median search latency of 12ms across 1.7 trillion queries."


def _adversarial(spans, highs=(), family="commercial"):
    return run_gates(
        llm_output={
            "verdict": "REAL",
            "verdict_evidence": "The Grow plan starts at $49 per month.",
            "abstract_spans": list(spans),
            "keyhighlights_spans": list(highs),
            "language_observed": "en",
            "insufficient_reason": None,
        },
        page_markdown=ADVERSARIAL,
        title="Algolia vs Coveo",
        description="Compare Algolia and Coveo.",
        family_span_range=(2, 4),
        family=family,
    )


def test_canonicalise_records_section_and_quote_structure():
    c = canonicalise(ADVERSARIAL)
    assert any("Deprecated" in s for s in c.sections)
    pos = c.text.find("Coveo's relevance tuning")
    assert c.quoted[pos] is True
    assert "What customers tell us" in c.section_title(pos)


def test_g10_rejects_a_blockquote_attributed_to_someone_else():
    r = _adversarial([LEAD, '"Coveo\'s relevance tuning took our team nine months."'])
    assert not r.passed
    assert any("quotation" in f for f in r.failures)


def test_g10_allows_a_quote_for_the_evidence_family():
    r = _adversarial([LEAD, '"Coveo\'s relevance tuning took our team nine months."'],
                     family="evidence")
    assert not any("quotation" in f for f in r.failures)


def test_g10_rejects_a_span_the_page_immediately_contradicts():
    """Next sentence is 'It does not.' Dropping it inverts the meaning. Sharpest case."""
    r = _adversarial([LEAD, "Teams often assume vector search alone improves relevance."])
    assert not r.passed
    assert any("reversal" in f for f in r.failures)


def test_g10_rejects_a_span_from_a_deprecated_section():
    r = _adversarial([LEAD, "Enterprise Search is no longer available for new customers."])
    assert not r.passed
    assert any("excluded section" in f for f in r.failures)


def test_g10_rejects_an_abstract_stitched_across_too_many_sections():
    """Limit raised 2 -> 4 on pilot evidence (legitimate abstracts used 3 and 4 sections).
    5 distinct sections still fails."""
    page = "".join(f"## Section {i}\n\nAlgolia statement number {i} about search relevance.\n\n"
                   for i in range(6))
    r = run_gates(
        llm_output={"verdict": "REAL",
                    "verdict_evidence": "Algolia statement number 0 about search relevance.",
                    "abstract_spans": [f"Algolia statement number {i} about search relevance."
                                       for i in range(5)],
                    "keyhighlights_spans": [], "language_observed": "en",
                    "insufficient_reason": None},
        page_markdown=page, title="Sections", description="A page of sections.",
        family_span_range=(2, 5), family="commercial")
    assert any("different sections" in f for f in r.failures), r.failures


def test_g10_rejects_spans_stitched_from_far_apart_in_a_long_page():
    long_page = ("# Product\n\nAlgolia Recommend surfaces related products on your PDP.\n\n"
                 + ("Filler sentence about configuration. " * 900)
                 + "\n\nThe Enterprise plan includes a dedicated cluster.\n")
    r = run_gates(
        llm_output={"verdict": "REAL",
                    "verdict_evidence": "Algolia Recommend surfaces related products on your PDP.",
                    "abstract_spans": ["Algolia Recommend surfaces related products on your PDP.",
                                       "The Enterprise plan includes a dedicated cluster."],
                    "keyhighlights_spans": [], "language_observed": "en",
                    "insufficient_reason": None},
        page_markdown=long_page, title="Product", description="Algolia product overview.",
        family_span_range=(2, 4), family="commercial")
    assert not r.passed
    assert any("characters of the original page" in f for f in r.failures)


def test_g10_does_not_reject_a_legitimate_intro_plus_detail_abstract():
    """The gate must not be so strict that normal abstracts fail."""
    page = ("# Dynamic Facets\n\nDynamic facets reorder filters based on query intent.\n"
            "They require at least 1,000 search events before taking effect.\n")
    r = run_gates(
        llm_output={"verdict": "REAL",
                    "verdict_evidence": "Dynamic facets reorder filters based on query intent.",
                    "abstract_spans": ["Dynamic facets reorder filters based on query intent.",
                                       "They require at least 1,000 search events before taking effect."],
                    "keyhighlights_spans": [], "language_observed": "en",
                    "insufficient_reason": None},
        page_markdown=page, title="Dynamic Facets",
        description="Reorder filters automatically.",
        family_span_range=(2, 4), family="reference")
    assert r.passed, r.failures


# ---------------------------------------------------------------------------
# FALSE-REJECTION regressions. All four found in the 30-record pilot, where the
# model was faithful every time and canonicalisation was wrong. Build log D-013.
# ---------------------------------------------------------------------------

def test_curly_apostrophe_matches_straight_apostrophe():
    """Biggest false-rejection source in the pilot: one page lost all 3 spans to this."""
    source = canonicalise("Algolia’s API-first approach lets you work fast.")
    got = locate("Algolia's API-first approach lets you work fast.", source)
    assert got.original_text.startswith("Algolia’s")   # stored text keeps the page's own char


def test_curly_quotes_and_dashes_match_ascii():
    source = canonicalise("“Fast” search — always. Every product’s test cases.")
    assert locate('"Fast" search - always.', source)
    assert locate("Every product's test cases.", source)


def test_space_before_comma_matches_no_space():
    """algolia.com's own prose: `percentage points , with users`. Models fix it silently."""
    source = canonicalise("Clickthrough improved by 10 to 15 percentage points , with users reaching results.")
    got = locate("Clickthrough improved by 10 to 15 percentage points, with users reaching results.", source)
    assert "percentage points" in got.stored_text


def test_link_label_wrapped_across_a_newline_is_unwrapped():
    """algolia.com OpenAPI descriptions wrap inside the label: `[user\\n token](url)`.
    Rejecting those left raw markdown syntax in the canonical text."""
    source = canonicalise(
        "Maximum requests allowed per IP address or [user\n            "
        "token](https://www.algolia.com/doc/guides/x) per hour."
    )
    assert "[" not in source.text and "](" not in source.text
    assert locate("Maximum requests allowed per IP address or user token per hour.", source)


def test_folding_keeps_offsets_exact():
    """Every fold must be 1:1 or the canonical->original offset map silently skews."""
    original = "The “Grow” plan — Algolia’s entry tier — starts at $49."
    c = canonicalise(original)
    pos = c.text.find("Grow")
    stored, start, end = c.slice_original(pos, pos + 4)
    assert stored == "Grow"
    assert original[start:end] == "Grow"


def test_folding_does_not_merge_distinct_words():
    c = canonicalise("re-use versus re‑use")   # hyphen vs non-breaking hyphen
    assert c.text == "re-use versus re-use"


# ---------------------------------------------------------------------------
# Pilot-driven threshold changes. Each keeps the gate's PURPOSE while removing a
# limit set by guesswork. Build log D-014.
# ---------------------------------------------------------------------------

LEDE_PAGE = ("> ## Documentation Index\n> Fetch the index at /llms.txt\n\n"
             "# Usage API\n\n> The Usage API lets you retrieve various usage statistics "
             "regarding your Algolia applications.\n\n"
             "Any unspecified attribute resets that attribute to its default value.\n")


def test_blockquoted_lede_is_the_pages_own_voice_and_is_allowed():
    """4,392 records depend on this: every /doc page blockquotes its own summary."""
    r = run_gates(
        llm_output={"verdict": "REAL",
                    "verdict_evidence": "Any unspecified attribute resets that attribute to its default value.",
                    "abstract_spans": ["The Usage API lets you retrieve various usage statistics regarding your Algolia applications."],
                    "keyhighlights_spans": ["Any unspecified attribute resets that attribute to its default value."],
                    "language_observed": "en", "insufficient_reason": None},
        page_markdown=LEDE_PAGE, title="Usage API",
        description="Retrieve usage statistics.", family_span_range=(1, 3), family="reference")
    assert not any("quotation" in f for f in r.failures), r.failures


def test_real_quotation_with_speech_marks_is_still_blocked():
    page = ('# Algolia vs Coveo\n\nAlgolia delivers fast search.\n\n## Testimonial\n\n'
            '> "Coveo took our team nine months to tune." — VP Engineering, Acme\n')
    r = run_gates(
        llm_output={"verdict": "REAL", "verdict_evidence": "Algolia delivers fast search.",
                    "abstract_spans": ["Algolia delivers fast search.",
                                       '"Coveo took our team nine months to tune."'],
                    "keyhighlights_spans": [], "language_observed": "en",
                    "insufficient_reason": None},
        page_markdown=page, title="Algolia vs Coveo", description="Compare.",
        family_span_range=(2, 4), family="commercial")
    assert any("quotation" in f for f in r.failures), r.failures


def test_subject_as_the_first_word_is_accepted():
    assert check_subject_present("Algolia focuses on search speed.", "Search speed") == []


def test_generic_opener_is_still_rejected():
    assert check_subject_present("It also supports faceting.", "Dynamic Widgets") != []
    assert check_subject_present("This means everything runs sooner.", "Latency") != []


def test_long_form_article_abstract_spanning_the_page_is_allowed():
    """The best abstract in the pilot was rejected by an 8,000-char guess: a blog post whose
    spans were title + thesis + conclusion, 13,545 apart."""
    page = ("# How to evaluate agents\n\nAlgolia agents need measurable quality.\n\n"
            + ("Filler paragraph about methodology. " * 380)
            + "\n\n## Measuring what matters\n\nBetter definitions of quality are required.\n")
    r = run_gates(
        llm_output={"verdict": "REAL", "verdict_evidence": "Better definitions of quality are required.",
                    "abstract_spans": ["Algolia agents need measurable quality.",
                                       "Better definitions of quality are required."],
                    "keyhighlights_spans": [], "language_observed": "en",
                    "insufficient_reason": None},
        page_markdown=page, title="How to evaluate agents",
        description="Evaluating agent output.", family_span_range=(2, 4), family="editorial")
    assert not any("characters of the page" in f for f in r.failures), r.failures


def test_mixed_language_abstract_is_rejected():
    """Real pilot case: a German record whose first sentence was English. Both genuinely on the
    page — algolia.com's localised pages carry untranslated English."""
    page = ("# Algolia vs Elasticsearch\n\n"
            "Compared with Elasticsearch, Algolia helps you deliver powerful AI search "
            "experiences with less setup and maintenance.\n\n"
            "Mit den SDKs von Algolia stehen Ihnen Such- und Browsing-Funktionen für "
            "die Nutzer zur Verfügung.\n")
    r = run_gates(
        llm_output={"verdict": "REAL",
                    "verdict_evidence": "Mit den SDKs von Algolia stehen Ihnen Such- und Browsing-Funktionen für die Nutzer zur Verfügung.",
                    "abstract_spans": ["Compared with Elasticsearch, Algolia helps you deliver powerful AI search experiences with less setup and maintenance.",
                                       "Mit den SDKs von Algolia stehen Ihnen Such- und Browsing-Funktionen für die Nutzer zur Verfügung."],
                    "keyhighlights_spans": [], "language_observed": "de",
                    "insufficient_reason": None},
        page_markdown=page, title="Algolia vs Elasticsearch", description="Vergleich.",
        family_span_range=(2, 4), family="commercial")
    assert any("mixes languages" in f for f in r.failures), r.failures


def test_over_long_highlight_is_dropped_not_fatal():
    """A single long German testimonial was killing records whose abstract was fine."""
    long_quote = "Algolia hilft uns dabei, " + ("die Genauigkeit unserer Suchergebnisse zu verbessern. " * 8)
    page = ("# SmartBuyGlasses\n\nSmartBuyGlasses is a global eyewear retailer.\n"
            "The company implemented Algolia across 30 country storefronts and cut its "
            "zero-result rate substantially during the first quarter.\n\n" + long_quote + "\n")
    r = run_gates(
        llm_output={"verdict": "REAL", "verdict_evidence": "SmartBuyGlasses is a global eyewear retailer.",
                    "abstract_spans": ["SmartBuyGlasses is a global eyewear retailer.",
                                       "The company implemented Algolia across 30 country storefronts and cut its zero-result rate substantially during the first quarter."],
                    "keyhighlights_spans": [long_quote.strip()],
                    "language_observed": "en", "insufficient_reason": None},
        page_markdown=page, title="SmartBuyGlasses",
        description="Eyewear retailer case study.", family_span_range=(2, 4), family="evidence")
    assert r.passed, r.failures
    assert r.dropped_highlights == 1
    assert r.keyhighlights_enriched == []


def test_g11_drops_navigation_labels_as_highlights():
    """Found by Arijit reviewing the pack: /doc/ui-libraries gave 5 nav link labels as
    'key points'. Verbatim, on the page, and useless in a search result."""
    page = ("# UI libraries\n\nInstantSearch is an open source UI library that lets you build "
            "search interfaces in your app using customizable widgets.\n"
            "It requires at least version 4 of the client.\n\n"
            "InstantSearch Android\nInstantSearch iOS\nReact InstantSearch\n")
    r = run_gates(
        llm_output={"verdict": "REAL",
                    "verdict_evidence": "It requires at least version 4 of the client.",
                    "abstract_spans": ["InstantSearch is an open source UI library that lets you build search interfaces in your app using customizable widgets."],
                    "keyhighlights_spans": ["InstantSearch Android", "InstantSearch iOS",
                                            "React InstantSearch",
                                            "It requires at least version 4 of the client."],
                    "language_observed": "en", "insufficient_reason": None},
        page_markdown=page, title="UI libraries",
        description="Build search interfaces with Algolia libraries.",
        family_span_range=(1, 3), family="reference")
    assert r.passed, r.failures
    assert r.keyhighlights_enriched == ["It requires at least version 4 of the client."]
    assert r.dropped_highlights == 3


def test_g11_keeps_a_short_highlight_that_carries_a_number():
    page = "# Limits\n\nAlgolia is fast.\n\nThe cap is 1,000 records per batch.\n"
    r = run_gates(
        llm_output={"verdict": "REAL", "verdict_evidence": "Algolia is fast.",
                    "abstract_spans": ["The cap is 1,000 records per batch."],
                    "keyhighlights_spans": ["The cap is 1,000 records per batch."],
                    "language_observed": "en", "insufficient_reason": None},
        page_markdown=page, title="Limits", description="Indexing limits.",
        family_span_range=(1, 3), family="reference")
    assert "1,000" in " ".join(r.keyhighlights_enriched) or r.dropped_highlights == 0


# ---------------------------------------------------------------------------
# G1 drop-and-continue. GLM-5.2 invented "10. August 2026" inside ONE highlight and
# the whole record was discarded. A fabrication should cost the span, not the page.
# ---------------------------------------------------------------------------

FAB_PAGE = ("# Events\n\nAlgolia runs developer events across the year in several cities.\n"
            "Registration for each event opens roughly eight weeks beforehand.\n\n"
            "eTail Boston 2026 Boston, MA August 2026 - 12. August 2026\n"
            "Groceryshop 2026 Las Vegas, NV September 2026\n")


def test_one_fabricated_highlight_does_not_lose_the_record():
    r = run_gates(
        llm_output={"verdict": "REAL",
                    "verdict_evidence": "Groceryshop 2026 Las Vegas, NV September 2026",
                    "abstract_spans": [
                        "Algolia runs developer events across the year in several cities.",
                        "Registration for each event opens roughly eight weeks beforehand."],
                    # the invented date GLM actually produced
                    "keyhighlights_spans": ["eTail Boston 2026 Boston, MA 10. August 2026 - 12. August 2026",
                                            "Groceryshop 2026 Las Vegas, NV September 2026"],
                    "language_observed": "en", "insufficient_reason": None},
        page_markdown=FAB_PAGE, title="Events", description="Algolia event calendar.",
        family_span_range=(2, 4), family="editorial")
    assert r.passed, r.failures
    assert r.dropped_fabrications == 1
    assert any("10. August" in s for s in r.fabricated_spans)
    # the invented text is nowhere in the output
    assert "10. August" not in " ".join(r.keyhighlights_enriched)
    assert "10. August" not in " ".join(r.abstract_spans)


def test_two_fabrications_quarantine_the_whole_record():
    r = run_gates(
        llm_output={"verdict": "REAL",
                    "verdict_evidence": "Groceryshop 2026 Las Vegas, NV September 2026",
                    "abstract_spans": [
                        "Algolia runs developer events across the year in several cities.",
                        "Registration for each event opens roughly eight weeks beforehand."],
                    "keyhighlights_spans": ["eTail Boston 2026 Boston, MA 10. August 2026 - 12. August 2026",
                                            "Groceryshop 2026 Las Vegas, NV 4. September 2026"],
                    "language_observed": "en", "insufficient_reason": None},
        page_markdown=FAB_PAGE, title="Events", description="Algolia event calendar.",
        family_span_range=(2, 4), family="editorial")
    assert not r.passed
    assert r.dropped_fabrications == 2
    assert any("not reading this page" in f for f in r.failures)


def test_fabricated_abstract_span_below_family_minimum_fails():
    r = run_gates(
        llm_output={"verdict": "REAL",
                    "verdict_evidence": "Groceryshop 2026 Las Vegas, NV September 2026",
                    "abstract_spans": [
                        "Algolia runs developer events across the year in several cities.",
                        "Algolia hosted 42 developer events in 2026 across four continents."],
                    "keyhighlights_spans": [], "language_observed": "en",
                    "insufficient_reason": None},
        page_markdown=FAB_PAGE, title="Events", description="Algolia event calendar.",
        family_span_range=(2, 4), family="editorial")
    assert not r.passed
    assert any("survived" in f for f in r.failures)


def test_invented_verdict_evidence_is_a_hard_fail():
    """If the evidence for the verdict itself is invented, the model was not reading the page."""
    r = run_gates(
        llm_output={"verdict": "REAL",
                    "verdict_evidence": "Algolia runs 500 events every single year worldwide.",
                    "abstract_spans": [
                        "Algolia runs developer events across the year in several cities.",
                        "Registration for each event opens roughly eight weeks beforehand."],
                    "keyhighlights_spans": [], "language_observed": "en",
                    "insufficient_reason": None},
        page_markdown=FAB_PAGE, title="Events", description="Algolia event calendar.",
        family_span_range=(2, 4), family="editorial")
    assert not r.passed
    assert any("verdict_evidence not on page" in f for f in r.failures)


def test_chrome_phrase_inside_a_real_sentence_is_allowed():
    """Substring matching rejected 6 legitimate records: "contact sales" appears inside real
    prose on commercial pages. A CTA is a short span that IS the phrase."""
    from span_gate import check_blacklists
    assert check_blacklists([
        "Algolia offers usage-based pricing on the Grow plan, or contact sales for volume discounts."
    ]) == []


def test_a_bare_cta_is_still_rejected():
    from span_gate import check_blacklists
    assert check_blacklists(["Contact sales"])
    assert check_blacklists(["Book a demo today"])


# ---------------------------------------------------------------------------
# G7 threshold is per-family — added 2026-08-08 after the Phase 1 gate failed
# ---------------------------------------------------------------------------

def test_information_gain_bar_is_lower_for_the_reference_family():
    """16 of 19 Phase 1 quarantines were this gate, on API pages where the title IS the endpoint.

    A bar built for blog posts was rejecting correct work on terse reference pages.
    """
    from span_gate import INFO_GAIN_MINIMUM
    assert INFO_GAIN_MINIMUM["reference"] == 3
    assert INFO_GAIN_MINIMUM.get("editorial", 8) == 8, "only reference is relaxed"


def test_reference_bar_still_rejects_a_restatement():
    """The case G7 exists for: 3,340 records already have abstract == description byte-for-byte."""
    title, desc = "Search API", "Search, configure and manage indices and records."
    assert check_information_gain(desc, title, desc, minimum=3), "a byte-identical restatement passed"


def test_reference_bar_admits_a_terse_but_real_abstract():
    title, desc = "Recommend API", "The Recommend API."
    abstract = "The Recommend API retrieves recommendations from trained models for a given object."
    assert check_information_gain(abstract, title, desc, minimum=3) == []
    # ...and the old flat bar of 8 is what was wrongly rejecting it
    assert check_information_gain(abstract, title, desc, minimum=8) != []
