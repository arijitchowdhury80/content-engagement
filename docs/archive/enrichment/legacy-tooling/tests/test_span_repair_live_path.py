"""
Source-grounded repair, tested THROUGH enrich_run.process() -- the live path.

WHY THESE TESTS DRIVE process() AND NOT A HELPER
  On 2026-08-09 the same defect was "fixed" in `span_gate.check_integrity`. Nineteen unit tests
  called that function directly and all went green. The pipeline never calls it: `check_integrity`
  is reachable only from `run_gates()`, and `run_gates()` is only used by `--replay`. The fix was
  dead code and the tests proved nothing.

  So every test here calls `process()` with the writer and judge stubbed, and asserts on the row
  process() returns. If a rule is moved into an unreachable function again, these fail.

WHAT MUST NEVER HAPPEN
  A stored span that is not a literal substring of the page. `test_no_free_written_punctuation`
  and `test_repaired_span_locates_in_the_page` are the guards: repair may only ever EXTEND a span
  over the page's own following words, so the result stays byte-present in the source.
"""

from __future__ import annotations

import pathlib
import sys

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

import enrich_run as E  # noqa: E402
import span_repair as R  # noqa: E402
from span_gate import canonicalise  # noqa: E402


# A page built so that each defect has a grounded completion immediately after it.
PAGE = """# Dynamic Facets

Dynamic Facets reorders the refinement panel using live behavioural signals from each query rather than a fixed order set at implementation time.

There are several additional benefits for teams adopting this approach:

- Clickthrough on specific filters improved by 10 to 15 percentage points across the beta cohort.
- Users reached results sitting two to three positions higher up the page in the same tests.

Our customer [Zenni](https://example.com/zenni) already lets shoppers virtually try on glasses.

The system learns from real search behaviour across that query and reorders accordingly, so the
panel reflects how people shop. Merchandisers keep their curation and lose the manual upkeep.

Teams reported that setup took under one hour in every pilot account we measured.
Ranking quality held steady across the full catalogue for the duration of the test.

Retailers running large catalogues see the effect most clearly during seasonal peaks. Traffic
shifts week to week and the attributes shoppers care about shift with it. A static refinement
order cannot follow that, so the panel slowly stops matching demand and nobody notices.

Implementation is a settings change rather than a reindex. The engine reads existing events and
begins reordering within a day of the feature being switched on for an index. No schema change is
required and existing facet configuration is preserved exactly as it was.

Measurement runs through the standard A/B framework. A control index keeps the fixed order while
the variant reorders, and the difference is reported alongside every other experiment.
"""


def _record(**over):
    rec = {
        "objectID": "en_test", "url": "/blog/product/dynamic-facets",
        "source_url": "https://www.algolia.com/blog/product/dynamic-facets",
        "page_type": "blog-post", "family": "editorial", "language_code": "en",
        "fetch_path": "scout", "markdown": PAGE, "content_hash": "h",
        "served_url": "/blog/product/dynamic-facets", "redirect_mismatch": False,
        "title": "Introducing adaptive refinements", "description": "A short marketing line.",
        "http_status": 200, "fetch_error": "",
    }
    rec.update(over)
    return rec


def _menu_index_of(fragment: str) -> int:
    """The candidate index whose text contains `fragment`, as process() would number it."""
    from candidates import split_candidates
    from pool_filters import filter_pool
    cands, _ = split_candidates(PAGE, already_indexed="A short marketing line.")
    cands, _, _ = filter_pool(cands, description="A short marketing line.",
                              title="Introducing adaptive refinements")
    for c in cands:
        if fragment in c.text:
            return c.index
    raise AssertionError(f"no candidate contains {fragment!r}; "
                         f"menu was {[c.text[:50] for c in cands]}")


@pytest.fixture
def stub(monkeypatch):
    """Drive process() with a scripted writer and an accepting judge."""
    calls = {"writer": 0, "picks": []}

    def make(abstract_frag, highlight_frags, second=None):
        def fake_writer(prompt):
            calls["writer"] += 1
            frags = abstract_frag if calls["writer"] == 1 or second is None else second
            a = [_menu_index_of(f) for f in frags]
            h = [_menu_index_of(f) for f in highlight_frags]
            calls["picks"].append((a, h))
            return {"verdict": "REAL", "abstract": a, "highlights": h,
                    "language_observed": "en", "insufficient_reason": None}, \
                   {"cost_usd": 0.0, "raw": "", "writer": "stub", "http_status": 200}

        def fake_judge(prompt):
            return {"representativeness": 5, "specificity": 5, "missed_substance": 5,
                    "coherence": 5, "juxtaposition": 5, "better_span_available": None,
                    "verdict": "ACCEPT"}, None

        monkeypatch.setattr(E, "call_writer", fake_writer)
        monkeypatch.setattr(E, "call_judge", fake_judge)
        return calls
    return make


HL = ["The system learns from real search behaviour",
      "Merchandisers keep their curation",
      "Teams reported that setup took under one hour",
      "Ranking quality held steady across the full catalogue"]


# ---------------------------------------------------------------------------
# the three defect classes, through the live path
# ---------------------------------------------------------------------------

def test_colon_abstract_is_repaired_from_the_page(stub):
    stub(["There are several additional benefits", "Dynamic Facets reorders the refinement panel"], HL)
    out = E.process(_record())
    assert out["status"] in ("PASS", "JUDGE_REVISE"), out.get("gate_failures")
    for s in out["abstract_spans_stored"]:
        assert R.incomplete_reason(s, is_abstract=True) is None, s
    joined = " ".join(out["abstract_spans_stored"])
    assert "clickthrough" in joined.lower(), \
        "repair should have pulled in the list the colon promised"


def test_dangling_bracket_abstract_is_repaired_or_replaced(stub):
    stub(["Our customer", "Dynamic Facets reorders the refinement panel"], HL)
    out = E.process(_record())
    assert out["status"] in ("PASS", "JUDGE_REVISE", "QUARANTINED_BY_GATE")
    for s in out.get("abstract_spans_stored", []):
        assert R.incomplete_reason(s, is_abstract=True) is None, s
        assert not R.has_broken_brackets(s) if hasattr(R, "has_broken_brackets") else True


def test_mid_sentence_abstract_is_repaired_or_quarantined_never_stored_broken(stub):
    stub(["The system learns from real search behaviour", "Dynamic Facets reorders the refinement panel"], HL)
    out = E.process(_record())
    for s in out.get("abstract_spans_stored", []):
        assert R.incomplete_reason(s, is_abstract=True) is None, s


# ---------------------------------------------------------------------------
# the invariant that matters most
# ---------------------------------------------------------------------------

def test_no_free_written_punctuation(stub):
    """
    Repair may only EXTEND over page text. If it ever appended a full stop, the stored span would
    stop being a substring of the page -- which is the whole guarantee.
    """
    stub(["There are several additional benefits", "Dynamic Facets reorders the refinement panel"], HL)
    out = E.process(_record())
    canon = canonicalise(PAGE).text
    for s in out.get("abstract_spans_stored", []) + out.get("keyhighlights_enriched", []):
        assert s in canon, f"stored span is not literal page text: {s!r}"


def test_repaired_span_locates_in_the_page(stub):
    stub(["There are several additional benefits", "Dynamic Facets reorders the refinement panel"], HL)
    out = E.process(_record())
    canon = canonicalise(PAGE)
    from span_gate import locate
    for s in out.get("abstract_spans_stored", []):
        locate(s, canon)          # raises SpanRejected if not present


def test_nothing_incomplete_ever_reaches_storage(stub):
    """The residual sweep: whatever repair and re-selection do, storage must be clean."""
    stub(["There are several additional benefits", "Our customer", "Dynamic Facets reorders the refinement panel"], HL)
    out = E.process(_record())
    for s in out.get("abstract_spans_stored", []):
        assert R.incomplete_reason(s, is_abstract=True) is None, s
    for s in out.get("keyhighlights_enriched", []):
        assert R.incomplete_reason(s, is_abstract=False) is None, s


# ---------------------------------------------------------------------------
# the judge is not exempt
# ---------------------------------------------------------------------------

def test_judge_replacement_re_enters_the_checks(monkeypatch, stub):
    """
    Two of the five defects that survived the 2026-08-09 fix came in through the judge: its
    `better_span_available` was located and accepted without re-entering completeness checks.
    """
    # The judge is OFF in production since 2026-08-10, so this test opts it back in: it covers the
    # offline sampler path, which is the only place the judge still runs.
    monkeypatch.setattr(E, "JUDGE_ENABLED", True)
    stub(["Dynamic Facets reorders the refinement panel", "The system learns from real search behaviour"], HL)

    def judge_with_bad_span(prompt):
        return {"representativeness": 4, "specificity": 4, "missed_substance": 4,
                "coherence": 4, "juxtaposition": 4,
                "better_span_available": "There are several additional benefits for teams "
                                         "adopting this approach:",
                "verdict": "REVISE"}, None
    monkeypatch.setattr(E, "call_judge", judge_with_bad_span)

    out = E.process(_record())
    assert out.get("judge_span_incomplete") == R.LIST_LEAD_IN
    assert out.get("judge_span_valid") is False
    for s in out.get("abstract_spans_stored", []):
        assert R.incomplete_reason(s, is_abstract=True) is None, s


# ---------------------------------------------------------------------------
# quarantine is the LAST resort, not the first
# ---------------------------------------------------------------------------

def test_repair_is_attempted_before_reselection(stub):
    calls = stub(["There are several additional benefits", "Dynamic Facets reorders the refinement panel"], HL)
    out = E.process(_record())
    assert out.get("repaired") is True, "a repairable span must be repaired, not re-selected"
    assert calls["writer"] == 1, "no second writer call should be needed when repair succeeds"
    assert out["status"] != "QUARANTINED_BY_GATE"


def test_unrepairable_span_triggers_reselection_with_it_banned(stub, monkeypatch):
    """When the page offers no completion, the candidate is banned and selection is retried."""
    # Must be genuinely incomplete, or repair is never attempted and nothing is banned.
    bad = "There are several additional benefits"
    # Patch the name enrich_run actually calls. `from span_repair import repair_span` binds a
    # SECOND reference in enrich_run's namespace, so patching span_repair.repair_span leaves the
    # live path untouched -- the same "fix landed somewhere nothing calls" shape as the 2026-08-09
    # dead-gate incident, in test form.
    monkeypatch.setattr(E, "repair_span", lambda *a, **k: (None, ["forced: no completion"]))
    calls = stub([bad, "The system learns from real search behaviour"], HL,
                 second=["Dynamic Facets reorders the refinement panel",
                         "The system learns from real search behaviour"])
    out = E.process(_record())
    assert calls["writer"] == 2, "an unrepairable span must trigger exactly one re-selection"
    assert out.get("reselect_banned"), "the offending candidate must be banned from the retry menu"


# ---------------------------------------------------------------------------
# chrome must not be promoted INTO a highlight by the replacement step
# ---------------------------------------------------------------------------

def test_audio_fallback_chrome_is_filtered_before_it_can_be_selected():
    """
    "Your browser does not support the audio element." is an HTML5 <audio> fallback string. It is
    a complete eight-word sentence with balanced brackets, so every shape test calls it prose --
    only a corpus fact refutes it. The fact lived in the validator's FORBIDDEN_TEXT and NOT in the
    pool filter, so the repair run's replacement step promoted it into five highlights while the
    validator stood ready to flag them. One list now, owned by the filter.
    """
    from pool_filters import drop_reason, FORBIDDEN_TEXT

    class _C:
        text = "Your browser does not support the audio element."
        original = text
    assert drop_reason(_C()) == "FORBIDDEN_TEXT"

    import validate_blog_outputs as V
    assert V.FORBIDDEN_TEXT is FORBIDDEN_TEXT, \
        "the validator must import the list, not keep a copy that can drift"


# ---------------------------------------------------------------------------
# the judge is off in production
# ---------------------------------------------------------------------------

def test_judge_never_runs_on_the_writers_own_model():
    """
    THE SELF-GRADING GUARD. The writer sends `GLM_MODEL = "large"`, and on the Algolia inference
    server `large` and `xlarge` BOTH serve glm-5.2. A judge pointed at either would be the writer
    grading its own output. The tier names hide this, so it is asserted rather than remembered.

    Verified against the API 2026-08-10:
        small -> gemma-4-26b-a4b-nvfp4     large  -> glm-5.2
        medium -> gemma-4-31b-it-nvfp4     xlarge -> glm-5.2
    """
    assert E.JUDGE_MODEL != E.GLM_MODEL, "judge and writer must not be the same tier"
    assert E.JUDGE_MODEL not in ("large", "xlarge"), \
        "large/xlarge are glm-5.2, which IS the writer -- pick a gemma tier"
    assert E.JUDGE_MODEL in ("small", "medium")


def test_judge_is_not_gemini():
    """Arijit banned Gemini 2026-08-10. The judge now runs on Algolia inference."""
    assert "gemini" not in E.JUDGE_MODEL.lower()


def test_pipeline_completes_with_the_judge_disabled(monkeypatch, stub):
    """The judge is advisory, so a run with it off must still produce a complete, grounded row."""
    stub(["Dynamic Facets reorders the refinement panel",
          "The system learns from real search behaviour"], HL)
    called = {"n": 0}

    def boom(prompt):
        called["n"] += 1
        raise AssertionError("call_judge must not run when JUDGE_ENABLED is False")
    monkeypatch.setattr(E, "call_judge", boom)
    monkeypatch.setattr(E, "JUDGE_ENABLED", False)

    out = E.process(_record())
    assert called["n"] == 0
    assert out["status"] == "PASS"
    assert out["judge"] is None
    assert "disabled in production" in out["judge_skipped"]
    # the guarantee is untouched: spans are still literal page text
    for s in out["abstract_spans_stored"]:
        assert s in canonicalise(PAGE).text


def test_grounding_survives_judge_removal(stub, monkeypatch):
    """The zero-invention guarantee is structural, not judge-provided."""
    monkeypatch.setattr(E, "JUDGE_ENABLED", False)
    stub(["There are several additional benefits",
          "Dynamic Facets reorders the refinement panel"], HL)
    out = E.process(_record())
    canon = canonicalise(PAGE)
    from span_gate import locate
    for s in out.get("abstract_spans_stored", []) + out.get("keyhighlights_enriched", []):
        locate(s, canon)
