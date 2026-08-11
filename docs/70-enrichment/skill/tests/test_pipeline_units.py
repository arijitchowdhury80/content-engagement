"""The remaining named tests: grounding, body-source parity, dispatch, state, coverage,
searchable-attribute syntax, filters, repair, verdicts and model separation.

Each one pins a failure that actually happened. The docstrings say which.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from conftest import FakeAlgolia, FakeInference, FakeScout, TARGET_INDEX, body_for, make_records

from algolia_enrichment import human_review
from algolia_enrichment.bodysource import IngestPayload, RunCache, ScoutRefetch
from algolia_enrichment.candidates import split_candidates
from algolia_enrichment.canonical import canonicalise
from algolia_enrichment.dispatch import route, sniff
from algolia_enrichment.errors import EnrichmentError, StateError, ZeroWorkError
from algolia_enrichment.filters import build_map, drop_reason, filter_pool, overlap
from algolia_enrichment.model_io import assert_model_separation
from algolia_enrichment.profiles import load_profile
from algolia_enrichment.repair import incomplete_reason, repair_span
from algolia_enrichment.state import RunState
from algolia_enrichment.validate import grounding, live, payload, quality, search
from algolia_enrichment.verdicts import classify, dead_page_reason, language_mismatch

PROFILES = Path(__file__).resolve().parents[1] / "profiles"
CASE_STUDY = load_profile(PROFILES, "Customer Stories", "case-study")
REFERENCE = load_profile(PROFILES, "Documentation", "doc-sdk")


# ---------------------------------------------------------------------------
# offset-free grounding
# ---------------------------------------------------------------------------

def test_grounding_finds_a_span_whose_offsets_have_drifted():
    """The offsets are a claim about WHERE. A drifted offset is not a fabrication.

    Reported separately so a body that moved is visible, but it does not fail the span.
    """
    body = body_for(0)
    span = "Acme Retail rebuilt its product discovery on Algolia"
    rows = [{"objectID": "x", "abstract_spans_stored": [span], "span_offsets": [[0, 5]]}]
    report = grounding.check_rows(rows, {"x": {"markdown": body}})
    assert report["ok"] is True
    assert report["located"] == 1
    assert report["offset_drift"], "a drifted offset should be reported, not silently accepted"


def test_grounding_matches_across_markdown_formatting():
    """A span the page hard-wraps and emphasises is still the same span."""
    body = "Acme **rebuilt** its\nproduct [discovery](/x) on Algolia."
    rows = [{"objectID": "x",
             "abstract_spans_stored": ["Acme rebuilt its product discovery on Algolia."]}]
    report = grounding.check_rows(rows, {"x": {"markdown": body}})
    assert report["ok"] is True
    assert report["modes"] == {"canonical": 1}


def test_grounding_refuses_a_row_whose_body_is_missing():
    rows = [{"objectID": "x", "abstract_spans_stored": ["anything at all here"]},
            {"objectID": "y", "abstract_spans_stored": ["Acme Retail rebuilt its product"]}]
    report = grounding.check_rows(rows, {"y": {"markdown": body_for(0)}})
    assert report["missing_body"] == ["x"] and report["ok"] is False


# ---------------------------------------------------------------------------
# body-source parity
# ---------------------------------------------------------------------------

def test_bodysource_parity_scout_and_ingest_produce_identical_downstream_results():
    """Nothing downstream of `body_for()` may branch on which source ran.

    If it did, pre-ingest would be a second pipeline rather than a config change -- and the two
    would drift exactly the way two canonicalisers did.
    """
    rec = make_records(1)[0]
    md = body_for(0)

    class StubScout:
        def fetch(self, record, site):
            import hashlib
            return {"objectID": record["objectID"], "url": record["url"],
                    "source_url": record["url"], "fetch_path": "scout",
                    "fetcher": "ScoutRefetch", "served_url": "", "redirect_mismatch": False,
                    "markdown": md,
                    "content_hash": hashlib.sha256(md.encode()).hexdigest(),
                    "http_status": 200, "truncated": False, "original_length": len(md),
                    "fetch_error": ""}

    a = ScoutRefetch(StubScout(), "https://x").body_for(rec)
    b = IngestPayload({rec["objectID"]: md}).body_for(rec)

    assert a["markdown"] == b["markdown"]
    assert a["content_hash"] == b["content_hash"]
    ca, cb = split_candidates(a["markdown"]), split_candidates(b["markdown"])
    assert [c.text for c in ca[0]] == [c.text for c in cb[0]]
    assert a["fetcher"] != b["fetcher"], "provenance must still differ; only the result must not"


def test_run_cache_refuses_a_body_that_changed_after_it_was_fetched(tmp_path):
    cache = RunCache(tmp_path, "run-1")
    body = IngestPayload({"a": body_for(0)}).body_for({"objectID": "a", "url": "/a"})
    cache.store(body)
    cache.seal(["a"], "IngestPayload")
    path = next(cache.cache_dir.glob("*.json"))
    tampered = json.loads(path.read_text())
    tampered["markdown"] = "a different page entirely"
    path.write_text(json.dumps(tampered))
    with pytest.raises(EnrichmentError, match="does not match the fetch manifest"):
        cache.load()


def test_run_cache_refuses_a_cache_from_another_run(tmp_path):
    cache = RunCache(tmp_path, "run-1")
    cache.store(IngestPayload({"a": body_for(0)}).body_for({"objectID": "a", "url": "/a"}))
    cache.seal(["a"], "IngestPayload")
    with pytest.raises(EnrichmentError, match="belongs to run"):
        RunCache(tmp_path, "run-2").load()


def test_run_cache_refuses_an_empty_cache(tmp_path):
    cache = RunCache(tmp_path, "run-1")
    cache.cache_dir.mkdir(parents=True)
    cache.seal([], "IngestPayload")
    with pytest.raises(ZeroWorkError):
        cache.load()


# ---------------------------------------------------------------------------
# dispatch sniffer
# ---------------------------------------------------------------------------

API_BODY = """# searchSingleIndex

GET /1/indexes/{indexName}/query
POST /1/indexes/{indexName}/query

| parameter | type | required |
| --- | --- | --- |
| query | string | no |
| hitsPerPage | integer | no |
| filters | string | no |
| page | integer | no |
| facets | array | no |

```json
{"query": "shoes", "hitsPerPage": 20}
```
"""


def test_dispatch_flags_a_reference_page_declared_editorial():
    r = route("editorial", API_BODY)
    assert r["sniffed"] == "docs_api" and r["agrees"] is False


def test_dispatch_does_not_split_hairs_between_editorial_shapes():
    """A case study and a blog post have the same page SHAPE, and the sniffer measures shape.
    Firing on that difference would make the check noise."""
    assert route("case_study", body_for(0))["agrees"] is True
    assert route("press_release", body_for(0))["agrees"] is True


def test_dispatch_disagreement_refuses_to_write(run_cli, wire, workspace):
    from conftest import FakeScout
    records = make_records(1)
    wire(algolia=FakeAlgolia(records), scout_client=FakeScout({"rec-0": API_BODY * 3}),
         inference=FakeInference({"large": {"verdict": "REAL", "abstract": [1],
                                            "highlights": [2, 3, 4], "language_observed": "en"}}))
    run = "20260810-cs-case-study-a01"
    sl = ["--source", "Customer Stories", "--page-type", "case-study"]
    assert run_cli("plan-slice", "--run-id", run, *sl) == 0
    assert run_cli("fetch", "--run-id", run, *sl) == 0
    assert run_cli("enrich", "--run-id", run, *sl) == 0
    rows = [json.loads(l) for l in (Path(workspace) / "docs" / "70-enrichment" / "runs" / run /
                                    "outputs" / "base" / "results.jsonl").read_text().splitlines()]
    assert rows[0]["status"] == "METHOD_DISAGREEMENT"
    assert not rows[0]["abstract_spans_stored"]


# ---------------------------------------------------------------------------
# state
# ---------------------------------------------------------------------------

def test_every_illegal_transition_is_refused():
    s = RunState(run_id="r", source="S", page_type="p", target_index="T")
    with pytest.raises(StateError):
        s.set("write", "APPLIED_SOMEHOW")
    with pytest.raises(StateError):
        s.require("write", "DRY_RUN_PASSED")
    with pytest.raises(StateError):
        s.require("validate", "PASSED")
    s.set("validate", "PASSED")
    s.require("validate", "PASSED")


# ---------------------------------------------------------------------------
# coverage denominator
# ---------------------------------------------------------------------------

def test_coverage_denominator_is_the_original_plan_not_the_survivors():
    """If the denominator is what came back, a run that loses half its records reports 100%."""
    cov = human_review.coverage(planned=237, writable=100, human_open=37, terminal=100,
                                profile=CASE_STUDY)
    assert cov["planned_target_count"] == 237
    assert cov["writable_coverage_pct"] == round(100 / 237, 4)
    assert cov["all_accounted_for"] is True
    assert cov["meets_coverage"] is False       # 42% against a 85% target


def test_coverage_counts_unattempted_records():
    cov = human_review.coverage(planned=10, writable=3, human_open=1, terminal=1,
                                profile=CASE_STUDY)
    assert cov["unattempted"] == 5
    assert cov["all_accounted_for"] is False


def test_human_review_is_an_outcome_not_an_enriched_record():
    cov = human_review.coverage(planned=10, writable=0, human_open=10, terminal=0,
                                profile=CASE_STUDY)
    assert cov["outcome_coverage_pct"] == 1.0
    assert cov["writable_coverage_pct"] == 0.0


# ---------------------------------------------------------------------------
# searchable attributes syntax
# ---------------------------------------------------------------------------

def test_one_attribute_per_priority_level():
    """`"unordered(a),unordered(b)"` is stored as ONE garbage attribute and reads back
    perfectly, which is why the settings read is not the verification."""
    out = search.add_enriched_searchable(
        ["title", "unordered(description)"], ("abstract_enriched", "keyhighlights_enriched"))
    assert out == ["title", "unordered(description)", "unordered(abstract_enriched)",
                   "unordered(keyhighlights_enriched)"]
    assert search.assert_searchable_syntax(out) == []


def test_a_comma_joined_attribute_is_refused():
    assert search.assert_searchable_syntax(
        ["unordered(a),unordered(b)"]) == ["unordered(a),unordered(b)"]
    with pytest.raises(ValueError, match="comma-joined"):
        search.add_enriched_searchable(["unordered(a),unordered(b)"], ("c",))


def test_adding_enriched_fields_is_idempotent():
    once = search.add_enriched_searchable(["title"], ("abstract_enriched",))
    assert search.add_enriched_searchable(once, ("abstract_enriched",)) == once


def test_proof_of_life_requires_a_query_that_returns_hits():
    client = FakeAlgolia()
    pl = {"objectID": "rec-0",
          "abstract_enriched": ["Acme Retail rebuilt its product discovery on Algolia today."],
          "keyhighlights_enriched": []}
    client.target["rec-0"] = dict(pl)
    ok = live.proof_of_life(client, TARGET_INDEX, [pl])
    assert ok["ok"] is True and ok["queries_with_hits"] == 1
    client.target.clear()
    client.target["rec-0"] = {"objectID": "rec-0", "abstract_enriched": [],
                              "keyhighlights_enriched": []}
    assert live.proof_of_life(client, TARGET_INDEX, [pl])["ok"] is False


# ---------------------------------------------------------------------------
# filters
# ---------------------------------------------------------------------------

def test_a_chrome_phrase_inside_real_prose_is_kept():
    """Substring matching rejected 6 legitimate records. A CTA disqualifies a span only when the
    span IS the button."""
    from algolia_enrichment.gates import check_blacklists
    assert check_blacklists(
        ["Volume pricing is available and you can contact sales to discuss a custom plan "
         "for more than one million records."]) == []
    assert check_blacklists(["Contact sales"]) != []


def test_the_forbidden_list_is_shared_by_the_filter_and_the_validator():
    """When they had separate copies, the validator named a string as leakage while the filter
    left it on the menu, and a repair run promoted it into five highlights."""
    from algolia_enrichment.filters import FORBIDDEN_TEXT
    audio = "Your browser does not support the audio element."

    class C:
        text = audio
        original = audio
        kind = "prose"
        is_already_indexed = False

    assert drop_reason(C()) == "FORBIDDEN_TEXT"
    report = quality.check_rows([{"objectID": "x", "abstract_spans_stored": [audio]}])
    assert report["leakage"], "the validator and the filter disagree about the same string"
    assert any(f in audio.lower() for f in FORBIDDEN_TEXT)


def test_profile_forbidden_patterns_ban_the_candidate_not_the_record():
    """"About Algolia" would be selected as the abstract on every press release unless banned at
    the CANDIDATE layer. A record-level gate here would kill the whole slice."""
    press = load_profile(PROFILES, "Website", "press-release")

    class C:
        def __init__(self, t):
            self.text = t
            self.original = t
            self.kind = "prose"
            self.is_already_indexed = False

    kept, counts, _ = filter_pool(
        [C("About Algolia is the leading AI search company serving thousands of customers."),
         C("The company announced a new pricing tier for mid-market retailers this morning.")],
        extra_patterns=press.compiled_forbidden)
    assert counts.get("PROFILE_FORBIDDEN") == 1
    assert len(kept) == 1, "banning the pattern must cost a candidate, never the record"


def test_cli_enrich_never_offers_pre_h1_site_shell(run_cli, wire, workspace):
    """The real GoFundMe fetch has a global overlay before the case-study H1.

    Scout correctly returns the complete page. The enrichment pipeline, not Scout, must make
    only the page's content region eligible for model selection. Driving the CLI is intentional:
    a helper-only test would repeat the historical dead-gate mistake.
    """
    shell = "How will Algolia improve our search experience and conversions?"
    md = (f"{shell} How do I integrate Algolia search into my app?\n"
          "Suggestions\nAlgolia Assist\n\n"
          "# Acme customer story\n\n" + body_for(0))
    records = make_records(1)

    def writer(prompt):
        assert shell not in prompt, "pre-H1 site shell reached the live model menu"
        return {"verdict": "THIN", "abstract": [], "highlights": [],
                "language_observed": "en"}

    state = wire(algolia=FakeAlgolia(records), scout_client=FakeScout({"rec-0": md}),
                 inference=FakeInference({"large": writer}))
    run = "20260811-cs-case-study-a02"
    sl = ["--source", "Customer Stories", "--page-type", "case-study"]
    assert run_cli("plan-slice", "--run-id", run, *sl) == 0
    assert run_cli("fetch", "--run-id", run, *sl) == 0
    assert run_cli("enrich", "--run-id", run, *sl) == 0
    assert any(tier == "large" for tier, _ in state["inference"].calls), (
        "the test must reach the writer; otherwise it proves no candidate-menu behaviour")


def test_overlap_uses_containment_not_just_jaccard():
    """A candidate that is the description plus a trailing clause is a duplicate in substance."""
    desc = "How Acme rebuilt discovery"
    cand = "How Acme rebuilt discovery across six European markets in a single quarter"
    assert overlap(cand, desc) >= 0.99


def test_boilerplate_map_refuses_to_judge_from_too_few_pages():
    """A map built from five pages is noise, and noise here removes real content from the menu."""
    pages = [(f"/p{i}", ["A shared footer sentence."]) for i in range(5)]
    bp, n = build_map(pages)
    assert bp == {} and n == 5
    pages = [(f"/p{i}", ["A shared footer sentence.", f"Unique line {i}."]) for i in range(40)]
    bp, n = build_map(pages)
    assert "a shared footer sentence." in bp and n == 40


# ---------------------------------------------------------------------------
# repair on the live path
# ---------------------------------------------------------------------------

def test_a_colon_lead_in_may_cross_a_block_boundary():
    """The page itself signalled the continuation; a markdown list is a different block by
    construction. A strict same-block rule makes every colon lead-in unrepairable, and that was
    the largest defect bucket in the Blog run."""
    md = ("# T\n\nThere are several additional benefits worth noting:\n\n"
          "- Faster indexing reduces the time a catalogue update takes across every region.\n")
    cands, canon = split_candidates(md)
    lead = next(c for c in cands if c.text.rstrip().endswith(":"))
    fixed, _ = repair_span(lead, cands, canon, is_abstract=True)
    assert fixed is not None and incomplete_reason(fixed.text, is_abstract=True) is None


def test_a_mid_sentence_cut_may_not_cross_a_block_boundary():
    """There the page gave no signal, and joining across a block fabricates adjacency."""
    md = ("# T\n\nThe migration replaced a cluster that had grown\n\n"
          "Completely unrelated paragraph about something else entirely here.\n")
    cands, canon = split_candidates(md)
    cut = next((c for c in cands if "had grown" in c.text), None)
    if cut is None:
        pytest.skip("splitter did not produce the cut span on this body")
    fixed, trace = repair_span(cut, cands, canon, is_abstract=True)
    assert fixed is None, f"repair crossed a block boundary without a colon: {trace}"


def test_a_period_less_highlight_is_not_a_defect():
    """350 period-less highlight spans in the Blog run were legitimate bullets. Applying the
    abstract rule to both fields would have replaced 304 good records to fix 20 bad ones."""
    assert incomplete_reason("Indexes 1.2 million products", is_abstract=False) is None
    assert incomplete_reason("Indexes 1.2 million products", is_abstract=True) is not None


# ---------------------------------------------------------------------------
# verdicts
# ---------------------------------------------------------------------------

def test_an_alive_page_returning_301_survives_the_dead_page_gate():
    """`http_status != 200 -> DEAD` would have discarded ~1,600 healthy articles and caught only
    a third of the dead ones."""
    body = {"objectID": "x", "url": "/a", "markdown": body_for(0), "http_status": 301,
            "redirect_mismatch": False}
    assert classify(body, {}, min_body_chars=900) is None


def test_a_dead_stub_is_caught_whatever_its_status():
    body = {"objectID": "x", "url": "/a", "markdown": "# Page not found\n\nSorry.",
            "http_status": 200, "redirect_mismatch": False}
    v = classify(body, {}, min_body_chars=900)
    assert v["status"] == "DEAD_PAGE"


def test_the_dead_page_floor_is_a_profile_decision():
    """A terse API reference page is short and CORRECT. Blog's floor would quarantine thousands."""
    # ~380 chars: short for an article, entirely normal for an API reference page.
    terse = ("# getSettings\n\nRetrieves the settings of an index. Returns every configured "
             "setting including ranking, searchableAttributes, attributesForFaceting and the "
             "typo tolerance configuration. The response is a single JSON object. Requires the "
             "settings ACL on the API key used for the request.")
    assert dead_page_reason(terse, min_chars=CASE_STUDY.min_body_chars) is not None
    assert dead_page_reason(terse, min_chars=REFERENCE.min_body_chars) is None


def test_a_redirect_to_another_records_page_is_refused():
    """2 of 237 case studies return HTTP 200 while serving a different document. Every span cut
    from that body is verbatim -- from a page this record does not point at."""
    body = {"objectID": "a", "url": "/customers/bringmeister", "markdown": body_for(0),
            "http_status": 200, "redirect_mismatch": True, "served_url": "/customers"}
    v = classify(body, {"/customers": "hub-record"}, min_body_chars=900)
    assert v["status"] == "REDIRECT_CANONICAL" and v["canonical_objectID"] == "hub-record"


def test_a_self_redirect_is_not_a_misattribution():
    body = {"objectID": "a", "url": "/doc/x", "markdown": body_for(0), "http_status": 200,
            "redirect_mismatch": True, "served_url": "/doc/x/"}
    assert classify(body, {}, min_body_chars=900) is None


def test_language_mismatch_needs_both_values():
    assert language_mismatch("de", "en") is True
    assert language_mismatch("de", None) is False
    assert language_mismatch(None, "en") is False


# ---------------------------------------------------------------------------
# judge model separation
# ---------------------------------------------------------------------------

class _Cfg:
    writer_tier = "large"
    writer_model = "glm-5.2"
    judge_tier = "small"
    judge_model = "gemma-4-26b-a4b-nvfp4"
    judge_enabled = True


def test_the_writer_may_not_grade_itself():
    """`large` and `xlarge` BOTH serve glm-5.2. A tier-only check passes and the writer grades
    its own output."""
    cfg = _Cfg()
    cfg.judge_tier = "xlarge"
    cfg.judge_model = "glm-5.2"
    inf = FakeInference(served={"large": "glm-5.2", "xlarge": "glm-5.2"})
    with pytest.raises(EnrichmentError, match="grading its own output"):
        assert_model_separation(inf, cfg)


def test_a_silent_model_repoint_is_refused():
    """`medium` is not the writer, so a writer!=judge tier check passes -- but it is an
    unvalidated model swap. Pinning the SERVED string makes it fail loudly."""
    inf = FakeInference(served={"large": "glm-5.2", "small": "gemma-4-31b-it-nvfp4"})
    with pytest.raises(EnrichmentError, match="config pins"):
        assert_model_separation(inf, _Cfg())


def test_matching_served_strings_pass():
    inf = FakeInference(served={"large": "glm-5.2", "small": "gemma-4-26b-a4b-nvfp4"})
    got = assert_model_separation(inf, _Cfg())
    assert got["writer_served"] == "glm-5.2" and got["judge_served"] == "gemma-4-26b-a4b-nvfp4"


# ---------------------------------------------------------------------------
# payload
# ---------------------------------------------------------------------------

def test_the_abstract_is_stored_as_an_array_not_a_joined_paragraph():
    """A pre-joined string bakes a false adjacency into the index and makes the component spans
    unrecoverable."""
    row = {"objectID": "x", "status": "PASS",
           "abstract_spans_stored": ["First span.", "Second span."],
           "abstract_enriched": "First span. Second span.",
           "keyhighlights_enriched": ["A highlight."]}
    pl = payload.build_payload(row)
    assert pl["abstract_enriched"] == ["First span.", "Second span."]


def test_a_row_with_only_a_joined_string_is_refused():
    row = {"objectID": "x", "status": "PASS", "abstract_enriched": "joined only",
           "keyhighlights_enriched": []}
    assert payload.build_payload(row) is None


def test_a_judge_human_review_row_is_not_writable():
    """A judge verdict that does not change writability is not a gate. The historical judge's
    verdict changed the outcome for ZERO records because both its verdicts were writable."""
    row = {"objectID": "x", "status": "JUDGE_HUMAN_REVIEW",
           "abstract_spans_stored": ["a"], "keyhighlights_enriched": []}
    assert payload.build_payload(row) is None


def test_a_tier_with_no_served_model_is_refused_not_silently_accepted():
    """The vacuous-assertion class, caught during the Gate 3 smoke.

    `served_models()` used to end `served or alias`. If the API field were renamed, every tier
    resolved to its own alias and the pin compared `"large" == "large"` -- passing, while proving
    nothing about which model graded the corpus. A missing served model is now a named refusal.
    """
    inf = FakeInference(served={"large": "glm-5.2"})       # `small` absent entirely
    with pytest.raises(EnrichmentError, match="not served by this endpoint"):
        assert_model_separation(inf, _Cfg())


def test_a_previous_slice_in_the_target_is_not_contamination():
    """The target index accumulates slices. Scoping "extra records" to ONE run's manifest called
    correct behaviour a failure -- measured on the case-study smoke, which flagged the 10 Blog
    records written an hour earlier."""
    from algolia_enrichment.validate import live
    client = FakeAlgolia()
    pl = {"objectID": "cs-1", "abstract_enriched": ["a"], "keyhighlights_enriched": []}
    client.target["cs-1"] = dict(pl)
    client.target["blog-1"] = {"objectID": "blog-1", "abstract_enriched": ["b"],
                               "keyhighlights_enriched": []}
    scoped_to_one_run = live.verify(client, TARGET_INDEX, [pl], manifest_ids={"cs-1"})
    assert scoped_to_one_run["extra_count"] == 1        # the wrong question
    all_runs = live.verify(client, TARGET_INDEX, [pl], manifest_ids={"cs-1", "blog-1"})
    assert all_runs["extra_count"] == 0 and all_runs["ok"] is True


def test_a_record_no_run_planned_is_still_caught():
    """The relaxation must not cost the check its purpose. An unknown writer put a search-query
    body into a live index on this project once."""
    from algolia_enrichment.validate import live
    client = FakeAlgolia()
    pl = {"objectID": "cs-1", "abstract_enriched": ["a"], "keyhighlights_enriched": []}
    client.target["cs-1"] = dict(pl)
    client.target["who-wrote-this"] = {"objectID": "who-wrote-this",
                                       "abstract_enriched": ["?"],
                                       "keyhighlights_enriched": []}
    report = live.verify(client, TARGET_INDEX, [pl], manifest_ids={"cs-1", "blog-1"})
    assert report["extra_records_in_target"] == ["who-wrote-this"] and report["ok"] is False
