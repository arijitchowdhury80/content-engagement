#!/usr/bin/env python3
"""Blog output validation edge cases found on the live 2026-08-09 run."""

from __future__ import annotations

import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HERE))

import validate_blog_outputs as V  # noqa: E402


def test_visible_markdown_grounding_accepts_link_label_without_url():
    body = (
        "To measure this, they [integrated Algolia's Analytics with their Adobe "
        "ecommerce platform](https://resources.algolia.com/customer/pentair), "
        "creating a front-to-back analytics data feed."
    )
    span = (
        "To measure this, they integrated Algolia's Analytics with their Adobe "
        "ecommerce platform, creating a front-to-back analytics data feed."
    )
    assert V.grounding_modes(body, span)["visible_markdown"]


def test_visible_markdown_grounding_folds_smart_punctuation_but_not_numbers():
    body = (
        "This could come in the form of a chatbot, but it doesn’t have to — agents "
        "are currently being deployed with [Algolia’s Agent Studio](/doc/guides/agent-studio)."
    )
    ok = (
        "This could come in the form of a chatbot, but it doesn't have to - agents "
        "are currently being deployed with Algolia’s Agent Studio."
    )
    bad = (
        "This could come in the form of a chatbot, but it doesn't have to - agents "
        "are currently being deployed with Algolia’s Agent Studio in 500 use cases."
    )
    assert V.grounding_modes(body, ok)["visible_markdown"]
    assert not any(V.grounding_modes(body, bad).values())


def test_offset_mismatch_is_reported_separately_from_grounding():
    body = (
        "Wrong slice lives here. "
        "The useful sentence links to [Algolia Analytics](/analytics) for attribution."
    )
    span = "The useful sentence links to Algolia Analytics for attribution."
    row = {
        "objectID": "id-1",
        "status": "PASS",
        "abstract_spans_stored": [span],
        "keyhighlights_enriched": [],
        "span_offsets": [[0, 22]],
    }
    source = {
        "objectID": "id-1",
        "source": "Blog",
        "page_type": "blog-post",
        "markdown": body,
        "title": "T",
        "description": "D",
        "source_url": "https://example.com/blog",
    }
    report = V.validate([row], {"id-1": source})
    assert report["grounding_failures"] == []
    assert report["offset_mismatches"][0]["objectID"] == "id-1"


def test_visible_markdown_grounding_keeps_snake_case_identifiers():
    body = (
        "It _batch-saves_ 10000 record-chunks using the "
        "[`save_objects`](https://www.algolia.com/doc/api-reference/api-methods/save-objects/) "
        "method of [Algolia's Python API](/doc/python)."
    )
    span = "It _batch-saves_ 10000 record-chunks using the save_objects method of Algolia's Python API."
    assert V.grounding_modes(body, span)["visible_markdown"]


def test_leakage_flags_broken_markdown_but_not_snake_case():
    bad = (
        "Using expect-jsx will save time. expect-jsx is based on "
        "[algolia/react-element-to-jsx-string."
    )
    good = "It uses the save_objects method of Algolia's Python API."
    assert "BROKEN_MARKDOWN_LINK" in V.span_leak_reasons(bad, "Title", "Description")
    assert V.span_leak_reasons(good, "Title", "Description") == []
