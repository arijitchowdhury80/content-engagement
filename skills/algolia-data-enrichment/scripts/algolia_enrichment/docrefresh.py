"""Build Documentation records from freshly fetched pages.

Everything a record needs is decided here, once, from the page itself and its URL. That is the
point of the refresh: the previous corpus was assembled and then repeatedly corrected, and each
correction pass measured something different. Here title, description, body and all eight
taxonomy axes are produced in a single deterministic step and validated before anything is
written.

WHAT "CORRECT" CAN MEAN, PRECISELY.
  title        verifiable -- the page's own frontmatter title, else its first heading, verbatim.
  description  verifiable ONLY as present-and-verbatim. There is no source of truth for whether a
               description is GOOD. Where a page has none we store nothing and queue the record;
               29 live pages are in that state and inventing text for them would be fabrication
               that looks like data.
  taxonomy     provably correct when a URL rule produced it, because the same rule re-run against
               the same URL must yield the same value. Deriving every axis from `url_rules` makes
               the whole Documentation corpus re-derivable -- which is what the existing
               `taxonomy-correctness` command can then prove, end to end, for the first time.
  body         verbatim page markdown. NOT enrichment: no model reads or rewrites it.

THE AGGREGATE GATE EXISTS BECAUSE PER-RECORD CHECKS CANNOT SEE A BROKEN RULE.
  If a rule mis-tags an entire section, every individual record still passes every field check.
  This project has already been bitten by exactly that shape -- a scoping function returned 0 on
  97% of press releases while every per-record assertion passed. So the derived page_type
  distribution is compared against the live site's own section counts before any write.
"""

from __future__ import annotations

import json
import re

from .errors import EnrichmentError
from .seed import canonical_key, to_absolute
from .taxonomy_correctness import compile_rules, match_rule

SOURCE = "Documentation"
LANGUAGE = "en"

# Below this share the fetch did not represent the site, and every page it missed would be read
# as absent and deleted.
MIN_FETCH_SUCCESS_SHARE = 0.95

# The sitemap and the rule table bucket a handful of pages differently by design (a guide living
# under an integration path, say). Only a material gap indicates a broken rule.
DISTRIBUTION_TOLERANCE = 0.05

_FRONTMATTER = re.compile(r"\A---\s*\n(.*?)\n---\s*\n", re.DOTALL)
_HEADING = re.compile(r"^#\s+(.+?)\s*$", re.MULTILINE)


def _frontmatter_field(block: str, key: str) -> str:
    match = re.search(rf"^{key}\s*:\s*(.+?)\s*$", block, re.MULTILINE)
    if not match:
        return ""
    return match.group(1).strip().strip('"').strip("'")


def title_and_description(markdown: str, metadata: dict | None = None) -> tuple[str, str]:
    """The page's own title and meta description, verbatim. Never synthesised.

    SCOUT'S `metadata` IS THE SOURCE, not the markdown body. Scout returns the page's <title> and
    <meta name="description"> in a `metadata` object; its markdown carries neither -- there is no
    frontmatter and 293 of 300 sampled pages have no H1 at all. Parsing the body for them found a
    title on 30 of 882 pages and a description on none. The frontmatter and heading paths below
    remain only as a fallback for bodies that genuinely carry them.
    """
    meta = metadata or {}
    title = str(meta.get("title") or "").strip()
    description = str(meta.get("description") or "").strip()
    if title and description:
        return title, description

    front = _FRONTMATTER.search(markdown or "")
    if front:
        block = front.group(1)
        title = title or _frontmatter_field(block, "title")
        description = description or _frontmatter_field(block, "description")
    if not title:
        heading = _HEADING.search(markdown or "")
        title = heading.group(1).strip() if heading else ""
    return title, description


def derive_taxonomy(url: str, schema: dict, compiled=None) -> dict:
    """Every axis a URL rule can decide, with provenance, for one page.

    Refuses an unmatched URL. A record with no page_type fails `taxonomy-preflight` after it has
    been written, which is the expensive place to find out.
    """
    compiled = compiled if compiled is not None else compile_rules(schema)
    path = canonical_key(url)
    rule, match = match_rule(compiled, "www.algolia.com", path)
    if not rule:
        raise EnrichmentError(
            f"no url_rule matches {path}. Refusing to guess a taxonomy: an unclassified record "
            f"fails taxonomy-preflight only after it is already in the index.")

    axis_names = {axis["name"] for axis in schema["axes"]}
    vocabularies = schema.get("vocabularies", {})

    def in_vocabulary(axis: str, values):
        """Keep only values the controlled vocabulary actually allows.

        A capture group takes whatever the URL happens to contain, and on
        `/doc/api-reference/api-parameters/(?P<feature>[\\w-]+)` that is an API PARAMETER NAME --
        `advancedSyntax`, `distinct`, `minProximity`. Those are not product features and are not
        in the 30-value feature vocabulary. Emitting them is worse than emitting nothing: the
        merge treats a populated value as authoritative and would overwrite a correct stored
        feature with a parameter name on 90 records. An axis the rules cannot legitimately fill
        is left absent, so the merge keeps what is already there.
        """
        was_scalar = not isinstance(values, list)
        items = [values] if was_scalar else values
        allowed = vocabularies.get(axis)
        kept = [v for v in items if v and (not allowed or v in allowed)]
        # page_type is stored as a scalar and every other axis as an ordered array. Filtering
        # must not silently change an axis's shape -- a list where a string belongs fails the
        # taxonomy contract just as surely as a wrong value.
        if was_scalar:
            return kept[0] if kept else None
        return kept

    out: dict = {}
    for key, value in rule.items():
        if key in ("host", "path") or key not in axis_names:
            continue
        kept = in_vocabulary(key, value)
        if kept:
            out[key] = kept
    # Named capture groups let one rule carry a per-URL value, e.g. the SDK language.
    for key, value in (match.groupdict() if match else {}).items():
        if key in axis_names and value:
            kept = in_vocabulary(key, [value])
            if kept:
                out[key] = kept

    provenance = {axis: "url-rule" for axis in out}
    confidence = {axis: "high" for axis in out}
    return {
        **out,
        "taxonomy_version": schema["version"],
        "taxonomy_provenance": provenance,
        "taxonomy_confidence": confidence,
    }


def build_record(url: str, markdown: str, schema: dict, compiled=None,
                 metadata: dict | None = None) -> dict:
    """One complete Documentation record, built in a single pass from the page and its URL."""
    absolute = to_absolute(url)
    title, description = title_and_description(markdown, metadata)
    taxonomy_fields = derive_taxonomy(absolute, schema, compiled)
    return {
        "objectID": absolute,
        "url": absolute,
        "source": SOURCE,
        "language_code": LANGUAGE,
        "title": title,
        "description": description,
        "body": markdown,
        "needs_description": not description.strip(),
        "needs_title": not title.strip(),
        **taxonomy_fields,
    }


# Algolia refuses any record over 100,000 bytes and rejects the WHOLE batch it appears in, so a
# single oversized page blocks every record travelling with it. Budgeted slightly under the hard
# limit: JSON escaping can expand a body after measurement, and being 200 bytes under costs
# nothing while being 200 over costs the batch.
MAX_RECORD_BYTES = 95_000
BODY_TRUNCATION_MARKER = "\n\n[... body truncated to fit the index record size limit ...]"


def fit_record_size(record: dict, max_bytes: int = MAX_RECORD_BYTES) -> dict:
    """Trim an oversized record's BODY until it fits, and say so on the record.

    Only the body is trimmed: it is the one field that is long by nature and the one whose tail
    matters least. Truncation is declared both in the text and in `body_truncated`, because a
    silently shortened body reads exactly like a complete one.
    """
    if len(json.dumps(record).encode("utf-8")) <= max_bytes:
        return record

    body = record.get("body") or ""
    without_body = dict(record)
    without_body["body"] = ""
    overhead = len(json.dumps(without_body).encode("utf-8")) + len(BODY_TRUNCATION_MARKER)
    room = max_bytes - overhead
    if room <= 0:
        raise EnrichmentError(
            f"record {record.get('objectID')!r} exceeds {max_bytes} bytes even with no body; "
            f"trimming cannot save it and it must not be written as though it were fine.")

    keep = body
    while len(json.dumps({**record, "body": keep + BODY_TRUNCATION_MARKER}).encode("utf-8")) > max_bytes:
        keep = keep[: max(0, int(len(keep) * 0.9)) or 0]
        if not keep:
            break
    record["body"] = keep + BODY_TRUNCATION_MARKER
    record["body_truncated"] = True
    return record


def fetch_report(rows: list[dict]) -> dict:
    """Refuse to let a partial or redirected fetch become a refresh."""
    total = len(rows)
    if not total:
        raise EnrichmentError("fetch produced no rows.")
    failed = [r for r in rows if r.get("fetch_error")]
    redirected = [r for r in rows if not r.get("fetch_error") and r.get("redirect_mismatch")]
    succeeded = total - len(failed) - len(redirected)
    share = succeeded / total
    report = {
        "total": total, "succeeded": succeeded, "failed": len(failed),
        "redirect_mismatch": len(redirected), "success_share": round(share, 4),
        "ok": share >= MIN_FETCH_SUCCESS_SHARE,
    }
    if not report["ok"]:
        raise EnrichmentError(
            f"fetch success {share:.1%} is below the required "
            f"{int(MIN_FETCH_SUCCESS_SHARE * 100)}%: {len(failed)} failed, "
            f"{len(redirected)} served a different URL than requested. A partial fetch must not "
            f"become a refresh -- every page it missed would be read as absent and deleted.")
    return report


def check_distribution(derived: dict[str, int], site_sections: dict[str, int],
                       mapping: dict[str, str]) -> dict:
    """Compare derived page_type counts against the live site's own section counts."""
    divergences = []
    for page_type, section in mapping.items():
        got = derived.get(page_type, 0)
        expected = site_sections.get(section, 0)
        if expected == 0:
            continue
        drift = abs(got - expected) / expected
        if drift > DISTRIBUTION_TOLERANCE:
            divergences.append({"page_type": page_type, "section": section,
                                "derived": got, "site": expected, "drift": round(drift, 4)})
    return {"ok": not divergences, "divergences": divergences,
            "derived": dict(sorted(derived.items())), "site_sections": dict(sorted(site_sections.items()))}
