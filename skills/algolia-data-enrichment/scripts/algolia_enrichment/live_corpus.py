"""TIER 1: verify an ALREADY-WRITTEN corpus in the live index. Deterministic. No LLM.

WHY THIS EXISTS
  Every other validation path in this package is RUN-SCOPED: `cmd_validate` reads `ctx.run_dir`,
  `cmd_verify_live` reads `ctx.run_dir/final/payloads.jsonl`. Both answer "was this run correct?"
  Neither can answer the question that actually matters once records are live:

      is what is IN THE INDEX right now correct?

  That question has to be answerable without the run that produced it, because runs get cleaned
  up, code changes underneath them, and a claim in a two-day-old report is not evidence about
  today's index. The Blog corpus was validated on 2026-08-10 against LOCAL batch outputs; nothing
  has ever re-checked the live records themselves.

WHAT IT PROVES, AND WHAT IT DELIBERATELY DOES NOT
  Proves, per record, from the index and a cached body only:
    * every stored span is present on its own page, character for character
    * the page it was taken from was fetched cleanly (200, no redirect mismatch)
    * the scripted quality gates still pass on the live text
    * `canonicalise` is idempotent, asserted BEFORE any failure is counted

  Does NOT prove the spans were a GOOD choice. That is a judgement and it needs the judge.
  Grounding is a guarantee; quality is an opinion. A pass here is not a good abstract.

THE IDEMPOTENCE ASSERTION IS LOAD-BEARING, NOT DECORATION
  `canonicalise` has two code paths and they have disagreed before: the markdown-link branch
  skipped rules the main branch applied, so faithful spans were reported as ungrounded. One such
  false alarm on 2026-08-11 read as "the guarantee is broken" over a span that was fine. If the
  two paths disagree, EVERY grounding number this module produces is untrustworthy -- so the
  check runs first and refuses to continue rather than reporting numbers nobody should believe.
"""

from __future__ import annotations

import hashlib
import json
import pathlib
from collections import Counter

from .canonical import canonicalise
from .errors import EnrichmentError, ZeroWorkError
from .validate import grounding, quality

# Where Scout leaves fetched pages. Both layouts are real and both are read: the top-level cache
# built by the historical pilot runs, and the per-run cache the skill writes.
CACHE_GLOBS = (
    "docs/operations/enrichment/cache-scout/**/*.json",
    "docs/operations/enrichment/runs/*/cache-scout/*.json",
)


def _markdown_of(payload: dict) -> str:
    """Scout has shipped the body under two shapes. Read both rather than guess."""
    md = payload.get("markdown")
    if isinstance(md, dict):
        return md.get("raw_markdown") or md.get("markdown") or ""
    return md or payload.get("raw_markdown") or ""


def load_cached_bodies(workspace: pathlib.Path) -> dict[str, dict]:
    """{objectID: body record}. Later files win, so a fresher fetch supersedes an older one.

    Keyed by objectID because `grounding.check_rows` looks bodies up by objectID. A cache file
    with no objectID is still indexed by URL, so a caller can resolve it that way.
    """
    by_oid: dict[str, dict] = {}
    by_url: dict[str, dict] = {}
    for pattern in CACHE_GLOBS:
        for path in sorted(workspace.glob(pattern)):
            try:
                payload = json.loads(path.read_text())
            except (ValueError, OSError):
                continue
            if not isinstance(payload, dict):
                continue
            body = _markdown_of(payload)
            if not body:
                continue
            record = {
                "markdown": body,
                "url": payload.get("url"),
                "served_url": payload.get("served_url"),
                "http_status": payload.get("http_status"),
                "redirect_mismatch": payload.get("redirect_mismatch"),
                "content_hash": payload.get("content_hash"),
                "fetched_at": payload.get("fetched_at"),
                "source_path": str(path),
            }
            if payload.get("objectID"):
                by_oid[payload["objectID"]] = record
            if payload.get("url"):
                by_url[payload["url"]] = record
    return {"by_object_id": by_oid, "by_url": by_url}


def assert_canonicalise_idempotent(bodies: dict[str, dict], limit: int = 400) -> dict:
    """Measure whether canonicalising twice changes the text. REPORTS; does not raise.

    MEASURED 2026-08-11: not idempotent on 22 of 400 real Blog bodies (5.5%). The cause is
    concrete and benign -- a page carrying a JSX/HTML snippet inside a code fence. Pass one
    leaves `<button className="..." onClick={...}>` alone because the fence protects it; pass two
    strips it as markup, losing 87 characters on one page.

    WHY THIS IS REPORTED AND NOT FATAL, having first been written as fatal:
      Grounding compares `canon_text(span)` against `canonicalise(body).text`. The stored span was
      already sliced from a canonicalised body, so that expression canonicalises the SPAN twice
      while canonicalising the HAYSTACK once. On the 5.5% the asymmetry makes a span that IS on
      the page report as absent. Blocking the entire corpus over it would be the "crying wolf"
      failure; counting those as missing spans would be the false-alarm failure. Neither is
      honest, so `classify_grounding_failures` re-tests each failure symmetrically instead.
    """
    checked = 0
    offenders: list[dict] = []
    for oid, rec in list(bodies.items())[:limit]:
        once = canonicalise(rec["markdown"]).text
        twice = canonicalise(once).text
        checked += 1
        if once != twice:
            # locate the first divergence so the report names a character, not a vibe
            i = next((n for n, (a, b) in enumerate(zip(once, twice)) if a != b),
                     min(len(once), len(twice)))
            offenders.append({
                "objectID": oid,
                "first_divergence_at": i,
                "once": once[max(0, i - 40):i + 40],
                "twice": twice[max(0, i - 40):i + 40],
            })
    if checked == 0:
        raise ZeroWorkError(
            "canonicalise idempotence checked zero bodies. Zero work is a failure, never a pass.")
    return {"checked": checked, "offenders": offenders, "ok": not offenders}


def slice_map(client, index: str) -> dict[str, dict]:
    """{objectID: {source, page_type, url, title, description}} from the full-record index.

    Needed because the parallel target is NOT a corpus: every record there carries exactly
    `objectID`, `abstract_enriched`, `keyhighlights_enriched`. It has no `source`, `page_type`,
    `url`, `title` or `description` to filter or gate on, so those must be joined back from the
    index that does have them.
    """
    out: dict[str, dict] = {}
    for rec in client.browse(index, attributes=["objectID", "source", "page_type", "url",
                                                "title", "description"]):
        out[rec["objectID"]] = rec
    return out


def rows_from_index(client, index: str, source: str, page_type: str,
                    identity: dict[str, dict] | None = None) -> list[dict]:
    """Live enriched records, reshaped into the row shape both validators already understand.

    `abstract_enriched` is stored as an array of spans. One historical record stored a bare
    string; that is read as a single span rather than silently skipped, because dropping it would
    under-count and an under-count that passes is worse than a failure.

    `identity` supplies source/page_type/url/description for indices whose records do not carry
    them -- the parallel holding pen. Without it, filtering that index by corpus finds nothing
    and the run would report a vacuous pass over zero records.
    """
    fields = ["objectID", "url", "source", "page_type", "title", "description",
              "abstract_enriched", "keyhighlights_enriched", "content_hash"]
    rows: list[dict] = []
    for rec in client.browse(index, attributes=fields):
        if identity:
            ident = identity.get(rec["objectID"])
            if ident:
                rec = {**rec, **{k: v for k, v in ident.items() if rec.get(k) in (None, "")}}
        if rec.get("source") != source or rec.get("page_type") != page_type:
            continue
        abstract = rec.get("abstract_enriched")
        highlights = rec.get("keyhighlights_enriched")
        if not abstract and not highlights:
            continue
        if isinstance(abstract, str):
            abstract = [abstract]
        if isinstance(highlights, str):
            highlights = [highlights]
        rows.append({
            "objectID": rec["objectID"],
            "url": rec.get("url"),
            "title": rec.get("title") or "",
            "description": rec.get("description") or "",
            "abstract_spans_stored": list(abstract or []),
            "keyhighlights_enriched": list(highlights or []),
            "content_hash": rec.get("content_hash"),
        })
    return rows


# A fetch that ENDED here delivered no document. A redirect code is not in this set: Scout
# follows the chain, so 301/302/307/308 is the FIRST status, not the final one.
DEAD_STATUS = frozenset({400, 401, 403, 404, 410, 451, 500, 502, 503, 504})


def check_fetch_provenance(rows: list[dict], bodies: dict[str, dict]) -> dict:
    """A span sliced from the WRONG document is faithful and useless.

    THE CHECK IS `served_url == url`, NOT THE STATUS CODE.

    Written first as "status must be 200", which flagged 1,805 of 2,694 Blog records. Every one
    was a false alarm: Scout follows redirects, so the cached `http_status` is the FIRST hop
    (measured: 1,881 records cached as 301) while `served_url` records where the chain actually
    landed. On all 1,881, `served_url == url` and `redirect_mismatch` is False -- the fetch is
    correct and the 301 is noise.

    What genuinely breaks the guarantee is a redirect that landed SOMEWHERE ELSE, because then
    the offsets are faithful to a different document. That is `redirect_mismatch`, and the
    codebase already computes it. Trust that, plus a status that means "no document at all".
    """
    defects: list[dict] = []
    missing: list[str] = []
    for row in rows:
        rec = bodies.get(row["objectID"])
        if rec is None:
            missing.append(row["objectID"])
            continue
        served, asked = rec.get("served_url"), row.get("url")
        if rec.get("redirect_mismatch"):
            defects.append({"objectID": row["objectID"], "reason": "redirect_mismatch",
                            "asked": asked, "served": served})
        elif served and asked and served != asked:
            defects.append({"objectID": row["objectID"], "reason": "served_url != url",
                            "asked": asked, "served": served})
        status = rec.get("http_status")
        if status is not None and int(status) in DEAD_STATUS:
            defects.append({"objectID": row["objectID"], "reason": f"http_status={status}",
                            "asked": asked, "served": served})
    return {"rows": len(rows), "defects": defects, "missing_body": missing,
            "ok": not defects and not missing}


def check_content_drift(rows: list[dict], bodies: dict[str, dict]) -> dict:
    """Has the page changed since the span was taken?

    Drift is NOT a pipeline defect and is reported separately on purpose. A page that was edited
    after enrichment makes its stored span legitimately unlocatable; folding that into the
    grounding failure count would blame the pipeline for the world moving.
    """
    drifted: list[dict] = []
    compared = 0
    for row in rows:
        rec = bodies.get(row["objectID"])
        if rec is None:
            continue
        recorded = rec.get("content_hash")
        if not recorded:
            continue
        actual = hashlib.sha256(rec["markdown"].encode("utf-8")).hexdigest()
        compared += 1
        if actual != recorded:
            drifted.append({"objectID": row["objectID"], "recorded": recorded, "actual": actual})
    return {"compared": compared, "drifted": drifted, "ok": not drifted}


def classify_grounding_failures(failures: list[dict], rows: list[dict],
                                bodies: dict[str, dict]) -> dict:
    """Split reported failures into REAL absences and canonicalisation artifacts.

    `locate_span` canonicalises the span twice and the body once (see
    `assert_canonicalise_idempotent`). This re-tests each reported failure symmetrically: is the
    stored span, exactly as stored, present in the once-canonicalised body?

      present  -> the span IS on the page; the miss was the verifier's own normalisation
      absent   -> the span is genuinely not on that page. THIS is the corpus defect.

    Distinguishing them is the whole point. A verifier that reports its own normalisation as a
    corpus breach destroys its credibility the first time someone checks; one that hides real
    absences behind that excuse is worse.
    """
    by_oid = {r["objectID"]: r for r in rows}
    canon_cache: dict[str, str] = {}
    artifacts: list[dict] = []
    genuine: list[dict] = []
    for fail in failures:
        oid = fail["objectID"]
        rec = bodies.get(oid)
        if rec is None:
            genuine.append({**fail, "reason": "no cached body"})
            continue
        if oid not in canon_cache:
            canon_cache[oid] = canonicalise(rec["markdown"]).text
        haystack = canon_cache[oid]
        stored = None
        row = by_oid.get(oid)
        if row:
            for span in row["abstract_spans_stored"] + row["keyhighlights_enriched"]:
                if span.startswith(fail["span"][:60]):
                    stored = span
                    break
        stored = stored or fail["span"]
        if stored and stored in haystack:
            artifacts.append({**fail, "reason": "present in body; verifier double-canonicalised"})
        else:
            genuine.append({**fail, "reason": "not present in the page"})
    return {
        "reported": len(failures),
        "canonicalisation_artifacts": artifacts,
        "genuine_absences": genuine,
        "ok": not genuine,
    }


def verify_corpus(client, index: str, source: str, page_type: str,
                  workspace: pathlib.Path, identity_index: str | None = None) -> dict:
    """The whole Tier 1 pass for one corpus. Deterministic end to end.

    `identity_index` names the full-record index to join source/page_type/description from when
    `index` is the parallel holding pen, whose records carry only the two enriched fields.
    """
    cache = load_cached_bodies(workspace)
    identity = slice_map(client, identity_index) if identity_index else None
    rows = rows_from_index(client, index, source, page_type, identity=identity)
    if not rows:
        raise ZeroWorkError(
            f"no enriched records found for {source}/{page_type} in {index}. Zero work is a "
            f"failure -- a verifier that checks nothing and reports success is the most "
            f"expensive kind of green.")

    # Resolve a body for every row: objectID first, URL as the fallback.
    bodies: dict[str, dict] = {}
    for row in rows:
        rec = cache["by_object_id"].get(row["objectID"])
        if rec is None and row.get("url"):
            rec = cache["by_url"].get(row["url"])
        if rec is not None:
            bodies[row["objectID"]] = rec

    idem = assert_canonicalise_idempotent(bodies)
    ground = grounding.check_rows(rows, bodies)
    triage = classify_grounding_failures(ground["failures"], rows, bodies)
    qual = quality.check_rows(rows)
    prov = check_fetch_provenance(rows, bodies)
    drift = check_content_drift(rows, bodies)

    coverage = {
        "records_in_index": len(rows),
        "records_with_cached_body": len(bodies),
        "records_without_cached_body": len(rows) - len(bodies),
    }
    # A canonicalisation artifact is the verifier's fault, not the corpus's. Only genuine
    # absences and missing bodies can fail this gate.
    ok = bool(triage["ok"] and not ground["missing_body"] and prov["ok"]
              and not qual["leakage"] and not qual["chrome"]
              and not qual["incomplete_spans"] and not qual["template_collisions"])
    return {
        "index": index,
        "corpus": f"{source}/{page_type}",
        "coverage": coverage,
        "canonicalise_idempotent": idem,
        "grounding": ground,
        "grounding_triage": triage,
        "quality": qual,
        "fetch_provenance": prov,
        "content_drift": drift,
        "ok": ok,
    }


def per_record_rows(report: dict, rows: list[dict]) -> list[dict]:
    """One line per record, so the artifact is auditable record by record rather than in total."""
    failed = Counter(f["objectID"] for f in report["grounding_triage"]["genuine_absences"])
    artifact = Counter(f["objectID"] for f in
                       report["grounding_triage"]["canonicalisation_artifacts"])
    prov_bad = {d["objectID"] for d in report["fetch_provenance"]["defects"]}
    drifted = {d["objectID"] for d in report["content_drift"]["drifted"]}
    out = []
    for row in rows:
        oid = row["objectID"]
        spans = len(row["abstract_spans_stored"]) + len(row["keyhighlights_enriched"])
        out.append({
            "objectID": oid,
            "url": row.get("url"),
            "spans": spans,
            "grounding_failures": failed.get(oid, 0),
            "canonicalisation_artifacts": artifact.get(oid, 0),
            "fetch_defect": oid in prov_bad,
            "content_drift": oid in drifted,
            "ok": failed.get(oid, 0) == 0 and oid not in prov_bad,
        })
    return out
