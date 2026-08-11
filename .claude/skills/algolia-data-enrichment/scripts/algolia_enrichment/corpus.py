"""Corpus tracker. It exists to keep the slice runner honest, not to become its own platform.

THE ONE QUESTION IT ANSWERS
  For each slice: what is written to the target index, what is pending, and what needs a human?

  It reconciles three independent sources -- the live source index, the live target index, and
  the run manifests -- and fails when they disagree. A number that only one of them knows is not
  a status, it is a claim.

IT FAILS ON AN UNPROFILED LIVE page_type.
  Not warns. A page_type with no profile and no explicit exclusion means a slice will hard-refuse
  mid-run, and finding that out during the run is the expensive moment.
"""

from __future__ import annotations

import datetime as dt
import json
from pathlib import Path

CORPUS_STATE = "CORPUS-STATE.json"


def live_slice_counts(client, index: str) -> dict[str, int]:
    """{"Source/page_type": n} by full scan. Facets are capped and a cap that silently truncates
    is how a census lies; the scan is the census."""
    counts: dict[str, int] = {}
    for hit in client.browse(index, attributes=["source", "page_type"]):
        key = f"{hit.get('source')}/{hit.get('page_type')}"
        counts[key] = counts.get(key, 0) + 1
    return counts


def target_enriched_ids(client, index: str) -> set[str]:
    """objectIDs in the target index that carry an abstract. Empty target is legal (v0 starts
    empty); an empty SOURCE would not be."""
    out: set[str] = set()
    for hit in client.browse(index, attributes=["objectID", "abstract_enriched"]):
        if hit.get("abstract_enriched"):
            out.add(hit["objectID"])
    return out


def load_state(workspace: Path) -> dict:
    p = Path(workspace) / "docs" / "70-enrichment" / CORPUS_STATE
    return json.loads(p.read_text()) if p.exists() else {}


def build_status(client, source_index: str, target_index: str, runs_dir: Path,
                 lint_report: dict) -> dict:
    live = live_slice_counts(client, source_index)
    _, source_records = client.record_count(source_index)
    target_exists = client.index_exists(target_index)
    written_ids = target_enriched_ids(client, target_index) if target_exists else set()
    _, target_records = client.record_count(target_index) if target_exists else (0, 0)

    slices: dict[str, dict] = {}
    for manifest_path in sorted(Path(runs_dir).glob("*/manifest.json")):
        run_dir = manifest_path.parent
        manifest = json.loads(manifest_path.read_text())
        key = f"{manifest['source']}/{manifest['page_type']}"
        cov_path = run_dir / "validation" / "coverage.json"
        coverage = json.loads(cov_path.read_text()) if cov_path.exists() else {}
        planned_ids = set(manifest.get("objectIDs") or [])
        entry = slices.setdefault(key, {
            "source": manifest["source"], "page_type": manifest["page_type"],
            "runs": [], "planned_target_count": 0, "target_written_live": 0,
        })
        entry["runs"].append(manifest["run_id"])
        entry["planned_target_count"] = max(entry["planned_target_count"], len(planned_ids))
        entry["target_written_live"] = len(planned_ids & written_ids)
        entry["last_run_id"] = manifest["run_id"]
        entry["profile_version"] = manifest.get("profile_version")
        if coverage:
            entry["coverage"] = coverage
            # RECONCILIATION, not restatement. The run artifact's claim and the live index's
            # count are two independent sources; if they disagree, one of them is wrong and the
            # status is red rather than whichever number is nicer.
            entry["reconciles"] = coverage.get("target_written") == entry["target_written_live"]

    unreconciled = [k for k, v in slices.items() if v.get("reconciles") is False]
    return {
        "source_index": source_index,
        "target_index": target_index,
        "updated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "total_live_records": source_records,
        "target_index_exists": target_exists,
        "target_records": target_records,
        "target_enriched_records": len(written_ids),
        "live_page_types": len(live),
        "slices": slices,
        "unprofiled_page_types": [u["key"] for u in lint_report.get("uncovered", [])],
        "excluded": lint_report.get("excluded", {}),
        "unreconciled_slices": unreconciled,
        "ok": not lint_report.get("uncovered") and not unreconciled,
    }


def write_state(workspace: Path, status: dict) -> Path:
    p = Path(workspace) / "docs" / "70-enrichment" / CORPUS_STATE
    p.write_text(json.dumps(status, indent=2, sort_keys=True))
    return p
