"""Discover every live Documentation URL, from the site's own sitemap plus a crawl.

WHY A SEEDER EXISTS AT ALL.
  The index was crawled on 2026-07-21 and the docs site has since been rebuilt on Mintlify:
  per-language SDK pages were folded into single tabbed pages and the old URLs now redirect.
  4,337 records describe roughly 1,890 real pages. Rebuilding the corpus needs a list of what
  exists NOW, and the only authorities for that are the site's sitemap and a crawl of it.

THE SEEDER IS THE MOST DANGEROUS ARTEFACT IN THE REFRESH.
  Reconciliation classifies any indexed URL missing from the seeder as a record to RETIRE. A
  seeder that is short by 500 URLs therefore proposes deleting 500 live pages. Every guard here
  exists for that reason: parse failures raise instead of returning an empty list, the result is
  size-gated, and anything outside /doc is rejected rather than quietly carried.

THE SITEMAP IS NOT COMPLETE.
  Measured 2026-08-12: 45 URLs that live records resolve to, HTTP 200, are absent from
  `/doc/sitemap.xml` -- `/doc/glossary` among them. So the sitemap is a floor, not the truth, and
  a second discovery source is unioned into it rather than trusted to agree.
"""

from __future__ import annotations

import re
from collections import Counter
from urllib.parse import urlparse

from .errors import EnrichmentError, ZeroWorkError

BASE_URL = "https://www.algolia.com"
SCOPE_PREFIX = "/doc"

# Bounds on a plausible Documentation corpus. The sitemap held 1,890 URLs and an independent
# redirect census of all 4,337 records resolved to 1,921 distinct pages, so anything far outside
# that band means discovery misfired and must not be allowed to drive deletions.
MIN_SEED_URLS = 1500
MAX_SEED_URLS = 3000

_LOC = re.compile(r"<loc>\s*([^<\s]+)\s*</loc>")


def parse_sitemap(xml: str) -> list[str]:
    """Every `<loc>` in document order.

    Raises rather than returning `[]` when the payload is not a sitemap. A WAF challenge page or
    an HTML error page parses to zero matches, and a silent empty list would reach the size gate
    as "the site has no pages" instead of "we were blocked".
    """
    if "<loc>" not in xml:
        raise EnrichmentError(
            "sitemap payload contains no <loc> element -- this is not a sitemap. "
            "A blocked request or an error page must not be read as an empty site.")
    return [match.strip() for match in _LOC.findall(xml) if match.strip()]


def canonical_key(url: str) -> str:
    """Path-only identity for a page: `/doc/x`.

    The live index mixes spellings of the same page -- relative `/doc/x`, absolute with and
    without `www`, and with or without a trailing slash (79 objectIDs use the no-www host). They
    must collapse to one key or reconciliation invents phantom `new` and `retire` rows for what
    is really a single page.
    """
    path = urlparse(url).path if "://" in url else (url or "")
    return path.rstrip("/") or "/"


def to_absolute(url: str) -> str:
    """The one canonical spelling written to the index."""
    return f"{BASE_URL}{canonical_key(url)}"


def _in_scope(key: str) -> bool:
    return key == SCOPE_PREFIX or key.startswith(SCOPE_PREFIX + "/")


def merge_sources(sitemap: list[str], discovered: list[str]) -> list[dict]:
    """Union both discovery sources, keyed by canonical path, recording where each URL came from.

    Provenance is kept because the two sources disagreeing is a finding in itself: URLs only a
    crawl can see are pages the sitemap omits, and that is how we learned the sitemap is a floor.
    """
    from_sitemap = {canonical_key(u) for u in sitemap if u}
    from_discovered = {canonical_key(u) for u in discovered if u}

    rows = []
    for key in sorted(from_sitemap | from_discovered):
        in_s, in_d = key in from_sitemap, key in from_discovered
        rows.append({
            "key": key,
            "url": f"{BASE_URL}{key}",
            "provenance": "both" if in_s and in_d else ("sitemap" if in_s else "discovered"),
        })
    return rows


def build_seed(sitemap: list[str], discovered: list[str]) -> dict:
    """Merged, scoped, size-gated seed list plus the report that justifies it."""
    merged = merge_sources(sitemap, discovered)
    in_scope = [row for row in merged if _in_scope(row["key"])]
    rejected = len(merged) - len(in_scope)

    if not in_scope:
        raise ZeroWorkError(
            "seed discovery produced zero /doc URLs. Zero work is not a corpus refresh.")

    total = len(in_scope)
    if total < MIN_SEED_URLS or total > MAX_SEED_URLS:
        raise EnrichmentError(
            f"seed discovery returned {total} URLs, outside the plausible band "
            f"{MIN_SEED_URLS}-{MAX_SEED_URLS}. Reconciliation would treat every missing URL as a "
            f"record to retire, so a misfiring seeder is refused rather than acted on.")

    provenance = Counter(row["provenance"] for row in in_scope)
    return {
        "rows": in_scope,
        "report": {
            "total": total,
            "provenance": dict(provenance),
            "rejected_out_of_scope": rejected,
            "sitemap_input": len(sitemap),
            "discovered_input": len(discovered),
            "scope_prefix": SCOPE_PREFIX,
        },
    }
