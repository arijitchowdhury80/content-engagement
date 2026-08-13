from __future__ import annotations

import json
from pathlib import Path

import pytest

from algolia_enrichment.errors import EnrichmentError, ZeroWorkError
from algolia_enrichment.url_normalization import (
    ALLOWED_HOSTS,
    Approval,
    build_plan,
    canonical_record_hash,
    classify_url,
    make_apply_payloads,
    read_approval,
    read_jsonl,
    resolve_rows,
    select_source_records,
    summarize,
    verify_http_results,
    verify_readback,
    write_jsonl,
)


def rec(object_id: str, url: str, **overrides):
    out = {
        "objectID": object_id,
        "url": url,
        "title": f"Title {object_id}",
        "source": "Website",
        "page_type": "product-page",
        "language_code": "en",
        "description": "Original description",
    }
    out.update(overrides)
    return out


def test_classify_url_resolves_relative_paths_against_www_without_fetching():
    row = classify_url(rec("a", "/de/products/ai-search"))
    assert row["old_url_kind"] == "relative"
    assert row["candidate_url"] == "https://www.algolia.com/de/products/ai-search"
    assert row["needs_http_verification"] is True


def test_classify_url_keeps_support_and_academy_absolute_urls():
    support = classify_url(rec("s", "https://support.algolia.com/hc/en-us/articles/1"))
    academy = classify_url(rec("a", "https://academy.algolia.com/training/abc"))
    assert support["candidate_url"] == "https://support.algolia.com/hc/en-us/articles/1"
    assert academy["candidate_url"] == "https://academy.algolia.com/training/abc"
    assert support["needs_http_verification"] is True
    assert academy["needs_http_verification"] is True


def test_classify_url_refuses_protocol_relative_and_unsupported_absolute_hosts():
    with pytest.raises(EnrichmentError, match="protocol-relative"):
        classify_url(rec("bad", "//support.algolia.com/hc"))
    with pytest.raises(EnrichmentError, match="unsupported host"):
        classify_url(rec("bad", "https://example.com/x"))


def test_build_plan_requires_full_record_coverage_and_detects_canonical_collisions():
    records = [rec("a", "/pricing"), rec("b", "https://www.algolia.com/pricing")]
    with pytest.raises(EnrichmentError, match="canonical URL collision"):
        build_plan(records, expected_total=2)
    with pytest.raises(EnrichmentError, match="expected 3 records"):
        build_plan([rec("a", "/pricing")], expected_total=3)


def test_audit_summary_counts_candidate_changes_before_http_verification():
    plan = build_plan([rec("a", "/pricing"),
                       rec("b", "https://support.algolia.com/hc/en-us/articles/1")],
                      expected_total=2)
    summary = summarize(plan.rows)
    assert summary["changed"] == 1
    assert summary["relative"] == 1
    assert summary["absolute"] == 1


def test_verify_http_results_uses_final_redirect_url_for_relative_records():
    plan = build_plan([rec("a", "/hc/en-us/articles/1")], expected_total=1)
    verified = verify_http_results(plan, {
        "a": {
            "ok": True,
            "status": 200,
            "final_url": "https://support.algolia.com/hc/en-us/articles/1",
            "content_type": "text/html",
            "redirects": 1,
        }
    })
    assert verified.rows[0]["final_url"] == "https://support.algolia.com/hc/en-us/articles/1"
    assert verified.rows[0]["final_host"] == "support.algolia.com"


def test_verify_http_results_refuses_unchecked_failed_or_unapproved_hosts():
    plan = build_plan([rec("a", "/pricing"), rec("b", "/bad")], expected_total=2)
    with pytest.raises(EnrichmentError, match="missing HTTP verification"):
        verify_http_results(plan, {"a": {"ok": True, "status": 200,
                                         "final_url": "https://www.algolia.com/pricing"}})
    with pytest.raises(EnrichmentError, match="HTTP verification failed"):
        verify_http_results(plan, {
            "a": {"ok": True, "status": 200, "final_url": "https://www.algolia.com/pricing"},
            "b": {"ok": False, "status": 404, "final_url": "https://www.algolia.com/bad"},
        })
    with pytest.raises(EnrichmentError, match="unsupported final host"):
        verify_http_results(plan, {
            "a": {"ok": True, "status": 200, "final_url": "https://www.algolia.com/pricing"},
            "b": {"ok": True, "status": 200, "final_url": "https://example.com/bad"},
        })


def test_make_apply_payloads_only_contains_objectid_and_url():
    plan = build_plan([rec("a", "/pricing")], expected_total=1)
    verified = verify_http_results(plan, {
        "a": {"ok": True, "status": 200, "final_url": "https://www.algolia.com/pricing"}
    })
    payloads = make_apply_payloads(verified)
    assert payloads == [{"objectID": "a", "url": "https://www.algolia.com/pricing"}]
    assert set(payloads[0]) == {"objectID", "url"}


def test_canonical_record_hash_ignores_url_and_verifier_catches_any_other_change():
    before = rec("a", "/pricing", description="same")
    after_ok = rec("a", "https://www.algolia.com/pricing", description="same")
    after_bad = rec("a", "https://www.algolia.com/pricing", description="changed")
    assert canonical_record_hash(before) == canonical_record_hash(after_ok)
    assert canonical_record_hash(before) != canonical_record_hash(after_bad)
    verified = verify_http_results(build_plan([before], expected_total=1), {
        "a": {"ok": True, "status": 200, "final_url": "https://www.algolia.com/pricing"}
    })
    assert verify_readback(verified, [after_ok], expected_total=1)["ok"] is True
    with pytest.raises(EnrichmentError, match="non-url hash changed"):
        verify_readback(verified, [after_bad], expected_total=1)


def test_read_approval_requires_matching_index_count_and_plan_hash(tmp_path: Path):
    approval = {
        "target_index": "Algolia_Prod_Copy_Enhanced",
        "expected_total_records": 11928,
        "expected_write_count": 10091,
        "plan_hash": "abc123",
        "approved_by": "arijit",
    }
    path = tmp_path / "url-normalization-approved.json"
    path.write_text(json.dumps(approval))
    got = read_approval(path, target_index="Algolia_Prod_Copy_Enhanced",
                        expected_total=11928, expected_write_count=10091,
                        plan_hash="abc123")
    assert isinstance(got, Approval)
    assert got.approved_by == "arijit"
    path.write_text(json.dumps({**approval, "expected_write_count": 1}))
    with pytest.raises(EnrichmentError, match="expected_write_count"):
        read_approval(path, target_index="Algolia_Prod_Copy_Enhanced",
                      expected_total=11928, expected_write_count=10091,
                      plan_hash="abc123")


def test_allowed_hosts_are_explicit_and_small():
    assert ALLOWED_HOSTS == {
        "www.algolia.com",
        "support.algolia.com",
        "academy.algolia.com",
    }


def test_jsonl_round_trip_survives_unicode_line_separator(tmp_path: Path):
    path = tmp_path / "rows.jsonl"
    write_jsonl(path, [{"objectID": "a", "title": "Unlock the power of\u2028agentic AI"}])
    assert len(path.read_text().split("\n")) == 2
    assert read_jsonl(path)[0]["title"] == "Unlock the power of\u2028agentic AI"


# --- source scoping and transient-failure retry -------------------------------------------


def test_select_source_records_keeps_only_named_sources_and_counts_them():
    records = [rec("a", "/blog/x", source="Blog"),
               rec("b", "/customers/y", source="Customer Stories"),
               rec("c", "/doc/z", source="Documentation")]
    selected, counts = select_source_records(records, ["Blog", "Customer Stories"])
    assert [r["objectID"] for r in selected] == ["a", "b"]
    assert counts == {"Blog": 1, "Customer Stories": 1}


def test_select_source_records_refuses_a_source_that_matches_nothing():
    records = [rec("a", "/blog/x", source="Blog")]
    with pytest.raises(ZeroWorkError, match="Custmer Stories"):
        select_source_records(records, ["Blog", "Custmer Stories"])


def test_select_source_records_refuses_an_empty_selection():
    with pytest.raises(ZeroWorkError):
        select_source_records([rec("a", "/blog/x", source="Blog")], [])


def test_resolve_rows_retries_a_transient_failure_before_calling_a_page_dead():
    """status 0 is 'we did not get an answer', never 'the page is gone'.

    Regression guard for the defect that recorded 3,580 blocked requests as dead pages
    against a true 108.
    """
    calls = {"n": 0}

    def flaky(url, timeout_s=30):
        calls["n"] += 1
        if calls["n"] == 1:
            return {"ok": False, "status": 0, "final_url": url, "content_type": "",
                    "redirects": 0, "error": "connection reset"}
        return {"ok": True, "status": 200, "final_url": url,
                "content_type": "text/html", "redirects": 0, "error": ""}

    rows = [{"objectID": "a", "candidate_url": "https://www.algolia.com/blog/x"}]
    results = resolve_rows(rows, workers=1, resolver=flaky, retries=2, retry_sleep_s=0)
    assert results["a"]["ok"] is True
    assert results["a"]["attempts"] == 2
    assert calls["n"] == 2


def test_resolve_rows_does_not_retry_a_definitive_404():
    calls = {"n": 0}

    def dead(url, timeout_s=30):
        calls["n"] += 1
        return {"ok": False, "status": 404, "final_url": url, "content_type": "text/html",
                "redirects": 0, "error": "HTTP 404"}

    rows = [{"objectID": "a", "candidate_url": "https://www.algolia.com/blog/gone"}]
    results = resolve_rows(rows, workers=1, resolver=dead, retries=3, retry_sleep_s=0)
    assert results["a"]["ok"] is False
    assert results["a"]["status"] == 404
    assert calls["n"] == 1, "a clean 404 is an answer; retrying it wastes the budget"


def test_resolve_rows_marks_a_row_that_never_answered_as_unresolved_not_dead():
    def never(url, timeout_s=30):
        return {"ok": False, "status": 0, "final_url": url, "content_type": "",
                "redirects": 0, "error": "timeout"}

    rows = [{"objectID": "a", "candidate_url": "https://www.algolia.com/blog/x"}]
    results = resolve_rows(rows, workers=1, resolver=never, retries=3, retry_sleep_s=0)
    assert results["a"]["ok"] is False
    assert results["a"]["status"] == 0
    assert results["a"]["attempts"] == 3
    assert results["a"]["verdict"] == "unresolved"


def test_resolve_rows_labels_a_404_as_dead_and_a_200_as_live():
    def mixed(url, timeout_s=30):
        if url.endswith("gone"):
            return {"ok": False, "status": 404, "final_url": url,
                    "content_type": "text/html", "redirects": 0, "error": "HTTP 404"}
        return {"ok": True, "status": 200, "final_url": url,
                "content_type": "text/html", "redirects": 0, "error": ""}

    rows = [{"objectID": "a", "candidate_url": "https://www.algolia.com/blog/gone"},
            {"objectID": "b", "candidate_url": "https://www.algolia.com/blog/here"}]
    results = resolve_rows(rows, workers=2, resolver=mixed, retries=2, retry_sleep_s=0)
    assert results["a"]["verdict"] == "dead"
    assert results["b"]["verdict"] == "live"


# --- identity, never status (ported from scout.py's rule) ---------------------------------


def test_verify_http_refuses_a_200_that_redirected_to_a_different_document():
    """`/customers/bringmeister` -> `/customers` is HTTP 200 and the wrong page.

    scout.py has asserted served-URL == requested-URL since 2026-08-10. This path only
    ever checked the status code, so the same soft-404 that Scout refuses would have been
    written into the live `url` field as if it were canonical.
    """
    plan = build_plan([rec("a", "/customers/bringmeister")], expected_total=1)
    with pytest.raises(EnrichmentError, match="redirected to a different document"):
        verify_http_results(plan, {
            "a": {"ok": True, "status": 200, "content_type": "text/html", "redirects": 1,
                  "final_url": "https://www.algolia.com/customers"},
        })


def test_verify_http_allows_a_redirect_that_lands_on_the_requested_document():
    """Trailing slash and percent-escaping may move; the document may not.

    Case is NOT normalised, matching scout.path_of exactly.
    """
    plan = build_plan([rec("a", "/customers/crocs")], expected_total=1)
    verified = verify_http_results(plan, {
        "a": {"ok": True, "status": 200, "content_type": "text/html", "redirects": 1,
              "final_url": "https://www.algolia.com/customers/crocs/"},
    })
    assert verified.rows[0]["final_url"] == "https://www.algolia.com/customers/crocs/"


def test_verify_http_allows_a_cross_host_redirect_to_the_same_path():
    plan = build_plan([rec("a", "/hc/en-us/articles/1")], expected_total=1)
    verified = verify_http_results(plan, {
        "a": {"ok": True, "status": 200, "content_type": "text/html", "redirects": 1,
              "final_url": "https://support.algolia.com/hc/en-us/articles/1"},
    })
    assert verified.rows[0]["final_host"] == "support.algolia.com"


def test_verify_http_reports_the_hub_soft_404_by_name_not_just_as_a_mismatch():
    plan = build_plan([rec("a", "/customers/kingarthur")], expected_total=1)
    with pytest.raises(EnrichmentError, match="/customer-hub"):
        verify_http_results(plan, {
            "a": {"ok": True, "status": 200, "content_type": "text/html", "redirects": 2,
                  "final_url": "https://www.algolia.com/customer-hub"},
        })


def test_document_identity_is_case_sensitive_exactly_like_scouts_path_of():
    """One rule, one implementation. A paraphrase here is how the original split began."""
    from algolia_enrichment.scout import path_of
    from algolia_enrichment.url_normalization import _document_path

    for url in ("https://www.algolia.com/customers/WeightWatchers",
                "https://www.algolia.com/customers/weightwatchers",
                "https://www.algolia.com/customers/crocs/",
                "https://support.algolia.com/hc/en-us/articles/1"):
        assert _document_path(url) == path_of(url)

    plan = build_plan([rec("a", "/customers/WeightWatchers")], expected_total=1)
    with pytest.raises(EnrichmentError, match="redirected to a different document"):
        verify_http_results(plan, {
            "a": {"ok": True, "status": 200, "content_type": "text/html", "redirects": 1,
                  "final_url": "https://www.algolia.com/customers/weightwatchers"},
        })
