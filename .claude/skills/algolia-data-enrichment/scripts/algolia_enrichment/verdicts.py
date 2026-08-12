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
import re
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

# How far past the page's first heading to look for a not-found stub. 400 covers the H1 plus the
# sentence under it -- where a soft 404 announces itself ("No Products Found", a hub headline) --
# without reaching into an article's body, where the same words could appear legitimately.
DEAD_MARKER_WINDOW = 400

# Matched against the first 200 characters, case-folded. A live article that merely mentions the
# phrase deep in its text is not a dead page.
DEFAULT_DEAD_MARKERS = (
    "page not found", "404 not found", "seite nicht gefunden", "page introuvable",
)


def dead_page_reason(markdown: str | None, min_chars: int = DEFAULT_DEAD_BODY_MIN_CHARS,
                     markers: tuple[str, ...] = DEFAULT_DEAD_MARKERS) -> str | None:
    """Why this body is not a page, or None if it is one.

    TWO WINDOWS, NOT ONE, AND THE SECOND ONE IS WHY.
      This scanned only `body[:200]`. On algolia.com the first 200 characters are the language
      switcher and the logo-pack links -- identical on every page, content on none. A SOFT 404
      therefore sailed through: HTTP 200, 8,230 characters, `served_url` matching, and the
      customer's own name appearing zero times on the page.

      Measured 2026-08-11 by re-fetching four case studies the pipeline had called NO_PROSE:
        /customers/kingarthur (en/de/fr) -> redirected to the customer hub, H1 "Your customer hub
            for everything Algolia" at offset ~1,200
        /customers/bringmeister          -> renders "No Products Found!!!" at offset ~1,400
      Both markers sit far outside a 200-character head, so no marker list could ever have fired.
      Adding markers without widening the window would have been a change that reads like a fix
      and does nothing -- this file has been bitten by exactly that before.

      So the stub text is looked for where a page states what it is: from its first heading.
    """
    body = (markdown or "").strip()
    head = body[:200].casefold()
    # The content region, found without importing the splitter: the first markdown heading.
    m = re.search(r"^\s{0,3}#{1,3}[ \t]+\S", body, re.M)
    content = body[m.start(): m.start() + DEAD_MARKER_WINDOW].casefold() if m else ""
    for marker in markers:
        folded = marker.casefold()
        if folded in head:
            return (f"body opens with a not-found stub ({marker!r} in the first 200 chars); "
                    f"the page has been deleted or moved")
        if folded in content:
            return (f"the page's own content region is a not-found stub ({marker!r}); "
                    f"HTTP status and body size look healthy, but the page is gone")
    if len(body) < min_chars:
        return (f"body is {len(body)} chars, under the {min_chars}-char floor for this profile; "
                f"too small to be a content page")
    return None


# Words that identify no page in particular, so their presence proves nothing about the subject.
SUBJECT_STOPWORDS = frozenset({
    "algolia", "customers", "customer", "story", "stories", "case", "study", "blog", "news",
    "about", "product", "products", "solution", "solutions", "doc", "docs", "guide",
    "the", "and", "for", "with", "how", "why", "what", "your", "you", "our", "its",
})


def subject_tokens(url: str) -> list[str]:
    """The record's own identity, taken from its URL slug. Deterministic; no model involved."""
    slug = (url or "").rstrip("/").split("/")[-1]
    return [p for p in re.split(r"[-_]", slug.lower())
            if p and len(p) > 3 and p not in SUBJECT_STOPWORDS]


def subject_absent_reason(url: str, markdown: str | None) -> str | None:
    """A page that never mentions its own subject is a SOFT 404, whatever its status says.

    THE CLASS FIX, and the marker list above is only the instance one.

    A soft 404 defeats every other check: HTTP 200, a full-size body, `served_url` matching the
    request, `redirect_mismatch` False. Measured 2026-08-11 -- `/customers/kingarthur` serves
    8,230 characters of the generic customer hub and the string "king arthur" appears ZERO
    times; `/customers/bringmeister` renders "No Products Found!!!" and never says
    "bringmeister". Marker lists catch the two stubs we happened to read. This catches the shape:
    a case study about a company whose page never names that company is gone, whatever wording
    the stub uses.

    MEASURED FALSE-POSITIVE RATE: zero, across 3,381 live pages in three corpora --
    case-study 223/223, Blog 2,691/2,691, press-release 690/690. The four flagged records are
    exactly the four known soft 404s.

    Returns None when the slug yields no usable token (3 Blog records), because "we could not
    form a question" must never be reported as "the answer is no".
    """
    tokens = subject_tokens(url)
    if not tokens or not markdown:
        return None
    low = markdown.lower()
    # BOTH SIDES ARE FLATTENED, and this is the difference between a gate and a wrecking ball.
    # A slug concatenates what prose spaces out: `/customers/kingarthur` against a page that says
    # "King Arthur Baking". Matching the raw token would have condemned a REAL case study as a
    # soft 404 -- caught by a test, not by inspection, and the first version of this function did
    # exactly that. Flattening to alphanumerics makes "kingarthur" find "King Arthur".
    flat = re.sub(r"[^a-z0-9]", "", low)
    if any(token in low or re.sub(r"[^a-z0-9]", "", token) in flat for token in tokens):
        return None
    return (f"the page never mentions its own subject {tokens!r} taken from the URL slug; "
            f"HTTP status, body size and served URL all look healthy, so this is a soft 404 -- "
            f"the document this record points at no longer exists")


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
        # Before the marker list, because this catches the shape rather than the wording. A soft
        # 404 passes every status/size/identity check above it.
        absent = subject_absent_reason(body.get("url", ""), body.get("markdown"))
        if absent:
            return _verdict(DEAD_PAGE, absent, http_status=body.get("http_status", 0))
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
