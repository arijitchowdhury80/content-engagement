from __future__ import annotations

import pytest

from algolia_enrichment.errors import EnrichmentError, ZeroWorkError
from algolia_enrichment.seed import (
    MAX_SEED_URLS,
    MIN_SEED_URLS,
    build_seed,
    canonical_key,
    merge_sources,
    parse_sitemap,
    to_absolute,
)

SITEMAP = """<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://www.algolia.com/doc/guides/one</loc></url>
  <url><loc>https://www.algolia.com/doc/guides/two/</loc></url>
  <url><loc>  https://www.algolia.com/doc/rest-api/three  </loc></url>
</urlset>"""


def test_parse_sitemap_extracts_every_loc_and_strips_whitespace():
    assert parse_sitemap(SITEMAP) == [
        "https://www.algolia.com/doc/guides/one",
        "https://www.algolia.com/doc/guides/two/",
        "https://www.algolia.com/doc/rest-api/three",
    ]


def test_parse_sitemap_ignores_malformed_entries_rather_than_crashing():
    broken = "<urlset><url><loc></loc></url><url><notloc>x</notloc></url>" \
             "<url><loc>https://www.algolia.com/doc/ok</loc></url></urlset>"
    assert parse_sitemap(broken) == ["https://www.algolia.com/doc/ok"]


def test_parse_sitemap_on_non_xml_is_an_error_not_an_empty_list():
    """An empty list would silently become 'the site has no pages' and trip the size gate with a
    misleading message. A wrong seeder poisons every downstream stage, so this fails loudly."""
    with pytest.raises(EnrichmentError):
        parse_sitemap("<html><body>Access denied</body></html>")


@pytest.mark.parametrize("raw", [
    "/doc/x",
    "/doc/x/",
    "https://algolia.com/doc/x",
    "https://www.algolia.com/doc/x",
    "https://www.algolia.com/doc/x/",
])
def test_all_spellings_of_one_page_collapse_to_one_key(raw):
    """79 objectIDs in the live index use the no-www host and the index mixes relative and
    absolute forms. If these do not collapse, reconciliation invents phantom new and retire rows."""
    assert canonical_key(raw) == "/doc/x"


def test_to_absolute_produces_the_www_form_for_every_spelling():
    for raw in ["/doc/x", "https://algolia.com/doc/x", "https://www.algolia.com/doc/x/"]:
        assert to_absolute(raw) == "https://www.algolia.com/doc/x"


def test_canonical_key_keeps_root_as_slash():
    assert canonical_key("https://www.algolia.com/") == "/"


def test_merge_sources_records_provenance_and_deduplicates():
    merged = merge_sources(sitemap=["/doc/a", "/doc/b"],
                           discovered=["/doc/b/", "https://www.algolia.com/doc/c"])
    by_key = {row["key"]: row for row in merged}
    assert set(by_key) == {"/doc/a", "/doc/b", "/doc/c"}
    assert by_key["/doc/a"]["provenance"] == "sitemap"
    assert by_key["/doc/b"]["provenance"] == "both"
    assert by_key["/doc/c"]["provenance"] == "discovered"
    assert by_key["/doc/c"]["url"] == "https://www.algolia.com/doc/c"


def test_merge_sources_output_is_sorted_so_runs_are_reproducible():
    merged = merge_sources(sitemap=["/doc/z", "/doc/a"], discovered=[])
    assert [row["key"] for row in merged] == ["/doc/a", "/doc/z"]


def test_build_seed_refuses_a_suspiciously_small_result():
    """Discovery misfiring is the failure that quietly destroys the corpus: a short seeder makes
    every missing page look like a page to retire."""
    with pytest.raises(EnrichmentError) as exc:
        build_seed(sitemap=[f"/doc/p{i}" for i in range(10)], discovered=[])
    assert str(MIN_SEED_URLS) in str(exc.value)


def test_build_seed_refuses_a_suspiciously_large_result():
    with pytest.raises(EnrichmentError):
        build_seed(sitemap=[f"/doc/p{i}" for i in range(MAX_SEED_URLS + 1)], discovered=[])


def test_build_seed_refuses_zero_work():
    with pytest.raises(ZeroWorkError):
        build_seed(sitemap=[], discovered=[])


def test_build_seed_returns_rows_and_a_report_within_bounds():
    urls = [f"/doc/p{i}" for i in range(MIN_SEED_URLS + 5)]
    seed = build_seed(sitemap=urls, discovered=["/doc/p0", "/doc/extra"])
    assert seed["report"]["total"] == len(seed["rows"]) == MIN_SEED_URLS + 6
    assert seed["report"]["provenance"]["both"] == 1
    assert seed["report"]["provenance"]["discovered"] == 1
    assert all(row["url"].startswith("https://www.algolia.com/") for row in seed["rows"])


def test_build_seed_only_accepts_doc_paths():
    """The refresh rebuilds the Documentation corpus. A stray /developers or /blog URL reaching
    the seeder would create records in the wrong corpus under a Documentation page_type."""
    seed = build_seed(sitemap=[f"/doc/p{i}" for i in range(MIN_SEED_URLS)],
                      discovered=["/developers/search-api-scala", "/blog/some-post"])
    assert all(row["key"].startswith("/doc") for row in seed["rows"])
    assert seed["report"]["rejected_out_of_scope"] == 2
