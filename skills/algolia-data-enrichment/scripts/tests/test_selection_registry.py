from __future__ import annotations

import json
from pathlib import Path
import sys
import threading
import time

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from algolia_enrichment.errors import EnrichmentError
from algolia_enrichment.selection_registry import RunSelectionCoordinator, freeze, load


def _row(ids=(3, 7)):
    return {
        "objectID": "one", "status": "PASS", "selection_content_hash": "a" * 64,
        "profile_version": "blog-v1", "prompt_version": "select-v2",
        "selected_candidate_ids": {"abstract": list(ids), "highlights": [11, 12, 13]},
    }


def test_freeze_is_idempotent_for_the_same_validated_selection(tmp_path):
    p = tmp_path / "selection-registry.jsonl"
    assert freeze(p, [_row()], run_id="a01")["added"] == 1
    assert freeze(p, [_row()], run_id="a02")["added"] == 0
    assert len(load(p)) == 1


def test_freeze_refuses_a_second_selection_for_the_same_content_contract(tmp_path):
    p = tmp_path / "selection-registry.jsonl"
    freeze(p, [_row()], run_id="a01")
    with pytest.raises(EnrichmentError, match="differs from frozen selection"):
        freeze(p, [_row((4, 8))], run_id="a02")


def test_nonpass_rows_do_not_enter_the_registry(tmp_path):
    p = tmp_path / "selection-registry.jsonl"
    row = _row()
    row["status"] = "QUARANTINED_BY_GATE"
    assert freeze(p, [row], run_id="a01")["entries"] == 0
    assert not p.exists() or not p.read_text()


def test_legacy_raw_hash_rows_are_preserved_but_never_loaded_as_contracts(tmp_path):
    p = tmp_path / "selection-registry.jsonl"
    p.write_text(json.dumps({"objectID": "legacy", "content_hash": "b" * 64,
                              "profile_version": "blog-v1", "prompt_version": "select-v2",
                              "selected_candidate_ids": {"abstract": [3], "highlights": [4]}}) + "\n")
    assert freeze(p, [_row()], run_id="a01")["added"] == 1
    assert len(load(p)) == 1
    assert '"content_hash"' in p.read_text(), "legacy evidence must not be silently deleted"


def test_singleflight_allows_one_model_choice_for_matching_input_contract():
    """30 workers must not make competing choices before final freeze can run."""
    cache = {}
    coordinator = RunSelectionCoordinator(cache)
    calls = 0
    calls_lock = threading.Lock()
    start = threading.Barrier(2)
    results = []

    def worker(object_id: str):
        nonlocal calls
        start.wait()
        with coordinator.hold("same-cleaned-selection-input"):
            key = ("a" * 64, "blog-v1", "select-v2")
            if key not in cache:
                with calls_lock:
                    calls += 1
                time.sleep(0.03)
                row = _row()
                row["objectID"] = object_id
                row["selection_origin"] = "model"
                coordinator.publish(row, run_id="a01")
            results.append(cache[key]["selected_candidate_ids"])

    threads = [threading.Thread(target=worker, args=(f"record-{i}",)) for i in range(2)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert calls == 1
    assert results == [{"abstract": [3, 7], "highlights": [11, 12, 13]}] * 2
