"""A gate added to a helper module must be REACHED by the CLI command.

THE FAILURE THIS FILE EXISTS FOR
  `span_gate.run_gates()` was never called by the runner. A gate was fixed inside it twice. Every
  unit test passed; the pipeline behaved exactly as before. Reading the source proved nothing.

  So these tests do not import a gate and call it. They drive the CLI end to end with a writer
  that picks a span the gate should refuse, and assert the refusal appears in the RUN'S OWN
  OUTPUT -- `outputs/base/results.jsonl`. That is the only evidence that the gate is on the live
  path.

  `run_gates` is not ported into this package at all, so the dead path cannot come back.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from conftest import FakeAlgolia, FakeInference, FakeScout, make_records

RUN = "20260810-cs-case-study-a01"
SLICE = ["--source", "Customer Stories", "--page-type", "case-study"]


def test_run_gates_is_not_in_the_package():
    """The dead path is gone, not disabled. A flag left in the wrong position is how it came back
    the first two times."""
    from algolia_enrichment import gates
    assert not hasattr(gates, "run_gates"), \
        "run_gates was ported; it is the code path the runner never reaches"


CHROME_BODY = """# Acme customer story

Cookie policy: we use cookies to improve your experience on this website and to remember the
choices you make while browsing the Acme storefront across all of our European markets today.

Acme Retail rebuilt its product discovery on Algolia after search latency became the single
largest driver of cart abandonment across its European storefronts during the last peak season.
The migration replaced a self-managed Elasticsearch cluster that had grown to eleven nodes and
required a dedicated engineer to operate it from one week to the next without interruption.

Conversion from search rose by 34 percent in the first quarter after launch, measured against
the same period a year earlier across all six of the markets that were included in the rollout.
The team also reported that median query latency fell from 480 milliseconds to 21 milliseconds
on a catalogue of exactly the same size as before the migration began in earnest last spring.

Acme now indexes 1.2 million products and pushes catalogue updates every four minutes without
taking the search index offline at any point during the whole of the nightly update window.
"""


def _drive(run_cli, wire, pick, body=CHROME_BODY):
    records = make_records(1)
    wire(algolia=FakeAlgolia(records), scout_client=FakeScout({"rec-0": body}),
         inference=FakeInference({
             "large": pick,
             "small": {"verdict": "PASS", "representativeness": 5, "specificity": 5,
                       "information_gain": 5, "coherence": 5, "juxtaposition": 5, "defects": []},
         }))
    assert run_cli("plan-slice", "--run-id", RUN, *SLICE) == 0
    assert run_cli("fetch", "--run-id", RUN, *SLICE) == 0
    assert run_cli("enrich", "--run-id", RUN, *SLICE) == 0
    return None


def _rows(workspace):
    p = (Path(workspace) / "docs" / "70-enrichment" / "runs" / RUN /
         "outputs" / "base" / "results.jsonl")
    return [json.loads(l) for l in p.read_text().splitlines() if l.strip()]


def test_the_chrome_filter_reaches_the_live_menu(run_cli, wire, workspace):
    """A cookie banner must not be on the menu the model sees, so it cannot be picked."""
    _drive(run_cli, wire, {"verdict": "REAL", "abstract": [1, 2], "highlights": [3, 4, 5, 6],
                           "language_observed": "en"})
    row = _rows(workspace)[0]
    dropped = row.get("pool_dropped") or {}
    assert any(k.startswith("CHROME_") for k in dropped), \
        f"the chrome filter did not run on the live path; drops were {dropped}"
    stored = " ".join(row.get("abstract_spans_stored") or [])
    assert "cookie" not in stored.lower()


def test_an_out_of_range_id_is_refused_on_the_live_path(run_cli, wire, workspace):
    """The ID contract, end to end. 9999 indexes nothing on this page."""
    _drive(run_cli, wire, {"verdict": "REAL", "abstract": [9999], "highlights": [9998],
                           "language_observed": "en"})
    row = _rows(workspace)[0]
    assert row["status"] != "PASS"
    assert 9999 in (row.get("out_of_range_picks") or [])
    assert not row.get("abstract_spans_stored")


def test_the_language_policy_reaches_the_live_path(run_cli, wire, workspace):
    """`must_match_record` is a case-study setting. The Blog exemption must not leak into it."""
    _drive(run_cli, wire, {"verdict": "REAL", "abstract": [2, 3], "highlights": [4, 5, 6],
                           "language_observed": "de"})
    row = _rows(workspace)[0]
    assert row["status"] == "LANGUAGE_MISMATCH"
    assert row["language_mismatch"] is True


def test_the_effective_config_echo_states_which_gates_ran(run_cli, wire, workspace):
    _drive(run_cli, wire, {"verdict": "REAL", "abstract": [2, 3], "highlights": [4, 5, 6],
                           "language_observed": "en"})
    cfg = json.loads((Path(workspace) / "docs" / "70-enrichment" / "runs" / RUN /
                      "effective-config.json").read_text())
    assert cfg["profile_id"] == "Customer Stories/case-study"
    assert cfg["strategy"] == "case_study"
    assert cfg["thresholds"]["min_body_chars"] == 900
    assert "G-information-gain" in cfg["gates_loaded"]
    assert cfg["canonical_version"] and cfg["writer_model"] == "glm-5.2"


def test_the_writer_prompt_carries_the_profiles_own_strategy(run_cli, wire, workspace):
    """A profile that declares case_study must not be handed the editorial instruction."""
    records = make_records(1)
    inf = FakeInference({"large": {"verdict": "THIN", "abstract": [], "highlights": [],
                                   "language_observed": "en",
                                   "insufficient_reason": "NO_PROSE"}})
    wire(algolia=FakeAlgolia(records), scout_client=FakeScout({"rec-0": CHROME_BODY}),
         inference=inf)
    assert run_cli("plan-slice", "--run-id", RUN, *SLICE) == 0
    assert run_cli("fetch", "--run-id", RUN, *SLICE) == 0
    assert run_cli("enrich", "--run-id", RUN, *SLICE) == 0
    prompt = inf.calls[0][1]
    assert "customer case study" in prompt
    # matched on a single line: the instruction is hard-wrapped, so a phrase that spans the
    # wrap would fail for a formatting reason and say nothing about routing
    assert "logo-wall" in prompt and "outcome metrics" in prompt
    assert "2 to 3 numbers" in prompt          # the profile's abstract_span_count, not a default
