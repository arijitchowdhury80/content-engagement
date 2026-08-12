from __future__ import annotations

import pytest

from algolia_enrichment.errors import EnrichmentError
from algolia_enrichment.reconcile import (
    REASON_DEAD,
    REASON_DUPLICATE,
    REASON_STALE,
    reconcile,
)


def rec(object_id: str, url: str):
    return {"objectID": object_id, "url": url, "title": f"T {object_id}",
            "source": "Documentation", "page_type": "doc-guide"}


def seed(*keys):
    return [{"key": k, "url": f"https://www.algolia.com{k}", "provenance": "sitemap"}
            for k in keys]


def test_record_whose_url_is_live_today_is_refreshed():
    out = reconcile(seed("/doc/a"), [rec("1", "/doc/a")], dead_keys=set())
    assert [r["objectID"] for r in out["refresh"]] == ["1"]
    assert out["new"] == [] and out["retire"] == []


def test_live_page_with_no_record_is_new():
    out = reconcile(seed("/doc/a", "/doc/b"), [rec("1", "/doc/a")], dead_keys=set())
    assert [r["key"] for r in out["new"]] == ["/doc/b"]


def test_record_absent_from_the_live_site_is_retired_as_stale():
    out = reconcile(seed("/doc/a"), [rec("1", "/doc/a"), rec("2", "/doc/gone")],
                    dead_keys=set())
    assert [(r["objectID"], r["reason"]) for r in out["retire"]] == [("2", REASON_STALE)]


def test_a_record_known_to_404_is_retired_as_dead_not_merely_stale():
    """Dead and stale are both retired, but they are different findings and the quarantine
    record must say which: a 404 is a page that vanished, a stale URL is a page that moved."""
    out = reconcile(seed("/doc/a"), [rec("1", "/doc/a"), rec("2", "/doc/gone")],
                    dead_keys={"/doc/gone"})
    assert out["retire"][0]["reason"] == REASON_DEAD


def test_absolute_and_relative_spellings_of_one_url_match_the_same_seed_key():
    """79 objectIDs in the live index use the no-www host. Without collapsing, each of those
    records would be classified as a page to delete."""
    records = [rec("1", "https://algolia.com/doc/a"),
               rec("2", "https://www.algolia.com/doc/b/")]
    out = reconcile(seed("/doc/a", "/doc/b"), records, dead_keys=set())
    assert len(out["refresh"]) == 2
    assert out["retire"] == [] and out["new"] == []


def test_two_records_on_one_page_keep_one_survivor_and_retire_the_rest():
    """The corpus holds up to 13 records per real page. Refreshing all of them would rewrite the
    same page many times and leave the duplication in place."""
    records = [rec("1", "/doc/a"), rec("2", "/doc/a/")]
    out = reconcile(seed("/doc/a"), records, dead_keys=set())
    assert len(out["refresh"]) == 1
    assert [r["reason"] for r in out["retire"]] == [REASON_DUPLICATE]


def test_survivor_election_is_deterministic_across_runs():
    records = [rec("z", "/doc/a/"), rec("a", "/doc/a")]
    first = reconcile(seed("/doc/a"), records, dead_keys=set())
    second = reconcile(seed("/doc/a"), list(reversed(records)), dead_keys=set())
    assert first["refresh"][0]["objectID"] == second["refresh"][0]["objectID"]


def test_survivor_prefers_the_record_already_spelled_canonically():
    records = [rec("variant", "https://algolia.com/doc/a/"), rec("canon", "/doc/a")]
    out = reconcile(seed("/doc/a"), records, dead_keys=set())
    assert out["refresh"][0]["objectID"] == "canon"


def test_every_input_record_lands_in_exactly_one_bucket():
    """The partition is the safety property: a record that falls through both buckets is a record
    silently left behind, and one counted twice is a record deleted after being refreshed."""
    records = [rec(str(i), f"/doc/p{i}") for i in range(5)] + [rec("dup", "/doc/p0/")]
    out = reconcile(seed("/doc/p0", "/doc/p1", "/doc/new"), records, dead_keys=set())
    landed = [r["objectID"] for r in out["refresh"]] + [r["objectID"] for r in out["retire"]]
    assert sorted(landed) == sorted(r["objectID"] for r in records)
    assert len(landed) == len(set(landed))


def test_report_counts_match_the_buckets_exactly():
    records = [rec("1", "/doc/a"), rec("2", "/doc/gone")]
    out = reconcile(seed("/doc/a", "/doc/b"), records, dead_keys={"/doc/gone"})
    assert out["report"]["input_records"] == 2
    assert out["report"]["refresh"] == len(out["refresh"]) == 1
    assert out["report"]["retire"] == len(out["retire"]) == 1
    assert out["report"]["new"] == len(out["new"]) == 1
    assert out["report"]["predicted_final_count"] == 2


def test_reconcile_refuses_an_empty_seed():
    """An empty seed classifies the entire corpus as deletable."""
    with pytest.raises(EnrichmentError):
        reconcile([], [rec("1", "/doc/a")], dead_keys=set())


def test_reconcile_refuses_an_empty_record_set():
    with pytest.raises(EnrichmentError):
        reconcile(seed("/doc/a"), [], dead_keys=set())


def test_retiring_more_than_the_guard_share_is_refused():
    """Retiring 57% is the measured, expected outcome here. Retiring nearly everything means the
    seeder or the match logic broke, and that must stop the run rather than empty the corpus."""
    records = [rec(str(i), f"/doc/p{i}") for i in range(100)]
    with pytest.raises(EnrichmentError) as exc:
        reconcile(seed("/doc/p0"), records, dead_keys=set(), max_retire_share=0.9)
    assert "retire" in str(exc.value).lower()
