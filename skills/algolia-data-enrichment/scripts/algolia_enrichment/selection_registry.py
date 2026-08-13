"""Durable, content-addressed selection registry.

The writer is allowed to choose page candidates once.  Once that selection has passed the
full validation path, a later run over the identical page/profile/prompt must reuse it rather
than silently producing a different, equally-grounded version of the record.

This registry is run evidence, never Algolia data.  It contains candidate IDs only, not a model
authored field and not anything that can be written by ``write.apply_write``.
"""

from __future__ import annotations

import fcntl
import json
import os
from pathlib import Path
import tempfile
import threading
from contextlib import contextmanager

from .errors import EnrichmentError


REGISTRY_RELATIVE_PATH = Path("docs/operations/enrichment/state/selection-registry.jsonl")


class RunSelectionCoordinator:
    """Single-flight model selection for one parallel ``enrich`` invocation.

    The durable registry is intentionally populated only after final validation.  Before that
    point, workers processing duplicate selection input still need one answer: otherwise each
    worker can ask the stochastic writer and produce a later freeze conflict.  This coordinator
    serialises only matching input contracts and shares a per-run, already quality-approved
    choice.  Different pages retain full parallelism.
    """

    def __init__(self, cache: dict[tuple[str, str, str], dict]):
        self.cache = cache
        self._guard = threading.Lock()
        self._locks: dict[str, threading.Lock] = {}

    @contextmanager
    def hold(self, input_lock_key: str):
        with self._guard:
            lock = self._locks.setdefault(input_lock_key, threading.Lock())
        with lock:
            yield

    def publish(self, row: dict, *, run_id: str) -> None:
        """Expose a successful in-run choice to duplicate inputs after it clears the judge."""
        if row.get("status") != "PASS" or row.get("selection_origin") != "model":
            return
        ids = row.get("selected_candidate_ids")
        if not isinstance(ids, dict) or not ids.get("abstract") or not ids.get("highlights"):
            raise EnrichmentError(f"{row.get('objectID')}: PASS row has no candidate-ID selection")
        key = key_of(row)
        existing = self.cache.get(key)
        if existing and existing.get("selected_candidate_ids") != ids:
            raise EnrichmentError(
                f"{row.get('objectID')}: concurrent selection differs for input contract "
                f"{key[0][:12]}")
        self.cache.setdefault(key, {
            "selected_candidate_ids": ids,
            "frozen_from_run": run_id,
            "run_local": True,
        })


@contextmanager
def _writer_lock(path: Path):
    """Serialise registry read-modify-write across independent enrichment runs."""
    path.parent.mkdir(parents=True, exist_ok=True)
    lock_path = path.with_name(f".{path.name}.lock")
    with lock_path.open("a+") as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(lock.fileno(), fcntl.LOCK_UN)


def _atomic_write(path: Path, text: str) -> None:
    """Readers see either the old complete registry or the new complete registry, never half."""
    fd, tmp_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(fd, "w") as tmp:
            tmp.write(text)
            tmp.flush()
            os.fsync(tmp.fileno())
        os.replace(tmp_name, path)
    finally:
        Path(tmp_name).unlink(missing_ok=True)


def _legacy_lines(path: Path) -> list[str]:
    """Return raw-hash registry history verbatim; it is not an active selection contract."""
    if not path.exists():
        return []
    lines = []
    for line in path.read_text().splitlines():
        if not line.strip():
            continue
        row = json.loads(line)
        if not row.get("selection_content_hash"):
            lines.append(line)
    return lines


def key_of(row: dict) -> tuple[str, str, str]:
    """The content, profile and prompt together define a selectable menu contract."""
    key = (str(row.get("selection_content_hash") or ""), str(row.get("profile_version") or ""),
           str(row.get("prompt_version") or ""))
    if not all(key):
        raise EnrichmentError(
            "cannot freeze a selection without selection_content_hash/profile/prompt version")
    return key


def load(path: Path) -> dict[tuple[str, str, str], dict]:
    if not path.exists():
        return {}
    out: dict[tuple[str, str, str], dict] = {}
    for line in path.read_text().splitlines():
        if not line.strip():
            continue
        row = json.loads(line)
        # Pre-v0 rows used the raw Scout-body hash. They are diagnostic history, not valid
        # selection contracts: raw bytes can differ outside the model's main-content input.
        # Keep them on disk, but never let them seed or block the corrected registry.
        if not row.get("selection_content_hash"):
            continue
        key = key_of(row)
        prior = out.get(key)
        if prior and prior.get("selected_candidate_ids") != row.get("selected_candidate_ids"):
            raise EnrichmentError(f"selection registry has conflicting entries for {key[0][:12]}")
        out[key] = row
    return out


def freeze(path: Path, rows: list[dict], *, run_id: str) -> dict:
    """Append only newly approved selections; a different choice for a known hash is a refusal."""
    with _writer_lock(path):
        legacy = _legacy_lines(path)
        registry = load(path)
        added = 0
        for row in rows:
            if row.get("status") != "PASS":
                continue
            ids = row.get("selected_candidate_ids")
            if not isinstance(ids, dict) or not ids.get("abstract") or not ids.get("highlights"):
                raise EnrichmentError(f"{row.get('objectID')}: PASS row has no candidate-ID selection")
            key = key_of(row)
            entry = {
                "selection_content_hash": key[0], "profile_version": key[1],
                "prompt_version": key[2],
                "selected_candidate_ids": ids, "frozen_from_run": run_id,
                "objectID": row["objectID"],
            }
            prior = registry.get(key)
            if prior:
                if prior["selected_candidate_ids"] != ids:
                    raise EnrichmentError(
                        f"{row['objectID']}: validated selection differs from frozen selection for "
                        f"content hash {key[0][:12]}; run parity review before replacing it")
                continue
            registry[key] = entry
            added += 1
        _atomic_write(path, "".join(line + "\n" for line in legacy) +
                      "".join(json.dumps(v, sort_keys=True) + "\n"
                              for _, v in sorted(registry.items())))
    return {"entries": len(registry), "added": added, "path": str(path)}
