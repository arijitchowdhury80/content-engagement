"""Pool filters and corpus-boilerplate detection. Site furniture never reaches the menu.

TWO SOURCES OF EVIDENCE, FOLDED INTO ONE MODULE
  * SHAPE and PHRASE -- a cookie banner, a skip link, a breadcrumb, a code comment. Decidable
    from the candidate alone.
  * CORPUS FREQUENCY -- a well-formed sentence that appears on many pages of the same site. No
    shape test can refute it, because it IS prose. Only counting the other pages can.

  `boilerplate.py` used to be a separate file and the plan said "fold in if still needed". That
  phrasing is how residue enters, so it is folded in here and its patterns are load-bearing for
  the "highlights are not chrome/furniture/boilerplate" gate.

THE FILTER RUNS BEFORE THE MENU IS RENDERED, NOT AFTER SELECTION.
  A candidate that would fail a gate is removed from the menu, so the gate has nothing left to
  fire on. Running these after selection meant one bad sentence killed a whole record: 589 of
  2,800 Blog records were quarantined that way, holding pages with forty usable sentences.
  Ban the CANDIDATE, never the record.

Every drop is counted by reason, so the balance is auditable rather than asserted. A filter that
takes everything turns a good page into a false THIN.
"""

from __future__ import annotations

import json
import pathlib
import re
from urllib.parse import urlparse

MIN_CHARS = 25

DOC_INDEX_MARKERS = (
    "use this file to discover all available pages",
    "fetch the complete documentation index",
    "## documentation index",
)

CHROME_PATTERNS: tuple[tuple[str, re.Pattern], ...] = (
    ("skip-link",  re.compile(r"^\s*\[?skip to (main )?content", re.I)),
    ("cookie",     re.compile(r"cookie (policy|settings|preferences|banner)|accept all cookies", re.I)),
    ("legal",      re.compile(r"©\s*\d{4}|all rights reserved|privacy policy|terms of service", re.I)),
    ("cta",        re.compile(r"^\s*(start free|sign up for free|get started for free|book a demo|"
                              r"talk to an expert|contact sales)\b", re.I)),
    ("breadcrumb", re.compile(r"^\s*\[?(home|documentation|docs)\]?\s*[/>›»]")),
    ("newsletter", re.compile(r"subscribe to (our )?(the )?newsletter|get the latest .* in your inbox", re.I)),
)

# Leading comment markers. Anchored: a sentence merely CONTAINING "//" (a URL) is not a comment.
CODE_COMMENT = re.compile(r"^\s*(//|#\s|/\*|\*\s|--\s|<!--)")

NEAR_DUP_BAR = 0.70


def _tokens(text: str) -> set[str]:
    return set(re.findall(r"[\w']+", (text or "").lower()))


def overlap(a: str, b: str) -> float:
    """max(Jaccard, containment).

    Containment is the half that matters: a candidate that is the description plus a trailing
    clause is a duplicate in substance, and Jaccard marks it down for length alone.
    """
    ta, tb = _tokens(a), _tokens(b)
    if not ta or not tb:
        return 0.0
    inter = len(ta & tb)
    return max(inter / len(ta | tb), inter / min(len(ta), len(tb)))


# Strings that are page furniture wherever they appear. THE SINGLE SOURCE OF TRUTH for this list.
#
# It lived only in a validator until 2026-08-10, which meant the validator could NAME
# "Your browser does not support the audio element." as leakage while the pool filter happily
# left it in the menu. The repair run then promoted it into five highlights, because it is a
# complete eight-word sentence with balanced brackets and every shape test says it is prose. Only
# a corpus fact refutes it, and a corpus fact is useless if the stage that builds the menu cannot
# see it. Filter and validator now read the same tuple.
FORBIDDEN_TEXT: tuple[str, ...] = (
    "page not found",
    "brand guidelines",
    "download logo pack",
    "your browser does not support the audio element",
    "your browser does not support the video element",
    "allow functional cookies",
)


def drop_reason(cand, description: str = "", title: str = "",
                extra_patterns: tuple[re.Pattern, ...] = ()) -> str | None:
    """Why this candidate is not the page's own content, or None to keep it.

    `extra_patterns` are the profile's `forbidden_patterns` -- per-source bans such as
    "^About Algolia" on press releases, which is the highest-scoring editorial-looking prose on
    the page and would otherwise become the abstract on all 690 of them.

    Order matters only for the reported reason, not for the outcome: the most specific and most
    defensible cause is checked first so the packet's histogram is readable.
    """
    text = (getattr(cand, "text", "") or "").strip()
    original = (getattr(cand, "original", "") or "").strip() or text
    low = text.lower()

    if not text or len(text) < MIN_CHARS:
        return "TOO_SHORT"
    if any(marker in low for marker in DOC_INDEX_MARKERS):
        return "DOC_INDEX"
    if any(marker in low for marker in FORBIDDEN_TEXT):
        return "FORBIDDEN_TEXT"
    for pat in extra_patterns:
        if pat.search(text):
            return "PROFILE_FORBIDDEN"
    if CODE_COMMENT.match(original):
        return "CODE_COMMENT"
    for name, pattern in CHROME_PATTERNS:
        if pattern.search(text):
            return f"CHROME_{name.upper().replace('-', '_')}"
    if getattr(cand, "kind", "") == "boilerplate":
        return "BOILERPLATE"
    if getattr(cand, "is_already_indexed", False):
        return "DUPLICATE_DESC_EXACT"
    if description and overlap(text, description) >= NEAR_DUP_BAR:
        return "DUPLICATE_DESC_NEAR"
    if title and overlap(text, title) >= NEAR_DUP_BAR:
        return "DUPLICATE_TITLE"
    return None


def filter_pool(cands: list, description: str = "", title: str = "",
                extra_patterns: tuple[re.Pattern, ...] = ()) -> tuple[list, dict[str, int], list]:
    """(kept, dropped_counts_by_reason, dropped_candidates).

    Candidates keep their ORIGINAL `.index`. Renumbering would break the one guarantee this
    pipeline has: the model returns an index, and that index must address the same span the menu
    showed it. `render_menu` prints whatever list it is handed, so a sparse index set is fine.
    """
    kept, dropped, counts = [], [], {}
    for cand in cands:
        reason = drop_reason(cand, description, title, extra_patterns)
        if reason is None:
            kept.append(cand)
        else:
            dropped.append((cand, reason))
            counts[reason] = counts.get(reason, 0) + 1
    return kept, counts, dropped


# ---------------------------------------------------------------------------
# corpus boilerplate: the evidence no single page carries
# ---------------------------------------------------------------------------

_LOCALE = re.compile(r"^/(?:de|fr|es|it|pt-br|pt|ja|ko|zh)(?=/|$)")

# Below this many distinct pages there is no corpus evidence, only coincidence.
MIN_PATHS_TO_JUDGE = 20
# A sentence on this share of pages is furniture, not content.
BOILERPLATE_SHARE = 0.20
# Below this a fetch is broken or empty, not a page.
MIN_PAGE_CHARS = 200


def canonical_path(url: str) -> str:
    """Locale-stripped path. /de/x and /fr/x are the same document in three languages, so
    counting them as three pages would make every localised footer look three times as common.
    """
    path = urlparse(url).path if "://" in (url or "") else (url or "")
    path = _LOCALE.sub("", path)
    return path.rstrip("/") or "/"


def norm_key(text: str) -> str:
    """Sentence identity. Must match candidates.norm_key exactly."""
    return " ".join((text or "").lower().split())


def build_map(pages, share: float = BOILERPLATE_SHARE,
              min_paths: int = MIN_PATHS_TO_JUDGE) -> tuple[dict[str, int], int]:
    """{normalised sentence: page count} for sentences appearing on `share` of distinct paths.

    `pages` is an iterable of (url, [sentence, ...]). Returns ({}, n) when there are too few
    distinct paths to judge -- a map built from five pages is noise, and noise here removes real
    content from the menu.
    """
    from collections import defaultdict
    seen: dict[str, set[str]] = defaultdict(set)
    paths: set[str] = set()
    for url, sentences in pages:
        p = canonical_path(url)
        paths.add(p)
        for s in sentences:
            k = norm_key(s)
            if k:
                seen[k].add(p)
    n = len(paths)
    if n < min_paths:
        return {}, n
    floor = max(2, int(n * share))
    return {k: len(v) for k, v in seen.items() if len(v) >= floor}, n


def save(bp: dict[str, int], path: pathlib.Path, n_paths: int) -> None:
    pathlib.Path(path).write_text(json.dumps(
        {"pages_judged": n_paths, "share": BOILERPLATE_SHARE, "sentences": bp},
        indent=2, sort_keys=True, ensure_ascii=False))


def load(path: pathlib.Path) -> set[str]:
    p = pathlib.Path(path)
    if not p.exists():
        return set()
    return set(json.loads(p.read_text()).get("sentences", {}))
