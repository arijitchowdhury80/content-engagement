"""Per-record ledger, run metrics, and the effective-config echo.

THE LEDGER
  Every planned record has exactly one terminal outcome: written, repaired-then-written, or in
  the human-review queue. "Zero records unaccounted for" is checkable only if something counts
  them, so the ledger is the thing `build-final` reconciles against `manifest.json`.

THE EFFECTIVE-CONFIG ECHO
  On this project a gate was "fixed" twice in a code path the runner never reached. Reading the
  source proved nothing; every unit test passed; the pipeline behaved exactly as before. The only
  evidence that a threshold arrived is the RUN'S OWN OUTPUT.

  So every record-processing command writes and prints `effective-config.json`, and `validate`
  hard-fails when it disagrees with the profile it claims. The gate list in it is the list the
  runner loaded, not the list in source.

RUN METRICS
  Without tokens/record and wall-clock/record no slice is plannable before launch. The measured
  Scout baseline on one German case study was elapsed 79.9s of which the scrape itself was 11.2s
  -- queue wait dominates, so the concurrency ceiling matters far more than per-page speed, and
  `plan-slice` projects from measured concurrency rather than from `duration_ms`.
"""

from __future__ import annotations

import json
import time
from pathlib import Path

LEDGER = "ledger.jsonl"
METRICS = "metrics.json"
EFFECTIVE_CONFIG = "effective-config.json"


class Ledger:
    def __init__(self, run_dir: Path):
        self.path = Path(run_dir) / LEDGER

    def append(self, object_id: str, stage: str, outcome: str, **detail) -> None:
        row = {"objectID": object_id, "stage": stage, "outcome": outcome}
        row.update(detail)
        with self.path.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n")

    def rows(self) -> list[dict]:
        if not self.path.exists():
            return []
        return [json.loads(l) for l in self.path.read_text().splitlines() if l.strip()]

    def outcomes(self) -> dict[str, str]:
        """objectID -> latest outcome. Later stages supersede earlier ones."""
        out: dict[str, str] = {}
        for row in self.rows():
            out[row["objectID"]] = row["outcome"]
        return out


class Metrics:
    """Append-only counters plus a wall clock. Written on every record-processing command."""

    def __init__(self, run_dir: Path, command: str):
        self.path = Path(run_dir) / METRICS
        self.command = command
        self.started = time.time()
        self.counts: dict[str, float] = {}

    def add(self, key: str, value: float = 1) -> None:
        self.counts[key] = self.counts.get(key, 0) + value

    def flush(self, records: int) -> dict:
        elapsed = time.time() - self.started
        entry = {
            "records": records,
            "elapsed_s": round(elapsed, 2),
            "s_per_record": round(elapsed / records, 3) if records else None,
            **{k: round(v, 4) if isinstance(v, float) else v for k, v in self.counts.items()},
        }
        data = json.loads(self.path.read_text()) if self.path.exists() else {}
        data.setdefault(self.command, []).append(entry)
        self.path.write_text(json.dumps(data, indent=2, sort_keys=True))
        return entry


def write_effective_config(run_dir: Path, *, profile, gates_loaded: list[str],
                           writer_model: str, judge_model: str | None,
                           prompt_version: str, canonical_version: str,
                           body_source: str, thresholds: dict) -> dict:
    """Write AND return the config the runner actually loaded. The caller prints it."""
    cfg = {
        "profile_id": f"{profile.source}/{profile.page_type}",
        "profile_version": profile.version,
        "strategy": profile.strategy,
        "gates_loaded": sorted(gates_loaded),
        "thresholds": thresholds,
        "writer_model": writer_model,
        "judge_model": judge_model,
        "prompt_version": prompt_version,
        "canonical_version": canonical_version,
        "body_source": body_source,
    }
    (Path(run_dir) / EFFECTIVE_CONFIG).write_text(json.dumps(cfg, indent=2, sort_keys=True))
    return cfg


def read_effective_config(run_dir: Path) -> dict | None:
    p = Path(run_dir) / EFFECTIVE_CONFIG
    return json.loads(p.read_text()) if p.exists() else None
