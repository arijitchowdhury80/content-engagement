"""Runtime configuration. NO ALGOLIA INDEX NAME IS HARDCODED IN PACKAGE SOURCE.

Index names arrive from `enrichment-config.yaml` next to the CLI, overridable by
`--source-index` / `--target-index`. Two reasons, and the second is the real one:

  * a literal in source is a literal in every future copy of this package, and the package is
    meant to outlive this one project;
  * a literal makes the destructive case unreviewable. `--target-index` printed at the top of
    every command, resolved from config, is a value a human can check before approving. A name
    baked into an import is not.

Secrets are never in this file and never in argv. They come from `.env.local` and go to curl
through its stdin config -- see `api.secret_curl`.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

import yaml

CONFIG_NAME = "enrichment-config.yaml"


def _default_config_path() -> Path:
    return Path(__file__).resolve().parent.parent / CONFIG_NAME


@dataclass(frozen=True)
class RunConfig:
    workspace: Path
    source_index: str
    target_index: str
    scout_base: str
    site: str
    writer_tier: str
    writer_model: str
    judge_tier: str
    judge_model: str
    judge_enabled: bool

    @property
    def runs_dir(self) -> Path:
        return self.workspace / "runs"


def load_config(workspace: Path | str, source_index: str | None = None,
                target_index: str | None = None,
                config_path: Path | None = None) -> RunConfig:
    path = Path(config_path) if config_path else _default_config_path()
    data = yaml.safe_load(path.read_text()) if path.exists() else {}
    idx = data.get("indices", {})
    models = data.get("models", {})
    scout = data.get("scout", {})
    return RunConfig(
        workspace=Path(workspace).resolve(),
        source_index=source_index or idx.get("source") or "",
        target_index=target_index or idx.get("target") or "",
        scout_base=scout.get("base_url") or os.environ.get("SCOUT_BASE_URL", ""),
        site=data.get("site", ""),
        writer_tier=models.get("writer_tier", "large"),
        writer_model=models.get("writer_model", ""),
        judge_tier=models.get("judge_tier", "small"),
        judge_model=models.get("judge_model", ""),
        judge_enabled=bool(models.get("judge_enabled", True)),
    )


def env_values(workspace: Path) -> dict[str, str]:
    """Parsed `.env.local`. Values are returned, never printed and never logged."""
    env: dict[str, str] = {}
    path = Path(workspace) / ".env.local"
    if not path.exists():
        return env
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        env[k.strip()] = v.strip().strip('"').strip("'")
    return env
