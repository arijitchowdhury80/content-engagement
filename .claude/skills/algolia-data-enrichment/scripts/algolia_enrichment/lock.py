"""Run-folder lock. Two writers must not touch one run."""
from __future__ import annotations

import json
import os
from contextlib import contextmanager
from pathlib import Path

from .errors import LockError


@contextmanager
def run_lock(run_dir: Path, command: str, started_at: str, recover: bool = False):
    run_dir = Path(run_dir)
    run_dir.mkdir(parents=True, exist_ok=True)
    lock = run_dir / ".lock"
    if lock.exists() and not recover:
        raise LockError(f"{lock} held: {lock.read_text()[:200]}. Use --recover-lock.")
    if lock.exists() and recover:
        (run_dir / "lock-recovery.json").write_text(lock.read_text())
    lock.write_text(json.dumps(
        {"pid": os.getpid(), "command": command, "started_at": started_at}, indent=2))
    try:
        yield lock
    finally:
        lock.unlink(missing_ok=True)
