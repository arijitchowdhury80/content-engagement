"""Scout is the only page-body fetcher. There is no second path and no fallback.

WHY THE RULE IS ABSOLUTE
  Every alternative -- a raw curl, a WebFetch, a `<path>.md` twin -- produces a body with
  different chrome, different link handling and different truncation. Grounding is
  offset-and-canonical matching against "the body", so two fetchers means two bodies means spans
  that validate under one and fail under the other. The Blog run carried a `.md` twin path and
  it was retired for exactly that reason. There is no flag left in the wrong position: the
  branch is gone, not disabled.

IDENTITY, NEVER STATUS
  A fetcher that follows a redirect reports HTTP 200 and serves the wrong page just the same.
  Measured 2026-08-10 on the case-study slice: 2 of 237 URLs return 200 while redirecting to a
  different document (`/customers/bringmeister` -> `/customers`), and 9 return 404 while the
  index says `is404: False`. A status-code check passes the first two, and every span cut from
  those bodies is perfectly verbatim -- from a page this record does not point at.

  So the served URL is asserted against the requested URL. Two independent sources of it:
  Scout's own `final_url`, and the page's own skip-link anchor, which is written by whichever
  document actually rendered and therefore survives the redirect.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import json
import re
import time
from urllib.parse import urlparse

from .api import secret_curl
from .errors import EnrichmentError

# Every algolia.com page carries this anchor, written by the document that rendered.
_SKIP_LINK = re.compile(r"\[Skip to main content\]\((https?://[^)#]+)")

# A last-resort guard against a pathological page exhausting model context, set far above
# anything observed (measured p90 25,230 chars, max 146,787). Pages are fetched IN FULL --
# Arijit, 2026-08-08: "we cannot work with incomplete data." If it ever fires, `truncated`
# records it so the record is visible and re-processable rather than silently half-read.
MAX_CHARS = 400_000
HEAD_CHARS = 300_000
TAIL_CHARS = 100_000
TRUNCATION_MARKER = "\n\n[... text removed by the enrichment pipeline ...]\n\n"

_RATE_LIMIT_ATTEMPTS = 5
_RATE_LIMIT_BASE_SECONDS = 4.0


class ScoutRateLimited(Exception):
    """Transient. The caller backs off; it is never a verdict about the record."""


class FetchFailed(Exception):
    def __init__(self, reason: str, status: int = 0):
        super().__init__(reason)
        self.reason = reason
        self.status = status


def served_url_from(markdown: str) -> str:
    """The URL the served page claims for itself, or "". Positive evidence only."""
    m = _SKIP_LINK.search(markdown or "")
    return m.group(1) if m else ""


def absolute_url(url: str, site: str) -> str:
    """Most records carry a relative path. Locale is already in the path (/de/..., /fr/...) so
    one rule covers all three languages."""
    if not isinstance(url, str) or not url:
        return ""
    return url if url.startswith(("http://", "https://")) else site.rstrip("/") + url


def path_of(url: str) -> str:
    """Path only, no trailing slash. `/doc/x`, `/doc/x/` and the absolute form are one document."""
    if not url:
        return ""
    path = urlparse(url).path if "://" in url else url
    return path.rstrip("/") or "/"


class ScoutClient:
    def __init__(self, base_url: str, api_key: str, poll_seconds: int = 90):
        if not base_url or not api_key:
            raise EnrichmentError(
                "Scout base URL or SCOUT_HOSTED_API_KEY missing. Scout is the only body source; "
                "there is no fallback fetcher to degrade to.")
        self.base = base_url.rstrip("/")
        self._key = api_key
        self.poll_seconds = poll_seconds

    def _scrape(self, absolute: str) -> tuple[str, int, str]:
        """POST a job, poll it, return (markdown, http_status, served_url)."""
        body = json.dumps({"url": absolute, "formats": ["markdown"]})
        proc = secret_curl(
            ["-s", "--max-time", "60", "-X", "POST", f"{self.base}/v1/hosted/scrape",
             "-H", "Content-Type: application/json", "-d", body],
            {"Authorization": f"Bearer {self._key}"})
        try:
            queued = json.loads(proc.stdout)
            job = queued["job_id"]
        except (json.JSONDecodeError, KeyError):
            # A rate-limit rejection is TRANSIENT and must not become a permanent FETCH_FAILED
            # verdict on a good record. The hosted plan allows 5 concurrent runs; a sixth call
            # from any source gets rejected and the record would be written off.
            if "rate limit" in proc.stdout.lower() or "429" in proc.stdout:
                raise ScoutRateLimited(proc.stdout[:160])
            raise FetchFailed(f"scout did not queue a job: {proc.stdout[:160]}")

        # Scout states its own pacing in the queue response. Polling faster than asked tripped
        # "Hosted API rate limit exceeded" on 4,123 of 4,779 pages on 2026-08-09. Ask the server
        # how fast to go instead of guessing.
        interval = float(queued.get("retry_after_seconds") or 10)
        deadline = time.time() + self.poll_seconds
        while time.time() < deadline:
            time.sleep(interval)
            poll = secret_curl(
                ["-s", "--max-time", "30", f"{self.base}/v1/hosted/jobs/{job}"],
                {"Authorization": f"Bearer {self._key}"})
            try:
                data = json.loads(poll.stdout)
            except json.JSONDecodeError:
                continue
            if data.get("status") in ("complete", "succeeded"):
                scrape = (data.get("result") or {}).get("scrape") or {}
                markdown = scrape.get("markdown") or ""
                status = int(scrape.get("status_code") or 0)
                if not markdown.strip():
                    raise FetchFailed(f"scout returned empty markdown (http {status})", status)
                served = (scrape.get("url") or scrape.get("final_url") or "")
                return markdown, status, served
            if data.get("status") in ("failed", "error"):
                raise FetchFailed(f"scout job failed: {str(data)[:160]}")
        raise FetchFailed(f"scout job {job} did not finish in {self.poll_seconds}s")

    def _with_backoff(self, absolute: str) -> tuple[str, int, str]:
        """Retry ONLY a rate-limit rejection. Everything else fails immediately -- retrying a 404
        or an empty body turns a real finding about the corpus into a slow one."""
        for attempt in range(1, _RATE_LIMIT_ATTEMPTS + 1):
            try:
                return self._scrape(absolute)
            except ScoutRateLimited as exc:
                if attempt == _RATE_LIMIT_ATTEMPTS:
                    raise FetchFailed(f"scout rate limit after {attempt} attempts: {exc}")
                time.sleep(_RATE_LIMIT_BASE_SECONDS * (2 ** (attempt - 1)))
        raise FetchFailed("unreachable")

    def fetch(self, record: dict, site: str) -> dict:
        """THE standard body shape. Provenance is part of it, not an afterthought."""
        absolute = absolute_url(record.get("url", ""), site)
        out = {
            "objectID": record["objectID"],
            "url": record.get("url"),
            "source_url": absolute,
            "fetch_path": "scout",
            "fetcher": "ScoutRefetch",
            "fetched_at": dt.datetime.now(dt.timezone.utc).isoformat(),
            "served_url": "",
            "redirect_mismatch": False,
            "markdown": "",
            "content_hash": "",
            "http_status": 0,
            "truncated": False,
            "original_length": 0,
            "fetch_error": "",
        }
        try:
            markdown, status, served = self._with_backoff(absolute)
        except FetchFailed as exc:
            out["fetch_error"] = exc.reason
            out["http_status"] = exc.status
            return out

        original = len(markdown)
        truncated = original > MAX_CHARS
        if truncated:
            markdown = markdown[:HEAD_CHARS] + TRUNCATION_MARKER + markdown[-TAIL_CHARS:]

        served = served or served_url_from(markdown)
        out.update({
            "served_url": path_of(served),
            "redirect_mismatch": bool(path_of(served)) and path_of(served) != path_of(absolute),
            "markdown": markdown,
            # Hash the TRUNCATED text -- it is what the model sees and what spans are cut from.
            "content_hash": hashlib.sha256(markdown.encode("utf-8")).hexdigest(),
            "http_status": status,
            "truncated": truncated,
            "original_length": original,
        })
        return out

    def health(self, probe_url: str, site: str) -> dict:
        """A REAL job, never `/health` alone.

        Scout has reported healthy for three hours while unable to start a worker thread: it
        accepted jobs and returned nothing, which looks exactly like a rate limit. Only a
        completed job with a non-empty body is evidence that fetching works.
        """
        started = time.time()
        got = self.fetch({"objectID": "__health__", "url": probe_url}, site)
        return {
            "probe_url": probe_url,
            "elapsed_s": round(time.time() - started, 2),
            "ok": bool(got["markdown"].strip()) and not got["fetch_error"],
            "chars": len(got["markdown"]),
            "http_status": got["http_status"],
            "served_url": got["served_url"],
            "fetch_error": got["fetch_error"],
        }


def assert_scout_provenance(bodies: list[dict]) -> list[str]:
    """Violations of the Scout-only and served-URL rules. Empty means pass.

    Checked per body rather than per cache directory: a directory-level check passes when the
    directory is empty, and an empty pass is the failure mode this project keeps hitting.
    """
    problems: list[str] = []
    for b in bodies:
        oid = b.get("objectID", "?")
        if b.get("fetch_path") != "scout" or b.get("fetcher") != "ScoutRefetch":
            problems.append(f"{oid}: body did not come from Scout "
                            f"(fetch_path={b.get('fetch_path')!r}, fetcher={b.get('fetcher')!r})")
        md = b.get("markdown") or ""
        if md and b.get("content_hash") != hashlib.sha256(md.encode("utf-8")).hexdigest():
            problems.append(f"{oid}: content_hash does not match the stored body")
        if b.get("redirect_mismatch"):
            problems.append(f"{oid}: served {b.get('served_url')!r} for requested "
                            f"{path_of(b.get('url') or '')!r} -- a span cut from this body would "
                            f"be verbatim from the wrong document")
    return problems
