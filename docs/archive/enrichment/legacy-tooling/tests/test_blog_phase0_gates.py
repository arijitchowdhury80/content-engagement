"""
Phase 0.5 gates for the blog run — the five changes Arijit authorised on 2026-08-09.

WHY THESE EXIST, AND WHY THE DEAD-PAGE ONE IS NOT A STATUS CHECK
  Measured on the blog corpus the same day:

    blog bodies returning HTTP 301        1,655   of which ~1,600 are ALIVE
    dead "# Page not found" stub bodies      95   of which 61 return 301, only 34 return 404

  A first draft of the plan proposed `http_status != 200 -> DEAD`. That rule would have destroyed
  roughly 1,600 healthy articles while still being described as a safety gate. Liveness on
  algolia.com is decided by what the body SAYS, never by what the status line claims.
  `test_alive_301_survives_the_dead_page_gate` is the test that would have caught it.

  The language gate is deliberately NOT a gate. /de/blog/... and /fr/blog/... serve the English
  article (probed live 2026-08-09: identical bytes with and without Accept-Language: de-DE). There
  is no German body to prefer, so an English abstract is the true description of an English page.
  Arijit's ruling: enrich all 2,800, count the mismatch, never hide it.
"""

from __future__ import annotations

import json
import pathlib
import subprocess
import sys

import pytest

HERE = pathlib.Path(__file__).parent
ROOT = HERE.parent
sys.path.insert(0, str(ROOT))

import make_batches  # noqa: E402
import verdicts  # noqa: E402


DEAD_STUB = (
    "#  Page not found \n"
    "[ Search Algolia ](https://www.algolia.com/search/)\n"
    "[ API Status ](https://status.algolia.com/)\n"
    "[ Home page ](https://www.algolia.com/)\n"
    "[ Support ](https://support.algolia.com/hc/en-us)\n"
)


def _fetched(**over) -> dict:
    base = {
        "objectID": "en_x", "url": "/blog/product/dynamic-facets",
        "source_url": "https://www.algolia.com/blog/product/dynamic-facets",
        "served_url": "/blog/product/dynamic-facets",
        "fetch_path": "scout", "fetch_error": "", "redirect_mismatch": False,
        "http_status": 200, "markdown": "A real sentence. " * 200,
        "language_code": "en",
    }
    base.update(over)
    return base


# ---------------------------------------------------------------------------
# change 2 — dead page, by CONTENT
# ---------------------------------------------------------------------------

def test_dead_stub_with_404_is_dead():
    v = verdicts.classify(_fetched(markdown=DEAD_STUB, http_status=404))
    assert v is not None and v["status"] == verdicts.DEAD_PAGE


def test_dead_stub_with_301_is_also_dead():
    """61 of the 95 dead blog pages return 301, not 404. A status check misses two thirds."""
    v = verdicts.classify(_fetched(markdown=DEAD_STUB, http_status=301))
    assert v is not None and v["status"] == verdicts.DEAD_PAGE


def test_alive_301_survives_the_dead_page_gate():
    """THE regression test. 1,655 blog bodies are 301 and ~1,600 of them are real articles."""
    v = verdicts.classify(_fetched(http_status=301, markdown="Dynamic Facets reorders refinements. " * 100))
    assert v is None, "an alive body must not be killed by its status code"


def test_alive_200_survives():
    assert verdicts.classify(_fetched()) is None


def test_body_under_the_floor_is_dead():
    v = verdicts.classify(_fetched(markdown="Too short to enrich."))
    assert v is not None and v["status"] == verdicts.DEAD_PAGE


def test_dead_page_verdict_is_not_enrichable_and_writes_nothing():
    v = verdicts.classify(_fetched(markdown=DEAD_STUB))
    assert v["enrichable"] is False
    assert v["abstract_enriched"] is None
    assert v["keyhighlights_enriched"] is None


def test_dead_page_is_a_counted_non_enrichment_verdict():
    assert verdicts.DEAD_PAGE in verdicts.NON_ENRICHMENT


def test_fetch_error_still_beats_dead_page():
    """A record we never fetched is FETCH_FAILED, not DEAD. Different cause, different retry."""
    v = verdicts.classify(_fetched(fetch_error="Hosted API rate limit exceeded", markdown=""))
    assert v["status"] == verdicts.FETCH_FAILED


def test_absent_markdown_key_is_not_a_dead_page():
    """
    "No body supplied" and "body is a stub" are different claims. A caller asking only about
    fetch status and identity passes no markdown at all; treating that as DEAD would make the
    verdict fire on every such call. An empty STRING is still dead -- see the next test.
    """
    rec = _fetched()
    del rec["markdown"]
    assert verdicts.classify(rec) is None


def test_empty_markdown_string_is_a_dead_page():
    assert verdicts.classify(_fetched(markdown=""))["status"] == verdicts.DEAD_PAGE


def test_redirect_to_another_record_beats_dead_page(tmp_path):
    """
    REDIRECT_CANONICAL names the record that owns the served page; DEAD_PAGE would be true but
    less useful. Ordering is asserted so a later edit cannot quietly swap the two.
    """
    canonical = {"/blog/canonical": "en_owner"}
    v = verdicts.classify(_fetched(
        objectID="en_other", url="/blog/old", served_url="/blog/canonical",
        redirect_mismatch=True, markdown=DEAD_STUB), canonical)
    assert v["status"] == verdicts.REDIRECT_CANONICAL


# ---------------------------------------------------------------------------
# change 3 — language mismatch is COUNTED, never a gate
# ---------------------------------------------------------------------------

def test_language_mismatch_is_not_a_verdict():
    """A de record served an English body is still enrichable. Arijit's ruling 2026-08-09."""
    v = verdicts.classify(_fetched(language_code="de"))
    assert v is None


def test_language_mismatch_flag_true_when_observed_differs():
    assert verdicts.language_mismatch("de", "en") is True


def test_language_mismatch_flag_false_when_equal():
    assert verdicts.language_mismatch("en", "en") is False


def test_language_mismatch_flag_false_when_unobserved():
    """The model failing to report a language is not evidence of a mismatch."""
    assert verdicts.language_mismatch("de", None) is False
    assert verdicts.language_mismatch("de", "") is False


# ---------------------------------------------------------------------------
# change 1 — blog-only batching
# ---------------------------------------------------------------------------

QUEUE_SAMPLE = [
    {"objectID": "b1", "source": "Blog", "page_type": "blog-post",
     "fetch_path": "scout", "family": "editorial", "url": "/blog/a"},
    {"objectID": "b2", "source": "Blog", "page_type": "blog-post",
     "fetch_path": "scout", "family": "editorial", "url": "/blog/b"},
    {"objectID": "r1", "source": "Resources", "page_type": "resource",
     "fetch_path": "scout", "family": "editorial", "url": "/resources/a"},
    {"objectID": "p1", "source": "Website", "page_type": "press-release",
     "fetch_path": "scout", "family": "editorial", "url": "/press/a"},
    {"objectID": "s1", "source": "Support", "page_type": "support-article",
     "fetch_path": "excluded-support", "family": "instructional", "url": "/support/a"},
]


def test_source_filter_keeps_only_blog():
    got = make_batches.filter_queue(QUEUE_SAMPLE, source="Blog")
    assert [r["objectID"] for r in got] == ["b1", "b2"]


def test_page_type_filter_keeps_only_blog_post():
    got = make_batches.filter_queue(QUEUE_SAMPLE, page_type="blog-post")
    assert [r["objectID"] for r in got] == ["b1", "b2"]


def test_family_filter_alone_is_too_wide():
    """The bug this argument exists to prevent: scout/editorial is 4,363 records, blog is 2,800."""
    editorial = [r for r in QUEUE_SAMPLE if r["family"] == "editorial"]
    blog_only = make_batches.filter_queue(QUEUE_SAMPLE, source="Blog")
    assert len(editorial) > len(blog_only)


def test_filters_compose():
    got = make_batches.filter_queue(QUEUE_SAMPLE, source="Blog", page_type="blog-post")
    assert [r["objectID"] for r in got] == ["b1", "b2"]


def test_unknown_source_is_fatal_not_empty():
    """An empty batch set is the silent-skip failure mode. Fail loudly instead."""
    with pytest.raises(SystemExit):
        make_batches.filter_queue(QUEUE_SAMPLE, source="Blogs")


def test_skip_ids_are_removed():
    got = make_batches.filter_queue(QUEUE_SAMPLE, source="Blog", skip_ids={"b1"})
    assert [r["objectID"] for r in got] == ["b2"]


# ---------------------------------------------------------------------------
# change 4 — a manifest with no usable rows must refuse to run
# ---------------------------------------------------------------------------

def _run_enrich(manifest: pathlib.Path, out: pathlib.Path) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, str(ROOT / "enrich_run.py"), "--pilot",
         "--manifest", str(manifest), "--out", str(out)],
        capture_output=True, text=True, timeout=120)


def test_all_error_manifest_refuses_to_run(tmp_path):
    """
    enrich_run silently dropped fetch_error rows, so a manifest of nothing but failures produced
    a clean 0-row results.jsonl and exit 0. The batch gate `rows == distinct objectIDs` then
    passed as 0 == 0. That is the vacuous-PASS class this project has already been bitten by.
    """
    man = tmp_path / "m.json"
    man.write_text(json.dumps([
        {"objectID": "a", "url": "/blog/a", "fetch_error": "Hosted API rate limit exceeded"},
        {"objectID": "b", "url": "/blog/b", "fetch_error": "Hosted API rate limit exceeded"},
    ]))
    proc = _run_enrich(man, tmp_path / "out")
    assert proc.returncode != 0, "a manifest with 0 usable rows must not exit clean"
    assert "0 usable rows" in (proc.stdout + proc.stderr)


def test_empty_manifest_refuses_to_run(tmp_path):
    man = tmp_path / "m.json"
    man.write_text("[]")
    proc = _run_enrich(man, tmp_path / "out")
    assert proc.returncode != 0
    assert "0 usable rows" in (proc.stdout + proc.stderr)


# ---------------------------------------------------------------------------
# change 5 — never overwrite an already-verified enrichment
# ---------------------------------------------------------------------------

def _writable_row(oid: str) -> dict:
    """A row the writer would genuinely accept: PASS, verdict REAL, spans stored as an array."""
    return {
        "objectID": oid, "status": "PASS", "verdict": "REAL",
        "abstract_enriched": "A grounded sentence from the page.",
        "abstract_spans_stored": ["A grounded sentence from the page."],
        "keyhighlights_enriched": ["A highlight."],
    }


def test_writer_skips_already_enriched_ids():
    import write_enrichment
    rows = [_writable_row("keep"), _writable_row("skip_me")]
    payloads, skipped, skipped_ids = write_enrichment.build_payloads(rows, skip_ids={"skip_me"})
    assert [p["objectID"] for p in payloads] == ["keep"]
    assert skipped_ids == ["skip_me"]


def test_writer_skip_list_is_reported_not_silent():
    """A silent skip and a silent overwrite fail the same way: the count looks right."""
    import write_enrichment
    payloads, skipped, skipped_ids = write_enrichment.build_payloads(
        [_writable_row("skip_me")], skip_ids={"skip_me"})
    assert payloads == []
    assert skipped_ids == ["skip_me"], "the writer must name what it declined to write"


def test_writer_without_skip_list_writes_everything_writable():
    """The skip must come from the explicit list, never from a heuristic the caller can't see."""
    import write_enrichment
    rows = [_writable_row("a"), _writable_row("b")]
    payloads, _, skipped_ids = write_enrichment.build_payloads(rows)
    assert [p["objectID"] for p in payloads] == ["a", "b"]
    assert skipped_ids == []
