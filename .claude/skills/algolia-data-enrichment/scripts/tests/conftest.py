"""Fakes that let the refusal tests drive the REAL CLI without touching a live index.

The tests below call `algolia_enrich.main()` with real argv. That is deliberate: a refusal test
that calls a helper function proves the helper refuses, not that the command does. This project
has twice shipped a fix into a code path the runner never reached, and the only defence is tests
that enter through the same door as production.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

SKILL = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SKILL))

import algolia_enrich  # noqa: E402
from algolia_enrichment import api, model_io, scout  # noqa: E402

SOURCE_INDEX = "Test_Source"
TARGET_INDEX = "Test_Target"


class FakeAlgolia:
    """An in-memory index pair. Records what was written so a test can assert on it."""

    def __init__(self, records=None, target_exists=True, settings=None):
        self.records = list(records or [])
        self.target = {}
        self.target_exists = target_exists
        self.settings = settings or {
            "searchableAttributes": ["title", "unordered(description)"],
            "attributesForFaceting": ["source", "page_type"],
        }
        self.target_settings = dict(self.settings)
        self.writes: list[tuple[str, list[dict]]] = []

    # -- reads
    def record_count(self, index):
        n = len(self.records) if index == SOURCE_INDEX else len(self.target)
        return n, n

    def index_exists(self, index):
        return True if index == SOURCE_INDEX else self.target_exists

    def get_settings(self, index):
        return dict(self.settings if index == SOURCE_INDEX else self.target_settings)

    def browse(self, index, attributes=None, filters="", extra=None):
        rows = self.records if index == SOURCE_INDEX else list(self.target.values())
        for r in rows:
            yield dict(r)

    def facet_counts(self, index, facet):
        out = {}
        for r in self.records:
            out[r.get(facet)] = out.get(r.get(facet), 0) + 1
        return out

    def get_objects(self, index, object_ids, attributes=None):
        src = self.target if index == TARGET_INDEX else {r["objectID"]: r for r in self.records}
        return {o: dict(src[o]) for o in object_ids if o in src}

    def search(self, index, query, **params):
        src = self.target if index == TARGET_INDEX else {r["objectID"]: r for r in self.records}
        fields = params.get("restrictSearchableAttributes") or ["abstract_enriched"]
        hits = []
        for rec in src.values():
            blob = " ".join(
                " ".join(rec.get(f) or []) if isinstance(rec.get(f), list) else str(rec.get(f) or "")
                for f in fields)
            if query and query.lower() in blob.lower():
                hits.append(rec)
        return {"nbHits": len(hits), "hits": hits}

    # -- writes
    def set_settings(self, index, settings):
        if index == SOURCE_INDEX:
            raise AssertionError("a test wrote settings to the SOURCE index")
        self.target_settings = dict(settings)
        return {"taskID": 1}

    def save_objects(self, index, payloads, action="partialUpdateObject", chunk=100):
        if index == SOURCE_INDEX:
            raise AssertionError("a test wrote records to the SOURCE index")
        self.writes.append((action, payloads))
        for p in payloads:
            self.target.setdefault(p["objectID"], {"objectID": p["objectID"]}).update(p)
        return [{"taskID": 42}]

    def wait_task(self, index, task_id, timeout_s=120):
        return True


class FakeScout:
    def __init__(self, bodies=None, fail=False, empty=False):
        self.bodies = bodies or {}
        self.fail = fail
        self.empty = empty

    def fetch(self, record, site):
        oid = record["objectID"]
        md = "" if self.empty else self.bodies.get(oid, "")
        import hashlib
        return {
            "objectID": oid, "url": record.get("url"), "source_url": record.get("url"),
            "fetch_path": "scout", "fetcher": "ScoutRefetch", "served_url":
                scout.path_of(record.get("url") or ""),
            "redirect_mismatch": False, "markdown": md,
            "content_hash": hashlib.sha256(md.encode()).hexdigest() if md else "",
            "http_status": 0 if self.fail else 200, "truncated": False,
            "original_length": len(md),
            "fetch_error": "scout returned empty markdown (http 200)" if (self.fail or not md)
                           else "",
        }

    def health(self, probe_url, site):
        got = self.fetch({"objectID": "__health__", "url": probe_url}, site)
        return {"probe_url": probe_url, "elapsed_s": 0.1,
                "ok": bool(got["markdown"].strip()) and not got["fetch_error"],
                "chars": len(got["markdown"]), "http_status": got["http_status"],
                "served_url": got["served_url"], "fetch_error": got["fetch_error"]}


class FakeInference:
    """Returns whatever the test queued. `served` controls model pinning."""

    def __init__(self, responses=None, served=None):
        self.responses = responses or {}
        self.served = served or {"large": "glm-5.2", "small": "gemma-4-26b-a4b-nvfp4"}
        self.calls: list[tuple[str, str]] = []

    def served_models(self):
        return dict(self.served)

    def complete(self, model, prompt, system=None, max_tokens=4000, timeout=180):
        self.calls.append((model, prompt))
        r = self.responses.get(model)
        if callable(r):
            r = r(prompt)
        return r, {"raw": json.dumps(r) if r else "no response", "usage": {}}


@pytest.fixture
def workspace(tmp_path):
    """A workspace with .env.local and an enrichment dir, so no real secret is ever read."""
    (tmp_path / ".env.local").write_text(
        "ALGOLIA_APP_ID=test\nALGOLIA_ADMIN_API_KEY=test\n"
        "SCOUT_HOSTED_API_KEY=test\nALGOLIA_INFERENCE_BASE_URL=http://x\n"
        "ALGOLIA_INFERENCE_API_KEY=test\n")
    (tmp_path / "docs" / "70-enrichment" / "runs").mkdir(parents=True)
    return tmp_path


@pytest.fixture
def wire(monkeypatch):
    """Install fakes and return a function that runs the CLI."""
    state = {}

    def install(algolia=None, scout_client=None, inference=None):
        state["algolia"] = algolia or FakeAlgolia()
        state["scout"] = scout_client or FakeScout()
        state["inference"] = inference or FakeInference()
        monkeypatch.setattr(algolia_enrich.Ctx, "algolia", lambda self: state["algolia"])
        monkeypatch.setattr(algolia_enrich.Ctx, "scout", lambda self: state["scout"])
        monkeypatch.setattr(algolia_enrich.Ctx, "inference", lambda self: state["inference"])
        return state

    return install


@pytest.fixture
def run_cli(workspace):
    def go(*argv, indices=(SOURCE_INDEX, TARGET_INDEX)):
        return algolia_enrich.main([argv[0], "--workspace", str(workspace),
                                    "--source-index", indices[0],
                                    "--target-index", indices[1], *argv[1:]])
    return go


def make_records(n=4, source="Customer Stories", page_type="case-study", langs=("en",)):
    out = []
    for i in range(n):
        lang = langs[i % len(langs)]
        out.append({
            "objectID": f"rec-{i}",
            "url": f"/{lang}/customers/acme-{i}",
            "title": f"Acme {i} customer story",
            "description": f"How Acme {i} rebuilt discovery.",
            "source": source, "page_type": page_type, "language_code": lang,
        })
    return out


BODY = """# Acme {i} customer story

Acme Retail rebuilt its product discovery on Algolia after search latency became the single
largest driver of cart abandonment across its European storefronts. The migration replaced a
self-managed Elasticsearch cluster that had grown to eleven nodes and required a dedicated
engineer to operate it week to week.

Conversion from search rose by 34 percent in the first quarter after launch, measured against
the same period a year earlier across all six markets. The team also reported that median
query latency fell from 480 milliseconds to 21 milliseconds on the same catalogue size.

Acme now indexes 1.2 million products and pushes catalogue updates every four minutes without
taking the search index offline at any point during the update window.

The engineering team describes the rollout as uneventful, which is the outcome they were aiming
for after two previous migrations had each required an overnight freeze on catalogue changes.
Merchandisers were given direct control over ranking rules for the first time, and the retailer
reports that campaign setup that previously took a sprint now takes an afternoon.

Search now drives 41 percent of all revenue on the Acme storefront, up from 28 percent before
the migration, and the share is highest in the two markets where the catalogue is largest.
"""

# The fixture body must clear the case-study profile's 900-character floor. It did not at first,
# and every record in the enrich tests came back DEAD_PAGE -- which is the profile behaving
# correctly on a fixture that was lying about being a page.


def body_for(i: int) -> str:
    return BODY.format(i=i)
