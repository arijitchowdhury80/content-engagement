#!/usr/bin/env python3
"""
WU-15 — build the demo Algolia index.

Real index, real algolia.com content, zero fixtures (acceptance criterion 1).

Run from docs/:
    set -a; . ../../RAG/Algolia-Central-Spectrum/.env.local; set +a
    python3 50-prototype/build_index.py

Config pattern copied from AC2_WWW_MULTI_NEURAL (mode=neuralSearch, title-first
searchableAttributes, afterDistinct faceting) — but NOT its data, which is 95%
nonprod and docs-dominant with near-empty facets. Verified 2026-08-05.

Record size: Algolia's limit is 100KB. The corpus median body is 23.7k chars and
the tail is much longer, so body is TRUNCATED for the main index and the truncation
is recorded per record in `body_truncated`. Silent truncation is the bug that later
reads as "why does search miss this content".
"""

import json
import os
import sys
import urllib.request
import urllib.error

INDEX = os.environ.get("DEMO_INDEX", "SEARCHFIRST_WWW_v1")
APP = os.environ.get("ALGOLIA_APP_ID")
KEY = os.environ.get("ALGOLIA_ADMIN_API_KEY")

WWW = "50-prototype/corpus/records.jsonl"
DOC = "50-prototype/corpus/records-doc.jsonl"
AXES = "20-research/six-axis-classification.jsonl"
INVENTORY = "20-research/sitemap-inventory.csv"

BODY_LIMIT = 20000         # chars kept in the main index record (Algolia limit is 100KB)
BATCH = 500


def api(method, path, payload=None):
    """
    Shell out to curl rather than use urllib.

    Python's bundled CA store on this machine does not contain a root that the
    macOS keychain does (corporate TLS inspection), so urllib raises
    CERTIFICATE_VERIFY_FAILED on *.algolia.net while curl succeeds. Using curl
    keeps full certificate verification against the system trust store —
    do NOT "fix" this by disabling verification.
    """
    import subprocess, tempfile
    url = f"https://{APP}.algolia.net{path}"
    cmd = ["curl", "-sS", "--fail-with-body", "--max-time", "120",
           "-X", method, url,
           "-H", f"X-Algolia-API-Key: {KEY}",
           "-H", f"X-Algolia-Application-Id: {APP}",
           "-H", "Content-Type: application/json"]
    tmp = None
    if payload is not None:
        # Batches are far too large for argv — pass the body via a temp file.
        tmp = tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8")
        json.dump(payload, tmp)
        tmp.close()
        cmd += ["--data-binary", f"@{tmp.name}"]
    try:
        p = subprocess.run(cmd, capture_output=True, text=True)
        if p.returncode != 0:
            print("curl failed:", p.returncode, (p.stdout or p.stderr)[:500], file=sys.stderr)
            raise RuntimeError("algolia api call failed")
        return json.loads(p.stdout) if p.stdout.strip() else {}
    finally:
        if tmp:
            os.unlink(tmp.name)


def load_jsonl(p):
    if not os.path.exists(p):
        return []
    return [json.loads(l) for l in open(p, encoding="utf-8")]


def object_id(url):
    """Deterministic from URL so re-indexing is idempotent, not duplicating."""
    return url.replace("https://www.algolia.com", "").strip("/").replace("/", "_") or "homepage"


def main():
    if not APP or not KEY:
        sys.exit("ALGOLIA_APP_ID / ALGOLIA_ADMIN_API_KEY not in environment")

    axes = {r["url"]: r for r in load_jsonl(AXES)}
    www = [r for r in load_jsonl(WWW) if r.get("fetch_ok")]
    doc = [r for r in load_jsonl(DOC) if r.get("fetch_ok")]

    joined = matched = 0
    records = []
    excluded = {"thin_body": 0, "utility": 0}
    truncated = 0

    for src, rows in (("www", www), ("doc", doc)):
        for r in rows:
            url = r["url"]
            a = axes.get(url)
            if src == "www":
                joined += 1
                if a:
                    matched += 1

            body = r.get("body") or ""
            if len(body) < 200:
                excluded["thin_body"] += 1
                continue

            pt = (a or {}).get("page_type") or r.get("page_type") or "unknown"
            if pt in ("utility",):
                excluded["utility"] += 1
                continue

            is_trunc = len(body) > BODY_LIMIT
            if is_trunc:
                truncated += 1

            records.append({
                "objectID": f"{src}_{object_id(url)}"[:400],
                "url": url,
                "path": url.replace("https://www.algolia.com", ""),
                "title": r.get("title") or "",
                "description": r.get("meta_description") or "",
                "body": body[:BODY_LIMIT],
                "body_truncated": is_trunc,
                "body_chars_full": len(body),
                "page_type": pt,
                "source": src,
                # six axes — the WU-05 facet contract
                "intent": (a or {}).get("intent", "unknown" if src == "www" else "implement"),
                "audience": (a or {}).get("audience", ["developer"] if src == "doc" else ["unknown"]),
                "business_context": (a or {}).get("business_context", ["unknown"]),
                "capability": (a or {}).get("capability", ["unknown"]),
                "content_type": (a or {}).get("content_type", "documentation" if src == "doc" else "unknown"),
                "conversion_action": (a or {}).get("conversion_action", "unknown"),
                "cta_text": (r.get("cta") or {}).get("text", ""),
                "cta_href": (r.get("cta") or {}).get("href", ""),
                "breadcrumb": r.get("breadcrumb", []),
                "breadcrumb_source": "derived-from-path",
            })

    print(f"www ok={len(www)}  doc ok={len(doc)}")
    print(f"six-axis join: {matched}/{joined} www records matched "
          f"({100*matched/max(joined,1):.1f}%)")
    print(f"excluded: {excluded}   truncated(>{BODY_LIMIT} chars): {truncated}")
    print(f"records to index: {len(records)}")

    # NOTE — neuralSearch is NOT set here.
    # Algolia rejects it on a new index: "an existing index with events is required
    # to enable Neural Search" (verified 2026-08-05). Neural retrieval needs click /
    # conversion event history, which a fresh demo index does not have. We push
    # records with standard ranking first, then ATTEMPT to enable neural at the end
    # and record honestly whether it took. This is a real capability constraint on
    # riskiest-assumption RA-7 and must not be papered over in the demo narrative.
    api("PUT", f"/1/indexes/{INDEX}/settings", {
        "searchableAttributes": [
            "title",
            "unordered(description)",
            "unordered(capability)",
            "unordered(business_context)",
            "unordered(page_type)",
            "unordered(body)",
            "unordered(path)",
        ],
        "attributesForFaceting": [
            "afterDistinct(intent)",
            "afterDistinct(audience)",
            "afterDistinct(searchable(business_context))",
            "afterDistinct(searchable(capability))",
            "afterDistinct(content_type)",
            "afterDistinct(conversion_action)",
            "afterDistinct(page_type)",
            "afterDistinct(source)",
        ],
        # Commercial pages must not be buried under 1454 blog posts (WU-04 finding:
        # buy+compare+troubleshoot = 17 pages of 2322). Rank corrects for that skew.
        "customRanking": ["desc(commercial_rank)"],
        "attributesToSnippet": ["body:40", "description:30"],
        "hitsPerPage": 12,
    })
    print("settings applied (6 axes faceted, standard ranking)")

    RANK = {"conversion": 100, "trust-building": 60, "enablement": 40,
            "seo-acquisition": 20, "utility": 0}
    ROLE_BY_INTENT = {"buy": "conversion", "compare": "conversion",
                      "evaluate": "conversion", "implement": "enablement",
                      "learn": "seo-acquisition", "apply": "trust-building",
                      "troubleshoot": "enablement"}
    for rec in records:
        rec["commercial_rank"] = RANK.get(ROLE_BY_INTENT.get(rec["intent"], "seo-acquisition"), 20)

    for i in range(0, len(records), BATCH):
        chunk = records[i:i + BATCH]
        api("POST", f"/1/indexes/{INDEX}/batch",
            {"requests": [{"action": "updateObject", "body": r} for r in chunk]})
        print(f"  pushed {min(i+BATCH, len(records))}/{len(records)}")

    # Now that records exist, try to enable neural search. Expected to fail until
    # the index has event history — record the real answer either way.
    neural = "not-attempted"
    try:
        api("PUT", f"/1/indexes/{INDEX}/settings", {"mode": "neuralSearch"})
        neural = "enabled"
        print("neuralSearch ENABLED")
    except Exception:
        neural = "rejected-needs-event-history"
        print("neuralSearch REJECTED — index has no click/conversion events yet. "
              "Demo runs on standard ranking. This is a real constraint, not a bug.")

    report = {
        "index": INDEX,
        "records_indexed": len(records),
        "www_ok": len(www), "doc_ok": len(doc),
        "six_axis_join_rate": round(100 * matched / max(joined, 1), 1),
        "excluded": excluded,
        "truncated": truncated,
        "body_limit_chars": BODY_LIMIT,
        "neural_search": neural,
    }
    with open("50-prototype/index-build-report.json", "w") as f:
        json.dump(report, f, indent=2)
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
