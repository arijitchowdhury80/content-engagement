#!/usr/bin/env python3
"""
Tests for candidate construction — the menu the model chooses from.

WHY THESE FIXTURES ARE REAL PAGE TEXT
  SESSION.md, failure pattern #1: "31 fixture tests passed while a live bug was active. Tests
  written from the same wrong assumptions as the code cannot catch it. Only a real page did."
  So every fixture below is copied out of docs/70-enrichment/cache-fresh50/ — the same 50 pages
  the two baseline runs used — and each one is annotated with the judge complaint it reproduces.

WHAT IS BEING GUARANTEED
  Not "the model picks well". That is opinion and the judge scores it. These tests guarantee the
  MENU is honest: a countdown timer is labelled a countdown timer, a mid-sentence chop is labelled
  a fragment, and nothing is silently thrown away (Arijit: "I need every single record to be
  enriched").

    python3 -m pytest docs/70-enrichment/tests/test_candidates.py -q
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest  # noqa: E402

from candidates import (  # noqa: E402
    MAX_CHARS,
    Candidate,
    render_menu,
    split_candidates,
)

# ---------------------------------------------------------------------------
# real fixtures, each traced to the page it came from
# ---------------------------------------------------------------------------

# /de/customers/crocs — the language switcher that opens the page. Nine link labels, no sentence
# punctuation anywhere, so the old splitter merged the lot and chopped it at 400 chars.
NAV_BLOB = (
    '* [\n  * Englisch ](https://www.algolia.com/de/customers/crocs) [\n'
    '  * Deutsch ](https://www.algolia.com/de/customers/crocs "Umschalten auf ") [\n'
    '  * Französisch ](https://www.algolia.com/de/customers/crocs "Umschalten auf ") [\n'
    '  * brasilianisches Portugiesisch ](https://www.algolia.com/de/customers/crocs "Umschalten auf ") [\n'
    '  * Spanisch ](https://www.algolia.com/de/customers/crocs "Umschalten auf ") [\n'
    '  * Italienisch ](https://www.algolia.com/de/customers/crocs "Umschalten auf ") \n'
)

# /de/customers/crocs — the one sentence the judge said should have been the whole abstract.
REAL_PROSE = (
    "Mithilfe der KI-gestützten Such- und Merchandising-Funktionen von Algolia hat Crocs die "
    "Produktsuche auf seinen weltweiten Websites grundlegend verändert, wodurch das "
    "Kundenengagement gestärkt und zusätzliche Umsätze generiert wurden."
)

# /de/devcon — judge REVISE #4: "combining the countdown timer text with the welcome headline into
# a single nonsensical span". Note the markdown heading sitting inside the run.
DEVCON_BLOB = (
    "Danke!\n"
    "Ihre Anfrage wurde erfolgreich übermittelt. Wir melden uns in Kürze bei Ihnen.\n"
    "Wir sehen uns auf der DevCon in\n"
    "00 TAGE\n00 STUNDEN\n00 PROTOKOLL\n00 Sekunden\n"
    "WILLKOMMEN BEI\n"
    "## DevCon ‘26\n"
    "Tauschen Sie sich mit anderen Entwicklern aus der Community aus und lernen Sie, wie Sie "
    "moderne Sucherlebnisse für Ihre Nutzer entwickeln können.\n"
)

# academy.algolia.com/training/01944bec… — fetch_path "auth-wall" stored RAW HTML in the markdown
# field. Every slice of this is verbatim and offset-verified, and every slice is garbage.
AUTH_WALL_HTML = (
    '<!DOCTYPE html>\n<html lang="en">\n  <head>\n'
    "    <meta property='og:image' content='https://production-content.workramp.com/uploads/bb/"
    "models/academy/favicon/d3a0c036-b002-11ea-bd57-063e41907789/Academy%20favicon.png'>\n"
    '    <script nonce="">window.FLAGS={"academy_search":true,"academy_segments":true,'
    '"academy_segments_certs":true,"allow_full_editors_to_manage_folder_permissions":false,'
    '"asset_picker_search_bar":true,"attach_reports_in_emails":false,"data_viz_external":true}'
    "</script>\n  </head>\n</html>\n"
)


def kinds(cands):
    return [c.kind for c in cands]


def prose_only(cands):
    return [c for c in cands if c.kind == "prose"]


# ---------------------------------------------------------------------------
# the guarantee that must never regress: offsets still slice the real page
# ---------------------------------------------------------------------------

def test_every_candidate_original_is_an_exact_slice_of_the_page():
    """The zero-invention guarantee. Classification must not disturb offset mapping."""
    page = NAV_BLOB + "\n" + REAL_PROSE + "\n\n" + DEVCON_BLOB
    cands, _ = split_candidates(page)
    assert cands
    for c in cands:
        assert page[c.start:c.end] == c.original, f"offset drift at [{c.index}]"


def test_a_nav_only_page_offers_no_prose():
    """REVISED. The original demanded >=3 surviving candidates on a nav-only page.

    That was me protecting a number instead of a property. A page that is nothing but a language
    switcher has no content, and THIN is the honest verdict for it -- enriching it from nav text is
    exactly what produced the garbage this change exists to fix. The yield that matters is records
    enriched, and it is guarded by test_prose_yield_on_the_real_corpus below, against the 40 REAL
    verdicts the baseline runs actually produced.
    """
    cands, _ = split_candidates(NAV_BLOB)
    assert prose_only(cands) == [], [c.text[:60] for c in prose_only(cands)]


# ---------------------------------------------------------------------------
# class A — chrome offered as prose (12 of 19 REVISE records)
# ---------------------------------------------------------------------------

def test_language_switcher_is_not_prose():
    cands, _ = split_candidates(NAV_BLOB)
    assert all(k in ("ui", "nonprose") for k in kinds(cands)), kinds(cands)


def test_countdown_timer_is_never_offered_as_prose():
    """REVISED from 'must survive as a labelled candidate'. That was the wrong requirement.

    Once blocks exist, '00 TAGE' is its own block of 7 characters and falls below MIN_CHARS, so it
    is dropped outright. That satisfies the property that actually matters -- a timer can never be
    picked as prose -- more strongly than surviving with a label would. The test now asserts the
    property instead of one particular implementation of it.
    """
    cands, _ = split_candidates(DEVCON_BLOB)
    timers = [c for c in cands if "00 TAGE" in c.text or "00 STUNDEN" in c.text]
    assert all(c.kind != "prose" for c in timers), [(c.text[:40], c.kind) for c in timers]


def test_countdown_never_merges_with_the_prose_that_follows_it():
    """Judge REVISE #4, exactly. Block-awareness is what prevents this."""
    cands, _ = split_candidates(DEVCON_BLOB)
    for c in cands:
        assert not ("00 TAGE" in c.text and "Tauschen Sie sich" in c.text), (
            f"timer merged with prose: {c.text[:120]!r}")


def test_markdown_heading_is_labelled_heading_not_prose():
    cands, _ = split_candidates(DEVCON_BLOB)
    heads = [c for c in cands if "DevCon" in c.text and len(c.text) < 40]
    assert all(c.kind in ("heading", "ui") for c in heads), [(c.text, c.kind) for c in heads]


def test_real_prose_survives_as_prose():
    """The whole point. Cleaning the menu must not cost us the good sentence."""
    cands, _ = split_candidates(NAV_BLOB + "\n" + REAL_PROSE + "\n")
    keep = [c for c in cands if "Crocs die" in c.text]
    assert len(keep) == 1, [c.text[:60] for c in cands]
    assert keep[0].kind == "prose"
    assert keep[0].sentence_complete is True


# ---------------------------------------------------------------------------
# class B — mid-sentence fragments (31.6% of all candidates, measured)
# ---------------------------------------------------------------------------

def test_max_chars_chop_is_labelled_a_fragment():
    """A chop at an arbitrary word boundary is indistinguishable from a sentence today.

    Reproduces 'Within just 30 days of go-live, Crocs' and '...verändern. wie...'.
    """
    runon = "Algolia powers search for thousands of teams " * 40  # no terminal punctuation
    cands, _ = split_candidates(runon)
    assert len(cands) > 1, "an over-long block must still be split, never dropped"
    assert any(c.sentence_complete is False for c in cands)
    for c in cands:
        assert len(c.text) <= MAX_CHARS


def test_fragment_never_starts_lowercase_and_claims_to_be_prose():
    runon = ("wodurch das Kundenengagement gestärkt und zusätzliche Umsätze generiert wurden "
             * 12)
    cands, _ = split_candidates(runon)
    for c in cands:
        if c.text[:1].islower():
            assert c.kind != "prose" or c.sentence_complete is False, (
                f"lowercase-start sold as complete prose: {c.text[:60]!r}")


# ---------------------------------------------------------------------------
# the safety case — verbatim, offset-verified, and still garbage
# ---------------------------------------------------------------------------

def test_raw_html_and_json_are_never_prose():
    """auth-wall pages. 'verbatim does not mean truthful', at the candidate layer."""
    cands, _ = split_candidates(AUTH_WALL_HTML)
    assert prose_only(cands) == [], [c.text[:70] for c in prose_only(cands)]


def test_json_config_blob_is_nonprose():
    cands, _ = split_candidates(AUTH_WALL_HTML)
    blobs = [c for c in cands if '":true' in c.text or '":false' in c.text]
    assert blobs, "the flag blob must still appear as a candidate"
    assert all(c.kind == "nonprose" for c in blobs)


def test_html_attributes_never_reach_the_menu_at_all():
    """REVISED premise. I expected the og:image attribute to arrive as a labelled candidate.

    It never arrives: canonicalise() already treats an HTML tag as a separator, so the attribute is
    consumed upstream. Better than labelling it. The property worth pinning is therefore absence.
    """
    cands, _ = split_candidates(AUTH_WALL_HTML)
    assert not [c for c in cands if "og:image" in c.text or "content='http" in c.text]
    # ...and the page as a whole must offer nothing a model could mistake for content
    assert prose_only(cands) == []


# ---------------------------------------------------------------------------
# bugs found by running the thing, after the tests above were already green
# ---------------------------------------------------------------------------

# /de/competitors/compare-algolia-vs-constructor, exact source text.
FORRESTER = (
    "Eine Studie von Forrester Consulting ergab, dass Algolia über einen Zeitraum von drei "
    "Jahren einen Nettobarwert (NPV) von 3,1 Mio. US-Dollar erzielte und E-Commerce-Teams "
    "dabei unterstützte, die Relevanz zu verbessern und den Umsatz zu steigern."
)

# same page: a long unpunctuated markdown heading immediately followed by body prose.
HEADING_THEN_PROSE = (
    "##  Entwickeln Sie mit Algolia erstklassige KI-basierte Such- und Entdeckungserlebnisse\n"
    "Algolia bietet Ihnen die nötige Kontrolle, um Suchergebnisse gezielt zu steuern und "
    "Umsatzziele zuverlässig zu erreichen.\n"
)


def test_german_thousands_abbreviation_does_not_split_a_sentence():
    """'3,1 Mio. US-Dollar' was cut in half; the back half became a highlight and drew a REVISE.

    It starts with a capital and ends with a period, so no shape check can catch it. The
    abbreviation list was English-only while 3,887 records are de/fr.
    """
    cands, _ = split_candidates(FORRESTER)
    assert len(cands) == 1, [c.text[:70] for c in cands]
    assert cands[0].kind == "prose"
    assert "3,1 Mio. US-Dollar erzielte" in cands[0].text


def test_a_heading_never_merges_with_the_prose_beneath_it():
    """My own bug, introduced by this change and caught only by running it.

    The block decision is taken at the start of the NEXT line, so a long unpunctuated heading was
    indistinguishable from a hard-wrapped paragraph and got welded to the body text under it.
    """
    cands, _ = split_candidates(HEADING_THEN_PROSE)
    for c in cands:
        assert not ("Entwickeln Sie mit Algolia" in c.text and "Algolia bietet Ihnen" in c.text), (
            f"heading merged with body: {c.text[:120]!r}")


def test_french_initial_does_not_end_a_sentence():
    cands, _ = split_candidates(
        "Le rapport de M. Dupont montre que la recherche améliore nettement la conversion.")
    assert len(cands) == 1, [c.text for c in cands]


# ---------------------------------------------------------------------------
# known residual — recorded as a failing test rather than left in a comment
# ---------------------------------------------------------------------------

@pytest.mark.xfail(
    reason="Form-confirmation prose is shape-identical to content prose. Judge REVISE #3 and #15 "
           "flagged 'Thank you!' / 'Merci!' text. Shape-based detection cannot separate "
           "'Ihre Anfrage wurde erfolgreich übermittelt.' from a real sentence -- both are "
           "complete, punctuated and ordinary. Needs a different signal (form proximity in the "
           "DOM, or a judge-side rule), so it is out of scope for this change and visible here.",
    strict=True,
)
def test_form_confirmation_text_is_not_prose():
    cands, _ = split_candidates(DEVCON_BLOB)
    confirm = [c for c in cands if "Anfrage wurde erfolgreich" in c.text]
    assert confirm and all(c.kind != "prose" for c in confirm)


# ---------------------------------------------------------------------------
# the menu the model actually reads
# ---------------------------------------------------------------------------

def test_menu_labels_non_prose_so_the_model_can_see_it():
    """Today the model cannot distinguish a CTA from a thesis sentence. That is the whole bug."""
    page = NAV_BLOB + "\n" + REAL_PROSE + "\n\n" + DEVCON_BLOB
    cands, _ = split_candidates(page)
    menu = render_menu(cands)
    assert "[UI]" in menu or "[NONPROSE]" in menu
    # every incomplete candidate must carry SOME label. Which label is a classification detail;
    # that it is never shown bare, as if it were a finished sentence, is the requirement.
    for c in cands:
        if not c.sentence_complete:
            assert c.kind != "prose", f"[{c.index}] shown bare: {c.text[:60]!r}"
    # the good sentence must be offered plainly, with no scary label attached
    good = [c for c in cands if "Crocs die" in c.text][0]
    assert f"[{good.index}] {good.text}" in menu


def test_menu_numbering_is_contiguous_and_stable():
    """resolve_selection() looks numbers up in this exact list. A gap is a wrong-record bug."""
    page = NAV_BLOB + "\n" + REAL_PROSE + "\n\n" + DEVCON_BLOB
    cands, _ = split_candidates(page)
    assert [c.index for c in cands] == list(range(1, len(cands) + 1))


# ---------------------------------------------------------------------------
# regression: the real 50-page corpus, if it is present
# ---------------------------------------------------------------------------

CACHE = os.path.join(os.path.dirname(__file__), "..", "cache-fresh50")


def _corpus_pages():
    import glob
    import json

    for path in sorted(glob.glob(os.path.join(CACHE, "*.json"))):
        with open(path) as fh:
            rec = json.load(fh)
        if isinstance(rec, dict) and len(rec.get("markdown") or "") >= 200:
            yield rec


@pytest.mark.skipif(not os.path.isdir(CACHE), reason="cache-fresh50 is gitignored")
def test_prose_yield_on_the_real_corpus():
    """The yield guard that counts. Baseline: the two runs scored 40 of 50 pages REAL.

    So at least 40 of the 50 cached pages must still offer a prose candidate. Falling below that
    means the cleanup started eating content, which is the trade Arijit ruled out.
    """
    pages = list(_corpus_pages())
    assert len(pages) == 50, f"expected the 50 cached pages, read {len(pages)}"
    with_prose = sum(1 for rec in pages if prose_only(split_candidates(rec["markdown"])[0]))
    assert with_prose >= 40, f"only {with_prose}/50 pages offer prose; baseline REAL count was 40"


@pytest.mark.skipif(not os.path.isdir(CACHE), reason="cache-fresh50 is gitignored")
def test_fragment_share_across_the_real_corpus_is_under_five_percent():
    """Baseline measured 2026-08-08 before the fix: 715/2264 = 31.6% fragment-shaped."""
    import glob
    import json
    import re

    total = bad = 0
    for path in sorted(glob.glob(os.path.join(CACHE, "*.json"))):
        with open(path) as fh:
            rec = json.load(fh)
        if not isinstance(rec, dict):
            continue
        md = rec.get("markdown") or ""
        if len(md) < 200:
            continue
        cands, _ = split_candidates(md)
        for c in prose_only(cands):
            total += 1
            if c.text[:1].islower() or not re.search(r"[.!?:][\"')\]]?$", c.text):
                bad += 1
    assert total, "no pages read"
    share = bad / total
    assert share < 0.05, f"{bad}/{total} = {share:.1%} of PROSE candidates are fragment-shaped"
