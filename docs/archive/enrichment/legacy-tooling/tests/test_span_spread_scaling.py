#!/usr/bin/env python3
"""
G10's truncation rescale used the wrong denominator and punished the best selections.

THE BUG
    spread      = max(end) - min(start)
    seen_length = max(l.end for l in abstract)      # <-- where the LAST SPAN ENDS
    spread      = spread * (original_length / seen_length)

  `seen_length` is meant to be "how much text the model was shown", so that offsets taken in a
  truncated page can be scaled back to the original. It is not that. It is the position of the last
  selected span, which has nothing to do with truncation.

  Consequence: the tighter and higher up the page a selection is, the smaller `seen_length` gets and
  the larger the multiplier. `/doc/rest-api/search/set-settings` picked candidates 4, 5 and 6 --
  three CONSECUTIVE sentences spanning 204 characters -- and G10 reported
  "~37708 characters of the original page (limit 20000)":

      204 * (81887 / 443) = 37,709

  Measured on run D: **11 of 50 records quarantined solely by this**, the single largest failure
  bucket, and every one of them was a well-formed adjacent selection. The check was inverted -- it
  rejected coherent picks and would wave through a spread-out one taken from the bottom of a page,
  where seen_length is large and the multiplier collapses to ~1.

THE FIX
  Scale by the length of the text actually handed to the model, passed in explicitly. No argument,
  no scaling -- silence must not invent a multiplier.

    python3 -m pytest docs/70-enrichment/tests/test_span_spread_scaling.py -q
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest  # noqa: E402

from span_gate import check_context  # noqa: E402


class FakeSpan:
    """Minimal stand-in for Located: G10's spread test reads only these."""

    def __init__(self, start, end, text="A sentence about the subject of this page.",
                 section_index=0):
        self.start = start
        self.end = end
        self.stored_text = text
        self.original_text = text
        self.is_quoted = False
        self.section = "Body"
        self.section_index = section_index   # same section, so only the spread test can fire
        self.followed_by = ""


def spread_errors(abstract, original_length=0, seen_length=0):
    errs = check_context(abstract, [], "reference", original_length, seen_length)
    return [e for e in errs if "characters of the original page" in e]


ADJACENT = [FakeSpan(239, 296), FakeSpan(297, 352), FakeSpan(354, 443)]


def test_three_adjacent_sentences_high_on_a_long_page_are_accepted():
    """The exact /doc/rest-api/search/set-settings case: 204 chars apart on an 81,887-char page."""
    assert spread_errors(ADJACENT, original_length=81887, seen_length=81887) == []


def test_the_old_denominator_would_have_rejected_them():
    """Documents the defect: last-span-end as denominator inflates 204 to ~37,700."""
    bad_scale = 204 * (81887 / 443)
    assert bad_scale > 20000


def test_no_seen_length_means_no_scaling():
    """Silence must not invent a multiplier."""
    assert spread_errors(ADJACENT, original_length=81887) == []


def test_untruncated_page_is_never_scaled():
    assert spread_errors(ADJACENT, original_length=81887, seen_length=81887) == []


def test_a_genuinely_spread_out_selection_is_still_rejected():
    """The check must keep working. G10 exists to stop two unrelated sentences being welded
    together, and 50,000 characters apart is exactly that."""
    far = [FakeSpan(100, 160), FakeSpan(50000, 50060)]
    assert spread_errors(far, original_length=81887, seen_length=81887)


def test_truncation_still_scales_up():
    """A page cut to 10,000 chars whose spans sit 5,000 apart really is ~40,000 apart in an
    80,000-char original, and must still fail."""
    spans = [FakeSpan(100, 160), FakeSpan(5000, 5060)]
    assert spread_errors(spans, original_length=80000, seen_length=10000)


def test_truncation_scaling_does_not_fire_below_the_limit():
    spans = [FakeSpan(100, 160), FakeSpan(1000, 1060)]
    assert spread_errors(spans, original_length=80000, seen_length=40000) == []


def test_the_runner_passes_the_seen_length():
    """A parameter that exists but is never passed is not a fix -- the 2026-08-08 lesson.

    Greps the whole live path: the check_context call moved into evaluate_selection on
    2026-08-10. See tests/live_path.py for why this is not narrowed to one function.
    """
    import os
    import sys
    sys.path.insert(0, os.path.dirname(__file__))
    from live_path import live_path_source

    assert "seen_length" in live_path_source(), (
        "the live enrichment path must pass seen_length to check_context")


@pytest.mark.parametrize("n", [1])
def test_a_single_span_has_zero_spread(n):
    assert spread_errors([FakeSpan(50000, 50100)], original_length=81887, seen_length=81887) == []
