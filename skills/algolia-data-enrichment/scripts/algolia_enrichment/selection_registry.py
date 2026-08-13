"""Durable, content-addressed selection registry.

The writer is allowed to choose page candidates once.  Once that selection has passed the
full validation path, a later run over the identical page/profile/prompt must reuse it rather
than silently producing a different, equally-grounded version of the record.

This registry is run evidence, never Algolia data.  It contains candidate IDs only, not a model
authored field and not anything that can be written by ``write.apply_write``.
"""

from __future__ import annotations

import json
from pathlib import Path

from .errors import EnrichmentError


REGISTRY_RELATIVE_PATH = Path("docs/70-enrichment/selection-registry.jsonl")


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
        key = key_of(row)
        prior = out.get(key)
        if prior and prior.get("selected_candidate_ids") != row.get("selected_candidate_ids"):
            raise EnrichmentError(f"selection registry has conflicting entries for {key[0][:12]}")
        out[key] = row
    return out


def freeze(path: Path, rows: list[dict], *, run_id: str) -> dict:
    """Append only newly approved selections; a different choice for a known hash is a refusal."""
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
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("".join(json.dumps(v, sort_keys=True) + "\n"
                            for _, v in sorted(registry.items())))
    return {"entries": len(registry), "added": added, "path": str(path)}
