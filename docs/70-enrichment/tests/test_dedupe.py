#!/usr/bin/env python3
"""
Tests for dedupe.py — written before the destructive path, per precondition P4.

This script deletes 4,853 records from a live index. Every rule it applies is
tested here against a hand-built fixture, so a regression shows up as a red test
rather than as missing data nobody notices.

    python3 -m pytest docs/70-enrichment/tests/test_dedupe.py -q
"""

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import dedupe  # noqa: E402


def rec(oid, url, env="prod20260722", indexed_at=1000, **fields):
    r = {"objectID": oid, "url": url, "environment": env, "indexed_at": indexed_at}
    r.update(fields)
    return r


# --- canonical URL grouping -------------------------------------------------

class TestCanonUrl:
    def test_strips_host(self):
        assert dedupe.canon_url("https://www.algolia.com/pricing") == "/pricing"

    def test_strips_locale_prefix(self):
        # A /fr/ page and its English twin are DIFFERENT pages with different
        # content. They must NOT be collapsed into one another.
        assert dedupe.canon_url("/fr/pricing") != dedupe.canon_url("/pricing")

    def test_strips_query_and_fragment(self):
        assert dedupe.canon_url("/pricing?utm=x#top") == "/pricing"

    def test_strips_trailing_slash(self):
        assert dedupe.canon_url("/pricing/") == dedupe.canon_url("/pricing")

    def test_root_survives(self):
        assert dedupe.canon_url("/") == "/"

    def test_non_default_hosts_are_kept(self):
        # 1,695 support + 337 academy + 79 greenhouse URLs are absolute. Stripping
        # their host would collide them with the www path space.
        assert dedupe.canon_url("https://support.algolia.com/hc/en-us/articles/1") \
            != dedupe.canon_url("/hc/en-us/articles/1")
        assert dedupe.canon_url("https://academy.algolia.com/x") \
            != dedupe.canon_url("https://support.algolia.com/x")

    def test_case_is_preserved(self):
        # /customers/WeightWatchers and /customers/weightwatchers are distinct
        # URLs on this site; lowercasing would merge two real pages.
        assert dedupe.canon_url("/customers/KingArthur") != dedupe.canon_url("/customers/kingarthur")


# --- chunk detection --------------------------------------------------------

class TestChunkDetection:
    def test_plain_objectid_is_not_a_chunk(self):
        base, is_chunk = dedupe.chunk_base("en_7ed2856b-6ab1-49b7-a1ea-8c7f69b93503")
        assert is_chunk is False
        assert base == "en_7ed2856b-6ab1-49b7-a1ea-8c7f69b93503"

    def test_suffixed_objectid_is_a_chunk(self):
        base, is_chunk = dedupe.chunk_base("en_7ed2856b-6ab1-49b7-a1ea-8c7f69b93503_3_0")
        assert is_chunk is True
        assert base == "en_7ed2856b-6ab1-49b7-a1ea-8c7f69b93503"

    def test_siblings_share_a_base(self):
        a, _ = dedupe.chunk_base("fr_3dc2c50c_0_65")
        b, _ = dedupe.chunk_base("fr_3dc2c50c_0_66")
        assert a == b

    def test_url_shaped_objectid_is_never_a_chunk(self):
        # 8,507 objectIDs in this corpus are absolute URLs. A URL that happens
        # to end in _3_0 must not be mistaken for a chunk suffix.
        oid = "https://www.algolia.com/doc/api/v1_3_0"
        base, is_chunk = dedupe.chunk_base(oid)
        assert is_chunk is False
        assert base == oid


# --- environment ranking (P6) -----------------------------------------------

class TestEnvironmentRank:
    def test_newer_prod_outranks_older_prod(self):
        assert dedupe.env_rank("prod20260722") < dedupe.env_rank("prod20260621")

    def test_prod_outranks_nonprod(self):
        assert dedupe.env_rank("prod20260621") < dedupe.env_rank("nonprod20260220")

    def test_every_known_environment_has_a_rank(self):
        for env in ["prod20260722", "prod20260621", "prod03042026",
                    "nonprod20260220", "nonprod9", "nonprod", None]:
            assert isinstance(dedupe.env_rank(env), int)

    def test_unknown_environment_hard_fails(self):
        # P6: never silently demote an unrecognised value to last place.
        with pytest.raises(dedupe.UnknownEnvironment) as e:
            dedupe.env_rank("prod20270101")
        assert "prod20270101" in str(e.value)


# --- survivor election ------------------------------------------------------

class TestElectSurvivor:
    def test_newest_environment_wins(self):
        old = rec("a", "/p", env="nonprod20260220")
        new = rec("b", "/p", env="prod20260722")
        survivor, losers = dedupe.elect([old, new])
        assert survivor["objectID"] == "b"
        assert [l["objectID"] for l in losers] == ["a"]

    def test_indexed_at_breaks_an_environment_tie(self):
        a = rec("a", "/p", indexed_at=100)
        b = rec("b", "/p", indexed_at=200)
        survivor, _ = dedupe.elect([a, b])
        assert survivor["objectID"] == "b"

    def test_objectid_breaks_a_full_tie_deterministically(self):
        a = rec("zzz", "/p", indexed_at=100)
        b = rec("aaa", "/p", indexed_at=100)
        first, _ = dedupe.elect([a, b])
        second, _ = dedupe.elect([b, a])
        assert first["objectID"] == second["objectID"] == "aaa"

    def test_input_order_never_changes_the_outcome(self):
        group = [rec("c", "/p", env="nonprod", indexed_at=900),
                 rec("a", "/p", env="prod20260621", indexed_at=100),
                 rec("b", "/p", env="prod20260722", indexed_at=100)]
        assert dedupe.elect(group)[0]["objectID"] == "b"
        assert dedupe.elect(list(reversed(group)))[0]["objectID"] == "b"

    def test_a_single_record_has_no_losers(self):
        survivor, losers = dedupe.elect([rec("a", "/p")])
        assert survivor["objectID"] == "a"
        assert losers == []

    def test_missing_indexed_at_does_not_crash(self):
        a = {"objectID": "a", "url": "/p", "environment": "prod20260722"}
        b = rec("b", "/p", indexed_at=5)
        survivor, _ = dedupe.elect([a, b])
        assert survivor["objectID"] == "b"


# --- field rescue -----------------------------------------------------------

class TestRescue:
    def test_empty_survivor_field_is_filled_from_a_loser(self):
        s = rec("s", "/p", tags=[])
        l = rec("l", "/p", tags=["search", "ai"])
        merged, rescues = dedupe.rescue(s, [l])
        assert merged["tags"] == ["search", "ai"]
        assert any(r["field"] == "tags" for r in rescues)

    def test_absent_survivor_field_is_filled_from_a_loser(self):
        s = rec("s", "/p")
        l = rec("l", "/p", abstract="a real abstract")
        merged, _ = dedupe.rescue(s, [l])
        assert merged["abstract"] == "a real abstract"

    def test_a_populated_survivor_field_is_never_overwritten(self):
        # Measured on the live corpus 2026-08-06: preferring the longer value
        # would have replaced "What is federated search?" with
        # "What is Federated Search? | Algolia | Algolia", and clean prose
        # descriptions with raw <blockquote>&ldquo; HTML. Longer is not better.
        s = rec("s", "/p", title="What is federated search?")
        l = rec("l", "/p", title="What is Federated Search? | Algolia | Algolia")
        merged, rescues = dedupe.rescue(s, [l])
        assert merged["title"] == "What is federated search?"
        assert rescues == []

    def test_shorter_loser_value_is_ignored(self):
        s = rec("s", "/p", title="Pricing plans for every team")
        l = rec("l", "/p", title="Pricing")
        merged, rescues = dedupe.rescue(s, [l])
        assert merged["title"] == "Pricing plans for every team"
        assert rescues == []

    def test_whitespace_only_survivor_counts_as_empty(self):
        s = rec("s", "/p", abstract="   ")
        l = rec("l", "/p", abstract="a real abstract")
        merged, _ = dedupe.rescue(s, [l])
        assert merged["abstract"] == "a real abstract"

    def test_when_the_survivor_is_empty_the_fullest_loser_wins(self):
        # Choosing among losers still needs a tiebreak, and it must be
        # deterministic. Fullest value, then the election order.
        s = rec("s", "/p", abstract="")
        losers = [rec("l1", "/p", abstract="short"),
                  rec("l2", "/p", abstract="a considerably longer abstract"),
                  rec("l3", "/p", abstract="mid length")]
        merged, _ = dedupe.rescue(s, losers)
        assert merged["abstract"] == "a considerably longer abstract"

    def test_identity_fields_are_never_rescued(self):
        # Taking a loser's objectID or url would corrupt the record's identity.
        s = rec("s", "/p", indexed_at=1)
        l = rec("llllllllll", "/p-longer-url", indexed_at=999)
        merged, _ = dedupe.rescue(s, [l])
        assert merged["objectID"] == "s"
        assert merged["url"] == "/p"
        assert merged["indexed_at"] == 1

    def test_taxonomy_fields_are_never_rescued(self):
        # Duplicate-URL taxonomy divergence is 0, so there is nothing to rescue,
        # and merging arrays across records could invent a combination that no
        # classifier ever produced.
        s = rec("s", "/p", product=["ai-search"])
        l = rec("l", "/p", product=["ai-search", "recommend", "autocomplete"])
        merged, rescues = dedupe.rescue(s, [l])
        assert merged["product"] == ["ai-search"]
        assert rescues == []

    def test_rescue_records_both_values_for_review(self):
        s = rec("s", "/p", description="")
        l = rec("l", "/p", description="a real description")
        _, rescues = dedupe.rescue(s, [l])
        r = rescues[0]
        assert r["field"] == "description"
        assert r["survivor_value"] == ""
        assert r["rescued_value"] == "a real description"
        assert r["from_objectID"] == "l"

    def test_survivor_is_not_mutated_in_place(self):
        s = rec("s", "/p", title="short")
        l = rec("l", "/p", title="much longer title")
        dedupe.rescue(s, [l])
        assert s["title"] == "short"


# --- planning ---------------------------------------------------------------

class TestPlan:
    def test_unique_urls_produce_no_deletions(self):
        plan = dedupe.plan([rec("a", "/one"), rec("b", "/two")])
        assert plan.delete_ids == []
        assert plan.survivor_count == 2

    def test_duplicates_collapse_to_one_survivor_per_url(self):
        recs = [rec("a", "/p", env="prod20260722"),
                rec("b", "/p", env="prod20260621"),
                rec("c", "/other")]
        plan = dedupe.plan(recs)
        assert plan.survivor_count == 2
        assert plan.delete_ids == ["b"]

    def test_locale_twins_are_not_collapsed(self):
        plan = dedupe.plan([rec("en", "/pricing"), rec("fr", "/fr/pricing")])
        assert plan.delete_ids == []

    def test_chunk_groups_are_reported_separately(self):
        recs = [rec("x_0_1", "/ebook"), rec("x_0_2", "/ebook"), rec("y", "/plain"),
                rec("z", "/plain")]
        plan = dedupe.plan(recs)
        assert plan.chunk_group_count == 1
        assert plan.duplicate_group_count == 1

    def test_a_url_seen_only_under_nonprod_still_survives(self):
        # The 329 nonprod-only URLs are real pages. Nothing filters on environment.
        plan = dedupe.plan([rec("a", "/customers/kingarthur", env="nonprod20260220")])
        assert plan.delete_ids == []
        assert plan.survivor_count == 1

    def test_unknown_environment_aborts_the_whole_plan(self):
        with pytest.raises(dedupe.UnknownEnvironment):
            dedupe.plan([rec("a", "/p", env="prod20991231")])

    def test_plan_is_deterministic_across_runs(self):
        recs = [rec(c, "/p", indexed_at=i) for i, c in enumerate("abcdef")]
        assert dedupe.plan(recs).delete_ids == dedupe.plan(list(reversed(recs))).delete_ids


# --- the dry-run guard (P4) -------------------------------------------------

class TestDryRunWritesNothing:
    def test_dry_run_issues_no_write_call(self, monkeypatch):
        calls = []
        monkeypatch.setattr(dedupe, "curl",
                            lambda method, url, *a, **k: calls.append((method, url)) or {})
        recs = [rec("a", "/p", env="prod20260722"), rec("b", "/p", env="prod20260621")]
        dedupe.execute(dedupe.plan(recs), index="X", app="A", key="K", apply=False)
        assert calls == [], f"--dry-run issued write calls: {calls}"

    def test_apply_refuses_without_a_snapshot(self):
        recs = [rec("a", "/p"), rec("b", "/p", env="prod20260621")]
        with pytest.raises(dedupe.SnapshotRequired):
            dedupe.execute(dedupe.plan(recs), index="X", app="A", key="K",
                           apply=True, snapshot_verified=False)
