#!/usr/bin/env python3
"""
A candidate that repeats what the record already stores is not enrichment. Make it unpickable.

WHY
  On 49 of 49 reference pages the markdown lede is byte-identical to that record's `description`
  field, which is already in the index. Two sessions were spent unbanning that sentence -- first
  from [FRAGMENT], then from [QUOTED] -- and both times the ban had been wrong about what the
  sentence IS. Both fixes were worthless as enrichment. Once the model could finally pick it, it
  did, and G7 information gain quarantined 26 of 50 records at 0 new content tokens. Writable went
  36% -> 54% -> 26%.

  G7 is right and does not move. The duplicate has to stop being an option instead.

THE APPROACH
  Same reasoning as making the model emit numbers rather than text: prefer the structural guarantee
  over an instruction. Arguing "do not repeat the description" in the prompt leaves the sentence
  selectable. Labelling it [ALREADY INDEXED] removes it from the unmarked set the prompt is allowed
  to choose from, so the failure becomes unrepresentable rather than discouraged.

    python3 -m pytest docs/70-enrichment/tests/test_already_indexed.py -q
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest  # noqa: E402

from candidates import render_menu, split_candidates  # noqa: E402

DESCRIPTION = "The Algolia Search API lets you search, configure, and manage your indices and records"

PAGE = (
    "> ## Documentation Index\n"
    "> Use this file to discover all available pages before exploring further.\n"
    "\n"
    "# Search API\n"
    "\n"
    f"> {DESCRIPTION}\n"
    "\n"
    "Access to the Usage REST API is available as part of the Premium plan or as an Enterprise add-on.\n"
    "\n"
    "Index settings that you don't specify are left unchanged.\n"
)


def line_for(menu, needle):
    hits = [ln for ln in menu.splitlines() if needle in ln]
    assert hits, f"{needle!r} not in menu:\n{menu}"
    return hits[0]


def test_the_duplicate_is_marked_already_indexed():
    cands, _ = split_candidates(PAGE, already_indexed=DESCRIPTION)
    menu = render_menu(cands)
    assert "[ALREADY INDEXED]" in line_for(menu, "lets you search, configure")


def test_body_facts_stay_unmarked_and_pickable():
    cands, _ = split_candidates(PAGE, already_indexed=DESCRIPTION)
    menu = render_menu(cands)
    for needle in ("Premium plan", "left unchanged"):
        line = line_for(menu, needle)
        assert "[ALREADY INDEXED]" not in line
        assert "[QUOTED]" not in line
        assert "[FRAGMENT]" not in line


def test_matching_ignores_trailing_punctuation_and_case():
    """The lede has no full stop; `description` sometimes does. They are the same sentence."""
    cands, _ = split_candidates(PAGE, already_indexed=DESCRIPTION.lower() + ".")
    assert any(c.is_already_indexed for c in cands)


def test_no_description_means_nothing_is_marked():
    cands, _ = split_candidates(PAGE)
    assert not any(c.is_already_indexed for c in cands)
    assert "[ALREADY INDEXED]" not in render_menu(cands)


def test_a_merely_similar_sentence_is_not_marked():
    """Only a real duplicate. A body fact that shares words with the description must survive."""
    cands, _ = split_candidates(PAGE, already_indexed="Search API reference for Algolia indices")
    assert not any(c.is_already_indexed for c in cands)


@pytest.mark.parametrize("needle,flag", [("lets you search, configure", True),
                                         ("Premium plan", False)])
def test_the_flag_matches_the_label(needle, flag):
    cands, _ = split_candidates(PAGE, already_indexed=DESCRIPTION)
    c = [x for x in cands if needle in x.text][0]
    assert c.is_already_indexed is flag


def test_the_runner_passes_the_records_description():
    """The 2026-08-08 lesson: a parameter that exists but is never passed is not a fix."""
    import inspect

    import enrich_run

    src = inspect.getsource(enrich_run.process)
    assert "already_indexed=" in src, \
        "enrich_run.process must pass the record's description into split_candidates"


def test_the_prompt_forbids_the_new_label():
    """A label the prompt never mentions is decoration. The exclusion list must name it."""
    import enrich_run

    assert "[ALREADY INDEXED]" in enrich_run.SELECT_PROMPT


def test_the_prompt_shows_the_model_what_the_record_already_has():
    """It cannot avoid duplicating fields it cannot see."""
    import enrich_run

    assert "{description}" in enrich_run.SELECT_PROMPT
