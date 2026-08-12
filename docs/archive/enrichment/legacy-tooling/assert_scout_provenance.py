#!/usr/bin/env python3
"""
assert_scout_provenance — prove every cached page body came from Scout, or refuse to continue.

WHY THIS EXISTS
  HARD RULE 11 of GOAL-enrich-the-corpus.md (2026-08-09): Scout is the only approved fetch source
  for page bodies. `doc-md-twin` bodies may explain a defect; they may never pass a gate, support a
  production approval, or become write input.

  A rule that lives in a comment is not a rule. That lesson cost this project a whole run: the G7
  per-family bar sat in `run_gates()`, which the pipeline never calls, so a "fix" was measured six
  times without ever being active. This module is the running-path assertion for rule 11. Anything
  that produces a number a human might act on calls it FIRST and dies on violation.

WHAT IT PROVES, and what it deliberately does not
  It proves the cache on disk is internally consistent with a Scout fetch: right path label, right
  directory, live body, no error, exact expected ID set, and no body byte-identical to a known
  doc-md-twin body for the same URL. That last check is the one that catches a silent reuse, which
  is the failure this rule exists to stop.

  It cannot prove Scout's own server told the truth about what it fetched. Nothing on this machine
  can. That limit is stated rather than papered over.

  python3 assert_scout_provenance.py --cache cache-scout/shape-probe-10
  python3 assert_scout_provenance.py --cache cache-scout/shape-probe-10 --expect-ids ids.json

Exit codes: 0 clean · 2 violation · 1 usage error.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import pathlib
import re
import sys
from urllib.parse import urlparse

HERE = pathlib.Path(__file__).parent

# The positive assertion. Not a blocklist: a blocklist has to name every wrong tree, and the next
# wrong tree has not been invented yet. Scout bodies live here and nowhere else.
SCOUT_ROOT = (HERE / "cache-scout").resolve()

# Every tree known to hold non-Scout bodies. Used only for the hash-collision check, so a missing
# entry here weakens check 6 but cannot produce a false PASS on checks 1-5.
NON_SCOUT_ROOTS = ("cache-batches", "cache", "cache2", "cache-fresh50")

REQUIRED_FETCH_PATH = "scout"

# The page's own self-reference. See _served_url().
_SKIP_LINK = re.compile(r"\[Skip to main content\]\((https://[^)#]+)")


class ProvenanceViolation(Exception):
    """Raised by assert_scout_provenance(). Carries every violation, not just the first."""

    def __init__(self, violations: list[str]):
        super().__init__(f"{len(violations)} provenance violation(s)")
        self.violations = violations


# ---------------------------------------------------------------------------
# loading
# ---------------------------------------------------------------------------

def _page_files(cache_dir: pathlib.Path) -> list[pathlib.Path]:
    """Page records only. `quarantine/` is excluded by design -- failed fetches are kept, never
    deleted, and must not be mistaken for evidence. Manifests are not page records."""
    # rglob, not glob: probe caches are flat but the corpus cache is one directory per batch.
    # A top-level-only scan found zero files under cache-scout/corpus and reported "empty cache",
    # which is the right refusal for the wrong reason -- it would equally have reported PASS over
    # a subset if a single stray file had been sitting at the top level.
    return sorted(
        p for p in cache_dir.rglob("*.json")
        if p.name not in ("pilot-manifest.json", "probe-manifest.json", "provenance.json")
        and "quarantine" not in p.parts
    )


def _path_of(url: str) -> str:
    """Path only, no trailing slash. 84% of records store a relative path while Scout reports an
    absolute URL, so comparing the raw strings accuses every one of them of being a redirect."""
    if not url:
        return ""
    path = urlparse(url).path if "://" in url else url
    return path.rstrip("/") or "/"


def served_url_of(rec: dict) -> str:
    """The page the server actually rendered, by the same precedence fetch() uses.

    Scout reports a final URL for every page; the `[Skip to main content]` anchor only exists on
    `/doc`. Deriving from the anchor alone therefore reads "unverified" for every blog, product and
    marketing page -- which flagged 1,660 correctly-served pages as unjudgeable.
    """
    stored = (rec.get("served_url") or "").strip()
    if stored:
        return stored
    return _served_url(rec.get("markdown") or "")


def _served_url(markdown: str) -> str:
    """The URL the served page believes it is, taken from its own skip-link anchor.

    Every algolia.com `/doc` page Scout returns carries
    `[Skip to main content](https://www.algolia.com/<path>#content-area)`. That anchor is written by
    the page that actually rendered, so it survives a redirect and names the true document. Returns
    "" when the marker is absent, and an absent marker is NOT treated as a violation -- this check
    can only accuse on positive evidence.
    """
    m = _SKIP_LINK.search(markdown or "")
    return m.group(1).replace("https://www.algolia.com", "") if m else ""


def _non_scout_hashes(urls: set[str]) -> dict[str, set[str]]:
    """url -> {content_hash} for every non-Scout cached body of that URL.

    Scoped to the URLs actually being checked: the twin cache is 79 MB and there is no reason to
    read the other 3,296 pages to check 10.
    """
    found: dict[str, set[str]] = {}
    for root_name in NON_SCOUT_ROOTS:
        root = HERE / root_name
        if not root.exists():
            continue
        for path in root.rglob("*.json"):
            try:
                blob = json.loads(path.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, UnicodeDecodeError, OSError):
                continue
            records = blob if isinstance(blob, list) else [blob]
            for rec in records:
                if not isinstance(rec, dict):
                    continue
                url = rec.get("url")
                if url not in urls:
                    continue
                if rec.get("fetch_path") == REQUIRED_FETCH_PATH:
                    continue           # a Scout body that happens to sit in an old tree
                digest = rec.get("content_hash") or (
                    hashlib.sha256((rec.get("markdown") or "").encode("utf-8")).hexdigest()
                    if rec.get("markdown") else ""
                )
                if digest:
                    found.setdefault(url, set()).add(digest)
    return found


# ---------------------------------------------------------------------------
# the assertion
# ---------------------------------------------------------------------------

def check(cache_dir: pathlib.Path, expected_ids: set[str] | None = None) -> tuple[list[str], dict]:
    """Return (violations, report). Never raises on a violation -- that is the caller's choice."""
    violations: list[str] = []
    resolved = cache_dir.resolve()

    # 4. path assertion, first: if the directory itself is wrong, nothing inside it is evidence.
    if not (resolved == SCOUT_ROOT or SCOUT_ROOT in resolved.parents):
        violations.append(
            f"[4/path] cache dir {resolved} is not under {SCOUT_ROOT} -- "
            f"a non-Scout tree cannot supply gate evidence"
        )
    if not resolved.exists():
        violations.append(f"[4/path] cache dir {resolved} does not exist")
        return violations, {"cache_dir": str(resolved), "pages": 0, "objectIDs": []}

    files = _page_files(resolved)
    if not files:
        # An empty directory passing every per-page check is the classic empty-PASS. Refuse it.
        violations.append(f"[0/empty] no page records in {resolved} -- an empty cache is not a pass")

    records: list[dict] = []
    errored: list[str] = []
    redirect_ok = 0
    for path in files:
        try:
            rec = json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError) as exc:
            violations.append(f"[0/parse] {path.name}: unreadable ({exc})")
            continue
        # A record carrying a fetch_error has NO BODY, so it is not a subject for body provenance.
        # It is a failure, counted as FETCH_FAILED by verdicts.py and quarantined on disk. Judging
        # it here just means the gate fails for a reason it was not built to police -- and while a
        # fetch is still running, new ones appear faster than they can be swept.
        # Counted, never silently dropped.
        if rec.get("fetch_error"):
            errored.append(rec.get("objectID") or path.name)
            continue
        records.append(rec)

        name = rec.get("objectID") or path.name

        # 1. fetch_path must be exactly "scout". Absent is a violation, not a default.
        got = rec.get("fetch_path")
        if got != REQUIRED_FETCH_PATH:
            violations.append(f"[1/path-label] {name}: fetch_path={got!r}, required {REQUIRED_FETCH_PATH!r}")

        # 2. a live body and a 200.
        if not (rec.get("markdown") or "").strip():
            violations.append(f"[2/body] {name}: empty markdown")
        # STATUS RULE, changed 2026-08-09 AFTER measuring, and stated rather than slipped in.
        # Measured over the corpus cache: 1,714 non-200 bodies, of which 1,711 served EXACTLY the
        # document requested (301 canonicalisation -- trailing slash, locale) and 0 served a
        # different one. Requiring a literal 200 would discard 1,660 correct pages.
        #
        # The rule is therefore identity-led, which is the principle already argued for check 7:
        # a status code is a weak proxy, the served URL is the durable test.
        #   2xx                                   -> accepted
        #   3xx AND served page == requested page -> accepted (canonicalisation, right document)
        #   3xx AND served page != requested page -> rejected here AND by check 7
        #   4xx/5xx                               -> rejected whatever the body says. This is a
        #       TIGHTENING: 51 404s were being cached as valid bodies, and an error page enriched
        #       is an abstract describing an error page.
        #   no served-URL marker                  -> rejected; cannot judge, so do not guess.
        # REQUIRES CODEX SIGN-OFF before the packet is treated as verified.
        status = rec.get("http_status")
        code = int(status) if str(status).isdigit() else 0
        served_ok = _path_of(served_url_of(rec)) == _path_of(rec.get("url") or "")
        if 200 <= code < 300:
            pass
        elif 300 <= code < 400 and served_ok:
            redirect_ok += 1
        else:
            violations.append(
                f"[2/status] {name}: http_status={status!r} "
                f"({'served the requested page' if served_ok else 'served page unverified'}) "
                f"-- accepted only for 2xx, or 3xx that served the requested page")

        # 3. no recorded error.
        if rec.get("fetch_error"):
            violations.append(f"[3/error] {name}: fetch_error={rec['fetch_error']!r}")

        # content_hash must match the body it claims to describe, or checks 6 is checking nothing.
        body = rec.get("markdown") or ""
        if body:
            actual = hashlib.sha256(body.encode("utf-8")).hexdigest()
            if rec.get("content_hash") != actual:
                violations.append(f"[2/hash] {name}: content_hash does not match its own markdown")

    if files and not records:
        # Excluding fetch_error records could otherwise empty the subject set and let every
        # per-record check pass over nothing. Caught by its own test before it ever ran for real.
        violations.append(
            f"[0/empty] {len(files)} file(s) in {resolved} but NONE is a page body "
            f"({len(errored)} carry a fetch_error) -- a cache of failures is not a pass")

    got_ids = {r.get("objectID") for r in records if r.get("objectID")}

    # 5. exact set equality with the intended sample. Extras matter as much as missing: an extra
    #    page means something fetched outside the approved bound.
    if expected_ids is not None:
        missing = expected_ids - got_ids
        extra = got_ids - expected_ids
        if missing:
            violations.append(f"[5/set] {len(missing)} expected objectID(s) missing: {sorted(missing)[:5]}")
        if extra:
            violations.append(f"[5/set] {len(extra)} unexpected objectID(s) present: {sorted(extra)[:5]}")

    # 7. THE PAGE SERVED MUST BE THE PAGE REQUESTED.
    #
    # Added 2026-08-09 after the libraries probe. 14 of 23 `/doc/libraries/{lang}/.../methods/...`
    # URLs 308-redirected to `/doc/libraries/sdk/.../methods/...` -- the language segment is
    # stripped -- and six different language URLs came back as ONE byte-identical body. Enriching
    # those records would store a span that is verbatim from a page the record does not point at.
    # Verbatim from the wrong document is still wrong.
    #
    # The status check alone is NOT enough and must not be relied on: Scout happened to report 308,
    # but a fetcher that follows the redirect and reports 200 would pass check 2 while serving the
    # same wrong page. Identity of the served URL is the durable test.
    for rec in records:
        served = _path_of(served_url_of(rec))
        want = _path_of(rec.get("url") or "")
        if served and want and served != want:
            violations.append(
                f"[7/redirect] {rec.get('objectID')}: requested {want}, page served is {served} "
                f"(http {rec.get('http_status')}) -- a span from this body would be attributed to "
                f"the wrong URL"
            )

    # 6. no body byte-identical to a known non-Scout body for the same URL.
    urls = {r.get("url") for r in records if r.get("url")}
    twin = _non_scout_hashes(urls)
    collisions = []
    for rec in records:
        digest = rec.get("content_hash")
        url = rec.get("url")
        if digest and url and digest in twin.get(url, set()):
            collisions.append(url)
            violations.append(
                f"[6/collision] {rec.get('objectID')}: body is byte-identical to a cached "
                f"non-Scout body for {url} -- the twin was reused"
            )

    report = {
        "cache_dir": str(resolved),
        "under_scout_root": resolved == SCOUT_ROOT or SCOUT_ROOT in resolved.parents,
        "pages": len(records),
        "objectIDs": sorted(got_ids),
        "urls_with_known_non_scout_body": sorted(twin),
        "hash_collisions": collisions,
        "accepted_3xx_same_document": redirect_ok,
        "records_with_fetch_error_excluded": len(errored),
        "served_url_mismatches": sorted(
            {r.get("url") for r in records
             if served_url_of(r)
             and _path_of(served_url_of(r)) != _path_of(r.get("url") or "")}),
        "violations": violations,
        "verdict": "PASS" if not violations else "FAIL",
    }
    return violations, report


def assert_scout_provenance(cache_dir: pathlib.Path | str,
                            expected_ids: set[str] | None = None) -> dict:
    """Running-path entry point. Raises ProvenanceViolation. Call this before producing a number."""
    violations, report = check(pathlib.Path(cache_dir), expected_ids)
    if violations:
        raise ProvenanceViolation(violations)
    return report


# ---------------------------------------------------------------------------

def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[1])
    ap.add_argument("--cache", required=True, help="cache directory to check")
    ap.add_argument("--expect-ids", help="JSON file: a list of objectIDs, or a manifest carrying them")
    ap.add_argument("--json", metavar="OUT", help="write the full report here")
    args = ap.parse_args()

    expected: set[str] | None = None
    if args.expect_ids:
        blob = json.loads(pathlib.Path(args.expect_ids).read_text(encoding="utf-8"))
        if isinstance(blob, list) and blob and isinstance(blob[0], dict):
            expected = {r["objectID"] for r in blob}
        elif isinstance(blob, list):
            expected = set(blob)
        else:
            print("FATAL: --expect-ids must be a list of ids or a list of records", file=sys.stderr)
            return 1

    violations, report = check(pathlib.Path(args.cache), expected)
    if args.json:
        pathlib.Path(args.json).write_text(json.dumps(report, indent=1), encoding="utf-8")

    print(f"cache      : {report['cache_dir']}")
    print(f"under root : {report['under_scout_root']}  ({SCOUT_ROOT})")
    print(f"pages      : {report['pages']}")
    if violations:
        print(f"\nVERDICT    : FAIL — {len(violations)} violation(s)\n")
        for v in violations:
            print(f"  {v}")
        return 2
    print("\nVERDICT    : PASS — every body is Scout-sourced, in the Scout tree, "
          "200, error-free, expected, and distinct from every known twin body")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
