"""Tier 1: verifying an already-written corpus from the live index.

The tests that matter here are the ones asserting this validator FAILS when it should. A verifier
that cannot fail is the most expensive kind of green, and this codebase has already paid for two:
a filter on a non-faceted attribute that returned empty and read as success, and a grounding
check that matched nothing across a whole slice.
"""
from __future__ import annotations

import json
import pathlib

import pytest

from algolia_enrichment.errors import EnrichmentError, ZeroWorkError
from algolia_enrichment.live_corpus import (assert_canonicalise_idempotent, check_content_drift,
                                            check_fetch_provenance, load_cached_bodies,
                                            per_record_rows, rows_from_index, verify_corpus)

PAGE = ("#  Algolia Named a Leader\n"
        "Algolia today announced the results of its annual ecommerce search report.\n"
        "The company said the findings show a clear shift toward AI-driven discovery.\n")


class FakeClient:
    """Stands in for AlgoliaClient. Only `browse` is used by this module."""

    def __init__(self, records):
        self._records = records

    def browse(self, index, attributes=None):
        return list(self._records)


def _record(oid, spans, highlights=(), source="Blog", page_type="blog-post", url=None):
    return {"objectID": oid, "url": url or f"/blog/{oid}", "source": source,
            "page_type": page_type, "title": "T", "description": "D",
            "abstract_enriched": list(spans), "keyhighlights_enriched": list(highlights)}


def _cache(tmp_path, entries):
    d = tmp_path / "docs" / "operations" / "enrichment" / "cache-scout" / "batch" / "001"
    d.mkdir(parents=True, exist_ok=True)
    for i, e in enumerate(entries):
        (d / f"{i}.json").write_text(json.dumps(e))
    return tmp_path


# --- the guarantee: a span that is not on the page must FAIL -----------------------------------

def test_a_span_absent_from_the_page_is_reported_as_a_grounding_failure(tmp_path):
    ws = _cache(tmp_path, [{"objectID": "a", "url": "/blog/a", "markdown": PAGE,
                            "served_url": "/blog/a", "http_status": 200}])
    client = FakeClient([_record("a", ["This sentence appears on no page anywhere at all."])])
    report = verify_corpus(client, "IDX", "Blog", "blog-post", ws)
    assert report["grounding"]["failures"], "an invented span must be caught"
    assert report["ok"] is False


def test_a_span_present_on_the_page_passes(tmp_path):
    ws = _cache(tmp_path, [{"objectID": "a", "url": "/blog/a", "markdown": PAGE,
                            "served_url": "/blog/a", "http_status": 200}])
    client = FakeClient([_record(
        "a", ["Algolia today announced the results of its annual ecommerce search report."])])
    report = verify_corpus(client, "IDX", "Blog", "blog-post", ws)
    assert report["grounding"]["failures"] == []
    assert report["grounding"]["located"] == report["grounding"]["spans_checked"]
    assert report["ok"] is True


# --- zero work must never read as success ------------------------------------------------------

def test_a_corpus_with_no_enriched_records_raises_rather_than_passing(tmp_path):
    ws = _cache(tmp_path, [{"objectID": "a", "url": "/blog/a", "markdown": PAGE}])
    client = FakeClient([{"objectID": "a", "url": "/blog/a", "source": "Blog",
                          "page_type": "blog-post"}])          # no enriched fields at all
    with pytest.raises(ZeroWorkError):
        verify_corpus(client, "IDX", "Blog", "blog-post", ws)


def test_the_wrong_corpus_filter_raises_instead_of_reporting_an_empty_pass(tmp_path):
    ws = _cache(tmp_path, [{"objectID": "a", "url": "/blog/a", "markdown": PAGE}])
    client = FakeClient([_record("a", ["Algolia today announced the results of its annual "
                                       "ecommerce search report."])])
    with pytest.raises(ZeroWorkError):
        verify_corpus(client, "IDX", "Customer Stories", "case-study", ws)


# --- idempotence is asserted BEFORE grounding numbers are believed -----------------------------

def test_idempotence_holds_on_a_real_page():
    assert assert_canonicalise_idempotent({"a": {"markdown": PAGE}})["ok"] is True


def test_idempotence_check_refuses_to_pass_on_zero_bodies():
    with pytest.raises(ZeroWorkError):
        assert_canonicalise_idempotent({})


def test_non_idempotent_canonicalise_is_reported_but_does_not_block(tmp_path):
    """MEASURED on the real corpus: 22 of 400 Blog bodies are not idempotent, all because a page
    carries a JSX snippet inside a code fence. Pass one leaves the tag, pass two strips it.

    That must be VISIBLE and must NOT block. Written as fatal first; blocking a 2,694-record
    corpus over the verifier's own normalisation is the crying-wolf failure.
    """
    jsx = ('#  A post about code\n'
           'Algolia today announced the results of its annual ecommerce search report.\n'
           '```\n<button className="chat-suggestion" onClick={() => send()}>Go</button>\n```\n')
    ws = _cache(tmp_path, [{"objectID": "a", "url": "/blog/a", "markdown": jsx,
                            "served_url": "/blog/a", "http_status": 200}])
    client = FakeClient([_record(
        "a", ["Algolia today announced the results of its annual ecommerce search report."])])
    report = verify_corpus(client, "IDX", "Blog", "blog-post", ws)
    assert "canonicalise_idempotent" in report          # reported
    assert report["ok"] is True                          # not fatal
    assert report["grounding_triage"]["genuine_absences"] == []


def test_a_verifier_artifact_is_not_counted_as_a_corpus_defect(tmp_path):
    """The triage that keeps this validator honest in BOTH directions.

    A span the verifier could not locate because it canonicalised the span twice and the body
    once is the VERIFIER's defect. Reporting it as a missing span would be a false alarm; hiding
    a genuine absence behind that excuse would be worse. Both are separated and both are counted.
    """
    from algolia_enrichment.live_corpus import classify_grounding_failures
    rows = [{"objectID": "a", "abstract_spans_stored": ["Algolia today announced the results."],
             "keyhighlights_enriched": []}]
    bodies = {"a": {"markdown": "#  T\nAlgolia today announced the results.\n"}}
    # a span that IS in the body but was reported as a miss -> artifact, not a corpus defect
    out = classify_grounding_failures(
        [{"objectID": "a", "field": "abstract_enriched",
          "span": "Algolia today announced the results."}], rows, bodies)
    assert len(out["canonicalisation_artifacts"]) == 1
    assert out["genuine_absences"] == [] and out["ok"] is True

    # a span that is genuinely absent -> real defect, must survive triage
    rows2 = [{"objectID": "a", "abstract_spans_stored": ["Nowhere on this page."],
              "keyhighlights_enriched": []}]
    out2 = classify_grounding_failures(
        [{"objectID": "a", "field": "abstract_enriched", "span": "Nowhere on this page."}],
        rows2, bodies)
    assert len(out2["genuine_absences"]) == 1 and out2["ok"] is False


# --- a span sliced from the wrong document -----------------------------------------------------

def test_a_redirect_is_a_defect_even_though_the_status_is_200():
    rows = [{"objectID": "a", "url": "/blog/a", "abstract_spans_stored": ["x"],
             "keyhighlights_enriched": []}]
    bodies = {"a": {"markdown": PAGE, "url": "/blog/a", "served_url": "/blog/somewhere-else",
                    "http_status": 200, "redirect_mismatch": True}}
    out = check_fetch_provenance(rows, bodies)
    assert out["ok"] is False
    assert out["defects"][0]["reason"] == "redirect_mismatch"


def test_served_url_differing_from_the_requested_url_is_a_defect():
    rows = [{"objectID": "a", "url": "/blog/a", "abstract_spans_stored": ["x"],
             "keyhighlights_enriched": []}]
    bodies = {"a": {"markdown": PAGE, "url": "/blog/a", "served_url": "/blog/other",
                    "http_status": 200}}
    assert check_fetch_provenance(rows, bodies)["ok"] is False


def test_a_followed_redirect_that_landed_correctly_is_NOT_a_defect():
    """MEASURED: 1,881 cached Blog fetches carry http_status 301 because Scout follows the chain
    and stores the FIRST hop. On every one, served_url == url and redirect_mismatch is False.

    A "status must be 200" rule flagged 1,805 of 2,694 records as broken. All were fine. The
    status code is not the signal; where the chain LANDED is.
    """
    rows = [{"objectID": "a", "url": "/de/blog/x", "abstract_spans_stored": ["x"],
             "keyhighlights_enriched": []}]
    bodies = {"a": {"markdown": PAGE, "url": "/de/blog/x", "served_url": "/de/blog/x",
                    "http_status": 301, "redirect_mismatch": False}}
    assert check_fetch_provenance(rows, bodies)["ok"] is True


def test_a_dead_page_status_IS_a_defect():
    """404 means no document was delivered, so any span claiming to come from it is unfounded."""
    rows = [{"objectID": "a", "url": "/blog/gone", "abstract_spans_stored": ["x"],
             "keyhighlights_enriched": []}]
    bodies = {"a": {"markdown": PAGE, "url": "/blog/gone", "served_url": "/blog/gone",
                    "http_status": 404, "redirect_mismatch": False}}
    out = check_fetch_provenance(rows, bodies)
    assert out["ok"] is False and "404" in out["defects"][0]["reason"]


def test_a_missing_cached_body_is_reported_not_silently_skipped():
    rows = [{"objectID": "a", "url": "/blog/a", "abstract_spans_stored": ["x"],
             "keyhighlights_enriched": []}]
    out = check_fetch_provenance(rows, {})
    assert out["missing_body"] == ["a"] and out["ok"] is False


# --- drift is reported, and reported SEPARATELY ------------------------------------------------

def test_content_drift_is_detected_from_the_recorded_hash():
    rows = [{"objectID": "a", "abstract_spans_stored": ["x"], "keyhighlights_enriched": []}]
    bodies = {"a": {"markdown": PAGE, "content_hash": "stale-hash-that-will-not-match"}}
    out = check_content_drift(rows, bodies)
    assert out["drifted"] and out["ok"] is False


def test_drift_is_not_counted_as_a_grounding_failure(tmp_path):
    """A page edited after enrichment is the world moving, not the pipeline breaking."""
    ws = _cache(tmp_path, [{"objectID": "a", "url": "/blog/a", "markdown": PAGE,
                            "served_url": "/blog/a", "http_status": 200,
                            "content_hash": "does-not-match"}])
    client = FakeClient([_record(
        "a", ["Algolia today announced the results of its annual ecommerce search report."])])
    report = verify_corpus(client, "IDX", "Blog", "blog-post", ws)
    assert report["content_drift"]["drifted"], "drift must be visible"
    assert report["grounding"]["failures"] == [], "drift must not inflate grounding failures"


# --- shape handling ----------------------------------------------------------------------------

def test_a_legacy_string_abstract_is_read_as_one_span_not_skipped():
    """One historical record stored a bare string instead of an array. Skipping it would
    under-count, and an under-count that passes is worse than a failure."""
    client = FakeClient([{"objectID": "a", "url": "/blog/a", "source": "Blog",
                          "page_type": "blog-post", "abstract_enriched": "a single span",
                          "keyhighlights_enriched": []}])
    rows = rows_from_index(client, "IDX", "Blog", "blog-post")
    assert rows[0]["abstract_spans_stored"] == ["a single span"]


def test_both_cache_layouts_are_read(tmp_path):
    """The top-level pilot cache and the per-run cache are both real. Reading only one is how
    2,586 cached Blog bodies were reported as missing."""
    top = tmp_path / "docs" / "operations" / "enrichment" / "cache-scout" / "b" / "1"
    top.mkdir(parents=True)
    (top / "x.json").write_text(json.dumps({"objectID": "a", "url": "/a", "markdown": PAGE}))
    run = tmp_path / "docs" / "operations" / "enrichment" / "runs" / "r1" / "cache-scout"
    run.mkdir(parents=True)
    (run / "y.json").write_text(json.dumps({"objectID": "b", "url": "/b", "markdown": PAGE}))
    cache = load_cached_bodies(tmp_path)
    assert set(cache["by_object_id"]) == {"a", "b"}


def test_per_record_rows_cover_every_record(tmp_path):
    ws = _cache(tmp_path, [
        {"objectID": "a", "url": "/blog/a", "markdown": PAGE, "served_url": "/blog/a",
         "http_status": 200},
        {"objectID": "b", "url": "/blog/b", "markdown": PAGE, "served_url": "/blog/b",
         "http_status": 200}])
    good = "Algolia today announced the results of its annual ecommerce search report."
    client = FakeClient([_record("a", [good]), _record("b", ["not on the page at all"])])
    report = verify_corpus(client, "IDX", "Blog", "blog-post", ws)
    rows = rows_from_index(client, "IDX", "Blog", "blog-post")
    lines = per_record_rows(report, rows)
    assert len(lines) == 2
    assert {ln["objectID"]: ln["ok"] for ln in lines} == {"a": True, "b": False}


# --- soft 404: 200 OK, real size, and the story is gone ----------------------------------------

def test_soft_404_markers_are_declared_for_case_study():
    """A deleted case study returns 200 with 8KB of site furniture.

    Status, served_url, redirect_mismatch and body size ALL pass on these pages -- measured on
    /customers/kingarthur (en/de/fr) and /customers/bringmeister, where the customer's own name
    appears zero times. The only detectable signal is content, so the markers have to be named.
    Labelling a deleted page NO_PROSE blames the writer for the page's absence.
    """
    from algolia_enrichment.profiles import load_profile
    prof = load_profile(pathlib.Path(__file__).resolve().parents[1] / "profiles",
                        "Customer Stories", "case-study")
    markers = [m.lower() for m in prof.dead_page_markers]
    assert "no products found" in markers
    assert "your customer hub for everything algolia" in markers


def test_dead_page_marker_matches_the_real_bringmeister_body():
    """The literal string the live page renders, so the marker cannot drift from the page."""
    from algolia_enrichment.profiles import load_profile
    from algolia_enrichment.verdicts import dead_page_reason
    prof = load_profile(pathlib.Path(__file__).resolve().parents[1] / "profiles",
                        "Customer Stories", "case-study")
    # The nav prefix is the point: on the real page it runs ~1,200 chars before any content,
    # which is exactly why a 200-char head window could never see the stub.
    nav = "* [\n  * English ](https://www.algolia.com/customers/bringmeister) " * 20
    body = (nav
            + "[Back to all customer stories](https://www.algolia.com/customers)\n"
              "# Customer stories\n"
              "More than 18,000 customers across 150+ countries selected Algolia.\n"
              "# No Products Found!!! \n")
    reason = dead_page_reason(body, min_chars=1, markers=tuple(prof.dead_page_markers))
    assert reason and "not-found stub" in reason

    # and the window must not be the old 200-char head, which is nav on every page
    assert "No Products Found".casefold() not in body[:200].casefold()


def test_a_live_article_mentioning_the_phrase_later_is_NOT_called_dead():
    """The window stops 400 chars past the first heading, so an article that happens to discuss
    the phrase in its body is not condemned by it."""
    from algolia_enrichment.verdicts import dead_page_reason
    body = ("# How our catalogue search handles empty results\n"
            + "Real prose about relevance and ranking. " * 30
            + "\nShoppers sometimes see No Products Found and bounce.\n")
    assert dead_page_reason(body, min_chars=1, markers=("No Products Found",)) is None


# --- the CLASS fix: a page that never names its own subject ------------------------------------

def test_a_page_that_never_names_its_subject_is_a_soft_404():
    """MEASURED: /customers/kingarthur serves 8,230 chars of the generic customer hub and the
    string "king arthur" appears ZERO times. Status 200, size healthy, served_url matches,
    redirect_mismatch False -- every other check passes. Only the subject's absence gives it away.
    """
    from algolia_enrichment.verdicts import subject_absent_reason
    hub = ("# Your customer hub for everything Algolia\n"
           "Access expert guidance, product updates, events, and peer insights.\n"
           "EVENT eTail Boston. Come see us at booth #308.\n")
    reason = subject_absent_reason("/customers/kingarthur", hub)
    assert reason and "soft 404" in reason


def test_a_real_case_study_naming_its_subject_passes():
    from algolia_enrichment.verdicts import subject_absent_reason
    body = ("# How King Arthur Baking grew online revenue\n"
            "King Arthur Baking replaced its legacy search with Algolia.\n")
    assert subject_absent_reason("/customers/kingarthur", body) is None


def test_a_slug_with_no_usable_token_returns_None_rather_than_condemning():
    """"We could not form a question" must never be reported as "the answer is no".
    Measured: 3 Blog records have slugs that yield no token after stopwords."""
    from algolia_enrichment.verdicts import subject_absent_reason
    assert subject_absent_reason("/blog/the-and-for", "anything at all") is None
    assert subject_absent_reason("", "anything at all") is None


def test_stopwords_stop_the_brand_name_from_proving_subject_presence():
    """Every algolia.com page says "Algolia". If that counted, no soft 404 could ever be found."""
    from algolia_enrichment.verdicts import subject_tokens
    assert "algolia" not in subject_tokens("/customers/algolia-bringmeister")
    assert "bringmeister" in subject_tokens("/customers/algolia-bringmeister")


def test_classify_returns_DEAD_PAGE_for_a_soft_404_before_any_model_call():
    """The verdict must be terminal and honest. Calling a deleted page NO_PROSE blames the writer
    for the page's absence, and invites a retry that can never succeed."""
    from algolia_enrichment.verdicts import DEAD_PAGE, classify
    body = {"objectID": "x", "url": "/customers/kingarthur", "http_status": 200,
            "served_url": "/customers/kingarthur", "redirect_mismatch": False,
            "markdown": "# Your customer hub for everything Algolia\n" + "filler text. " * 200}
    verdict = classify(body)
    assert verdict["verdict"] == DEAD_PAGE
    assert "soft 404" in verdict["verdict_reason"]
