"""Honest terminal outcomes, decided before any model call.

A LOGIN WALL, A FAILED FETCH AND A REDIRECT ARE NOT ENRICHMENT FAILURES.
  They are true statements about the record, and the packet counts them as outcomes. Forcing an
  abstract out of a sign-in page would be the failure.

  The redirect case can only be decided here. Once a body reaches the splitter, every span cut
  from it looks perfectly verbatim -- because it is, from the wrong page.

DEAD PAGE IS DECIDED BY THE BODY, NEVER BY THE STATUS LINE.
  A draft proposed `http_status != 200 -> DEAD`. Measured on the Blog corpus 2026-08-09:

      blog bodies returning HTTP 301   1,655   of which ~1,600 are ALIVE articles
      dead "# Page not found" stubs       95   of which 61 return 301 and only 34 return 404

  The status rule would have discarded ~1,600 healthy articles and caught only a third of the
  dead ones, while reading in a report as a safety improvement. algolia.com answers a deleted
  post with a 301 to a soft-404. The status line is not evidence about the document.
"""

from __future__ import annotations

import json
import pathlib
from urllib.parse import urlparse

LOGIN_REQUIRED = "LOGIN_REQUIRED"
EXCLUDED = "EXCLUDED"
FETCH_FAILED = "FETCH_FAILED"
REDIRECT_CANONICAL = "REDIRECT_CANONICAL"
REDIRECT_UNINDEXED = "REDIRECT_UNINDEXED"
DEAD_PAGE = "DEAD_PAGE"
SHELL_PAGE = "SHELL_PAGE"

NON_ENRICHMENT = frozenset({
    LOGIN_REQUIRED, EXCLUDED, FETCH_FAILED,
    REDIRECT_CANONICAL, REDIRECT_UNINDEXED, DEAD_PAGE, SHELL_PAGE,
})

# The floor is a PROFILE decision. 1,200 sits between two well-separated Blog populations (every
# one of 2,409 alive bodies clears it, p10 is 8,620; the 95 dead stubs are 205 chars). It is
# wrong for API reference, where a terse page is short and correct -- reusing Blog's floor there
# would quarantine correct pages en masse. So the caller passes `min_body_chars` from the profile
# and this default only applies when none is given.
DEFAULT_DEAD_BODY_MIN_CHARS = 1200

# Matched against the first 200 characters, case-folded. A live article that merely mentions the
# phrase deep in its text is not a dead page.
DEFAULT_DEAD_MARKERS = (
    "page not found", "404 not found", "seite nicht gefunden", "page introuvable",
)


def dead_page_reason(markdown: str | None, min_chars: int = DEFAULT_DEAD_BODY_MIN_CHARS,
                     markers: tuple[str, ...] = DEFAULT_DEAD_MARKERS) -> str | None:
    """Why this body is not a page, or None if it is one."""
    body = (markdown or "").strip()
    head = body[:200].casefold()
    for marker in markers:
        if marker.casefold() in head:
            return (f"body opens with a not-found stub ({marker!r} in the first 200 chars); "
                    f"the page has been deleted or moved")
    if len(body) < min_chars:
        return (f"body is {len(body)} chars, under the {min_chars}-char floor for this profile; "
                f"too small to be a content page")
    return None


def shell_reason(markdown: str | None, markers: tuple[str, ...] = ()) -> str | None:
    """A rendered skeleton rather than a page: the client-side app never hydrated."""
    head = (markdown or "")[:400].casefold()
    for marker in markers:
        if marker.casefold() in head:
            return f"body is a loading shell ({marker!r}); the page never rendered its content"
    return None


def language_mismatch(language_code: str | None, language_observed: str | None) -> bool:
    """True when the model read a different language than the record claims.

    WHETHER THIS GATES IS A PROFILE DECISION, and generalising the Blog ruling would be a defect.
    /de/blog/ and /fr/blog/ serve the English article -- probed live, byte-identical with and
    without an Accept-Language header -- so there is no German body to prefer and a German
    abstract would be the invention. That was measured at 100% of Blog and 0% of every other
    source. Case studies and press releases use `must_match_record`.

    An unreported language is not a mismatch: treating a missing value as one turns every writer
    hiccup into a false finding.
    """
    if not language_code or not language_observed:
        return False
    return language_code.strip().casefold() != language_observed.strip().casefold()


def norm_path(url: str) -> str:
    if not url:
        return ""
    path = urlparse(url).path if "://" in url else url
    return path.rstrip("/") or "/"


def canonical_index(records: list[dict]) -> dict[str, str]:
    """normalised url -> objectID, for every record in the slice's corpus.

    This is what makes REDIRECT_CANONICAL answerable: "is the page we were served already owned
    by a different record?"
    """
    index: dict[str, str] = {}
    for rec in records:
        index.setdefault(norm_path(rec.get("url", "")), rec["objectID"])
    return index


def classify(body: dict, canonical: dict[str, str] | None = None,
             min_body_chars: int = DEFAULT_DEAD_BODY_MIN_CHARS,
             dead_markers: tuple[str, ...] = DEFAULT_DEAD_MARKERS,
             shell_markers: tuple[str, ...] = ()) -> dict | None:
    """A terminal verdict dict, or None meaning "enrich this record normally".

    Order is deliberate. Fetch failure first, then identity, then liveness. Identity comes before
    liveness because a redirected body can look perfectly healthy.
    """
    if body.get("fetch_error"):
        return _verdict(FETCH_FAILED, body["fetch_error"], http_status=body.get("http_status", 0))

    if body.get("redirect_mismatch"):
        served = norm_path(body.get("served_url", ""))
        requested = norm_path(body.get("url", ""))

        # A self-redirect is not a misattribution: `/doc/x` -> `/doc/x/` is one document. The
        # fetcher already normalises before setting the flag, but this function must not trust
        # its caller -- anything handing it `redirect_mismatch=True` with equal normalised URLs
        # would otherwise be dropped from enrichment for no reason.
        if not served or served == requested:
            pass
        else:
            owner = (canonical or {}).get(served)
            if owner and owner != body.get("objectID"):
                return _verdict(
                    REDIRECT_CANONICAL,
                    f"{requested} redirects to {served}, which is already covered by record "
                    f"{owner}. A span from that body would be verbatim from a page this record "
                    f"does not point at.",
                    served_url=served, canonical_objectID=owner,
                    http_status=body.get("http_status", 0))
            return _verdict(
                REDIRECT_UNINDEXED,
                f"{requested} redirects to {served}, which is not a record in this corpus. "
                f"The body belongs to a different document.",
                served_url=served, http_status=body.get("http_status", 0))

    # Only when a body was actually supplied. A caller asking about fetch status and identity
    # alone passes no body, and "no body supplied" is not evidence that the page is dead. An
    # absent key and an empty string are different claims and are not collapsed here.
    if "markdown" in body:
        shell = shell_reason(body.get("markdown"), shell_markers)
        if shell:
            return _verdict(SHELL_PAGE, shell, http_status=body.get("http_status", 0))
        dead = dead_page_reason(body.get("markdown"), min_body_chars, dead_markers)
        if dead:
            return _verdict(DEAD_PAGE, dead, http_status=body.get("http_status", 0))

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


def load_jsonl(path: pathlib.Path) -> list[dict]:
    p = pathlib.Path(path)
    if not p.exists():
        return []
    return [json.loads(line) for line in p.read_text().splitlines() if line.strip()]
