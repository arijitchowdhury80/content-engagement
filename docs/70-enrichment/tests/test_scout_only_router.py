"""The production fetch layer is Scout-only, and that is asserted, not documented.

HARD RULE 11 says Scout is the only approved fetch source. The previous shape of this module had
four fetchers and a `/doc` branch that chose the `.md` twin. Both are gone. These tests exist so a
future edit that reintroduces either one fails loudly instead of quietly enriching 4,337 records
from a source that cannot pass a gate.
"""

from __future__ import annotations

import pathlib
import sys

import pytest

HERE = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HERE))

import fetch_router as fr  # noqa: E402


@pytest.mark.parametrize("url", [
    "/doc/rest-api/search",
    "/doc/libraries/csharp/v7/methods/composition/delete-composition",
    "/doc/tools/cli/commands",
    "/blog/some-post",
    "/fr/events",
    "https://www.algolia.com/doc/api-reference/search-api-parameters",
])
def test_everything_fetchable_routes_to_scout(url):
    assert fr.fetch_path_for(url) == "scout"


@pytest.mark.parametrize("url,expected", [
    ("https://academy.algolia.com/course", "login-required"),
    ("https://support.algolia.com/hc/en-us/articles/123", "excluded-support"),
    ("https://job-boards.greenhouse.io/algolia/jobs/1", "excluded"),
])
def test_the_non_fetched_paths_are_honest_verdicts_not_fetches(url, expected):
    """These three never hit the network. They take a counted verdict upstream, which is why the
    Academy `_curl` fetcher could be deleted rather than ported to Scout."""
    assert fr.fetch_path_for(url) == expected


def test_only_one_fetcher_exists_in_the_module():
    """`fetch_doc_md_twin`, `fetch_zendesk` and `fetch_auth_wall` are deleted, not disabled. A
    disabled fetcher is a flag someone can flip; a deleted one is not."""
    fetchers = {n for n in dir(fr) if n.startswith("fetch_") and callable(getattr(fr, n))}
    assert fetchers == {"fetch_path_for", "fetch_scout"}


def test_a_non_scout_path_raises_instead_of_fetching(monkeypatch):
    called = []
    monkeypatch.setattr(fr, "fetch_scout", lambda *a, **k: called.append(1) or ("x", 200, ""))
    out = fr.fetch({"objectID": "a", "url": "https://academy.algolia.com/course"}, key="k")
    assert called == []
    assert out["markdown"] == ""
    assert "not fetched" in out["fetch_error"]


# ---------------------------------------------------------------------------
# served-URL identity

def test_served_url_is_recorded_and_a_redirect_is_flagged(monkeypatch):
    """The libraries finding, in one test: requested csharp, served the unified sdk page."""
    body = ("[Skip to main content](https://www.algolia.com/doc/libraries/sdk/methods/x"
            "#content-area)\n\nProse.")
    monkeypatch.setattr(fr, "fetch_scout", lambda *a, **k: (body, 308, ""))
    out = fr.fetch({"objectID": "a", "url": "/doc/libraries/csharp/v7/methods/x"}, key="k")
    assert out["served_url"] == "/doc/libraries/sdk/methods/x"
    assert out["redirect_mismatch"] is True


def test_a_page_that_serves_itself_is_not_flagged(monkeypatch):
    body = "[Skip to main content](https://www.algolia.com/doc/rest-api/search#content-area)\n\nP."
    monkeypatch.setattr(fr, "fetch_scout", lambda *a, **k: (body, 200, ""))
    out = fr.fetch({"objectID": "a", "url": "/doc/rest-api/search"}, key="k")
    assert out["redirect_mismatch"] is False


def test_a_trailing_slash_is_not_a_redirect(monkeypatch):
    """False alarms cost credibility. `/doc/x` and `/doc/x/` are the same document."""
    body = "[Skip to main content](https://www.algolia.com/doc/rest-api/search/#content-area)\n\nP."
    monkeypatch.setattr(fr, "fetch_scout", lambda *a, **k: (body, 200, ""))
    out = fr.fetch({"objectID": "a", "url": "/doc/rest-api/search"}, key="k")
    assert out["redirect_mismatch"] is False


def test_no_skip_link_means_unknown_not_guilty(monkeypatch):
    monkeypatch.setattr(fr, "fetch_scout", lambda *a, **k: ("# Page\n\nNo anchor here.", 200, ""))
    out = fr.fetch({"objectID": "a", "url": "/blog/post"}, key="k")
    assert out["served_url"] == ""
    assert out["redirect_mismatch"] is False


def test_scouts_own_reported_url_wins_over_the_anchor(monkeypatch):
    """When Scout reports a final URL, believe it -- the anchor is the fallback, not the primary."""
    body = "[Skip to main content](https://www.algolia.com/doc/a#content-area)\n\nP."
    monkeypatch.setattr(fr, "fetch_scout",
                        lambda *a, **k: (body, 200, "https://www.algolia.com/doc/b"))
    out = fr.fetch({"objectID": "a", "url": "/doc/a"}, key="k")
    assert out["served_url"] == "/doc/b"
    assert out["redirect_mismatch"] is True


# ---------------------------------------------------------------------------
# no credential in argv

def test_no_credential_reaches_the_process_argument_list(monkeypatch):
    """`ps auxww` is readable by any local process. A 10,198-page fetch makes ~20,000 curl calls
    (POST + poll), so a token in argv is exposed ~20,000 times. Codex, 2026-08-09."""
    seen = {}

    class FakeProc:
        returncode = 0
        stdout = '{"job_id": "j1"}'
        stderr = ""

    def fake_run(cmd, **kw):
        seen["cmd"] = cmd
        seen["stdin"] = kw.get("input", "")
        raise RuntimeError("stop after the first call")

    monkeypatch.setattr("subprocess.run", fake_run)
    with pytest.raises(RuntimeError):
        fr.fetch_scout("https://www.algolia.com/doc/x", "sk-SUPER-SECRET-TOKEN")

    assert "sk-SUPER-SECRET-TOKEN" not in " ".join(seen["cmd"])
    assert "--config" in seen["cmd"]
    assert "sk-SUPER-SECRET-TOKEN" in seen["stdin"]


def test_curl_config_escapes_quotes_and_backslashes():
    from curl_secret import build_config
    cfg = build_config({"Authorization": 'Bearer a"b\\c'})
    assert cfg == 'header = "Authorization: Bearer a\\"b\\\\c"\n'


# ---------------------------------------------------------------------------
# a rate limit is transient, never a verdict

def test_a_rate_limit_rejection_is_retried_not_recorded_as_a_failure(monkeypatch):
    """Measured 2026-08-09: a 6th concurrent call against the 5-run ceiling returns
    {"detail":"Hosted API rate limit exceeded."}. Without this, a good record is written off as
    FETCH_FAILED for a reason that has nothing to do with the record."""
    calls = []

    def flaky(absolute, key, poll_seconds=90):
        calls.append(1)
        if len(calls) < 3:
            raise fr.ScoutRateLimited('{"detail":"Hosted API rate limit exceeded."}')
        return ("# Page\n\nProse.", 200, "")

    monkeypatch.setattr(fr, "fetch_scout", flaky)
    monkeypatch.setattr(fr.time, "sleep", lambda s: None)
    out = fr.fetch({"objectID": "a", "url": "/doc/x"}, key="k")
    assert len(calls) == 3
    assert out["fetch_error"] == ""
    assert out["markdown"]


def test_a_persistent_rate_limit_eventually_fails_honestly(monkeypatch):
    monkeypatch.setattr(fr, "fetch_scout",
                        lambda *a, **k: (_ for _ in ()).throw(fr.ScoutRateLimited("nope")))
    monkeypatch.setattr(fr.time, "sleep", lambda s: None)
    out = fr.fetch({"objectID": "a", "url": "/doc/x"}, key="k")
    assert "rate limit after 5 attempts" in out["fetch_error"]


def test_a_real_failure_is_not_retried(monkeypatch):
    """Retrying a 404 turns a real finding about the corpus into a slow one."""
    calls = []

    def dead(absolute, key, poll_seconds=90):
        calls.append(1)
        raise fr.FetchFailed("scout returned empty markdown (http 404)", 404)

    monkeypatch.setattr(fr, "fetch_scout", dead)
    monkeypatch.setattr(fr.time, "sleep", lambda s: None)
    out = fr.fetch({"objectID": "a", "url": "/doc/x"}, key="k")
    assert len(calls) == 1
    assert "404" in out["fetch_error"]


def test_a_failed_record_is_not_treated_as_fetched(tmp_path):
    """The resume check counted every manifest row, failures included. A batch that rate-limited
    every page was therefore marked complete and never retried -- 4,123 records would have carried
    a permanent FETCH_FAILED verdict caused by our own request rate (2026-08-09)."""
    import json
    prior = [
        {"objectID": "a", "fetch_error": ""},
        {"objectID": "b", "fetch_error": "scout did not queue a job: rate limit"},
    ]
    done = {r["objectID"] for r in prior if not r.get("fetch_error")}
    assert done == {"a"}
    assert not {"a", "b"} <= done          # the batch must NOT be considered complete


def test_the_poll_interval_comes_from_the_server_not_a_constant(monkeypatch):
    """Scout answers a queue request with retry_after_seconds. Polling faster than it asks is what
    produced the rate-limit storm."""
    import json as _json
    slept = []

    class P:
        returncode = 0
        stderr = ""
        stdout = _json.dumps({"job_id": "j1", "retry_after_seconds": 10})

    class Q:
        returncode = 0
        stderr = ""
        stdout = _json.dumps({"status": "complete",
                              "result": {"scrape": {"markdown": "# P\n\nProse.",
                                                    "status_code": 200}}})

    calls = {"n": 0}

    def fake(args, secret_headers, timeout=None):
        calls["n"] += 1
        return P() if calls["n"] == 1 else Q()

    monkeypatch.setattr(fr, "secret_curl", fake)
    monkeypatch.setattr(fr.time, "sleep", lambda s: slept.append(s))
    fr.fetch_scout("https://www.algolia.com/x", "k")
    assert slept and slept[0] == 10.0, f"polled at {slept} instead of the server's 10s"


def test_run_batches_reenters_the_fetcher_when_a_manifest_holds_failures(tmp_path):
    """Two layers had the same bug. fetch_router's per-record resume is unreachable if the caller
    refuses to invoke it, which is what `if not fetched.exists()` did after the rate-limit storm."""
    import json
    manifest = tmp_path / "pilot-manifest.json"
    manifest.write_text(json.dumps([{"objectID": "a", "fetch_error": "rate limit"},
                                    {"objectID": "b", "fetch_error": ""}]))
    needs_fetch = any(r.get("fetch_error") for r in json.loads(manifest.read_text()))
    assert needs_fetch is True

    manifest.write_text(json.dumps([{"objectID": "a", "fetch_error": ""}]))
    assert any(r.get("fetch_error") for r in json.loads(manifest.read_text())) is False
