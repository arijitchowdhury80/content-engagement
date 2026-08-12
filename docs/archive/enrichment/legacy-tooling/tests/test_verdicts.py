"""verdicts — honest non-enrichment outcomes, and the redirect case above all.

The redirect tests encode a measured fact, not a hypothesis: on 2026-08-09, 14 of 23 fetched
`/doc/libraries` URLs served a different document than requested, and six language variants of one
method returned one byte-identical body.
"""

from __future__ import annotations

import json
import pathlib
import sys

import pytest

HERE = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HERE))

import verdicts as V  # noqa: E402


def fetched(**kw):
    # The body must clear DEAD_BODY_MIN_CHARS. It used to be "# Page\n\nProse." (15 chars), which
    # was fine when nothing looked at body size, and became a DEAD_PAGE the moment the blog run
    # added a content-based liveness gate on 2026-08-09. These tests are about fetch status and
    # document identity, so the fixture is given a plausible body rather than the floor being
    # lowered to accommodate a toy one -- 95 dead blog pages depend on that floor holding.
    base = {"objectID": "rec-1", "url": "/doc/rest-api/search", "fetch_path": "scout",
            "markdown": "# Page\n\n" + ("Prose that makes this a plausible page body. " * 40),
            "http_status": 200, "fetch_error": "",
            "served_url": "/doc/rest-api/search", "redirect_mismatch": False}
    base.update(kw)
    return base


@pytest.fixture
def canonical(tmp_path):
    rows = [
        {"objectID": "sdk-1", "url": "/doc/libraries/sdk/methods/composition/delete-composition"},
        {"objectID": "rec-1", "url": "/doc/rest-api/search"},
    ]
    q = tmp_path / "q.jsonl"
    q.write_text("\n".join(json.dumps(r) for r in rows), encoding="utf-8")
    return V.canonical_index(q)


# --- a healthy record is not given a verdict -------------------------------

def test_a_clean_fetch_returns_none_and_proceeds_to_enrichment(canonical):
    assert V.classify(fetched(), canonical) is None


# --- the non-fetched paths -------------------------------------------------

@pytest.mark.parametrize("path,expected", [
    ("login-required", V.LOGIN_REQUIRED),
    ("excluded-support", V.EXCLUDED_SUPPORT),
    ("excluded", V.EXCLUDED),
])
def test_non_fetched_paths_get_counted_verdicts(path, expected, canonical):
    out = V.classify(fetched(fetch_path=path, markdown="", served_url=""), canonical)
    assert out["status"] == expected
    assert out["enrichable"] is False
    assert out["abstract_enriched"] is None
    assert out["verdict_reason"]


def test_a_fetch_failure_is_a_verdict_not_a_crash(canonical):
    out = V.classify(fetched(fetch_error="scout job did not finish in 90s", http_status=0),
                     canonical)
    assert out["status"] == V.FETCH_FAILED
    assert "90s" in out["verdict_reason"]


# --- the redirect finding --------------------------------------------------

def test_redirect_onto_an_existing_record_is_REDIRECT_CANONICAL(canonical):
    out = V.classify(fetched(
        objectID="csharp-1",
        url="/doc/libraries/csharp/v7/methods/composition/delete-composition",
        served_url="/doc/libraries/sdk/methods/composition/delete-composition",
        redirect_mismatch=True, http_status=308), canonical)
    assert out["status"] == V.REDIRECT_CANONICAL
    assert out["canonical_objectID"] == "sdk-1"
    assert out["enrichable"] is False


def test_redirect_onto_an_unindexed_page_is_still_non_enrichment(canonical):
    out = V.classify(fetched(objectID="x-1", url="/doc/a", served_url="/doc/somewhere-else",
                             redirect_mismatch=True, http_status=308), canonical)
    assert out["status"] == V.REDIRECT_UNINDEXED
    assert out["enrichable"] is False


def test_a_redirect_that_reports_200_is_still_caught(canonical):
    """Scout reported 308. A fetcher that follows the redirect reports 200 and is just as wrong,
    so the verdict keys on identity, never on the status code."""
    out = V.classify(fetched(
        objectID="csharp-1",
        url="/doc/libraries/csharp/v7/methods/composition/delete-composition",
        served_url="/doc/libraries/sdk/methods/composition/delete-composition",
        redirect_mismatch=True, http_status=200), canonical)
    assert out["status"] == V.REDIRECT_CANONICAL


@pytest.mark.parametrize("served", [
    "/doc/rest-api/search/",                        # trailing-slash canonicalisation
    "/doc/rest-api/search",                         # identical
    "https://www.algolia.com/doc/rest-api/search",  # absolute form of the same document
])
def test_a_self_redirect_is_not_a_verdict_at_all(canonical, served):
    """Self-redirect is not misattribution — the page served IS the page requested.

    The previous version of this test asserted `REDIRECT_UNINDEXED or None`, which passes whichever
    way the code behaves and therefore asserted nothing. Codex caught it. `classify` must return
    None so the record goes on to be enriched.
    """
    assert V.classify(fetched(objectID="rec-1", url="/doc/rest-api/search",
                              served_url=served, redirect_mismatch=True), canonical) is None


def test_an_empty_served_url_with_the_flag_set_is_not_a_verdict(canonical):
    """`redirect_mismatch=True` with no served URL is a caller bug, not evidence of a redirect.
    Accuse only on positive evidence."""
    assert V.classify(fetched(url="/doc/rest-api/search", served_url="",
                              redirect_mismatch=True), canonical) is None


def test_a_genuine_redirect_is_still_caught_after_the_self_redirect_guard(canonical):
    """The guard must not swallow the real case it sits next to."""
    out = V.classify(fetched(
        objectID="csharp-1",
        url="/doc/libraries/csharp/v7/methods/composition/delete-composition",
        served_url="/doc/libraries/sdk/methods/composition/delete-composition",
        redirect_mismatch=True), canonical)
    assert out["status"] == V.REDIRECT_CANONICAL


# --- the index -------------------------------------------------------------

def test_canonical_index_normalises_trailing_slashes(tmp_path):
    q = tmp_path / "q.jsonl"
    q.write_text(json.dumps({"objectID": "a", "url": "/doc/x/"}), encoding="utf-8")
    idx = V.canonical_index(q)
    assert idx["/doc/x"] == "a"


def test_every_verdict_name_is_registered_as_non_enrichment():
    """A new verdict that is not in NON_ENRICHMENT would be silently counted as a success."""
    names = {v for k, v in vars(V).items()
             if k.isupper() and isinstance(v, str) and k not in ("QUEUE_PATH",)}
    assert names <= V.NON_ENRICHMENT | {"", "/"}
