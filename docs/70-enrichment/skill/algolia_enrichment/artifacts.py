"""Artifact manifest + the residue rule: commands write only under runs/<run-id>/."""
from __future__ import annotations

import json
from pathlib import Path

from .errors import EnrichmentError

MANIFEST = "artifact-manifest.json"


class RunFolder:
    def __init__(self, root: Path, run_id: str):
        self.dir = Path(root) / "runs" / run_id
        self.run_id = run_id

    def resolve(self, rel: str) -> Path:
        """Reject any path that escapes the run folder."""
        p = (self.dir / rel).resolve()
        if not str(p).startswith(str(self.dir.resolve())):
            raise EnrichmentError(f"write outside run folder refused: {p}")
        return p

    def write(self, rel: str, text: str, command: str) -> Path:
        p = self.resolve(rel)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text)
        self.record(rel, command)
        return p

    def record(self, rel: str, command: str) -> None:
        m = self.dir / MANIFEST
        data = json.loads(m.read_text()) if m.exists() else {}
        data.setdefault(command, [])
        if rel not in data[command]:
            data[command].append(rel)
        m.write_text(json.dumps(data, indent=2, sort_keys=True))
