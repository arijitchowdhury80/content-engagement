from __future__ import annotations

import json
from pathlib import Path

import pytest

from algolia_enrichment.errors import EnrichmentError
from algolia_enrichment.url_normalization import (
    ALLOWED_HOSTS,
    Approval,
    build_plan,
    canonical_record_hash,
    classify_url,
    make_apply_payloads,
    read_approval,
    read_jsonl,
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
