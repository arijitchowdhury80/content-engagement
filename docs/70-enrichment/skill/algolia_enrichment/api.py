"""Algolia REST access, and the credential discipline every call in this package obeys.

CREDENTIALS NEVER ENTER argv.
  `curl -H "Authorization: Bearer sk-..."` puts the token in the process argument list, which is
  world-readable: any local process can run `ps auxww` and read it. A corpus fetch spawns one
  curl per page, so a 10,000-page run would expose the token ~20,000 times. curl's `--config -`
  reads options from stdin and those never appear in argv, so secret headers go there. The URL,
  method, timeouts and body stay as normal arguments because none of them is a credential.

  This does not fix the credential being in `.env.local` and in this process's environment. That
  is a different exposure with a different mitigation and it is not claimed here.

WHY curl AND NOT urllib
  Python's certifi cannot reach the Algolia API from this machine: corporate TLS interception
  presents a self-signed root that certifi does not carry. curl uses the macOS keychain.

THE SOURCE INDEX IS READ-ONLY.
  `save_objects` and `set_settings` take an index name, and every caller passes the TARGET. The
  refusal that makes that structural lives in `write.py`, which will not build a payload for any
  index other than the approved target -- see `assert_write_target`.
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

from .config import env_values
from .errors import EnrichmentError


def _escape(value: str) -> str:
    return value.replace("\\", "\\\\").replace('"', '\\"')


def build_config(headers: dict[str, str]) -> str:
    """curl config text carrying one `header = "..."` line per entry.

    Config-file syntax is not shell: one option per line, values double-quoted, and a literal
    backslash or double quote inside a value escaped. Tokens are base64-ish in practice, but the
    escaping is done properly rather than assumed -- a silently mangled header is an auth failure
    that looks like a network failure.
    """
    return "\n".join(f'header = "{_escape(name)}: {_escape(value)}"'
                     for name, value in headers.items()) + "\n"


def secret_curl(args: list[str], secret_headers: dict[str, str],
                timeout: int | None = None) -> subprocess.CompletedProcess:
    """`curl <args>` with `secret_headers` supplied out of band. `args` must carry no credential."""
    return subprocess.run(
        ["curl", *args, "--config", "-"],
        input=build_config(secret_headers),
        capture_output=True, text=True, timeout=timeout,
    )


class AlgoliaClient:
    """Paginated browse, settings, and batched writes. Read-only unless a write method is called."""

    def __init__(self, app_id: str, api_key: str):
        if not app_id or not api_key:
            raise EnrichmentError("Algolia credentials missing; check .env.local")
        self._app = app_id
        self._key = api_key

    @classmethod
    def from_env(cls, workspace: Path) -> "AlgoliaClient":
        env = env_values(workspace)
        return cls(env.get("ALGOLIA_APP_ID", ""),
                   env.get("ALGOLIA_ADMIN_API_KEY") or env.get("ALGOLIA_WRITE_API_KEY", ""))

    def _request(self, method: str, path: str, body: dict | None = None) -> dict:
        args = ["-s", "--max-time", "120", "-X", method,
                f"https://{self._app}-dsn.algolia.net{path}",
                "-H", "Content-Type: application/json"]
        if body is not None:
            args += ["-d", json.dumps(body)]
        proc = secret_curl(args, {"X-Algolia-Application-Id": self._app,
                                  "X-Algolia-API-Key": self._key})
        if proc.returncode != 0:
            raise EnrichmentError(f"curl failed ({proc.returncode}) on {path}: {proc.stderr[:300]}")
        try:
            data = json.loads(proc.stdout)
        except json.JSONDecodeError:
            raise EnrichmentError(f"non-JSON from {path}: {proc.stdout[:300]}")
        if isinstance(data, dict) and data.get("status") and data.get("message"):
            raise EnrichmentError(f"Algolia error on {path}: {data['status']} {data['message']}")
        return data

    def post(self, path: str, body: dict) -> dict:
        return self._request("POST", path, body)

    def get(self, path: str) -> dict:
        return self._request("GET", path)

    def put(self, path: str, body: dict) -> dict:
        return self._request("PUT", path, body)

    # -- reads ---------------------------------------------------------------

    def record_count(self, index: str) -> tuple[int, int]:
        """(nbHits under distinct, raw record count).

        The source index has `distinct: true` on `url`, so a plain query's nbHits is the
        DISTINCT-URL count, not the record count. Reading one and calling it the other made a
        whole plan's problem statement false on 2026-08-06. `distinct: false` gets the real total.
        """
        distinct = self.post(f"/1/indexes/{index}/query", {"query": "", "hitsPerPage": 0})
        raw = self.post(f"/1/indexes/{index}/query",
                        {"query": "", "hitsPerPage": 0, "distinct": False})
        return int(distinct.get("nbHits", -1)), int(raw.get("nbHits", -1))

    def index_exists(self, index: str) -> bool:
        try:
            self.get(f"/1/indexes/{index}/settings")
            return True
        except EnrichmentError:
            return False

    def get_settings(self, index: str) -> dict:
        return self.get(f"/1/indexes/{index}/settings")

    def browse(self, index: str, attributes: list[str] | None = None,
               filters: str = "", extra: dict | None = None):
        """Yield every record. Cursor-paginated -- `hitsPerPage` alone silently caps at 1,000."""
        cursor = None
        while True:
            body: dict = {"hitsPerPage": 1000}
            if attributes:
                body["attributesToRetrieve"] = attributes
            if filters:
                body["filters"] = filters
            if extra:
                body.update(extra)
            if cursor:
                body = {"cursor": cursor}
            page = self.post(f"/1/indexes/{index}/browse", body)
            for hit in page.get("hits", []):
                yield hit
            cursor = page.get("cursor")
            if not cursor:
                return

    def facet_counts(self, index: str, facet: str) -> dict[str, int]:
        res = self.post(f"/1/indexes/{index}/query",
                        {"query": "", "hitsPerPage": 0, "facets": [facet], "maxValuesPerFacet": 1000})
        return res.get("facets", {}).get(facet, {})

    def get_objects(self, index: str, object_ids: list[str],
                    attributes: list[str] | None = None) -> dict[str, dict]:
        """objectID -> record, for a bounded id list. Chunked: the endpoint caps a request."""
        out: dict[str, dict] = {}
        for i in range(0, len(object_ids), 100):
            chunk = object_ids[i:i + 100]
            req = [{"indexName": index, "objectID": o} for o in chunk]
            if attributes:
                for r in req:
                    r["attributesToRetrieve"] = attributes
            got = self.post("/1/indexes/*/objects", {"requests": req})
            for rec in got.get("results", []):
                if rec:
                    out[rec["objectID"]] = rec
        return out

    def search(self, index: str, query: str, **params) -> dict:
        body = {"query": query}
        body.update(params)
        return self.post(f"/1/indexes/{index}/query", body)

    # -- writes --------------------------------------------------------------

    def set_settings(self, index: str, settings: dict) -> dict:
        return self.put(f"/1/indexes/{index}/settings", settings)

    def save_objects(self, index: str, payloads: list[dict], action: str = "partialUpdateObject",
                     chunk: int = 100) -> list[dict]:
        """Batched write. Returns one response per chunk.

        `partialUpdateObject` (creating) is correct for the parallel target index, which starts
        empty -- `NoCreate` would fail every record. On an index that already holds the records,
        pass `partialUpdateObjectNoCreate` so a vanished objectID fails loudly instead of
        silently creating a stub.
        """
        responses = []
        for i in range(0, len(payloads), chunk):
            batch = payloads[i:i + chunk]
            responses.append(self.post(
                f"/1/indexes/{index}/batch",
                {"requests": [{"action": action, "body": b} for b in batch]}))
        return responses

    def wait_task(self, index: str, task_id: int, timeout_s: int = 120) -> bool:
        """Poll until Algolia reports the task published. Indexing is asynchronous: reading back
        immediately after a 200 measures the old state and calls it a mismatch."""
        import time
        deadline = time.time() + timeout_s
        while time.time() < deadline:
            res = self.get(f"/1/indexes/{index}/task/{task_id}")
            if res.get("status") == "published":
                return True
            time.sleep(1.0)
        return False
