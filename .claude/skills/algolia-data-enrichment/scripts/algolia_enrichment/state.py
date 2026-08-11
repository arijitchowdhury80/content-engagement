"""Run state. Multi-track, not a single linear enum.

Blog proved write and quarantine are separate operations that can happen in either
order, and that a crash mid-enrich must be representable. A single chain cannot
express either, so state is a record of independent tracks plus a per-record ledger.
"""
from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from pathlib import Path

from .errors import StateError

PHASE = ("NONE", "PARTIAL", "DONE", "FAILED")
WRITE = ("NONE", "DRY_RUN_PASSED", "APPLIED", "LIVE_VERIFIED")

LEGAL: dict[str, tuple[str, ...]] = {
    "fetch": PHASE, "enrich": PHASE, "repair": PHASE,
    "final": ("NONE", "BUILT"), "validate": ("NONE", "PASSED", "FAILED"),
    "write": WRITE,
}


@dataclass
class RunState:
    run_id: str
    source: str
    page_type: str
    target_index: str
    tracks: dict[str, str] = field(default_factory=lambda: {k: "NONE" for k in LEGAL})
    closed: bool = False
    failed_reason: str | None = None

    @property
    def path_name(self) -> str:
        return "state.json"

    def set(self, track: str, value: str) -> None:
        if track not in LEGAL:
            raise StateError(f"unknown track {track!r}")
        if value not in LEGAL[track]:
            raise StateError(f"{track!r} cannot be {value!r}; legal: {LEGAL[track]}")
        self.tracks[track] = value

    def require(self, track: str, *allowed: str) -> None:
        cur = self.tracks.get(track, "NONE")
        if cur not in allowed:
            raise StateError(
                f"illegal transition: {track!r} is {cur!r}, requires one of {allowed}"
            )

    def save(self, run_dir: Path) -> Path:
        p = Path(run_dir) / self.path_name
        p.write_text(json.dumps(asdict(self), indent=2, sort_keys=True))
        return p

    @classmethod
    def load(cls, run_dir: Path) -> "RunState":
        d = json.loads((Path(run_dir) / "state.json").read_text())
        return cls(**d)
