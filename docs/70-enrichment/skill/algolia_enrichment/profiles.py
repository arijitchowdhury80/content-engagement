"""Source profiles: data files, not Python literals.

WHY THEY ARE DATA
  Everything that varies per source is policy -- language rule, dead/shell markers, forbidden
  boilerplate, abstract shape, highlight counts, coverage target. Everything that does not vary
  is the grounding architecture, and that is code. Putting policy in code is how a "small tweak
  for press releases" ends up changing what Blog does.

WHY THE FILENAME CARRIES BOTH SOURCE AND PAGE_TYPE
  Profiles are keyed on `source/page_type`. `resource.yaml` cannot distinguish
  `Resources/resource` from any future source sharing that page_type, so the convention is
  `Source__page-type.yaml` with spaces hyphenated.

UNKNOWN source/page_type HARD REFUSES.
  No silent default. A fallback that quietly runs the editorial strategy on an API reference page
  produces 3,411 grounded, faithful, wrong-shaped abstracts and every gate passes. A fallback
  profile must be named EXPLICITLY in `_fallback.yaml`'s routes to be used.

A PROBE MAY SET QUALITATIVE FIELDS ONLY.
  strategy, abstract_shape, dead_page_markers, shell_markers, forbidden_patterns,
  language_policy, duplicate_description_policy. It may NOT set a numeric threshold: the measured
  noise band on this corpus is +/-2 PASS at n=50, so a threshold tuned on a 25-record probe is a
  number invented to fit a sample. Numerics inherit from base.yaml until a full-slice census
  supplies real ones.
"""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass, field
from pathlib import Path

import yaml

from .errors import ProfileError

BASE = "base.yaml"
PROFILE_MAP = "_profile-map.yaml"

STRATEGIES = ("editorial", "press_release", "case_study", "docs_api", "developer_code",
              "no_abstract")
ABSTRACT_SHAPES = ("editorial_summary", "announcement_summary", "case_study_summary",
                   "resource_summary", "product_summary", "api_facts", "none")
LANGUAGE_POLICIES = ("must_match_record", "allow_known_english_body", "ignore")
DUPLICATE_POLICIES = ("ban", "allow_if_additive", "no_abstract")

REQUIRED = (
    "source", "page_type", "strategy", "abstract_shape", "language_policy",
    "min_body_chars", "abstract_span_count", "highlight_count",
    "duplicate_description_policy", "judge_required", "coverage_target_pct",
    "max_human_review_open_pct", "human_review_after_attempts", "minimum_review_sample",
    "allowed_terminal_verdicts",
)

# The fields a bounded probe is allowed to set. Enforced by `profile-lint --probe-diff`, so a
# probe that quietly moved `min_body_chars` is a lint failure rather than a discovery months
# later.
PROBE_SETTABLE = frozenset({
    "strategy", "abstract_shape", "dead_page_markers", "shell_markers",
    "forbidden_patterns", "language_policy", "duplicate_description_policy",
})


@dataclass(frozen=True)
class SourceProfile:
    source: str
    page_type: str
    strategy: str
    abstract_shape: str
    language_policy: str
    min_body_chars: int
    abstract_span_count: tuple[int, int]
    highlight_count: tuple[int, int]
    duplicate_description_policy: str
    judge_required: bool
    judge_threshold: float
    coverage_target_pct: float
    max_human_review_open_pct: float
    human_review_after_attempts: int
    minimum_review_sample: int
    allowed_terminal_verdicts: tuple[str, ...]
    max_span_distance: int | None = None
    allowed_code_comments: bool = False
    allow_quotes: bool = False
    dead_page_markers: tuple[str, ...] = ()
    shell_markers: tuple[str, ...] = ()
    forbidden_patterns: tuple[str, ...] = ()
    information_gain_minimum: int = 8
    max_method_disagreement_pct: float = 0.10
    raw: dict = field(default_factory=dict, repr=False, compare=False)

    @property
    def key(self) -> str:
        return f"{self.source}/{self.page_type}"

    @property
    def version(self) -> str:
        """source/page_type + a hash of the resolved config.

        Hashed AFTER inheritance resolution, so a change to base.yaml changes every child's
        version -- which is correct: the run behaved differently.
        """
        payload = json.dumps(self.raw, sort_keys=True, default=str)
        return f"{self.page_type}:{hashlib.sha256(payload.encode()).hexdigest()[:12]}"

    @property
    def compiled_forbidden(self) -> tuple[re.Pattern, ...]:
        return tuple(re.compile(p) for p in self.forbidden_patterns)


def profile_filename(source: str, page_type: str) -> str:
    return f"{source.replace(' ', '-')}__{page_type}.yaml"


def _merge(base: dict, delta: dict) -> dict:
    """Deltas replace, they do not deep-merge lists.

    A profile that says `forbidden_patterns: [...]` means exactly those patterns. Appending to
    the base list instead would make a profile unable to remove an inherited ban, and silent
    accumulation is how a filter ends up taking a page's whole content.
    """
    out = dict(base)
    out.update(delta)
    return out


def load_profile(directory: Path, source: str, page_type: str) -> SourceProfile:
    directory = Path(directory)
    base_path = directory / BASE
    if not base_path.exists():
        raise ProfileError(f"{base_path} is missing; every profile inherits from it")
    base = yaml.safe_load(base_path.read_text()) or {}

    path = directory / profile_filename(source, page_type)
    if not path.exists():
        routed = _routed_profile(directory, source, page_type)
        if routed is None:
            raise ProfileError(
                f"no profile for {source!r}/{page_type!r}. Expected {path.name}, or an explicit "
                f"route in {PROFILE_MAP}. Unknown source/page_type hard-refuses: a silent "
                f"fallback runs the wrong strategy and every gate still passes.")
        path = routed
    delta = yaml.safe_load(path.read_text()) or {}
    data = _merge(base, delta)
    data.setdefault("source", source)
    data.setdefault("page_type", page_type)
    # The routed file names its own source/page_type for its own family; the RECORD's identity is
    # what the run is about, so it wins.
    data["source"] = source
    data["page_type"] = page_type
    return build_profile(data)


def _routed_profile(directory: Path, source: str, page_type: str) -> Path | None:
    """A run-local `page_type -> profile file` route, e.g. the 12 doc-* types onto 3 profiles.

    This is a routing table, never a taxonomy change. No record's `source` or `page_type` is
    modified and no new index label is created.
    """
    mpath = directory / PROFILE_MAP
    if not mpath.exists():
        return None
    routes = (yaml.safe_load(mpath.read_text()) or {}).get("routes", {})
    target = routes.get(f"{source}/{page_type}") or routes.get(page_type)
    if not target:
        return None
    p = directory / target
    if not p.exists():
        raise ProfileError(f"{PROFILE_MAP} routes {source}/{page_type} to {target}, "
                           f"which does not exist")
    return p


def build_profile(data: dict) -> SourceProfile:
    missing = [f for f in REQUIRED if f not in data or data[f] is None]
    if missing:
        raise ProfileError(f"profile {data.get('source')}/{data.get('page_type')} is missing "
                           f"required fields: {missing}")
    if data["strategy"] not in STRATEGIES:
        raise ProfileError(f"unknown strategy {data['strategy']!r}; known: {STRATEGIES}")
    if data["abstract_shape"] not in ABSTRACT_SHAPES:
        raise ProfileError(f"unknown abstract_shape {data['abstract_shape']!r}")
    if data["language_policy"] not in LANGUAGE_POLICIES:
        raise ProfileError(f"unknown language_policy {data['language_policy']!r}")
    if data["duplicate_description_policy"] not in DUPLICATE_POLICIES:
        raise ProfileError(f"unknown duplicate_description_policy "
                           f"{data['duplicate_description_policy']!r}")
    for pat in data.get("forbidden_patterns") or []:
        try:
            re.compile(pat)
        except re.error as exc:
            raise ProfileError(f"forbidden_patterns entry {pat!r} is not a valid regex: {exc}")

    return SourceProfile(
        source=data["source"],
        page_type=data["page_type"],
        strategy=data["strategy"],
        abstract_shape=data["abstract_shape"],
        language_policy=data["language_policy"],
        min_body_chars=int(data["min_body_chars"]),
        abstract_span_count=tuple(data["abstract_span_count"]),
        highlight_count=tuple(data["highlight_count"]),
        duplicate_description_policy=data["duplicate_description_policy"],
        judge_required=bool(data["judge_required"]),
        judge_threshold=float(data.get("judge_threshold", 0.0)),
        coverage_target_pct=float(data["coverage_target_pct"]),
        max_human_review_open_pct=float(data["max_human_review_open_pct"]),
        human_review_after_attempts=int(data["human_review_after_attempts"]),
        minimum_review_sample=int(data["minimum_review_sample"]),
        allowed_terminal_verdicts=tuple(data["allowed_terminal_verdicts"]),
        max_span_distance=data.get("max_span_distance"),
        allowed_code_comments=bool(data.get("allowed_code_comments", False)),
        allow_quotes=bool(data.get("allow_quotes", False)),
        dead_page_markers=tuple(data.get("dead_page_markers") or ()),
        shell_markers=tuple(data.get("shell_markers") or ()),
        forbidden_patterns=tuple(data.get("forbidden_patterns") or ()),
        information_gain_minimum=int(data.get("information_gain_minimum", 8)),
        max_method_disagreement_pct=float(data.get("max_method_disagreement_pct", 0.10)),
        raw=data,
    )


def known_keys(directory: Path) -> set[str]:
    """Every `source/page_type` a profile file or route covers."""
    directory = Path(directory)
    keys: set[str] = set()
    for p in directory.glob("*__*.yaml"):
        stem = p.stem
        src, _, pt = stem.partition("__")
        keys.add(f"{src.replace('-', ' ')}/{pt}")
    mpath = directory / PROFILE_MAP
    if mpath.exists():
        keys |= set((yaml.safe_load(mpath.read_text()) or {}).get("routes", {}))
    return keys


def exclusions(directory: Path) -> dict[str, str]:
    """`source/page_type -> reason`, from the profile map. An exclusion is a decision on the
    record, not an omission: `corpus-status` fails on an uncovered page_type but passes on an
    excluded one."""
    mpath = Path(directory) / PROFILE_MAP
    if not mpath.exists():
        return {}
    return (yaml.safe_load(mpath.read_text()) or {}).get("excluded", {}) or {}
