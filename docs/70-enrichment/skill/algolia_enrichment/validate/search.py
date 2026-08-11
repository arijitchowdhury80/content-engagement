"""Query-set evaluation. OUT OF THE v0 CRITICAL PATH -- present so the contract is fixed.

Two rules are written down now because both have already gone wrong once and improvising them
later is how they go wrong again.

THRESHOLDS ARE PRE-REGISTERED AND HASHED BEFORE THE BASELINE RUNS.
  "Worsen materially" is not a threshold. A number chosen after seeing the results is not a
  threshold either. The query-set file declares its own numbers and its hash goes into
  effective-config.json.

SEARCHABLE ATTRIBUTES: ONE ATTRIBUTE PER PRIORITY LEVEL.
      WRONG:  "unordered(abstract_enriched),unordered(keyhighlights_enriched)"
      RIGHT:  ["unordered(abstract_enriched)", "unordered(keyhighlights_enriched)"]
  A comma-joined string is stored by Algolia as ONE garbage attribute, is silently unsearchable,
  and reads back perfectly. Verification is a QUERY that returns hits, never a settings read.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path


def assert_searchable_syntax(searchable: list[str]) -> list[str]:
    """Attributes that smuggle more than one name into one priority level."""
    return [a for a in searchable if "," in a]


def add_enriched_searchable(existing: list[str], fields: tuple[str, ...]) -> list[str]:
    """Append each enriched field as its OWN unordered() entry, idempotently."""
    out = list(existing)
    for f in fields:
        entry = f"unordered({f})"
        if entry not in out and f not in out:
            out.append(entry)
    bad = assert_searchable_syntax(out)
    if bad:
        raise ValueError(f"comma-joined searchable attributes would be stored as one garbage "
                         f"attribute: {bad}")
    return out


def query_set_hash(path: Path) -> str:
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()[:16]


def load_query_set(path: Path) -> dict:
    data = json.loads(Path(path).read_text())
    if "thresholds" not in data:
        raise ValueError(f"{path} declares no thresholds. A threshold picked after the numbers "
                         f"are in is not a threshold.")
    return data
