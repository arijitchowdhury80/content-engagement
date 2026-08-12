"""Is every stored string actually on the page? Offset-free, and it refuses to pass on zero.

TWO CHECKS, ALWAYS, AND THEY ANSWER DIFFERENT QUESTIONS
  * OFFSET SLICE   -- re-cut the body at the offsets the artifact claims and compare. Proves the
                      offsets still address the span.
  * OFFSET-FREE    -- look the canonical string up in the canonical body with no offset at all.
                      Proves the words are on the page even if the offsets have drifted.

  The offset-free check is the one that matters, because a stale offset is common and harmless
  while a missing string is a fabrication. But offset-only would silently pass a span whose
  offsets happen to land on different text after a re-fetch, so both run.

ZERO SPANS CHECKED IS A FAILURE, NOT A PASS.
  A verifier on this project once filtered on a non-faceted attribute, matched nothing, and
  reported success. An empty pass is the most expensive kind of green, so `ZeroWorkError` is
  raised rather than returning `{"ok": True, "checked": 0}`.
"""

from __future__ import annotations

from ..canonical import canon_text, canonicalise
from ..errors import ZeroWorkError

MODE_EXACT = "exact"
MODE_CANONICAL = "canonical"


def spans_of(row: dict) -> list[tuple[str, str]]:
    """(field, span) for every string a row would store.

    `abstract_spans_stored` is the array, never the joined string. Re-deriving the components by
    splitting the joined paragraph is fragile and has caused two separate false alarms -- one
    verifier declared "THE GUARANTEE IS BROKEN" over 9 good records that way.
    """
    out: list[tuple[str, str]] = []
    for s in row.get("abstract_spans_stored") or []:
        out.append(("abstract_enriched", s))
    for s in row.get("keyhighlights_enriched") or []:
        out.append(("keyhighlights_enriched", s))
    return out


def locate_span(span: str, body: str, canon_body: str | None = None) -> str | None:
    """The match mode, or None when the span is not on the page."""
    if not span:
        return None
    if span in body:
        return MODE_EXACT
    hay = canon_body if canon_body is not None else canonicalise(body).text
    return MODE_CANONICAL if canon_text(span) and canon_text(span) in hay else None


def check_rows(rows: list[dict], bodies: dict[str, dict]) -> dict:
    """Ground every span of every row against its own body.

    Returns a report; the caller decides what to do with it. Raises only when nothing was
    checked, because that is the one outcome that must never read as success.
    """
    failures: list[dict] = []
    modes: dict[str, int] = {}
    checked = 0
    missing_body: list[str] = []
    offset_drift: list[dict] = []

    for row in rows:
        oid = row["objectID"]
        body_rec = bodies.get(oid)
        if body_rec is None:
            if spans_of(row):
                missing_body.append(oid)
            continue
        body = body_rec.get("markdown") or ""
        canon_body = canonicalise(body).text
        offsets = row.get("span_offsets") or []
        for i, (fieldname, span) in enumerate(spans_of(row)):
            checked += 1
            mode = locate_span(span, body, canon_body)
            if mode is None:
                failures.append({"objectID": oid, "field": fieldname, "span": span[:160]})
                continue
            modes[mode] = modes.get(mode, 0) + 1
            # Offsets are a claim about WHERE, and a drifted offset is worth reporting even when
            # the span is findable -- it means the body moved under the artifact.
            if i < len(offsets):
                s, e = offsets[i]
                sliced = body[s:e] if 0 <= s < e <= len(body) else ""
                if canon_text(sliced) != canon_text(span):
                    offset_drift.append({"objectID": oid, "field": fieldname, "offsets": [s, e]})

    if checked == 0:
        raise ZeroWorkError(
            f"grounding checked zero spans across {len(rows)} rows. Zero work is a failure, "
            f"never a pass -- a verifier that matches nothing and reports success is the most "
            f"expensive kind of green.")

    return {
        "rows": len(rows),
        "spans_checked": checked,
        "located": checked - len(failures),
        "modes": modes,
        "failures": failures,
        "offset_drift": offset_drift,
        "missing_body": missing_body,
        "ok": not failures and not missing_body,
    }
