"""The offset-free grounding check: is the stored span ON the page, wherever it is?

Arijit, 2026-08-09: "locate the stored span anywhere in the page / ignore artifact offsets for this
check." This is the check that restores independence. The span offsets live in the run artifacts,
so an offset-based check shares an input with the writer; asking only "does the page say this?"
shares nothing.

The failure it must never repeat is in this file's history twice over: a verifier that cries wolf
(9 good records reported broken by joined-string matching) is as dangerous as one that stays
silent, because both end in the guarantee being disbelieved.
"""

from __future__ import annotations

import pathlib
import sys

import pytest

HERE = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HERE))

import verify_written as vw  # noqa: E402
from span_gate import canonicalise  # noqa: E402

PAGE = """# Configure an index

The Algolia Search API lets you search, configure, and manage your indices and records.

## Rate limits

Rate limits apply per application and are enforced per second.
Records are limited to 100 KB each on the Standard plan.
"""


@pytest.fixture
def source():
    return canonicalise(PAGE)


def test_a_span_on_the_page_is_found_wherever_it_sits(source):
    assert vw._locatable(
        "The Algolia Search API lets you search, configure, and manage your indices and records.",
        source)
    # last line of the page, nowhere near the top -- position is irrelevant to this check
    assert vw._locatable("Records are limited to 100 KB each on the Standard plan.", source)


def test_a_span_not_on_the_page_is_not_found(source):
    assert not vw._locatable("Records are limited to 500 KB each on the Standard plan.", source)
    assert not vw._locatable("Algolia guarantees 99.999% uptime for all customers.", source)


def test_a_single_altered_number_is_caught(source):
    """The invention this whole design exists to prevent is a plausible near-miss, not gibberish."""
    assert vw._locatable("Records are limited to 100 KB each on the Standard plan.", source)
    assert not vw._locatable("Records are limited to 200 KB each on the Standard plan.", source)


def test_the_check_uses_no_offsets_at_all():
    """Same text, two pages differing only in where the sentence sits. Both must pass, because the
    check asks whether the page says it, never where."""
    sentence = "Rate limits apply per application and are enforced per second."
    top = canonicalise(f"# Title\n\n{sentence}\n\nfiller filler filler.\n")
    bottom = canonicalise("# Title\n\n" + ("filler filler filler.\n" * 40) + sentence + "\n")
    assert vw._locatable(sentence, top)
    assert vw._locatable(sentence, bottom)


def test_an_empty_span_is_not_silently_a_pass(source):
    assert not vw._locatable("", source)
    assert not vw._locatable("   ", source)


def test_whitespace_and_markdown_noise_do_not_cause_a_false_alarm():
    """Canonicalisation is what makes exact matching survivable. A stored span whose page has since
    been reflowed across lines must still be found -- otherwise the verifier fails good records,
    which is how it lost credibility the first time."""
    reflowed = canonicalise("# T\n\nRate limits apply per application\nand are enforced per "
                            "second.\n")
    assert vw._locatable("Rate limits apply per application and are enforced per second.",
                         reflowed)


def test_load_artifacts_returns_empty_for_a_missing_directory(tmp_path):
    """And main() turns that into a fatal exit rather than a vacuous pass -- an empty artifact map
    used to mean 'nothing to check', which reads identically to 'everything passed'."""
    assert vw.load_artifacts(tmp_path / "nope") == {}


def test_a_record_without_an_artifact_row_is_still_grounded(source):
    """The bug this asserts against was introduced and caught on 2026-08-09: an orphan guard
    `continue`d before the span checks, so records with the LEAST provenance got the LEAST
    verification. `verify_record_spans` takes no artifact at all, so grounding cannot depend on
    having one."""
    rec = {
        "objectID": "legacy-1",
        "abstract_enriched": [
            "The Algolia Search API lets you search, configure, and manage your indices and records.",
            "Records are limited to 100 KB each on the Standard plan.",
        ],
        "keyhighlights_enriched": ["Rate limits apply per application and are enforced per second."],
    }
    found, missing, failures = vw.verify_record_spans(rec, source)
    assert (found, missing, failures) == (3, 0, [])


def test_one_bad_span_among_good_ones_is_reported_precisely(source):
    rec = {
        "objectID": "rec-9",
        "abstract_enriched": [
            "Records are limited to 100 KB each on the Standard plan.",
            "Algolia guarantees 99.999% uptime for all customers.",   # not on the page
        ],
        "keyhighlights_enriched": [],
    }
    found, missing, failures = vw.verify_record_spans(rec, source)
    assert (found, missing) == (1, 1)
    assert "rec-9 abstract span: Algolia guarantees" in failures[0]


def test_the_legacy_joined_string_form_is_not_silently_counted_as_grounded(source):
    """A pre-lean-policy record stores abstract_enriched as ONE joined string. Joined strings are
    not contiguous on the page -- matching them is what produced 9 false alarms. This function must
    skip them, leaving them to the positional path, rather than fail them."""
    rec = {"objectID": "old-1",
           "abstract_enriched": "Span one. Span two.",
           "keyhighlights_enriched": []}
    assert vw.verify_record_spans(rec, source) == (0, 0, [])


def test_an_empty_record_verifies_to_nothing_rather_than_to_success(source):
    assert vw.verify_record_spans({"objectID": "x"}, source) == (0, 0, [])
