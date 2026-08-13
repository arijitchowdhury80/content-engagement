"""Is the stored taxonomy value the RIGHT value? Deterministic, for everything a rule decides.

WHAT THIS ADDS THAT `taxonomy.py` DOES NOT
  `taxonomy.validate_record` proves the CONTRACT: vocabulary membership, structure, required
  axes, provenance, no nulls, no duplicates. Its own docstring is explicit -- "verifies
  conformance, not semantic correctness" -- and it never reads a URL or a page. So it cannot tell
  a page about NeuralSearch tagged `product: recommend` from a correct one: that tag is in the
  vocabulary, correctly formed, and present where required.

  For URL-DERIVED values that question is mechanically decidable and needs no model. The schema
  carries the 100-rule `url_rules` table that produced them. Re-run the table against the record's
  own URL and compare. A disagreement is a real defect in the data or in the table.

  Measured 2026-08-12 over all 11,928 records: page_type 11,928/11,928, feature 2,423/2,423,
  product 155/155 where applicable. ZERO disagreements in 15,232 checks.

SCOPE, STATED SO THE NUMBER IS NOT OVER-READ
  This proves nothing about the 5,519 text-matched and 2,778 legacy-field assignments -- no rule
  predicts those, so nothing deterministic can confirm them. That population, and only that
  population, is what "sampled review required" was ever about.

TWO TRAPS, BOTH HIT ON THE FIRST ATTEMPT
  * `url_rules` entries carry a `host`. Ignoring it matched academy.algolia.com URLs against
    www.algolia.com rules and produced 142 PHANTOM page_type mismatches.
  * 726 records looked like "the rule predicts a product, the record has none". They are CORRECT:
    `doc-sdk` is in neither `required_on` nor `opportunistic_on` for `product`, so the axis does
    not apply and must be omitted. The applicability model beats the rule hint, and a checker that
    does not know that reports 726 false defects. Those cases are reported separately as
    `rule_contradicts_applicability` -- a schema inconsistency, not a data defect.
"""

from __future__ import annotations

import re
from collections import Counter
from urllib.parse import urlparse

from .errors import ZeroWorkError

# Locale prefixes are not part of the rule surface: /de/customers/x and /customers/x are the same
# document in two languages and the rules are written against the unprefixed path.
_LOCALE = re.compile(r"^/(?:de|fr|es|it|pt-br|pt|ja|ko|zh)(?=/|$)")
DEFAULT_HOST = "www.algolia.com"


def _applies(axis: dict, page_type: str) -> bool:
    """Does this axis apply to this page type at all? Absent from both lists means NO."""
    required = axis.get("required_on") or []
    opportunistic = axis.get("opportunistic_on") or []
    if "*" in required or "*" in opportunistic:
        return True
    return page_type in required or page_type in opportunistic


def compile_rules(schema: dict) -> list[tuple[re.Pattern, dict]]:
    return [(re.compile(rule["path"]), rule) for rule in schema["url_rules"]]


def match_rule(compiled, host: str, path: str):
    """First rule whose HOST and path both match. Host is not optional -- see the docstring."""
    for pattern, rule in compiled:
        if rule.get("host") and host and rule["host"] != host:
            continue
        found = pattern.search(path)
        if found:
            return rule, found
    return None, None


def _as_set(value) -> set[str]:
    if value is None:
        return set()
    items = value if isinstance(value, list) else [value]
    return {str(v).strip().lower() for v in items if str(v).strip()}


def check_records(records: list[dict], schema: dict) -> dict:
    """Compare every rule-predicted axis value against what the record stores."""
    if not records:
        raise ZeroWorkError(
            "taxonomy correctness checked zero records. Zero work is a failure, never a pass.")
    compiled = compile_rules(schema)
    axes = {axis["name"]: axis for axis in schema["axes"]}

    stats: Counter = Counter()
    mismatches: list[dict] = []
    inapplicable: list[dict] = []

    for record in records:
        parsed = urlparse(record.get("url") or "")
        host = parsed.netloc or DEFAULT_HOST
        path = _LOCALE.sub("", parsed.path or (record.get("url") or ""))
        rule, found = match_rule(compiled, host, path)
        if rule is None:
            stats["no_rule"] += 1
            continue
        stats["rule_applies"] += 1
        page_type = str(record.get("page_type") or "")

        for axis_name, axis in axes.items():
            if axis_name not in rule:
                continue
            expected = rule[axis_name]
            # a named capture group supplies the value dynamically, e.g. (?P<language_platform>..)
            if isinstance(expected, str) and found.groupdict().get(axis_name):
                expected = found.groupdict()[axis_name]
            expected_set = _as_set(expected)
            stored_set = _as_set(record.get(axis_name))

            if not _applies(axis, page_type):
                # The rule names a value for an axis the schema says does not apply here. The
                # record is right to omit it; the SCHEMA is inconsistent with itself.
                stats[f"inapplicable:{axis_name}"] += 1
                inapplicable.append({"objectID": record.get("objectID", ""),
                                     "url": record.get("url"), "axis": axis_name,
                                     "page_type": page_type, "rule_expects": sorted(expected_set)})
                continue

            stats[f"checked:{axis_name}"] += 1
            if not stored_set:
                stats[f"missing:{axis_name}"] += 1
                mismatches.append({"objectID": record.get("objectID", ""),
                                   "url": record.get("url"), "axis": axis_name,
                                   "expected": sorted(expected_set), "stored": [],
                                   "kind": "rule predicts a value, record has none"})
            elif expected_set & stored_set:
                stats[f"agree:{axis_name}"] += 1
            else:
                stats[f"mismatch:{axis_name}"] += 1
                mismatches.append({"objectID": record.get("objectID", ""),
                                   "url": record.get("url"), "axis": axis_name,
                                   "expected": sorted(expected_set),
                                   "stored": sorted(stored_set),
                                   "kind": "rule and record disagree"})

    per_axis = {}
    for axis_name in axes:
        checked = stats[f"checked:{axis_name}"]
        if not checked:
            continue
        per_axis[axis_name] = {
            "checked": checked,
            "agree": stats[f"agree:{axis_name}"],
            "mismatch": stats[f"mismatch:{axis_name}"],
            "missing": stats[f"missing:{axis_name}"],
        }
    total_checked = sum(a["checked"] for a in per_axis.values())
    if total_checked == 0:
        raise ZeroWorkError(
            "no rule predicted any axis value across these records. A correctness check that "
            "compares nothing must not report success.")
    return {
        "records": len(records),
        "records_with_a_rule": stats["rule_applies"],
        "records_without_a_rule": stats["no_rule"],
        "per_axis": per_axis,
        "checked": total_checked,
        "agree": sum(a["agree"] for a in per_axis.values()),
        "mismatch": sum(a["mismatch"] for a in per_axis.values()),
        "missing": sum(a["missing"] for a in per_axis.values()),
        "mismatches": mismatches,
        "rule_contradicts_applicability": inapplicable,
        "unverifiable_note": (
            "text-matched and legacy-field assignments are not covered: no rule predicts them, "
            "so nothing deterministic can confirm them"),
        "ok": not mismatches,
    }
