"""Verify on the surface the change was made to. Never infer success from a 200.

WHAT "VERIFIED" MEANS HERE
  Read the TARGET index back and compare every stored value to the approved payload, field by
  field, byte for byte. Then prove the enrichment is reachable: a query for text that exists
  only in an enriched field must return more than zero hits on the target index.

  Reading settings back proves nothing about searchability -- a comma-joined
  `"unordered(a),unordered(b)"` is stored as ONE garbage attribute and reads back perfectly while
  being silently unsearchable. Only a query that returns hits is evidence.

INDEXING IS ASYNCHRONOUS.
  Reading immediately after a 200 measures the old state and calls it a mismatch. The caller
  waits on the write task before this runs.

ZERO RECORDS OR ZERO SPANS COMPARED IS A FAILURE.
"""

from __future__ import annotations

from ..canonical import canon_text
from ..errors import ZeroWorkError

ENRICHED_FIELDS = ("abstract_enriched", "keyhighlights_enriched")


def verify(client, index: str, payloads: list[dict], *, manifest_ids: set[str] | None = None
           ) -> dict:
    """Compare live values against the approved payloads."""
    if not payloads:
        raise ZeroWorkError("verify-live was given zero payloads. Zero work is a failure.")

    ids = [p["objectID"] for p in payloads]
    live = client.get_objects(index, ids)

    exact = 0
    missing: list[str] = []
    mismatched: list[dict] = []
    forbidden_metadata: list[dict] = []
    spans_compared = 0

    for pl in payloads:
        rec = live.get(pl["objectID"])
        if rec is None:
            missing.append(pl["objectID"])
            continue
        bad = []
        for k, v in pl.items():
            if k == "objectID":
                continue
            spans_compared += len(v) if isinstance(v, list) else 1
            if rec.get(k) != v:
                bad.append(k)
        # Pipeline bookkeeping must not exist on a record. Five Blog records carried 12
        # `enrichment_*` fields and had to be cleaned off the live index afterwards.
        stray = sorted(k for k in rec
                       if k.startswith(("enrichment_", "_quarantine", "pipeline_", "judge_")))
        if stray:
            forbidden_metadata.append({"objectID": pl["objectID"], "fields": stray})
        if bad:
            mismatched.append({"objectID": pl["objectID"], "fields": bad})
        else:
            exact += 1

    if spans_compared == 0:
        raise ZeroWorkError(
            "verify-live compared zero spans. A verification that checks nothing and reports "
            "success is the failure mode this command exists to prevent.")

    # NOTHING MAY BE IN THE TARGET INDEX THAT NO RUN PLANNED.
    #
    # `manifest_ids` is the union of EVERY run's manifest, not just this run's. The first version
    # compared against this run's manifest alone and reported the 10 records of the previous
    # smoke slice as contamination -- the target index accumulates slices by design, so that
    # assertion called correct behaviour a failure.
    #
    # The rule here is the stronger one, not a relaxation: it checks every record in the index
    # rather than only this run's, and it still fires on the case it exists for -- a record no
    # run of this skill ever planned. An unknown writer put a search-query body into a live index
    # on this project once, and a count mismatch is what caught it.
    extra: list[str] = []
    if manifest_ids is not None:
        for hit in client.browse(index, attributes=["objectID"]):
            if hit["objectID"] not in manifest_ids:
                extra.append(hit["objectID"])

    return {
        "index": index,
        "expected": len(payloads),
        "exact": exact,
        "missing": missing,
        "mismatched": mismatched,
        "forbidden_metadata": forbidden_metadata,
        "extra_records_in_target": extra[:50],
        "extra_count": len(extra),
        "spans_compared": spans_compared,
        "ok": not missing and not mismatched and not forbidden_metadata and not extra,
    }


def proof_of_life(client, index: str, payloads: list[dict], max_probes: int = 5) -> dict:
    """A query for enriched-only text must return > 0 hits on the target index.

    THIS IS v0's PROOF OF LIFE. Enrichment that cannot be surfaced by a query has changed
    nothing observable, even in isolation -- and the source index's searchableAttributes exclude
    both enriched fields, so copying settings blindly would reproduce exactly that.

    The probe text is taken from a stored span and restricted to `abstract_enriched` and
    `keyhighlights_enriched` so a hit cannot come from title, description or body.
    """
    probes: list[dict] = []
    for pl in payloads[:max_probes]:
        spans = pl.get("abstract_enriched") or []
        if not spans:
            continue
        # A middle slice of the longest span: long enough to be distinctive, short enough to
        # survive tokenisation.
        span = max(spans, key=len)
        words = canon_text(span).split()
        if len(words) < 6:
            continue
        phrase = " ".join(words[2:8])
        res = client.search(index, phrase, restrictSearchableAttributes=list(ENRICHED_FIELDS),
                            hitsPerPage=5)
        hits = int(res.get("nbHits", 0))
        probes.append({"objectID": pl["objectID"], "query": phrase, "nbHits": hits,
                       "found_self": any(h.get("objectID") == pl["objectID"]
                                         for h in res.get("hits", []))})
    if not probes:
        raise ZeroWorkError(
            "proof-of-life could build no probe query. Zero probes is a failure, not a pass.")
    return {
        "probes": probes,
        "queries_with_hits": sum(1 for p in probes if p["nbHits"] > 0),
        "ok": all(p["nbHits"] > 0 and p["found_self"] for p in probes),
    }


def source_index_unchanged(client, index: str, expected_records: int,
                           expected_settings: dict | None = None) -> dict:
    """The source index must be exactly as it was. Checked after every write, on the real index.

    A count is the cheapest tripwire and it caught an unknown writer once already -- a search
    query body had become a document.
    """
    _, raw = client.record_count(index)
    settings = client.get_settings(index)
    changed = []
    if expected_settings:
        for k, v in expected_settings.items():
            if settings.get(k) != v:
                changed.append(k)
    return {
        "index": index,
        "expected_records": expected_records,
        "records": raw,
        "records_unchanged": raw == expected_records,
        "settings_changed": changed,
        "ok": raw == expected_records and not changed,
    }
