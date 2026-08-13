#!/usr/bin/env python3
"""
The pre-selection pool gates, driven through enrich_run.process().

WHY THESE TESTS DRIVE process() AND NOT pool_gates DIRECTLY
  This repo has twice shipped a gate "fix" into a function nothing calls -- `span_gate.run_gates`
  is reachable only from `--replay`, and the live path is inline in `process()`. Both times every
  unit test passed and the pipeline behaved exactly as before. A unit test on `apply_pool_gates`
  would prove the function works. It would not prove the pipeline uses it, which is the thing that
  was wrong last time.

WHAT IS BEING GUARDED
  589 of 2,800 blog records were quarantined by gates whose verdict was decidable from the page
  before the model picked anything: a span the page contradicts in its next sentence, a span from
  "Next Steps", a span saying "in this article", a subject-less opening. Each of those killed the
  whole record. These tests assert the pipeline now removes or repairs the offending CANDIDATE and
  still produces an enriched record.

    python3 -m pytest docs/operations/enrichment/tests/test_pool_gates_live_path.py -q
"""

import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.dirname(__file__))

import enrich_run as E  # noqa: E402
import pool_gates as PG  # noqa: E402
from span_gate import canonicalise  # noqa: E402


# A page carrying one instance of each defect class, and enough clean prose to recover from all of
# them. Written as a Scout body would arrive: markdown, headings, no chrome stripped.
PAGE = """# Dynamic Facets explained

Dynamic Facets reorders a store's refinement panel using live search behaviour rather than a
fixed order chosen at implementation time. Merchandisers keep their curation and the engine
handles the ordering underneath it. Retailers running the feature reported clickthrough gains of
10 to 15 percentage points on individual filters. Ranking quality held steady across the full
catalogue during the trial period. Setup took under one hour for the teams that measured it.

## How it behaves under load

Facet ordering is recomputed on every query without a separate training step. It lets multiple
software programs exchange data according to an agreed contract. The index is rebuilt nightly and
the ordering model reads from the same event stream.

Query latency stayed within the same envelope as a static facet order during the load tests that
the engineering team ran before release. Attribute cardinality is the variable that matters most,
and catalogues above roughly two hundred distinct values per attribute saw the clearest gains.
Event volume also matters, because the ordering model reads click and conversion signals from the
previous seven days rather than from the whole history of the index.

## A caveat worth stating

Dynamic Facets works well on catalogues with dense attribute coverage. However, sparse catalogues
see almost no benefit and should stay on a manual order.

## Next Steps

By integrating these into your existing CMS or other backend you can ship the feature in a
sprint. Talk to an expert about a rollout plan for your own catalogue.
"""


def _record(**over):
    rec = {
        "objectID": "en_pool_gates", "url": "/blog/product/dynamic-facets",
        "source_url": "https://www.algolia.com/blog/product/dynamic-facets",
        "page_type": "blog-post", "family": "editorial", "language_code": "en",
        "fetch_path": "scout", "markdown": PAGE, "content_hash": "h",
        "served_url": "/blog/product/dynamic-facets", "redirect_mismatch": False,
        "title": "Dynamic Facets explained", "description": "A short marketing line.",
        "http_status": 200, "fetch_error": "",
    }
    rec.update(over)
    return rec


def _pool(rec=None):
    """The menu process() would build, after both filter stages."""
    from candidates import split_candidates
    from pool_filters import filter_pool
    rec = rec or _record()
    cands, canon = split_candidates(rec["markdown"], already_indexed=rec["description"])
    unfiltered = cands
    cands, _, _ = filter_pool(cands, description=rec["description"], title=rec["title"])
    kept, counts, trace, ineligible = PG.apply_pool_gates(
        cands, canon, rec["family"], rec["title"], unfiltered=unfiltered)
    return kept, counts, ineligible


def _index_of(fragment: str, pool) -> int:
    for c in pool:
        if fragment in c.text:
            return c.index
    raise AssertionError(f"no candidate contains {fragment!r}; "
                         f"menu was {[c.text[:60] for c in pool]}")


@pytest.fixture
def stub(monkeypatch):
    """Drive process() with a scripted writer that picks by text fragment."""
    state = {"writer": 0, "menus": []}

    def make(abstract_frags, highlight_frags, second_abstract=None):
        def fake_writer(prompt):
            state["writer"] += 1
            state["menus"].append(prompt)
            frags = (abstract_frags if state["writer"] == 1 or second_abstract is None
                     else second_abstract)
            # Resolve against the menu THIS call was given, which is the point: on a retry the
            # banned candidates are gone and a stale index would silently address a different span.
            menu = [line for line in prompt.split("\n") if line.startswith("[")]

            def idx(frag):
                for line in menu:
                    if frag in line:
                        return int(line[1:line.index("]")])
                raise AssertionError(f"{frag!r} is not on the menu handed to the writer")

            return ({"verdict": "REAL", "abstract": [idx(f) for f in frags],
                     "highlights": [idx(f) for f in highlight_frags],
                     "language_observed": "en", "insufficient_reason": None},
                    {"cost_usd": 0.0, "raw": "", "writer": "stub", "http_status": 200})

        def fake_judge(prompt):
            return {"representativeness": 5, "specificity": 5, "missed_substance": 5,
                    "coherence": 5, "juxtaposition": 5, "better_span_available": None,
                    "verdict": "ACCEPT"}, None

        monkeypatch.setattr(E, "call_writer", fake_writer)
        monkeypatch.setattr(E, "call_judge", fake_judge)
        return state
    return make


HL = ["Merchandisers keep their curation",
      "Ranking quality held steady across the full catalogue",
      "Setup took under one hour",
      "Event volume also matters"]

# The abstract picks for the subject-failure tests. Both live in the same section and
# "It lets multiple..." sorts FIRST in page order, which is what makes it the OPENING span --
# resolve_selection sorts by page offset, not by the order the model returned them, so a
# subject-less pick only trips G4 when the page puts it first.
BAD_OPENER = ["It lets multiple software programs exchange data",
              "Query latency stayed within the same envelope"]
GOOD_OPENER = ["Facet ordering is recomputed on every query",
               "Query latency stayed within the same envelope"]


# --- the bans, measured on the menu the model is actually handed -------------------------

def test_a_reversed_span_is_extended_over_its_own_contradiction():
    """Repair before quarantine: the contrast is page text, so keep both halves."""
    kept, counts, _ = _pool()
    assert counts.get(PG.FIX_REVERSAL_EXTENDED, 0) >= 1
    merged = [c.text for c in kept if "dense attribute coverage" in c.text]
    assert merged, "the reversed span was dropped instead of extended"
    assert "sparse catalogues" in merged[0], \
        "the extension must carry the contradiction the page states next"
    # and the extension is a contiguous slice of the page, not a stitch
    canon = canonicalise(PAGE)
    assert merged[0] in canon.text


def test_a_next_steps_span_never_reaches_the_menu():
    kept, counts, _ = _pool()
    assert counts.get(PG.BAN_SECTION, 0) >= 1
    assert not [c for c in kept if "By integrating these into your existing CMS" in c.text]


def test_a_subject_less_span_stays_on_the_menu_but_is_flagged():
    """Positional defect. Deleting it would cost a legitimate span 2."""
    kept, _, ineligible = _pool()
    target = [c for c in kept if "It lets multiple" in c.text]
    assert target, "a subject-less sentence must remain pickable as a later span"
    assert target[0].index in ineligible


def test_the_menu_shows_the_not_first_mark():
    from candidates import render_menu
    kept, _, ineligible = _pool()
    assert "[NOT-FIRST]" in render_menu(kept, no_open=ineligible)


# --- the whole path -----------------------------------------------------------------------

def test_a_page_that_used_to_quarantine_now_enriches(stub):
    """The end-to-end claim. Same page, same defects, a record comes out."""
    stub(["Dynamic Facets reorders a store's refinement panel",
          "Retailers running the feature reported clickthrough gains"], HL)
    out = E.process(_record())
    assert out["status"] in ("PASS", "JUDGE_REVISE"), out.get("gate_failures")
    assert out["gate_passed"] is True
    assert out["abstract_enriched"]
    assert len(out["keyhighlights_enriched"]) >= 3


def test_process_reports_what_the_pool_gates_removed(stub):
    """A silent filter is an unauditable filter."""
    stub(["Dynamic Facets reorders a store's refinement panel",
          "Retailers running the feature reported clickthrough gains"], HL)
    out = E.process(_record())
    assert "pool_gate_dropped" in out
    assert out["candidates_after_pool_gates"] <= out["candidates_after_filter"]


def test_a_subject_less_opening_triggers_a_retry_rather_than_a_quarantine(stub):
    """The ladder's reason for existing: one bad OPENING is not a verdict on the page."""
    state = stub(BAD_OPENER, HL, second_abstract=GOOD_OPENER)
    out = E.process(_record())
    assert state["writer"] == 2, "the runner must re-ask after a subject failure, not quarantine"
    assert out["status"] in ("PASS", "JUDGE_REVISE"), out.get("gate_failures")
    assert out["selection_attempt_count"] == 2
    assert "It lets multiple" not in out["abstract_enriched"][:40]


def test_the_retry_menu_has_the_banned_candidates_removed(stub):
    state = stub(BAD_OPENER, HL, second_abstract=GOOD_OPENER)
    E.process(_record())
    assert "It lets multiple software programs" not in state["menus"][1], \
        "the retry must remove the subject-less candidates, not merely discourage them"


def test_the_ladder_is_bounded(monkeypatch):
    """A writer that keeps making a bad choice must terminate, not loop.

    The stub takes the first two menu entries every time, whatever they are. That is the
    adversarial case the bound exists for: each retry hands back a different selection, so
    "the model repeated itself" cannot be what stops it.
    """
    calls = {"n": 0}

    def greedy_writer(prompt):
        calls["n"] += 1
        menu = [line for line in prompt.split("\n") if line.startswith("[")]
        nums = [int(line[1:line.index("]")]) for line in menu]
        return ({"verdict": "REAL", "abstract": nums[:2], "highlights": nums[2:7],
                 "language_observed": "en", "insufficient_reason": None},
                {"cost_usd": 0.0, "raw": "", "writer": "stub", "http_status": 200})

    def fake_judge(prompt):
        return {"representativeness": 5, "specificity": 5, "missed_substance": 5,
                "coherence": 5, "juxtaposition": 5, "better_span_available": None,
                "verdict": "ACCEPT"}, None

    monkeypatch.setattr(E, "call_writer", greedy_writer)
    monkeypatch.setattr(E, "call_judge", fake_judge)
    out = E.process(_record())

    assert calls["n"] <= 3, "the selection ladder must be bounded"
    # Whatever happened, it was reported honestly -- never a silently stored bad span.
    if out["status"] == "QUARANTINED_BY_GATE":
        assert out["gate_failures"]
    else:
        assert out["abstract_enriched"]
        assert out["gate_passed"] is True


def test_a_protocol_error_does_not_burn_retries(monkeypatch):
    """An out-of-range index is not fixed by banning candidates, so the ladder must stop at one."""
    calls = {"n": 0}

    def bad_writer(prompt):
        calls["n"] += 1
        return ({"verdict": "REAL", "abstract": [99999], "highlights": [99998],
                 "language_observed": "en", "insufficient_reason": None},
                {"cost_usd": 0.0, "raw": "", "writer": "stub", "http_status": 200})

    monkeypatch.setattr(E, "call_writer", bad_writer)
    monkeypatch.setattr(E, "call_judge", lambda p: ({"verdict": "ACCEPT"}, None))
    out = E.process(_record())
    assert calls["n"] == 1, "banning candidates cannot fix an out-of-range pick"
    assert out["status"] == "QUARANTINED_BY_GATE"


def test_an_extension_that_grows_into_the_title_is_dropped():
    """An extension is a DIFFERENT sentence, so the pool filter has to see it again.

    filter_pool ran on the original candidate. Two abstracts in the 2026-08-10 repair run were
    extended over their contrast and the longer text then restated the record's own title -- the
    exact thing filter_pool exists to prevent, and which it never got a chance to judge.
    """
    from candidates import split_candidates
    from pool_filters import filter_pool
    from span_gate import canonicalise

    body = (
        "# Federated search benefits and challenges\n\n"
        "Federated search queries several indices at once and merges the results into one "
        "ranked list for the user to scan. The merge step happens before ranking rather than "
        "after it, which keeps the ordering stable.\n\n"
        "For users and companies alike, federated search offers many benefits. "
        "However, it also presents special considerations you need to weigh first.\n\n"
        "Index size is the variable that decides whether a federated setup pays for itself in "
        "practice, and teams usually measure it before committing to the design.\n"
    )
    # Overlaps the SETUP at 0.67 (under the 0.70 bar, so filter_pool keeps it) and the EXTENDED
    # text at 1.0. That gap is the whole point: only the extension is a title restatement.
    title = "Federated search benefits and special considerations"
    cands, canon = split_candidates(body)
    unfiltered = cands
    cands, _, _ = filter_pool(cands, description="", title=title)
    kept, counts, _, _ = PG.apply_pool_gates(cands, canon, "editorial", title,
                                             unfiltered=unfiltered, description="")
    # The MERGED candidate is the one carrying both halves. The bare contrast sentence is a
    # separate candidate and is not what this test is about.
    survivors = [c.text for c in kept
                 if "many benefits" in c.text and "special considerations" in c.text]
    assert not survivors, f"an extension restating the title survived: {survivors}"
    assert any(k.startswith("EXTENSION_") for k in counts), \
        f"the drop must be counted under its own reason, got {dict(counts)}"
