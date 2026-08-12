"""Gate registry and command composition ONLY. No validation logic lives here.

The split is deliberate: one god-object called `validate.py` is what eleven separate historical
verifier scripts collapsed into, and eleven verifier scripts is eleven incidents rather than a
design. Each module below owns one question:

    grounding.py  is the string on the page, without trusting an offset
    quality.py    should it have been chosen
    payload.py    is the write shape legal
    live.py       does the index actually say what we approved
    search.py     is it reachable by a query (out of the v0 critical path)

One registry defines the gates and there is ONE live call path. `test_gate_wiring.py` proves a
gate added to a helper module is reached by the CLI command rather than sitting in a path the
runner never enters -- which happened twice on this project.
"""

from . import grounding, live, payload, quality, search  # noqa: F401

# id -> (module, what it refuses). Echoed into effective-config.json by the runner, so the run's
# own output states which gates were loaded.
GATE_REGISTRY = {
    "V-grounding-offset-free": "every stored string is located in its Scout body without offsets",
    "V-grounding-offset-slice": "the claimed offsets still address the stored string",
    "V-grounding-zero-spans": "checking zero spans is a failure, never a pass",
    "V-quality-leakage": "no known site furniture reached a stored field",
    "V-quality-chrome": "no chrome or self-reference phrase dominates a span",
    "V-quality-incomplete": "no stored span is a colon lead-in, a cut sentence or a broken link",
    "V-quality-duplicate-description": "the abstract is not a restatement of the description",
    "V-quality-template": "no abstract prefix repeats across the slice like a template",
    "V-payload-allowed-fields": "only objectID, abstract_enriched, keyhighlights_enriched",
    "V-payload-no-null": "no null field: partialUpdate stores a literal null",
    "V-payload-no-duplicate-ids": "a duplicated results file is corrupt, not complete",
    "V-payload-in-manifest": "a write may only touch records the slice planned",
    "V-live-byte-match": "live values byte-match the approved payload",
    "V-live-no-extra-records": "the target index holds nothing the run did not plan",
    "V-live-no-metadata": "no pipeline bookkeeping field on a live record",
    "V-live-proof-of-life": "a query for enriched-only text returns > 0 hits on the target",
    "V-source-index-unchanged": "the source index record count and settings are untouched",
}
