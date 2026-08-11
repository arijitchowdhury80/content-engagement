"""Where fetch and enrich are joined in CODE, not by a human running them in the right order.

THE DEFECT THIS MODULE EXISTS TO REMOVE
  Measured by walking the historical import graph on 2026-08-10: `fetch_router.py` -- the
  Scout-only fetcher, the thing that enforces the single most important rule in the project --
  was NOT reachable from the live runner. The runner's own source said so:

      enrich_run.py:3     "Fetch is already done by fetch_router; this does:"
      enrich_run.py:1306  sys.exit("FATAL: run `fetch_router.py --fetch-pilot 30` first")

  Two disconnected programs joined by a human. Nothing in code connected them and nothing
  verified that the bodies the runner read were the bodies the fetcher wrote.

  So `enrich` never takes a cache path. It takes a run folder, and `RunCache` refuses to hand
  over a body unless `fetch` wrote it into THAT run folder, under a manifest naming that run id,
  with a content hash that still matches. Pointing enrich at a stale or foreign cache is not
  discouraged, it is unrepresentable.

TWO IMPLEMENTATIONS, ONE CORE
  `ScoutRefetch` is backfill: re-fetch a page for a record that is already indexed.
  `IngestPayload` is pre-ingest: the body is already in hand at index time.

  Everything downstream of `body_for()` -- canonicalisation, candidates, grounding, gates, write
  -- is identical and must not branch on which one ran. Pre-ingest eliminates two whole failure
  classes outright (DEAD_PAGE, and post-write span drift) because the body that grounds the span
  is the same body that produced the record. We do not own the ingest pipeline today, so backfill
  is the current mode; hardcoding Scout would make pre-ingest a rewrite instead of a config
  change. `test_bodysource_parity.py` pins that the two produce identical downstream results.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Iterable, Protocol

from .errors import EnrichmentError, ZeroWorkError
from .scout import ScoutClient, assert_scout_provenance

CACHE_DIRNAME = "cache-scout"
FETCH_MANIFEST = "fetch-manifest.json"


class BodySource(Protocol):
    def body_for(self, record: dict) -> dict:
        """A body dict carrying provenance and a content hash. Never a bare string."""
        ...


class ScoutRefetch:
    """Backfill. Scout is the sole fetcher and served-URL identity is asserted, not the status."""

    name = "ScoutRefetch"

    def __init__(self, client: ScoutClient, site: str):
        self._client = client
        self._site = site

    def body_for(self, record: dict) -> dict:
        return self._client.fetch(record, self._site)


class IngestPayload:
    """Pre-ingest. The caller already holds the body that produced the record.

    Provenance is still recorded and still checked -- the point of the protocol is that
    downstream code cannot tell which source ran, not that one of them is exempt.
    """

    name = "IngestPayload"

    def __init__(self, bodies_by_id: dict[str, str]):
        self._bodies = bodies_by_id

    def body_for(self, record: dict) -> dict:
        oid = record["objectID"]
        md = self._bodies.get(oid, "")
        return {
            "objectID": oid,
            "url": record.get("url"),
            "source_url": record.get("url"),
            "fetch_path": "ingest",
            "fetcher": self.name,
            "served_url": "",
            "redirect_mismatch": False,
            "markdown": md,
            "content_hash": hashlib.sha256(md.encode("utf-8")).hexdigest() if md else "",
            "http_status": 200 if md else 0,
            "truncated": False,
            "original_length": len(md),
            "fetch_error": "" if md else "no payload supplied for this record",
        }


class RunCache:
    """The bodies of ONE run. Written by `fetch`, read by everything after it.

    There is deliberately no constructor argument for "some other cache directory". The only way
    to obtain bodies is to name a run folder whose own fetch manifest vouches for them.
    """

    def __init__(self, run_dir: Path, run_id: str):
        self.dir = Path(run_dir)
        self.run_id = run_id
        self.cache_dir = self.dir / CACHE_DIRNAME

    # -- writing -------------------------------------------------------------

    def store(self, body: dict) -> Path:
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        path = self.cache_dir / f"{_safe(body['objectID'])}.json"
        path.write_text(json.dumps(body, ensure_ascii=False))
        return path

    def seal(self, expected_ids: Iterable[str], source_name: str) -> dict:
        """Write the manifest that makes this cache usable by `enrich`.

        The manifest carries the run id, the fetcher, and a hash per objectID. `load` re-derives
        every hash from the file on disk, so a body swapped after the fetch fails the check.
        """
        expected = list(expected_ids)
        entries: dict[str, dict] = {}
        for oid in expected:
            path = self.cache_dir / f"{_safe(oid)}.json"
            if not path.exists():
                continue
            body = json.loads(path.read_text())
            entries[oid] = {
                "content_hash": body.get("content_hash", ""),
                "fetch_error": body.get("fetch_error", ""),
                "served_url": body.get("served_url", ""),
                "redirect_mismatch": body.get("redirect_mismatch", False),
                "http_status": body.get("http_status", 0),
                "chars": len(body.get("markdown") or ""),
            }
        manifest = {
            "run_id": self.run_id,
            "body_source": source_name,
            "planned": len(expected),
            "fetched": len(entries),
            "entries": entries,
        }
        (self.dir / FETCH_MANIFEST).write_text(json.dumps(manifest, indent=2, sort_keys=True))
        return manifest

    # -- reading -------------------------------------------------------------

    def load(self) -> dict[str, dict]:
        """objectID -> body, for every body this run's own fetch produced.

        Four refusals, and each one is a real incident from the Blog run:
          * no manifest        -> enrich was pointed at a folder fetch never ran in
          * wrong run id       -> a cache copied in from another run
          * hash mismatch      -> the body on disk is not the body that was fetched
          * empty              -> zero work is a failure, never a pass
        """
        mpath = self.dir / FETCH_MANIFEST
        if not mpath.exists():
            raise EnrichmentError(
                f"no {FETCH_MANIFEST} in {self.dir}. `enrich` reads only bodies that `fetch` "
                f"produced in this run folder; run `fetch` first.")
        manifest = json.loads(mpath.read_text())
        if manifest.get("run_id") != self.run_id:
            raise EnrichmentError(
                f"{FETCH_MANIFEST} belongs to run {manifest.get('run_id')!r}, not {self.run_id!r}. "
                f"A cache from another run is not this run's evidence.")

        bodies: dict[str, dict] = {}
        for oid, entry in (manifest.get("entries") or {}).items():
            path = self.cache_dir / f"{_safe(oid)}.json"
            if not path.exists():
                raise EnrichmentError(f"{FETCH_MANIFEST} lists {oid} but {path.name} is missing")
            body = json.loads(path.read_text())
            md = body.get("markdown") or ""
            actual = hashlib.sha256(md.encode("utf-8")).hexdigest() if md else ""
            if actual != entry.get("content_hash", ""):
                raise EnrichmentError(
                    f"{oid}: cached body hash {actual[:12]} does not match the fetch manifest "
                    f"{str(entry.get('content_hash'))[:12]}. The body changed after it was fetched.")
            bodies[oid] = body

        if not bodies:
            raise ZeroWorkError(
                f"{FETCH_MANIFEST} in {self.dir} lists zero bodies. Zero work is a failure.")

        # CHECK EVERY BODY AGAINST THE SOURCE THE MANIFEST DECLARES, never against the field
        # being checked. Filtering to `fetcher == "ScoutRefetch"` first was a real hole found by
        # `test_fetch_refuses_non_scout_provenance`: a body edited to claim `fetcher: CurlByHand`
        # was excluded from the provenance check by the same lie the check exists to catch. The
        # manifest is written by `fetch` and is the independent statement of what produced this
        # cache.
        declared = manifest.get("body_source")
        if declared == ScoutRefetch.name:
            problems = assert_scout_provenance(list(bodies.values()))
        else:
            problems = [f"{oid}: manifest declares body_source={declared!r} but this body says "
                        f"{b.get('fetcher')!r}"
                        for oid, b in bodies.items() if b.get("fetcher") != declared]
        if problems:
            raise EnrichmentError("provenance violations in the run cache:\n  " +
                                  "\n  ".join(problems[:10]))
        return bodies


def _safe(object_id: str) -> str:
    """A filesystem-safe name for an objectID. Hashed rather than sanitised: objectIDs on this
    corpus are URLs, and a sanitiser that maps `/doc/x` and `/doc-x` to the same file would
    silently serve one record's body for another."""
    return hashlib.sha1(object_id.encode("utf-8")).hexdigest()
