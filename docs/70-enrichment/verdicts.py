#!/usr/bin/env python3
"""
verdicts — the honest non-enrichment outcomes, decided before the model is ever called.

WHY THESE ARE VERDICTS AND NOT FAILURES
  Arijit's definition of done counts a record as finished when it carries EITHER a verified
  abstract OR an honest, counted verdict explaining why no abstract can be written. A record with a
  login wall in front of it is not a defect in the pipeline; a record silently skipped is.

  Every verdict here is terminal, cheap, and derived from facts on the fetch record. None of them
  costs a model call, which is also why they are checked first.

THE ONE THAT IS NEW, AND WHY IT MATTERS MOST
  REDIRECT_CANONICAL. Measured 2026-08-09: `/doc/libraries/{lang}/{ver}/methods/{group}/{method}`
  308-redirects to `/doc/libraries/sdk/methods/{group}/{method}`, and six language URLs returned one
  byte-identical body. 2,082 records collapse onto 200 live pages, and 191 of those 200 are already
  separate records in the same index.

  Enriching them would slice a span verbatim out of a page the record does not point at. The
  offset-slicing guarantee cannot catch this, because the slice is faithful -- to the wrong
  document. Verbatim from the wrong URL is still wrong, so these records take a verdict instead of
  an abstract. Arijit, 2026-08-09: "unless Arijit later decides otherwise."
"""

from __future__ import annotations

import json
import pathlib
from urllib.parse import urlparse

HERE = pathlib.Path(__file__).parent
QUEUE_PATH = HERE / "work-queue.jsonl"

# Terminal, non-enrichment outcomes. Every one is counted in the final packet.
LOGIN_REQUIRED = "LOGIN_REQUIRED"          # academy.algolia.com, never fetched
EXCLUDED_SUPPORT = "EXCLUDED_SUPPORT"      # support articles, Arijit's exclusion 2026-08-07
EXCLUDED = "EXCLUDED"                      # greenhouse, deleted from the corpus
FETCH_FAILED = "FETCH_FAILED"              # Scout could not return a body
REDIRECT_CANONICAL = "REDIRECT_CANONICAL"  # served page is ANOTHER record in this corpus
REDIRECT_UNINDEXED = "REDIRECT_UNINDEXED"  # served page is not the requested one and not indexed
DEAD_PAGE = "DEAD_PAGE"                    # body is a not-found stub, or too small to be a page

NON_ENRICHMENT = frozenset({
    LOGIN_REQUIRED, EXCLUDED_SUPPORT, EXCLUDED, FETCH_FAILED,
    REDIRECT_CANONICAL, REDIRECT_UNINDEXED, DEAD_PAGE,
})

# ---------------------------------------------------------------------------
# DEAD_PAGE — decided by the body, never by the status line
# ---------------------------------------------------------------------------
#
# THE RULE THIS REPLACES, AND WHY IT WAS DANGEROUS
#   A draft of the blog plan proposed `http_status != 200 -> DEAD`. Measured on the blog corpus,
#   2026-08-09:
#
#       blog bodies returning HTTP 301   1,655   of which ~1,600 are ALIVE articles
#       dead "# Page not found" stubs       95   of which 61 return 301 and only 34 return 404
#
#   The status rule would have discarded ~1,600 healthy articles and still caught only a third of
#   the dead ones, while reading in a report as a safety improvement. algolia.com answers a deleted
#   blog post with a 301 to a soft-404 page. The status line is not evidence about the document.
#
#   So liveness is decided by what the body says. `test_alive_301_survives_the_dead_page_gate` is
#   the regression that pins this.
#
# THE FLOOR
#   1,200 chars. Every one of the 2,409 alive blog bodies clears it (p10 is 8,620). The 95 dead
#   stubs are 205 chars. The floor is set between two well-separated populations, not tuned to hit
#   a target count. Families with genuinely terse pages are protected by `min_prose_chars` in
#   shape-families.json, which is a different and stricter check applied later.

DEAD_BODY_MIN_CHARS = 1200

# Matched against the first 200 characters, case-folded. A live article that merely mentions the
# phrase deep in its text is not a dead page.
DEAD_BODY_MARKERS = (
    "page not found",
    "404 not found",
    "seite nicht gefunden",
    "page introuvable",
)


def dead_page_reason(markdown: str | None) -> str | None:
    """Why this body is not a page, or None if it is one."""
    body = (markdown or "").strip()
    head = body[:200].casefold()
    for marker in DEAD_BODY_MARKERS:
        if marker in head:
            return (f"body opens with a not-found stub ({marker!r} in the first 200 chars); "
                    f"the article has been deleted or moved")
    if len(body) < DEAD_BODY_MIN_CHARS:
        return (f"body is {len(body)} chars, under the {DEAD_BODY_MIN_CHARS}-char floor; "
                f"too small to be an article page")
    return None


def language_mismatch(language_code: str | None, language_observed: str | None) -> bool:
    """True when the model read a different language than the record claims.

    COUNTED, NEVER A GATE. /de/blog/... and /fr/blog/... serve the English article -- probed live
    2026-08-09, byte-identical with and without `Accept-Language: de-DE,de;q=0.9`. There is no
    German body to prefer, so an English abstract is the true description of an English page and a
    German one would be the invention. Arijit's ruling: enrich all 2,800, report the split.

    An unreported language is not a mismatch. Treating a missing value as one would turn every
    writer hiccup into a false finding.
    """
    if not language_code or not language_observed:
        return False
    return language_code.strip().casefold() != language_observed.strip().casefold()


def _norm(url: str) -> str:
    """Path only, no trailing slash. `/doc/x`, `/doc/x/` and the absolute form are one document."""
    if not url:
        return ""
    path = urlparse(url).path if "://" in url else url
    return path.rstrip("/") or "/"


def canonical_index(queue_path: pathlib.Path = QUEUE_PATH) -> dict[str, str]:
    """normalised url -> objectID, for every record in the corpus.

    This is what makes REDIRECT_CANONICAL answerable: "is the page we were actually served already
    owned by a different record?"
    """
    index: dict[str, str] = {}
    with queue_path.open(encoding="utf-8") as fh:
        for line in fh:
            rec = json.loads(line)
            index.setdefault(_norm(rec.get("url", "")), rec["objectID"])
    return index


def classify(fetched: dict, canonical: dict[str, str] | None = None) -> dict | None:
    """A terminal verdict dict, or None meaning "enrich this record normally".

    Order is deliberate. Path exclusions first (they never fetched, so nothing else applies), then
    fetch failure, then identity. Identity is checked LAST among the fatal cases and before any
    success, because a redirected body can look perfectly healthy.
    """
    path = fetched.get("fetch_path", "")

    if path == "login-required":
        return _verdict(LOGIN_REQUIRED, "academy.algolia.com requires a dashboard sign-in; "
                                        "not fetchable anonymously and never faked")
    if path == "excluded-support":
        return _verdict(EXCLUDED_SUPPORT, "support articles are authored answers, excluded by "
                                          "Arijit 2026-08-07")
    if path == "excluded":
        return _verdict(EXCLUDED, "record is outside the enrichable corpus")

    if fetched.get("fetch_error"):
        return _verdict(FETCH_FAILED, fetched["fetch_error"],
                        http_status=fetched.get("http_status", 0))

    if fetched.get("redirect_mismatch"):
        served = _norm(fetched.get("served_url", ""))
        requested = _norm(fetched.get("url", ""))

        # A self-redirect is not a misattribution. `/doc/x` -> `/doc/x/` is one document, and a
        # page that normalises its own URL has served exactly what was asked for. `fetch()` already
        # normalises before setting the flag, but this function must not trust its caller: anything
        # that hands it `redirect_mismatch=True` with equal normalised URLs would otherwise get
        # REDIRECT_UNINDEXED and be dropped from enrichment for no reason.
        # Codex caught this, 2026-08-09; the original test asserted a disjunction and would have
        # passed either way.
        if not served or served == requested:
            return None

        owner = (canonical or {}).get(served)
        if owner and owner != fetched.get("objectID"):
            return _verdict(
                REDIRECT_CANONICAL,
                f"{requested} redirects to {served}, which is already covered by record {owner}. "
                f"A span from that body would be verbatim from a page this record does not point "
                f"at.",
                served_url=served, canonical_objectID=owner,
                http_status=fetched.get("http_status", 0))
        return _verdict(
            REDIRECT_UNINDEXED,
            f"{requested} redirects to {served}, which is not a record in this corpus. The body "
            f"belongs to a different document.",
            served_url=served, http_status=fetched.get("http_status", 0))

    # Dead page LAST among the fatal cases, and only when a body was actually supplied.
    #
    #   after the redirect checks -- a body that belongs to another record is better described by
    #   REDIRECT_CANONICAL, which names the owner. DEAD_PAGE would be true but less useful. The 61
    #   dead 301s in the blog corpus all carry `redirect_mismatch: False`, so they reach this line.
    #
    #   only when `markdown` is present -- a caller asking about fetch status and identity alone
    #   passes no body, and "no body supplied" is not evidence that the page is dead. An absent key
    #   and an empty string are different claims and are not collapsed here.
    if "markdown" in fetched:
        dead = dead_page_reason(fetched.get("markdown"))
        if dead:
            return _verdict(DEAD_PAGE, dead, http_status=fetched.get("http_status", 0))

    return None


def _verdict(name: str, reason: str, **extra) -> dict:
    out = {
        "status": name,
        "verdict": name,
        "insufficient_reason": name,
        "verdict_reason": reason,
        "abstract_enriched": None,
        "keyhighlights_enriched": None,
        "enrichable": False,
    }
    out.update(extra)
    return out
