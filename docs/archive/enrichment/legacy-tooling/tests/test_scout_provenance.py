"""assert_scout_provenance — the running-path guarantee for HARD RULE 11.

The rule these tests exist to protect: a body that did not come from Scout must never reach a
number a human acts on. The G7 incident is why they are here at all -- that fix lived in a function
the pipeline never called, and six runs measured it without it ever being active. A provenance
asserter with no tests would be the same mistake with a different name.
"""

from __future__ import annotations

import hashlib
import json
import pathlib
import sys

import pytest

HERE = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HERE))

import assert_scout_provenance as asp  # noqa: E402


def _body(text: str = "# Page\n\nSome real prose about the API.") -> dict:
    return {
        "objectID": "id-1",
        "url": "/doc/rest-api/search",
        "fetch_path": "scout",
        "markdown": text,
        "content_hash": hashlib.sha256(text.encode("utf-8")).hexdigest(),
        "http_status": 200,
        "fetch_error": "",
    }


@pytest.fixture
def tree(tmp_path, monkeypatch):
    """A throwaway cache-scout/ + cache-batches/ pair, so nothing touches the real trees."""
    scout_root = tmp_path / "cache-scout"
    probe = scout_root / "shape-probe-10"
    probe.mkdir(parents=True)
    (tmp_path / "cache-batches").mkdir()
    monkeypatch.setattr(asp, "HERE", tmp_path)
    monkeypatch.setattr(asp, "SCOUT_ROOT", scout_root.resolve())
    return probe


def write(probe: pathlib.Path, rec: dict, name: str = "a.json") -> None:
    (probe / name).write_text(json.dumps(rec), encoding="utf-8")


# ---------------------------------------------------------------------------

def test_clean_cache_passes(tree):
    write(tree, _body())
    assert asp.check(tree, {"id-1"})[0] == []
    assert asp.assert_scout_provenance(tree, {"id-1"})["verdict"] == "PASS"


def test_empty_directory_is_a_violation_not_a_pass(tree):
    """The empty-PASS class. Every per-page check vacuously holds over zero pages."""
    violations, report = asp.check(tree, set())
    assert report["verdict"] == "FAIL"
    assert any("[0/empty]" in v for v in violations)


@pytest.mark.parametrize("field,value,tag", [
    ("fetch_path", "doc-md-twin", "[1/path-label]"),
    ("fetch_path", None, "[1/path-label]"),          # absent is not a default
    ("http_status", 404, "[2/status]"),
    ("http_status", 0, "[2/status]"),
])
def test_each_field_violation_is_caught(tree, field, value, tag):
    rec = _body()
    if value is None:
        rec.pop(field)
    else:
        rec[field] = value
    write(tree, rec)
    violations, _ = asp.check(tree, {"id-1"})
    assert any(tag in v for v in violations), violations


def test_empty_markdown_is_caught(tree):
    rec = _body()
    rec["markdown"] = "   "
    write(tree, rec)
    assert any("[2/body]" in v for v in asp.check(tree, {"id-1"})[0])


def test_content_hash_must_describe_its_own_body(tree):
    """Without this, the twin-collision check compares a label to a label."""
    rec = _body()
    rec["content_hash"] = hashlib.sha256(b"something else").hexdigest()
    write(tree, rec)
    assert any("[2/hash]" in v for v in asp.check(tree, {"id-1"})[0])


def test_cache_outside_the_scout_root_is_rejected(tmp_path, monkeypatch):
    elsewhere = tmp_path / "cache-batches" / "doc-md-twin-reference-001"
    elsewhere.mkdir(parents=True)
    monkeypatch.setattr(asp, "HERE", tmp_path)
    monkeypatch.setattr(asp, "SCOUT_ROOT", (tmp_path / "cache-scout").resolve())
    write(elsewhere, _body())
    violations, _ = asp.check(elsewhere, {"id-1"})
    assert any("[4/path]" in v for v in violations)


def test_missing_and_extra_ids_both_fail(tree):
    write(tree, _body())
    assert any("missing" in v for v in asp.check(tree, {"id-1", "id-2"})[0])
    assert any("unexpected" in v for v in asp.check(tree, {"id-2"})[0])


def test_twin_reuse_is_caught_by_hash_collision(tree, tmp_path):
    """The failure rule 11 exists to stop: a doc-md-twin body relabelled as Scout."""
    text = "# Page\n\n> The twin body, byte for byte."
    rec = _body(text)
    write(tree, rec)
    (tmp_path / "cache-batches" / "twin.json").write_text(json.dumps([{
        "objectID": "id-1", "url": "/doc/rest-api/search", "fetch_path": "doc-md-twin",
        "markdown": text, "content_hash": hashlib.sha256(text.encode()).hexdigest(),
    }]), encoding="utf-8")
    violations, report = asp.check(tree, {"id-1"})
    assert any("[6/collision]" in v for v in violations), violations
    assert report["hash_collisions"] == ["/doc/rest-api/search"]


def test_a_different_body_for_the_same_url_does_not_collide(tree, tmp_path):
    """Crying wolf is its own failure. Scout legitimately returns different bytes than the twin."""
    write(tree, _body("# Page\n\nScout's rendering of the page."))
    (tmp_path / "cache-batches" / "twin.json").write_text(json.dumps([{
        "objectID": "id-1", "url": "/doc/rest-api/search", "fetch_path": "doc-md-twin",
        "markdown": "# Page\n\n> The twin's authored markdown.",
        "content_hash": hashlib.sha256(b"# Page\n\n> The twin's authored markdown.").hexdigest(),
    }]), encoding="utf-8")
    assert asp.check(tree, {"id-1"})[0] == []


def test_quarantined_failures_are_not_read_as_evidence(tree):
    """A failed fetch is kept on disk. It must not be counted as a page, or the set check passes
    on a page that has no body."""
    write(tree, _body())
    quarantine = tree / "quarantine"
    quarantine.mkdir()
    (quarantine / "b.json").write_text(json.dumps({
        "objectID": "id-2", "url": "/doc/x", "fetch_path": "scout",
        "markdown": "", "http_status": 0, "fetch_error": "scout job did not finish in 90s",
    }), encoding="utf-8")
    violations, report = asp.check(tree, {"id-1"})
    assert violations == []
    assert report["pages"] == 1


def test_violations_raise_and_carry_every_failure(tree):
    rec = _body()
    rec.update({"fetch_path": "doc-md-twin", "http_status": 500})
    write(tree, rec)
    with pytest.raises(asp.ProvenanceViolation) as err:
        asp.assert_scout_provenance(tree, {"id-1"})
    assert len(err.value.violations) >= 2      # wrong path label AND wrong status


def test_a_fetch_error_record_is_excluded_from_body_provenance_but_counted(tree):
    """Contract changed 2026-08-09. A record carrying a fetch_error HAS NO BODY, so body provenance
    is not the right gate for it -- it is a FETCH_FAILED verdict, counted by verdicts.py and
    quarantined on disk. Judging it here made the gate fail for a reason it was not built to
    police, and while a fetch is running new ones appear faster than they can be swept."""
    good = _body()
    write(tree, good, "good.json")
    bad = _body()
    bad.update({"objectID": "id-2", "markdown": "", "http_status": 0,
                "fetch_error": "scout job did not finish in 90s"})
    write(tree, bad, "bad.json")

    violations, report = asp.check(tree, {"id-1"})
    assert violations == []
    assert report["pages"] == 1
    assert report["records_with_fetch_error_excluded"] == 1


def test_a_cache_of_nothing_but_failures_does_not_vacuously_pass(tree):
    """The hole the exclusion could have opened: exclude every record, judge zero, report PASS."""
    bad = _body()
    bad.update({"markdown": "", "http_status": 0, "fetch_error": "timeout"})
    write(tree, bad)
    violations, report = asp.check(tree, set())
    assert report["verdict"] == "FAIL"
    assert any("[0/empty]" in v for v in violations)


def test_a_redirected_page_is_caught_even_when_it_returns_200(tree):
    """Check 7. The libraries probe found 14 of 23 URLs served a different page than requested --
    `/doc/libraries/csharp/v7/methods/...` -> `/doc/libraries/sdk/methods/...`. Scout reported 308,
    but a fetcher that follows the redirect would report 200 and pass every other check while
    serving the wrong document. A span from that body is verbatim from the wrong page."""
    text = ("[Skip to main content](https://www.algolia.com/doc/libraries/sdk/methods/x#content-area)\n"
            "\nReal prose from the unified SDK page.")
    rec = _body(text)
    rec["url"] = "/doc/libraries/csharp/v7/methods/x"
    rec["http_status"] = 200          # the dangerous case: status looks clean
    write(tree, rec)
    violations, report = asp.check(tree, {"id-1"})
    assert any("[7/redirect]" in v for v in violations), violations
    assert report["served_url_mismatches"] == ["/doc/libraries/csharp/v7/methods/x"]


def test_matching_served_url_is_not_flagged(tree):
    text = ("[Skip to main content](https://www.algolia.com/doc/rest-api/search#content-area)\n"
            "\nProse.")
    write(tree, _body(text))          # _body() sets url=/doc/rest-api/search
    assert asp.check(tree, {"id-1"})[0] == []


def test_a_body_with_no_skip_link_is_not_accused(tree):
    """Accuse only on positive evidence. A page without the marker is unknown, not guilty."""
    write(tree, _body("# Page\n\nNo skip link anywhere in this body."))
    assert not any("[7/redirect]" in v for v in asp.check(tree, {"id-1"})[0])
