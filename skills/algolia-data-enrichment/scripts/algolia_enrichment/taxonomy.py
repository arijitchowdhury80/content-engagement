"""Validate the live index against the Chapter 1 taxonomy contract.

This module verifies conformance, not semantic correctness. A value can be in the controlled
vocabulary and still be editorially wrong; that residual risk belongs in the sampled taxonomy
review. What code can guarantee is that no enrichment run starts from malformed, unclassified,
or contract-inconsistent metadata.
"""

from __future__ import annotations

import json
from pathlib import Path

FORBIDDEN_VALUES = frozenset({"", "null", "none", "n/a"})


def load_schema(path: Path) -> dict:
    schema = json.loads(Path(path).read_text())
    if not schema.get("version") or not schema.get("axes") or not schema.get("vocabularies"):
        raise ValueError("taxonomy schema is missing version, axes, or vocabularies")
    return schema


def _required(axis: dict, page_type: str) -> bool:
    return "*" in axis.get("required_on", []) or page_type in axis.get("required_on", [])


def validate_record(record: dict, schema: dict) -> list[str]:
    """Return every mechanical taxonomy-contract violation for one index record."""
    issues: list[str] = []
    axes = {axis["name"]: axis for axis in schema["axes"]}
    page_type = record.get("page_type")
    page_vocab = set(schema["vocabularies"].get("page_type", {}))
    oid = str(record.get("objectID") or "")

    if not isinstance(page_type, str) or not page_type.strip():
        return ["page_type: missing"]
    if page_type not in page_vocab:
        return [f"page_type: unknown vocabulary value {page_type!r}"]

    version = record.get("taxonomy_version")
    if version != schema["version"]:
        issues.append(f"taxonomy_version: expected {schema['version']!r}, got {version!r}")

    provenance = record.get("taxonomy_provenance")
    confidence = record.get("taxonomy_confidence")
    if not isinstance(provenance, dict):
        issues.append("taxonomy_provenance: missing or not an object")
        provenance = {}
    if not isinstance(confidence, dict):
        issues.append("taxonomy_confidence: missing or not an object")
        confidence = {}

    for name, axis in axes.items():
        if name == "page_type":
            values = [page_type]
        else:
            values = record.get(name)
            required = _required(axis, page_type)
            if values is None:
                if required:
                    issues.append(f"{name}: required axis is missing")
                continue
            if not isinstance(values, list) or not values:
                issues.append(f"{name}: expected a non-empty ordered array")
                continue
            if len(values) != len(set(map(str, values))):
                issues.append(f"{name}: duplicate values are not allowed")

        for value in values:
            text = str(value).strip()
            if text.lower() in FORBIDDEN_VALUES:
                issues.append(f"{name}: contains forbidden empty/null value")
                continue
            if text == "unknown":
                if name == "page_type" or not _required(axis, page_type):
                    issues.append(f"{name}: 'unknown' is only valid on a required axis")
                continue
            if text not in schema["vocabularies"].get(name, {}):
                issues.append(f"{name}: unknown vocabulary value {text!r}")

        if name not in provenance:
            issues.append(f"{name}: missing taxonomy_provenance")
        if name not in confidence:
            issues.append(f"{name}: missing taxonomy_confidence")

    for axis_name in set(provenance) | set(confidence):
        if axis_name not in axes:
            issues.append(f"metadata: unknown taxonomy axis {axis_name!r}")
        elif axis_name != "page_type" and axis_name not in record:
            issues.append(f"{axis_name}: provenance/confidence present but axis is omitted")
    return sorted(set(issues))


def validate_records(records: list[dict], schema: dict) -> dict:
    """Return a full, auditable census rather than hiding violations in a counter."""
    violations = []
    page_type_counts: dict[str, int] = {}
    for record in records:
        page_type = str(record.get("page_type") or "")
        page_type_counts[page_type] = page_type_counts.get(page_type, 0) + 1
        issues = validate_record(record, schema)
        if issues:
            violations.append({"objectID": record.get("objectID", ""),
                               "url": record.get("url"), "page_type": page_type,
                               "issues": issues})
    return {
        "records": len(records),
        "page_type_counts": dict(sorted(page_type_counts.items())),
        "violation_count": len(violations),
        "violations": violations,
        "ok": not violations,
    }
