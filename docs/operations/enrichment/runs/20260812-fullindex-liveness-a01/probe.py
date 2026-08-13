"""Read-only URL liveness + canonical-target census over the whole live index.

Diagnostics, not pipeline: probes every record's URL and records the status code and the
URL the server actually served. Writes nothing to Algolia. Two facts per record:

  status  -- 404 means the page is gone.
  final   -- if its path differs from the requested path, the record's URL is STALE: the
             content moved, and several records can collapse onto one live page.

HEAD is used because it was verified to agree with GET on known-live and known-dead controls.
Retries cover connection errors only; a 404 is taken at face value and re-checked separately.
"""
import json
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, "skills/algolia-data-enrichment/scripts")
from algolia_enrichment.api import AlgoliaClient  # noqa: E402

OUT = Path("docs/operations/enrichment/runs/20260812-fullindex-liveness-a01")
INDEX = "Algolia_Prod_Copy_Enhanced"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/125.0 Safari/537.36")
ATTRS = ["objectID", "url", "title", "description", "page_type", "source", "language_code"]
# 12 workers over 11,928 URLs tripped the origin's bot protection roughly half way through.
# Slower is not a preference here: a blocked request is indistinguishable from a dead page
# unless it is retried, and a census nobody can trust has negative value.
WORKERS = 4
THROTTLE = 0.4


def normalise(url: str) -> str:
    url = (url or "").strip()
    return url if url.startswith("http") else "https://www.algolia.com" + url


# A censusexists to be believed, so anything that is not a real answer from the origin must
# retry rather than be recorded. curl prints "000" when it never got a response at all, and
# "000".isdigit() is True -- accepting it as a status silently turned 5,184 connection
# failures into "dead pages" and reported Documentation as 3,580 dead against a verified 108.
# 403 is the WAF, not the page: it means we are going too fast, and it is retried on a long
# backoff rather than believed.
RETRYABLE = {0, 403, 429, 500, 502, 503, 504}


def probe(record: dict, attempts: int = 4) -> dict:
    url = normalise(record.get("url"))
    row = {k: record.get(k) for k in ("objectID", "url", "source", "page_type",
                                      "language_code", "title")}
    last = 0
    for attempt in range(attempts):
        proc = subprocess.run(
            ["/usr/bin/curl", "-sS", "-I", "-L", "-o", "/dev/null",
             "-w", "%{http_code}|%{url_effective}", "--max-time", "30", "-A", UA, url],
            capture_output=True, text=True)
        parts = proc.stdout.strip().split("|")
        last = int(parts[0]) if parts and parts[0].isdigit() else 0
        if last not in RETRYABLE:
            return {**row, "status": last, "final": parts[1] if len(parts) > 1 else "",
                    "attempts": attempt + 1}
        time.sleep(THROTTLE * (2 ** attempt) + 1)
    # Exhausted: record the transport outcome as UNKNOWN, never as a verdict about the page.
    return {**row, "status": last, "final": "", "attempts": attempts, "unresolved": True}


def browse_with_retry(client, attempts: int = 4) -> list[dict]:
    """A transient TLS blip on the first call must not kill a ten-minute census."""
    for attempt in range(attempts):
        try:
            return list(client.browse(INDEX, attributes=ATTRS))
        except Exception as exc:  # noqa: BLE001 - retry any transport failure, then re-raise
            if attempt == attempts - 1:
                raise
            print(f"  browse failed ({exc}); retry {attempt + 1}/{attempts - 1}", flush=True)
            time.sleep(3 * (attempt + 1))
    return []


def main() -> int:
    client = AlgoliaClient.from_env(Path("."))
    records = browse_with_retry(client)
    print(f"total records: {len(records)}", flush=True)

    started = time.time()
    results = []
    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        for i, row in enumerate(pool.map(probe, records), 1):
            results.append(row)
            if i % 500 == 0:
                blocked = sum(1 for r in results if r.get("unresolved"))
                print(f"  {i}/{len(records)} elapsed={time.time() - started:.0f}s "
                      f"unresolved={blocked}", flush=True)

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "liveness-all.jsonl").write_text("\n".join(json.dumps(r) for r in results))

    # Refuse to hand back a census that quietly contains non-answers.
    unresolved = [r for r in results if r.get("unresolved")]
    print(f"PROBE COMPLETE {len(results)} records in {time.time() - started:.0f}s", flush=True)
    print(f"unresolved (blocked/no response after retries): {len(unresolved)}", flush=True)
    if unresolved:
        print("CENSUS NOT CLEAN -- these are transport failures, NOT dead pages.", flush=True)
        return 1
    print("CENSUS CLEAN: every record got a real HTTP answer.", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
