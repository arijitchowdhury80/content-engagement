"""Refuse incomplete or uncovered profile coverage, measured against the LIVE census.

WHY IT LINTS AGAINST LIVE AND NOT AGAINST THE FILES
  A profile set that is internally consistent and covers 40 of the corpus's 44 page_types is
  exactly as broken as one with a syntax error -- and much harder to notice. The four uncovered
  types are discovered when a slice hard-refuses mid-run, which is the expensive moment.

  So the census comes from the index and the profiles are checked against it. An uncovered
  page_type is a failure. An EXCLUDED one is a pass, because an exclusion is a recorded decision
  rather than an omission.
"""

from __future__ import annotations

from pathlib import Path

from .errors import ProfileError
from .profiles import (PROBE_SETTABLE, REQUIRED, STRATEGIES, exclusions, known_keys,
                       load_profile)
from . import strategies as strategy_registry


def lint(profiles_dir: Path, live_counts: dict[str, int]) -> dict:
    """live_counts is {"Source/page_type": n} from a live census."""
    profiles_dir = Path(profiles_dir)
    covered = known_keys(profiles_dir)
    excluded = exclusions(profiles_dir)

    uncovered: list[dict] = []
    resolved: dict[str, dict] = {}
    errors: list[str] = []

    for key, count in sorted(live_counts.items(), key=lambda kv: -kv[1]):
        if key in excluded:
            continue
        source, _, page_type = key.partition("/")
        try:
            profile = load_profile(profiles_dir, source, page_type)
        except ProfileError as exc:
            if key in covered:
                errors.append(f"{key}: {exc}")
            else:
                uncovered.append({"key": key, "records": count})
            continue
        resolved[key] = {
            "records": count,
            "profile_version": profile.version,
            "strategy": profile.strategy,
            "abstract_shape": profile.abstract_shape,
            "coverage_target_pct": profile.coverage_target_pct,
        }
        if profile.strategy not in STRATEGIES:
            errors.append(f"{key}: unknown strategy {profile.strategy!r}")
        try:
            strategy_registry.get(profile.strategy)
        except KeyError:
            # A strategy a profile names but no module implements is the failure that only shows
            # up when a high-volume slice starts.
            errors.append(f"{key}: strategy {profile.strategy!r} has no implementation")
        missing = [f for f in REQUIRED if f not in profile.raw]
        if missing:
            errors.append(f"{key}: missing required fields {missing}")

    uncovered_records = sum(u["records"] for u in uncovered)
    return {
        "live_page_types": len(live_counts),
        "resolved": resolved,
        "excluded": {k: {"records": live_counts.get(k, 0), "reason": v.strip()}
                     for k, v in excluded.items()},
        "uncovered": uncovered,
        "uncovered_records": uncovered_records,
        "errors": errors,
        "probe_settable_fields": sorted(PROBE_SETTABLE),
        "ok": not uncovered and not errors,
    }


def probe_diff(before: dict, after: dict) -> list[str]:
    """Fields a probe changed that it was not allowed to change.

    The measured noise band on this corpus is +/-2 PASS at n=50, so a numeric threshold tuned on
    a 25-record probe is a number invented to fit a sample. A probe may set the qualitative
    fields and nothing else.
    """
    illegal = []
    for k in set(before) | set(after):
        if before.get(k) != after.get(k) and k not in PROBE_SETTABLE:
            illegal.append(f"{k}: {before.get(k)!r} -> {after.get(k)!r}")
    return sorted(illegal)
