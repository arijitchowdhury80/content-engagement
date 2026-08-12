#!/usr/bin/env python3
"""
The repair packet's quality checker must FIRE. A verifier that never fails is not a verifier.

WHY THIS FILE EXISTS
  `verify_repair_packet.quality_defects` reported zero defects across the first 86 repaired
  records, which is the result we wanted and therefore the result to distrust. Two known failure
  modes: a filter on a non-faceted attribute returns empty rather than erroring, and a checker
  whose predicate silently never matches reports a clean run.

  So every one of the seven defect classes is fed a span that carries it, and the checker must
  name it. The SPANS_TOO_FAR case caught a real bug in the first draft of this test -- the offsets
  were written end-before-start, the spread computed as 120 instead of 90,120, and the check
  correctly did not fire. The test was wrong, not the checker, and only writing the case down
  found that out.

    python3 -m pytest docs/70-enrichment/tests/test_repair_packet_checker.py -q
"""

import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from verify_repair_packet import quality_defects  # noqa: E402

BODY = """# Algolia ranking explained

Algolia indexes content fast and returns results in milliseconds. Algolia ranks results well
using a tie-breaking algorithm applied in a fixed order. Relevance is tuned per index rather
than globally. In this article we cover ranking. Algolia offers several benefits: speed,
relevance and control. The suggestions will be based on cookie data collected in your browser.

## Common mistakes

Sorting by a numeric attribute first looks appealing on a small catalogue.

## Where it gets subtle

Custom ranking works well when the attribute is dense. However, a sparse attribute pushes
records into an arbitrary order and should not be used.
"""

SRC = {"markdown": BODY, "title": "Algolia ranking explained", "original_length": len(BODY)}


def _defects(spans, offsets=None, highlights=None):
    return set(quality_defects(
        {"abstract_spans_stored": spans, "span_offsets": offsets or [],
         "keyhighlights_enriched": highlights or []}, SRC))


@pytest.mark.parametrize("expected,spans", [
    ("MISSING_SUBJECT", ["It lets multiple software programs exchange data by contract."]),
    ("SELF_REFERENCE", ["Algolia indexes content fast.", "In this article we cover ranking."]),
    ("DANGLING_COLON", ["Algolia offers several benefits:"]),
    ("MID_SENTENCE_CUT", ["Algolia indexes content and then the system"]),
    ("BROKEN_BRACKET", ["Algolia [docs are here and the page is complete."]),
    ("CHROME", ["The suggestions will be based on cookie data collected in your browser."]),
    ("REVERSAL", ["Custom ranking works well when the attribute is dense."]),
    ("EXCLUDED_SECTION",
     ["Sorting by a numeric attribute first looks appealing on a small catalogue."]),
])
def test_the_checker_names_the_defect(expected, spans):
    assert expected in _defects(spans), f"{expected} went undetected on {spans[0][:60]!r}"


def test_spans_too_far_fires_on_a_real_spread():
    """Offsets are [start, end] into the ORIGINAL markdown. End-before-start is not a wide span."""
    spans = ["Algolia indexes content fast.", "Algolia ranks results well."]
    assert "SPANS_TOO_FAR" in _defects(spans, offsets=[[0, 29], [90_000, 90_120]])


def test_spans_too_far_does_not_fire_on_an_adjacent_pair():
    """Crying wolf costs as much as missing: an adjacent pick must stay clean."""
    spans = ["Algolia indexes content fast.", "Algolia ranks results well."]
    assert "SPANS_TOO_FAR" not in _defects(spans, offsets=[[0, 29], [30, 60]])


def test_a_clean_selection_reports_nothing():
    """The other half of the guard. A checker that fires on everything is also useless."""
    spans = ["Algolia indexes content fast and returns results in milliseconds.",
             "Relevance is tuned per index rather than globally."]
    assert _defects(spans, offsets=[[0, 65], [66, 118]]) == set()
