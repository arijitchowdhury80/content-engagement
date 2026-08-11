"""Approval tokens. Approval is DATA, parsed and matched -- never chat text, never memory.

WHAT AN APPROVAL HAS TO SURVIVE
  The failure this prevents is not a forged approval. It is a STALE one: a file written for
  yesterday's slice, sitting in the run folder, silently authorising today's much larger write.
  So every field that describes the write is compared, not just its presence:

      command, run_id, source, page_type, source_index, target_index,
      expected_target_count, expected_write_count

  A mismatch on any of them is a refusal with the two values printed. "Approved" is not a
  boolean about a file existing; it is an assertion that a human agreed to THESE numbers against
  THIS index.

Every destructive command reads its token through `require()`. There is no bypass flag.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

from .errors import ApprovalError

APPROVALS_DIRNAME = "approvals"

REQUIRED_FIELDS = ("approved_by", "approved_at", "command", "run_id",
                   "source_index", "target_index")

# The file each command reads. A command absent from this map needs no approval, and adding a
# write command without adding it here is what the refusal tests check for.
APPROVAL_FILES = {
    "prepare-target-index": "target-index-approved.json",
    "apply-write": "write-approved.json",
    "rerun": "rerun-approved.json",
    "cleanup": "cleanup-approved.json",
}


@dataclass(frozen=True)
class Approval:
    path: Path
    data: dict

    @property
    def approved_by(self) -> str:
        return str(self.data.get("approved_by", ""))


def approval_path(run_dir: Path, command: str) -> Path:
    name = APPROVAL_FILES.get(command)
    if name is None:
        raise ApprovalError(f"no approval file is defined for command {command!r}")
    return Path(run_dir) / APPROVALS_DIRNAME / name


def require(run_dir: Path, command: str, *, run_id: str, source_index: str, target_index: str,
            source: str | None = None, page_type: str | None = None,
            expected_target_count: int | None = None,
            expected_write_count: int | None = None) -> Approval:
    """Load and validate the approval for `command`, or raise ApprovalError.

    Count fields are compared only when the caller supplies them, and a caller that supplies a
    count MUST have measured it: passing the count the approval already claims would make the
    comparison a tautology. `apply-write` passes the payload length it actually built.
    """
    path = approval_path(run_dir, command)
    if not path.exists():
        raise ApprovalError(
            f"{command} requires {path}. Approval is a file a human writes before the command "
            f"runs; it cannot come from the conversation.")
    try:
        data = json.loads(path.read_text())
    except json.JSONDecodeError as exc:
        raise ApprovalError(f"{path.name} is not valid JSON: {exc}")

    missing = [f for f in REQUIRED_FIELDS if not data.get(f)]
    if missing:
        raise ApprovalError(f"{path.name} is missing required fields: {missing}")

    checks: list[tuple[str, object, object]] = [
        ("command", data.get("command"), command),
        ("run_id", data.get("run_id"), run_id),
        ("source_index", data.get("source_index"), source_index),
        ("target_index", data.get("target_index"), target_index),
    ]
    if source is not None:
        checks.append(("source", data.get("source"), source))
    if page_type is not None:
        checks.append(("page_type", data.get("page_type"), page_type))
    if expected_target_count is not None:
        checks.append(("expected_target_count", data.get("expected_target_count"),
                       expected_target_count))
    if expected_write_count is not None:
        checks.append(("expected_write_count", data.get("expected_write_count"),
                       expected_write_count))

    bad = [f"{field}: approval says {got!r}, this run is {want!r}"
           for field, got, want in checks if got != want]
    if bad:
        raise ApprovalError(
            f"{path.name} does not authorise this operation:\n  " + "\n  ".join(bad) +
            "\n  A stale approval cannot be reused on a different slice, count or index.")
    return Approval(path=path, data=data)
