"""shape_probe is a bounded instrument, and these tests are what makes that a fact rather than an
intention.

Codex, 2026-08-09: "Treat the probe override as a disposable, bounded Phase 1 instrument." The
bound has to be checkable, because the alternative -- a `--force-scout` flag someone forgets to turn
off -- is exactly the class of mistake this project keeps paying for.
"""

from __future__ import annotations

import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HERE))

import shape_probe as sp  # noqa: E402


def test_allowlist_is_exactly_ten_doc_pages():
    assert len(sp.ALLOWLIST) == 10
    assert len(set(sp.ALLOWLIST)) == 10
    assert all(u.startswith("/doc/") for u in sp.ALLOWLIST)


def test_probe_resolves_to_the_allowlist_and_nothing_else():
    records = sp.probe_records()
    assert [r["url"] for r in records] == list(sp.ALLOWLIST)


def test_the_md_twin_fetcher_is_not_reachable_from_this_module():
    """No `.md` fallback -- structurally, not by policy. The function is never imported, so there
    is no code path, tested or untested, that can reach it."""
    assert not hasattr(sp, "fetch_doc_md_twin")
    source = (HERE / "shape_probe.py").read_text(encoding="utf-8")
    assert "fetch_doc_md_twin" not in source.split('"""')[2]   # skip the module docstring


def test_the_production_router_is_never_consulted():
    """The probe does not call fetch_path_for(), so it cannot inherit production's routing decision
    and cannot change it either.

    Updated 2026-08-09: production now routes `/doc` to Scout by Arijit's directive, so this no
    longer asserts `doc-md-twin`. The probe's independence is the invariant; the route it is
    independent OF is not."""
    assert not hasattr(sp, "fetch_path_for")
    import fetch_router
    assert fetch_router.fetch_path_for("/doc/rest-api/search") == "scout"


def test_bodies_can_only_land_under_the_scout_root():
    import assert_scout_provenance as asp
    assert asp.SCOUT_ROOT in sp.PROBE_DIR.resolve().parents or sp.PROBE_DIR.resolve() == asp.SCOUT_ROOT
    assert sp.QUARANTINE_DIR.resolve().is_relative_to(sp.PROBE_DIR.resolve())


def test_overlap_catches_containment_not_just_jaccard():
    """The near-duplicate measure fix D needs on Scout. A candidate that wholly contains the
    description scores low on Jaccard alone and would slip through."""
    description = "Search the index."
    candidate = "Search the index. This endpoint accepts a query and returns ranked hits quickly."
    assert sp.overlap(candidate, description) >= sp.NEAR_DUP_BAR
    assert sp.overlap("An unrelated sentence about billing plans.", description) < sp.NEAR_DUP_BAR
